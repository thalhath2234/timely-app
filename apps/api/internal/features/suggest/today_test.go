package suggest

import (
	"testing"
	"time"

	"timely-api/internal/models"
)

// Work with a block still ahead (later today or another day) is already
// booked, so the free gap never suggests it a second time.
func TestPlannedAheadKeepsBookedWorkOutOfTheGap(t *testing.T) {
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	block := func(start time.Time) models.ScheduledBlock {
		return models.ScheduledBlock{StartAt: start, EndAt: start.Add(30 * time.Minute)}
	}
	for _, tc := range []struct {
		name   string
		blocks []models.ScheduledBlock
		want   bool
	}{
		{"no blocks", nil, false},
		{"only past blocks", []models.ScheduledBlock{block(now.Add(-2 * time.Hour))}, false},
		{"later today", []models.ScheduledBlock{block(now.Add(3 * time.Hour))}, true},
		{"another day", []models.ScheduledBlock{block(now.Add(-time.Hour)), block(now.AddDate(0, 0, 2))}, true},
		{"in progress", []models.ScheduledBlock{block(now.Add(-10 * time.Minute))}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := plannedAhead(models.Task{Duration: 30, Blocks: tc.blocks}, now); got != tc.want {
				t.Fatalf("plannedAhead = %v, want %v", got, tc.want)
			}
		})
	}
}
