package chat

import (
	"testing"
	"time"

	"timely-api/internal/features/bots"
)

// A worker's 429 carries the provider's Retry-After into the tick's result, so
// bots can hold the next Check; without the field there is nothing to hold by.
func TestBotAgentRateLimitCarriesRetryAfter(t *testing.T) {
	w := newBotWorld(t, nil)
	limited := func(extra map[string]any) map[string]any {
		done := map[string]any{"fake": "done", "silent": false, "error_class": "rate_limited", "error": "HTTP 429: rate limit"}
		for k, v := range extra {
			done[k] = v
		}
		return done
	}
	w.kit.fixture("HINT", limited(map[string]any{"retry_after_seconds": 120}))
	w.kit.fixture("BARE", limited(nil))
	w.kit.fixture("HUGE", limited(map[string]any{"retry_after_seconds": 1e12}))
	w.kit.fixture("NEG", limited(map[string]any{"retry_after_seconds": -5}))
	w.kit.fixture("OTHER", map[string]any{"fake": "done", "silent": false, "error_class": "error", "error": "boom", "retry_after_seconds": 120})

	for _, tc := range []struct {
		word  string
		class string
		want  time.Duration
	}{
		{"HINT", bots.ClassRateLimited, 2 * time.Minute},
		{"BARE", bots.ClassRateLimited, 0},
		{"HUGE", bots.ClassRateLimited, 7 * 24 * time.Hour},
		{"NEG", bots.ClassRateLimited, 0},
		{"OTHER", bots.ClassCrash, 0},
	} {
		res := runTick(t, w.a, "user-a", tickInput(testBot("bot_pixel"), "bchk_"+tc.word, tc.word+" now"))
		if res.ErrorClass != tc.class || res.RetryAfter != tc.want {
			t.Errorf("%s: class %q retry-after %v, want %q %v", tc.word, res.ErrorClass, res.RetryAfter, tc.class, tc.want)
		}
	}
}
