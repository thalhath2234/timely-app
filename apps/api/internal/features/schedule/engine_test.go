package schedule

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

func testHours() models.WorkingHours {
	return models.DefaultWorkingHours("UTC")
}

func TestPlanScoresUrgentBeforeLow(t *testing.T) {
	from := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 2)
	low := Candidate{ID: "low", Name: "low", DurationMinutes: 60, Priority: models.PriorityLow, CreatedAt: "2026-01-01"}
	low.Rank = ScoreTask(ScoreInput{Priority: low.Priority, Now: from})
	urgent := Candidate{ID: "urg", Name: "urg", DurationMinutes: 60, Priority: models.PriorityUrgent, CreatedAt: "2026-01-02"}
	urgent.Rank = ScoreTask(ScoreInput{Priority: urgent.Priority, Now: from})
	result := Plan(PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		Candidates: []Candidate{low, urgent},
	})
	if len(result.Proposals) != 2 {
		t.Fatalf("proposals %d", len(result.Proposals))
	}
	if result.Proposals[0].TaskID != "urg" {
		t.Fatalf("wanted urgent first, got %s", result.Proposals[0].TaskID)
	}
}

func TestPlanContiguousSkipsSplit(t *testing.T) {
	from := time.Date(2026, 9, 14, 16, 0, 0, 0, time.UTC) // Monday 16:00, 60 min left
	to := from.AddDate(0, 0, 3)
	result := Plan(PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		Candidates: []Candidate{{
			ID: "long", Name: "long", DurationMinutes: 9 * 60, Contiguous: true, MinChunkMinutes: 15,
		}},
	})
	if len(result.Skipped) != 1 || result.Skipped[0].Reason != ReasonContiguous {
		t.Fatalf("expected contiguous skip, got %+v", result.Skipped)
	}
}

func TestPlanPreferredWindow(t *testing.T) {
	from := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 1)
	result := Plan(PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		Candidates: []Candidate{{
			ID: "am", Name: "am", DurationMinutes: 30, MinChunkMinutes: 15,
			PreferredWindows: []models.PreferredWindow{{Start: "09:00", End: "10:00"}},
		}},
	})
	if len(result.Proposals) != 1 {
		t.Fatalf("proposals %+v skipped %+v", result.Proposals, result.Skipped)
	}
	if result.Proposals[0].Blocks[0].Start.Hour() != 9 {
		t.Fatalf("start %s", result.Proposals[0].Blocks[0].Start)
	}
}

func TestApplyIdempotentShape(t *testing.T) {
	from := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 2)
	input := PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		Candidates: []Candidate{{ID: "a", Name: "a", DurationMinutes: 45, MinChunkMinutes: 15}},
	}
	first := Plan(input)
	second := Plan(input)
	if len(first.Proposals) != 1 || len(second.Proposals) != 1 {
		t.Fatal(first, second)
	}
	if !first.Proposals[0].Blocks[0].Start.Equal(second.Proposals[0].Blocks[0].Start) {
		t.Fatal("preview not stable")
	}
}

func TestScoreOverdueBeatsFocus(t *testing.T) {
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	yesterday := now.AddDate(0, 0, -1)
	overdue := ScoreTask(ScoreInput{Deadline: &yesterday, Now: now})
	focus := ScoreTask(ScoreInput{TodayFocus: true, Now: now})
	if overdue.Score <= focus.Score {
		t.Fatalf("overdue %d focus %d", overdue.Score, focus.Score)
	}
}
