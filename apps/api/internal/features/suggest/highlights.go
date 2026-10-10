package suggest

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// Dashboard highlights [90–93]. The Dashboard computes its facts in the
// client and sends them as sentences; the server adds what it can count
// itself (blocked Work, Work left unfinished). Jev sorts blockers into
// themes [91] and unfinished Work into reasons [92], picks the facts worth
// highlighting [90], and keeps only the tips the person's own data backs [93].

const (
	highlightsBudget  = 15 * time.Second
	maxFacts          = 16
	maxFactRunes      = 200
	maxBlocked        = 12
	maxMissed         = 10
	missedLookback    = 14 * 24 * time.Hour
	maxHighlights     = 3
	maxTips           = 2
	minHighlightLevel = 2
)

type Fact struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type HighlightsRequest struct {
	Facts []Fact `json:"facts"`
}

// Group is a theme or reason with the Work under it, largest first.
type Group struct {
	Key   string     `json:"key"`
	Label string     `json:"label"`
	Count int        `json:"count"`
	Tasks []TaskLink `json:"tasks"`
}

type TaskLink struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Tip struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

type Highlights struct {
	Available  bool    `json:"available"`
	LogID      string  `json:"logId,omitempty"`
	Highlights []Fact  `json:"highlights"`
	Blockers   []Group `json:"blockers"`
	Missed     []Group `json:"missed"`
	Tips       []Tip   `json:"tips"`
}

// Blocker themes [91].
var blockerThemes = []decide.Option{
	{Name: "person", Description: "Waiting on a person: a reply, a decision or their part of the work"},
	{Name: "information", Description: "Missing information, documents or details"},
	{Name: "approval", Description: "Waiting on approval, payment or budget"},
	{Name: "access", Description: "Needs tools, access, an account or equipment"},
	{Name: "dependency", Description: "Another piece of work must be done first"},
	{Name: "unclear", Description: "The next step itself is unclear"},
}

var blockerLabels = map[string]string{
	"person": "Waiting on someone", "information": "Missing information", "approval": "Waiting on approval or money",
	"access": "Needs tools or access", "dependency": "Other work first", "unclear": "Next step unclear",
}

// Reasons Work was left unfinished [92].
var missedReasons = []decide.Option{
	{Name: "too_big", Description: "It needed more time than was planned for it"},
	{Name: "interrupted", Description: "Something urgent, a meeting or other work got in the way"},
	{Name: "blocked", Description: "It was waiting on someone or something"},
	{Name: "unclear", Description: "It was not clear how to start or what done looks like"},
	{Name: "unwanted", Description: "Low priority, dreaded or no longer really wanted"},
}

var missedLabels = map[string]string{
	"too_big": "Bigger than planned", "interrupted": "Got interrupted", "blocked": "Was blocked",
	"unclear": "Unclear how to start", "unwanted": "Low priority or put off",
}

// Productivity tips; each is shown only when Jev finds the person's own
// facts back it [93].
var tips = []Tip{
	{Key: "split", Text: "Split big tasks into steps of an hour or less, so a block can finish one."},
	{Key: "buffer", Text: "Leave a gap between blocks, so interruptions don't push work out of the day."},
	{Key: "follow_up", Text: "Follow up on what you're waiting for, or set a date to chase it."},
	{Key: "clarify", Text: "Write a first step and a “done when” line on vague tasks before planning them."},
	{Key: "fewer", Text: "Plan fewer tasks a day; finishing a short list beats starting a long one."},
	{Key: "inbox", Text: "Clear the Inbox once a day so new work gets a deadline or a project."},
	{Key: "prune", Text: "Drop or archive work you keep putting off; a shorter list is easier to trust."},
	{Key: "morning", Text: "Put your hardest work on the days and times you finish the most."},
}

func (s *Service) highlightRoutes(g *echo.Group) {
	g.POST("/suggestions/highlights", s.highlights)
}

