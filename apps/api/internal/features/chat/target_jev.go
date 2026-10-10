package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"timely-api/internal/features/agent"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/search"
)

// resolve_target (ADR 0012) answers "which one?" when a change names an item
// that may match several: two dentist appointments, similarly named tasks,
// docs, sheets or projects. Code builds the shortlist (search by the name,
// at most maxTargets of the kind) and Jev only says which candidate the
// person's own words most likely mean. The tool is read-only and offered only
// when Jev can answer for the account; a pick only reorders what the model is
// told, never what a proposal applies. Sensitive chats get the shortlist with
// no pick and nothing is sent.

const (
	targetTool = "resolve_target"
	// The model waits for the tool, as it would for a search.
	targetBudget = 3 * time.Second
	maxTargets   = 8
)

var targetKinds = map[string]string{
	"task":    "tasks or reminders",
	"event":   "calendar events",
	"doc":     "docs",
	"sheet":   "sheets",
	"project": "projects",
}

// targetHint is added to the system prompt only when resolve_target is offered.
const targetHint = "\nWhen a change names an existing item in words that may match more than one (two dentist appointments, similarly named tasks, docs, sheets or projects), call resolve_target with its kind and name before proposing. Its pick is only the most likely candidate: read it before proposing, and when there is no pick and several fit, ask the person which one they mean."

func targetSpec() any {
	return toolSpec(targetTool, "Shortlist the existing items a change may be about when its name could match several, and say which one the person most likely means. Returns up to 8 candidates; a confident pick comes first and is named in pick. Read-only.",
		map[string]any{"type": "object", "properties": map[string]any{
			"kind": map[string]any{"type": "string", "enum": []string{"task", "event", "doc", "sheet", "project"}},
			"name": map[string]any{"type": "string", "description": "The words the person used for the item, e.g. dentist appointment"},
		}, "required": []string{"kind", "name"}})
}

// Target is one candidate in resolve_target's answer.
type Target struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Details string `json:"details,omitempty"`
	Likely  bool   `json:"likely,omitempty"`
}

// targetPick remembers a pick so the proposal that follows can tell Jev
// whether it was used (see targetFeedback).
type targetPick struct {
	logID  string
	pick   string
	others []string
}

// resolveTarget runs resolve_target. now and loc write dates in words.
func (s *Service) resolveTarget(ctx context.Context, c *Conversation, catalog agent.Catalog, loc *time.Location, now time.Time, args json.RawMessage) (any, *targetPick, error) {
	var in struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, nil, fmt.Errorf("Invalid resolve_target arguments")
	}
	in.Name = strings.TrimSpace(in.Name)
	label, ok := targetKinds[in.Kind]
	if !ok || in.Name == "" || len(in.Name) > 300 {
		return nil, nil, fmt.Errorf("Give kind (task, event, doc, sheet or project) and the name the person used")
	}
	candidates, err := shortlist(ctx, c.UserID, catalog, in.Kind, in.Name, loc, now)
	if err != nil {
		return nil, nil, err
	}
	out := map[string]any{"candidates": candidates, "pick": ""}
	if len(candidates) == 0 {
		out["note"] = "Nothing matches that name. Search with other words, or ask the person."
		return out, nil, nil
	}
	if len(candidates) == 1 {
		out["note"] = "Only one item matches. Read it before proposing."
		return out, nil, nil
	}
	out["note"] = "No candidate stands out. If several fit the request, ask the person which one they mean."
	if s.decisions == nil || c.Sensitive || decide.IsSensitive(ctx) {
		return out, nil, nil
	}
	ask, cancel := context.WithTimeout(ctx, targetBudget)
	defer cancel()
	state, question, names := targetQuestion(c, label, in.Name, candidates)
	a, err := s.decisions.Ask(ask, c.UserID, decide.Request{Feature: "chat_target", State: state, Questions: map[string]decide.Question{"target": question}})
	if err != nil {
		return out, nil, nil
	}
	name, sure := a.Choice("target", decide.Route)
	n, found := names[name]
	if !sure || !found {
		return out, nil, nil
	}
	picked := candidates[n]
	picked.Likely = true
	ordered := append([]Target{picked}, append(append([]Target{}, candidates[:n]...), candidates[n+1:]...)...)
	out["candidates"], out["pick"] = ordered, picked.ID
	out["note"] = "The first candidate is most likely the one the person means. Read it before proposing, and ask when the request does not make it clear."
	p := &targetPick{logID: a.LogID, pick: picked.ID}
	for _, t := range candidates {
		if t.ID != picked.ID {
			p.others = append(p.others, t.ID)
		}
	}
	return out, p, nil
}

