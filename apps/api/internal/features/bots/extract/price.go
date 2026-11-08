package extract

import (
	"cmp"
	"encoding/json"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Price is a product's price as the page states it. From is where it was
// read: "jsonld", "og" or "itemprop". Availability is one of the Avail
// words, AvailUnknown when the page states none.
type Price struct {
	Amount       float64
	Currency     string
	From         string
	Availability string
}

// ProductPrice reads a product page's price. It tries, in order: JSON-LD
// Product offers (Offer, AggregateOffer's lowPrice, @graph and @id
// references), then og:price:amount or product:price:amount with its
// currency, then microdata itemprop="price". No price gives ErrEmpty.
//
// Availability comes from the offers at the price read, else from
// og:availability or product:availability, else, for a microdata price,
// from microdata itemprop="availability".
func ProductPrice(body []byte, contentType string) (Price, error) {
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return Price{}, err
	}
	var pg pricePage
	pg.walk(doc)
	p, ok := jsonLDPrice(pg.ldJSON)
	if !ok {
		p, ok = pg.ogPrice()
	}
	if !ok {
		p, ok = pg.itempropPrice()
	}
	if !ok {
		return Price{}, ErrEmpty
	}
	if !KnownAvailability(p.Availability) {
		p.Availability = pg.availability(p.From == "itemprop")
	}
	return p, nil
}

// pricePage is what one walk of the page collects.
type pricePage struct {
	ldJSON       []string
	meta         map[string]string // first content per og/product price or availability property
	itemPrice    []string
	itemLow      []string
	itemCurrency string
	itemAvail    []string
}

