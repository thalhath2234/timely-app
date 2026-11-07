package bots

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
)

func TestHolds(t *testing.T) {
	price := func(v float64, cur string) Reading { return Reading{Kind: ReadingPrice, Price: &v, Currency: cur} }
	text := Reading{Kind: ReadingText, Text: "Samsung 990 EVO 2TB NVMe\nNew in example.com"}
	cases := []struct {
		name     string
		rule     Rule
		reading  Reading
		currency string
		want     bool
	}{
		{"below holds", Rule{Kind: RuleBelow, Threshold: f64(110)}, price(99, "USD"), "USD", true},
		{"below does not", Rule{Kind: RuleBelow, Threshold: f64(110)}, price(120, "USD"), "USD", false},
		{"below at the line", Rule{Kind: RuleBelow, Threshold: f64(110)}, price(110, "USD"), "", false},
		{"above holds", Rule{Kind: RuleAbove, Threshold: f64(100)}, price(101, "USD"), "", true},
		{"above does not", Rule{Kind: RuleAbove, Threshold: f64(100)}, price(99, "USD"), "", false},
		{"another currency", Rule{Kind: RuleBelow, Threshold: f64(110)}, price(99, "EUR"), "USD", false},
		{"currency case", Rule{Kind: RuleBelow, Threshold: f64(110)}, price(99, "usd"), "USD", true},
		{"no price on text", Rule{Kind: RuleBelow, Threshold: f64(110)}, text, "", false},
		{"words appear", Rule{Kind: RuleWordsAppear, Words: []string{"nvme"}}, text, "", true},
		{"words missing", Rule{Kind: RuleWordsAppear, Words: []string{"SATA"}}, text, "", false},
		{"words gone", Rule{Kind: RuleWordsDisappear, Words: []string{"SATA"}}, text, "", true},
		{"words still there", Rule{Kind: RuleWordsDisappear, Words: []string{"NVMe"}}, text, "", false},
		{"any change", Rule{Kind: RuleAnyChange}, text, "", true},
		{"a move is new to the bot", Rule{Kind: RuleMovePct, Percent: f64(5)}, price(1, "USD"), "", true},
		{"a new item", Rule{Kind: RuleNewItem}, text, "", true},
		{"unknown", Rule{Kind: "nope"}, text, "", false},
	}
	for _, c := range cases {
		if got := holds(c.rule, c.reading, c.currency); got != c.want {
			t.Errorf("%s: holds = %v", c.name, got)
		}
	}
}

func TestTakeItems(t *testing.T) {
	feed := Watch{ID: "bw_feed", Kind: WatchFeed, URL: "https://news.example.com/feed.xml"}
	items := []extract.FeedItem{{ID: "1", Title: "Samsung 990 EVO 2TB NVMe"}, {ID: "2", Title: "A cheap mouse"}, {ID: "3", Title: "Crucial nvme deal"}}
	feedEv := firedEvent{w: feed, rule: Rule{ID: "brl_new", Kind: RuleNewItem}, ev: Event{WatchID: feed.ID, RuleID: "brl_new", Kind: RuleNewItem, NewItems: items}}
	pageW := Watch{ID: "bw_page", Kind: WatchPage, URL: "https://shop.example.com/"}
	pageEv := firedEvent{w: pageW, rule: Rule{ID: "brl_words", Kind: RuleWordsAppear, Words: []string{"In stock"}},
		ev: Event{WatchID: pageW.ID, RuleID: "brl_words", Kind: RuleWordsAppear, After: Reading{Kind: ReadingText, Text: "Now In stock today"}}}
	nvme := linkTarget{LinkID: "blk_nvme", ToBotID: "bot_b", Filter: []string{"NVMe"}, Active: true}
	all := linkTarget{LinkID: "blk_all", ToBotID: "bot_c", Active: true}
	paused := linkTarget{LinkID: "blk_paused", ToBotID: "bot_d", Active: false}

	taken := takeItems([]firedEvent{feedEv, pageEv}, []linkTarget{nvme, all, paused}, 0)
	ids := func(k itemKey) []string {
		var out []string
		for _, l := range taken[k] {
			out = append(out, l.LinkID)
		}
		return out
	}
	if got := ids(itemKey{"bw_feed", "brl_new", "1"}); !slices.Equal(got, []string{"blk_nvme", "blk_all"}) {
		t.Errorf("item 1 went by %v", got)
	}
	if got := ids(itemKey{"bw_feed", "brl_new", "2"}); !slices.Equal(got, []string{"blk_all"}) {
		t.Errorf("item 2 went by %v (filter words only)", got)
	}
	if got := ids(itemKey{"bw_feed", "brl_new", "3"}); !slices.Equal(got, []string{"blk_nvme", "blk_all"}) {
		t.Errorf("item 3 (any case) went by %v", got)
	}
	// A page rule's note is its what and line: "“In stock” appeared".
	if got := ids(itemKey{"bw_page", "brl_words", ""}); !slices.Equal(got, []string{"blk_all"}) {
		t.Errorf("the page rule went by %v", got)
	}
	for k, ls := range taken {
		for _, l := range ls {
			if l.LinkID == "blk_paused" {
				t.Errorf("%v went to a paused bot", k)
			}
		}
	}

	// What is left for the Bot itself: items no link took.
	left := untaken([]firedEvent{feedEv, pageEv}, takeItems([]firedEvent{feedEv, pageEv}, []linkTarget{nvme}, 0))
	if len(left) != 2 || len(left[0].ev.NewItems) != 1 || left[0].ev.NewItems[0].ID != "2" || left[1].ev.RuleID != "brl_words" {
		t.Fatalf("untaken %+v", left)
	}
	if len(feedEv.ev.NewItems) != 3 {
		t.Fatal("untaken changed the event it was given")
	}
	if left := untaken([]firedEvent{feedEv}, takeItems([]firedEvent{feedEv}, []linkTarget{all}, 0)); len(left) != 0 {
		t.Fatalf("a rule whose items all went on is still alerted: %+v", left)
	}

	// A chain stops after ChainSteps links.
	if got := takeItems([]firedEvent{feedEv}, []linkTarget{all}, ChainSteps-1); len(got) == 0 {
		t.Error("the last step of a chain passed nothing")
	}
	if got := takeItems([]firedEvent{feedEv}, []linkTarget{all}, ChainSteps); got != nil {
		t.Errorf("a chain went past %d steps: %v", ChainSteps, got)
	}
	if got := takeItems([]firedEvent{feedEv}, nil, 0); got != nil {
		t.Errorf("no links took %v", got)
	}
}

