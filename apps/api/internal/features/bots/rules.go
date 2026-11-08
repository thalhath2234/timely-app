package bots

import (
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"timely-api/internal/features/bots/extract"
)

// Rule kinds.
const (
	RuleAnyChange      = "any_change"
	RuleAbove          = "above"
	RuleBelow          = "below"
	RuleMovePct        = "move_pct"
	RuleWordsAppear    = "words_appear"
	RuleWordsDisappear = "words_disappear"
	RuleNewItem        = "new_item"
	// RuleInStock fires when a product page that said it could not be
	// bought says it can again.
	RuleInStock = "in_stock"
)

// move_pct directions.
const (
	DirUp   = "up"
	DirDown = "down"
	DirAny  = "any"
)

// Reading kinds.
const (
	ReadingText  = "text"
	ReadingPrice = "price"
	ReadingFeed  = "feed"
)

const (
	DefaultStepPercent  = 5
	DefaultResetPercent = 0.5
	maxMovePercent      = 1000
	maxStepPercent      = 100
	maxResetPercent     = 50
	// eps is the relative tolerance for comparing prices.
	eps = 1e-9
)

// Rule is one condition on a watch. Rules fire once: a threshold fires when
// it is crossed, again only after a further StepPercent, and re-arms once the
// value is back past ResetPercent on the other side, so a price that hovers
// at the line alerts once.
type Rule struct {
	ID           string   `json:"id"`   // brl_<uuid>, set at save
	Kind         string   `json:"kind"` // Rule* constants
	Threshold    *float64 `json:"threshold,omitempty"`
	Percent      *float64 `json:"percent,omitempty"`   // move_pct
	Direction    string   `json:"direction,omitempty"` // up|down|any (move_pct)
	StepPercent  float64  `json:"stepPercent"`         // above/below; 0 means DefaultStepPercent
	ResetPercent float64  `json:"resetPercent"`        // above/below; 0 means DefaultResetPercent
	Words        []string `json:"words,omitempty"`
	// OnlyInStock holds a price rule on a product_price page while the page
	// says the product cannot be bought (out of stock or discontinued). nil
	// means true, so rules saved before it existed hold too; an unknown
	// availability never holds a rule. Kept only on product_price watches.
	OnlyInStock *bool `json:"onlyInStock,omitempty"`
}

// RuleState is what a rule remembers between checks. Ref is the value of the
// last fire (above/below) or the reference a move is measured from
// (move_pct).
type RuleState struct {
	Armed   bool       `json:"armed"`
	Ref     *float64   `json:"ref,omitempty"`
	FiredAt *time.Time `json:"firedAt,omitempty"`
}

// Reading is what one check read from one watch.
type Reading struct {
	Kind     string   `json:"kind"` // Reading* constants
	Text     string   `json:"text,omitempty"`
	Hash     string   `json:"hash,omitempty"`
	Price    *float64 `json:"price,omitempty"`
	Currency string   `json:"currency,omitempty"`
	// Availability is a product_price page's extract.Avail word; "" for
	// readings that do not read it and for ones saved before it existed.
	Availability string             `json:"availability,omitempty"`
	Items        []extract.FeedItem `json:"items,omitempty"` // newest MaxItems
	Seen         []string           `json:"seen,omitempty"`  // newest MaxSeen ids
	// Title is a page's own name (extract.PageTitle), for showing the watch.
	// It is not part of Hash or of any rule, so a new title never fires or
	// rebaselines anything.
	Title string    `json:"title,omitempty"`
	At    time.Time `json:"at"`
}

// Event is one rule firing. Evaluate leaves WatchID for the caller.
type Event struct {
	WatchID, RuleID, Kind string
	Before, After         Reading
	NewItems              []extract.FeedItem
}

// ReadingKind is the kind of Reading a watch gives, or "" for a kind and
// read mode that do not go together.
func ReadingKind(kind, mode string) string {
	switch {
	case kind == WatchPage && (mode == ReadText || mode == ReadSelector):
		return ReadingText
	case kind == WatchPage && (mode == ReadProductPrice || mode == ReadSelectorPrice), kind == WatchPrice && mode == "":
		return ReadingPrice
	case kind == WatchFeed && mode == "":
		return ReadingFeed
	}
	return ""
}

// fits lists the rule kinds each reading kind takes.
var fits = map[string][]string{
	ReadingText:  {RuleAnyChange, RuleWordsAppear, RuleWordsDisappear},
	ReadingPrice: {RuleMovePct, RuleAbove, RuleBelow, RuleAnyChange},
	ReadingFeed:  {RuleNewItem},
}

