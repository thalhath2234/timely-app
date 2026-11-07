package bots

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
)

var t0 = time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)

func f(v float64) *float64 { return &v }

func priceAt(v float64, i int) Reading {
	return Reading{Kind: ReadingPrice, Price: f(v), Currency: "INR", At: t0.Add(time.Duration(i) * time.Hour)}
}

func textAt(s string, i int) Reading {
	return Reading{Kind: ReadingText, Text: s, Hash: extract.Hash(s), At: t0.Add(time.Duration(i) * time.Hour)}
}

type step struct {
	v    float64
	fire bool
}

// runPrices records steps[0] as the baseline and checks that each later
// value fires or stays quiet.
func runPrices(t *testing.T, r Rule, steps []step) RuleState {
	t.Helper()
	r, err := cleanRule(ReadingPrice, r)
	if err != nil {
		t.Fatal(err)
	}
	prev := priceAt(steps[0].v, 0)
	st := Rebaseline(r, prev)
	for i, s := range steps[1:] {
		cur := priceAt(s.v, i+1)
		ev, next := Evaluate(r, st, prev, cur)
		if (ev != nil) != s.fire {
			t.Fatalf("step %d (%v): fired=%v, want %v (state before %+v)", i+1, s.v, ev != nil, s.fire, st)
		}
		if ev != nil {
			if ev.Before.Price == nil || *ev.Before.Price != *prev.Price || *ev.After.Price != s.v || ev.Kind != r.Kind {
				t.Fatalf("step %d: event %+v", i+1, ev)
			}
			if next.FiredAt == nil || !next.FiredAt.Equal(cur.At) {
				t.Fatalf("step %d: FiredAt %v, want %v", i+1, next.FiredAt, cur.At)
			}
		}
		st, prev = next, cur
	}
	return st
}

func TestBelowFiresOnceThenOnSteps(t *testing.T) {
	runPrices(t, Rule{Kind: RuleBelow, Threshold: f(25000)}, []step{
		{27499, false}, // baseline
		{24900, true},
		{24800, false},
		{23655, true},  // 5% below 24,900
		{25200, false}, // past 25,125: re-armed
		{24900, true},
	})
}

func TestBelowFlappingAtTheLineFiresOnce(t *testing.T) {
	runPrices(t, Rule{Kind: RuleBelow, Threshold: f(25000)}, []step{
		{25300, false},
		{24990, true},
		{25010, false},
		{24995, false},
		{25120, false}, // inside the 0.5% band
		{24980, false},
		{25050, false},
		{24999, false},
	})
}

func TestAboveIsTheMirror(t *testing.T) {
	runPrices(t, Rule{Kind: RuleAbove, Threshold: f(100)}, []step{
		{90, false},
		{101, true},
		{102, false},
		{106.05, true}, // 5% above 101
		{99.6, false},  // inside the band
		{101, false},   // still disarmed, under the next step
		{99.5, false},  // re-armed at 100*(1-0.5%)
		{100.5, true},
	})
}

func TestCustomStepAndReset(t *testing.T) {
	runPrices(t, Rule{Kind: RuleBelow, Threshold: f(100), StepPercent: 10, ResetPercent: 2}, []step{
		{120, false},
		{99, true},
		{90, false}, // 9.1% below 99
		{89.1, true},
		{101.5, false},
		{99, false}, // 101.5 did not reach 102, so no re-arm
		{102, false},
		{98, true},
	})
}

func TestMovePct(t *testing.T) {
	t.Run("ref from baseline, moves on fire", func(t *testing.T) {
		st := runPrices(t, Rule{Kind: RuleMovePct, Percent: f(5)}, []step{
			{100, false},
			{104, false},
			{105, true},
			{101, false},
			{99.75, true}, // 5% under 105
			{102, false},
		})
		if st.Ref == nil || *st.Ref != 99.75 {
			t.Fatalf("Ref = %v, want 99.75", st.Ref)
		}
	})
	t.Run("baseline sets Ref", func(t *testing.T) {
		st := Rebaseline(Rule{Kind: RuleMovePct, Percent: f(5)}, priceAt(6131000, 0))
		if !st.Armed || st.Ref == nil || *st.Ref != 6131000 {
			t.Fatalf("state %+v", st)
		}
	})
	t.Run("down", func(t *testing.T) {
		runPrices(t, Rule{Kind: RuleMovePct, Percent: f(5), Direction: DirDown}, []step{
			{100, false},
			{110, false},
			{96, false},
			{95, true},
			{94, false},
			{90.25, true},
		})
	})
	t.Run("up", func(t *testing.T) {
		runPrices(t, Rule{Kind: RuleMovePct, Percent: f(5), Direction: DirUp}, []step{
			{100, false},
			{90, false},
			{104.99, false},
			{105, true},
			{110.25, true},
		})
	})
}

