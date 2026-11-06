package calendar

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

// A placed block of a repeating task is that day's occurrence, so ticking the
// occurrence off has to show on the block too, not only on reminders.
func TestCollectMarksCompletedOccurrenceBlocks(t *testing.T) {
	done := time.Date(2026, 10, 20, 7, 0, 0, 0, time.UTC)
	monday := time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	tuesday := monday.AddDate(0, 0, 1)
	work := models.Task{
		ID:       "tsk_1",
		Name:     "Stretch",
		Kind:     models.KindTask,
		Duration: 30,
		Recurrence: &models.RecurrenceRule{
			ID:       "rr_1",
			RRule:    "FREQ=DAILY",
			Dtstart:  monday,
			Timezone: "UTC",
			Exceptions: []models.RecurrenceException{
				{OriginalStart: tuesday, CompletedAt: &done},
			},
		},
		Blocks: []models.ScheduledBlock{
			{ID: "blk_mon", StartAt: monday, EndAt: monday.Add(30 * time.Minute), OccurrenceStart: &monday},
			{ID: "blk_tue", StartAt: tuesday, EndAt: tuesday.Add(30 * time.Minute), OccurrenceStart: &tuesday},
		},
	}

	items, err := Collect([]models.Task{work}, nil, monday.Add(-time.Hour), tuesday.Add(time.Hour), models.WorkingHours{})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]*time.Time{}
	for _, item := range items {
		if item.Kind != KindTaskOccurrence {
			t.Fatalf("block %s kind = %q, want %q", item.ID, item.Kind, KindTaskOccurrence)
		}
		got[item.ID] = item.CompletedAt
	}
	if got["blk_mon"] != nil {
		t.Fatalf("Monday's block is done at %v, want open", got["blk_mon"])
	}
	if got["blk_tue"] == nil || !got["blk_tue"].Equal(done) {
		t.Fatalf("Tuesday's block completedAt = %v, want %v", got["blk_tue"], done)
	}
}
