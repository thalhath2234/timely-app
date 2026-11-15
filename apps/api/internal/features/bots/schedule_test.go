package bots

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
)

var (
	page    = Watch{Kind: WatchPage, ReadMode: ReadText}
	sel     = Watch{Kind: WatchPage, ReadMode: ReadSelector}
	product = Watch{Kind: WatchPage, ReadMode: ReadProductPrice}
	onePart = Watch{Kind: WatchPage, ReadMode: ReadSelectorPrice, Selector: ".price"}
	feed    = Watch{Kind: WatchFeed}
	quote   = Watch{Kind: WatchPrice}
)

func TestMinEveryFloorAndDefault(t *testing.T) {
	cases := []struct {
		name          string
		ws            []Watch
		min, floor, d time.Duration
	}{
		{"page", []Watch{page}, 15 * time.Minute, 15 * time.Minute, time.Hour},
		{"selector", []Watch{sel}, 15 * time.Minute, 15 * time.Minute, time.Hour},
		{"feed", []Watch{feed}, 15 * time.Minute, 15 * time.Minute, 30 * time.Minute},
		{"price", []Watch{quote}, 5 * time.Minute, 5 * time.Minute, 15 * time.Minute},
		{"product", []Watch{product}, 6 * time.Hour, 6 * time.Hour, 6 * time.Hour},
		{"price and feed", []Watch{quote, feed}, 5 * time.Minute, 15 * time.Minute, 30 * time.Minute},
		{"price and page", []Watch{quote, page}, 5 * time.Minute, 15 * time.Minute, time.Hour},
		{"page and product", []Watch{page, product}, 15 * time.Minute, 6 * time.Hour, 6 * time.Hour},
		{"selector price", []Watch{onePart}, 6 * time.Hour, 6 * time.Hour, 6 * time.Hour},
		{"selector price and feed", []Watch{onePart, feed}, 6 * time.Hour, 6 * time.Hour, 6 * time.Hour},
	}
	for _, c := range cases {
		if got := MinEvery(c.ws[0]); got != c.min {
			t.Errorf("%s: MinEvery %v, want %v", c.name, got, c.min)
		}
		if got := Floor(c.ws); got != c.floor {
			t.Errorf("%s: Floor %v, want %v", c.name, got, c.floor)
		}
		if got := DefaultInterval(c.ws); got != c.d {
			t.Errorf("%s: DefaultInterval %v, want %v", c.name, got, c.d)
		}
	}
	if got := Floor(nil); got != MinPriceEvery {
		t.Errorf("Floor(nil) %v", got)
	}
}

func TestNextCheckJitter(t *testing.T) {
	now := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	r := rand.New(rand.NewPCG(1, 2))
	for _, interval := range []time.Duration{5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 7 * 24 * time.Hour} {
		spread := min(interval/20, 2*time.Minute)
		lo, hi := interval-min(spread, FenceSlack), interval+spread
		seen := map[time.Duration]bool{}
		for range 2000 {
			d := NextCheck(interval, now, r).Sub(now)
			if d < lo || d > hi {
				t.Fatalf("%v: next in %v, outside [%v, %v]", interval, d, lo, hi)
			}
			if d < time.Duration(float64(interval)*0.95) || d-interval > 2*time.Minute || interval-d > 2*time.Minute {
				t.Fatalf("%v: next in %v breaks ±5%%/±2m", interval, d)
			}
			seen[d] = true
		}
		if len(seen) < 100 {
			t.Errorf("%v: only %d distinct times", interval, len(seen))
		}
	}
	if got := NextCheck(time.Hour, now, nil); !got.Equal(now.Add(time.Hour)) {
		t.Errorf("nil rand: %v", got)
	}
	a := NextCheck(time.Hour, now, rand.New(rand.NewPCG(7, 7)))
	b := NextCheck(time.Hour, now, rand.New(rand.NewPCG(7, 7)))
	if !a.Equal(b) {
		t.Error("the same seed gave different times")
	}
}

func TestProvisional(t *testing.T) {
	now := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	cases := map[time.Duration]time.Duration{
		5 * time.Minute:    5 * time.Minute,
		10 * time.Minute:   10 * time.Minute,
		time.Hour:          10 * time.Minute,
		7 * 24 * time.Hour: 10 * time.Minute,
	}
	for interval, want := range cases {
		if got := Provisional(interval, now).Sub(now); got != want {
			t.Errorf("Provisional(%v) = +%v, want +%v", interval, got, want)
		}
	}
}

