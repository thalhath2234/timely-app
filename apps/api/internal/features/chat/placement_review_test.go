package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"timely-api/internal/features/agent"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

// A reviewed placement reserves a calendar span. If anything lands in that
// span after approval, Apply must send the plan back for review instead of
// silently placing over it.
func TestIntegrationPlacementReviewsCalendarInterval(t *testing.T) {
	db := integrationDB(t)
	moverStart := time.Date(2026, 12, 2, 9, 0, 0, 0, time.UTC)
	// The block stands in for a task that this isolated schema does not hold.
	if err := db.Exec("ALTER TABLE scheduled_blocks DROP CONSTRAINT IF EXISTS fk_tasks_blocks").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.ScheduledBlock{ID: "blk_mover", TaskID: "tsk_mover", UserID: "user-a", StartAt: moverStart, EndAt: moverStart.Add(45 * time.Minute), Source: models.BlockSourceManual}).Error; err != nil {
		t.Fatal(err)
	}
	items := []any{}
	var ranges [][2]time.Time
	writes := 0
	write := func(context.Context, string, json.RawMessage) (any, error) { writes++; return nil, nil }
	catalog := agent.Catalog{
		"get_task": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"task": map[string]any{"id": "tsk_a", "duration": 30}}, nil
		}},
		"get_calendar": {Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			var in struct{ From, To string }
			if err := json.Unmarshal(args, &in); err != nil {
				return nil, err
			}
			from, err := time.Parse(time.RFC3339, in.From)
			if err != nil {
				return nil, err
			}
			to, err := time.Parse(time.RFC3339, in.To)
			if err != nil {
				return nil, err
			}
			ranges = append(ranges, [2]time.Time{from, to})
			return map[string]any{"items": items}, nil
		}},
		"schedule_task": {Call: write},
		"move_block":    {Call: write},
	}
	s := New(db, func(*gorm.DB) agent.Catalog { return catalog }, nil)
	steps := []Step{
		{Tool: "schedule_task", Summary: "Place", Arguments: raw(map[string]any{"taskId": "tsk_a", "start": "2026-12-01T13:00:00+09:00"}), Status: "pending"},
		{Tool: "move_block", Summary: "Move", Arguments: raw(map[string]any{"blockId": "blk_mover", "start": "2026-12-03T09:00:00Z"}), Status: "pending"},
	}
	snaps, err := s.snapshots(context.Background(), db, catalog, "user-a", steps)
	if err != nil {
		t.Fatal(err)
	}
	placeStart := time.Date(2026, 12, 1, 4, 0, 0, 0, time.UTC)
	moveStart := time.Date(2026, 12, 3, 9, 0, 0, 0, time.UTC)
	if len(ranges) != 2 ||
		!ranges[0][0].Equal(placeStart) || !ranges[0][1].Equal(placeStart.Add(30*time.Minute)) ||
		!ranges[1][0].Equal(moveStart) || !ranges[1][1].Equal(moveStart.Add(45*time.Minute)) {
		t.Fatalf("placement spans were not read for review: %v", ranges)
	}
	calendarSnapshots := 0
	for _, snap := range snaps {
		if snap.Tool == "get_calendar" {
			calendarSnapshots++
		}
	}
	if calendarSnapshots != 2 {
		t.Fatalf("expected two calendar snapshots, got %d in %v", calendarSnapshots, snaps)
	}

	c := runFixture(t, db, steps)
	c.Snapshots = snaps
	db.Save(&c)
	items = append(items, map[string]any{"title": "Late conflict"})
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if writes != 0 || !c.ForceReview || c.Phase != "plan" || c.Status != "queued" {
		t.Fatalf("placement applied over a conflict that appeared after review: writes=%d review=%v phase=%s status=%s", writes, c.ForceReview, c.Phase, c.Status)
	}
}