// targetQuestion asks which candidate the request means, by a unique name per
// candidate; names maps each option back to its index. "none" lets Jev say
// the words do not tell them apart.
func targetQuestion(c *Conversation, label, name string, candidates []Target) (map[string]any, decide.Question, map[string]int) {
	latest, earlier := latestRequest(c)
	listed := make([]map[string]any, len(candidates))
	opts := []decide.Option{{Name: "none", Description: "None of these, or the request does not say which one."}}
	names := map[string]int{}
	for i, t := range candidates {
		option := clip(t.Title, 80)
		if option == "" {
			option = "Untitled"
		}
		base := option
		for k := 2; ; k++ {
			if _, taken := names[option]; !taken && !strings.EqualFold(option, "none") {
				break
			}
			option = fmt.Sprintf("%s (%d)", base, k)
		}
		names[option] = i
		opts = append(opts, decide.Option{Name: option, Description: clip(t.Details, 200)})
		listed[i] = map[string]any{"name": option, "details": clip(t.Details, 200)}
	}
	state := map[string]any{"request": clip(latest, 2000), "lookingFor": clip(name, 200), "kind": label, "candidates": listed}
	if earlier != "" {
		state["previousMessage"] = earlier
	}
	q := decide.Choice(fmt.Sprintf("The person's request changes one of their %s. Which candidate does it mean?", label), opts...).Twice()
	return state, q, names
}

// shortlist searches the kind by name and describes each candidate in words.
func shortlist(ctx context.Context, uid string, catalog agent.Catalog, kind, name string, loc *time.Location, now time.Time) ([]Target, error) {
	find, ok := catalog["semantic_search"]
	if !ok || find.Call == nil {
		return nil, fmt.Errorf("Search is not available")
	}
	result, err := find.Call(ctx, uid, raw(map[string]any{"query": name, "limit": 20, "kinds": []string{kind}}))
	if err != nil {
		return nil, err
	}
	var found struct {
		Hits []search.Hit `json:"hits"`
	}
	if err := json.Unmarshal(raw(result), &found); err != nil {
		return nil, err
	}
	out := []Target{}
	seen := map[string]bool{}
	for _, h := range found.Hits {
		if h.Kind != kind || h.ID == "" || seen[h.ID] {
			continue
		}
		seen[h.ID] = true
		t := Target{ID: h.ID, Kind: h.Kind, Title: h.Title, Details: clip(h.Snippet, 160)}
		if d := describe(ctx, uid, catalog, kind, h.ID, loc, now); d != "" && t.Details != "" {
			t.Details = d + ". " + t.Details
		} else if d != "" {
			t.Details = d
		}
		out = append(out, t)
		if len(out) == maxTargets {
			break
		}
	}
	return out, nil
}

