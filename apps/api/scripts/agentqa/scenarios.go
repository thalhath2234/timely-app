package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Categories are the 2026-10-02 run's twelve groups, seven scenarios each.
var Categories = []string{"tasks", "reminders", "events", "recurring", "sheets", "docs", "bulk", "bots", "questions", "declines", "stale", "timezones"}

// Scenario is one message sent to a fresh chat, with what the run should do.
type Scenario struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	// Message is the person's words. Templates: {{workspace}}, {{timezone}},
	// {{today+N}} (a date) and {{today+NThh:mm}} (a time in the scenario's
	// zone), {{alias.path}} (a field of a setup response, e.g. {{t1.id}}).
	Message  string `json:"message"`
	Timezone string `json:"timezone,omitempty"`
	// Setup requests run before the message; Between runs after the first
	// turn ends waiting for approval and before Approve (stale data).
	Setup   []Request `json:"setup,omitempty"`
	Between []Request `json:"between,omitempty"`
	// Approve presses Approve when the turn ends with a proposal waiting.
	Approve bool   `json:"approve"`
	Expect  Expect `json:"expect"`
	// Stub is the stub model's directive (CALL/SCRIPT, apps/agent/tests/
	// stub_openai.py), appended to the message only with -stub.
	Stub string `json:"stub,omitempty"`
	Note string `json:"note,omitempty"`
}

// Request is one REST call of a scenario's setup.
type Request struct {
	As     string         `json:"as,omitempty"`
	Method string         `json:"method"`
	Path   string         `json:"path"`
	Body   map[string]any `json:"body,omitempty"`
}

// Expect is how a run is scored.
type Expect struct {
	// Outcome: "proposal" (the turn records changes), "reply" (it answers
	// without one), or "any".
	Outcome string `json:"outcome"`
	// Tools must each appear among the proposal's steps.
	Tools []string `json:"tools,omitempty"`
	// ReplyAny: at least one appears in the replies (case-insensitive).
	ReplyAny []string `json:"replyAny,omitempty"`
	// AfterApprove: "applied" (every step done) or "replanned" (the data
	// changed, so the plan was made again).
	AfterApprove string `json:"afterApprove,omitempty"`
}

type scenarioFile struct {
	About     string     `json:"about"`
	Scenarios []Scenario `json:"scenarios"`
}

// LoadScenarios reads a scenarios file and checks it.
func LoadScenarios(path string) ([]Scenario, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var f scenarioFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return f.Scenarios, Validate(f.Scenarios)
}

// Validate checks ids, categories and expectations.
func Validate(list []Scenario) error {
	seen := map[string]bool{}
	for _, s := range list {
		switch {
		case s.ID == "" || seen[s.ID]:
			return fmt.Errorf("scenario id %q is empty or repeated", s.ID)
		case !slices.Contains(Categories, s.Category):
			return fmt.Errorf("%s: unknown category %q", s.ID, s.Category)
		case strings.TrimSpace(s.Message) == "":
			return fmt.Errorf("%s: empty message", s.ID)
		case s.Expect.Outcome != "proposal" && s.Expect.Outcome != "reply" && s.Expect.Outcome != "any":
			return fmt.Errorf("%s: outcome must be proposal, reply or any", s.ID)
		case s.Expect.AfterApprove != "" && s.Expect.AfterApprove != "applied" && s.Expect.AfterApprove != "replanned":
			return fmt.Errorf("%s: afterApprove must be applied or replanned", s.ID)
		case len(s.Between) > 0 && !s.Approve:
			return fmt.Errorf("%s: between needs approve", s.ID)
		}
		if s.Timezone != "" {
			if _, err := time.LoadLocation(s.Timezone); err != nil {
				return fmt.Errorf("%s: %w", s.ID, err)
			}
		}
		seen[s.ID] = true
	}
	return nil
}

