package task

import (
	"errors"
	"testing"
	"time"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func block(start time.Time, minutes int) models.ScheduledBlock {
	return models.ScheduledBlock{StartAt: start, EndAt: start.Add(time.Duration(minutes) * time.Minute)}
}

func TestIsOverdueUsesDeadlineAndMissedSchedule(t *testing.T) {
	now := time.Date(2026, 9, 11, 11, 43, 0, 0, time.UTC)
	today := TodayAt(now, time.UTC)
	yesterday := now.AddDate(0, 0, -1)
	due := yesterday.Format("2006-01-02")

	missed := models.Task{ID: "tsk_missed", Name: "Missed block", Duration: 30, Blocks: []models.ScheduledBlock{block(yesterday, 30)}}
	pastDue := models.Task{ID: "tsk_due", Name: "Past deadline", Duration: 30, Deadline: str(due)}
	stillOnCalendar := models.Task{ID: "tsk_today", Name: "Today", Duration: 30, Deadline: str(due), Blocks: []models.ScheduledBlock{block(now, 30)}}
	open := models.Task{ID: "tsk_open", Name: "Unscheduled", Duration: 30}
	done := models.Task{ID: "tsk_done", Name: "Done", Duration: 30, Deadline: str(due), CompletedAt: str("2026-09-10T00:00:00Z")}

	if IsOverdue(missed, today) {
		t.Fatal("missed blocks without a deadline are not Overdue")
	}
	if !IsMissed(missed, today) {
		t.Fatal("yesterday's unfinished block should be Missed")
	}
	if !IsOverdue(pastDue, today) {
		t.Fatal("past deadline with no remaining time should be overdue")
	}
	if !IsOverdue(stillOnCalendar, today) {
		t.Fatal("a past deadline is overdue even if work is still on today's calendar")
	}
	if IsOverdue(open, today) {
		t.Fatal("unscheduled open work is not overdue")
	}
	if IsOverdue(done, today) {
		t.Fatal("completed tasks are not overdue")
	}
}

// 00:30 on Sep 11 in Berlin is 22:30 on Sep 10 in UTC. Work due Sep 10 is
// Overdue on the Working hours date and not Overdue on the UTC date.
func TestIsOverdueJudgesDeadlineOnTheGivenTodaysZone(t *testing.T) {
	berlin := mustLocation(t, "Europe/Berlin")
	instant := time.Date(2026, 9, 11, 0, 30, 0, 0, berlin)
	dueSep10 := models.Task{ID: "tsk_1", Kind: models.KindTask, Duration: 30, Deadline: str("2026-09-10")}

	if !IsOverdue(dueSep10, TodayAt(instant, berlin)) {
		t.Fatal("due Sep 10 is Overdue once the Working hours date is Sep 11")
	}
	if IsOverdue(dueSep10, TodayAt(instant, time.UTC)) {
		t.Fatal("due Sep 10 is not Overdue while the UTC date is still Sep 10")
	}
}

// A future Block does not change today's Unscheduled status, and a Block on
// the Working hours date does, even when that date differs from the UTC date.
func TestIsUnscheduledIgnoresFutureBlocks(t *testing.T) {
	tokyo := mustLocation(t, "Asia/Tokyo")
	// 00:30 on Oct 1 in Tokyo is 15:30 on Sep 30 in UTC.
	instant := time.Date(2026, 10, 1, 0, 30, 0, 0, tokyo)
	today := TodayAt(instant, tokyo)

	tomorrowOnly := models.Task{ID: "tsk_future", Kind: models.KindTask, Duration: 30, Blocks: []models.ScheduledBlock{block(time.Date(2026, 10, 2, 9, 0, 0, 0, tokyo), 60)}}
	yesterdayOnly := models.Task{ID: "tsk_past", Kind: models.KindTask, Duration: 30, Blocks: []models.ScheduledBlock{block(time.Date(2026, 9, 30, 9, 0, 0, 0, tokyo), 60)}}
	todayLocal := models.Task{ID: "tsk_today", Kind: models.KindTask, Duration: 30, Blocks: []models.ScheduledBlock{block(time.Date(2026, 10, 1, 9, 0, 0, 0, tokyo), 60)}}

	if !IsUnscheduled(tomorrowOnly, today) {
		t.Fatal("a Block tomorrow leaves Work Unscheduled today")
	}
	if !IsUnscheduled(yesterdayOnly, today) {
		t.Fatal("a Block yesterday leaves Work Unscheduled today")
	}
	if IsUnscheduled(todayLocal, today) {
		t.Fatal("a Block on the Working hours date means scheduled today")
	}
	if !IsUnscheduled(todayLocal, TodayAt(instant, time.UTC)) {
		t.Fatal("the same Block is tomorrow on the UTC date, so Work is Unscheduled there")
	}
	for name, closed := range map[string]models.Task{
		"completed": {Kind: models.KindTask, Duration: 30, CompletedAt: str("2026-09-30T00:00:00Z")},
		"inbox":     {Kind: models.KindInbox},
		"reminder":  {Kind: models.KindReminder},
	} {
		if IsUnscheduled(closed, today) {
			t.Fatalf("%s is never Unscheduled", name)
		}
	}
}

func TestDayLocationPrefersSavedWorkingHours(t *testing.T) {
	saved := models.DefaultWorkingHours("Europe/Berlin")
	if got := DayLocation(saved, "Asia/Tokyo").String(); got != "Europe/Berlin" {
		t.Fatalf("saved Working hours should win, got %s", got)
	}
	if got := DayLocation(models.WorkingHours{}, "Asia/Tokyo").String(); got != "Asia/Tokyo" {
		t.Fatalf("client timezone should be the fallback, got %s", got)
	}
	if got := DayLocation(models.WorkingHours{}, "Not/AZone").String(); got != time.Local.String() {
		t.Fatalf("invalid client timezone should fall back to the server's zone, got %s", got)
	}
}

// The desktop app hosts the backend (ADR 0011), so with no saved hours and no
// client zone the day boundary is the server's own zone, not UTC.
func TestDayLocationFallsBackToServerZone(t *testing.T) {
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.FixedZone("Tokyo", 9*60*60)

	// 20:00 UTC on Sep 10 is already Sep 11 in the server's zone.
	instant := time.Date(2026, 9, 10, 20, 0, 0, 0, time.UTC)
	today := TodayFor(models.WorkingHours{}, "", instant)
	if today.Date() != "2026-09-11" || today.Location() != time.Local {
		t.Fatalf("today = %s in %s, want 2026-09-11 in the server's zone", today.Date(), today.Location())
	}
	if got := DayLocation(models.WorkingHours{}, "Not/AZone"); got != time.Local {
		t.Fatalf("invalid client zone = %s, want the server's zone", got)
	}
}

func TestTodayForUsesWorkingHoursZone(t *testing.T) {
	// 23:30 UTC on Sep 10 is 01:30 on Sep 11 in Berlin.
	instant := time.Date(2026, 9, 10, 23, 30, 0, 0, time.UTC)
	today := TodayFor(models.DefaultWorkingHours("Europe/Berlin"), "America/New_York", instant)
	if today.Date() != "2026-09-11" || today.Location().String() != "Europe/Berlin" {
		t.Fatalf("today = %s in %s, want 2026-09-11 in Europe/Berlin", today.Date(), today.Location())
	}
}

func TestTodayForUserReadsSavedHoursThroughTheLookup(t *testing.T) {
	// 23:30 UTC on Sep 10 is 01:30 on Sep 11 in Berlin.
	instant := time.Date(2026, 9, 10, 23, 30, 0, 0, time.UTC)
	saved := func(string) (models.WorkingHours, error) { return models.DefaultWorkingHours("Europe/Berlin"), nil }
	today, err := TodayForUser(saved, "usr_1", "America/New_York", instant)
	if err != nil || today.Date() != "2026-09-11" || today.Location().String() != "Europe/Berlin" {
		t.Fatalf("today = %s in %s (err %v), want 2026-09-11 in Europe/Berlin", today.Date(), today.Location(), err)
	}

	// No config row yet, or no lookup at all, means no saved hours: the client's zone applies.
	missing := func(string) (models.WorkingHours, error) { return models.WorkingHours{}, gorm.ErrRecordNotFound }
	for name, lookup := range map[string]HoursLookup{"no config row": missing, "no lookup": nil} {
		today, err := TodayForUser(lookup, "usr_1", "Asia/Tokyo", instant)
		if err != nil || today.Location().String() != "Asia/Tokyo" {
			t.Fatalf("%s: today in %s (err %v), want Asia/Tokyo", name, today.Location(), err)
		}
	}

	broken := errors.New("database down")
	failing := func(string) (models.WorkingHours, error) { return models.WorkingHours{}, broken }
	if _, err := TodayForUser(failing, "usr_1", "", instant); !errors.Is(err, broken) {
		t.Fatalf("err = %v, want the lookup failure", err)
	}
}
