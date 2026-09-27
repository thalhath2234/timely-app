package placement

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

func TestBusySkipsRemindersAndIncludesAllDayHours(t *testing.T) {
	loc := time.UTC
	from := time.Date(2026, 9, 28, 0, 0, 0, 0, loc)
	to := from.Add(24 * time.Hour)
	hours := models.DefaultWorkingHours("UTC")

	ping := "2026-09-28T10:00:00Z"
	reminder := models.Task{ID: "tsk_r", Kind: models.KindReminder, Duration: 0, ScheduledOn: &ping}
	work := models.Task{
		ID: "tsk_w", Kind: models.KindTask, Duration: 30,
		Blocks: []models.ScheduledBlock{{
			StartAt: time.Date(2026, 9, 28, 11, 0, 0, 0, loc),
			EndAt:   time.Date(2026, 9, 28, 11, 30, 0, 0, loc),
			Source:  models.BlockSourceManual,
		}},
	}
	allDay := models.Event{
		ID: "evt_a", AllDay: true,
		StartAt: time.Date(2026, 9, 28, 0, 0, 0, 0, loc),
		EndAt:   time.Date(2026, 9, 29, 0, 0, 0, 0, loc),
	}

	got := Busy([]models.Task{reminder, work}, []models.Event{allDay}, from, to, hours)
	if len(got) < 2 {
		t.Fatalf("expected work + all-day windows, got %d", len(got))
	}
	var sawWork, sawAllDay bool
	for _, item := range got {
		if item.TaskID == "tsk_w" {
			sawWork = true
		}
		if item.EventID == "evt_a" {
			sawAllDay = true
			if item.Start.Hour() != 9 || item.End.Hour() != 17 {
				t.Fatalf("all-day should fill 09:00–17:00, got %s–%s", item.Start, item.End)
			}
		}
		if item.TaskID == "tsk_r" {
			t.Fatal("reminder pings are not busy time")
		}
	}
	if !sawWork || !sawAllDay {
		t.Fatalf("missing occupancy: work=%v all-day=%v", sawWork, sawAllDay)
	}
}

func TestBusyDoesNotUseReminderScheduledOn(t *testing.T) {
	from := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	ping := "2026-09-28T10:00:00Z"
	got := Busy([]models.Task{{
		ID: "tsk_r", Kind: models.KindReminder, Duration: 0, ScheduledOn: &ping,
	}}, nil, from, to, models.DefaultWorkingHours("UTC"))
	if len(got) != 0 {
		t.Fatalf("got %d occupancy rows for a reminder", len(got))
	}
}

func TestPlaceLocationKeepsEventZoneWhenHoursAreMissing(t *testing.T) {
	jst := time.FixedZone("JST", 9*3600)
	event := &models.Event{AllDay: true, StartAt: time.Date(2026, 9, 27, 0, 0, 0, 0, jst)}
	if got := placeLocation(models.WorkingHours{}, event); got != jst {
		t.Fatalf("missing hours should keep the event zone, got %v", got)
	}
	hours := models.WorkingHours{Timezone: "America/New_York", Days: map[string][]models.WorkingWindow{
		"mon": {{Start: "09:00", End: "17:00"}},
	}}
	if got := placeLocation(hours, event); got.String() != "America/New_York" {
		t.Fatalf("saved working hours should win, got %v", got)
	}
}
