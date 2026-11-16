package bots

import (
	"math/rand/v2"
	"strings"
	"sync"
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

// briefSpread is how far after its time a brief may start, so briefs set
// to the same minute do not all run at once.
const briefSpread = 2 * time.Minute

// nextBriefAt is the next time hhmm ("08:00", DefaultBriefTime when it is
// not a time) comes round in loc strictly after after. A time that does not
// exist that day (a clock going forward) falls where Go puts it, still
// after after.
func nextBriefAt(loc *time.Location, hhmm string, after time.Time) time.Time {
	if !briefTimeRe.MatchString(hhmm) {
		hhmm = DefaultBriefTime
	}
	h := int(hhmm[0]-'0')*10 + int(hhmm[1]-'0')
	m := int(hhmm[3]-'0')*10 + int(hhmm[4]-'0')
	local := after.In(loc)
	for d := 0; d < 3; d++ {
		at := time.Date(local.Year(), local.Month(), local.Day()+d, h, m, 0, 0, loc)
		if at.After(after) {
			return at.UTC()
		}
	}
	return after.Add(24 * time.Hour).UTC()
}

// AgentFloor is the shortest gap between two runs of an agent Bot (Q-B7
// keeps the per-source minimums): the floor of its Reads, and 15 minutes for
// a Bot with none.
func AgentFloor(ws []Watch) time.Duration {
	if len(ws) == 0 {
		return MinPageEvery
	}
	return Floor(ws)
}

// scheduleLoc is the zone a Bot's schedule reads in; an empty or unknown
// name is UTC.
func scheduleLoc(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	if loc, err := time.LoadLocation(name); err == nil {
		return loc
	}
	return time.UTC
}

// weekdaySet is the days a daily schedule runs on as a bit set.
func weekdaySet(days []int) uint8 {
	var set uint8
	for _, d := range days {
		set |= 1 << uint(d)
	}
	return set
}

// nextDaily is the first dailyAt on a chosen weekday strictly after after.
func nextDaily(s Schedule, after time.Time, loc *time.Location) time.Time {
	h, m, ok := clockTime(s.DailyAt)
	if !ok {
		return time.Time{}
	}
	set := weekdaySet(s.Weekdays)
	if set == 0 {
		set = 0x7f
	}
	local := after.In(loc)
	for d := 0; d < 9; d++ {
		at := time.Date(local.Year(), local.Month(), local.Day()+d, h, m, 0, 0, loc)
		if at.After(after) && set&(1<<uint(at.Weekday())) != 0 {
			return at.UTC()
		}
	}
	return time.Time{}
}

// nextScheduled is the first time strictly after after the schedule names:
// every interval counts from after. The zero Time for an empty schedule.
func nextScheduled(s Schedule, every time.Duration, after time.Time, loc *time.Location) time.Time {
	switch s.Kind() {
	case ScheduleEvery:
		return after.Add(every).UTC()
	case ScheduleDaily:
		return nextDaily(s, after, loc)
	case ScheduleCron:
		c, err := ParseCron(s.Cron)
		if err != nil {
			return time.Time{}
		}
		return c.Next(after, loc)
	}
	return time.Time{}
}

// AgentGap is the shortest gap between two runs a schedule gives, before
// any floor: the interval itself, the days between the chosen weekdays, or
// the closest two runs a cron expression has in two years. Zero for an
// empty or unreadable schedule.
func AgentGap(s Schedule) time.Duration {
	switch s.Kind() {
	case ScheduleEvery:
		return time.Duration(s.EveryMinutes) * time.Minute
	case ScheduleDaily:
		set := weekdaySet(s.Weekdays)
		if set == 0 {
			set = 0x7f
		}
		gap := 7
		last := -1
		first := -1
		for d := 0; d < 7; d++ {
			if set&(1<<uint(d)) == 0 {
				continue
			}
			if last >= 0 {
				gap = min(gap, d-last)
			}
			if first < 0 {
				first = d
			}
			last = d
		}
		if first >= 0 && last != first {
			gap = min(gap, first+7-last)
		}
		return time.Duration(gap) * 24 * time.Hour
	case ScheduleCron:
		c, err := ParseCron(s.Cron)
		if err != nil {
			return 0
		}
		start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(2, 0, 0)
		gap := time.Duration(0)
		prev := c.Next(start, time.UTC)
		for i := 0; i < 3000 && !prev.IsZero() && prev.Before(end); i++ {
			next := c.Next(prev, time.UTC)
			if next.IsZero() {
				break
			}
			if d := next.Sub(prev); gap == 0 || d < gap {
				gap = d
			}
			prev = next
		}
		if gap == 0 { // a single run in two years
			return maxInterval
		}
		return gap
	}
	return 0
}

// AgentInterval is the interval an agent Bot's schedule is stored as
// (bots.interval_seconds, which the table keeps between 5 minutes and a
// week): the shortest gap between its runs, raised to the floor of its
// Reads and held to that range.
func AgentInterval(s Schedule, ws []Watch) time.Duration {
	d := max(AgentGap(s), AgentFloor(ws), MinPriceEvery)
	return min(d, maxInterval)
}

// ClampSchedule raises an interval schedule that is faster than its Reads'
// floor to the floor. A daily or cron schedule is left as it is: its runs
// closer than the floor are skipped by NextAgentCheck.
func ClampSchedule(s Schedule, ws []Watch) Schedule {
	if s.Kind() == ScheduleEvery {
		floor := int(AgentFloor(ws) / time.Minute)
		s.EveryMinutes = min(max(s.EveryMinutes, floor), maxEveryMinutes)
	}
	return s
}

// The market-hours session: the US regular session, 09:30 to 16:00 New York
// time, Monday to Friday (the same one price.usSession reads for stocks).
const (
	sessionZone      = "America/New_York"
	sessionOpenHour  = 9
	sessionOpenMin   = 30
	sessionCloseHour = 16
)

var sessionLoc = sync.OnceValue(func() *time.Location {
	loc, err := time.LoadLocation(sessionZone)
	if err != nil {
		return nil
	}
	return loc
})

// MarketOpen reports whether the market session is open at t. With no zone
// data it is always open, so a Bot is never held back for good.
func MarketOpen(t time.Time) bool {
	loc := sessionLoc()
	if loc == nil {
		return true
	}
	d := t.In(loc)
	if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
		return false
	}
	open := time.Date(d.Year(), d.Month(), d.Day(), sessionOpenHour, sessionOpenMin, 0, 0, loc)
	closeAt := time.Date(d.Year(), d.Month(), d.Day(), sessionCloseHour, 0, 0, 0, loc)
	return !d.Before(open) && d.Before(closeAt)
}

