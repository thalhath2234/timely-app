package bots

import (
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"timely-api/internal/features/bots/extract"
)

func TestStripMark(t *testing.T) {
	cases := map[string]byte{
		outBaseline: 'n', outUnchanged: 'n', outNotModified: 'n',
		outChanged: 'c', outFired: 'f', outStrike: 'x',
		outOffline: 'o', outRateLimited: 'o', outSiteBusy: 'o', outRobots: 'o',
		outSuperseded: 0, "something new": 0,
	}
	for outcome, want := range cases {
		if got := stripMark(outcome); got != want {
			t.Errorf("stripMark(%q) = %q, want %q", outcome, got, want)
		}
	}
	// Newest first in, oldest first out, superseded checks left out.
	if got := stripOf([]string{outFired, outSuperseded, outStrike, outOffline, outBaseline}); got != "noxf" {
		t.Fatalf("strip %q", got)
	}
	if got := stripOf(nil); got != "" {
		t.Fatalf("empty strip %q", got)
	}
}

func TestExcerpt(t *testing.T) {
	long := strings.Repeat("word ", 60)
	page := "Welcome\nHeadphones in stock: Add to cart now\nFooter"
	cases := []struct {
		name string
		w    Watch
		want string
	}{
		{"no reading", Watch{Kind: WatchPage, ReadMode: ReadSelector}, ""},
		{"selector text, spaces collapsed", Watch{Kind: WatchPage, ReadMode: ReadSelector,
			LastReading: &Reading{Kind: ReadingText, Text: "  Release:\n 14 Jan  2027 "}}, "Release: 14 Jan 2027"},
		{"selector text clipped", Watch{Kind: WatchPage, ReadMode: ReadSelector,
			LastReading: &Reading{Kind: ReadingText, Text: long}}, strings.TrimSpace(strings.Repeat("word ", 32)[:159]) + "…"},
		{"page line with the words rule's first word", Watch{Kind: WatchPage, ReadMode: ReadText,
			Rules:       jsonList[Rule]{{Kind: RuleAnyChange}, {Kind: RuleWordsAppear, Words: []string{"add to cart", "buy"}}},
			LastReading: &Reading{Kind: ReadingText, Text: page}}, "Headphones in stock: Add to cart now"},
		{"page without a words rule", Watch{Kind: WatchPage, ReadMode: ReadText, Rules: jsonList[Rule]{{Kind: RuleAnyChange}},
			LastReading: &Reading{Kind: ReadingText, Text: page}}, ""},
		{"page where the word is gone", Watch{Kind: WatchPage, ReadMode: ReadText,
			Rules:       jsonList[Rule]{{Kind: RuleWordsDisappear, Words: []string{"sold out"}}},
			LastReading: &Reading{Kind: ReadingText, Text: page}}, ""},
		{"feed: newest item", Watch{Kind: WatchFeed, LastReading: &Reading{Kind: ReadingFeed, Items: []extract.FeedItem{
			{ID: "1", Title: "Older", Published: botNow.Add(-time.Hour)},
			{ID: "2", Title: "Newer  one", Published: botNow},
		}}}, "Newer one"},
		{"price has none", Watch{Kind: WatchPrice, LastReading: &Reading{Kind: ReadingPrice, Price: f64(5)}}, ""},
		{"shop price has none", Watch{Kind: WatchPage, ReadMode: ReadProductPrice, LastReading: &Reading{Kind: ReadingPrice, Price: f64(5)}}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := excerpt(c.w)
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
			if utf8.RuneCountInString(got) > maxExcerpt {
				t.Fatalf("%d runes", utf8.RuneCountInString(got))
			}
		})
	}
}

func TestNewestItems(t *testing.T) {
	items := []extract.FeedItem{
		{ID: "a", Title: "No date A", Link: "https://x.test/a"},
		{ID: "b", Title: "Old", Published: botNow.Add(-48 * time.Hour)},
		{ID: "c", Title: "New", Published: botNow},
		{ID: "d", Title: "No date D"},
	}
	got := newestItems(items, 3)
	if len(got) != 3 || got[0].Title != "New" || got[1].Title != "Old" || got[2].Title != "No date A" {
		t.Fatalf("newest %+v", got)
	}
	if got[0].PublishedAt == nil || !got[0].PublishedAt.Equal(botNow) || got[2].PublishedAt != nil || got[2].URL != "https://x.test/a" {
		t.Fatalf("item fields %+v", got)
	}
	if items[0].ID != "a" {
		t.Fatal("newestItems reordered the reading's items")
	}
	bad := []extract.FeedItem{{ID: "j", Link: "javascript:alert(1)"}, {ID: "i", Link: "intent://x#Intent;end"}, {ID: "f", Link: "file:///etc/passwd"}, {ID: "r", Link: "/relative"}}
	for _, it := range newestItems(bad, 4) {
		if it.URL != "" {
			t.Fatalf("unsafe link kept: %q", it.URL)
		}
	}
	if got := newestItems(nil, 5); len(got) != 0 {
		t.Fatalf("no items: %+v", got)
	}
}

