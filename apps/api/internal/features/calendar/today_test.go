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

// The server's own zone is named "Local" by Go; a client cannot resolve that, so
// Today reports the server's IANA name or none.
func TestTodayNeverNamesTheServerZoneLocal(t *testing.T) {
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.FixedZone("Local", 9*60*60)

	svc := NewService(todayTasks{}, noEvents{}, func(string) (models.WorkingHours, error) { return models.WorkingHours{}, nil })
	for _, tz := range []string{"", "Local"} {
		t.Setenv("TZ", "Asia/Tokyo")
		got, err := svc.Today("usr_1", "", tz)
		if err != nil {
			t.Fatal(err)
		}
		if got.Timezone != "Asia/Tokyo" {
			t.Fatalf("timezone for %q = %q, want the server's IANA name", tz, got.Timezone)
		}
	}
	t.Setenv("TZ", "")
	got, err := svc.Today("usr_1", "", "")
	if err != nil || got.Timezone == "Local" {
		t.Fatalf("timezone = %q (err %v), want an IANA name or none", got.Timezone, err)
	}
}

// Ticking off today's occurrence of a repeating reminder counts it in Done
// without marking the series itself done.
func TestTodayCountsTickedOccurrenceAsDone(t *testing.T) {
	zone := "Asia/Tokyo"
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 6, 0, 0, 0, loc)
	ticked := today.Add(time.Hour)
	trash := models.Task{
		ID:   "tsk_trash",
		Name: "Throw away trash",
		Kind: models.KindReminder,
		Recurrence: &models.RecurrenceRule{
			ID:         "rr_trash",
			RRule:      "FREQ=DAILY",
			Dtstart:    today.AddDate(0, 0, -2),
			Timezone:   zone,
			Exceptions: []models.RecurrenceException{{OriginalStart: today, CompletedAt: &ticked}},
		},
	}

	svc := NewService(todayTasks{tasks: []models.Task{trash}}, noEvents{}, func(string) (models.WorkingHours, error) {
		return models.DefaultWorkingHours(zone), nil
	})
	got, err := svc.Today("usr_1", "", zone)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.CompletedToday) != 1 || got.CompletedToday[0].ID != "tsk_trash" {
		t.Fatalf("completedToday = %v, want the ticked reminder once", got.CompletedToday)
	}
	if got.CompletedToday[0].IsCompleted() {
		t.Fatal("the series came back done; only today's occurrence was ticked")
	}
	if len(got.Items) != 1 || got.Items[0].CompletedAt == nil {
		t.Fatalf("items = %v, want today's occurrence marked done", got.Items)
	}
}