func TestGraphProblem(t *testing.T) {
	at := time.Date(2026, 11, 7, 9, 0, 0, 0, time.UTC)
	edge := func(id, from, to string, n int) linkEdge {
		return linkEdge{ID: id, From: from, To: to, CreatedAt: at.Add(time.Duration(n) * time.Minute)}
	}
	ab, bc, cd, de := edge("ab", "A", "B", 1), edge("bc", "B", "C", 2), edge("cd", "C", "D", 3), edge("de", "D", "E", 4)
	ids := func(path []linkEdge) string {
		var out []string
		for _, e := range path {
			out = append(out, e.ID)
		}
		return strings.Join(out, ",")
	}
	if p, _ := graphProblem(nil); p != graphOK {
		t.Error("no links is a problem")
	}
	if p, _ := graphProblem([]linkEdge{ab, bc, cd}); p != graphOK {
		t.Error("a 3-step chain was refused")
	}
	if p, path := graphProblem([]linkEdge{ab, bc, cd, de}); p != graphTooLong || ids(path) != "ab,bc,cd,de" {
		t.Errorf("a 4-step chain: %d %s", p, ids(path))
	}
	// Fan-out and fan-in are fine.
	if p, _ := graphProblem([]linkEdge{ab, edge("ac", "A", "C", 5), edge("bd", "B", "D", 6), edge("cd2", "C", "D", 7)}); p != graphOK {
		t.Error("a diamond was refused")
	}
	if p, path := graphProblem([]linkEdge{ab, bc, edge("ca", "C", "A", 5)}); p != graphCircle || len(path) != 3 {
		t.Errorf("a circle: %d %s", p, ids(path))
	}
	if p, path := graphProblem([]linkEdge{edge("xy", "X", "Y", 1), edge("yx", "Y", "X", 2)}); p != graphCircle || ids(path) != "xy,yx" {
		t.Errorf("two bots passing to each other: %d %s", p, ids(path))
	}
	// A circle off to the side of a fine chain is still found.
	if p, path := graphProblem([]linkEdge{ab, bc, edge("cb", "C", "B", 3)}); p != graphCircle || ids(path) != "bc,cb" {
		t.Errorf("a side circle: %d %s", p, ids(path))
	}
}

func TestCleanFilter(t *testing.T) {
	got, err := cleanFilter([]string{" 2TB  NVMe ", "", "nvme", "2tb nvme", "Samsung\x00", strings.Repeat("x", 80)})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"2TB NVMe", "nvme", "Samsung", strings.Repeat("x", MaxFilterWordLen)}; !slices.Equal(got, want) {
		t.Fatalf("filter %q", got)
	}
	if got, err := cleanFilter(nil); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("no words: %v %v", got, err)
	}
	var bad *InputError
	if _, err := cleanFilter([]string{"a", "b", "c", "d", "e", "f"}); !errors.As(err, &bad) || bad.Message != "Up to 5 filter words" {
		t.Fatalf("six words: %v", err)
	}
}

// A passed note's check words its rule from the note alone: a move with
// nothing to measure from says what the price is.
func TestDescribePassedMove(t *testing.T) {
	v := 51000.0
	f := firedEvent{w: Watch{Kind: WatchPrice, Symbol: "BTC"}, rule: Rule{Kind: RuleMovePct, Percent: f64(5)},
		ev: Event{Kind: RuleMovePct, After: Reading{Kind: ReadingPrice, Price: &v, Currency: "USD"}}}
	what, body, _ := describe(f)
	if what != "at $51,000" || body != "BTC now $51,000" {
		t.Fatalf("%q / %q", what, body)
	}
}