func TestStrikeDelay(t *testing.T) {
	cases := []struct {
		interval time.Duration
		strikes  int
		want     time.Duration
	}{
		{15 * time.Minute, 0, 15 * time.Minute},
		{15 * time.Minute, 1, 15 * time.Minute},
		{15 * time.Minute, 2, 30 * time.Minute},
		{15 * time.Minute, 3, time.Hour},
		{15 * time.Minute, 5, 4 * time.Hour},
		{15 * time.Minute, 7, 16 * time.Hour},
		{15 * time.Minute, 8, 24 * time.Hour},
		{15 * time.Minute, 1000, 24 * time.Hour},
		{2 * time.Hour, 5, 24 * time.Hour},
		{7 * 24 * time.Hour, 1, 24 * time.Hour},
	}
	for _, c := range cases {
		if got := StrikeDelay(c.interval, c.strikes); got != c.want {
			t.Errorf("StrikeDelay(%v, %d) = %v, want %v", c.interval, c.strikes, got, c.want)
		}
	}
}

func TestDescribeErrNoSuchHostIsAStrike(t *testing.T) {
	w := Watch{Kind: WatchPage, URL: "https://shop.example/p/1"}
	err := fmt.Errorf("%w: lookup shop.example: no such host", fetch.ErrNoSuchHost)
	p := describeErr(w, err)
	if p == nil || p.class != classStrike || p.code != "not_found" {
		t.Fatalf("got %+v, want a not_found strike", p)
	}
	if !strings.Contains(p.line, "doesn't exist") {
		t.Errorf("line = %q", p.line)
	}
}

func agentBot(s Schedule, tz string) Bot {
	return Bot{Engine: EngineAgent, Schedule: s.Map(), Timezone: tz}
}

func TestAgentFloorsAndInterval(t *testing.T) {
	cases := []struct {
		name  string
		s     Schedule
		ws    []Watch
		floor time.Duration
		every time.Duration
	}{
		{"no Reads floors at 15 minutes", Schedule{EveryMinutes: 5}, nil, 15 * time.Minute, 15 * time.Minute},
		{"a quote is allowed 5 minutes", Schedule{EveryMinutes: 5}, []Watch{quote}, 5 * time.Minute, 5 * time.Minute},
		{"a page is held to 15 minutes", Schedule{EveryMinutes: 5}, []Watch{page}, 15 * time.Minute, 15 * time.Minute},
		{"a shop price is held to 6 hours", Schedule{EveryMinutes: 30}, []Watch{product}, 6 * time.Hour, 6 * time.Hour},
		{"slower than the floor stays", Schedule{EveryMinutes: 720}, []Watch{product}, 6 * time.Hour, 12 * time.Hour},
		{"the slowest Read sets the floor", Schedule{EveryMinutes: 20}, []Watch{quote, page, product}, 6 * time.Hour, 6 * time.Hour},
		{"a daily schedule is a day apart", Schedule{DailyAt: "09:00", Weekdays: []int{0, 1, 2, 3, 4, 5, 6}}, nil, 15 * time.Minute, 24 * time.Hour},
		{"weekdays only: Mon to Tue is the closest", Schedule{DailyAt: "09:00", Weekdays: []int{1, 2, 3, 4, 5}}, nil, 15 * time.Minute, 24 * time.Hour},
		{"Monday and Friday: 3 days is the closest", Schedule{DailyAt: "09:00", Weekdays: []int{1, 5}}, nil, 15 * time.Minute, 72 * time.Hour},
		{"one day a week", Schedule{DailyAt: "09:00", Weekdays: []int{1}}, nil, 15 * time.Minute, 7 * 24 * time.Hour},
		{"Saturday and Sunday: Sat to Sun is 1 day", Schedule{DailyAt: "09:00", Weekdays: []int{0, 6}}, nil, 15 * time.Minute, 24 * time.Hour},
		{"cron every 5 minutes with no Reads is clamped", Schedule{Cron: "*/5 * * * *"}, nil, 15 * time.Minute, 15 * time.Minute},
		{"cron every 6 hours", Schedule{Cron: "0 */6 * * *"}, nil, 15 * time.Minute, 6 * time.Hour},
		{"cron office hours: 15 minutes inside the window", Schedule{Cron: "*/15 9-17 * * 1-5"}, nil, 15 * time.Minute, 15 * time.Minute},
		{"cron monthly is capped at a week", Schedule{Cron: "0 0 1 * *"}, nil, 15 * time.Minute, 7 * 24 * time.Hour},
		{"cron over a shop price waits for the floor", Schedule{Cron: "0 * * * *"}, []Watch{product}, 6 * time.Hour, 6 * time.Hour},
	}
	for _, c := range cases {
		if got := AgentFloor(c.ws); got != c.floor {
			t.Errorf("%s: AgentFloor %v, want %v", c.name, got, c.floor)
		}
		if got := AgentInterval(c.s, c.ws); got != c.every {
			t.Errorf("%s: AgentInterval %v, want %v", c.name, got, c.every)
		}
		secs := int(AgentInterval(c.s, c.ws) / time.Second)
		if secs < 300 || secs > 604800 {
			t.Errorf("%s: %d s breaks bots.interval_seconds' CHECK", c.name, secs)
		}
	}
}

