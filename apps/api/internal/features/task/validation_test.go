package task

import (
	"strings"
	"testing"

	"timely-api/internal/models"
)

func TestNormalizeNameRejectsBlankAndOversized(t *testing.T) {
	if _, err := normalizeName("   "); err == nil {
		t.Fatal("whitespace-only name should be rejected")
	}
	if _, err := normalizeName(strings.Repeat("x", maxNameLength+1)); err == nil {
		t.Fatal("oversized name should be rejected, not truncated")
	}
	got, err := normalizeName("  Write report  ")
	if err != nil || got != "Write report" {
		t.Fatalf("expected trimmed name, got %q (%v)", got, err)
	}
}

func TestValidateDuration(t *testing.T) {
	if err := validateDuration(-1); err == nil {
		t.Fatal("negative duration should fail")
	}
	if err := validateDuration(100_000_000); err == nil {
		t.Fatal("absurd duration should fail")
	}
	if err := validateDuration(90); err != nil {
		t.Fatalf("90 minutes should pass: %v", err)
	}
}

func TestValidateDateRange(t *testing.T) {
	start := "2026-09-20"
	due := "2026-09-15"
	if err := validateDateRange(&start, &due); err == nil {
		t.Fatal("start after deadline should fail")
	}
	sameDay := "2026-09-15T09:00:00Z"
	if err := validateDateRange(&sameDay, &due); err != nil {
		t.Fatalf("same-day start should pass: %v", err)
	}
	if err := validateDateRange(nil, &due); err != nil {
		t.Fatalf("missing start should pass: %v", err)
	}
}

func TestValidatePreferredWindows(t *testing.T) {
	inverted := models.PreferredWindows{{Start: "17:00", End: "09:00"}}
	if err := validatePreferredWindows(inverted); err == nil {
		t.Fatal("inverted window should fail")
	}
	bad := models.PreferredWindows{{Start: "nine", End: "17:00"}}
	if err := validatePreferredWindows(bad); err == nil {
		t.Fatal("unparseable window should fail")
	}
	ok := models.PreferredWindows{{Start: "09:00", End: "12:00"}}
	if err := validatePreferredWindows(ok); err != nil {
		t.Fatalf("valid window should pass: %v", err)
	}
}

func TestAssertReminderPing(t *testing.T) {
	ping := "2026-09-15T09:00:00Z"
	before := &models.Task{ID: "tsk_1", Kind: models.KindTask, Duration: 30}

	// Converting to a reminder without a time is invalid.
	updates := map[string]any{"kind": models.KindReminder}
	if err := assertReminderPing(before, TaskUpdate{}, updates); err == nil {
		t.Fatal("task→reminder without scheduledOn should fail")
	}
	// With a time it is fine.
	if err := assertReminderPing(before, TaskUpdate{ScheduledOn: &ping}, updates); err != nil {
		t.Fatalf("task→reminder with scheduledOn should pass: %v", err)
	}

	// Clearing the ping on an existing reminder is invalid.
	reminder := &models.Task{ID: "tsk_2", Kind: models.KindReminder, ScheduledOn: &ping}
	empty := ""
	if err := assertReminderPing(reminder, TaskUpdate{ScheduledOn: &empty}, map[string]any{}); err == nil {
		t.Fatal("clearing scheduledOn on a reminder should fail")
	}

	// A repeat rule counts as a ping.
	rule := &models.RecurrenceInput{RRule: "FREQ=DAILY", Dtstart: ping}
	noTime := &models.Task{ID: "tsk_3", Kind: models.KindReminder}
	if err := assertReminderPing(noTime, TaskUpdate{RecurrenceSet: true, Recurrence: rule}, map[string]any{}); err != nil {
		t.Fatalf("reminder with recurrence should pass: %v", err)
	}

	// Non-reminders are untouched.
	if err := assertReminderPing(before, TaskUpdate{}, map[string]any{}); err != nil {
		t.Fatalf("work task should not be checked: %v", err)
	}
}

type cycleRepo struct {
	TaskRepository
	tasks []models.Task
}

func (r cycleRepo) GetAllTaskByUser(string) ([]models.Task, error) { return r.tasks, nil }

func ptr(s string) *string { return &s }

func TestAssertNoDependencyCycle(t *testing.T) {
	// Existing graph: B waits on A (B.blockedBy = A); C waits on B.
	repo := cycleRepo{tasks: []models.Task{
		{ID: "A"},
		{ID: "B", BlockedByID: ptr("A")},
		{ID: "C", BlockedByID: ptr("B")},
		{ID: "D"},
	}}
	svc := &taskService{taskRepo: repo}

	// A waiting on C would close A→C→B→A.
	if err := svc.assertNoDependencyCycle("usr", "A", "C"); err == nil {
		t.Fatal("indirect cycle should be rejected")
	}
	// A waiting on B would close A→B→A.
	if err := svc.assertNoDependencyCycle("usr", "A", "B"); err == nil {
		t.Fatal("two-node cycle should be rejected")
	}
	// D waiting on C is a plain chain.
	if err := svc.assertNoDependencyCycle("usr", "D", "C"); err != nil {
		t.Fatalf("acyclic edge should pass: %v", err)
	}
	if err := svc.assertNoDependencyCycle("usr", "A", "A"); err == nil {
		t.Fatal("self reference should be rejected")
	}
}
