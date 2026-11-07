package bots

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
)

func inputMsg(t *testing.T, err error) string {
	t.Helper()
	var in *InputError
	if !errors.As(err, &in) {
		t.Fatalf("want *InputError, got %v", err)
	}
	return in.Message
}

func TestCleanName(t *testing.T) {
	if got, err := cleanName("  Price   watch \x00 "); err != nil || got != "Price watch" {
		t.Fatalf("%q %v", got, err)
	}
	if msg := inputMsg(t, second(cleanName("   "))); msg != "Give the bot a name" {
		t.Fatal(msg)
	}
	if msg := inputMsg(t, second(cleanName(strings.Repeat("é", 81)))); !strings.Contains(msg, "80") {
		t.Fatal(msg)
	}
	if _, err := cleanName(strings.Repeat("é", 80)); err != nil {
		t.Fatal(err)
	}
	if _, err := cleanDescription(strings.Repeat("x", 2001)); err == nil {
		t.Fatal("long description")
	}
	if j, err := cleanJudge(""); err != nil || j != JudgeRules {
		t.Fatal(j, err)
	}
	if msg := inputMsg(t, second(cleanJudge("ai"))); msg != "AI judging arrives in a later version" {
		t.Fatal(msg)
	}
}

func second[T any](_ T, err error) error { return err }

func TestCleanURL(t *testing.T) {
	ok := []string{"https://www.amazon.in/dp/B0C?x=1", "http://example.com/feed.xml", "https://example.com:443/a"}
	for _, u := range ok {
		if got, err := cleanURL("  "+u+" ", "page"); err != nil || got != u {
			t.Errorf("%s: %q %v", u, got, err)
		}
	}
	bad := map[string]string{
		"":                           "Give the page's web address",
		"ftp://example.com/x":        "Use an http or https link",
		"https://me:pw@example.com/": "Use a plain web link",
		"https://example.com:8080/":  "Timely only reads public web addresses on ports 80 and 443",
		"http://127.0.0.1/":          "Timely only reads public web addresses",
		"http://[::1]/":              "Timely only reads public web addresses",
		"http://192.168.1.10/admin":  "Timely only reads public web addresses",
		"http://localhost/":          "Timely only reads public web addresses",
		"http://app.localhost./":     "Timely only reads public web addresses",
		"example.com/page":           "Use an http or https link",
		"https://e.com/" + strings.Repeat("a", MaxURLLen): "Keep the web address under 2048 characters",
	}
	for u, want := range bad {
		if msg := inputMsg(t, second(cleanURL(u, "page"))); msg != want {
			t.Errorf("%q: %q, want %q", u, msg, want)
		}
	}
}

func TestCleanPrice(t *testing.T) {
	cases := []struct{ source, symbol, currency, wantSrc, wantSym, wantCur string }{
		{"crypto", "btc", "inr", "coinbase", "BTC", "INR"},
		{"Coinbase", "eth", "", "coinbase", "ETH", "USD"},
		{"yahoo", "reliance.ns", "", "yahoo", "RELIANCE.NS", ""},
		{"coingecko", "Bitcoin", "eur", "coingecko", "bitcoin", "EUR"},
	}
	for _, c := range cases {
		src, sym, cur, err := cleanPrice(c.source, c.symbol, c.currency)
		if err != nil || src != c.wantSrc || sym != c.wantSym || cur != c.wantCur {
			t.Errorf("%+v: %s %s %s %v", c, src, sym, cur, err)
		}
	}
	for _, c := range []struct{ source, symbol, currency, want string }{
		{"", "AAPL", "", "Say where the price comes from"},
		{"nasdaq", "AAPL", "", `"nasdaq" is not a price source`},
		{"finnhub", "", "", "Give the price watch a symbol"},
		{"finnhub", "AAPL", "EUR", "does not quote prices"},
		// No key can be saved yet, so a keyed source could only fail.
		{"stock", "aapl", "", "Stock prices need a Finnhub API key, and Timely cannot save one yet"},
		{"finnhub", "AAPL", "", "need a Finnhub API key"},
		{"coinbase", "BTC-USD!", "", "is not a"},
	} {
		if msg := inputMsg(t, cleanPrice4(c.source, c.symbol, c.currency)); !strings.Contains(msg, c.want) {
			t.Errorf("%+v: %q", c, msg)
		}
	}
}

func cleanPrice4(a, b, c string) error { _, _, _, err := cleanPrice(a, b, c); return err }