func TestRebaselineDisarmsTrueCondition(t *testing.T) {
	r := Rule{Kind: RuleBelow, Threshold: f(25000), StepPercent: 5, ResetPercent: 0.5}
	st := Rebaseline(r, priceAt(24000, 0))
	if st.Armed || st.Ref == nil || *st.Ref != 24000 {
		t.Fatalf("state %+v, want disarmed with Ref 24000", st)
	}
	runPrices(t, r, []step{{24000, false}, {23900, false}, {22800, true}})

	w := Rule{Kind: RuleWordsAppear, Words: []string{"in stock"}}
	prev := textAt("Now in stock", 0)
	st = Rebaseline(w, prev)
	if st.Armed {
		t.Fatal("words_appear with the words already there should start disarmed")
	}
	if ev, _ := Evaluate(w, st, prev, textAt("Still in stock", 1)); ev != nil {
		t.Fatal("words already there fired")
	}
	if st := Rebaseline(Rule{Kind: RuleAbove, Threshold: f(100)}, priceAt(90, 0)); !st.Armed {
		t.Fatal("above 100 at 90 should be armed")
	}
}

func TestCurrencyChangeRebaselinesQuietly(t *testing.T) {
	r := Rule{Kind: RuleMovePct, Percent: f(5), Direction: DirAny}
	prev := priceAt(100, 0)
	st := Rebaseline(r, prev)
	cur := Reading{Kind: ReadingPrice, Price: f(1.2), Currency: "USD", At: t0.Add(time.Hour)}
	ev, st := Evaluate(r, st, prev, cur)
	if ev != nil || st.Ref == nil || *st.Ref != 1.2 {
		t.Fatalf("event %v state %+v", ev, st)
	}
	if ev, _ := Evaluate(Rule{Kind: RuleAnyChange}, RuleState{Armed: true}, prev, cur); ev == nil {
		t.Fatal("any_change should fire on a currency change")
	}
}

func runTexts(t *testing.T, r Rule, texts []string, fires []bool) {
	t.Helper()
	prev := textAt(texts[0], 0)
	st := Rebaseline(r, prev)
	for i, s := range texts[1:] {
		cur := textAt(s, i+1)
		ev, next := Evaluate(r, st, prev, cur)
		if (ev != nil) != fires[i] {
			t.Fatalf("text %d %q: fired=%v, want %v", i+1, s, ev != nil, fires[i])
		}
		st, prev = next, cur
	}
}

func TestWordsFireOnTheEdge(t *testing.T) {
	runTexts(t, Rule{Kind: RuleWordsAppear, Words: []string{"Sold out"}},
		[]string{"In stock", "Sold out now", "SOLD OUT", "sold\n  out today", "In stock", "Back: sold   out"},
		[]bool{true, false, false, false, true})
	runTexts(t, Rule{Kind: RuleWordsDisappear, Words: []string{"Sold out"}},
		[]string{"Sold out", "In stock", "Back in stock", "Sold out", "In stock"},
		[]bool{true, false, false, true})
	// Any of the words counts as there.
	runTexts(t, Rule{Kind: RuleWordsAppear, Words: []string{"tickets", "registration open"}},
		[]string{"Coming soon", "Registration OPEN", "Tickets and registration open", "Coming soon", "Tickets!"},
		[]bool{true, false, false, true})
}

func TestMatchWords(t *testing.T) {
	cases := []struct {
		word, text string
		want       bool
	}{
		{"sale", "Sale! 20% off", true},
		{"sale", "Wholesale prices", false},
		{"available", "Currently unavailable", false},
		{"available", "Available now", true},
		{"in stock", "Only 2 left IN  STOCK.", true},
		{"₹", "Price ₹ 499", true},
		{"C++", "Learn c++ today", true},
		{"完売", "この商品は完売しました", true},
		{"updated", "Updated 5 minutes ago", false}, // Normalize strips it
		{"", "anything", false},
	}
	for _, c := range cases {
		got := len(MatchWords([]string{c.word}, c.text)) > 0
		if got != c.want {
			t.Errorf("MatchWords(%q, %q) = %v, want %v", c.word, c.text, got, c.want)
		}
	}
	if got := MatchWords([]string{"a", "b", "c"}, "b and a"); strings.Join(got, ",") != "a,b" {
		t.Errorf("matched %v, want a,b", got)
	}
}

