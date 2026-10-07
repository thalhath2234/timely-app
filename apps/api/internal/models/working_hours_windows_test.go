package models

import (
	"testing"
	"time"
)

func TestWindowsOnDefaultsEmptyDayToNineToFive(t *testing.T) {
	hours := DefaultWorkingHours("UTC")
	sat := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC) // Saturday
	got := hours.WindowsOn(sat)
	if len(got) != 1 || got[0].Start != "09:00" || got[0].End != "17:00" {
		t.Fatalf("empty Saturday should fill 09:00–17:00, got %#v", got)
	}
}

func TestWorkingHoursRefuseLocalAsATimezone(t *testing.T) {
	if err := (WorkingHours{Timezone: "Local"}).Validate(); err == nil {
		t.Fatal(`"Local" cannot be resolved by a client, so it is not a saved zone`)
	}
	if err := (WorkingHours{Timezone: "Asia/Tokyo"}).Validate(); err != nil {
		t.Fatalf("a real zone must stay valid: %v", err)
	}
}
