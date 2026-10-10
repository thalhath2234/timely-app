package suggest

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// Screen tips [95]. Code keeps a short catalog of tips per screen, each
// with a condition on the person's own counts; Jev picks the one that fits
// best right now, or none. A dismissed tip never comes back.

var tipScreens = []string{"today", "tasks", "calendar", "inbox"}

// tipMin is the confidence a tip pick needs. Every offered tip is true (code
// checked its facts), so Jev only ranks them, and several often fit about
// as well: its confidence in the single best one runs low. Agreeing in both
// option orders is what makes the pick reliable; a tip is also one tap to
// dismiss.
const tipMin = 0.3

// ScreenTip is one line of advice for the open screen. Action names a place the
// client knows how to open: inbox, calendar, settings_schedule or
// settings_workspaces.
type ScreenTip struct {
	Key    string `json:"key"`
	Text   string `json:"text"`
	Action string `json:"action,omitempty"`
}

// TipSuggestion is the tip for a screen, if any.
type TipSuggestion struct {
	Available bool       `json:"available"`
	LogID     string     `json:"logId,omitempty"`
	Tip       *ScreenTip `json:"tip"`
}

// tipFacts are the counts the tips depend on.
type tipFacts struct {
	Open, Overdue, DueSoonUnplanned, NoDeadline, Blocked, Focus int
	Inbox, InboxOld, Labels, Views, Recurring                   int
	HasHours                                                    bool
}

type screenTip struct {
	key, screen, action string
	webOnly             bool
	when                func(f tipFacts) bool
	text                func(f tipFacts) string
}

func fixed(s string) func(tipFacts) string { return func(tipFacts) string { return s } }

var tipCatalog = []screenTip{
	{key: "today_focus", screen: "today", when: func(f tipFacts) bool { return f.Focus == 0 && f.Open > 0 },
		text: fixed("Pick up to three tasks for today's Focus, so Today shows what matters first.")},
	{key: "today_overdue", screen: "today", when: func(f tipFacts) bool { return f.Overdue > 0 },
		text: func(f tipFacts) string {
			them := "them"
			if f.Overdue == 1 {
				them = "it"
			}
			return fmt.Sprintf("%s past the deadline. Ask the assistant to move %s to realistic dates.", isAre(f.Overdue, "task is", "tasks are"), them)
		}},
	{key: "today_plan", screen: "today", action: "calendar", when: func(f tipFacts) bool { return f.DueSoonUnplanned > 0 },
		text: func(f tipFacts) string {
			return fmt.Sprintf("%s due this week with no time planned. Auto-schedule can place them in your free time.", isAre(f.DueSoonUnplanned, "task is", "tasks are"))
		}},
	{key: "today_inbox", screen: "today", action: "inbox", when: func(f tipFacts) bool { return f.Inbox >= 5 },
		text: func(f tipFacts) string {
			return fmt.Sprintf("%d items are waiting in the Inbox. Clarifying each one takes about a minute.", f.Inbox)
		}},
	{key: "tasks_deadlines", screen: "tasks", when: func(f tipFacts) bool { return f.NoDeadline >= 10 && f.NoDeadline*2 >= f.Open },
		text: func(f tipFacts) string {
			return fmt.Sprintf("%d of your %d open tasks have no deadline. Add deadlines so Auto-schedule knows what comes first.", f.NoDeadline, f.Open)
		}},
	{key: "tasks_views", screen: "tasks", webOnly: true, when: func(f tipFacts) bool { return f.Views <= 2 },
		text: fixed("Save the filters you use often as a view. Search finds it when you ask for it, like “what needs attention”.")},
	{key: "tasks_labels", screen: "tasks", action: "settings_workspaces", when: func(f tipFacts) bool { return f.Labels == 0 && f.Open > 0 },
		text: fixed("Labels group work across projects, like Waiting or Quick win. Settings can suggest a starter set.")},
	{key: "tasks_bulk", screen: "tasks", when: func(f tipFacts) bool { return f.Open >= 20 },
		text: fixed("To change many tasks at once, ask the assistant, like “move everything about the launch to next week”.")},
	{key: "tasks_blocked", screen: "tasks", when: func(f tipFacts) bool { return f.Blocked > 0 },
		text: func(f tipFacts) string {
			return fmt.Sprintf("%s waiting on other work. Finish the blocker first, and the Dashboard's Highlights card shows why work is stuck.", isAre(f.Blocked, "task is", "tasks are"))
		}},
	{key: "calendar_hours", screen: "calendar", action: "settings_schedule", when: func(f tipFacts) bool { return !f.HasHours },
		text: fixed("Set your working hours, so Auto-schedule only plans inside them.")},
	{key: "calendar_plan", screen: "calendar", when: func(f tipFacts) bool { return f.DueSoonUnplanned > 0 },
		text: func(f tipFacts) string {
			return fmt.Sprintf("Auto-schedule can find time for the %s due this week with no time planned.", countWords(f.DueSoonUnplanned, "task"))
		}},
	{key: "calendar_drag", screen: "calendar", webOnly: true, when: func(tipFacts) bool { return true },
		text: fixed("Drag a task from the side panel onto the calendar to block time for it.")},
	{key: "calendar_recurring", screen: "calendar", when: func(f tipFacts) bool { return f.Recurring == 0 && f.Open > 0 },
		text: fixed("Make repeating work a recurring task, so it appears on its own each time.")},
	{key: "inbox_clarify", screen: "inbox", when: func(f tipFacts) bool { return f.Inbox > 0 },
		text: fixed("Open an item to Clarify it: smart suggestions fill in its kind, project and estimate.")},
	{key: "inbox_twominute", screen: "inbox", when: func(f tipFacts) bool { return f.Inbox > 0 },
		text: fixed("If an item takes under two minutes, do it now and mark it done.")},
	{key: "inbox_old", screen: "inbox", when: func(f tipFacts) bool { return f.InboxOld > 0 },
		text: func(f tipFacts) string {
			return fmt.Sprintf("%s waited more than a week. Drop the ones that no longer matter.", isAre(f.InboxOld, "item has", "items have"))
		}},
	{key: "inbox_capture", screen: "inbox", webOnly: true, when: func(tipFacts) bool { return true },
		text: fixed("Press Ctrl+Shift+J (⌘+Shift+J on a Mac) anywhere to capture a thought without leaving the page.")},
}