// Pick keeps the scenarios named in only (comma-separated ids or
// categories); empty keeps all.
func Pick(list []Scenario, only string) ([]Scenario, error) {
	if strings.TrimSpace(only) == "" {
		return list, nil
	}
	want := map[string]bool{}
	for _, id := range strings.Split(only, ",") {
		if id = strings.TrimSpace(id); id != "" {
			want[id] = true
		}
	}
	var out []Scenario
	for _, s := range list {
		if want[s.ID] || want[s.Category] {
			out = append(out, s)
		}
	}
	found := map[string]bool{}
	for _, s := range out {
		found[s.ID], found[s.Category] = true, true
	}
	for id := range want {
		if !found[id] {
			return nil, fmt.Errorf("-only: no scenario or category %q", id)
		}
	}
	return out, nil
}

var placeholder = regexp.MustCompile(`\{\{([^{}]+)\}\}`)
var relDay = regexp.MustCompile(`^today([+-]\d+)(?:T(\d{2}):(\d{2}))?$`)

// Vars are the values templates expand to.
type Vars struct {
	Workspace string
	Zone      *time.Location
	Now       time.Time
	Saved     map[string]any // setup responses by alias
}

// Expand fills a string's templates.
func (v Vars) Expand(s string) (string, error) {
	var err error
	out := placeholder.ReplaceAllStringFunc(s, func(m string) string {
		name := strings.TrimSpace(m[2 : len(m)-2])
		value, e := v.lookup(name)
		if e != nil && err == nil {
			err = e
		}
		return value
	})
	return out, err
}

func (v Vars) lookup(name string) (string, error) {
	switch name {
	case "workspace":
		return v.Workspace, nil
	case "timezone":
		return v.Zone.String(), nil
	}
	if m := relDay.FindStringSubmatch(name); m != nil {
		days, _ := strconv.Atoi(m[1])
		day := v.Now.In(v.Zone).AddDate(0, 0, days)
		if m[2] == "" {
			return day.Format("2006-01-02"), nil
		}
		h, _ := strconv.Atoi(m[2])
		min, _ := strconv.Atoi(m[3])
		at := time.Date(day.Year(), day.Month(), day.Day(), h, min, 0, 0, v.Zone)
		return at.Format(time.RFC3339), nil
	}
	alias, path, _ := strings.Cut(name, ".")
	saved, ok := v.Saved[alias]
	if !ok {
		return "", fmt.Errorf("template {{%s}}: no setup response named %q", name, alias)
	}
	if found, ok := walk(saved, strings.Split(path, ".")); ok {
		return fmt.Sprint(found), nil
	}
	if path == "id" {
		// Responses wrap the object ({"task": {...}}): the first id found.
		if found, ok := firstID(saved); ok {
			return found, nil
		}
	}
	return "", fmt.Errorf("template {{%s}}: not in the setup response", name)
}

func walk(v any, path []string) (any, bool) {
	for _, key := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil, false
		}
		if v, ok = m[key]; !ok {
			return nil, false
		}
	}
	return v, v != nil
}

func firstID(v any) (string, bool) {
	queue := []any{v}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		switch t := cur.(type) {
		case map[string]any:
			if id, ok := t["id"].(string); ok && id != "" {
				return id, true
			}
			keys := make([]string, 0, len(t))
			for k := range t {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			for _, k := range keys {
				queue = append(queue, t[k])
			}
		case []any:
			queue = append(queue, t...)
		}
	}
	return "", false
}

// ExpandAny fills templates in every string of a JSON-like value.
func (v Vars) ExpandAny(x any) (any, error) {
	switch t := x.(type) {
	case string:
		return v.Expand(t)
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			e, err := v.ExpandAny(val)
			if err != nil {
				return nil, err
			}
			out[k] = e
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			e, err := v.ExpandAny(val)
			if err != nil {
				return nil, err
			}
			out[i] = e
		}
		return out, nil
	}
	return x, nil
}