func TestClampSchedule(t *testing.T) {
	if got := ClampSchedule(Schedule{EveryMinutes: 30}, []Watch{product}); got.EveryMinutes != 360 {
		t.Errorf("shop price: %+v", got)
	}
	if got := ClampSchedule(Schedule{EveryMinutes: 5}, nil); got.EveryMinutes != 15 {
		t.Errorf("no Reads: %+v", got)
	}
	if got := ClampSchedule(Schedule{EveryMinutes: 5}, []Watch{quote}); got.EveryMinutes != 5 {
		t.Errorf("quote: %+v", got)
	}
	c := Schedule{Cron: "* * * * *"}
	if got := ClampSchedule(c, nil); got.Cron != c.Cron {
		t.Errorf("cron is left to NextAgentCheck: %+v", got)
	}
}

func TestNextAgentCheckEvery(t *testing.T) {
	now := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	b := agentBot(Schedule{EveryMinutes: 360}, "")
	b.IntervalSeconds = 360 * 60
	if got := NextAgentCheck(b, now, product); !got.Equal(now.Add(6 * time.Hour)) {
		t.Errorf("6 h: %v", got)
	}
	// Faster than the floor of its Reads: the floor rules.
	fast := agentBot(Schedule{EveryMinutes: 10}, "")
	if got := NextAgentCheck(fast, now, product); !got.Equal(now.Add(6 * time.Hour)) {
		t.Errorf("clamped to the shop-price floor: %v", got)
	}
	if got := NextAgentCheck(fast, now); !got.Equal(now.Add(15 * time.Minute)) {
		t.Errorf("no Reads floors at 15 minutes: %v", got)
	}
	if got := NextAgentCheck(agentBot(Schedule{}, ""), now); !got.IsZero() {
		t.Errorf("no schedule: %v", got)
	}
}

func TestNextAgentCheckDailyInZone(t *testing.T) {
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	// Friday 2026-11-06 10:00 in Kolkata.
	now := time.Date(2026, 11, 6, 10, 0, 0, 0, kolkata)
	b := agentBot(Schedule{DailyAt: "09:00", Weekdays: []int{1, 2, 3, 4, 5}}, "Asia/Kolkata")
	want := time.Date(2026, 11, 9, 9, 0, 0, 0, kolkata) // Monday
	if got := NextAgentCheck(b, now); !got.Equal(want) {
		t.Errorf("weekdays: got %v, want %v", got.In(kolkata), want)
	}
	b = agentBot(Schedule{DailyAt: "09:00", Weekdays: []int{0, 1, 2, 3, 4, 5, 6}}, "Asia/Kolkata")
	if got, want := NextAgentCheck(b, now), time.Date(2026, 11, 7, 9, 0, 0, 0, kolkata); !got.Equal(want) {
		t.Errorf("every day: got %v, want %v", got.In(kolkata), want)
	}
	// The same clock in UTC is another instant: 04:30 UTC is before 09:00.
	b.Timezone = ""
	if got, want := NextAgentCheck(b, now), time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC); !got.Equal(want) {
		t.Errorf("UTC: got %v, want %v", got, want)
	}
}