func isAre(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

func (s *Service) tip(c *echo.Context) error {
	screen := c.QueryParam("screen")
	if !slices.Contains(tipScreens, screen) {
		return echo.NewHTTPError(400, "Unknown screen")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), personalBudget)
	defer cancel()
	out, err := s.TipFor(ctx, user(c), screen, c.QueryParam("timezone"), c.QueryParam("platform") == "mobile")
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// TipFor picks the tip that fits the screen best right now, or none.
func (s *Service) TipFor(ctx context.Context, userID, screen, timezone string, mobile bool) (TipSuggestion, error) {
	out := TipSuggestion{}
	if ok, _ := s.decide.Status(ctx, userID); !ok {
		return out, nil
	}
	out.Available = true
	dismissed := s.personal(ctx, userID).DismissedTips
	f := s.tipFacts(ctx, userID, timezone)
	var eligible []screenTip
	for _, t := range tipCatalog {
		if t.screen == screen && !(mobile && t.webOnly) && !slices.Contains(dismissed, t.key) && t.when(f) {
			eligible = append(eligible, t)
		}
	}
	if len(eligible) == 0 {
		return out, nil
	}
	opts := []decide.Option{{Name: "none", Description: "None: no tip clearly helps right now"}}
	for _, t := range eligible {
		opts = append(opts, decide.Option{Name: t.key, Description: t.text(f)})
	}
	state := map[string]any{"screen": screen, "device": map[bool]string{true: "phone", false: "computer"}[mobile], "facts": f.words()}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "screen_tip", State: state, Questions: map[string]decide.Question{
		"tip": decide.Choice(fmt.Sprintf("Which one tip would help this person most on the %s screen right now, given their facts?", screen), opts...).Twice(),
	}})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	if key, ok := a.Choice("tip", tipMin); ok && key != "none" {
		for _, t := range eligible {
			if t.key == key {
				out.Tip = &ScreenTip{Key: t.key, Text: t.text(f), Action: t.action}
			}
		}
	}
	return out, nil
}