func TestAnyChange(t *testing.T) {
	r := Rule{Kind: RuleAnyChange}
	st := RuleState{Armed: true}
	cases := []struct {
		name      string
		prev, cur Reading
		fire      bool
	}{
		{"same text", textAt("Hello", 0), textAt("Hello", 1), false},
		{"new text", textAt("Hello", 0), textAt("Hello world", 1), true},
		{"only volatile parts", textAt("Posted 5 minutes ago at 10:42", 0), textAt("Posted 2 hours ago at 12:42", 1), false},
		{"hash missing", Reading{Kind: ReadingText, Text: "a"}, Reading{Kind: ReadingText, Text: "a"}, false},
		{"same price", priceAt(100, 0), priceAt(100, 1), false},
		{"price moved", priceAt(100, 0), priceAt(100.01, 1), true},
	}
	for _, c := range cases {
		ev, next := Evaluate(r, st, c.prev, c.cur)
		if (ev != nil) != c.fire || !next.Armed {
			t.Errorf("%s: fired=%v state %+v", c.name, ev != nil, next)
		}
	}
}

func items(ids ...string) []extract.FeedItem {
	out := make([]extract.FeedItem, len(ids))
	for i, id := range ids {
		out[i] = extract.FeedItem{ID: id, Title: "Item " + id}
	}
	return out
}

func feedReading(prevSeen []string, it []extract.FeedItem, i int) Reading {
	return Reading{Kind: ReadingFeed, Items: it, Seen: MergeSeen(prevSeen, it), At: t0.Add(time.Duration(i) * time.Hour)}
}

func TestNewItem(t *testing.T) {
	r := Rule{Kind: RuleNewItem}
	prev := feedReading(nil, items("a", "b"), 0)
	st := Rebaseline(r, prev)

	cur := feedReading(prev.Seen, items("c", "d", "e", "a", "b"), 1)
	ev, st := Evaluate(r, st, prev, cur)
	if ev == nil || len(ev.NewItems) != 3 || ev.NewItems[0].ID != "c" || ev.NewItems[2].ID != "e" {
		t.Fatalf("event %+v, want one event with c, d, e", ev)
	}

	// The same items again, and an item that dropped out of the feed and came
	// back, never fire.
	next := feedReading(cur.Seen, items("d", "a", "e"), 2)
	if ev, _ := Evaluate(r, st, cur, next); ev != nil {
		t.Fatalf("seen items fired: %+v", ev.NewItems)
	}

	// Seen holds items no longer in Items.
	old := Reading{Kind: ReadingFeed, Items: items("z"), Seen: []string{"z", "y"}}
	if ev, _ := Evaluate(r, st, old, feedReading(old.Seen, items("y", "z"), 3)); ev != nil {
		t.Fatal("an item in Seen fired")
	}
}

func TestNewItemWords(t *testing.T) {
	r := Rule{Kind: RuleNewItem, Words: []string{"release"}}
	prev := feedReading(nil, items("a"), 0)
	st := Rebaseline(r, prev)
	it := []extract.FeedItem{{ID: "b", Title: "v2.0 Release notes"}, {ID: "c", Title: "Pre-release"}, {ID: "d", Title: "Blog post"}, {ID: "a"}}
	ev, _ := Evaluate(r, st, prev, feedReading(prev.Seen, it, 1))
	if ev == nil || len(ev.NewItems) != 2 || ev.NewItems[0].ID != "b" || ev.NewItems[1].ID != "c" {
		t.Fatalf("event %+v, want b and c", ev)
	}
	// Items that did not match are still seen.
	if seen := MergeSeen(prev.Seen, it); len(seen) != 4 || seen[2] != "d" {
		t.Fatalf("seen %v", seen)
	}
}

