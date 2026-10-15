package event

import (
	"testing"
	"time"

	"timely-api/internal/models"
)

// Moving a one-off Event's start carries its Blocks along, so the calendar
// (which draws the Blocks) shows the new time.
func TestShiftBlocksMovesEveryBlockByTheStartChange(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	blocks := []models.ScheduledBlock{
		{StartAt: at, EndAt: at.Add(30 * time.Minute)},
		{StartAt: at.Add(2 * time.Hour), EndAt: at.Add(3 * time.Hour)},
	}
	shiftBlocks(blocks, 24*time.Hour)
	if got, want := blocks[0].StartAt, at.Add(24*time.Hour); !got.Equal(want) {
		t.Fatalf("first block start = %v, want %v", got, want)
	}
	if got, want := blocks[0].EndAt.Sub(blocks[0].StartAt), 30*time.Minute; got != want {
		t.Fatalf("first block length = %v, want %v", got, want)
	}
	if got, want := blocks[1].StartAt, at.Add(26*time.Hour); !got.Equal(want) {
		t.Fatalf("second block start = %v, want %v", got, want)
	}
}

func TestShiftBlocksLeavesBlocksAloneWithoutAStartChange(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	blocks := []models.ScheduledBlock{{StartAt: at, EndAt: at.Add(time.Hour)}}
	shiftBlocks(blocks, 0)
	if !blocks[0].StartAt.Equal(at) || !blocks[0].EndAt.Equal(at.Add(time.Hour)) {
		t.Fatalf("block moved: %v–%v", blocks[0].StartAt, blocks[0].EndAt)
	}
}
