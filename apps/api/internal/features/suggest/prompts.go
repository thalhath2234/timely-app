package suggest

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// Example prompts [98]. The assistant's empty chat shows four example
// prompts. Code writes candidates from the current project's own state
// (its name, its biggest task, what is late or blocked); Jev scores which
// would help most right now. Without a project or a key, screens keep their
// fixed examples.

const maxPrompts = 4

// Prompt is an example the person can send as it is.
type Prompt struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// PromptSuggestions are examples for the empty chat.
type PromptSuggestions struct {
	Available bool     `json:"available"`
	LogID     string   `json:"logId,omitempty"`
	Project   string   `json:"project,omitempty"`
	Prompts   []Prompt `json:"prompts"`
}

func (s *Service) prompts(c *echo.Context) error {
	var in struct {
		ProjectID string `json:"projectId"`
		Timezone  string `json:"timezone"`
	}
	if err := c.Bind(&in); err != nil || len(in.ProjectID) > 80 || len(in.Timezone) > 64 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), personalBudget)
	defer cancel()
	out, err := s.Prompts(ctx, user(c), in.ProjectID, in.Timezone, time.Now())
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

type projectState struct {
	ID, Title                     string
	Open, Done, Overdue, Blocked  int
	Biggest, NextDue              string
	BiggestMinutes, NextDueInDays int
	NextDuePlanned                bool
}

// Prompts picks example prompts for a project: the one given, else the
// project the person worked on most recently.
func (s *Service) Prompts(ctx context.Context, userID, projectID, timezone string, now time.Time) (PromptSuggestions, error) {
	out := PromptSuggestions{Prompts: []Prompt{}}
	if ok, _ := s.decide.Status(ctx, userID); !ok {
		return out, nil
	}
	out.Available = true
	// The person's day: due today is not overdue in their evening.
	hours, err := schedule.NewRepository(s.db.WithContext(ctx)).GetWorkingHours(userID)
	if err != nil {
		hours = models.WorkingHours{}
	}
	p, ok := s.promptProject(ctx, userID, projectID, task.TodayFor(hours, timezone, now).Now())
	if !ok {
		return out, nil
	}
	out.Project = p.Title
	cands := promptCandidates(p)
	list := make([]map[string]string, 0, len(cands))
	questions := map[string]decide.Question{}
	for i, c := range cands {
		key := fmt.Sprintf("p%d", i+1)
		list = append(list, map[string]string{"prompt": key, "text": c.Text})
		questions[key] = decide.Score(fmt.Sprintf("How useful would sending example prompt %s to the assistant be for this person right now, given the project's state?", key),
			"Not useful: it does not fit the project's state", "A little useful", "Useful", "Very useful: it is what they most likely need next")
	}
	state := map[string]any{"project": p.words(), "examples": list}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "chat_prompts", State: state, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	type scored struct{ i, level int }
	var picks []scored
	for i := range cands {
		// Score confidences run low, so the level is read at any confidence.
		if level, ok := a.Level(fmt.Sprintf("p%d", i+1), 0); ok && level >= 1 {
			picks = append(picks, scored{i, level})
		}
	}
	sort.SliceStable(picks, func(x, y int) bool { return picks[x].level > picks[y].level })
	used := map[int]bool{}
	for _, pk := range picks {
		if len(out.Prompts) < maxPrompts {
			out.Prompts = append(out.Prompts, cands[pk.i])
			used[pk.i] = true
		}
	}
	// Fewer than four fit well: the rest are filled in the code's order.
	for i := 0; i < len(cands) && len(out.Prompts) < maxPrompts; i++ {
		if !used[i] {
			out.Prompts = append(out.Prompts, cands[i])
		}
	}
	return out, nil
}