// nextMarketOpen is the first session start strictly after t, skipping
// weekends. Holidays are not known: a check on one finds the market closed
// as a normal one does not, and waits for the next open.
func nextMarketOpen(t time.Time) time.Time {
	loc := sessionLoc()
	if loc == nil {
		return t
	}
	d := t.In(loc)
	for i := 0; i < 8; i++ {
		at := time.Date(d.Year(), d.Month(), d.Day()+i, sessionOpenHour, sessionOpenMin, 0, 0, loc)
		if at.After(t) && at.Weekday() != time.Saturday && at.Weekday() != time.Sunday {
			return at.UTC()
		}
	}
	return t
}

// maxScheduleSkips bounds how many jumps NextAgentCheck makes over runs that
// are closer than the floor or in a closed session before it settles for the
// next open.
const maxScheduleSkips = 400

// NextAgentCheck is when an agent Bot is next due after now: its Schedule
// read in its Timezone (an empty one is UTC), never sooner than the floor
// of its Reads after the last check started, and, with MarketHours, only
// inside the market session. ws are the Bot's Reads; with none given the
// floor is the 15 minutes of a Bot with no Reads, so pass them when it has
// any. The zero Time for a Bot with no schedule.
//
// An interval schedule counts from now, so callers that want the usual
// jitter apply NextCheck to AgentInterval instead. A closed market holds the
// Bot to the next open itself.
func NextAgentCheck(b Bot, now time.Time, ws ...Watch) time.Time {
	s, err := ScheduleFromMap(b.Schedule)
	if err != nil {
		return time.Time{}
	}
	loc := scheduleLoc(b.Timezone)
	floor := AgentFloor(ws)
	every := max(time.Duration(s.EveryMinutes)*time.Minute, floor, b.Interval())
	if s.Kind() != ScheduleEvery {
		every = 0
	}
	// A run due before the floor since the last check started would lose the
	// claim, so it is stepped over.
	var spaced time.Time
	switch {
	case b.CheckStartedAt != nil:
		spaced = spacedAt(b.CheckStartedAt, floor)
	case b.LastCheckAt != nil:
		spaced = spacedAt(b.LastCheckAt, floor)
	}
	at := nextScheduled(s, every, now, loc)
	if s.Kind() == ScheduleEvery {
		if b.MarketHours && !at.IsZero() && !MarketOpen(at) {
			return nextMarketOpen(at)
		}
		return at
	}
	// Each step jumps to just before the earliest time that could work, so a
	// weekend of closed session costs one step, not hundreds.
	for i := 0; i < maxScheduleSkips && !at.IsZero(); i++ {
		switch {
		case at.Before(spaced):
			at = nextScheduled(s, every, spaced.Add(-time.Second), loc)
		case b.MarketHours && !MarketOpen(at):
			at = nextScheduled(s, every, nextMarketOpen(at).Add(-time.Second), loc)
		default:
			return at
		}
	}
	if b.MarketHours {
		// No run of this schedule ever falls in a session (03:00 every day):
		// it runs when the market opens.
		return nextMarketOpen(now)
	}
	return at
}