func TestNextAgentCheckCronSkipsRunsInsideTheFloor(t *testing.T) {
	// Every 5 minutes asked for, a page's 15-minute floor holds: a check that
	// started at 09:00 is not due before 09:15 (less the claim's slack).
	started := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	b := agentBot(Schedule{Cron: "*/5 * * * *"}, "")
	b.CheckStartedAt = &started
	now := started.Add(time.Minute)
	got := NextAgentCheck(b, now, page)
	if got.Before(started.Add(15*time.Minute-FenceSlack)) || !got.Equal(time.Date(2026, 11, 6, 9, 15, 0, 0, time.UTC)) {
		t.Errorf("got %v, want 09:15", got)
	}
	if got := NextAgentCheck(agentBot(Schedule{Cron: "*/5 * * * *"}, ""), now, quote); !got.Equal(time.Date(2026, 11, 6, 9, 5, 0, 0, time.UTC)) {
		t.Errorf("a quote may run every 5 minutes: %v", got)
	}
}

// With market hours on, no next check falls inside a closed session, whatever
// the schedule is and whenever it is asked.
func TestNextAgentCheckMarketHours(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	schedules := []Schedule{
		{EveryMinutes: 5}, {EveryMinutes: 15}, {EveryMinutes: 360}, {EveryMinutes: 24 * 60},
		{DailyAt: "03:00", Weekdays: []int{0, 1, 2, 3, 4, 5, 6}},
		{DailyAt: "10:00", Weekdays: []int{0, 6}},
		{DailyAt: "12:00", Weekdays: []int{1, 2, 3, 4, 5}},
		{Cron: "*/20 * * * *"}, {Cron: "0 * * * *"}, {Cron: "0 20 * * *"}, {Cron: "45 15 * * 5"},
	}
	// Over a week and a half, a weekend and the DST change of 2026-11-01.
	start := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	for _, s := range schedules {
		b := agentBot(s, "")
		b.MarketHours = true
		for step := 0; step < 24*9; step++ {
			now := start.Add(time.Duration(step) * time.Hour).Add(7 * time.Minute)
			next := NextAgentCheck(b, now, quote)
			if next.IsZero() {
				t.Fatalf("%+v at %v: no next check", s, now)
			}
			if !next.After(now) {
				t.Fatalf("%+v at %v: next %v is not later", s, now, next)
			}
			if !MarketOpen(next) {
				t.Fatalf("%+v at %v: next %v (%v in New York) is in a closed session", s, now, next, next.In(ny))
			}
		}
	}
}

func TestMarketOpenSession(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	at := func(d, h, m int) time.Time { return time.Date(2026, 11, d, h, m, 0, 0, ny) }
	cases := []struct {
		t    time.Time
		open bool
	}{
		{at(6, 9, 29), false}, {at(6, 9, 30), true}, {at(6, 15, 59), true}, {at(6, 16, 0), false},
		{at(7, 11, 0), false}, {at(8, 11, 0), false}, {at(9, 11, 0), true},
	}
	for _, c := range cases {
		if got := MarketOpen(c.t); got != c.open {
			t.Errorf("MarketOpen(%v) = %v, want %v", c.t, got, c.open)
		}
	}
	// Friday after the close waits for Monday's open.
	if got, want := nextMarketOpen(at(6, 17, 0)), at(9, 9, 30); !got.Equal(want) {
		t.Errorf("nextMarketOpen = %v, want %v", got.In(ny), want)
	}
}

func readingOf(price float64, avail string) Reading {
	return Reading{Kind: ReadingPrice, Price: &price, Currency: "INR", Availability: avail, At: t0}
}

