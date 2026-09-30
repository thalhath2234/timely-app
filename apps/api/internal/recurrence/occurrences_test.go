package recurrence

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

func TestExpandPreservesAdjustedOccurrenceOutsideChangedWeekdays(t *testing.T) {
	start := time.Date(2026, 9, 28, 9, 0, 0, 0, time.UTC) // Monday
	original := start.AddDate(0, 0, 2)                    // old Wednesday, absent from new rule
	moved := original.Add(2 * time.Hour)
	rule := &models.RecurrenceRule{RRule: "FREQ=WEEKLY;BYDAY=MO,TU", Dtstart: start, Timezone: "UTC", Exceptions: []models.RecurrenceException{{OriginalStart: original, NewStart: &moved}}}
	occurrences, err := Expand(rule, time.Hour, start, start.AddDate(0, 0, 7))
	if err != nil {
		t.Fatal(err)
	}
	if len(occurrences) != 3 {
		t.Fatalf("want Mon Tue and adjusted Wed, got %v", occurrences)
	}
	if !occurrences[2].Start.Equal(moved) || !occurrences[2].Moved {
		t.Fatal("lost adjusted time")
	}
	if !IsOccurrence(rule, original) {
		t.Fatal("preserved occurrence cannot be edited")
	}
}
func TestExpandDoesNotDuplicateOrResurrectCancelledExceptions(t *testing.T) {
	start := time.Date(2026, 9, 28, 9, 0, 0, 0, time.UTC)
	moved := start.Add(time.Hour)
	rule := &models.RecurrenceRule{RRule: "FREQ=WEEKLY;BYDAY=MO", Dtstart: start, Timezone: "UTC", Exceptions: []models.RecurrenceException{{OriginalStart: start, NewStart: &moved}, {OriginalStart: start.AddDate(0, 0, 2), IsCancelled: true}}}
	items, err := Expand(rule, time.Hour, start, start.AddDate(0, 0, 7))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d occurrences", len(items))
	}
}
