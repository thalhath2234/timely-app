package agent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/features/task"
	"timely-api/internal/models"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestPrepareCreateTaskDefaultsWorkDuration(t *testing.T) {
	explicitDuration := 45
	zeroDuration := 0
	for _, tc := range []struct {
		name         string
		in           createTaskIn
		wantDuration int
	}{
		{"duration missing", createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", StatusID: "todo", Description: "From Bugs doc"}, 30},
		{"scheduled work missing duration", createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", ScheduleAt: "2026-09-28T12:00:00Z"}, 30},
		{"explicit duration", createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", Duration: &explicitDuration}, 45},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := prepareCreateTask(tc.in)
			if err != nil || got.Kind != models.KindTask || got.Duration == nil || *got.Duration != tc.wantDuration {
				t.Fatalf("prepared task = %+v, error = %v, want %d-minute work", got, err, tc.wantDuration)
			}
		})
	}
	// A missing workspace is task.Create's rule; prepareCreateTask leaves it alone.
	if got, err := prepareCreateTask(createTaskIn{Name: "Bug"}); err != nil || got.Duration == nil || *got.Duration != 30 {
		t.Fatalf("prepared task = %+v, error = %v, want 30-minute work", got, err)
	}
	_, err := prepareCreateTask(createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", Duration: &zeroDuration})
	if err == nil || !strings.Contains(err.Error(), "duration") {
		t.Fatalf("error = %v, want explicit zero duration rejected", err)
	}
}

func TestPrepareCreateTaskRejectsInboxAndKeepsReminder(t *testing.T) {
	for _, kind := range []string{models.KindInbox, "unknown"} {
		_, err := prepareCreateTask(createTaskIn{Name: "Thought", Kind: kind})
		if err == nil {
			t.Fatalf("kind %q should be rejected", kind)
		}
	}
	in, err := prepareCreateTask(createTaskIn{Name: "Ping", Kind: models.KindReminder, ScheduleAt: "2026-09-28T12:00:00Z"})
	if err != nil || in.Kind != models.KindReminder || in.Duration != nil {
		t.Fatalf("reminder = %+v, %v", in, err)
	}
}

func TestCreateTaskErrorAsksForWorkspace(t *testing.T) {
	got := taskError(task.ErrWorkspaceRequired)
	if got == nil || !strings.Contains(got.Error(), "ask the user which workspace") {
		t.Fatalf("error = %v, want workspace prompt", got)
	}
	other := errors.New("boom")
	if taskError(other) != other {
		t.Fatal("other errors must pass through")
	}
}

type completeTasks struct {
	task.TaskService
	row     *models.Task
	updates []task.TaskUpdate
}

func (f *completeTasks) WithActor(string) task.TaskService { return f }
func (f *completeTasks) GetForUser(string, string) (*models.Task, error) {
	return f.row, nil
}
func (f *completeTasks) Update(_, _ string, update task.TaskUpdate) (*models.Task, error) {
	f.updates = append(f.updates, update)
	return f.row, nil
}

// complete_task on a series row would end every occurrence, so it points the
// model at edit_task_occurrence instead.
func TestCompleteTaskRejectsRecurringTasks(t *testing.T) {
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1"}}}
	series := &completeTasks{row: &models.Task{ID: "tsk_1", Name: "Standup", Recurrence: &models.RecurrenceRule{RRule: "FREQ=DAILY"}}}
	srv := &Server{Deps: Deps{Tasks: series}}
	_, _, err := srv.completeTask(context.Background(), req, taskIDIn{TaskID: "tsk_1"})
	if err == nil || !strings.Contains(err.Error(), "edit_task_occurrence") {
		t.Fatalf("error = %v, want a pointer to edit_task_occurrence", err)
	}
	if len(series.updates) != 0 {
		t.Fatalf("the series row was updated: %+v", series.updates)
	}

	oneOff := &completeTasks{row: &models.Task{ID: "tsk_2", Name: "Write"}}
	srv = &Server{Deps: Deps{Tasks: oneOff}}
	if _, _, err := srv.completeTask(context.Background(), req, taskIDIn{TaskID: "tsk_2"}); err != nil {
		t.Fatalf("complete one-off: %v", err)
	}
	if len(oneOff.updates) != 1 || oneOff.updates[0].CompletedAt == nil {
		t.Fatalf("updates = %+v, want one completedAt write", oneOff.updates)
	}
}