func (pg *pricePage) walk(n *html.Node) {
	if n.Type == html.ElementNode {
		switch {
		case n.DataAtom == atom.Script:
			if t, _, _ := strings.Cut(strings.ToLower(attr(n, "type")), ";"); strings.TrimSpace(t) == "application/ld+json" {
				pg.ldJSON = append(pg.ldJSON, innerText(n))
			}
			return
		case n.DataAtom == atom.Meta:
			key := strings.ToLower(attr(n, "property"))
			if key == "" {
				key = strings.ToLower(attr(n, "name"))
			}
			if strings.HasSuffix(key, ":price:amount") || strings.HasSuffix(key, ":price:currency") || key == "og:availability" || key == "product:availability" {
				if pg.meta == nil {
					pg.meta = map[string]string{}
				}
				if _, seen := pg.meta[key]; !seen {
					pg.meta[key] = attr(n, "content")
				}
			}
		}
		for _, p := range strings.Fields(attr(n, "itemprop")) {
			switch p {
			case "price":
				pg.itemPrice = append(pg.itemPrice, itemValue(n))
			case "lowPrice":
				pg.itemLow = append(pg.itemLow, itemValue(n))
			case "priceCurrency":
				if pg.itemCurrency == "" {
					pg.itemCurrency = itemValue(n)
				}
			case "availability":
				v := itemValue(n)
				if n.DataAtom == atom.Link || (v == "" && hasAttr(n, "href")) {
					v = attr(n, "href")
				}
				pg.itemAvail = append(pg.itemAvail, v)
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		pg.walk(c)
	}
}

func (pg *pricePage) ogPrice() (Price, bool) {
	for _, prefix := range []string{"og", "product"} {
		amount, ok := machineAmount(pg.meta[prefix+":price:amount"])
		if !ok {
			continue
		}
		cur := pg.meta[prefix+":price:currency"]
		if cur == "" {
			cur = cmp.Or(pg.meta["og:price:currency"], pg.meta["product:price:currency"])
		}
		return Price{Amount: amount, Currency: currencyCode(cur, pg.meta[prefix+":price:amount"]), From: "og"}, true
	}
	return Price{}, false
}

// availability is the first availability the page's meta tags, then (for a
// price read from microdata) its microdata, state; AvailUnknown when none
// does. A JSON-LD or meta price skips microdata, which on a shop page often
// belongs to a carousel of other products.
func (pg *pricePage) availability(microdata bool) string {
	vals := []string{pg.meta["og:availability"], pg.meta["product:availability"]}
	if microdata {
		vals = append(vals, pg.itemAvail...)
	}
	for _, v := range vals {
		if a := NormalizeAvailability(v); KnownAvailability(a) {
			return a
		}
	}
	return AvailUnknown
}

func (pg *pricePage) itempropPrice() (Price, bool) {
	for _, list := range [][]string{pg.itemPrice, pg.itemLow} {
		for _, v := range list {
			if amount, ok := machineAmount(v); ok {
				return Price{Amount: amount, Currency: currencyCode(pg.itemCurrency, v), From: "itemprop"}, true
			}
		}
	}
	return Price{}, false
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasAttr(n *html.Node, key string) bool {
	for _, a := range n.Attr {
		if a.Key == key {
			return true
		}
	}
	return false
}

// itemValue is a microdata property's value: its content attribute, else its text.
func itemValue(n *html.Node) string {
	if hasAttr(n, "content") {
		return attr(n, "content")
	}
	return strings.Join(strings.Fields(innerText(n)), " ")
}

func innerText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

// jsonLDPrice reads the first priced offer of the first Product, or a
// top-level Offer, across the page's JSON-LD blocks in page order.
func jsonLDPrice(blocks []string) (Price, bool) {
	var roots []any
	ids := map[string]map[string]any{}
	for _, raw := range blocks {
		v, ok := decodeLD(raw)
		if !ok {
			continue
		}
		roots = append(roots, v)
		indexIDs(v, ids)
	}
	ld := newLDReader(ids)
	for _, v := range roots {
		if p, ok := ld.find(v, true); ok {
			return p, true
		}
	}
	return Price{}, false
}

func decodeLD(raw string) (any, bool) {
	raw = strings.TrimSpace(raw)
	for _, wrap := range []string{"<!--", "-->", "//<![CDATA[", "//]]>", "<![CDATA[", "]]>"} {
		raw = strings.ReplaceAll(raw, wrap, "")
	}
	// Raw line breaks inside strings are invalid JSON but common; as
	// whitespace they change nothing a price needs.
	raw = strings.NewReplacer("\n", " ", "\r", " ", "\t", " ").Replace(raw)
	d := json.NewDecoder(strings.NewReader(raw))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		return nil, false
	}
	return v, true
}

func indexIDs(v any, ids map[string]map[string]any) {
	switch t := v.(type) {
	case map[string]any:
		if id, ok := t["@id"].(string); ok && len(t) > 1 {
			if _, seen := ids[id]; !seen {
				ids[id] = t
			}
		}
		for _, c := range t {
			indexIDs(c, ids)
		}
	case []any:
		for _, c := range t {
			indexIDs(c, ids)
		}
	}
}

// JSON-LD @id references can form cycles and shared subtrees, so the reader
// remembers each node's read per way of reading it: a second path to a
// shared node (one priceSpecification named by every variant) gets the same
// price without reading it again. A node met again while it is still being
// read (a cycle) gives nothing. The reader gives up past ldMaxDepth nested
// nodes or ldMaxSteps steps in all; a read a cap cut short is redone only
// from a shallower path, where it has more room, so a node is read at most
// ldMaxDepth times.
const (
	ldMaxDepth = 64
	ldMaxSteps = 1_000_000
	// Longer strings are not read as a price, currency or availability.
	// Real ones are short, and a step must not cost the length of a string
	// a page can make megabytes long and name from many places.
	ldMaxAmount = 64
	ldMaxWord   = 256
	ldMaxTypes  = 16 // @type entries looked at
)

type ldReader struct {
	ids   map[string]map[string]any
	read  map[ldVisit]ldRead
	steps int
	depth int
	cut   bool // a cap refused a read since cut was last cleared
}

// ldRead is a node's read: busy while it is being read, then its answer,
// whether a cap cut it short, and the depth it was read at.
type ldRead struct {
	p     Price
	ok    bool
	busy  bool
	cut   bool
	depth int
}

func newLDReader(ids map[string]map[string]any) *ldReader {
	return &ldReader{ids: ids, read: map[ldVisit]ldRead{}}
}

// ldVisit is one node read one way: by find (top or not) or as an offer.
type ldVisit struct {
	node uintptr // the map's identity; every node stays alive in ids or the roots
	how  byte
}

const (
	ldFind byte = iota
	ldFindTop
	ldOffer
)

// step counts one unit of work, and reports false once the cap is reached.
func (ld *ldReader) step() bool {
	if ld.steps >= ldMaxSteps {
		ld.cut = true
		return false
	}
	ld.steps++
	return true
}

// once reads m the given way with read, or returns the answer of the read
// already made. A node still being read, or one past the caps, gives
// nothing; each new read counts a step. A remembered read that a cap cut
// short is reused, and marks this read cut too, unless this path is
// shallower: then it is read again.
func (ld *ldReader) once(m map[string]any, how byte, read func() (Price, bool)) (Price, bool) {
	v := ldVisit{node: reflect.ValueOf(m).Pointer(), how: how}
	if r, done := ld.read[v]; done {
		if r.busy {
			return Price{}, false
		}
		if !r.cut || ld.depth >= r.depth || ld.steps >= ldMaxSteps {
			ld.cut = ld.cut || r.cut
			return r.p, r.ok
		}
	}
	if ld.depth >= ldMaxDepth || ld.steps >= ldMaxSteps {
		ld.cut = true
		return Price{}, false
	}
	outer := ld.cut
	ld.cut = false
	at := ld.depth
	ld.read[v] = ldRead{busy: true}
	ld.steps++
	ld.depth++
	p, ok := read()
	ld.depth--
	ld.read[v] = ldRead{p: p, ok: ok, cut: ld.cut, depth: at}
	ld.cut = ld.cut || outer
	return p, ok
}

// resolve follows a bare {"@id": …} reference to the node it names.
func (ld *ldReader) resolve(m map[string]any) map[string]any {
	if id, ok := m["@id"].(string); ok && len(m) == 1 {
		if full, ok := ld.ids[id]; ok {
			return full
		}
	}
	return m
}

// find looks for a Product anywhere under v. top is true for a block's
// root and its @graph, where a lone Offer also counts.
func (ld *ldReader) find(v any, top bool) (Price, bool) {
	switch t := v.(type) {
	case []any:
		for _, c := range t {
			if !ld.step() {
				break
			}
			if p, ok := ld.find(c, top); ok {
				return p, true
			}
		}
	case map[string]any:
		t = ld.resolve(t)
		how := ldFind
		if top {
			how = ldFindTop
		}
		return ld.once(t, how, func() (Price, bool) { return ld.findIn(t, top) })
	}
	return Price{}, false
}

// findIn reads one node for find.
func (ld *ldReader) findIn(t map[string]any, top bool) (Price, bool) {
	ld.steps += len(t) // its keys are sorted and walked below
	switch {
	case isType(t, "Product", "IndividualProduct", "ProductModel", "ProductGroup"):
		if p, ok := ld.offers(t["offers"]); ok {
			return p, true
		}
		if p, ok := ld.find(t["hasVariant"], false); ok {
			if list, isList := t["hasVariant"].([]any); isList {
				p.Availability = ld.samePriceAvailability(list, p, func(r *ldReader, v any) (Price, bool) { return r.find(v, false) })
			}
			return p, true
		}
		return Price{}, false
	case top && isType(t, "Offer", "AggregateOffer"):
		if p, ok := ld.offer(t); ok {
			return p, true
		}
	}
	if g, ok := t["@graph"]; ok {
		if p, ok := ld.find(g, top); ok {
			return p, true
		}
	}
	for _, k := range sortedKeys(t) {
		if k == "@graph" {
			continue
		}
		if p, ok := ld.find(t[k], false); ok {
			return p, true
		}
	}
	return Price{}, false
}

// offers reads an offers value: one offer or a list, first priced one wins.
// In a list, the availability is the most buyable among the offers at that
// same price: shops list one offer per variant, and the first one being sold
// out says nothing about the rest.
func (ld *ldReader) offers(v any) (Price, bool) {
	switch t := v.(type) {
	case []any:
		for i, c := range t {
			if !ld.step() {
				break
			}
			if p, ok := ld.offers(c); ok {
				p.Availability = ld.samePriceAvailability(t[i+1:], p, (*ldReader).offers)
				return p, true
			}
		}
	case map[string]any:
		return ld.offer(ld.resolve(t))
	}
	return Price{}, false
}

func (ld *ldReader) offer(m map[string]any) (Price, bool) {
	return ld.once(m, ldOffer, func() (Price, bool) { return ld.offerIn(m) })
}

// offerIn reads one node for offer.
func (ld *ldReader) offerIn(m map[string]any) (Price, bool) {
	keys := []string{"price", "lowPrice"}
	aggregate := isType(m, "AggregateOffer")
	if aggregate {
		keys = []string{"lowPrice", "price"}
	}
	avail := ldAvailability(m["availability"])
	cur := ldString(m["priceCurrency"])
	for _, k := range keys {
		if amount, raw, ok := ldAmount(m[k]); ok {
			if !KnownAvailability(avail) && aggregate {
				avail = ld.offersAvailability(m["offers"], amount, currencyCode(cur, raw))
			}
			return Price{Amount: amount, Currency: currencyCode(cur, raw), From: "jsonld", Availability: avail}, true
		}
	}
	if p, ok := ld.offers(m["priceSpecification"]); ok {
		if p.Currency == "" {
			p.Currency = currencyCode(cur, "")
		}
		// A price specification states no availability; its offer does.
		if !KnownAvailability(avail) && aggregate {
			avail = ld.offersAvailability(m["offers"], p.Amount, p.Currency)
		}
		p.Availability = avail
		return p, true
	}
	// An aggregate with no price of its own reads its first priced offer,
	// and the offers at that same price decide availability (offers).
	p, ok := ld.offers(m["offers"])
	if ok && !KnownAvailability(p.Availability) {
		p.Availability = avail
	}
	return p, ok
}

// offersAvailability is the most buyable availability an AggregateOffer's
// offers state at its price (lowPrice), so a sold-out seller's low price
// does not read as buyable because a dearer seller has stock. An offer at
// that price that states nothing makes it unknown rather than sold out, and
// a dearer seller's stock never fills it in: the page's meta tags decide.
// When no offer is at that price, it is the most buyable of any offer. An
// offer stating another currency is not at the price. AvailUnknown when none
// states one, or when the step cap cut the look short before anything
// buyable was seen. Every node it looks at counts against ldMaxSteps.
func (ld *ldReader) offersAvailability(v any, price float64, cur string) string {
	atPrice, best := "", "" // "" ranks below every word: nothing seen yet
	looked := map[uintptr]bool{}
	outer := ld.cut
	ld.cut = false
	defer func() { ld.cut = ld.cut || outer }()
	var visit func(v any)
	visit = func(v any) {
		if !ld.step() {
			return
		}
		switch t := v.(type) {
		case []any:
			for _, c := range t {
				visit(c)
			}
		case map[string]any:
			o := ld.resolve(t)
			node := reflect.ValueOf(o).Pointer()
			if looked[node] {
				return
			}
			looked[node] = true
			a := ldAvailability(o["availability"])
			if buyRank(a) < buyRank(best) {
				best = a
			}
			if amount, c, ok := ld.offerAmount(o); ok && amount == price && sameCurrency(c, cur) && buyRank(a) < buyRank(atPrice) {
				atPrice = a
			}
		}
	}
	visit(v)
	if atPrice == "" {
		atPrice = best
	}
	if atPrice == "" || ld.cut && !Buyable(atPrice) {
		return AvailUnknown
	}
	return atPrice
}

// sameCurrency is false only when both name a currency and they differ.
func sameCurrency(a, b string) bool {
	return a == "" || b == "" || strings.EqualFold(a, b)
}

// offerAmount is an offer's own price and currency, or its price
// specification's.
func (ld *ldReader) offerAmount(o map[string]any) (float64, string, bool) {
	cur := ldString(o["priceCurrency"])
	if amount, raw, ok := ldAmount(o["price"]); ok {
		return amount, currencyCode(cur, raw), true
	}
	specs := []any{o["priceSpecification"]}
	if list, ok := o["priceSpecification"].([]any); ok {
		specs = list
	}
	for _, s := range specs {
		if !ld.step() {
			break
		}
		if m, ok := s.(map[string]any); ok {
			spec := ld.resolve(m)
			if amount, raw, ok := ldAmount(spec["price"]); ok {
				if c := ldString(spec["priceCurrency"]); c != "" {
					cur = c
				}
				return amount, currencyCode(cur, raw), true
			}
		}
	}
	return 0, "", false
}

// samePriceAvailability is the most buyable availability among p and the
// siblings that read at p's amount and currency, each read by read. Reads are
// remembered per node, so a sibling naming a node already read (one
// AggregateOffer behind every "@id", one shared priceSpecification) gets that
// node's answer at no cost.
func (ld *ldReader) samePriceAvailability(siblings []any, p Price, read func(*ldReader, any) (Price, bool)) string {
	best := p.Availability
	outer := ld.cut
	ld.cut = false
	defer func() { ld.cut = ld.cut || outer }()
	for _, c := range siblings {
		if !ld.step() {
			break
		}
		if list, isList := c.([]any); isList {
			if a := ld.samePriceAvailability(list, Price{Amount: p.Amount, Currency: p.Currency, Availability: best}, read); buyRank(a) < buyRank(best) {
				best = a
			}
			continue
		}
		q, ok := read(ld, c)
		if ok && q.Amount == p.Amount && strings.EqualFold(q.Currency, p.Currency) && buyRank(q.Availability) < buyRank(best) {
			best = q.Availability
		}
	}
	// A sibling a cap cut short may have been buyable.
	if ld.cut && !Buyable(best) {
		return AvailUnknown
	}
	return best
}

func isType(m map[string]any, names ...string) bool {
	var types []string
	switch t := m["@type"].(type) {
	case string:
		types = []string{t}
	case []any:
		for _, x := range t[:min(len(t), ldMaxTypes)] {
			if s, ok := x.(string); ok {
				types = append(types, s)
			}
		}
	}
	for _, t := range types {
		if len(t) > ldMaxWord {
			continue
		}
		if i := strings.LastIndexAny(t, "/:#"); i >= 0 {
			t = t[i+1:]
		}
		for _, n := range names {
			if strings.EqualFold(t, n) {
				return true
			}
		}
	}
	return false
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// ldAvailability reads an availability given as text, a list, or a node
// such as {"@id": "https://schema.org/InStock"}.
func ldAvailability(v any) string {
	if m, ok := v.(map[string]any); ok {
		v = m["@id"]
	}
	return NormalizeAvailability(ldString(v))
}

// ldString is a string value, or the first of a list of them. Lists inside
// lists are not unwrapped: a page could nest them thousands deep.
func ldString(v any) string {
	if list, ok := v.([]any); ok && len(list) > 0 {
		v = list[0]
	}
	if s, ok := v.(string); ok && len(s) <= ldMaxWord {
		return s
	}
	return ""
}

// ldAmount is an amount value, or the first of a list of them, unwrapped one
// level like ldString.
func ldAmount(v any) (float64, string, bool) {
	if list, ok := v.([]any); ok && len(list) > 0 {
		v = list[0]
	}
	switch t := v.(type) {
	case json.Number:
		if len(t) > ldMaxAmount {
			return 0, "", false
		}
		f, err := t.Float64()
		return f, t.String(), err == nil && f > 0 && !math.IsInf(f, 0)
	case string:
		if len(t) > ldMaxAmount {
			return 0, "", false
		}
		f, ok := machineAmount(t)
		return f, t, ok
	}
	return 0, "", false
}

// machineAmount reads a value meant for machines ("27499.00") and falls back
// to parseAmount for one written for people ("27,499.00").
func machineAmount(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f, f > 0 && !math.IsInf(f, 0)
	}
	return parseAmount(s)
}

var amountRe = regexp.MustCompile(`\d{1,3}(?:[ \x{00A0}\x{202F}']\d{3})+(?:[.,]\d+)?|\d[\d.,]*`)

// parseAmount reads the first amount in a price as people write it:
// "27,499.00", "1.299,99", "₹ 27,499", "1 299,99 €". The last separator is
// the decimal point when both kinds appear. A single separator followed by
// exactly three digits, after one to three digits that are not just "0",
// groups thousands ("1.299" is 1299); otherwise it is the decimal point.
func parseAmount(s string) (float64, bool) {
	m := amountRe.FindString(s)
	if m == "" {
		return 0, false
	}
	m = strings.NewReplacer(" ", "", " ", "", " ", "", "'", "").Replace(m)
	m = strings.TrimRight(m, ".,")
	lastDot, lastComma := strings.LastIndexByte(m, '.'), strings.LastIndexByte(m, ',')
	var num string
	switch {
	case lastDot >= 0 && lastComma >= 0:
		dec := max(lastDot, lastComma)
		num = stripSeps(m[:dec]) + "." + m[dec+1:]
	case lastDot >= 0 || lastComma >= 0:
		sep := "."
		if lastComma >= 0 {
			sep = ","
		}
		parts := strings.Split(m, sep)
		head, tail := parts[0], parts[len(parts)-1]
		grouped := len(parts) > 2 || (len(tail) == 3 && len(head) <= 3 && head != "0")
		if grouped {
			num = strings.Join(parts, "")
		} else {
			num = head + "." + tail
		}
	default:
		num = m
	}
	f, err := strconv.ParseFloat(num, 64)
	if err != nil || f <= 0 || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}

func stripSeps(s string) string {
	return strings.NewReplacer(".", "", ",", "").Replace(s)
}

var (
	isoRe   = regexp.MustCompile(`^[A-Za-z]{3}$`)
	codeRe  = regexp.MustCompile(`\b(USD|EUR|GBP|INR|JPY|CNY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|BRL|MXN|SGD|HKD|AED|ZAR)\b`)
	symbols = []struct{ sym, code string }{
		{"₹", "INR"}, {"Rs.", "INR"}, {"Rs ", "INR"}, {"€", "EUR"}, {"£", "GBP"}, {"US$", "USD"},
	}
)

// currencyCode returns the stated ISO code, else one read from the price
// text ("₹", "€", "EUR"), else "". A bare "$" or "¥" is too vague to guess.
func currencyCode(stated, priceText string) string {
	stated = strings.TrimSpace(stated)
	if isoRe.MatchString(stated) {
		return strings.ToUpper(stated)
	}
	for _, s := range []string{stated, priceText} {
		if c := codeRe.FindString(s); c != "" {
			return c
		}
		for _, sym := range symbols {
			if strings.Contains(s, sym.sym) {
				return sym.code
			}
		}
	}
	return ""
}
