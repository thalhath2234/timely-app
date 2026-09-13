package jobs

import "testing"

func TestBackoffGrowsThenCaps(t *testing.T) {
	if got := Backoff(1); got.Seconds() != 2 {
		t.Fatalf("attempt 1: %s", got)
	}
	if got := Backoff(2); got.Seconds() != 4 {
		t.Fatalf("attempt 2: %s", got)
	}
	if got := Backoff(10); got.Minutes() != 15 {
		t.Fatalf("cap: %s", got)
	}
}
