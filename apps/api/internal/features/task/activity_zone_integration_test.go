package task

import (
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"
)

// Activity text names times in the person's Working hours zone, not the
// server's: 09:00 UTC reads 6:00 PM for someone in Tokyo.
func TestIntegrationActivityTimesUseWorkingHoursZone(t *testing.T) {
	f := newKindFixture(t)
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.UTC
	if err := f.db.Create(&models.Config{ID: "cfg_activity_zone", UserID: kindTestUser, WorkingHours: models.DefaultWorkingHours("Asia/Tokyo")}).Error; err != nil {
		t.Fatal(err)
	}

	reminder, err := f.svc.Create(f.board(models.KindReminder, 0, f.id("2026-10-14T08:00:00Z")), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Update(kindTestUser, reminder.ID, TaskUpdate{ScheduledOn: f.id("2026-10-14T09:00:00Z")}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Update(kindTestUser, reminder.ID, TaskUpdate{CompletedAt: f.id("2026-10-14T08:53:00Z")}); err != nil {
		t.Fatal(err)
	}

	entries, err := f.svc.ListActivity(kindTestUser, reminder.ID)
	if err != nil {
		t.Fatal(err)
	}
	byField := map[string]models.TaskActivity{}
	for _, entry := range entries {
		if entry.Field != nil {
			byField[*entry.Field] = entry
		}
	}
	scheduled, done := byField["scheduledOn"], byField["completedAt"]
	if scheduled.Message != "scheduled this task for Oct 14, 2026 6:00 PM" {
		t.Errorf("scheduled message = %q, want 6:00 PM Tokyo time", scheduled.Message)
	}
	if scheduled.OldValue == nil || *scheduled.OldValue != "Oct 14, 2026 5:00 PM" || scheduled.NewValue == nil || *scheduled.NewValue != "Oct 14, 2026 6:00 PM" {
		t.Errorf("scheduled values = %q -> %q, want Tokyo times", deref(scheduled.OldValue), deref(scheduled.NewValue))
	}
	if done.NewValue == nil || *done.NewValue != "Oct 14, 2026 5:53 PM" {
		t.Errorf("completed value = %q, want Oct 14, 2026 5:53 PM", deref(done.NewValue))
	}
	for _, entry := range entries {
		if strings.Contains(entry.Message, "9:00 AM") || strings.Contains(entry.Message, "8:53 AM") {
			t.Errorf("activity %q names a UTC time", entry.Message)
		}
	}
}
