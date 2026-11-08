package bots

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"
	"time"

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
