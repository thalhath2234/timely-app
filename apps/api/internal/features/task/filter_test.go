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

	got := applyTaskFilter(tasks, TaskFilter{WorkspaceIDs: []string{wsA}, Completed: &open, Limit: 50}, Today{})
	if len(got) != 1 || got[0].ID != "tsk_1" {
		t.Fatalf("workspace+open filter: got %#v", ids(got))
	}

	got = applyTaskFilter(tasks, TaskFilter{Text: "file", Limit: 50}, Today{})
	if len(got) != 1 || got[0].ID != "tsk_2" {
		t.Fatalf("text filter: got %#v", ids(got))
	}

	got = applyTaskFilter(tasks, TaskFilter{Limit: 50}, Today{})
	if len(got) != 3 {
		t.Fatalf("default hides reminders: got %#v", ids(got))
	}

	onlyReminders := true
	got = applyTaskFilter(tasks, TaskFilter{Reminders: &onlyReminders, Limit: 50}, Today{})
	if len(got) != 1 || got[0].ID != "tsk_4" {
		t.Fatalf("reminders=true: got %#v", ids(got))
	}

	inbox := models.Task{ID: "tsk_inbox", Name: "Buy milk", Kind: models.KindInbox, Duration: 0}
	parent := models.Task{ID: "tsk_parent", Name: "Parent", Kind: models.KindTask, Duration: 30}
	more := append(tasks, inbox, parent)
	got = applyTaskFilter(more, TaskFilter{Limit: 50}, Today{})
	for _, item := range got {
		if item.ID == "tsk_inbox" {
			t.Fatalf("default list should hide inbox: %#v", ids(got))
		}
	}

	inboxOnly := true
	got = applyTaskFilter(more, TaskFilter{Inbox: &inboxOnly, Limit: 50}, Today{})
	if len(got) != 1 || got[0].ID != "tsk_inbox" {
		t.Fatalf("inbox filter: %#v", ids(got))
	}
}

func TestApplyTaskFilterOverdueUsesGivenToday(t *testing.T) {
	berlin := mustLocation(t, "Europe/Berlin")
	// 00:30 on Sep 11 in Berlin is still Sep 10 in UTC.
	today := TodayAt(time.Date(2026, 9, 11, 0, 30, 0, 0, berlin), berlin)
	dueYesterdayBerlin := models.Task{ID: "tsk_due", Name: "Due", Duration: 30, Deadline: str("2026-09-10")}
	dueToday := models.Task{ID: "tsk_today", Name: "Today", Duration: 30, Deadline: str("2026-09-11")}
	noDeadline := models.Task{ID: "tsk_open", Name: "Open", Duration: 30}
	done := models.Task{ID: "tsk_done", Name: "Done", Duration: 30, Deadline: str("2026-09-01"), CompletedAt: str("2026-09-02T00:00:00Z")}

	wantOverdue := true
	got := applyTaskFilter([]models.Task{dueYesterdayBerlin, dueToday, noDeadline, done}, TaskFilter{Overdue: &wantOverdue, Limit: 50}, today)
	if len(got) != 1 || got[0].ID != "tsk_due" {
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
