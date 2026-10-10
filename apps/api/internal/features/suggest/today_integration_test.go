package suggest

import (
	"context"
	"testing"
	"time"

	"timely-api/internal/features/schedule"
	"timely-api/internal/models"
)

// fixedSchedule ranks and finds free time from fixed lists.
type fixedSchedule struct {
	schedule.Service
	db     func() []models.Task
	free   []schedule.Interval
	ranked int
}

func (f *fixedSchedule) Rank(string, string) ([]schedule.RankedTask, error) {
	f.ranked++
	var out []schedule.RankedTask
	for _, t := range f.db() {
		out = append(out, schedule.RankedTask{Task: t, Reasons: []string{"open work"}})
	}
	return out, nil
}

func (f *fixedSchedule) FreeTime(string, time.Time, time.Time, string) ([]schedule.Interval, error) {
	return f.free, nil
}

func prefsTable(t *testing.T, w world, goals, deep string) {
	t.Helper()
	must(t, w.db.Exec(`CREATE TABLE IF NOT EXISTS agent_provider_settings (user_id text PRIMARY KEY, decision_goals jsonb NOT NULL DEFAULT '[]', deep_work_time text NOT NULL DEFAULT '')`).Error)
	must(t, w.db.Exec(`INSERT INTO agent_provider_settings (user_id, decision_goals, deep_work_time) VALUES (?, ?::jsonb, ?)`, w.user, goals, deep).Error)
}

func score(level float64) map[string]any {
	return map[string]any{"type": "score", "score": level, "confidence": 0.9}
}

func TestIntegrationTodayFocusGapGoalsAndTraits(t *testing.T) {
	w := newWorld(t)
	prefsTable(t, w, `["Launch the shop","Get fit"]`, "morning")
	now := time.Now()
	tax := w.task(t, "File the tax return", func(task *models.Task) {
		task.Deadline = ptr(now.AddDate(0, 0, -2).Format("2006-01-02"))
		task.Duration = 60
	})
	product := w.task(t, "Write product descriptions", func(task *models.Task) { task.Duration = 120; task.Description = "For the shop launch" })
	landlord := w.task(t, "Email the landlord about the boiler", func(task *models.Task) { task.Duration = 15 })
	rent := w.task(t, "Ask the landlord about the rent", func(task *models.Task) { task.Duration = 15 })
	w.task(t, "Already in focus", func(task *models.Task) { task.TodayFocusOn = ptr(now.Format("2006-01-02")) })
	w.task(t, "Waiting on the quote", func(task *models.Task) { task.BlockedByID = &tax.ID })

	list := func() []models.Task {
		var tasks []models.Task
		w.db.Where("user_id = ?", w.user).Order("created_at, name").Find(&tasks)
		order := map[string]int{tax.ID: 0, product.ID: 1, landlord.ID: 2, rent.ID: 3}
		out := make([]models.Task, 6)
		extra := 4
		for _, task := range tasks {
			if i, ok := order[task.ID]; ok {
				out[i] = task
			} else {
				out[extra] = task
				extra++
			}
		}
		return out
	}
	// t1..t4 in Rank order after the two excluded tasks drop out.
	gapStart := now.Add(time.Hour).Truncate(time.Minute)
	sched := &fixedSchedule{db: list, free: []schedule.Interval{
		{Start: gapStart.Add(-30 * time.Minute), End: gapStart.Add(-20 * time.Minute)}, // too short
		{Start: gapStart, End: gapStart.Add(45 * time.Minute)},
	}}
	jev := &jevStub{answers: map[string]any{
		"effort_t1": choice("admin"), "urgency_t1": score(4),
		"effort_t2": choice("creative"), "urgency_t2": score(2),
		"group_t3": choice("t4"),
		"focus_t1": score(3), "focus_t2": score(2), "focus_t3": score(1), "focus_t4": score(3),
		"goal_t2": choice("g1"),
		"gap":     choice("t3"),
	}}
	s := New(w.db, jev.service(t), nil)
	s.schedule = sched
	out, err := s.Today(context.Background(), w.user, "UTC", now)
	must(t, err)
	if !out.Available || len(out.Focus) != 3 || out.Focus[0].TaskID != tax.ID || out.Focus[1].TaskID != rent.ID || out.Focus[2].TaskID != product.ID {
		t.Fatalf("focus %+v", out.Focus)
	}
	if out.Focus[2].Goal != "Launch the shop" || out.Focus[0].EffortKind != "admin" {
		t.Fatalf("focus details %+v", out.Focus)
	}
	if len(out.Goals) != 2 || out.Goals[0].Count != 1 || out.Goals[1].Count != 0 {
		t.Fatalf("goals %+v", out.Goals)
	}
	if out.Gap == nil || !out.Gap.Start.Equal(gapStart) || out.Gap.Minutes != 45 || out.Gap.Task == nil || out.Gap.Task.ID != landlord.ID || out.Gap.Task.Minutes != 15 {
		t.Fatalf("gap %+v", out.Gap)
	}

	// Traits are stored with their hash; the landlord tasks share a group.
	var stored []models.Task
	must(t, w.db.Where("id IN ?", []string{tax.ID, landlord.ID, rent.ID, product.ID}).Find(&stored).Error)
	byID := map[string]models.Task{}
	for _, task := range stored {
		byID[task.ID] = task
	}
	if got := byID[tax.ID]; got.EffortKind != "admin" || got.Urgency == nil || *got.Urgency != 4 || got.TraitsHash != traitsHash(got) {
		t.Fatalf("tax traits %+v", got)
	}
	key := min(landlord.ID, rent.ID)
	if byID[landlord.ID].GroupKey != key || byID[rent.ID].GroupKey != key || byID[tax.ID].GroupKey != "" {
		t.Fatalf("groups %q %q %q", byID[landlord.ID].GroupKey, byID[rent.ID].GroupKey, byID[tax.ID].GroupKey)
	}
	if _, ok := jev.asked(1)["focus_t1"]; !ok {
		t.Fatal("the second call should be the Today call")
	}

	// Asked again with nothing changed: one Today call, no traits call.
	before := len(jev.requests)
	_, err = s.Today(context.Background(), w.user, "UTC", now.Add(10*time.Minute))
	must(t, err)
	if len(jev.requests) != before+1 {
		t.Fatalf("expected only the Today call, got %d more", len(jev.requests)-before)
	}
	if _, ok := jev.asked(before)["effort_t1"]; ok {
		t.Fatal("asked traits for unchanged tasks")
	}

	// An edited task is read again.
	must(t, w.db.Model(&models.Task{}).Where("id = ?", tax.ID).Update("name", "File the tax return today").Error)
	before = len(jev.requests)
	_, err = s.Today(context.Background(), w.user, "UTC", now.Add(20*time.Minute))
	must(t, err)
	q := jev.asked(before)
	if _, ok := q["effort_t1"]; !ok {
		t.Fatal("the edited task was not read again")
	}
	if _, ok := q["effort_t2"]; ok {
		t.Fatal("an unchanged task was read again")
	}
}