// days builds n daily closes ending the day before end, oldest first, with
// close = 100 + i.
func days(end time.Time, n int) []dayClose {
	out := make([]dayClose, 0, n)
	for i := n; i >= 1; i-- {
		c := float64(100 + n - i)
		out = append(out, dayClose{Day: end.AddDate(0, 0, -i).Format(dayLayout), Open: f64(c - 1), Close: f64(c)})
	}
	return out
}

func TestSparkKeepsThirtyClosesAndTheReading(t *testing.T) {
	r := Reading{Kind: ReadingPrice, Price: f64(500), At: botNow}
	today := dayClose{Day: botNow.Format(dayLayout), Open: f64(400), Close: f64(450)}
	spark := sparkOf(append(days(botNow, 45), today), r)
	if len(spark) != sparkDays+1 {
		t.Fatalf("%d points, want %d", len(spark), sparkDays+1)
	}
	// The oldest kept close is 30 days back: close 100+45-30 = 115.
	first, last := spark[0], spark[len(spark)-1]
	if first[1] != 115 || last != [2]float64{float64(botNow.Unix()), 500} {
		t.Fatalf("first %v last %v", first, last)
	}
	yesterdayEnd := time.Date(2026, 11, 5, 23, 59, 59, 0, time.UTC)
	if spark[len(spark)-2] != [2]float64{float64(yesterdayEnd.Unix()), 144} {
		t.Fatalf("yesterday's close %v", spark[len(spark)-2])
	}
	for i := 1; i < len(spark); i++ {
		if spark[i][0] <= spark[i-1][0] {
			t.Fatalf("not oldest first at %d: %v", i, spark)
		}
	}
	// A few days, a gap and a missing close.
	few := []dayClose{{Day: "2026-11-01", Close: f64(10)}, {Day: "2026-11-03"}, {Day: "2026-11-04", Close: f64(12)}}
	if got := sparkOf(few, r); len(got) != 3 || got[0][1] != 10 || got[1][1] != 12 {
		t.Fatalf("few days %v", got)
	}
	if got := sparkOf(nil, Reading{Kind: ReadingPrice, Price: f64(1), At: botNow}); len(got) != 1 {
		t.Fatalf("no days %v", got)
	}
}

func TestDayChangePct(t *testing.T) {
	r := Reading{Kind: ReadingPrice, Price: f64(105), At: botNow}
	yesterday := dayClose{Day: "2026-11-05", Open: f64(90), Close: f64(100)}
	today := dayClose{Day: "2026-11-06", Open: f64(84), Close: f64(105)}
	older := dayClose{Day: "2026-11-04", Close: f64(50)}
	cases := []struct {
		name string
		days []dayClose
		r    Reading
		want *float64
	}{
		{"against yesterday's close", []dayClose{older, yesterday, today}, r, f64(5)},
		{"no yesterday: today's open", []dayClose{older, today}, r, f64(25)},
		{"a drop", []dayClose{yesterday}, Reading{Kind: ReadingPrice, Price: f64(97.5), At: botNow}, f64(-2.5)},
		{"rounded to 2 places", []dayClose{{Day: "2026-11-05", Close: f64(3)}}, Reading{Price: f64(4), At: botNow}, f64(33.33)},
		{"nothing to compare", []dayClose{older}, r, nil},
		{"zero reference", []dayClose{{Day: "2026-11-05", Close: f64(0)}}, r, nil},
		{"no price", []dayClose{yesterday}, Reading{Kind: ReadingPrice, At: botNow}, nil},
		{"the reading's own day counts, not today", []dayClose{{Day: "2026-10-31", Close: f64(200)}, yesterday},
			Reading{Price: f64(210), At: time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)}, f64(5)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dayChangePct(c.days, c.r)
			if fmt.Sprint(deref64(got)) != fmt.Sprint(deref64(c.want)) {
				t.Fatalf("got %v, want %v", deref64(got), deref64(c.want))
			}
		})
	}
}

