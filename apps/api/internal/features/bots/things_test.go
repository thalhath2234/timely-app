package bots

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
)

func TestNormURL(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"https://shop.example/item/42", "https://shop.example/item/42"},
		{"HTTPS://WWW.Shop.Example/item/42/", "https://shop.example/item/42"},
		{"https://shop.example", "https://shop.example/"},
		{"https://shop.example/", "https://shop.example/"},
		{"https://shop.example/a#reviews", "https://shop.example/a"},
		{"https://shop.example/a?utm_source=x&b=2&a=1&ref=feed&fbclid=f&gclid=g&UTM_Medium=m", "https://shop.example/a?a=1&b=2"},
		{"https://www.amazon.in/dp/B0C1?tag=aff-21&th=1", "https://amazon.in/dp/B0C1?th=1"},
		{"https://shop.example/a?", "https://shop.example/a"},
		{"  https://shop.example/a  ", "https://shop.example/a"},
		{"http://shop.example:8443/a", "http://shop.example:8443/a"},
		{"not a link", "not a link"},
	} {
		if got := normURL(c.in); got != c.want {
			t.Errorf("normURL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if normURL("https://www.shop.example/a/?utm_campaign=z#x") != normURL("https://shop.example/a") {
		t.Fatal("the same page linked two ways has two keys")
	}
}

func TestThingKeys(t *testing.T) {
	feed := Watch{Kind: WatchFeed, URL: "https://news.example/feed.xml"}
	for _, c := range []struct {
		name string
		got  string
		want string
	}{
		{"coin", thingKeyWatch(Watch{Kind: WatchPrice, Source: "coinbase", Symbol: "btc", Currency: "USD"}), "price:coinbase:BTC:USD"},
		{"coin in a stablecoin", thingKeyWatch(Watch{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "usdc"}), "price:coinbase:BTC:USDC"},
		{"stock", thingKeyWatch(Watch{Kind: WatchPrice, Source: "Finnhub", Symbol: "NVDA"}), "price:finnhub:NVDA"},
		{"page", thingKeyWatch(Watch{Kind: WatchPage, URL: "https://www.shop.example/p/1/?utm_source=a"}), "page:https://shop.example/p/1"},
		{"feed watch", thingKeyWatch(feed), "page:https://news.example/feed.xml"},
		{"item link", thingKeyItem(extract.FeedItem{ID: "1", Link: "https://www.news.example/story/1?utm_medium=rss"}, feed), "link:https://news.example/story/1"},
		{"item without link", thingKeyItem(extract.FeedItem{ID: "g-1"}, feed), "item:https://news.example/feed.xml#g-1"},
		{"item on another port", thingKeyItem(extract.FeedItem{ID: "2", Link: "http://news.example:8080/2"}, feed), "item:https://news.example/feed.xml#2"},
		{"item on a private host", thingKeyItem(extract.FeedItem{ID: "3", Link: "http://192.168.1.4/3"}, feed), "item:https://news.example/feed.xml#3"},
	} {
		if c.got != c.want {
			t.Errorf("%s: %q, want %q", c.name, c.got, c.want)
		}
	}
	// One coin quoted in two currencies is two things: they never share.
	usd := thingKeyWatch(Watch{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "USD"})
	usdc := thingKeyWatch(Watch{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "USDC"})
	if usd == usdc {
		t.Fatalf("BTC in USD and in USDC share the key %q", usd)
	}
}

func TestSafeLink(t *testing.T) {
	const fallback = "https://news.example/feed.xml"
	for _, c := range []struct{ in, want string }{
		{"https://news.example/story/1", "https://news.example/story/1"},
		{" https://news.example/story/1 ", "https://news.example/story/1"},
		{"http://news.example:80/a", "http://news.example:80/a"},
		{"javascript:alert(1)", fallback},
		{"/story/1", fallback},
		{"story/1", fallback},
		{"", fallback},
		{"https://news.example/" + strings.Repeat("a", MaxURLLen), fallback},
		{"http://news.example:8080/admin", fallback},
		{"http://127.0.0.1/a", fallback},
		{"http://10.0.0.7/a", fallback},
		{"http://[::1]/a", fallback},
		{"http://localhost/a", fallback},
		{"http://printer.localhost/a", fallback},
		{"https://user:pw@news.example/a", fallback},
		{"ftp://news.example/a", fallback},
	} {
		if got := safeLink(c.in, fallback); got != c.want {
			t.Errorf("safeLink(%.60q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestThingsOf(t *testing.T) {
	price := func(v float64) Reading { return Reading{Kind: ReadingPrice, Price: &v, Currency: "USD"} }
	coin := Watch{ID: "bw_c", Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "USD"}
	page := Watch{ID: "bw_p", Kind: WatchPage, URL: "https://shop.example/p"}
	feed := Watch{ID: "bw_f", Kind: WatchFeed, URL: "https://news.example/feed.xml"}
	fired := []firedEvent{
		{w: coin, rule: Rule{Kind: RuleBelow}, ev: Event{After: price(69120)}},
		{w: coin, rule: Rule{Kind: RuleMovePct}, ev: Event{After: price(69120)}}, // the same thing once
		{w: page, rule: Rule{Kind: RuleAnyChange}, ev: Event{After: Reading{Kind: ReadingText, Text: "x"}}},
		{w: feed, rule: Rule{Kind: RuleNewItem}, ev: Event{NewItems: []extract.FeedItem{
			{ID: "1", Link: "https://news.example/1"}, {ID: "2"}, {ID: "1b", Link: "https://www.news.example/1#top"},
		}}},
	}
	got := thingsOf(fired, UrgencyHigh)
	want := []string{"price:coinbase:BTC:USD", "page:https://shop.example/p", "link:https://news.example/1", "item:https://news.example/feed.xml#2"}
	if len(got) != len(want) {
		t.Fatalf("things %+v", got)
	}
	for i, th := range got {
		if th.Key != want[i] || th.Urgency != UrgencyHigh {
			t.Errorf("thing %d: %+v, want key %s", i, th, want[i])
		}
	}
	if got[0].Value == nil || *got[0].Value != 69120 || got[1].Value != nil || got[2].Value != nil {
		t.Fatalf("values %+v %+v %+v", got[0].Value, got[1].Value, got[2].Value)
	}
	if len(thingsOf(nil, UrgencyNormal)) != 0 || thingsOf(nil, UrgencyNormal) == nil {
		t.Fatal("no fired rules should give an empty list, not nil")
	}
}

func TestJoins(t *testing.T) {
	v := func(f float64) *float64 { return &f }
	for _, c := range []struct {
		name     string
		cur, old Thing
		want     bool
	}{
		{"same", Thing{Value: v(100), Urgency: UrgencyNormal}, Thing{Value: v(100), Urgency: UrgencyNormal}, true},
		{"4.9% up", Thing{Value: v(104.9), Urgency: UrgencyNormal}, Thing{Value: v(100), Urgency: UrgencyNormal}, true},
		{"5% up", Thing{Value: v(105), Urgency: UrgencyNormal}, Thing{Value: v(100), Urgency: UrgencyNormal}, false},
		{"6% down", Thing{Value: v(94), Urgency: UrgencyNormal}, Thing{Value: v(100), Urgency: UrgencyNormal}, false},
		{"no values", Thing{Urgency: UrgencyNormal}, Thing{Urgency: UrgencyNormal}, true},
		{"one value", Thing{Value: v(120), Urgency: UrgencyNormal}, Thing{Urgency: UrgencyNormal}, true},
		{"old zero", Thing{Value: v(5), Urgency: UrgencyNormal}, Thing{Value: v(0), Urgency: UrgencyNormal}, true},
		{"more urgent", Thing{Urgency: UrgencyHigh}, Thing{Urgency: UrgencyNormal}, false},
		{"less urgent", Thing{Urgency: UrgencyLow}, Thing{Urgency: UrgencyHigh}, true},
		{"normal over low", Thing{Urgency: UrgencyNormal}, Thing{Urgency: UrgencyLow}, false},
		{"unset is normal", Thing{Urgency: ""}, Thing{Urgency: UrgencyNormal}, true},
	} {
		if got := joins(c.cur, c.old); got != c.want {
			t.Errorf("%s: joins = %v", c.name, got)
		}
	}
}

func TestItemFindings(t *testing.T) {
	feed := Watch{ID: "bw_f", Kind: WatchFeed, URL: "https://news.example/feed.xml"}
	base := Finding{BotID: "bot_1", UserID: "u", Urgency: UrgencyNormal, OutsideData: true, Alerted: true}
	day := time.Date(2026, 11, 6, 8, 0, 0, 0, time.UTC)
	var items []extract.FeedItem
	for i := range 12 {
		items = append(items, extract.FeedItem{ID: fmt.Sprint(i), Title: fmt.Sprintf("Story %d", i), Link: fmt.Sprintf("https://news.example/%d", i),
			Published: day.Add(time.Duration(i) * time.Hour)})
	}
	items[3].Link = "javascript:alert(1)"
	items[4].Title = "   "
	items[11].Title = strings.Repeat("x", 300)
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	rows := itemFindings(base, firedEvent{w: feed, rule: Rule{Kind: RuleNewItem}, ev: Event{NewItems: items}}, kolkata)
	if len(rows) != MaxItemFindings+1 {
		t.Fatalf("%d rows", len(rows))
	}
	// Newest first: items 11 down to 2, then the count of the other two.
	if r := rows[0]; len([]rune(r.Title)) != maxFindingTitle || r.URL != "https://news.example/11" || r.ThingKey != "link:https://news.example/11" ||
		r.Why != "New in news.example · 7 Nov 00:30" || r.Kind != "item" || !r.OutsideData || !r.Alerted || r.ID == "" {
		t.Fatalf("newest %+v", r)
	}
	if r := rows[7]; r.Title != "New item" {
		t.Fatalf("an item with no title: %+v", r)
	}
	if r := rows[8]; r.Title != "Story 3" || r.URL != feed.URL || r.ThingKey != "item:https://news.example/feed.xml#3" {
		t.Fatalf("an unsafe link: %+v", r)
	}
	if r := rows[9]; r.Title != "Story 2" {
		t.Fatalf("the tenth %+v", r)
	}
	if r := rows[10]; r.Title != "2 more new items" || r.URL != feed.URL || r.ThingKey != "" || !r.OutsideData {
		t.Fatalf("more %+v", r)
	}
	one := itemFindings(base, firedEvent{w: feed, rule: Rule{Kind: RuleNewItem}, ev: Event{NewItems: items[:11]}}, time.UTC)
	if len(one) != 11 || one[10].Title != "1 more new item" {
		t.Fatalf("one more: %+v", one[len(one)-1])
	}
	plain := itemFindings(base, firedEvent{w: feed, rule: Rule{Kind: RuleNewItem}, ev: Event{NewItems: []extract.FeedItem{{ID: "a", Title: "A"}}}}, time.UTC)
	if len(plain) != 1 || plain[0].Why != "New in news.example" {
		t.Fatalf("no publish time: %+v", plain)
	}
}

func TestNamesLine(t *testing.T) {
	for in, want := range map[string]string{"": "", "A": "A", "A|B": "A and B", "A|B|C": "A, B and C"} {
		var names []string
		if in != "" {
			names = strings.Split(in, "|")
		}
		if got := namesLine(names); got != want {
			t.Errorf("namesLine(%q) = %q", in, got)
		}
	}
}
