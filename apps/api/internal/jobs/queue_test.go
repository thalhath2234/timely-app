package jobs

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"timely-api/internal/models"
)

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

func TestRetryDelay(t *testing.T) {
	cause := errors.New("site busy")
	cases := []struct {
		name     string
		attempts int
		cause    error
		want     time.Duration
	}{
		{"plain error uses Backoff", 3, cause, Backoff(3)},
		{"RetryAfter is honoured", 1, RetryAfter(cause, 5*time.Minute), 5 * time.Minute},
		{"below Backoff is clamped up", 5, RetryAfter(cause, time.Second), Backoff(5)},
		{"above 6h is clamped down", 1, RetryAfter(cause, 48*time.Hour), 6 * time.Hour},
		{"wrapped RetryAfter still counts", 1, fmt.Errorf("check: %w", RetryAfter(cause, time.Minute)), time.Minute},
	}
	for _, c := range cases {
		if got := retryDelay(c.attempts, c.cause); got != c.want {
			t.Errorf("%s: retryDelay = %s, want %s", c.name, got, c.want)
		}
	}
}

func TestRetryAfterKeepsTheCause(t *testing.T) {
	cause := errors.New("site busy")
	if RetryAfter(nil, time.Minute) != nil {
		t.Fatal("RetryAfter(nil) should be nil")
	}
	err := RetryAfter(cause, time.Minute)
	if !errors.Is(err, cause) || err.Error() != cause.Error() {
		t.Fatalf("RetryAfter hid its cause: %v", err)
	}
}

func TestFinalAttempt(t *testing.T) {
	cause := errors.New("refused")
	if finalAttempt(1, 2, RetryAfter(cause, time.Minute)) {
		t.Fatal("a RetryAfter error with attempts left was final")
	}
	if !finalAttempt(2, 2, RetryAfter(cause, time.Minute)) {
		t.Fatal("the last attempt was not final")
	}
	if !finalAttempt(1, 8, RetryAfter(Permanent(cause), time.Minute)) || !finalAttempt(1, 8, Permanent(RetryAfter(cause, time.Minute))) {
		t.Fatal("Permanent did not win over RetryAfter")
	}
}

func TestSeparateNKeepsAtLeastOneSlot(t *testing.T) {
	w := NewWorker(nil)
	w.SeparateN(0, models.JobReindexUser)
	w.Separate(models.JobIndexEntity)
	w.SeparateN(4, models.JobSendPush)
	got := []int{w.lanes[0].slots, w.lanes[1].slots, w.lanes[2].slots}
	if got[0] != 1 || got[1] != 1 || got[2] != 4 {
		t.Fatalf("slots = %v, want [1 1 4]", got)
	}
}