func (s *Service) promptProject(ctx context.Context, userID, projectID string, now time.Time) (projectState, bool) {
	db := s.db.WithContext(ctx)
	var p projectState
	q := `SELECT p.id, p.title FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ?`
	var row struct{ ID, Title string }
	if projectID != "" {
		db.Raw(q+` AND p.id = ?`, userID, projectID).Scan(&row)
	}
	if row.ID == "" {
		db.Raw(q+` AND EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.completed_at IS NULL)
			ORDER BY (SELECT MAX(t.updated_at) FROM tasks t WHERE t.project_id = p.id) DESC NULLS LAST LIMIT 1`, userID).Scan(&row)
	}
	if row.ID == "" {
		return p, false
	}
	p.ID, p.Title = row.ID, row.Title
	day := now.Format("2006-01-02")
	// Counts scan into their own struct: Scan resets the fields it does not
	// return.
	var counts struct{ Open, Done, Overdue, Blocked int }
	db.Raw(`SELECT
		COUNT(*) FILTER (WHERE completed_at IS NULL) AS open,
		COUNT(*) FILTER (WHERE completed_at >= ?) AS done,
		COUNT(*) FILTER (WHERE completed_at IS NULL AND deadline IS NOT NULL AND deadline < ?) AS overdue,
		COUNT(*) FILTER (WHERE completed_at IS NULL AND blocked_by_id IS NOT NULL AND EXISTS (
			SELECT 1 FROM tasks b WHERE b.id = tasks.blocked_by_id AND b.completed_at IS NULL)) AS blocked
		FROM tasks WHERE project_id = ? AND user_id = ? AND kind = ?`, now.AddDate(0, 0, -14), day, p.ID, userID, models.KindTask).Scan(&counts)
	p.Open, p.Done, p.Overdue, p.Blocked = counts.Open, counts.Done, counts.Overdue, counts.Blocked
	var big models.Task
	if db.Select("name", "duration").Where("project_id = ? AND user_id = ? AND kind = ? AND completed_at IS NULL", p.ID, userID, models.KindTask).
		Order("duration DESC NULLS LAST").First(&big).Error == nil {
		p.Biggest, p.BiggestMinutes = big.Name, big.Duration
	}
	var next models.Task
	if db.Select("id", "name", "deadline").Where("project_id = ? AND user_id = ? AND kind = ? AND completed_at IS NULL AND deadline >= ?", p.ID, userID, models.KindTask, day).
		Order("deadline").First(&next).Error == nil && next.Deadline != nil {
		p.NextDue = next.Name
		if d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(*next.Deadline), now.Location()); err == nil {
			start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			// Rounded: a day across a clock change is 23 or 25 hours.
			p.NextDueInDays = int(math.Round(d.Sub(start).Hours() / 24))
		}
		var n int64
		db.Table("scheduled_blocks").Where("task_id = ? AND end_at > ?", next.ID, now).Count(&n)
		p.NextDuePlanned = n > 0
	}
	return p, true
}

// words describes the project for Jev, with numbers already counted.
func (p projectState) words() []string {
	out := []string{
		fmt.Sprintf("project “%s”", clip(p.Title, 100)),
		fmt.Sprintf("%s open, %d finished in the last two weeks", countWords(p.Open, "task"), p.Done),
		fmt.Sprintf("%d overdue, %d waiting on other work", p.Overdue, p.Blocked),
	}
	if p.Biggest != "" {
		out = append(out, fmt.Sprintf("largest open task: “%s” (%d minutes)", clip(p.Biggest, 100), p.BiggestMinutes))
	}
	if p.NextDue != "" {
		planned := "no time planned for it"
		if p.NextDuePlanned {
			planned = "time planned for it"
		}
		out = append(out, fmt.Sprintf("next deadline: “%s”, due %s, %s", clip(p.NextDue, 100), dueWords(p.NextDueInDays), planned))
	}
	return out
}

// promptCandidates writes the examples that fit the project's state.
func promptCandidates(p projectState) []Prompt {
	name := clip(p.Title, 60)
	out := []Prompt{
		{"next", "Next step", fmt.Sprintf("What is the next step for %s?", name)},
		{"status", "Catch up", fmt.Sprintf("Summarise where %s stands: what's done, what's open and what's late.", name)},
	}
	if p.Open > 1 {
		out = append(out, Prompt{"plan_week", "Plan the week", fmt.Sprintf("Plan the next week of %s: spread its open tasks across my free time.", name)})
	}
	if p.Overdue > 0 {
		out = append(out, Prompt{"overdue", "Fix late work", fmt.Sprintf("Reschedule the overdue tasks in %s to realistic dates.", name)})
	}
	if p.Blocked > 0 {
		out = append(out, Prompt{"blocked", "Unblock it", fmt.Sprintf("What is blocking %s, and what should I do first?", name)})
	}
	if p.Biggest != "" && p.BiggestMinutes >= 120 {
		out = append(out, Prompt{"breakdown", "Break it down", fmt.Sprintf("Break “%s” into smaller steps with estimates.", clip(p.Biggest, 80))})
	}
	if p.NextDue != "" && !p.NextDuePlanned {
		out = append(out, Prompt{"find_time", "Find time", fmt.Sprintf("Find time before it's due for “%s”.", clip(p.NextDue, 80))})
	}
	out = append(out,
		Prompt{"brief", "Write a brief", fmt.Sprintf("Write a one-page brief doc for %s with goals, scope and open questions.", name)},
		Prompt{"budget", "Track costs", fmt.Sprintf("Create a budget sheet for %s with Item, Cost and Paid columns.", name)},
		Prompt{"day", "Plan my day", "Help me plan today."},
	)
	return out
}
