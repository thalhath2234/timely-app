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

// A 30-minute task with only 20 minutes left today and a single-day horizon
// must not be reported as fully placed: the engine books what it can and
// reports the shortfall so the caller can raise a capacity risk.
func TestPlanReportsPartialPlacement(t *testing.T) {
	from := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 14, 17, 0, 0, 0, time.UTC)
	result := Plan(PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		// Occupy 09:00–16:40 so exactly 20 minutes remain.
		Busy:       []Interval{{Start: from, End: time.Date(2026, 9, 14, 16, 40, 0, 0, time.UTC)}},
		Candidates: []Candidate{{ID: "daily", Name: "daily", DurationMinutes: 30, MinChunkMinutes: 15}},
	})
	if len(result.Proposals) != 1 {
		t.Fatalf("expected one partial proposal, got proposals=%+v skipped=%+v", result.Proposals, result.Skipped)
	}
	p := result.Proposals[0]
	if p.RequiredMinutes != 30 || p.ShortfallMinutes == 0 || p.PlacedMinutes+p.ShortfallMinutes != 30 {
		t.Fatalf("expected an explicit shortfall summing to 30, got placed=%d required=%d shortfall=%d", p.PlacedMinutes, p.RequiredMinutes, p.ShortfallMinutes)
	}
	if p.PlacedMinutes < 15 {
		t.Fatalf("partial chunk must still respect the minimum chunk, got %d", p.PlacedMinutes)
	}
}

// With a second day available the leftover must actually be booked, not
// dropped because it is smaller than the minimum chunk.
func TestPlanBooksLeftoverOnNextDay(t *testing.T) {
	from := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 2)
	result := Plan(PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		Busy:       []Interval{{Start: from, End: time.Date(2026, 9, 14, 16, 40, 0, 0, time.UTC)}},
		Candidates: []Candidate{{ID: "daily", Name: "daily", DurationMinutes: 30, MinChunkMinutes: 15}},
	})
	if len(result.Proposals) != 1 {
		t.Fatalf("proposals=%+v skipped=%+v", result.Proposals, result.Skipped)
	}
	p := result.Proposals[0]
	if p.ShortfallMinutes != 0 {
		t.Fatalf("expected no shortfall, got %d", p.ShortfallMinutes)
	}
	if p.PlacedMinutes != p.RequiredMinutes {
		t.Fatalf("placed %d != required %d (must land exactly on the estimate)", p.PlacedMinutes, p.RequiredMinutes)
	}
	if len(p.Blocks) != 2 {
		t.Fatalf("expected the remainder as a second block, got %+v", p.Blocks)
	}
}

