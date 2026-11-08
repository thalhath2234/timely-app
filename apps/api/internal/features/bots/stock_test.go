package bots

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
)

// flipkartPage is the marketplace fixture: ₹89,999, out of stock. avail and
// amount replace its availability and price.
func flipkartPage(t *testing.T, amount, avail string) []byte {
	t.Helper()
	b, err := os.ReadFile("extract/testdata/product_flipkart_oos.html")
	if err != nil {
		t.Fatal(err)
	}
	page := strings.Replace(string(b), `"price":89999`, `"price":`+amount, 1)
	switch avail {
	case "":
		page = strings.Replace(page, `,"availability":"http://schema.org/OutOfStock"`, "", 1)
	default:
		page = strings.Replace(page, "http://schema.org/OutOfStock", avail, 1)
	}
	return []byte(page)
}

// shopWatch is a product_price watch with rules cleaned and given ids, as a
// save leaves it.
func shopWatch(t *testing.T, rules ...Rule) Watch {
	t.Helper()
	cleaned, err := CleanRules(WatchPage, ReadProductPrice, rules)
	if err != nil {
		t.Fatal(err)
	}
	for i := range cleaned {
		cleaned[i].ID = "brl_" + string(rune('a'+i))
	}
	return Watch{ID: "bwt_pixel", Kind: WatchPage, URL: "https://www.flipkart.com/google-pixel-10-pro/p/itm1",
		ReadMode: ReadProductPrice, Currency: "INR", Rules: cleaned}
}

