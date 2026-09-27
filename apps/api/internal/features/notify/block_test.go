package notify

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

func TestBlockStillScheduledRejectsAMovedBlock(t *testing.T) {
	end := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	item := &models.Task{
		Kind: models.KindTask,
		Blocks: []models.ScheduledBlock{{
			StartAt: end.Add(-time.Hour),
			EndAt:   end,
		}},
	}
	if !blockStillScheduled(item, end.Format(time.RFC3339), true) {
		t.Fatal("matching end should still notify")
	}
	moved := end.Add(2 * time.Hour).Format(time.RFC3339)
	if blockStillScheduled(item, moved, true) {
		t.Fatal("a stale end must not notify")
	}
	if blockStillScheduled(item, end.Format(time.RFC3339), false) {
		t.Fatal("end must not satisfy a start check")
	}
}

func TestBlockStillScheduledKeepsRepeatingWork(t *testing.T) {
	item := &models.Task{
		Kind:       models.KindTask,
		Recurrence: &models.RecurrenceRule{RRule: "FREQ=DAILY"},
	}
	when := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC).Format(time.RFC3339)
	if !blockStillScheduled(item, when, true) {
		t.Fatal("repeating work has no stored block per occurrence")
	}
}