func (s *Service) highlights(c *echo.Context) error {
	var req HighlightsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(400, "invalid request")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), highlightsBudget)
	defer cancel()
	out, err := s.Highlights(ctx, user(c), req.Facts, time.Now())
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// Highlights reads the person's Work and the Dashboard's facts.
func (s *Service) Highlights(ctx context.Context, userID string, facts []Fact, now time.Time) (Highlights, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := Highlights{Available: on, Highlights: []Fact{}, Blockers: []Group{}, Missed: []Group{}, Tips: []Tip{}}
	if !on {
		return out, nil
	}
	facts = cleanFacts(facts)
	blocked, err := s.blockedWork(ctx, userID)
	if err != nil {
		return out, err
	}
	missed, err := s.unfinishedWork(ctx, userID, now)
	if err != nil {
		return out, err
	}

	// First call: themes and reasons, counted in code.
	if len(blocked)+len(missed) > 0 {
		questions := map[string]decide.Question{}
		var bList, mList []map[string]any
		for i, b := range blocked {
			key := fmt.Sprintf("b%d", i+1)
			bList = append(bList, b.state(key))
			questions[key] = decide.Choice(fmt.Sprintf("Blocked task %s: what is it most likely waiting on?", key), blockerThemes...)
		}
		for i, m := range missed {
			key := fmt.Sprintf("m%d", i+1)
			mList = append(mList, m.state(key))
			questions[key] = decide.Choice(fmt.Sprintf("Task %s had time planned that passed with it still open. What most likely kept it from being finished?", key), missedReasons...)
		}
		state := map[string]any{}
		if len(bList) > 0 {
			state["blocked"] = bList
		}
		if len(mList) > 0 {
			state["unfinished"] = mList
		}
		if a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "dashboard_reasons", State: state, Questions: questions}); err == nil {
			out.Blockers = groupBy(blocked, "b", a, blockerLabels)
			out.Missed = groupBy(missed, "m", a, missedLabels)
		}
	}

	// The server's own facts join the Dashboard's.
	all := append([]Fact(nil), facts...)
	if len(out.Blockers) > 0 {
		verb := "open tasks are"
		if len(blocked) == 1 {
			verb = "open task is"
		}
		all = append(all, Fact{ID: "server:blockers", Text: fmt.Sprintf("%d %s blocked; the most common reason: %s (%d).",
			len(blocked), verb, strings.ToLower(out.Blockers[0].Label), out.Blockers[0].Count)})
	}
	if len(out.Missed) > 0 {
		all = append(all, Fact{ID: "server:missed", Text: fmt.Sprintf("%s had planned time pass in the last two weeks without being finished; the most common reason: %s (%d).",
			countWords(len(missed), "task"), strings.ToLower(out.Missed[0].Label), out.Missed[0].Count)})
	}
	if len(all) == 0 {
		return out, nil
	}

	// Second call: which facts to highlight, and which tips they back.
	list := make([]map[string]any, 0, len(all))
	questions := map[string]decide.Question{}
	for i, f := range all {
		key := fmt.Sprintf("f%d", i+1)
		list = append(list, map[string]any{"fact": key, "text": f.Text})
		questions[key] = decide.Score(fmt.Sprintf("How worth highlighting to the person on their dashboard is fact %s this week?", key),
			"Not worth mentioning: routine or unchanged", "Mildly interesting", "Worth a look: a clear change, risk or win", "Important: they should act on it")
	}
	tipList := make([]map[string]any, 0, len(tips))
	for i, t := range tips {
		key := fmt.Sprintf("t%d", i+1)
		tipList = append(tipList, map[string]any{"tip": key, "text": t.Text})
		questions[key] = decide.YesNo(fmt.Sprintf("Do the person's facts clearly back tip %s, so it fits them rather than being generic advice?", key),
			"Yes: a specific fact shows this tip would help them", "No: no fact supports it, or the facts point elsewhere")
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "dashboard_highlights", State: map[string]any{"facts": list, "tips": tipList}, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	type scored struct {
		i     int
		level int
	}
	var picks []scored
	for i := range all {
		// Score confidences run low, so the level is read at any confidence.
		if level, ok := a.Level(fmt.Sprintf("f%d", i+1), 0); ok && level >= minHighlightLevel {
			picks = append(picks, scored{i, level})
		}
	}
	sort.SliceStable(picks, func(x, y int) bool { return picks[x].level > picks[y].level })
	for _, p := range picks {
		if len(out.Highlights) < maxHighlights {
			out.Highlights = append(out.Highlights, all[p.i])
		}
	}
	type backed struct {
		i    int
		prob float64
	}
	var good []backed
	for i := range tips {
		key := fmt.Sprintf("t%d", i+1)
		if yes, ok := a.Yes(key, decide.Prefill); ok && yes {
			raw, _ := a.Raw(key)
			good = append(good, backed{i, raw.Yes})
		}
	}
	sort.SliceStable(good, func(x, y int) bool { return good[x].prob > good[y].prob })
	for _, g := range good {
		if len(out.Tips) < maxTips {
			out.Tips = append(out.Tips, tips[g.i])
		}
	}
	return out, nil
}

