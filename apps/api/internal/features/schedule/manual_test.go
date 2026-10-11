package schedule

import (
	"errors"
	"testing"
	"time"

	"timely-api/internal/features/event"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// planRepo, planTasks and planEvents feed plan() fixed rows; anything else
// they are asked panics through the nil embedded interface.
type planRepo struct{ Repository }

func (planRepo) GetWorkingHours(string) (models.WorkingHours, error) {
	return models.WorkingHours{}, nil
}
func (planRepo) GetSettings(string) (models.ScheduleSettings, error) {
	return models.ScheduleSettings{}, nil
}
func (planRepo) LatestRevision(string) (*models.ScheduleRevision, error) {
	return nil, errors.New("none")
}

type planTasks struct {
	task.TaskRepository
	rows []models.Task
}

func (p planTasks) GetAllTaskByUser(string) ([]models.Task, error) { return p.rows, nil }

type planEvents struct{ event.EventRepository }

func (planEvents) ListInRange(string, time.Time, time.Time) ([]models.Event, error) { return nil, nil }

func planFor(t *testing.T, rows []models.Task, req PlanRequest) (*PlanResponse, []string) {
	t.Helper()
	s := &service{repo: planRepo{}, tasks: planTasks{rows: rows}, events: planEvents{}}
	req.Timezone = "UTC"
	plan, _, replaceManual, _, err := s.plan("usr", req)
	if err != nil {
		t.Fatal(err)
	}
	return plan, replaceManual
}

func manualTask(id string, blocks ...models.ScheduledBlock) models.Task {
	ws := "ws"
	return models.Task{ID: id, Name: id, Kind: models.KindTask, Duration: 30, WorkspaceID: &ws, Blocks: blocks}
}

func proposed(plan *PlanResponse, id string) bool {
	for _, p := range plan.Proposals {
		if p.TaskID == id && len(p.Blocks) > 0 {
			return true
		}
	}
	return false
}

func skippedFor(plan *PlanResponse, id string) string {
	for _, s := range plan.Skipped {
		if s.TaskID == id {
			return s.Reason
		}
	}
	return ""
}

// Replacing hand-placed time (a missed block's "Move") re-plans a task whose
// only Manual block is over, without asking Placement to delete that block;
// future unlocked Manual time is replaced, and locked time ahead pins the task.
func TestIncludeManualKeepsPastAndLockedBlocks(t *testing.T) {
	now := time.Now().UTC()
	past := models.ScheduledBlock{StartAt: now.Add(-3 * time.Hour), EndAt: now.Add(-2 * time.Hour), Source: models.BlockSourceManual}
	ahead := models.ScheduledBlock{StartAt: now.Add(72 * time.Hour), EndAt: now.Add(73 * time.Hour), Source: models.BlockSourceManual}
	locked := ahead
	locked.Locked = true
	pastLocked := past
	pastLocked.Locked = true

	rows := []models.Task{
		manualTask("missed", past),
		manualTask("moved", past, ahead),
		manualTask("locked", past, locked),
		manualTask("history", pastLocked),
	}
	plan, replace := planFor(t, rows, PlanRequest{IncludeManual: true})

	for _, id := range []string{"missed", "moved", "history"} {
		if !proposed(plan, id) {
			t.Fatalf("%s was not re-planned (skipped %q)", id, skippedFor(plan, id))
		}
	}
	if proposed(plan, "locked") || skippedFor(plan, "locked") != ReasonLocked {
		t.Fatalf("a task with locked time ahead was planned (skipped %q)", skippedFor(plan, "locked"))
	}
	if len(replace) != 1 || replace[0] != "moved" {
		t.Fatalf("replace Manual blocks of %v, want only the task with unlocked time ahead", replace)
	}

	// Without IncludeManual hand-placed Work stays pinned, as before.
	plan, replace = planFor(t, rows, PlanRequest{})
	for _, id := range []string{"missed", "moved", "locked", "history"} {
		if proposed(plan, id) {
			t.Fatalf("%s was planned without IncludeManual", id)
		}
	}
	if len(replace) != 0 {
		t.Fatalf("replace %v without IncludeManual", replace)
	}
}
