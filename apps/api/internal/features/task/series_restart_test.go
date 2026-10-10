package task

import (
	"testing"
	"time"

	"timely-api/internal/models"
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

func TestRestartSeriesRefusesABadDate(t *testing.T) {
	rule := &models.RecurrenceRule{RRule: "FREQ=DAILY", Dtstart: time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC)}
	if _, err := restartSeries(rule, "soon"); err == nil {
		t.Fatal("want an error for a date that does not parse")
	}
}
