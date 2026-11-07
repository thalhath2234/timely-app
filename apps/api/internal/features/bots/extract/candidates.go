package extract

import (
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Candidate is one price a page shows. From is where it was read: "jsonld",
// "og" or "itemprop" for the page's structured data, "text" for a price in
// its visible text. Selector is the CSS path a selector_price watch uses to
// follow it ("" when there is none). Struck marks a crossed-out price, such
// as a list price next to the deal price.
type Candidate struct {
	Label    string  `json:"label"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Selector string  `json:"selector"`
	Struck   bool    `json:"struck"`
	From     string  `json:"from"`
}

const (
	// MaxCandidates caps the prices PriceCandidates returns.
	MaxCandidates = 6
	// maxLabel caps a candidate's label, in runes.
	maxLabel = 40
	// maxPriceText is the longest visible text, in runes, an element may
	// hold and still count as a price: longer is a sentence that mentions
	// one.
	maxPriceText = 60
)

// PriceCandidates lists the prices a page shows, so a person can pick the
// one a bot should follow: the structured prices first (JSON-LD offers'
// price, lowPrice and highPrice, og/product price meta, microdata), then the
// prices in the visible text, each with a selector that finds it again. They
// are de-duplicated by amount and struck, at most MaxCandidates, in page
// order. A page with no prices gives none and no error.
func PriceCandidates(body []byte, contentType string) ([]Candidate, error) {
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return nil, err
	}
	var pg pricePage
	pg.walk(doc)

	var out []Candidate
	textAt := map[int]*html.Node{} // index in out of a text candidate -> its element
	add := func(c Candidate, n *html.Node) {
		for i := range out {
			if sameAmount(out[i].Amount, c.Amount) && out[i].Struck == c.Struck {
				// A structured price that the page also shows takes the
				// shown one's element and label, so it can be followed.
				if n != nil && textAt[i] == nil {
					textAt[i] = n
					if c.Label != "Price" {
						out[i].Label = c.Label
					}
				}
				return
			}
		}
		if len(out) < MaxCandidates {
			out = append(out, c)
			if n != nil {
				textAt[len(out)-1] = n
			}
		}
	}

	for _, c := range structuredPrices(&pg) {
		add(c, nil)
	}
	cw := &candidateWalk{}
	cw.visit(doc, nil, false)
	for _, tc := range cw.found {
		add(tc.c, tc.n)
	}
	for i, n := range textAt {
		// A selector is kept only when it reads this price back the way a
		// selector_price watch will.
		if amount, _, ok := nodesPrice([]*html.Node{n}); ok && sameAmount(amount, out[i].Amount) {
			out[i].Selector = SelectorFor(n)
		}
	}
	return out, nil
}

func sameAmount(a, b float64) bool { return math.Abs(a-b) < 0.005 }

// structuredPrices reads every offer price in the page's JSON-LD, then its
// og/product price meta and microdata prices.
func structuredPrices(pg *pricePage) []Candidate {
	var out []Candidate
	for _, raw := range pg.ldJSON {
		v, ok := decodeLD(raw)
		if !ok {
			continue
		}
		steps := 0
		ldOffers(v, false, 0, &steps, &out)
	}
	if p, ok := pg.ogPrice(); ok {
		out = append(out, Candidate{Label: "Price", Amount: p.Amount, Currency: p.Currency, From: "og"})
	}
	cur := pg.itemCurrency
	for _, list := range []struct {
		vals  []string
		label string
	}{{pg.itemPrice, "Price"}, {pg.itemLow, "Lowest price"}} {
		for _, v := range list.vals {
			if amount, ok := machineAmount(v); ok {
				out = append(out, Candidate{Label: list.label, Amount: amount, Currency: currencyCode(cur, v), From: "itemprop"})
			}
		}
	}
	return out
}

var ldPriceKeys = []struct{ key, label string }{
	{"price", "Price"}, {"lowPrice", "Lowest price"}, {"highPrice", "Highest price"},
}

// ldOffers collects the prices of every Offer or AggregateOffer under v,
// and of any object given as an offers or priceSpecification value, bounded
// like the JSON-LD reader. A price specification whose priceType is a
// StrikethroughPrice or ListPrice is the crossed-out list price.
func ldOffers(v any, offer bool, depth int, steps *int, out *[]Candidate) {
	*steps++
	if depth >= ldMaxDepth || *steps >= ldMaxSteps {
		return
	}
	switch t := v.(type) {
	case []any:
		for _, c := range t {
			ldOffers(c, offer, depth+1, steps, out)
		}
	case map[string]any:
		if offer || isType(t, "Offer", "AggregateOffer") {
			cur := ldString(t["priceCurrency"])
			pt := ldString(t["priceType"])
			list := strings.HasSuffix(pt, "StrikethroughPrice") || strings.HasSuffix(pt, "ListPrice")
			for _, k := range ldPriceKeys {
				if amount, raw, ok := ldAmount(t[k.key]); ok {
					c := Candidate{Label: k.label, Amount: amount, Currency: currencyCode(cur, raw), From: "jsonld"}
					if list {
						c.Label, c.Struck = "List price", true
					}
					*out = append(*out, c)
				}
			}
		}
		for _, k := range sortedKeys(t) {
			ldOffers(t[k], k == "offers" || k == "priceSpecification", depth+1, steps, out)
		}
	}
}

var heading = map[atom.Atom]bool{atom.H1: true, atom.H2: true, atom.H3: true, atom.H4: true, atom.H5: true, atom.H6: true}

type textCandidate struct {
	c Candidate
	n *html.Node
}

// label is the last short line of text seen, and the block it is in.
type label struct {
	text  string
	block *html.Node
}

// candidateWalk finds the elements whose visible text is a short line with
// a price in it, deepest first. An element holding one is a candidate itself
// only for a price in its own text around it ("Now ₹499 <s>₹999</s>").
type candidateWalk struct {
	found []textCandidate
	last  label
}

// visit returns n's visible text, whether that text is too long to be a
// price line, and whether a candidate was found inside n.
func (cw *candidateWalk) visit(n, block *html.Node, struck bool) (text string, long, inside bool) {
	switch n.Type {
	case html.TextNode:
		t := strings.Join(strings.Fields(n.Data), " ")
		// A heading names the product, not a price.
		if t != "" && block != nil && !heading[block.DataAtom] && utf8.RuneCountInString(t) <= maxLabel && hasLetter(t) && len(findMoney(t, 1)) == 0 {
			cw.last = label{text: t, block: block}
		}
		return n.Data, utf8.RuneCountInString(n.Data) > 4*maxPriceText, false
	case html.ElementNode:
		if hidden[n.DataAtom] || n.DataAtom == atom.Nav || n.DataAtom == atom.Footer {
			return "", false, false
		}
		if block == nil || blockLike(n) {
			block = n
		}
		struck = struck || isStruck(n)
	case html.DocumentNode:
	default:
		return "", false, false
	}
	before := cw.last
	start := len(cw.found)
	// b is n's own text: its text nodes and the children with no price in
	// them. lead is how much of it came before the first child that had one.
	var b strings.Builder
	lead := -1
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		t, l, in := cw.visit(c, block, struck)
		long = long || l
		if in {
			if !inside {
				lead = b.Len()
			}
			inside = true
			b.WriteByte(' ')
			continue
		}
		if !long {
			if c.Type == html.ElementNode && blockLike(c) {
				b.WriteByte(' ')
			}
			b.WriteString(t)
		}
	}
	if long || n.Type != html.ElementNode {
		return "", long, inside
	}
	own := b.String()
	text = strings.Join(strings.Fields(own), " ")
	if utf8.RuneCountInString(text) > maxPriceText {
		return "", !inside, inside
	}
	ms := findMoney(text, 1)
	if len(ms) == 0 {
		if inside {
			return "", false, true
		}
		return text, false, false
	}
	tc := textCandidate{n: n, c: Candidate{
		Label: candidateLabel(n, text[:ms[0].start], before, block), Amount: ms[0].amount, Currency: ms[0].currency,
		Struck: struck, From: "text",
	}}
	if inside && len(findMoney(own[:lead], 1)) > 0 {
		// Its own price comes before the ones inside it, so it goes first.
		cw.found = append(cw.found[:start], append([]textCandidate{tc}, cw.found[start:]...)...)
	} else {
		cw.found = append(cw.found, tc)
	}
	// Lines inside a price never label the next one.
	cw.last = before
	return "", false, true
}

// candidateLabel names a price: the words before it in its own line ("Deal
// Price: ₹19,999"), else the nearest short line before it in the same block
// or a neighbouring one ("<dt>Price</dt><dd>£5</dd>"), else an aria-label
// on it or around it, else "Price".
func candidateLabel(n *html.Node, prefix string, before label, block *html.Node) string {
	if l := cleanLabel(prefix); l != "" {
		return l
	}
	if before.block != nil && (before.block == block || before.block.Parent == block.Parent || contains(before.block, block)) {
		if l := cleanLabel(before.text); l != "" {
			return l
		}
	}
	for a := n; a != nil && a.Type == html.ElementNode; a = a.Parent {
		if l := cleanLabel(attr(a, "aria-label")); l != "" && len(findMoney(l, 1)) == 0 {
			return l
		}
		if a == block {
			break
		}
	}
	return "Price"
}

func cleanLabel(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	s = strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsPunct(r) && r != '.' && r != ')' })
	s = strings.TrimRight(s, ": ")
	if s == "" || !hasLetter(s) || utf8.RuneCountInString(s) > maxLabel {
		return ""
	}
	return s
}

func hasLetter(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// contains reports whether a is an ancestor of n.
func contains(a, n *html.Node) bool {
	for p := n.Parent; p != nil; p = p.Parent {
		if p == a {
			return true
		}
	}
	return false
}

// blockLike is an element that starts its own line.
func blockLike(n *html.Node) bool { return block[n.DataAtom] }

// isStruck is an element that crosses out its text: <s>, <del>, <strike>,
// or a class with "strike" in it.
func isStruck(n *html.Node) bool {
	switch n.DataAtom {
	case atom.S, atom.Del, atom.Strike:
		return true
	}
	return strings.Contains(strings.ToLower(attr(n, "class")), "strike")
}