func deref64(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestWatchTitle(t *testing.T) {
	cases := []struct {
		w    Watch
		want string
	}{
		{Watch{Kind: WatchPage, URL: "https://www.amazon.in/dp/B0C", ReadMode: ReadProductPrice,
			LastReading: &Reading{Kind: ReadingPrice, Title: "Sony WH-1000XM6 Wireless"}}, "amazon.in · Sony WH-1000XM6 Wireless"},
		{Watch{Kind: WatchPage, URL: "https://www.amazon.in/dp/B0C", ReadMode: ReadProductPrice}, "amazon.in · Product price"},
		{Watch{Kind: WatchPage, URL: "https://news.example.co.uk/x", ReadMode: ReadSelector}, "example.co.uk · One part of the page"},
		{Watch{Kind: WatchPage, URL: "https://example.com/", ReadMode: ReadText}, "example.com · Page text"},
		{Watch{Kind: WatchFeed, URL: "https://www.reddit.com/r/buildapcsales/.rss"}, "reddit.com · Feed"},
		{Watch{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "USD"}, "BTC-USD · Coinbase"},
		{Watch{Kind: WatchPrice, Source: "finnhub", Symbol: "NVDA"}, "NVDA · Finnhub"},
		{Watch{Kind: WatchPrice, Source: "finnhub", Symbol: "NVDA", Currency: "USD"}, "NVDA · Finnhub"},
	}
	for _, c := range cases {
		if got := watchTitle(c.w); got != c.want {
			t.Errorf("watchTitle(%s %s) = %q, want %q", c.w.Kind, c.w.URL, got, c.want)
		}
	}
}

func TestViewBoardFields(t *testing.T) {
	started := botNow.Add(-time.Hour)
	job := "job_1"
	b := Bot{ID: "bot_1", Origin: OriginMCP, OriginClient: "Claude Code", CheckStartedAt: &started, CheckingJobID: &job, IntervalSeconds: 6 * 3600}
	shop := Watch{ID: "bw_1", Kind: WatchPage, URL: "https://www.amazon.in/dp/B0C", ReadMode: ReadProductPrice,
		LastReading: &Reading{Kind: ReadingPrice, Price: f64(27499), Currency: "INR", Title: "Sony", At: botNow}}
	bd := &board{days: map[string][]dayClose{"bw_1": {{Day: "2026-11-05", Close: f64(25000)}}}, strips: map[string]string{"bot_1": "nnc"}}
	v := viewOf(b, []Watch{shop}, bd, botNow)
	if v.OriginClient != "Claude Code" || !v.Checking || v.Strip != "nnc" || v.FloorLine != "Shop prices are checked every 6 hours at most" {
		t.Fatalf("view %+v", v)
	}
	if want := started.Add(MinProductEvery - FenceSlack); v.RunNowAt == nil || !v.RunNowAt.Equal(want) {
		t.Fatalf("runNowAt %v, want %v", v.RunNowAt, want)
	}
	w := v.Watches[0]
	if w.Site != "amazon.in" || w.Title != "Sony" || *w.Value != 27499 || len(w.Spark) != 2 || *w.DayChangePct != 10 {
		t.Fatalf("watch %+v", w)
	}
	// Long after the floor, Run now is free; a Bot not from MCP names no app.
	b.Origin, b.CheckingJobID = OriginApp, nil
	v = viewOf(b, []Watch{{ID: "bw_2", Kind: WatchPrice, Source: "coinbase", Symbol: "BTC"}}, nil, botNow.Add(24*time.Hour))
	if v.RunNowAt != nil || v.OriginClient != "" || v.Checking || v.Watches[0].Site != "" || v.Watches[0].Spark == nil || v.Watches[0].Value != nil {
		t.Fatalf("plain view %+v", v)
	}
}

func TestCleanOriginClient(t *testing.T) {
	cases := map[string]string{
		"Claude Code":            "Claude Code",
		"  Claude\tCode\n":       "Claude Code",
		"Bad\x00\x07name​‮ here": "Badname here",
		strings.Repeat("é", 80):  strings.Repeat("é", maxOriginClient),
		"":                       "",
	}
	for in, want := range cases {
		if got := cleanOriginClient(in); got != want {
			t.Errorf("cleanOriginClient(%q) = %q, want %q", in, got, want)
		}
	}
}

// A page's title is kept for showing the watch, never judged: no rule fires
// and nothing counts as a change when only the title moves.
func TestTitleNeverFiresARule(t *testing.T) {
	text := Reading{Kind: ReadingText, Text: "In stock. Add to cart", Hash: extract.Hash("In stock. Add to cart"), Title: "Old name", At: botNow}
	retitled := text
	retitled.Title, retitled.At = "New name with Add to cart and sold out", botNow.Add(time.Hour)
	price := Reading{Kind: ReadingPrice, Price: f64(100), Currency: "INR", Title: "Old name", At: botNow}
	repriced := price
	repriced.Title, repriced.At = "New name", botNow.Add(time.Hour)
	cases := []struct {
		kind, mode string
		prev, cur  Reading
		rules      []Rule
	}{
		{WatchPage, ReadText, text, retitled, []Rule{{Kind: RuleAnyChange}, {Kind: RuleWordsAppear, Words: []string{"sold out"}},
			{Kind: RuleWordsDisappear, Words: []string{"add to cart"}}}},
		{WatchPage, ReadProductPrice, price, repriced, []Rule{{Kind: RuleAnyChange}, {Kind: RuleBelow, Threshold: f64(150)},
			{Kind: RuleAbove, Threshold: f64(50)}, {Kind: RuleMovePct, Percent: f64(1), Direction: DirAny}}},
	}
	for _, c := range cases {
		rules, err := CleanRules(c.kind, c.mode, c.rules)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rules {
			st := Rebaseline(r, c.prev)
			if ev, _ := Evaluate(r, st, c.prev, c.cur); ev != nil {
				t.Errorf("%s %s fired on a title change", c.mode, r.Kind)
			}
		}
		if watchChanged(c.prev, c.cur) {
			t.Errorf("%s: a title change counts as a change", c.mode)
		}
	}
}
