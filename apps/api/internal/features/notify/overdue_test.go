package notify

import (
	"testing"
	"time"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// Overdue itself is covered in the task package; these cover what notify adds
// on top: the notification must still match the task's current deadline and
// the task must be schedulable Work.
func TestOverdueTaskCurrent(t *testing.T) {
	deadline := "2026-09-22"
	today := task.TodayAt(time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC), time.UTC)
	open := &models.Task{Kind: "task", Duration: 30, Deadline: &deadline}
	if !overdueTaskCurrent(open, deadline, today) {
		t.Fatal("open task past its deadline should be actionable")
	}

	for _, tc := range []struct {
		name     string
		item     *models.Task
		deadline string
	}{
		{"nil task", nil, deadline},
		{"empty deadline", open, ""},
		{"deadline moved", open, "2026-09-21"},
		{"no work estimate", &models.Task{Kind: "task", Deadline: &deadline}, deadline},
		{"inbox", &models.Task{Kind: "inbox", Duration: 30, Deadline: &deadline}, deadline},
		{"reminder", &models.Task{Kind: "reminder", Deadline: &deadline}, deadline},
		{"completed", &models.Task{Kind: "task", Duration: 30, Deadline: &deadline, CompletedAt: &deadline}, deadline},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if overdueTaskCurrent(tc.item, tc.deadline, today) {
				t.Fatal("task should not produce an overdue action")
			}
		})
	}

	dueToday := "2026-09-23"
	if overdueTaskCurrent(&models.Task{Kind: "task", Duration: 30, Deadline: &dueToday}, dueToday, today) {
		t.Fatal("work due today is not Overdue yet")
	}
}
