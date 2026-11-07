package bots

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
)

func f64(v float64) *float64 { return &v }

func priceReading(v float64, cur string) Reading {
	return Reading{Kind: ReadingPrice, Price: &v, Currency: cur}
}

func TestAlertText(t *testing.T) {
	stock := Watch{ID: "bw_1", Kind: WatchPrice, Source: "finnhub", Symbol: "AAPL", Currency: "USD"}
	coin := Watch{ID: "bw_2", Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "INR"}
	shop := Watch{ID: "bw_3", Kind: WatchPage, ReadMode: ReadProductPrice, URL: "https://shop.example.in/p/1"}
	page := Watch{ID: "bw_4", Kind: WatchPage, ReadMode: ReadText, URL: "https://example.com/"}
	feed := Watch{ID: "bw_5", Kind: WatchFeed, URL: "https://example.com/rss"}
	items := []extract.FeedItem{{ID: "a", Title: "Kernel 7.1 released"}, {ID: "b", Title: "Two"}, {ID: "c", Title: "Three"}}

	cases := []struct {
		name       string
		f          firedEvent
		what, body string
	}{
		{"below", firedEvent{w: stock, rule: Rule{Kind: RuleBelow, Threshold: f64(190)}, ref: f64(191.05),
			ev: Event{Before: priceReading(191.05, "USD"), After: priceReading(187.2, "USD")}},
			"below 190", "AAPL now $187.20 (was $191.05)"},
		{"above, shop price in rupees", firedEvent{w: shop, rule: Rule{Kind: RuleAbove, Threshold: f64(25000)}, ref: f64(24999),
			ev: Event{Before: priceReading(24999, "INR"), After: priceReading(27499, "INR")}},
			"above 25,000", "Now ₹27,499 (was ₹24,999)"},
		{"move down", firedEvent{w: coin, rule: Rule{Kind: RuleMovePct, Percent: f64(5), Direction: DirAny}, ref: f64(6131000),
			ev: Event{Before: priceReading(6000000, "INR"), After: priceReading(5812300, "INR")}},
			"down 5.2%", "BTC now ₹5,812,300 (was ₹6,131,000)"},
		{"move up in another currency", firedEvent{w: Watch{Kind: WatchPrice, Symbol: "ETH"}, rule: Rule{Kind: RuleMovePct, Percent: f64(5)}, ref: f64(1000),
			ev: Event{After: priceReading(1236.5, "CHF")}},
			"up 23.6%", "ETH now 1,236.50 CHF (was 1,000 CHF)"},
		{"page changed", firedEvent{w: page, rule: Rule{Kind: RuleAnyChange},
			ev: Event{Before: Reading{Kind: ReadingText, Text: "Title\nIn stock: 3"}, After: Reading{Kind: ReadingText, Text: "Title\nIn stock: 1"}}},
			"page changed", "In stock: 1"},
		{"price changed", firedEvent{w: shop, rule: Rule{Kind: RuleAnyChange},
			ev: Event{Before: priceReading(100, "EUR"), After: priceReading(99.5, "EUR")}},
			"price changed", "Now €99.50 (was €100)"},
		{"words appear", firedEvent{w: page, rule: Rule{Kind: RuleWordsAppear, Words: []string{"Sold out", "Back soon"}},
			ev: Event{After: Reading{Kind: ReadingText, Text: "Blue mug\nBack soon, sorry"}}},
			"“Back soon” appeared", "Back soon, sorry"},
		{"words disappear", firedEvent{w: page, rule: Rule{Kind: RuleWordsDisappear, Words: []string{"Sold out"}},
			ev: Event{Before: Reading{Kind: ReadingText, Text: "Blue mug\nSold out"}, After: Reading{Kind: ReadingText, Text: "Blue mug\nAdd to cart"}}},
			"“Sold out” disappeared", "It is no longer on the page."},
		{"new items", firedEvent{w: feed, rule: Rule{Kind: RuleNewItem}, ev: Event{NewItems: items}},
			"3 new items", "Kernel 7.1 released and 2 more"},
		{"one new item", firedEvent{w: feed, rule: Rule{Kind: RuleNewItem}, ev: Event{NewItems: items[:1]}},
			"1 new item", "Kernel 7.1 released"},
	}
	for _, c := range cases {
		what, body, _ := alertText([]firedEvent{c.f})
		if what != c.what || body != c.body {
			t.Errorf("%s: got %q / %q, want %q / %q", c.name, what, body, c.what, c.body)
		}
	}

	two := []firedEvent{cases[0].f, cases[1].f}
	if _, body, _ := alertText(two); body != "AAPL now $187.20 (was $191.05) (+1 more)" {
		t.Errorf("two rules: %q", body)
	}
	long := firedEvent{w: page, rule: Rule{Kind: RuleAnyChange}, ev: Event{After: Reading{Kind: ReadingText, Text: strings.Repeat("é", 300)}}}
	if _, body, _ := alertText([]firedEvent{long}); len([]rune(body)) != maxChangedLine {
		t.Errorf("changed line is %d characters", len([]rune(body)))
	}
}