func cleanFacts(in []Fact) []Fact {
	out := make([]Fact, 0, len(in))
	seen := map[string]bool{}
	for _, f := range in {
		text := strings.TrimSpace(f.Text)
		id := strings.TrimSpace(f.ID)
		if text == "" || id == "" || seen[id] || strings.HasPrefix(id, "server:") || len(out) == maxFacts {
			continue
		}
		seen[id] = true
		out = append(out, Fact{ID: clip(id, 60), Text: clip(text, maxFactRunes)})
	}
	return out
}

// workNote is one task Jev reads for a theme or a reason.
type workNote struct {
	ID, Name, Description string
	Facts                 []string
	Comments              []string
}

func (w workNote) state(key string) map[string]any {
	m := map[string]any{"task": key, "title": clip(w.Name, 200)}
	if w.Description != "" {
		m["description"] = clip(w.Description, 300)
	}
	if len(w.Facts) > 0 {
		m["facts"] = w.Facts
	}
	if len(w.Comments) > 0 {
		m["latestComments"] = w.Comments
	}
	return m
}

// blockedWork is open Work that waits on an open task or sits in a status
// named like "Blocked" or "Waiting".
func (s *Service) blockedWork(ctx context.Context, userID string) ([]workNote, error) {
	var rows []struct {
		ID, Name, Description string
		Blocker, Status       *string
	}
	err := s.db.WithContext(ctx).Raw(`SELECT t.id, t.name, t.description, b.name AS blocker, st.name AS status
		FROM tasks t
		LEFT JOIN tasks b ON b.id = t.blocked_by_id AND b.completed_at IS NULL
		LEFT JOIN statuses st ON st.id = t.status_id
		WHERE t.user_id = ? AND t.kind = ? AND t.completed_at IS NULL
		  AND (b.id IS NOT NULL OR st.name ILIKE '%block%' OR st.name ILIKE '%wait%')
		ORDER BY t.updated_at DESC LIMIT ?`, userID, models.KindTask, maxBlocked).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]workNote, 0, len(rows))
	for _, r := range rows {
		w := workNote{ID: r.ID, Name: r.Name, Description: strings.TrimSpace(r.Description), Comments: s.latestComments(ctx, r.ID)}
		if r.Blocker != nil {
			w.Facts = append(w.Facts, fmt.Sprintf("waits on the task “%s”", clip(*r.Blocker, 120)))
		}
		if r.Status != nil {
			w.Facts = append(w.Facts, "status: "+*r.Status)
		}
		out = append(out, w)
	}
	return out, nil
}

// unfinishedWork is open Work whose planned time passed in the last two
// weeks, most recent first.
func (s *Service) unfinishedWork(ctx context.Context, userID string, now time.Time) ([]workNote, error) {
	var rows []struct {
		ID, Name, Description string
		Duration              int
		Blocks                int
		Planned               float64
		Last                  time.Time
	}
	err := s.db.WithContext(ctx).Raw(`SELECT t.id, t.name, t.description, t.duration, COUNT(b.id) AS blocks,
			SUM(EXTRACT(EPOCH FROM (b.end_at - b.start_at)) / 60) AS planned, MAX(b.end_at) AS last
		FROM tasks t JOIN scheduled_blocks b ON b.task_id = t.id
		WHERE t.user_id = ? AND t.kind = ? AND t.completed_at IS NULL AND b.end_at <= ? AND b.end_at >= ?
		GROUP BY t.id, t.name, t.description, t.duration
		ORDER BY last DESC LIMIT ?`, userID, models.KindTask, now, now.Add(-missedLookback), maxMissed).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]workNote, 0, len(rows))
	for _, r := range rows {
		w := workNote{ID: r.ID, Name: r.Name, Description: strings.TrimSpace(r.Description), Comments: s.latestComments(ctx, r.ID)}
		w.Facts = append(w.Facts, fmt.Sprintf("%s of planned time passed (%d minutes in all), estimate %d minutes",
			countWords(r.Blocks, "block"), int(r.Planned), r.Duration))
		out = append(out, w)
	}
	return out, nil
}

// groupBy counts the Work under each answer, largest group first.
func groupBy(work []workNote, prefix string, a decide.Answers, labels map[string]string) []Group {
	byKey := map[string]*Group{}
	var order []string
	for i, w := range work {
		key, ok := a.Choice(fmt.Sprintf("%s%d", prefix, i+1), decide.Flag)
		if !ok {
			continue
		}
		g, found := byKey[key]
		if !found {
			g = &Group{Key: key, Label: labels[key], Tasks: []TaskLink{}}
			byKey[key] = g
			order = append(order, key)
		}
		g.Count++
		g.Tasks = append(g.Tasks, TaskLink{ID: w.ID, Name: w.Name})
	}
	out := make([]Group, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	return out
}
