package bots

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseSchedule(t *testing.T) {
	all := []int{0, 1, 2, 3, 4, 5, 6}
	cases := []struct {
		in   string
		want Schedule
	}{
		{"every 6h", Schedule{EveryMinutes: 360}},
		{"every 30m", Schedule{EveryMinutes: 30}},
		{"30m", Schedule{EveryMinutes: 30}},
		{"2h", Schedule{EveryMinutes: 120}},
		{"every 2 days", Schedule{EveryMinutes: 2880}},
		{"every hour", Schedule{EveryMinutes: 60}},
		{"every 90 minutes", Schedule{EveryMinutes: 90}},
		{"EVERY 6H", Schedule{EveryMinutes: 360}},
		{"0 9 * * *", Schedule{Cron: "0 9 * * *"}},
		{"  */15   9-17  * * MON-FRI ", Schedule{Cron: "*/15 9-17 * * MON-FRI"}},
		{"weekdays at 9am", Schedule{DailyAt: "09:00", Weekdays: []int{1, 2, 3, 4, 5}}},
		{"every monday 9am", Schedule{DailyAt: "09:00", Weekdays: []int{1}}},
		{"every monday, friday at 5:30pm", Schedule{DailyAt: "17:30", Weekdays: []int{1, 5}}},
		{"every day at 08:15", Schedule{DailyAt: "08:15", Weekdays: all}},
		{"every weekend at 10:00", Schedule{DailyAt: "10:00", Weekdays: []int{0, 6}}},
	}
	for _, c := range cases {
		got, err := ParseSchedule(c.in)
		if err != nil {
			t.Errorf("ParseSchedule(%q): %v", c.in, err)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("ParseSchedule(%q) = %+v, want %+v", c.in, got, c.want)
		}
	}
}

func TestParseScheduleRefuses(t *testing.T) {
	for _, in := range []string{
		"", "   ", "soon", "every", "every banana", "every 0m", "every 8 days",
		"0 9 * *", "0 9 * * * *", "61 9 * * *", "0 25 * * *", "0 9 32 * *", "0 9 * 13 *", "0 9 * * 8", "5-1 9 * * *", "*/0 * * * *",
	} {
		if s, err := ParseSchedule(in); err == nil {
			t.Errorf("ParseSchedule(%q) = %+v, want an error", in, s)
		}
	}
	for _, in := range []string{"2026-12-01T09:00:00", "2026-12-01", "in 30m", "in 2h"} {
		_, err := ParseSchedule(in)
		var ie *InputError
		if !errors.As(err, &ie) || !strings.Contains(ie.Message, "Reminder") {
			t.Errorf("ParseSchedule(%q) = %v, want a one-time refusal that names Reminders", in, err)
		}
	}
}

func TestScheduleMapRoundTrip(t *testing.T) {
	for _, s := range []Schedule{
		{EveryMinutes: 360},
		{DailyAt: "09:00", Weekdays: []int{1, 2, 3}},
		{Cron: "0 */6 * * *"},
	} {
		back, err := ScheduleFromMap(s.Map())
		if err != nil || !reflect.DeepEqual(back, s) {
			t.Errorf("%+v came back as %+v, %v", s, back, err)
		}
	}
	// JSON numbers arrive as float64.
	got, err := ScheduleFromMap(map[string]any{"dailyAt": "7:30", "weekdays": []any{float64(5), float64(1), float64(1)}})
	if err != nil || !reflect.DeepEqual(got, Schedule{DailyAt: "07:30", Weekdays: []int{1, 5}}) {
		t.Errorf("got %+v, %v", got, err)
	}
	if got := (Schedule{}).Map(); len(got) != 0 {
		t.Errorf("empty schedule map = %v", got)
	}
	for _, m := range []map[string]any{
		{}, {"everyMinutes": 5, "cron": "0 9 * * *"}, {"everyMinutes": "5"}, {"everyMinutes": 1.5}, {"everyMinutes": 99999},
		{"weekdays": []any{1.0}}, {"dailyAt": "9", "weekdays": []any{}}, {"dailyAt": "09:00", "weekdays": []any{7.0}}, {"cron": 5}, {"every": 5},
	} {
		if s, err := ScheduleFromMap(m); err == nil {
			t.Errorf("ScheduleFromMap(%v) = %+v, want an error", m, s)
		}
	}
}

func mustCron(t *testing.T, expr string) *Cron {
	t.Helper()
	c, err := ParseCron(expr)
	if err != nil {
		t.Fatalf("ParseCron(%q): %v", expr, err)
	}
	return c
}