func TestMergeSeenCapsAndOrders(t *testing.T) {
	var prev []string
	for i := range 600 {
		prev = append(prev, fmt.Sprintf("old%d", i))
	}
	got := MergeSeen(prev, items("new1", "old3", "new2", "", "new1"))
	if len(got) != MaxSeen {
		t.Fatalf("len %d, want %d", len(got), MaxSeen)
	}
	if got[0] != "new1" || got[1] != "old3" || got[2] != "new2" || got[3] != "old0" || got[4] != "old1" || got[5] != "old2" || got[6] != "old4" {
		t.Fatalf("order %v", got[:7])
	}
	if got[MaxSeen-1] != "old497" {
		t.Fatalf("last %q, want old497", got[MaxSeen-1])
	}
}

func TestZeroStateRebaselinesAgainstPrev(t *testing.T) {
	r := Rule{Kind: RuleBelow, Threshold: f(100)}
	// prev was already below: no fire for what was there.
	if ev, _ := Evaluate(r, RuleState{}, priceAt(90, 0), priceAt(89, 1)); ev != nil {
		t.Fatal("fired with no stored state on an already-true condition")
	}
	// prev was above: a crossing fires.
	if ev, _ := Evaluate(r, RuleState{}, priceAt(110, 0), priceAt(99, 1)); ev == nil {
		t.Fatal("a crossing with no stored state did not fire")
	}
}

func TestDefaultRules(t *testing.T) {
	cases := []struct {
		kind, mode string
		want       string
	}{
		{WatchPage, ReadText, "any_change"},
		{WatchPage, ReadSelector, "any_change"},
		{WatchPage, ReadProductPrice, "move_pct 5 down"},
		{WatchFeed, "", "new_item"},
		{WatchPrice, "", "move_pct 5 any"},
	}
	for _, c := range cases {
		rs := DefaultRules(c.kind, c.mode)
		if len(rs) != 1 {
			t.Fatalf("%s/%s: %d rules", c.kind, c.mode, len(rs))
		}
		got := rs[0].Kind
		if rs[0].Percent != nil {
			got += fmt.Sprintf(" %g %s", *rs[0].Percent, rs[0].Direction)
		}
		if got != c.want {
			t.Errorf("%s/%s: %q, want %q", c.kind, c.mode, got, c.want)
		}
		if err := ValidateRules(c.kind, c.mode, rs); err != nil {
			t.Errorf("%s/%s: defaults refused: %v", c.kind, c.mode, err)
		}
		cleaned, err := CleanRules(c.kind, c.mode, nil)
		if err != nil || len(cleaned) != 1 || cleaned[0].Kind != rs[0].Kind {
			t.Errorf("%s/%s: CleanRules(nil) = %+v, %v", c.kind, c.mode, cleaned, err)
		}
	}
	if DefaultRules(WatchFeed, ReadText) != nil {
		t.Error("a feed with a read mode has defaults")
	}
}