var fitsLine = map[string]string{
	ReadingText:  "A page can use any_change, words_appear or words_disappear",
	ReadingPrice: "A price can use above, below, move_pct or any_change",
	ReadingFeed:  "A feed can use new_item",
}

// readsStock reports a watch whose readings carry availability: a page read
// as product_price. Only it takes in_stock and onlyInStock.
func readsStock(kind, mode string) bool {
	return kind == WatchPage && mode == ReadProductPrice
}

// DefaultRules is what a watch gets when it is saved with no rules: a page
// alerts on any change, a shop price on a 5% drop, a feed on new items and a
// market price on a 5% move either way.
func DefaultRules(kind, mode string) []Rule {
	five := 5.0
	switch ReadingKind(kind, mode) {
	case ReadingText:
		return []Rule{{Kind: RuleAnyChange}}
	case ReadingFeed:
		return []Rule{{Kind: RuleNewItem}}
	case ReadingPrice:
		dir := DirAny
		if kind == WatchPage {
			dir = DirDown
		}
		return []Rule{{Kind: RuleMovePct, Percent: &five, Direction: dir}}
	}
	return nil
}

// ValidateRules checks that every rule fits the watch and is complete. Its
// errors are *InputError sentences for the person. An empty list is valid:
// CleanRules gives it DefaultRules.
func ValidateRules(kind, mode string, rules []Rule) error {
	_, err := CleanRules(kind, mode, rules)
	return err
}