// An availability-only change wakes the agent; the Pixel case at the same
// price is the one a price-only gate would miss.
func TestGateDiffAvailabilityOnly(t *testing.T) {
	prev := readingOf(89999, extract.AvailOutOfStock)
	diffs := GateDiff("bwt_pixel", &prev, readingOf(89999, extract.AvailInStock))
	if len(diffs) != 1 || diffs[0].Kind != DiffAvailability || diffs[0].WatchID != "bwt_pixel" || diffs[0].Before != "out of stock" || diffs[0].After != "in stock" {
		t.Fatalf("diffs %+v", diffs)
	}
	if !WakeAgent(diffs) {
		t.Error("an availability change did not wake the agent")
	}
	// Both buyable states differ too: the gate wakes on any stated move.
	prev = readingOf(89999, extract.AvailInStock)
	if d := GateDiff("w", &prev, readingOf(89999, extract.AvailLimited)); len(d) != 1 || d[0].Kind != DiffAvailability {
		t.Errorf("in stock to limited: %+v", d)
	}
	// Nothing moved, or a page that stated nothing.
	if d := GateDiff("w", &prev, readingOf(89999, extract.AvailInStock)); WakeAgent(d) {
		t.Errorf("same reading woke the agent: %+v", d)
	}
	if d := GateDiff("w", &prev, readingOf(89999, extract.AvailUnknown)); WakeAgent(d) {
		t.Errorf("an unstated availability woke the agent: %+v", d)
	}
	old := readingOf(89999, "")
	if d := GateDiff("w", &old, readingOf(89999, extract.AvailInStock)); WakeAgent(d) {
		t.Errorf("a reading saved before availability was read woke the agent: %+v", d)
	}
}

func TestGateDiffPriceTextAndFeed(t *testing.T) {
	prev := readingOf(109999, extract.AvailInStock)
	d := GateDiff("w", &prev, readingOf(89999, extract.AvailInStock))
	if len(d) != 1 || d[0].Kind != DiffPrice {
		t.Errorf("price: %+v", d)
	}
	d = GateDiff("w", &prev, readingOf(89999, extract.AvailOutOfStock))
	if len(d) != 2 {
		t.Errorf("price and availability: %+v", d)
	}
	if d := GateDiff("w", nil, readingOf(1, extract.AvailInStock)); len(d) != 1 || d[0].Kind != DiffContent || d[0].Before != "" {
		t.Errorf("first reading: %+v", d)
	}

	a := Reading{Kind: ReadingText, Text: "hello", At: t0}
	b := Reading{Kind: ReadingText, Text: "hello there", At: t0}
	if d := GateDiff("w", &a, a); WakeAgent(d) {
		t.Errorf("same text: %+v", d)
	}
	if d := GateDiff("w", &a, b); len(d) != 1 || d[0].Kind != DiffContent {
		t.Errorf("other text: %+v", d)
	}

	old := Reading{Kind: ReadingFeed, Items: []extract.FeedItem{{ID: "1", Title: "one"}}, Seen: []string{"1"}, At: t0}
	same := old
	if d := GateDiff("w", &old, same); WakeAgent(d) {
		t.Errorf("same feed: %+v", d)
	}
	grown := Reading{Kind: ReadingFeed, Items: []extract.FeedItem{{ID: "2", Title: "two"}, {ID: "1", Title: "one"}}, At: t0}
	if d := GateDiff("w", &old, grown); len(d) != 1 || d[0].Kind != DiffContent {
		t.Errorf("new item: %+v", d)
	}
}

// Schema.org Offer availability lands in the reading a check saves.
func TestReadingCarriesOfferAvailability(t *testing.T) {
	w := shopWatch(t, Rule{Kind: RuleBelow, Threshold: f(90000)})
	read := func(avail string) Reading {
		t.Helper()
		r, err := extractReading(w, &fetch.Response{Status: 200, ContentType: "text/html; charset=utf-8", Body: flipkartPage(t, "89999", avail)}, t0)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	for avail, want := range map[string]string{
		"http://schema.org/OutOfStock": extract.AvailOutOfStock,
		"http://schema.org/InStock":    extract.AvailInStock,
		"https://schema.org/PreOrder":  extract.AvailPreorder,
		"":                             extract.AvailUnknown,
	} {
		if r := read(avail); r.Availability != want {
			t.Errorf("%q: reading availability %q, want %q", avail, r.Availability, want)
		}
	}
	// The gate: the same price, now buyable.
	before, after := read("http://schema.org/OutOfStock"), read("http://schema.org/InStock")
	if d := GateDiff(w.ID, &before, after); len(d) != 1 || d[0].Kind != DiffAvailability {
		t.Errorf("restock at the same price: %+v", d)
	}
}
