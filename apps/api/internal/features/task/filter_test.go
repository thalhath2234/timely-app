package task

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

func TestApplyTaskFilterByWorkspaceAndText(t *testing.T) {
	wsA := "ws_a"
	wsB := "ws_b"
	open := false
	tasks := []models.Task{
		{ID: "tsk_1", Name: "Haircut", WorkspaceID: &wsA, Duration: 30},
		{ID: "tsk_2", Name: "Taxes", WorkspaceID: &wsB, Description: "file return", Duration: 45},
		{ID: "tsk_3", Name: "Done thing", WorkspaceID: &wsA, CompletedAt: str("2026-01-01T00:00:00Z"), Duration: 15},
		{ID: "tsk_4", Name: "Call dentist", Duration: 0},
	}

	got := applyTaskFilter(tasks, TaskFilter{WorkspaceIDs: []string{wsA}, Completed: &open, Limit: 50})
	if len(got) != 1 || got[0].ID != "tsk_1" {
		t.Fatalf("workspace+open filter: got %#v", ids(got))
	}

	got = applyTaskFilter(tasks, TaskFilter{Text: "file", Limit: 50})
	if len(got) != 1 || got[0].ID != "tsk_2" {
		t.Fatalf("text filter: got %#v", ids(got))
	}

	got = applyTaskFilter(tasks, TaskFilter{Limit: 50})
	if len(got) != 3 {
		t.Fatalf("default hides reminders: got %#v", ids(got))
	}

	onlyReminders := true
	got = applyTaskFilter(tasks, TaskFilter{Reminders: &onlyReminders, Limit: 50})
	if len(got) != 1 || got[0].ID != "tsk_4" {
		t.Fatalf("reminders=true: got %#v", ids(got))
	}

	inbox := models.Task{ID: "tsk_inbox", Name: "Buy milk", Kind: models.KindInbox, Duration: 0}
	parent := models.Task{ID: "tsk_parent", Name: "Parent", Kind: models.KindTask, Duration: 30}
	more := append(tasks, inbox, parent)
	got = applyTaskFilter(more, TaskFilter{Limit: 50})
	for _, item := range got {
		if item.ID == "tsk_inbox" {
			t.Fatalf("default list should hide inbox: %#v", ids(got))
		}
	}

	inboxOnly := true
	got = applyTaskFilter(more, TaskFilter{Inbox: &inboxOnly, Limit: 50})
	if len(got) != 1 || got[0].ID != "tsk_inbox" {
		t.Fatalf("inbox filter: %#v", ids(got))
	}
}

func TestIsOverdueUsesDeadlineAndMissedSchedule(t *testing.T) {
	now := time.Date(2026, 9, 11, 11, 43, 0, 0, time.Local)
	yesterday := now.AddDate(0, 0, -1)
	due := yesterday.Format("2006-01-02")

	missed := models.Task{
		ID: "tsk_missed", Name: "Missed block", Duration: 30,
		Blocks: []models.ScheduledBlock{{
			StartAt: yesterday,
			EndAt:   yesterday.Add(30 * time.Minute),
		}},
	}
	pastDue := models.Task{ID: "tsk_due", Name: "Past deadline", Duration: 30, Deadline: str(due)}
	stillOnCalendar := models.Task{
		ID: "tsk_today", Name: "Today", Duration: 30,
		Deadline: str(due),
		Blocks: []models.ScheduledBlock{{
			StartAt: now,
			EndAt:   now.Add(30 * time.Minute),
		}},
	}
	open := models.Task{ID: "tsk_open", Name: "Unscheduled", Duration: 30}
	done := models.Task{
		ID: "tsk_done", Name: "Done", Duration: 30, Deadline: str(due),
		CompletedAt: str("2026-09-10T00:00:00Z"),
	}

	if !IsOverdue(missed, now) {
		t.Fatal("yesterday's unfinished block should be overdue")
	}
	if !IsOverdue(pastDue, now) {
		t.Fatal("past deadline with no remaining time should be overdue")
	}
	if !IsOverdue(stillOnCalendar, now) {
		t.Fatal("a past deadline is overdue even if work is still on today's calendar")
	}
	if IsOverdue(open, now) {
		t.Fatal("unscheduled open work is not overdue")
	}
	if IsOverdue(done, now) {
		t.Fatal("completed tasks are not overdue")
	}

	wantOverdue := true
	got := applyTaskFilter([]models.Task{missed, pastDue, stillOnCalendar, open, done}, TaskFilter{Overdue: &wantOverdue, Limit: 50})
	if len(got) != 3 {
		t.Fatalf("overdue filter: got %#v", ids(got))
	}
}

func str(v string) *string { return &v }

func ids(tasks []models.Task) []string {
	out := make([]string, len(tasks))
	for i, t := range tasks {
		out[i] = t.ID
	}
	return out
}