// CleanRules validates rules and returns them ready to store: words trimmed
// and deduplicated, above/below defaults filled in and a move's direction
// set. IDs are left as given. An empty list gives DefaultRules.
func CleanRules(kind, mode string, rules []Rule) ([]Rule, error) {
	rk := ReadingKind(kind, mode)
	if rk == "" {
		return nil, invalid("A watch is a page (text, selector, product_price or selector_price), a feed or a price")
	}
	if len(rules) == 0 {
		return DefaultRules(kind, mode), nil
	}
	if len(rules) > MaxRulesPerWatch {
		return nil, invalid("A watch can have up to %d rules", MaxRulesPerWatch)
	}
	ids := map[string]bool{}
	stock := readsStock(kind, mode)
	out := make([]Rule, 0, len(rules))
	for _, r := range rules {
		if r.ID != "" {
			if ids[r.ID] {
				return nil, invalid("Two rules share the id %q", r.ID)
			}
			ids[r.ID] = true
		}
		c, err := cleanRule(rk, stock, r)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func cleanRule(rk string, stock bool, r Rule) (Rule, error) {
	line := fitsLine[rk]
	if stock {
		line += ", and a product_price page in_stock"
	}
	if r.Kind == RuleInStock {
		if !stock {
			return Rule{}, invalid("Only a page read as product_price can use in_stock. %s", line)
		}
		r.OnlyInStock = nil
	} else if !contains(fits[rk], r.Kind) {
		if !known(r.Kind) {
			return Rule{}, invalid("%q is not a rule. %s", r.Kind, line)
		}
		return Rule{}, invalid("A %s rule does not fit this watch. %s", r.Kind, line)
	}
	threshold := r.Kind == RuleAbove || r.Kind == RuleBelow
	takesWords := r.Kind == RuleWordsAppear || r.Kind == RuleWordsDisappear || r.Kind == RuleNewItem

	switch {
	case threshold && r.Threshold == nil:
		return Rule{}, invalid("Give the %s rule a threshold", r.Kind)
	case threshold && !(finite(*r.Threshold) && *r.Threshold > 0):
		return Rule{}, invalid("The threshold must be a number above 0")
	case !threshold && r.Threshold != nil:
		return Rule{}, invalid("Only above and below rules take a threshold")
	}

	if r.Kind == RuleMovePct {
		switch {
		case r.Percent == nil:
			return Rule{}, invalid("Give the move_pct rule a percent")
		case !(finite(*r.Percent) && *r.Percent > 0 && *r.Percent <= maxMovePercent):
			return Rule{}, invalid("The percent must be above 0 and at most %d", maxMovePercent)
		}
		switch r.Direction {
		case "":
			r.Direction = DirAny
		case DirUp, DirDown, DirAny:
		default:
			return Rule{}, invalid("The direction must be up, down or any")
		}
	} else {
		if r.Percent != nil {
			return Rule{}, invalid("Only move_pct rules take a percent")
		}
		if r.Direction != "" {
			return Rule{}, invalid("Only move_pct rules take a direction")
		}
	}

	if threshold {
		switch {
		case !finite(r.StepPercent) || r.StepPercent < 0 || r.StepPercent > maxStepPercent:
			return Rule{}, invalid("stepPercent must be between 0 and %d", maxStepPercent)
		case !finite(r.ResetPercent) || r.ResetPercent < 0 || r.ResetPercent > maxResetPercent:
			return Rule{}, invalid("resetPercent must be between 0 and %d", maxResetPercent)
		}
		r.StepPercent, r.ResetPercent = r.step(), r.reset()
	} else if r.StepPercent != 0 || r.ResetPercent != 0 {
		return Rule{}, invalid("Only above and below rules take stepPercent and resetPercent")
	}

	words, err := cleanWords(r.Words)
	if err != nil {
		return Rule{}, err
	}
	switch {
	case !takesWords && len(words) > 0:
		return Rule{}, invalid("Only words_appear, words_disappear and new_item rules take words")
	case (r.Kind == RuleWordsAppear || r.Kind == RuleWordsDisappear) && len(words) == 0:
		return Rule{}, invalid("Give the %s rule at least one word", r.Kind)
	}
	r.Words = words

	// true is the default, so it is stored as nil and an edit that spells
	// it out is no change. A watch that reads no availability has nothing
	// to hold on, so it keeps none.
	if !stock || (r.OnlyInStock != nil && *r.OnlyInStock) {
		r.OnlyInStock = nil
	}
	return r, nil
}

// holdsOnStock lists the rule kinds onlyInStock holds: the ones on a price.
func holdsOnStock(kind string) bool {
	return kind == RuleAbove || kind == RuleBelow || kind == RuleMovePct || kind == RuleAnyChange
}

// onlyInStock is OnlyInStock with its default.
func (r Rule) onlyInStock() bool { return r.OnlyInStock == nil || *r.OnlyInStock }

// heldByStock reports a rule that must not fire on cur: it holds on stock
// and cur's page says the product cannot be bought.
func heldByStock(r Rule, cur Reading) bool {
	return holdsOnStock(r.Kind) && r.onlyInStock() && extract.Unbuyable(cur.Availability)
}

func cleanWords(in []string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, w := range in {
		w = strings.Join(strings.Fields(w), " ")
		if w == "" {
			continue
		}
		if utf8.RuneCountInString(w) > MaxWordLen {
			return nil, invalid("Keep each word under %d characters", MaxWordLen)
		}
		key := strings.ToLower(w)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, w)
	}
	if len(out) > MaxWords {
		return nil, invalid("Use up to %d words in a rule", MaxWords)
	}
	return out, nil
}

func (r Rule) step() float64 {
	if r.StepPercent > 0 {
		return r.StepPercent
	}
	return DefaultStepPercent
}

func (r Rule) reset() float64 {
	if r.ResetPercent > 0 {
		return r.ResetPercent
	}
	return DefaultResetPercent
}

// Rebaseline is the state of a rule right after a quiet baseline reading: a
// rule whose condition is already true starts disarmed, so it never fires
// for what was already there, and Ref is the current value.
func Rebaseline(r Rule, cur Reading) RuleState {
	st := RuleState{Armed: !conditionTrue(r, cur)}
	if r.Kind == RuleInStock {
		// Armed only by a page that said it could not be bought, so an
		// unknown that turns into "in stock" is no restock.
		st.Armed = extract.Unbuyable(cur.Availability)
	}
	if v, ok := cur.value(); ok && usesValue(r.Kind) {
		st.Ref = &v
	}
	return st
}

// Evaluate checks one rule against a new reading. It returns the Event when
// the rule fires, and the rule's new state either way. A zero state (a rule
// with nothing stored) is first rebaselined against prev.
func Evaluate(r Rule, st RuleState, prev, cur Reading) (*Event, RuleState) {
	ev, st, _ := evaluate(r, st, prev, cur)
	return ev, st
}

// evaluate is Evaluate that also reports a rule held by stock: it would
// have fired, but cur's page says the product cannot be bought. A held rule
// keeps the state it had, so it fires once the product can be bought again
// if its condition still holds then. A rule that would not have fired moves
// on as usual (re-arming, say), stock or not.
func evaluate(r Rule, st RuleState, prev, cur Reading) (*Event, RuleState, bool) {
	if st == (RuleState{}) {
		st = Rebaseline(r, prev)
	}
	// A price that changed currency cannot be compared: start again quietly.
	if usesValue(r.Kind) && prev.Currency != "" && cur.Currency != "" && !strings.EqualFold(prev.Currency, cur.Currency) {
		return nil, Rebaseline(r, cur), false
	}
	before := st
	ev, st := fireRule(r, st, prev, cur)
	if ev != nil && heldByStock(r, cur) {
		return nil, before, true
	}
	return ev, st, false
}

// fireRule runs one rule on a reading, stock aside.
func fireRule(r Rule, st RuleState, prev, cur Reading) (*Event, RuleState) {
	var fire bool
	var items []extract.FeedItem
	switch r.Kind {
	case RuleBelow, RuleAbove:
		fire = crossing(r, &st, cur)
	case RuleMovePct:
		fire = moved(r, &st, cur)
	case RuleWordsAppear, RuleWordsDisappear:
		cond := conditionTrue(r, cur)
		fire = st.Armed && cond
		st.Armed = !cond
	case RuleAnyChange:
		fire = changed(prev, cur)
	case RuleNewItem:
		items = newItems(r, prev, cur)
		fire = len(items) > 0
	case RuleInStock:
		// An unknown changes nothing: it is neither a restock nor a sell-out.
		switch {
		case extract.Unbuyable(cur.Availability):
			st.Armed = true
		case extract.Buyable(cur.Availability):
			fire = st.Armed
			st.Armed = false
		}
	}
	if !fire {
		return nil, st
	}
	at := cur.At
	st.FiredAt = &at
	return &Event{RuleID: r.ID, Kind: r.Kind, Before: prev, After: cur, NewItems: items}, st
}

// crossing runs an above or below rule: fire on crossing while armed, fire
// again on each further step past Ref, re-arm once back past the reset band.
func crossing(r Rule, st *RuleState, cur Reading) bool {
	v, ok := cur.value()
	if !ok || r.Threshold == nil {
		return false
	}
	t, step, reset := *r.Threshold, r.step()/100, r.reset()/100
	below := r.Kind == RuleBelow
	beyond := func(a, b float64) bool { // a is past b on the rule's side
		if below {
			return lt(a, b)
		}
		return lt(b, a)
	}
	atOrBeyond := func(a, b float64) bool { return !beyond(b, a) }

	switch {
	case st.Armed:
		if beyond(v, t) {
			st.Armed, st.Ref = false, &v
			return true
		}
		return false
	case below && le(t*(1+reset), v), !below && le(v, t*(1-reset)):
		st.Armed, st.Ref = true, &v
		return false
	case st.Ref == nil:
		st.Ref = &v
		return false
	}
	further := *st.Ref * (1 + step)
	if below {
		further = *st.Ref * (1 - step)
	}
	if atOrBeyond(v, further) {
		st.Ref = &v
		return true
	}
	return false
}

func moved(r Rule, st *RuleState, cur Reading) bool {
	st.Armed = true
	v, ok := cur.value()
	if !ok || r.Percent == nil {
		return false
	}
	if st.Ref == nil || near(*st.Ref, 0) {
		st.Ref = &v
		return false
	}
	move := (v - *st.Ref) / math.Abs(*st.Ref) * 100
	switch r.Direction {
	case DirUp:
	case DirDown:
		move = -move
	default:
		move = math.Abs(move)
	}
	if le(*r.Percent, move) {
		st.Ref = &v
		return true
	}
	return false
}

// changed reports another price (or currency), or a stated availability
// that moved. An availability the page did not state, or that a reading
// saved before availability was read lacks, is not a change.
func changed(prev, cur Reading) bool {
	if cur.Kind == ReadingPrice || prev.Kind == ReadingPrice {
		p, okP := prev.value()
		c, okC := cur.value()
		return okP != okC || (okC && !near(p, c)) || !strings.EqualFold(prev.Currency, cur.Currency) || stockMoved(prev, cur)
	}
	return hashOf(prev) != hashOf(cur)
}

func newItems(r Rule, prev, cur Reading) []extract.FeedItem {
	seen := make(map[string]bool, len(prev.Seen)+len(prev.Items))
	for _, id := range prev.Seen {
		seen[id] = true
	}
	for _, it := range prev.Items {
		seen[it.ID] = true
	}
	var out []extract.FeedItem
	for _, it := range cur.Items {
		if seen[it.ID] {
			continue
		}
		seen[it.ID] = true
		if len(r.Words) == 0 || len(MatchWords(r.Words, it.Title)) > 0 {
			out = append(out, it)
		}
	}
	return out
}

// MergeSeen is the Seen list after reading items: the items' IDs first, in
// feed order, then the earlier ones, without repeats and at most MaxSeen.
func MergeSeen(prev []string, items []extract.FeedItem) []string {
	out := make([]string, 0, min(len(items)+len(prev), MaxSeen))
	have := map[string]bool{}
	add := func(id string) {
		if id != "" && !have[id] && len(out) < MaxSeen {
			have[id] = true
			out = append(out, id)
		}
	}
	for _, it := range items {
		add(it.ID)
	}
	for _, id := range prev {
		add(id)
	}
	return out
}

// stockMoved reports two readings whose pages both stated an availability,
// and not the same one.
func stockMoved(prev, cur Reading) bool {
	return extract.KnownAvailability(prev.Availability) && extract.KnownAvailability(cur.Availability) && prev.Availability != cur.Availability
}

// conditionTrue reports whether a rule's condition holds on cur. A price
// rule held by stock does not hold, so a quiet baseline on an unbuyable
// price leaves it armed for when the product can be bought.
func conditionTrue(r Rule, cur Reading) bool {
	if heldByStock(r, cur) {
		return false
	}
	switch r.Kind {
	case RuleBelow, RuleAbove:
		v, ok := cur.value()
		if !ok || r.Threshold == nil {
			return false
		}
		if r.Kind == RuleBelow {
			return lt(v, *r.Threshold)
		}
		return lt(*r.Threshold, v)
	case RuleWordsAppear:
		return len(MatchWords(r.Words, cur.Text)) > 0
	case RuleWordsDisappear:
		return len(MatchWords(r.Words, cur.Text)) == 0
	}
	return false
}

// holds reports whether a rule is true of a passed note right now, with no
// earlier reading to measure from (Pass to): a price is below or above the
// threshold (never across currencies: currency is the watch's, "" for
// any), words appear or are gone, and any change, a new item or a move
// count as true, since the note is new to the Bot.
func holds(r Rule, reading Reading, currency string) bool {
	if heldByStock(r, reading) {
		return false
	}
	switch r.Kind {
	case RuleInStock:
		return extract.Buyable(reading.Availability)
	case RuleBelow, RuleAbove:
		if currency != "" && reading.Currency != "" && !strings.EqualFold(currency, reading.Currency) {
			return false
		}
		return conditionTrue(r, reading)
	case RuleWordsAppear, RuleWordsDisappear:
		return conditionTrue(r, reading)
	case RuleAnyChange, RuleNewItem, RuleMovePct:
		return true
	}
	return false
}

// MatchWords returns the words found in text as whole words, ignoring case,
// after extract.Normalize on both sides.
func MatchWords(words []string, text string) []string {
	if len(words) == 0 {
		return nil
	}
	text = strings.ToLower(extract.Normalize(text))
	var out []string
	for _, w := range words {
		if n := strings.ToLower(extract.Normalize(w)); n != "" && hasWord(text, n) {
			out = append(out, w)
		}
	}
	return out
}

// hasWord finds w in text with no letter or digit joined on either side,
// except in scripts written without spaces, where any match counts.
func hasWord(text, w string) bool {
	first, size := utf8.DecodeRuneInString(w)
	last, _ := utf8.DecodeLastRuneInString(w)
	for i := 0; i <= len(text)-len(w); {
		j := strings.Index(text[i:], w)
		if j < 0 {
			return false
		}
		start, end := i+j, i+j+len(w)
		before, _ := utf8.DecodeLastRuneInString(text[:start])
		after, _ := utf8.DecodeRuneInString(text[end:])
		if !(start > 0 && wordRune(first) && wordRune(before)) && !(end < len(text) && wordRune(last) && wordRune(after)) {
			return true
		}
		i = start + size
	}
	return false
}

func wordRune(r rune) bool {
	return (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') &&
		!unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Thai, unicode.Lao, unicode.Khmer, unicode.Myanmar)
}

func (r Reading) value() (float64, bool) {
	if r.Price == nil || !finite(*r.Price) {
		return 0, false
	}
	return *r.Price, true
}

func hashOf(r Reading) string {
	if r.Hash != "" {
		return r.Hash
	}
	return extract.Hash(r.Text)
}

func usesValue(kind string) bool {
	return kind == RuleAbove || kind == RuleBelow || kind == RuleMovePct
}

func known(kind string) bool {
	for _, ks := range fits {
		if contains(ks, kind) {
			return true
		}
	}
	return false
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

func near(a, b float64) bool { return math.Abs(a-b) <= eps*math.Max(math.Abs(a), math.Abs(b)) }

func lt(a, b float64) bool { return a < b && !near(a, b) }

func le(a, b float64) bool { return a < b || near(a, b) }
