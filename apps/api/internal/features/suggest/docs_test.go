package suggest

import (
	"testing"
	"time"
)

func TestIdleLabel(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		ago  time.Duration
		want string
	}{
		{time.Hour, "today"},
		{30 * time.Hour, "yesterday"},
		{5 * 24 * time.Hour, "5 days ago"},
		{21 * 24 * time.Hour, "3 weeks ago"},
		{90 * 24 * time.Hour, "3 months ago"},
		{800 * 24 * time.Hour, "2 years ago"},
	} {
		if got := idleLabel(now.Add(-tc.ago), now); got != tc.want {
			t.Errorf("%v: got %q, want %q", tc.ago, got, tc.want)
		}
	}
	if idleLabel(time.Time{}, now) != "unknown" {
		t.Error("a zero time has a label")
	}
}

func TestSentences(t *testing.T) {
	for text, want := range map[string]int{
		"Book a table for Saturday":                        1,
		"Buy milk. Call Sam about the car!":                2,
		"Ask Dr. smith about it":                           1,
		"Standups run long. Tom will write the checklist.": 2,
	} {
		if got := sentences(text); got != want {
			t.Errorf("%q: got %d, want %d", text, got, want)
		}
	}
}
