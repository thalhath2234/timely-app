package calendar

import (
	"testing"
	"time"
	"timely-api/internal/features/event"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

type todayTasks struct {
	task.TaskRepository
	tasks []models.Task
}

func (f todayTasks) GetAllTaskByUser(string) ([]models.Task, error) { return f.tasks, nil }

type noEvents struct{ event.EventRepository }

func (noEvents) ListInRange(string, time.Time, time.Time) ([]models.Event, error) { return nil, nil }

// Overdue is judged on the Working hours date, not the client's: the client
// zone is far enough ahead that its date is already tomorrow.
func TestTodayJudgesOverdueInWorkingHoursZone(t *testing.T) {
	pacific := "Pacific/Honolulu"
	loc, err := time.LoadLocation(pacific)
	if err != nil {
		t.Fatal(err)
	}
	hoursToday := time.Now().In(loc).Format("2006-01-02")
	yesterday := time.Now().In(loc).AddDate(0, 0, -1).Format("2006-01-02")
	dueYesterday := models.Task{ID: "yesterday", Kind: models.KindTask, Duration: 30, Deadline: &yesterday}
	dueToday := models.Task{ID: "today", Kind: models.KindTask, Duration: 30, Deadline: &hoursToday}

	svc := NewService(todayTasks{tasks: []models.Task{dueYesterday, dueToday}}, noEvents{}, func(string) (models.WorkingHours, error) {
		return models.DefaultWorkingHours(pacific), nil
	})
	// Pacific/Kiritimati is 24h ahead of Honolulu, so its date is Honolulu's tomorrow.
	got, err := svc.Today("usr_1", "", "Pacific/Kiritimati")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Overdue) != 1 || got.Overdue[0].ID != "yesterday" {
		t.Fatalf("overdue = %v, want only the task due before the Working hours date", got.Overdue)
	}
}
