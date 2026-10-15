package schedule

import (
	"testing"
	"time"

	"timely-api/internal/features/event"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// The person planned Wednesday, then took Wednesday's working hours away at
// lunchtime and ran Auto-schedule: the morning's engine time had already gone
// by. Placing the tasks again on Thursday moves that time instead of leaving
// each task on both days. Engine time from an earlier day stays as Missed
// history, hand-placed time stays, and Undo brings the morning back.
func TestIntegrationAutoScheduleMovesTimeMissedEarlierToday(t *testing.T) {
	db, place, ws := freeTimeFixture(t)
	svc := NewService(NewRepository(db), task.NewTaskRepository(db), event.NewEventRepository(db), place)
	at := func(day, hour int) time.Time { return time.Date(2026, 12, day, hour, 0, 0, 0, time.UTC) } // 8 Tue, 9 Wed, 10 Thu
	user := freeTimeUser
	newTask := func(name string) *models.Task {
		w := &models.Task{ID: utils.NewTaskID(), Name: name, Kind: models.KindTask, Duration: 60, UserID: &user, WorkspaceID: &ws}
		if err := db.Create(w).Error; err != nil {
			t.Fatal(err)
		}
		return w
	}
	block := func(w *models.Task, start time.Time, source string) {
		b := models.ScheduledBlock{ID: utils.NewBlockID(), TaskID: w.ID, UserID: user, StartAt: start, EndAt: start.Add(time.Hour), Source: source}
		if err := db.Create(&b).Error; err != nil {
			t.Fatal(err)
		}
	}
	morning := newTask("Morning")
	block(morning, at(9, 9), models.BlockSourceEngine)
	afternoon := newTask("Afternoon")
	block(afternoon, at(9, 15), models.BlockSourceEngine)
	yesterday := newTask("Yesterday")
	block(yesterday, at(8, 9), models.BlockSourceEngine)
	byHand := newTask("By hand")
	block(byHand, at(9, 10), models.BlockSourceManual)

	hours := models.DefaultWorkingHours("UTC")
	hours.Days["wed"] = []models.WorkingWindow{}
	if _, err := svc.UpdateWorkingHours(freeTimeUser, hours); err != nil {
		t.Fatal(err)
	}
	from := at(9, 13).Format(time.RFC3339) // Wednesday lunchtime
	to := at(12, 0).Format(time.RFC3339)
	req := PlanRequest{From: &from, To: &to, Timezone: "UTC", IncludeManual: true}

	preview, err := svc.DryRun(freeTimeUser, req)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range preview.Proposals {
		if p.TaskID == morning.ID && p.Change != "move" {
			t.Fatalf("preview calls the morning task %q, want move", p.Change)
		}
	}
	if _, err := svc.Apply(freeTimeUser, req); err != nil {
		t.Fatal(err)
	}

	days := func(w *models.Task) map[string]int {
		var blocks []models.ScheduledBlock
		if err := db.Where("task_id = ?", w.ID).Find(&blocks).Error; err != nil {
			t.Fatal(err)
		}
		out := map[string]int{}
		for _, b := range blocks {
			out[b.StartAt.UTC().Weekday().String()+" "+b.Source]++
		}
		return out
	}
	for _, w := range []*models.Task{morning, afternoon} {
		if got := days(w); len(got) != 1 || got["Thursday engine"] != 1 {
			t.Fatalf("%s blocks after apply = %v, want only Thursday", w.Name, got)
		}
	}
	if got := days(yesterday); got["Tuesday engine"] != 1 || got["Thursday engine"] != 1 {
		t.Fatalf("yesterday's missed time = %v, want it kept beside the new slot", got)
	}
	if got := days(byHand); got["Wednesday manual"] != 1 {
		t.Fatalf("hand-placed time earlier today = %v, want it kept", got)
	}
	assertScheduledOn(t, db, morning.ID, at(10, 0))

	if _, err := svc.Undo(freeTimeUser); err != nil {
		t.Fatal(err)
	}
	if got := days(morning); len(got) != 1 || got["Wednesday engine"] != 1 {
		t.Fatalf("morning blocks after undo = %v, want Wednesday back", got)
	}
	if got := days(afternoon); len(got) != 1 || got["Wednesday engine"] != 1 {
		t.Fatalf("afternoon blocks after undo = %v, want Wednesday back", got)
	}
}

// assertScheduledOn checks the task's scheduled_on mirrors a block on day.
func assertScheduledOn(t *testing.T, db *gorm.DB, taskID string, day time.Time) {
	t.Helper()
	var row models.Task
	if err := db.Where("id = ?", taskID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.ScheduledOn == nil {
		t.Fatal("scheduled_on is empty")
	}
	parsed, err := time.Parse(time.RFC3339, *row.ScheduledOn)
	if err != nil {
		t.Fatalf("scheduled_on %q: %v", *row.ScheduledOn, err)
	}
	if y, m, d := parsed.UTC().Date(); y != day.Year() || m != day.Month() || d != day.Day() {
		t.Fatalf("scheduled_on = %s, want %s", parsed, day.Format("2006-01-02"))
	}
}