// words turns the counts into sentences for Jev.
func (f tipFacts) words() []string {
	out := []string{
		countWords(f.Open, "open task"),
		fmt.Sprintf("%d overdue", f.Overdue),
		fmt.Sprintf("%d due this week with no time planned", f.DueSoonUnplanned),
		fmt.Sprintf("%d open tasks without a deadline", f.NoDeadline),
		fmt.Sprintf("%d waiting on other work", f.Blocked),
		fmt.Sprintf("%d in today's Focus", f.Focus),
		fmt.Sprintf("%d Inbox items, %d older than a week", f.Inbox, f.InboxOld),
		fmt.Sprintf("%d labels, %d saved views, %d recurring tasks", f.Labels, f.Views, f.Recurring),
	}
	if f.HasHours {
		out = append(out, "working hours are set")
	} else {
		out = append(out, "working hours are not set")
	}
	return out
}

func (s *Service) tipFacts(ctx context.Context, userID, timezone string) tipFacts {
	var f tipFacts
	db := s.db.WithContext(ctx)
	hours, err := schedule.NewRepository(db).GetWorkingHours(userID)
	if err != nil {
		hours = models.WorkingHours{}
	}
	day := task.TodayFor(hours, timezone, time.Now())
	today, week := day.Date(), day.Now().AddDate(0, 0, 7).Format("2006-01-02")
	// created_at is text (YYYY-MM-DD, or RFC3339 for older rows), so it is
	// compared as text.
	weekAgo := day.Now().AddDate(0, 0, -7).Format("2006-01-02")
	db.Raw(`SELECT
		COUNT(*) FILTER (WHERE kind = ?) AS open,
		COUNT(*) FILTER (WHERE kind = ? AND deadline IS NOT NULL AND deadline < ?) AS overdue,
		COUNT(*) FILTER (WHERE kind = ? AND deadline IS NOT NULL AND deadline >= ? AND deadline <= ?
			AND NOT EXISTS (SELECT 1 FROM scheduled_blocks b WHERE b.task_id = tasks.id AND b.end_at > now())) AS due_soon_unplanned,
		COUNT(*) FILTER (WHERE kind = ? AND deadline IS NULL) AS no_deadline,
		COUNT(*) FILTER (WHERE kind = ? AND today_focus_on = ?) AS focus,
		COUNT(*) FILTER (WHERE kind = ?) AS inbox,
		COUNT(*) FILTER (WHERE kind = ? AND created_at < ?) AS inbox_old
		FROM tasks WHERE user_id = ? AND completed_at IS NULL`,
		models.KindTask, models.KindTask, today, models.KindTask, today, week, models.KindTask, models.KindTask, today,
		models.KindInbox, models.KindInbox, weekAgo, userID).Scan(&f)
	db.Raw(`SELECT COUNT(*) FROM tasks t JOIN tasks b ON b.id = t.blocked_by_id AND b.completed_at IS NULL
		WHERE t.user_id = ? AND t.completed_at IS NULL`, userID).Scan(&f.Blocked)
	db.Raw(`SELECT COUNT(*) FROM lables l JOIN workspaces w ON w.id = l.workspace_id WHERE w.user_id = ?`, userID).Scan(&f.Labels)
	db.Raw(`SELECT COUNT(*) FROM recurrence_rules WHERE user_id = ? AND owner_type = 'task'`, userID).Scan(&f.Recurring)
	db.Raw(`SELECT COALESCE(jsonb_array_length(task_views), 0) FROM configs WHERE user_id = ?`, userID).Scan(&f.Views)
	for _, windows := range hours.Days {
		if len(windows) > 0 {
			f.HasHours = true
		}
	}
	return f
}

func (s *Service) dismissTip(c *echo.Context) error {
	var in struct {
		Key   string `json:"key"`
		LogID string `json:"logId"`
	}
	if err := c.Bind(&in); err != nil || len(in.Key) == 0 || len(in.Key) > 40 || len(in.LogID) > 80 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	known := slices.ContainsFunc(tipCatalog, func(t screenTip) bool { return t.key == in.Key })
	if !known {
		return echo.NewHTTPError(400, "Unknown tip")
	}
	if err := s.dismiss(c.Request().Context(), user(c), in.Key); err != nil {
		return err
	}
	if in.LogID != "" {
		_ = s.decide.Feedback(user(c), in.LogID, false)
	}
	return c.NoContent(204)
}