func TestCleanInterval(t *testing.T) {
	page := []Watch{{Kind: WatchPage, ReadMode: ReadText}}
	shop := []Watch{{Kind: WatchPage, ReadMode: ReadProductPrice}, {Kind: WatchPrice}}
	prices := []Watch{{Kind: WatchPrice}}
	if s, err := cleanInterval(0, page); err != nil || s != 3600 {
		t.Fatal(s, err)
	}
	if s, err := cleanInterval(0, prices); err != nil || s != 900 {
		t.Fatal(s, err)
	}
	if s, err := cleanInterval(5, prices); err != nil || s != 300 {
		t.Fatal(s, err)
	}
	for _, c := range []struct {
		minutes int
		ws      []Watch
		want    string
	}{
		{10, page, "Pages and feeds are checked every 15 minutes at most"},
		{60, shop, "Shop prices are checked every 6 hours at most"},
		{4, prices, "Prices are checked every 5 minutes at most"},
		{-1, page, "Give the interval in minutes"},
		{10081, page, "Check at least once a week (10080 minutes)"},
	} {
		if msg := inputMsg(t, second(cleanInterval(c.minutes, c.ws))); msg != c.want {
			t.Errorf("%d: %q", c.minutes, msg)
		}
	}
	if s, err := cleanInterval(10080, page); err != nil || s != 604800 {
		t.Fatal(s, err)
	}
}