func TestCronNext(t *testing.T) {
	utc := time.UTC
	ny, _ := time.LoadLocation("America/New_York")
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	at := func(y int, m time.Month, d, h, mi int, loc *time.Location) time.Time { return time.Date(y, m, d, h, mi, 0, 0, loc) }
	cases := []struct {
		name  string
		expr  string
		after time.Time
		loc   *time.Location
		want  time.Time
	}{
		{"daily", "0 9 * * *", at(2026, 11, 6, 8, 0, utc), utc, at(2026, 11, 6, 9, 0, utc)},
		{"daily, strictly after", "0 9 * * *", at(2026, 11, 6, 9, 0, utc), utc, at(2026, 11, 7, 9, 0, utc)},
		{"every 15 minutes", "*/15 * * * *", at(2026, 11, 6, 9, 1, utc), utc, at(2026, 11, 6, 9, 15, utc)},
		{"6 hourly", "0 */6 * * *", at(2026, 11, 6, 9, 0, utc), utc, at(2026, 11, 6, 12, 0, utc)},
		{"weekdays only (2026-11-06 is a Friday)", "30 9 * * 1-5", at(2026, 11, 6, 10, 0, utc), utc, at(2026, 11, 9, 9, 30, utc)},
		{"named days", "0 8 * * sat,sun", at(2026, 11, 6, 10, 0, utc), utc, at(2026, 11, 7, 8, 0, utc)},
		{"7 is Sunday", "0 8 * * 7", at(2026, 11, 6, 10, 0, utc), utc, at(2026, 11, 8, 8, 0, utc)},
		{"hour range with step", "0 9-17/2 * * *", at(2026, 11, 6, 9, 30, utc), utc, at(2026, 11, 6, 11, 0, utc)},
		{"list", "0,30 9 * * *", at(2026, 11, 6, 9, 0, utc), utc, at(2026, 11, 6, 9, 30, utc)},
		{"first of the month", "0 0 1 * *", at(2026, 11, 6, 0, 0, utc), utc, at(2026, 12, 1, 0, 0, utc)},
		{"named month", "0 0 25 dec *", at(2026, 11, 6, 0, 0, utc), utc, at(2026, 12, 25, 0, 0, utc)},
		{"a leap day", "0 0 29 2 *", at(2026, 11, 6, 0, 0, utc), utc, at(2028, 2, 29, 0, 0, utc)},
		{"day of month or weekday when both are set", "0 0 13 * fri", at(2026, 11, 6, 12, 0, utc), utc, at(2026, 11, 13, 0, 0, utc)},
		{"in New York", "0 9 * * *", at(2026, 11, 6, 15, 0, utc), ny, at(2026, 11, 7, 9, 0, ny)},
		{"in Kolkata (half-hour offset)", "0 9 * * *", at(2026, 11, 6, 2, 0, utc), kolkata, at(2026, 11, 6, 9, 0, kolkata)},
		{"across a DST change keeps the wall clock", "0 9 * * *", at(2026, 10, 31, 14, 0, utc), ny, at(2026, 11, 1, 9, 0, ny)},
	}
	for _, c := range cases {
		got := mustCron(t, c.expr).Next(c.after, c.loc)
		if !got.Equal(c.want) {
			t.Errorf("%s: Next(%v) = %v, want %v", c.name, c.after, got.In(c.loc), c.want)
		}
	}
	if got := mustCron(t, "0 0 30 2 *").Next(at(2026, 1, 1, 0, 0, utc), utc); !got.IsZero() {
		t.Errorf("a day that never comes gave %v", got)
	}
}

// A schedule that fires in a zone's skipped hour runs once, later, and one
// in a repeated hour does not loop.
func TestCronNextAcrossClockChanges(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	c := mustCron(t, "30 2 * * *")
	// 2026-03-08 02:30 does not exist in New York.
	prev := time.Date(2026, 3, 7, 3, 0, 0, 0, ny)
	for range 5 {
		next := c.Next(prev, ny)
		if !next.After(prev) {
			t.Fatalf("Next(%v) = %v, did not move forward", prev, next)
		}
		prev = next
	}
	all := mustCron(t, "* * * * *")
	start := time.Date(2026, 11, 1, 0, 30, 0, 0, ny)
	for range 300 {
		next := all.Next(start, ny)
		if next.Sub(start) != time.Minute {
			t.Fatalf("every minute: %v then %v", start, next)
		}
		start = next
	}
}