// shopCheck reads body for w the way a check does and saves what the check
// would: the first reading as a quiet baseline, later ones through the rules.
func shopCheck(t *testing.T, w *Watch, body []byte, i int) (fired []firedEvent, held []Rule, reading Reading) {
	t.Helper()
	reading, err := extractReading(*w, &fetch.Response{Status: 200, ContentType: "text/html; charset=utf-8", Body: body}, t0.Add(time.Duration(i)*6*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if w.LastReading == nil {
		w.RuleState = jsonMap[string, RuleState]{}
		for _, r := range w.Rules {
			w.RuleState[r.ID] = Rebaseline(r, reading)
		}
	} else {
		fired, w.RuleState, _, held = evaluateWatch(*w, reading)
	}
	w.LastReading = &reading
	return fired, held, reading
}

// The Pixel case: a "below ₹90,000" bot on a page that drops to ₹89,999
// while out of stock tells nobody and says why, then alerts once when the
// same price can be bought.
func TestStockFlipkartOutOfStockHoldsThenAlertsOnce(t *testing.T) {
	w := shopWatch(t, Rule{Kind: RuleBelow, Threshold: f(90000)})
	if w.Rules[0].OnlyInStock != nil {
		t.Fatalf("the default is stored as nil: %+v", w.Rules[0])
	}
	shopCheck(t, &w, flipkartPage(t, "109999", "http://schema.org/InStock"), 0)

	fired, held, reading := shopCheck(t, &w, flipkartPage(t, "89999", "http://schema.org/OutOfStock"), 1)
	if reading.Availability != extract.AvailOutOfStock || *reading.Price != 89999 || reading.Currency != "INR" {
		t.Fatalf("reading %+v", reading)
	}
	if len(fired) != 0 || len(held) != 1 {
		t.Fatalf("out of stock: fired %d, held %d", len(fired), len(held))
	}
	if note := heldNote(w, held, reading); note != "Price is below ₹90,000, but the page says it is out of stock" {
		t.Fatalf("note %q", note)
	}
	if fired, held, _ := shopCheck(t, &w, flipkartPage(t, "89999", "http://schema.org/OutOfStock"), 2); len(fired) != 0 || len(held) != 1 {
		t.Fatalf("still out of stock: fired %d, held %d", len(fired), len(held))
	}

	fired, held, _ = shopCheck(t, &w, flipkartPage(t, "89999", "http://schema.org/InStock"), 3)
	if len(fired) != 1 || len(held) != 0 {
		t.Fatalf("back in stock: fired %d, held %d", len(fired), len(held))
	}
	what, body, _ := describe(fired[0])
	if what != "below 90,000" || body != "Now ₹89,999, back in stock" {
		t.Fatalf("alert %q / %q", what, body)
	}
	for i := 4; i < 6; i++ {
		if fired, held, _ := shopCheck(t, &w, flipkartPage(t, "89999", "http://schema.org/InStock"), i); len(fired) != 0 || len(held) != 0 {
			t.Fatalf("check %d after the alert: fired %d, held %d", i, len(fired), len(held))
		}
	}
}

func TestStockFlipkartInStockAlertsOnce(t *testing.T) {
	w := shopWatch(t, Rule{Kind: RuleBelow, Threshold: f(90000)})
	shopCheck(t, &w, flipkartPage(t, "109999", "InStock"), 0)
	fired, held, _ := shopCheck(t, &w, flipkartPage(t, "89999", "InStock"), 1)
	if len(fired) != 1 || len(held) != 0 {
		t.Fatalf("fired %d, held %d", len(fired), len(held))
	}
	if _, body, _ := describe(fired[0]); body != "Now ₹89,999 (was ₹109,999)" {
		t.Fatalf("body %q", body)
	}
	if fired, _, _ := shopCheck(t, &w, flipkartPage(t, "89999", "InStock"), 2); len(fired) != 0 {
		t.Fatal("alerted twice")
	}
}

// A page that states no availability alerts on its price as before.
func TestStockUnknownAlertsAsBefore(t *testing.T) {
	w := shopWatch(t, Rule{Kind: RuleBelow, Threshold: f(90000)}, Rule{Kind: RuleMovePct, Percent: f(5), Direction: DirDown})
	shopCheck(t, &w, flipkartPage(t, "109999", ""), 0)
	fired, held, reading := shopCheck(t, &w, flipkartPage(t, "89999", ""), 1)
	if reading.Availability != extract.AvailUnknown {
		t.Fatalf("availability %q", reading.Availability)
	}
	if len(fired) != 2 || len(held) != 0 {
		t.Fatalf("fired %d, held %d", len(fired), len(held))
	}
}

func TestStockOnlyInStockFalseAlertsWhileOutOfStock(t *testing.T) {
	no := false
	w := shopWatch(t, Rule{Kind: RuleBelow, Threshold: f(90000), OnlyInStock: &no})
	if w.Rules[0].OnlyInStock == nil || *w.Rules[0].OnlyInStock {
		t.Fatalf("false is kept on a product page: %+v", w.Rules[0])
	}
	shopCheck(t, &w, flipkartPage(t, "109999", "InStock"), 0)
	if fired, held, _ := shopCheck(t, &w, flipkartPage(t, "89999", "OutOfStock"), 1); len(fired) != 1 || len(held) != 0 {
		t.Fatalf("fired %d, held %d", len(fired), len(held))
	}
}

// A rule and a reading stored before availability existed: the rule holds
// on stock by default, and the missing availability is no change.
func TestStockOldRuleAndReading(t *testing.T) {
	var r Rule
	if err := json.Unmarshal([]byte(`{"id":"brl_old","kind":"below","threshold":90000,"stepPercent":5,"resetPercent":0.5}`), &r); err != nil {
		t.Fatal(err)
	}
	var prev Reading
	if err := json.Unmarshal([]byte(`{"kind":"price","price":95000,"currency":"INR","at":"2026-11-06T09:00:00Z"}`), &prev); err != nil {
		t.Fatal(err)
	}
	if r.OnlyInStock != nil || !r.onlyInStock() || prev.Availability != "" {
		t.Fatalf("old rule %+v, old reading %+v", r, prev)
	}
	st := RuleState{Armed: true}
	oos := priceAt(89999, 1)
	oos.Availability = extract.AvailOutOfStock
	ev, held, wasHeld := evaluate(r, st, prev, oos)
	if ev != nil || !wasHeld || held != st {
		t.Fatalf("out of stock: %+v %+v %v", ev, held, wasHeld)
	}
	in := priceAt(89999, 2)
	in.Availability = extract.AvailInStock
	if ev, _ := Evaluate(r, held, oos, in); ev == nil {
		t.Fatal("no alert once in stock")
	}
	// No spurious change when the old reading lacks availability.
	samePrice := priceAt(95000, 1)
	samePrice.Availability = extract.AvailInStock
	if changed(prev, samePrice) || watchChanged(prev, samePrice) {
		t.Fatal("an old reading without availability counted as a change")
	}
	if ev, _ := Evaluate(Rule{Kind: RuleAnyChange}, RuleState{}, prev, samePrice); ev != nil {
		t.Fatal("any_change fired on availability first being read")
	}
	// An old rule saved again through CleanRules stays the same rule.
	cleaned, err := CleanRules(WatchPage, ReadProductPrice, []Rule{r})
	if err != nil || !sameRules(cleaned, []Rule{r}) {
		t.Fatalf("cleaned %+v, %v", cleaned, err)
	}
	yes := true
	r2 := r
	r2.OnlyInStock = &yes
	if cleaned, _ := CleanRules(WatchPage, ReadProductPrice, []Rule{r2}); !sameRules(cleaned, []Rule{r}) {
		t.Fatalf("onlyInStock true is a change: %+v", cleaned)
	}
}

// A quiet baseline on an unbuyable price below the line leaves the rule
// armed, so the restock alerts.
func TestStockRebaselineKeepsHeldRuleArmed(t *testing.T) {
	r := Rule{ID: "r", Kind: RuleBelow, Threshold: f(90000)}
	oos := priceAt(89999, 0)
	oos.Availability = extract.AvailOutOfStock
	st := Rebaseline(r, oos)
	if !st.Armed {
		t.Fatalf("state %+v", st)
	}
	in := priceAt(89999, 1)
	in.Availability = extract.AvailInStock
	if ev, _ := Evaluate(r, st, oos, in); ev == nil {
		t.Fatal("no alert on restock")
	}
}

// A price that rises past the reset band while out of stock still re-arms,
// so the next drop that can be bought alerts.
func TestStockHeldRuleStillRearms(t *testing.T) {
	r := Rule{ID: "r", Kind: RuleBelow, Threshold: f(90000), StepPercent: 5, ResetPercent: 0.5}
	in := func(v float64, i int, a string) Reading {
		x := priceAt(v, i)
		x.Availability = a
		return x
	}
	prev := in(95000, 0, extract.AvailInStock)
	st := Rebaseline(r, prev)
	cur := in(89000, 1, extract.AvailInStock)
	ev, st := Evaluate(r, st, prev, cur)
	if ev == nil {
		t.Fatal("first crossing")
	}
	prev, cur = cur, in(95000, 2, extract.AvailOutOfStock)
	if ev, st = Evaluate(r, st, prev, cur); ev != nil || !st.Armed {
		t.Fatalf("rise while out of stock: %+v %+v", ev, st)
	}
	prev, cur = cur, in(89000, 3, extract.AvailOutOfStock)
	var held bool
	if ev, st, held = evaluate(r, st, prev, cur); ev != nil || !held {
		t.Fatalf("drop while out of stock: %+v held %v", ev, held)
	}
	prev, cur = cur, in(89000, 4, extract.AvailLimited)
	if ev, _ = Evaluate(r, st, prev, cur); ev == nil {
		t.Fatal("no alert once it can be bought")
	}
}

func TestStockMovePctAndAnyChange(t *testing.T) {
	at := func(v float64, i int, a string) Reading {
		x := priceAt(v, i)
		x.Availability = a
		return x
	}
	move := Rule{ID: "m", Kind: RuleMovePct, Percent: f(5), Direction: DirDown}
	prev := at(100000, 0, extract.AvailInStock)
	st := Rebaseline(move, prev)
	cur := at(90000, 1, extract.AvailDiscontinued)
	ev, st, held := evaluate(move, st, prev, cur)
	if ev != nil || !held {
		t.Fatalf("discontinued drop: %+v %v", ev, held)
	}
	if ev, _ := Evaluate(move, st, cur, at(90000, 2, extract.AvailInStock)); ev == nil {
		t.Fatal("the drop does not alert once it can be bought")
	}

	anyChange := Rule{ID: "a", Kind: RuleAnyChange}
	in, out := at(100000, 0, extract.AvailInStock), at(100000, 1, extract.AvailOutOfStock)
	if ev, _, held := evaluate(anyChange, RuleState{}, in, out); ev != nil || !held {
		t.Fatalf("selling out: %+v %v", ev, held)
	}
	ev, _ = Evaluate(anyChange, RuleState{}, out, at(100000, 2, extract.AvailInStock))
	if ev == nil {
		t.Fatal("restock at the same price is a change")
	}
	what, body, _ := describe(firedEvent{ev: *ev, w: Watch{Kind: WatchPage, ReadMode: ReadProductPrice}, rule: anyChange})
	if what != "back in stock" || body != "Now ₹100,000" {
		t.Fatalf("restock alert %q / %q", what, body)
	}
	// Flips between buyable states at the same price are not a change.
	in, lim := at(100000, 3, extract.AvailInStock), at(100000, 4, extract.AvailLimited)
	if changed(in, lim) || changed(lim, at(100000, 5, extract.AvailPreorder)) {
		t.Fatal("a buyable-to-buyable flip counted as a change")
	}
	if ev, _ := Evaluate(anyChange, RuleState{}, in, lim); ev != nil {
		t.Fatalf("any_change fired on in stock to limited: %+v", ev)
	}
	if changed(at(100000, 6, extract.AvailOutOfStock), at(100000, 7, extract.AvailDiscontinued)) {
		t.Fatal("out of stock to discontinued counted as a change")
	}
}

func TestInStockRule(t *testing.T) {
	r := Rule{ID: "s", Kind: RuleInStock}
	at := func(i int, a string) Reading {
		x := priceAt(89999, i)
		x.Availability = a
		return x
	}
	steps := []struct {
		avail string
		fire  bool
	}{
		{extract.AvailInStock, false}, // baseline
		{extract.AvailOutOfStock, false},
		{extract.AvailUnknown, false}, // an unknown keeps it waiting
		{extract.AvailInStock, true},
		{extract.AvailInStock, false},
		{extract.AvailDiscontinued, false},
		{extract.AvailPreorder, true},
	}
	prev := at(0, steps[0].avail)
	st := Rebaseline(r, prev)
	for i, s := range steps[1:] {
		cur := at(i+1, s.avail)
		ev, next := Evaluate(r, st, prev, cur)
		if (ev != nil) != s.fire {
			t.Fatalf("step %d (%s): fired %v", i+1, s.avail, ev != nil)
		}
		st, prev = next, cur
	}
	// A page that never said it was out of stock never restocks.
	unknown := at(0, extract.AvailUnknown)
	if ev, _ := Evaluate(r, Rebaseline(r, unknown), unknown, at(1, extract.AvailInStock)); ev != nil {
		t.Fatal("unknown then in stock counted as a restock")
	}
	ev, _ := Evaluate(r, Rebaseline(r, at(0, extract.AvailOutOfStock)), at(0, extract.AvailOutOfStock), at(1, extract.AvailInStock))
	if ev == nil {
		t.Fatal("no restock")
	}
	what, body, _ := describe(firedEvent{ev: *ev, w: Watch{Kind: WatchPage, ReadMode: ReadProductPrice}, rule: r})
	if what != "back in stock" || body != "Now ₹89,999" {
		t.Fatalf("alert %q / %q", what, body)
	}
	if got := ruleWords(r, "INR"); got != "Back in stock" {
		t.Fatalf("ruleWords %q", got)
	}
}

func TestCleanRulesStock(t *testing.T) {
	no := false
	cases := []struct {
		name       string
		kind, mode string
		rule       Rule
		err        string
		keepsFalse bool
	}{
		{"in_stock on a product page", WatchPage, ReadProductPrice, Rule{Kind: RuleInStock}, "", false},
		{"in_stock on a selector price", WatchPage, ReadSelectorPrice, Rule{Kind: RuleInStock}, "Only a page read as product_price can use in_stock", false},
		{"in_stock on a market price", WatchPrice, "", Rule{Kind: RuleInStock}, "Only a page read as product_price can use in_stock", false},
		{"in_stock on page text", WatchPage, ReadText, Rule{Kind: RuleInStock}, "Only a page read as product_price can use in_stock", false},
		{"in_stock takes no threshold", WatchPage, ReadProductPrice, Rule{Kind: RuleInStock, Threshold: f(5)}, "Only above and below rules take a threshold", false},
		{"false kept on a product page", WatchPage, ReadProductPrice, Rule{Kind: RuleBelow, Threshold: f(5), OnlyInStock: &no}, "", true},
		{"false dropped on a selector price", WatchPage, ReadSelectorPrice, Rule{Kind: RuleBelow, Threshold: f(5), OnlyInStock: &no}, "", false},
		{"false dropped on a market price", WatchPrice, "", Rule{Kind: RuleBelow, Threshold: f(5), OnlyInStock: &no}, "", false},
		{"false dropped on in_stock", WatchPage, ReadProductPrice, Rule{Kind: RuleInStock, OnlyInStock: &no}, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out, err := CleanRules(c.kind, c.mode, []Rule{c.rule})
			if c.err != "" {
				var ie *InputError
				if !errors.As(err, &ie) || !strings.Contains(ie.Message, c.err) {
					t.Fatalf("err %v, want %q", err, c.err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := out[0].OnlyInStock != nil; got != c.keepsFalse {
				t.Fatalf("onlyInStock %+v", out[0].OnlyInStock)
			}
		})
	}
	// A wrong kind on a product page names in_stock among the ones that fit.
	_, err := CleanRules(WatchPage, ReadProductPrice, []Rule{{Kind: RuleNewItem}})
	if err == nil || !strings.Contains(err.Error(), "in_stock") {
		t.Fatalf("err %v", err)
	}
}

// Pass to: a note read off a page that cannot be bought holds no price rule.
func TestHoldsStock(t *testing.T) {
	below := Rule{Kind: RuleBelow, Threshold: f(90000)}
	r := priceAt(89999, 0)
	for avail, want := range map[string]bool{extract.AvailOutOfStock: false, extract.AvailInStock: true, extract.AvailUnknown: true, "": true} {
		r.Availability = avail
		if got := holds(below, r, "INR"); got != want {
			t.Errorf("holds(below, %q) = %v, want %v", avail, got, want)
		}
	}
	r.Availability = extract.AvailInStock
	if !holds(Rule{Kind: RuleInStock}, r, "") {
		t.Error("in_stock does not hold on a page in stock")
	}
	r.Availability = extract.AvailUnknown
	if holds(Rule{Kind: RuleInStock}, r, "") {
		t.Error("in_stock holds on an unknown")
	}
}

func TestStockWordsForTheJudgeAndViews(t *testing.T) {
	no := false
	if got := ruleWords(Rule{Kind: RuleBelow, Threshold: f(90000), OnlyInStock: &no}, "INR"); got != "Price is below ₹90,000, in stock or not" {
		t.Errorf("ruleWords %q", got)
	}
	before, after := priceAt(89999, 0), priceAt(89999, 1)
	before.Availability, after.Availability = extract.AvailOutOfStock, extract.AvailInStock
	r := Rule{ID: "r", Kind: RuleBelow, Threshold: f(90000)}
	c := judgeChange(firedEvent{ev: Event{WatchID: "w", RuleID: "r", Kind: RuleBelow, Before: before, After: after}, w: Watch{ID: "w", Kind: WatchPage, ReadMode: ReadProductPrice, URL: "https://shop.example/p"}, rule: r})
	if c.Stock != "out of stock, now in stock" || c.After != "₹89,999" {
		t.Errorf("judge change %+v", c)
	}
	before.Availability = ""
	if got := stockLine(before, after); got != "in stock" {
		t.Errorf("stockLine %q", got)
	}
	if got := stockLine(after, priceAt(1, 2)); got != "" {
		t.Errorf("stockLine with nothing stated %q", got)
	}
	if got := summaryWithStock(&after); got != "₹89,999, in stock" {
		t.Errorf("summaryWithStock %q", got)
	}

	shop := Watch{Kind: WatchPage, ReadMode: ReadProductPrice}
	old := priceAt(5, 0)
	cases := []struct {
		r    *Reading
		w    Watch
		want string
	}{
		{&after, shop, extract.AvailInStock},
		{&old, shop, extract.AvailUnknown}, // saved before availability was read
		{&after, Watch{Kind: WatchPage, ReadMode: ReadSelectorPrice}, ""},
		{&after, Watch{Kind: WatchPrice}, ""},
		{nil, shop, ""},
	}
	for i, c := range cases {
		if got := availabilityOf(c.r, c.w); got != c.want {
			t.Errorf("case %d: availabilityOf %q, want %q", i, got, c.want)
		}
	}
	if got := stripMark(outHeldStock); got != 'c' {
		t.Errorf("stripMark(held_stock) = %q", got)
	}
	if got := checkNote(Check{Watches: jsonList[CheckWatch]{{Outcome: outUnchanged}, {Outcome: outHeldStock, Note: "why"}}}); got != "why" {
		t.Errorf("checkNote %q", got)
	}
}

func TestHeldNoteCountsMoreRules(t *testing.T) {
	w := Watch{Currency: "INR"}
	reading := priceAt(89999, 0)
	reading.Availability = extract.AvailDiscontinued
	held := []Rule{{Kind: RuleBelow, Threshold: f(90000)}, {Kind: RuleMovePct, Percent: f(5), Direction: DirDown}, {Kind: RuleAnyChange}}
	if got := heldNote(w, held, reading); got != "Price is below ₹90,000 (and 2 more rules), but the page says it is discontinued" {
		t.Fatalf("note %q", got)
	}
	if got := heldNote(w, held[:2], reading); got != "Price is below ₹90,000 (and 1 more rule), but the page says it is discontinued" {
		t.Fatalf("note %q", got)
	}
}