func TestValidateRulesRefuses(t *testing.T) {
	words := make([]string, MaxWords+1)
	for i := range words {
		words[i] = fmt.Sprintf("w%d", i)
	}
	six := make([]Rule, MaxRulesPerWatch+1)
	for i := range six {
		six[i] = Rule{Kind: RuleAnyChange}
	}
	cases := []struct {
		kind, mode string
		rules      []Rule
		want       string
	}{
		{WatchPage, "", []Rule{{Kind: RuleAnyChange}}, "A watch is a page"},
		{WatchPrice, ReadText, []Rule{{Kind: RuleAnyChange}}, "A watch is a page"},
		{WatchPage, ReadText, six, "up to 5 rules"},
		{WatchPage, ReadText, []Rule{{Kind: "sometimes"}}, `"sometimes" is not a rule. A page can use`},
		{WatchPage, ReadText, []Rule{{Kind: RuleBelow, Threshold: f(1)}}, "A below rule does not fit this watch. A page can use"},
		{WatchFeed, "", []Rule{{Kind: RuleAnyChange}}, "A feed can use new_item"},
		{WatchPrice, "", []Rule{{Kind: RuleNewItem}}, "A price can use"},
		{WatchPrice, "", []Rule{{Kind: RuleBelow}}, "Give the below rule a threshold"},
		{WatchPrice, "", []Rule{{Kind: RuleAbove, Threshold: f(0)}}, "threshold must be a number above 0"},
		{WatchPrice, "", []Rule{{Kind: RuleAbove, Threshold: f(-3)}}, "threshold must be a number above 0"},
		{WatchPrice, "", []Rule{{Kind: RuleMovePct, Percent: f(5), Threshold: f(5)}}, "Only above and below rules take a threshold"},
		{WatchPrice, "", []Rule{{Kind: RuleMovePct}}, "Give the move_pct rule a percent"},
		{WatchPrice, "", []Rule{{Kind: RuleMovePct, Percent: f(0)}}, "percent must be above 0"},
		{WatchPrice, "", []Rule{{Kind: RuleMovePct, Percent: f(1001)}}, "at most 1000"},
		{WatchPrice, "", []Rule{{Kind: RuleMovePct, Percent: f(5), Direction: "sideways"}}, "up, down or any"},
		{WatchPrice, "", []Rule{{Kind: RuleBelow, Threshold: f(5), Percent: f(5)}}, "Only move_pct rules take a percent"},
		{WatchPrice, "", []Rule{{Kind: RuleBelow, Threshold: f(5), Direction: DirUp}}, "Only move_pct rules take a direction"},
		{WatchPrice, "", []Rule{{Kind: RuleBelow, Threshold: f(5), StepPercent: -1}}, "stepPercent must be between 0 and 100"},
		{WatchPrice, "", []Rule{{Kind: RuleBelow, Threshold: f(5), ResetPercent: 51}}, "resetPercent must be between 0 and 50"},
		{WatchPrice, "", []Rule{{Kind: RuleMovePct, Percent: f(5), StepPercent: 2}}, "Only above and below rules take stepPercent"},
		{WatchPage, ReadText, []Rule{{Kind: RuleWordsAppear}}, "Give the words_appear rule at least one word"},
		{WatchPage, ReadText, []Rule{{Kind: RuleWordsDisappear, Words: []string{"  ", ""}}}, "at least one word"},
		{WatchPage, ReadText, []Rule{{Kind: RuleWordsAppear, Words: words}}, "up to 10 words"},
		{WatchPage, ReadText, []Rule{{Kind: RuleWordsAppear, Words: []string{strings.Repeat("x", MaxWordLen+1)}}}, "under 100 characters"},
		{WatchPage, ReadText, []Rule{{Kind: RuleAnyChange, Words: []string{"x"}}}, "Only words_appear, words_disappear and new_item rules take words"},
		{WatchPage, ReadText, []Rule{{ID: "brl_1", Kind: RuleAnyChange}, {ID: "brl_1", Kind: RuleWordsAppear, Words: []string{"x"}}}, `share the id "brl_1"`},
	}
	for _, c := range cases {
		err := ValidateRules(c.kind, c.mode, c.rules)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s/%s %+v: %v, want %q", c.kind, c.mode, c.rules, err, c.want)
			continue
		}
		if _, ok := err.(*InputError); !ok {
			t.Errorf("%T is not an *InputError", err)
		}
	}
}

func TestCleanRules(t *testing.T) {
	got, err := CleanRules(WatchPrice, "", []Rule{
		{ID: "brl_a", Kind: RuleBelow, Threshold: f(25000)},
		{Kind: RuleAbove, Threshold: f(30000), StepPercent: 2, ResetPercent: 1},
		{Kind: RuleMovePct, Percent: f(3)},
		{Kind: RuleAnyChange},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].ID != "brl_a" || got[0].StepPercent != DefaultStepPercent || got[0].ResetPercent != DefaultResetPercent {
		t.Errorf("below defaults: %+v", got[0])
	}
	if got[1].StepPercent != 2 || got[1].ResetPercent != 1 {
		t.Errorf("above kept its values: %+v", got[1])
	}
	if got[2].Direction != DirAny {
		t.Errorf("move_pct direction %q, want any", got[2].Direction)
	}

	got, err = CleanRules(WatchPage, ReadSelector, []Rule{{Kind: RuleWordsAppear, Words: []string{"  Sold   out ", "sold out", "", "In stock"}}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got[0].Words, "|") != "Sold out|In stock" {
		t.Errorf("words %q", got[0].Words)
	}

	if _, err := CleanRules(WatchFeed, "", []Rule{{Kind: RuleNewItem, Words: []string{"release"}}, {Kind: RuleNewItem}}); err != nil {
		t.Errorf("feed rules refused: %v", err)
	}
	if _, err := CleanRules(WatchPage, ReadProductPrice, []Rule{{Kind: RuleBelow, Threshold: f(999)}}); err != nil {
		t.Errorf("product price rule refused: %v", err)
	}
}
