package bots

import (
	"math/rand/v2"
	"time"
)

const (
	maxJitter      = 2 * time.Minute
	maxStrikeDelay = 24 * time.Hour
)

// MinEvery is the shortest interval a watch may be checked at: pages and
// feeds 15 minutes, market prices 5 minutes and shop prices 6 hours.
func MinEvery(w Watch) time.Duration {
	switch {
	case w.Kind == WatchPrice:
		return MinPriceEvery
	case w.Kind == WatchPage && (w.ReadMode == ReadProductPrice || w.ReadMode == ReadSelectorPrice):
		return MinProductEvery
	}
	return MinPageEvery
}

// Floor is the shortest interval for a Bot: the largest MinEvery of its
// watches.
func Floor(ws []Watch) time.Duration {
	f := MinPriceEvery
	for _, w := range ws {
		f = max(f, MinEvery(w))
	}
	return f
}

func defaultEvery(w Watch) time.Duration {
	switch {
	case w.Kind == WatchPrice:
		return 15 * time.Minute
	case w.Kind == WatchFeed:
		return 30 * time.Minute
	case w.ReadMode == ReadProductPrice || w.ReadMode == ReadSelectorPrice:
		return 6 * time.Hour
	}
	return time.Hour
}

// DefaultInterval is the interval of a Bot saved without one: pages hourly,
// feeds every 30 minutes, market prices every 15 minutes and shop prices
// every 6 hours, taking the slowest watch.
func DefaultInterval(ws []Watch) time.Duration {
	d := Floor(ws)
	for _, w := range ws {
		d = max(d, defaultEvery(w))
	}
	return d
}

// NextCheck is when a Bot that was just checked is due again: interval from
// now with ±5% jitter (at most 2 minutes), so Bots made together drift
// apart. The early side is capped at FenceSlack, so a Bot set to its floor is
// never due before the claim would let it run. A nil r means no jitter.
func NextCheck(interval time.Duration, now time.Time, r *rand.Rand) time.Time {
	late := min(interval/20, maxJitter)
	early := min(late, FenceSlack)
	if r == nil || late <= 0 {
		return now.Add(interval)
	}
	off := time.Duration(r.Int64N(int64(early+late)+1)) - early
	return now.Add(interval + off)
}

// Provisional is the next_check_at a check sets when it starts, so a crash
// or a failed job cannot leave the Bot due in a loop.
func Provisional(interval time.Duration, now time.Time) time.Time {
	return now.Add(min(interval, ProvisionalMax))
}

// spacedAt is the earliest the claim lets a Bot whose last check started at
// started run again: its floor later, less FenceSlack. Zero when it never ran.
// No next_check_at may be set before it, or the sweep would queue a check
// that loses the claim on every tick until then.
func spacedAt(started *time.Time, floor time.Duration) time.Time {
	if started == nil {
		return time.Time{}
	}
	return started.UTC().Add(floor - FenceSlack)
}

// StrikeDelay is how long a Bot waits after a failed check: the interval,
// doubled for each strike after the first, at most 24 hours.
func StrikeDelay(interval time.Duration, strikes int) time.Duration {
	d := interval
	for i := 1; i < strikes && d < maxStrikeDelay; i++ {
		d *= 2
	}
	return min(d, maxStrikeDelay)
}
