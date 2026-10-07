package agent

import (
	"context"
	"testing"
	"time"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/models"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type agendaTasks struct {
	task.TaskService
	tasks []models.Task
}

func (f agendaTasks) List(string, task.TaskFilter) ([]models.Task, error) { return f.tasks, nil }

type agendaCalendar struct{ calendar.Service }

func (agendaCalendar) Range(string, time.Time, time.Time) (*calendar.Response, error) {
	return &calendar.Response{}, nil
}

type agendaSchedule struct {
	schedule.Service
	hours models.WorkingHours
}

func (f agendaSchedule) GetWorkingHours(string, string) (*schedule.WorkingHoursResponse, error) {
	return &schedule.WorkingHoursResponse{WorkingHours: f.hours}, nil
}

func agendaIDs(t *testing.T, out any, key string) map[string]bool {
	t.Helper()
	rows, ok := out.(map[string]any)[key].([]map[string]string)
	if !ok {
		t.Fatalf("%s = %#v", key, out.(map[string]any)[key])
	}
	ids := map[string]bool{}
	for _, row := range rows {
		ids[row["id"]] = true
	}
	return ids
}

// get_agenda judges Unscheduled and Overdue with the shared Work status
// predicates: a future Block does not hide Work from today's Unscheduled list,
// and Overdue Work stays listed even with a Block still ahead (as on /today).
func TestGetAgendaUsesSharedWorkStatus(t *testing.T) {
	hours := models.DefaultWorkingHours("UTC")
	dayStart := task.TodayFor(hours, "", time.Now()).Start()
	onToday := []models.ScheduledBlock{{StartAt: dayStart.Add(time.Hour), EndAt: dayStart.Add(2 * time.Hour)}}
	onLater := []models.ScheduledBlock{{StartAt: dayStart.AddDate(0, 0, 3), EndAt: dayStart.AddDate(0, 0, 3).Add(time.Hour)}}
	past := "2000-01-01"
	work := func(id string) models.Task { return models.Task{ID: id, Name: id, Kind: models.KindTask, Duration: 30} }

	noBlock := work("no_block")
	futureBlock := work("future_block")
	futureBlock.Blocks = onLater
	placedToday := work("placed_today")
	placedToday.Blocks = onToday
	overdueFuture := work("overdue_future_block")
	overdueFuture.Deadline = &past
	overdueFuture.Blocks = onLater
	inbox := models.Task{ID: "inbox", Name: "inbox", Kind: models.KindInbox}
	done := work("done")
	completedAt := "2026-01-01T00:00:00Z"
	done.CompletedAt = &completedAt

	srv := &Server{Deps: Deps{
		Tasks:    agendaTasks{tasks: []models.Task{noBlock, futureBlock, placedToday, overdueFuture, inbox, done}},
		Calendar: agendaCalendar{},
		Schedule: agendaSchedule{hours: hours},
	}}
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1"}}}
	_, out, err := srv.getAgenda(context.Background(), req, rangeIn{Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}

	unscheduled := agendaIDs(t, out, "unscheduled")
	for _, id := range []string{"no_block", "future_block", "overdue_future_block"} {
		if !unscheduled[id] {
			t.Errorf("%s should be Unscheduled today, got %v", id, unscheduled)
		}
	}
	for _, id := range []string{"placed_today", "inbox", "done"} {
		if unscheduled[id] {
			t.Errorf("%s must not be Unscheduled, got %v", id, unscheduled)
		}
	}
	overdue := agendaIDs(t, out, "overdue")
	if len(overdue) != 1 || !overdue["overdue_future_block"] {
		t.Errorf("overdue = %v, want only overdue_future_block", overdue)
	}
}