func TestCleanWatches(t *testing.T) {
	page := WatchInput{Kind: "Page", URL: "https://example.com/"}
	ws, err := cleanWatches([]WatchInput{page, {Kind: "feed", URL: "https://example.com/rss"}, {Kind: "price", Source: "crypto", Symbol: "btc"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ws[0].Kind != WatchPage || ws[0].ReadMode != ReadText || ws[0].Rules[0].Kind != RuleAnyChange || ws[0].Rules[0].ID != "" {
		t.Fatalf("page %+v", ws[0])
	}
	if ws[1].Rules[0].Kind != RuleNewItem || ws[2].Position != 2 || ws[2].Source != "coinbase" || ws[2].Currency != "USD" {
		t.Fatalf("feed/price %+v %+v", ws[1], ws[2])
	}

	six := make([]WatchInput, 6)
	for i := range six {
		six[i] = page
	}
	for _, c := range []struct {
		in   []WatchInput
		want string
	}{
		{nil, "Give the bot something to watch"},
		{six, "A bot can watch up to 5 things"},
		{[]WatchInput{{Kind: "tweet"}}, "A watch is a page, a feed or a price"},
		{[]WatchInput{{Kind: "page", URL: "https://e.com", Read: "pdf"}}, "Read a page as text, selector or product_price"},
		{[]WatchInput{{Kind: "page", URL: "https://e.com", Read: "selector"}}, "The CSS selector is empty"},
		{[]WatchInput{{Kind: "page", URL: "https://e.com", Read: "selector", Selector: "div[["}}, "The CSS selector is not valid"},
		{[]WatchInput{{Kind: "page", URL: "https://e.com", Selector: ".price"}}, "Only a page read with a selector"},
		{[]WatchInput{{Kind: "page", URL: "https://e.com", Symbol: "AAPL"}}, "A page watch takes no price source"},
		{[]WatchInput{{Kind: "feed", URL: "https://e.com", Read: "text"}}, "A feed is read whole"},
		{[]WatchInput{{Kind: "price", URL: "https://e.com", Source: "stock", Symbol: "AAPL"}}, "A price watch takes a source and a symbol"},
		{[]WatchInput{{Kind: "page", URL: "https://e.com", Rules: []Rule{{Kind: RuleNewItem}}}}, "does not fit this watch"},
		{[]WatchInput{page, {Kind: "feed"}}, "Watch 2: Give the feed's web address"},
		{[]WatchInput{{ID: "bw_x", Kind: "page", URL: "https://e.com"}}, "This watch is not on the bot"},
	} {
		if msg := inputMsg(t, second(cleanWatches(c.in, nil))); !strings.Contains(msg, c.want) {
			t.Errorf("%v: %q, want %q", c.in, msg, c.want)
		}
	}
	sel, err := cleanWatches([]WatchInput{{Kind: "page", URL: "https://e.com", Read: "selector", Selector: " .price "}}, nil)
	if err != nil || sel[0].Selector != ".price" {
		t.Fatal(sel, err)
	}
}

// An edited watch sent without rules keeps its rules while it still reads
// the same kind of thing; one that changes kind gets the defaults.
func TestCleanWatchKeepsRules(t *testing.T) {
	old := Watch{ID: "bw_1", Kind: WatchPage, ReadMode: ReadText, URL: "https://e.com",
		Rules: jsonList[Rule]{{ID: "brl_1", Kind: RuleWordsAppear, Words: []string{"in stock"}}}}
	prev := map[string]Watch{old.ID: old}
	ws, err := cleanWatches([]WatchInput{{ID: "bw_1", Kind: "page", URL: "https://e.com/new", Read: "selector", Selector: "h1"}}, prev)
	if err != nil || len(ws[0].Rules) != 1 || ws[0].Rules[0].ID != "brl_1" || ws[0].ID != "bw_1" {
		t.Fatalf("%+v %v", ws, err)
	}
	ws, err = cleanWatches([]WatchInput{{ID: "bw_1", Kind: "page", URL: "https://e.com", Read: "product_price"}}, prev)
	if err != nil || ws[0].Rules[0].Kind != RuleMovePct {
		t.Fatalf("%+v %v", ws, err)
	}
	if _, err := cleanWatches([]WatchInput{{ID: "bw_1", Kind: "page", URL: "https://e.com"}, {ID: "bw_1", Kind: "page", URL: "https://e.com"}}, prev); err == nil {
		t.Fatal("the same watch twice")
	}
}

func TestRuleIDsAndSameRules(t *testing.T) {
	keep := jsonList[Rule]{{ID: "brl_keep", Kind: RuleAnyChange}}
	out := ruleIDs([]Rule{{ID: "brl_keep", Kind: RuleAnyChange}, {ID: "brl_keep", Kind: RuleAnyChange}, {ID: "made_up", Kind: RuleAnyChange}, {Kind: RuleAnyChange}}, keep)
	if out[0].ID != "brl_keep" {
		t.Fatal(out[0].ID)
	}
	seen := map[string]bool{}
	for _, r := range out[1:] {
		if !strings.HasPrefix(r.ID, "brl_") || r.ID == "brl_keep" || seen[r.ID] {
			t.Fatalf("id %q", r.ID)
		}
		seen[r.ID] = true
	}
	a := []Rule{{ID: "brl_a", Kind: RuleAbove, Threshold: f(10), StepPercent: 5, ResetPercent: 0.5}}
	b := []Rule{{ID: "brl_b", Kind: RuleAbove, Threshold: f(10), StepPercent: 5, ResetPercent: 0.5}}
	if !sameRules(a, b) {
		t.Fatal("ids should not count")
	}
	b[0].Threshold = f(11)
	if sameRules(a, b) || sameRules(a, nil) {
		t.Fatal("a changed threshold is a change")
	}
}

func TestRefuseMCPSettings(t *testing.T) {
	yes, judge, empty := true, "rules", ""
	if err := refuseMCPSettings(OriginApp, &judge, &yes); err != nil {
		t.Fatal(err)
	}
	if err := refuseMCPSettings(OriginMCP, &empty, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := refuseMCPSettings(OriginMCP, nil, nil, &yes); err == nil {
		t.Fatal("phone over MCP")
	}
	if err := refuseMCPSettings(OriginMCP, &judge); err == nil {
		t.Fatal("judge over MCP")
	}
}

func TestFormatMoneyAndSummary(t *testing.T) {
	for _, c := range []struct {
		v    float64
		cur  string
		want string
	}{
		{27499, "INR", "₹27,499"},
		{187.2, "USD", "$187.20"},
		{1234.5, "CHF", "1,234.50 CHF"},
		{5812300, "INR", "₹5,812,300"},
		{1234.56, "JPY", "¥1,235"},
		{0.000123, "USD", "$0.000123"},
		{999, "", "999"},
		{-5.5, "EUR", "-€5.50"},
	} {
		if got := formatMoney(c.v, c.cur); got != c.want {
			t.Errorf("%v %s: %q, want %q", c.v, c.cur, got, c.want)
		}
	}
	if got := summary(&Reading{Kind: ReadingPrice, Price: f(27499), Currency: "INR"}); got != "₹27,499" {
		t.Fatal(got)
	}
	if got := summary(&Reading{Kind: ReadingText, Text: strings.Repeat("a", 4210)}); got != "Text, 4,210 characters" {
		t.Fatal(got)
	}
	if got := summary(&Reading{Kind: ReadingFeed, Items: make([]extract.FeedItem, 12)}); got != "12 items" {
		t.Fatal(got)
	}
	if summary(nil) != "" {
		t.Fatal("nil reading")
	}
}

func TestSnoozeUntil(t *testing.T) {
	now := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	parse := func(s string) map[string]json.RawMessage {
		var m map[string]json.RawMessage
		if err := json.Unmarshal([]byte(s), &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	if u, err := snoozeUntil(parse(`{"for":"day"}`), now); err != nil || !u.Equal(now.Add(24*time.Hour)) {
		t.Fatal(u, err)
	}
	if u, err := snoozeUntil(parse(`{"for":"week"}`), now); err != nil || !u.Equal(now.Add(7*24*time.Hour)) {
		t.Fatal(u, err)
	}
	if u, err := snoozeUntil(parse(`{"until":null}`), now); err != nil || u != nil {
		t.Fatal(u, err)
	}
	if u, err := snoozeUntil(parse(`{"until":"2026-11-07T10:00:00+05:30"}`), now); err != nil || !u.Equal(time.Date(2026, 11, 7, 4, 30, 0, 0, time.UTC)) {
		t.Fatal(u, err)
	}
	for _, bad := range []string{`{}`, `{"for":"month"}`, `{"until":"tomorrow"}`} {
		if _, err := snoozeUntil(parse(bad), now); err == nil {
			t.Errorf("%s", bad)
		}
	}
}