// The kinds of change the wake gate looks for (ReadingDiff.Kind).
const (
	DiffContent      = "content"
	DiffPrice        = "price"
	DiffAvailability = "availability"
)

// GateDiff is what moved in one Watch between two readings, for the changed
// gate (Q-B1): new feed items or other text (content), another price or
// currency (price), and a stated availability that is not the one before
// (availability, even with the price where it was). An availability the page
// did not state, then or now, is not a change. A watch with no earlier
// reading (prev nil) gives one content diff, so the first tick wakes the
// agent. No diffs means nothing changed.
func GateDiff(watchID string, prev *Reading, cur Reading) []ReadingDiff {
	if prev == nil {
		return []ReadingDiff{{WatchID: watchID, Kind: DiffContent, After: gateLine(cur)}}
	}
	var out []ReadingDiff
	add := func(kind, before, after string) {
		out = append(out, ReadingDiff{WatchID: watchID, Kind: kind, Before: before, After: after})
	}
	switch {
	case cur.Kind == ReadingPrice || prev.Kind == ReadingPrice:
		p, okP := prev.value()
		c, okC := cur.value()
		if okP != okC || (okC && !near(p, c)) || !strings.EqualFold(prev.Currency, cur.Currency) {
			add(DiffPrice, summary(prev), summary(&cur))
		}
		if stockMoved(*prev, cur) {
			add(DiffAvailability, stockWords(prev.Availability), stockWords(cur.Availability))
		}
	case cur.Kind == ReadingFeed:
		if items := newItems(Rule{}, *prev, cur); len(items) > 0 {
			add(DiffContent, summary(prev), summary(&cur))
		}
	default:
		if hashOf(*prev) != hashOf(cur) {
			add(DiffContent, summary(prev), summary(&cur))
		}
	}
	return out
}

func gateLine(r Reading) string {
	if r.Kind == ReadingPrice {
		return summaryWithStock(&r)
	}
	return summary(&r)
}

// WakeAgent reports whether any Watch moved, so a changed-gate Bot's agent
// runs.
func WakeAgent(diffs []ReadingDiff) bool { return len(diffs) > 0 }