// A 2h task with 1h50m left today must not become 1h50m + 15m = 2h05m. The
// engine trims today's chunk to 1h45m so a full 15-minute chunk carries over.
func TestPlanLeftoverNeverOvershoots(t *testing.T) {
	from := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 2)
	result := Plan(PlanInput{
		From: from, To: to, Location: time.UTC, Hours: testHours(),
		Busy:       []Interval{{Start: from, End: time.Date(2026, 9, 14, 15, 10, 0, 0, time.UTC)}},
		Candidates: []Candidate{{ID: "two", Name: "two hours", DurationMinutes: 120, MinChunkMinutes: 15}},
	})
	if len(result.Proposals) != 1 {
		t.Fatalf("proposals=%+v skipped=%+v", result.Proposals, result.Skipped)
	}
	p := result.Proposals[0]
	if p.PlacedMinutes != 120 || p.ShortfallMinutes != 0 {
		t.Fatalf("placed=%d shortfall=%d blocks=%+v", p.PlacedMinutes, p.ShortfallMinutes, p.Blocks)
	}
	for _, block := range p.Blocks {
		if block.Minutes() < 15 {
			t.Fatalf("block shorter than min chunk: %+v", block)
		}
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

func TestCurrentEngineBlocksSkipsCompleted(t *testing.T) {
	now := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	done := now.Format(time.RFC3339)
	tasks := []models.Task{
		{
			ID: "open", Name: "Open work",
			Blocks: []models.ScheduledBlock{{
				Source:  models.BlockSourceEngine,
				StartAt: now,
				EndAt:   now.Add(time.Hour),
			}},
		},
		{
			ID: "done", Name: "Finished", CompletedAt: &done,
			Blocks: []models.ScheduledBlock{{
				Source:  models.BlockSourceEngine,
				StartAt: now,
				EndAt:   now.Add(time.Hour),
			}},
		},
	}
	got := currentEngineBlocks(tasks, nil, now, now.AddDate(0, 0, 1), time.Time{})
	if _, ok := got["done"]; ok {
		t.Fatal("completed tasks must not appear in auto-schedule changes")
	}
	if _, ok := got["open"]; !ok {
		t.Fatal("open engine blocks should still be tracked")
	}
}

// Preview "remove" rows must match what Apply deletes: only candidate tasks,
// never locked blocks, never blocks inside the freeze window.
func TestCurrentEngineBlocksMatchesApplyPredicate(t *testing.T) {
	now := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	engine := func(start time.Time, locked bool) models.ScheduledBlock {
		return models.ScheduledBlock{Source: models.BlockSourceEngine, StartAt: start, EndAt: start.Add(time.Hour), Locked: locked}
	}
	tasks := []models.Task{
		{ID: "A", Name: "In scope", Blocks: []models.ScheduledBlock{engine(now.Add(3*time.Hour), false)}},
		{ID: "B", Name: "Out of scope", Blocks: []models.ScheduledBlock{engine(now.Add(3*time.Hour), false)}},
		{ID: "C", Name: "Locked", Blocks: []models.ScheduledBlock{engine(now.Add(3*time.Hour), true)}},
		{ID: "D", Name: "Frozen", Blocks: []models.ScheduledBlock{engine(now.Add(30*time.Minute), false)}},
	}
	candidates := map[string]bool{"A": true, "C": true, "D": true}
	freezeUntil := now.Add(2 * time.Hour)

	got := currentEngineBlocks(tasks, candidates, now, now.AddDate(0, 0, 1), freezeUntil)
	if _, ok := got["A"]; !ok {
		t.Fatal("candidate engine block should be replaceable")
	}
	if _, ok := got["B"]; ok {
		t.Fatal("non-candidate task must not be reported as removed in a scoped preview")
	}
	if _, ok := got["C"]; ok {
		t.Fatal("locked block is never deleted by Apply, so preview must not list it")
	}
	if _, ok := got["D"]; ok {
		t.Fatal("block inside the freeze window is never deleted by Apply")
	}
}

func TestDiffPlanRemoveUsesTaskName(t *testing.T) {
	now := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	current := map[string][]BlockOut{
		"tsk_raw": {{Start: now, End: now.Add(time.Hour)}},
	}
	changes := diffPlan(current, nil, nil, map[string]string{"tsk_raw": "Explainable preview"})
	if len(changes) != 1 || changes[0].TaskName != "Explainable preview" {
		t.Fatalf("wanted titled remove, got %+v", changes)
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

func TestScoreUrgencyNudgesLessThanPriority(t *testing.T) {
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	level := func(n int) *int { return &n }
	critical := ScoreTask(ScoreInput{Priority: models.PriorityMedium, Now: now, Urgency: level(4)})
	canWait := ScoreTask(ScoreInput{Priority: models.PriorityMedium, Now: now, Urgency: level(0)})
	normal := ScoreTask(ScoreInput{Priority: models.PriorityMedium, Now: now, Urgency: level(2)})
	unknown := ScoreTask(ScoreInput{Priority: models.PriorityMedium, Now: now})
	if critical.Score != unknown.Score+12 || canWait.Score != unknown.Score-12 || normal.Score != unknown.Score {
		t.Fatalf("critical %d can wait %d normal %d unknown %d", critical.Score, canWait.Score, normal.Score, unknown.Score)
	}
	if critical.Reasons[len(critical.Reasons)-1] != "sounds urgent" || canWait.Reasons[len(canWait.Reasons)-1] != "sounds like it can wait" {
		t.Fatalf("reasons %v %v", critical.Reasons, canWait.Reasons)
	}
	high := ScoreTask(ScoreInput{Priority: models.PriorityHigh, Now: now, Urgency: level(0)})
	if high.Score <= ScoreTask(ScoreInput{Priority: models.PriorityMedium, Now: now}).Score {
		t.Fatalf("a priority step must still lead: high %d", high.Score)
	}
}

func TestOrderKeepsCloseGroupMembersTogether(t *testing.T) {
	cand := func(id string, score int, group string) Candidate {
		return Candidate{ID: id, GroupKey: group, Rank: Rank{Score: score}, CreatedAt: id}
	}
	got := order([]Candidate{
		cand("a", 50, "g"), cand("b", 48, ""), cand("c", 45, "g"), cand("d", 30, "g"), cand("e", 44, ""),
	}, map[string]*Candidate{})
	ids := ""
	for _, c := range got {
		ids += c.ID
	}
	// c is within 10 of a and moves up next to it; d is 20 below and stays.
	if ids != "acbed" {
		t.Fatalf("order %s", ids)
	}
}
