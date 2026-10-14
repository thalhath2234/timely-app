package notify

import (
	"testing"
	"time"
)

// A digest goes out from two minutes before its time until four hours after
// it, so a computer that slept through 08:00 still gets the morning digest
// when it wakes, but not the next afternoon.
func TestDigestDue(t *testing.T) {
	at := func(hhmm string) time.Time {
		parsed, err := time.Parse("15:04", hhmm)
		if err != nil {
			t.Fatal(err)
		}
		return time.Date(2030, 3, 5, parsed.Hour(), parsed.Minute(), 0, 0, time.UTC)
	}
	for _, c := range []struct {
		now, set string
		want     bool
	}{
		{"07:57", "08:00", false},
		{"07:58", "08:00", true},
		{"08:00", "08:00", true},
		{"08:35", "08:00", true},
		{"12:00", "08:00", true},
		{"12:01", "08:00", false},
		{"23:59", "00:00", true},
		{"02:00", "00:00", true},
		{"22:30", "18:00", false},
		{"09:00", "", false},
	} {
		if got := digestDue(at(c.now), c.set); got != c.want {
			t.Errorf("digestDue(%s, %q) = %v, want %v", c.now, c.set, got, c.want)
		}
	}
}