var errFake = errors.New("database is down")

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestHeldSuffix(t *testing.T) {
	kolkata, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 6, 20, 44, 0, 0, time.UTC) // 02:14 in Kolkata
	if got := withHeldTime("Price check: below 25,000", at, kolkata); got != "Price check: below 25,000 (at 02:14)" {
		t.Fatalf("held title %q", got)
	}
}

func TestAlertDataHasNoKind(t *testing.T) {
	b := Bot{ID: "bot_1", Urgent: true, NotifyDesktop: true, NotifyPhone: false}
	for _, kind := range []string{alertKindAlert, alertKindMore, alertKindPaused} {
		data := alertData(b, "bal_1", "bchk_1", "https://example.com/", kind)
		if _, ok := data["kind"]; ok {
			t.Fatalf("%s data has a kind key: %v", kind, data)
		}
		if data["botAlert"] != kind || data["botId"] != "bot_1" || data["urgent"] != true || data["phone"] != false || data["desktop"] != true {
			t.Fatalf("%s data %v", kind, data)
		}
	}
	n := botNotification(b, "t", "b", "k", alertData(b, "bal_1", "bchk_1", "", alertKindAlert))
	if *n.EntityType != "bot" || *n.EntityID != "bot_1" || n.Category != "bot" {
		t.Fatalf("notification %+v", n)
	}
}

func TestAwayFor(t *testing.T) {
	for d, want := range map[time.Duration]string{
		45 * time.Minute: "45 minutes", 9 * time.Hour: "9 hours", time.Hour + 40*time.Minute: "2 hours",
		72 * time.Hour: "3 days", 90 * time.Minute: "2 hours", time.Minute: "1 minute",
	} {
		if got := awayFor(d); got != want {
			t.Errorf("%s: %q, want %q", d, got, want)
		}
	}
}

func TestClipReading(t *testing.T) {
	r := Reading{Kind: ReadingText, Text: strings.Repeat("\"<", 40000), Hash: "h"}
	got := clipReading(r, MaxReadingBytes)
	if raw := mustJSON(t, got); len(raw) > MaxReadingBytes || got.Text == "" || got.Hash != "h" {
		t.Fatalf("clipped to %d bytes", len(raw))
	}
	small := Reading{Kind: ReadingText, Text: "short"}
	if clipReading(small, MaxReadingBytes).Text != "short" {
		t.Fatal("a small reading was cut")
	}
}

func TestDescribeErr(t *testing.T) {
	page := Watch{Kind: WatchPage, ReadMode: ReadSelector, URL: "https://www.amazon.in/dp/X"}
	if p := describeErr(page, errUnreadable); p.code != "unsupported" || p.class != classStrike {
		t.Fatalf("unreadable %+v", p)
	}
	if p := describeErr(page, extract.ErrEmpty); p.code != "cant_find" || p.line != "The selector matched nothing on the page" {
		t.Fatalf("empty %+v", p)
	}
	if p := describeErr(page, extract.ErrTooComplex); p.code != "too_big" || p.class != classStrike {
		t.Fatalf("too complex %+v", p)
	}
	if p := describeErr(page, errFake); p != nil {
		t.Fatalf("an unknown error is not a site problem: %+v", p)
	}
}
