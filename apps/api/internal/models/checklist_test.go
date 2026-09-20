package models

import "testing"

func TestResolveCreateKind(t *testing.T) {
	scheduled := "2026-09-12T09:00:00Z"

	if got := ResolveCreateKind("", 30, nil, false); got != KindTask {
		t.Fatalf("duration work: %s", got)
	}
	if got := ResolveCreateKind("", 0, &scheduled, false); got != KindReminder {
		t.Fatalf("ping: %s", got)
	}
	if got := ResolveCreateKind("", 0, nil, true); got != KindReminder {
		t.Fatalf("recurring ping: %s", got)
	}
	if got := ResolveCreateKind("", 0, nil, false); got != KindInbox {
		t.Fatalf("title only: %s", got)
	}
	if got := ResolveCreateKind(KindInbox, 45, nil, false); got != KindInbox {
		t.Fatalf("explicit inbox: %s", got)
	}
}

func TestIsReminderIgnoresInbox(t *testing.T) {
	inbox := Task{Kind: KindInbox, Duration: 0}
	if inbox.IsReminder() || !inbox.IsInbox() {
		t.Fatal("inbox is not a reminder")
	}
	reminder := Task{Kind: KindReminder, Duration: 0}
	if !reminder.IsReminder() || reminder.IsInbox() {
		t.Fatal("kind reminder")
	}
	legacy := Task{Duration: 0}
	if !legacy.IsReminder() {
		t.Fatal("legacy duration 0 is still a reminder")
	}
	work := Task{Kind: KindTask, Duration: 30}
	if work.IsReminder() || work.IsInbox() {
		t.Fatal("work task")
	}
}

func TestNormalizeDate(t *testing.T) {
	if got := NormalizeDate("2026-09-12T00:00:00Z"); got != "2026-09-12" {
		t.Fatalf("rfc3339: %s", got)
	}
	if got := NormalizeDate(" 2026-09-12 "); got != "2026-09-12" {
		t.Fatalf("plain: %s", got)
	}
}

func TestChecklistProgressAndClone(t *testing.T) {
	done := "2026-09-12T00:00:00Z"
	list := Checklist{
		{ID: "chk_1", Title: "A", Order: 0, CompletedAt: &done},
		{ID: "chk_2", Title: "B", Order: 1},
	}
	doneCount, total := list.Progress()
	if doneCount != 1 || total != 2 {
		t.Fatalf("progress %d/%d", doneCount, total)
	}
	cloned := list.Clone()
	if cloned[0].ID == list[0].ID {
		t.Fatal("clone should mint new ids")
	}
	if cloned[0].Title != "A" || cloned[1].Title != "B" {
		t.Fatal("clone titles")
	}
}