func TestIntegrationTaskHintsSplitAndDeepTime(t *testing.T) {
	w := newWorld(t)
	prefsTable(t, w, `[]`, "morning")
	long := w.task(t, "Write the thesis chapter", func(task *models.Task) { task.Duration = 180; task.Description = "Draft the methods section" })
	short := w.task(t, "Pay the gas bill", func(task *models.Task) { task.Duration = 15 })
	jev := &jevStub{answers: map[string]any{"effort_task": choice("deep"), "urgency_task": score(2), "stretch": yesNo(0.95), "outcome": yesNo(0.9)}}
	s := New(w.db, jev.service(t), nearby{})
	out, err := s.TaskHints(context.Background(), w.user, long.ID)
	must(t, err)
	if !out.OneSitting || out.EffortKind != "deep" || out.PreferredTime != "morning" || out.PreferredWindow == nil || out.PreferredWindow.Start != "06:00" {
		t.Fatalf("%+v", out)
	}
	var stored models.Task
	must(t, w.db.First(&stored, "id = ?", long.ID).Error)
	if stored.EffortKind != "deep" || stored.TraitsHash == "" {
		t.Fatalf("traits not stored: %+v", stored)
	}
	// A short task is not asked about splitting, and stored traits are not asked again.
	_, err = s.TaskHints(context.Background(), w.user, short.ID)
	must(t, err)
	if _, ok := jev.asked(1)["stretch"]; ok {
		t.Fatal("asked to split a 15-minute task")
	}
	_, err = s.TaskHints(context.Background(), w.user, long.ID)
	must(t, err)
	if _, ok := jev.asked(2)["effort_task"]; ok {
		t.Fatal("asked traits again for unchanged words")
	}
}

func TestIntegrationTriagePicksAStep(t *testing.T) {
	w := newWorld(t)
	task := w.task(t, "Send the invoice", func(task *models.Task) { task.Duration = 30 })
	jev := &jevStub{answers: map[string]any{"next": choice("extend")}}
	s := New(w.db, jev.service(t), nil)
	if got := s.Triage(context.Background(), w.user, &task, "overdue", 3); got != "extend" {
		t.Fatalf("overdue step %q", got)
	}
	if jev.requests[0].State["daysPastDeadline"] != float64(3) {
		t.Fatalf("state %+v", jev.requests[0].State)
	}
	if got := s.Triage(context.Background(), w.user, &task, "other", 0); got != "" {
		t.Fatalf("unknown kind gave %q", got)
	}
}
