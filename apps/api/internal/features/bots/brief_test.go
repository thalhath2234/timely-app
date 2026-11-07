package bots

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestNextBriefAt(t *testing.T) {
	london, err := time.LoadLocation("Europe/London")
	must(t, err)
	kolkata, err := time.LoadLocation("Asia/Kolkata")
	must(t, err)
	utc := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		must(t, err)
		return v
	}
	for _, c := range []struct {
		name  string
		loc   *time.Location
		hhmm  string
		after string
		want  string
	}{
		// Clocks go forward in London on 29 March 2026 and back on 25 October.
		{"the day before spring forward", london, "08:00", "2026-03-28T09:00:00Z", "2026-03-29T07:00:00Z"},
		{"later on spring forward day", london, "08:00", "2026-03-29T07:30:00Z", "2026-03-30T07:00:00Z"},
		{"the day before fall back", london, "08:00", "2026-10-24T08:00:00Z", "2026-10-25T08:00:00Z"},
		{"earlier the same day", london, "18:30", "2026-10-25T08:00:00Z", "2026-10-25T18:30:00Z"},
		{"exactly at its time goes to tomorrow", london, "08:00", "2026-11-07T08:00:00Z", "2026-11-08T08:00:00Z"},
		{"India, before its time", kolkata, "08:00", "2026-11-07T02:00:00Z", "2026-11-07T02:30:00Z"},
		{"India, after its time", kolkata, "08:00", "2026-11-07T03:00:00Z", "2026-11-08T02:30:00Z"},
		{"India, late evening", kolkata, "23:45", "2026-11-07T18:00:00Z", "2026-11-07T18:15:00Z"},
		{"not a time is 08:00", kolkata, "8am", "2026-11-07T03:00:00Z", "2026-11-08T02:30:00Z"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := nextBriefAt(c.loc, c.hhmm, utc(c.after)); !got.Equal(utc(c.want)) || got.Location() != time.UTC {
				t.Fatalf("nextBriefAt(%s, %s) = %s, want %s", c.hhmm, c.after, got, c.want)
			}
		})
	}
	// 01:30 does not exist in London on spring forward day: it still falls
	// on that day, after the time asked from.
	after := utc("2026-03-29T00:00:00Z")
	got := nextBriefAt(london, "01:30", after)
	if !got.After(after) || got.Sub(after) > 3*time.Hour {
		t.Fatalf("a time in the gap gave %s", got)
	}
}

func TestBriefLine(t *testing.T) {
	price := Finding{Kind: "price", Title: "below ₹25,000", Why: "Now ₹24,999 (was ₹27,000)"}
	if got := briefLine("GPU deals", price); got != "GPU deals: below ₹25,000 · Now ₹24,999 (was ₹27,000)" {
		t.Fatalf("price line %q", got)
	}
	item := Finding{Kind: "item", Title: "Samsung 990 Pro 2TB", Why: "New in example.com · 7 Nov 08:10"}
	if got := briefLine("Deals feed", item); got != "Deals feed: Samsung 990 Pro 2TB" {
		t.Fatalf("item line %q", got)
	}
	long := Finding{Kind: "price", Title: strings.Repeat("t", 120), Why: strings.Repeat("w", 400)}
	got := briefLine(strings.Repeat("n", 80), long)
	if utf8.RuneCountInString(got) != maxBriefLine || !strings.HasSuffix(got, "…") {
		t.Fatalf("long line is %d runes: %q", utf8.RuneCountInString(got), got)
	}
}

func TestBriefDigest(t *testing.T) {
	a, b, gone := BotRef{BotID: "bot_a", Name: "Deals"}, BotRef{BotID: "bot_b", Name: "Prices"}, BotRef{BotID: "bot_c", Name: "Quiet"}
	at := time.Date(2026, 11, 7, 8, 0, 0, 0, time.UTC)
	var notes []Finding // newest first
	for i := range 7 {
		notes = append(notes, Finding{BotID: "bot_a", Kind: "item", Title: fmt.Sprintf("Item %d", i), CreatedAt: at.Add(-time.Duration(i) * time.Minute)})
	}
	notes = append(notes, Finding{BotID: "bot_b", Kind: "price", Title: "below $10", Why: "Now $9", CreatedAt: at.Add(-time.Hour)},
		Finding{BotID: "bot_x", Kind: "item", Title: "Not a source"})
	// Prices was added first, so it lists first.
	d := groupBrief([]BotRef{b, a, gone}, notes)
	if d.n != 8 || len(d.groups) != 2 || d.groups[0].bot != b || d.groups[1].bot != a || len(d.groups[1].notes) != BriefItemsPerBot || d.groups[1].more != 2 {
		t.Fatalf("digest %+v", d)
	}
	lines := d.lines()
	want := []string{"Prices: below $10 · Now $9", "Deals: Item 0", "Deals: Item 1", "Deals: Item 2", "Deals: Item 3", "Deals: Item 4", "and 2 more"}
	if !slices.Equal(lines, want) {
		t.Fatalf("lines %q", lines)
	}
	what, body := d.template()
	if what != "8 new from 2 bots" || body != strings.Join(append(want[:6:6], "and 2 more"), "\n") {
		t.Fatalf("template %q / %q", what, body)
	}
	one := groupBrief([]BotRef{a}, notes[:1])
	if what, body := one.template(); what != "1 new from 1 bot" || body != "Deals: Item 0" {
		t.Fatalf("one note %q / %q", what, body)
	}
	in := d.input()
	if len(in) != 2 || in[1].Bot != "Deals" || len(in[1].Lines) != BriefItemsPerBot || in[1].More != 2 || in[0].Lines[0] != "below $10 · Now $9" {
		t.Fatalf("AI input %+v", in)
	}
	if got := cleanBody("One\n\n two​ \nthree\nfour\nfive\nsix\nseven\neight"); got != "One\ntwo\nthree\nfour\nfive\nsix\nseven" {
		t.Fatalf("cleanBody %q", got)
	}
}
