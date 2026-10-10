package task

import (
	"testing"
	"time"

	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

// A fresh copy of a repeating task keeps its rule and starts on the first
// day on or after the new start that the rule falls on, at the same time.
func TestRestartSeriesKeepsTheRule(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Skip("no tzdata")
	}
	// Monday 6 January 2025, 09:30 in Berlin.
	oldStart := time.Date(2025, 1, 6, 9, 30, 0, 0, berlin)
	for _, tc := range []struct {
		name, rrule, from string
		wantStart         string
		wantRule          string
	}{
		{"weekly takes its weekday from the old start", "FREQ=WEEKLY", "2026-10-14", "2026-10-19T09:30:00+02:00", "FREQ=WEEKLY"},
		{"weekly on Mondays from a Monday", "FREQ=WEEKLY;BYDAY=MO", "2026-10-12", "2026-10-12T09:30:00+02:00", "FREQ=WEEKLY;BYDAY=MO"},
		{"every two weeks counts from the new start", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-10-13", "2026-10-15T09:30:00+02:00", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"},
		{"daily starts on the day itself", "FREQ=DAILY;COUNT=5", "2026-10-14", "2026-10-14T09:30:00+02:00", "FREQ=DAILY;COUNT=5"},
		{"monthly keeps its day of the month", "FREQ=MONTHLY", "2026-10-10", "2026-11-06T09:30:00+01:00", "FREQ=MONTHLY"},
		{"monthly second Tuesday", "FREQ=MONTHLY;BYDAY=2TU", "2026-10-14", "2026-11-10T09:30:00+01:00", "FREQ=MONTHLY;BYDAY=2TU"},
		{"yearly keeps its date", "FREQ=YEARLY", "2026-10-14", "2027-01-06T09:30:00+01:00", "FREQ=YEARLY"},
		{"an earlier new start still works", "FREQ=WEEKLY;BYDAY=FR", "2024-03-01", "2024-03-01T09:30:00+01:00", "FREQ=WEEKLY;BYDAY=FR"},
		// The old series ran 4 weeks; so does the new one.
		{"UNTIL moves with the start", "FREQ=WEEKLY;UNTIL=20250203T083000Z", "2026-10-12", "2026-10-12T09:30:00+02:00", "FREQ=WEEKLY;UNTIL=20261109T083000Z"},
	} {
		rule := &models.RecurrenceRule{RRule: tc.rrule, Dtstart: oldStart.UTC(), Timezone: "Europe/Berlin"}
		got, err := restartSeries(rule, tc.from)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got.Dtstart != tc.wantStart || got.RRule != tc.wantRule || got.Timezone != "Europe/Berlin" {
			t.Errorf("%s: got %+v, want start %s rule %s", tc.name, got, tc.wantStart, tc.wantRule)
		}
	}
}

// UNTIL keeps the old series' number of occurrences, counted with the rule:
// months and years differ in length, so a shift by days would be wrong.
func TestRestartSeriesKeepsTheNumberOfOccurrences(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Skip("no tzdata")
	}
	for _, tc := range []struct {
		name, rrule string
		oldStart    time.Time
		from        string
		wantStart   string
		wantRule    string
		want        int
	}{
		// 15 Feb and 15 Mar 2025; restarted in July 2026: 15 Jul and 15 Aug.
		{"monthly on the 15th", "FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20250315T080000Z", time.Date(2025, 2, 15, 9, 0, 0, 0, berlin), "2026-07-01", "2026-07-15T09:00:00+02:00", "FREQ=MONTHLY;UNTIL=20260815T070000Z;BYMONTHDAY=15", 2},
		{"monthly from the start's day", "FREQ=MONTHLY;UNTIL=20250315T080000Z", time.Date(2025, 2, 15, 9, 0, 0, 0, berlin), "2026-07-01", "2026-07-15T09:00:00+02:00", "FREQ=MONTHLY;UNTIL=20260815T070000Z", 2},
		// 31 Jan, 31 Mar, 31 May 2025 (months without a 31st are skipped);
		// from 1 Jun 2026: 31 Jul, 31 Aug, 31 Oct.
		{"monthly on the 31st", "FREQ=MONTHLY;UNTIL=20250531T070000Z", time.Date(2025, 1, 31, 9, 0, 0, 0, berlin), "2026-06-01", "2026-07-31T09:00:00+02:00", "FREQ=MONTHLY;UNTIL=20261031T080000Z", 3},
		{"every two months", "FREQ=MONTHLY;INTERVAL=2;UNTIL=20250715T070000Z", time.Date(2025, 1, 15, 9, 0, 0, 0, berlin), "2026-02-01", "2026-02-15T09:00:00+01:00", "FREQ=MONTHLY;INTERVAL=2;UNTIL=20260815T070000Z", 4},
		// 2025, 2026, 2027; restarted from 2027: 2027, 2028, 2029 (2028 is a
		// leap year, so counting days would land on 5 Jan 2029).
		{"yearly", "FREQ=YEARLY;UNTIL=20270106T083000Z", time.Date(2025, 1, 6, 9, 30, 0, 0, berlin), "2026-10-14", "2027-01-06T09:30:00+01:00", "FREQ=YEARLY;UNTIL=20290106T083000Z", 3},
		{"yearly on 29 February", "FREQ=YEARLY;UNTIL=20280229T080000Z", time.Date(2024, 2, 29, 9, 0, 0, 0, berlin), "2026-01-01", "2028-02-29T09:00:00+01:00", "FREQ=YEARLY;UNTIL=20320229T080000Z", 2},
	} {
		rule := &models.RecurrenceRule{RRule: tc.rrule, Dtstart: tc.oldStart.UTC(), Timezone: "Europe/Berlin"}
		got, err := restartSeries(rule, tc.from)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got.Dtstart != tc.wantStart || got.RRule != tc.wantRule {
			t.Errorf("%s: got start %s rule %s, want %s %s", tc.name, got.Dtstart, got.RRule, tc.wantStart, tc.wantRule)
			continue
		}
		// Both series have the same number of occurrences.
		for _, series := range []*models.RecurrenceRule{rule, {RRule: got.RRule, Dtstart: mustTime(t, got.Dtstart), Timezone: "Europe/Berlin"}} {
			parsed, err := recurrence.Parse(series.RRule)
			if err != nil {
				t.Fatal(err)
			}
			start := series.Dtstart.In(berlin)
			if n := len(parsed.Between(start, start, start.AddDate(20, 0, 0))); n != tc.want {
				t.Errorf("%s: %s from %s has %d occurrences, want %d", tc.name, series.RRule, start, n, tc.want)
			}
		}
	}
}

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.UTC()
}

func TestRestartSeriesRefusesABadDate(t *testing.T) {
	rule := &models.RecurrenceRule{RRule: "FREQ=DAILY", Dtstart: time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC)}
	if _, err := restartSeries(rule, "soon"); err == nil {
		t.Fatal("want an error for a date that does not parse")
	}
}
