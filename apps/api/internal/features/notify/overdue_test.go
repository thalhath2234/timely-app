package notify

import (
	"testing"
	"timely-api/internal/models"
)

func TestOverdueTaskCurrent(t *testing.T) {
	deadline := "2026-09-22"
	today := "2026-09-23"
	open := &models.Task{Kind: "task", Duration: 30, Deadline: &deadline}
	if !overdueTaskCurrent(open, deadline, today) {
		t.Fatal("open task past its deadline should be actionable")
	}

	completed := *open
	completedAt := "2026-09-22T12:00:00Z"
	completed.CompletedAt = &completedAt
	if overdueTaskCurrent(&completed, deadline, today) {
		t.Fatal("completed task must not be actionable")
	}

	for _, tc := range []struct {
		name     string
		item     *models.Task
		deadline string
		today    string
	}{
		{"due today", open, deadline, deadline},
		{"deadline moved", open, "2026-09-21", today},
		{"inbox", &models.Task{Kind: "inbox", Deadline: &deadline}, deadline, today},
		{"reminder", &models.Task{Kind: "reminder", Deadline: &deadline}, deadline, today},
		{"no work estimate", &models.Task{Kind: "task", Deadline: &deadline}, deadline, today},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if overdueTaskCurrent(tc.item, tc.deadline, tc.today) {
				t.Fatal("task should not produce an overdue action")
			}
		})
	}
}
