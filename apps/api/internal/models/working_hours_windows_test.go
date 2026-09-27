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
