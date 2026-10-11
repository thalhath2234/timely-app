package notify

import (
	"testing"
	"time"

	"timely-api/internal/features/calendar"
	"timely-api/internal/models"
)

// Day counts compare calendar dates, so a time just after midnight and a
// day with a DST change still count whole days.
func TestDaysBetween(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	for _, tc := range []struct {
		name     string
		from, to time.Time
		want     int
	}{
		{"just before and after midnight", time.Date(2026, 10, 9, 23, 50, 0, 0, ny), time.Date(2026, 10, 10, 0, 10, 0, 0, ny), 1},
		{"same day", time.Date(2026, 10, 10, 0, 1, 0, 0, ny), time.Date(2026, 10, 10, 23, 59, 0, 0, ny), 0},
		// 1 November 2026 has 25 hours and 8 March 2026 has 23 in New York.
		{"fall back", time.Date(2026, 11, 1, 0, 0, 0, 0, ny), time.Date(2026, 11, 2, 0, 0, 0, 0, ny), 1},
		{"spring forward", time.Date(2026, 3, 8, 0, 0, 0, 0, ny), time.Date(2026, 3, 9, 0, 0, 0, 0, ny), 1},
		{"earlier", time.Date(2026, 3, 9, 0, 0, 0, 0, ny), time.Date(2026, 3, 6, 0, 0, 0, 0, ny), -3},
		// Read in to's zone: 02:00 UTC on the 10th is the 9th in New York.
		{"other zone", time.Date(2026, 10, 10, 2, 0, 0, 0, time.UTC), time.Date(2026, 10, 10, 9, 0, 0, 0, ny), 1},
	} {
		if got := DaysBetween(tc.from, tc.to); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestBriefItemsCountDaysAcrossDST(t *testing.T) {
	if _, err := time.LoadLocation("America/New_York"); err != nil {
		t.Skip("no tzdata")
	}
	// 8 March 2026 has 23 hours in New York: still one whole day.
	past, soon := "2026-03-08", "2026-03-09"
	after := briefItems(&calendar.TodayResponse{Date: "2026-03-09", Timezone: "America/New_York",
		Overdue: []models.Task{{ID: "a", Name: "Rent", Deadline: &past}}})
	before := briefItems(&calendar.TodayResponse{Date: "2026-03-08", Timezone: "America/New_York",
		Unscheduled: []models.Task{{ID: "b", Name: "Tax", Deadline: &soon}}})
	if len(after) != 1 || after[0].Note != "past its deadline by 1 day, priority none" {
		t.Fatalf("overdue %+v", after)
	}
	if len(before) != 1 || before[0].Note != "due tomorrow and not on the calendar" {
		t.Fatalf("due %+v", before)
	}
}

func TestAlertStepFits(t *testing.T) {
	for _, tc := range []struct {
		kind, step string
		want       bool
	}{
		{"inbox", AlertClarify, true},
		{"inbox", AlertReview, true},
		{"inbox", AlertFocus, false},
		{"inbox", AlertReschedule, false},
		{"project", AlertReview, true},
		{"project", AlertClarify, false},
		{"due", AlertReschedule, true},
		{"unblocked", AlertFocus, true},
		{"stale", AlertClarify, true},
		{"stale", "extend", false},
		{"", AlertFocus, true},
		{"", "extend", false},
	} {
		if got := AlertStepFits(tc.kind, tc.step); got != tc.want {
			t.Errorf("%s/%s: got %v", tc.kind, tc.step, got)
		}
	}
}