// describe writes what tells events and tasks apart (their dates, whether
// done) in words, so Jev never compares timestamps.
func describe(ctx context.Context, uid string, catalog agent.Catalog, kind, id string, loc *time.Location, now time.Time) string {
	switch kind {
	case "event":
		get, ok := catalog["get_event"]
		if !ok || get.Call == nil {
			return ""
		}
		result, err := get.Call(ctx, uid, raw(map[string]string{"eventId": id}))
		if err != nil {
			return ""
		}
		var ev struct {
			Start      time.Time       `json:"start"`
			AllDay     bool            `json:"allDay"`
			Recurrence json.RawMessage `json:"recurrence"`
		}
		if json.Unmarshal(raw(result), &ev) != nil || ev.Start.IsZero() {
			return ""
		}
		when := dateInWords(ev.Start, now, loc)
		if !ev.AllDay {
			when += " at " + ev.Start.In(loc).Format("15:04")
		}
		if len(ev.Recurrence) > 0 && string(ev.Recurrence) != "null" {
			return "repeating, first on " + when
		}
		return when
	case "task":
		get, ok := catalog["get_task"]
		if !ok || get.Call == nil {
			return ""
		}
		result, err := get.Call(ctx, uid, raw(map[string]string{"taskId": id}))
		if err != nil {
			return ""
		}
		var payload struct {
			Task struct {
				Kind        string  `json:"kind"`
				Deadline    *string `json:"deadline"`
				ScheduledOn *string `json:"scheduledOn"`
				CompletedAt *string `json:"completedAt"`
			} `json:"task"`
		}
		if json.Unmarshal(raw(result), &payload) != nil {
			return ""
		}
		t := payload.Task
		parts := []string{}
		if t.Kind == "reminder" {
			parts = append(parts, "reminder")
		}
		if t.CompletedAt != nil && *t.CompletedAt != "" {
			parts = append(parts, "done")
		}
		if t.Deadline != nil && len(*t.Deadline) >= 10 {
			if d, err := time.ParseInLocation("2006-01-02", (*t.Deadline)[:10], loc); err == nil {
				parts = append(parts, "due "+dateInWords(d, now, loc))
			}
		}
		if t.ScheduledOn != nil {
			if d, err := time.Parse(time.RFC3339, *t.ScheduledOn); err == nil {
				parts = append(parts, "planned "+dateInWords(d, now, loc)+" at "+d.In(loc).Format("15:04"))
			}
		}
		return strings.Join(parts, ", ")
	}
	return ""
}

// dateInWords is a date with its distance from today in words: "Tue 14 Oct
// 2026 (in 4 days)".
func dateInWords(t, now time.Time, loc *time.Location) string {
	local, today := t.In(loc), now.In(loc)
	day := func(x time.Time) time.Time { return time.Date(x.Year(), x.Month(), x.Day(), 0, 0, 0, 0, time.UTC) }
	diff := int(day(local).Sub(day(today)).Hours() / 24)
	rel := ""
	switch {
	case diff == 0:
		rel = "today"
	case diff == 1:
		rel = "tomorrow"
	case diff == -1:
		rel = "yesterday"
	case diff > 1:
		rel = fmt.Sprintf("in %d days", diff)
	default:
		rel = fmt.Sprintf("%d days ago", -diff)
	}
	return local.Format("Mon 2 Jan 2006") + " (" + rel + ")"
}

// targetFeedback tells the decision log whether a proposal used Jev's pick:
// a step that names the pick keeps it, one that names another candidate
// instead does not. A proposal naming none of them says nothing.
func (s *Service) targetFeedback(userID string, picks []*targetPick, steps []Step) {
	fb, ok := s.decisions.(interface {
		Feedback(userID, logID string, accepted bool) error
	})
	if !ok || len(picks) == 0 {
		return
	}
	var b strings.Builder
	for _, step := range steps {
		b.Write(step.Arguments)
	}
	args := b.String()
	for _, p := range picks {
		if p == nil || p.logID == "" {
			continue
		}
		if strings.Contains(args, `"`+p.pick+`"`) {
			_ = fb.Feedback(userID, p.logID, true)
			continue
		}
		for _, other := range p.others {
			if strings.Contains(args, `"`+other+`"`) {
				_ = fb.Feedback(userID, p.logID, false)
				break
			}
		}
	}
}
