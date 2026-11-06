package extract

import (
	"cmp"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Price is a product's price as the page states it. From is where it was
// read: "jsonld", "og" or "itemprop".
type Price struct {
	Amount   float64
	Currency string
	From     string
}

// ProductPrice reads a product page's price. It tries, in order: JSON-LD
// Product offers (Offer, AggregateOffer's lowPrice, @graph and @id
// references), then og:price:amount or product:price:amount with its
// currency, then microdata itemprop="price". No price gives ErrEmpty.
func ProductPrice(body []byte, contentType string) (Price, error) {
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return Price{}, err
	}
	var pg pricePage
	pg.walk(doc)
	if p, ok := jsonLDPrice(pg.ldJSON); ok {
		return p, nil
	}
	if p, ok := pg.ogPrice(); ok {
		return p, nil
	}
	if p, ok := pg.itempropPrice(); ok {
		return p, nil
	}
	return Price{}, ErrEmpty
}

// pricePage is what one walk of the page collects.
type pricePage struct {
	ldJSON       []string
	meta         map[string]string // first content per og/product price property
	itemPrice    []string
	itemLow      []string
	itemCurrency string
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
			if strings.HasSuffix(key, ":price:amount") || strings.HasSuffix(key, ":price:currency") {
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
	ld := ldReader{ids: ids}
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

type ldReader struct{ ids map[string]map[string]any }

// resolve follows a bare {"@id": …} reference to the node it names.
func (ld ldReader) resolve(m map[string]any) map[string]any {
	if id, ok := m["@id"].(string); ok && len(m) == 1 {
		if full, ok := ld.ids[id]; ok {
			return full
		}
	}
	return m
}

// find looks for a Product anywhere under v. top is true for a block's
// root and its @graph, where a lone Offer also counts.
func (ld ldReader) find(v any, top bool) (Price, bool) {
	switch t := v.(type) {
	case []any:
		for _, c := range t {
			if p, ok := ld.find(c, top); ok {
				return p, true
			}
		}
	case map[string]any:
		t = ld.resolve(t)
		switch {
		case isType(t, "Product", "IndividualProduct", "ProductModel", "ProductGroup"):
			if p, ok := ld.offers(t["offers"]); ok {
				return p, true
			}
			if p, ok := ld.find(t["hasVariant"], false); ok {
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
	}
	return Price{}, false
}

// offers reads an offers value: one offer or a list, first priced one wins.
func (ld ldReader) offers(v any) (Price, bool) {
	switch t := v.(type) {
	case []any:
		for _, c := range t {
			if p, ok := ld.offers(c); ok {
				return p, true
			}
		}
	case map[string]any:
		return ld.offer(ld.resolve(t))
	}
	return Price{}, false
}

func (ld ldReader) offer(m map[string]any) (Price, bool) {
	keys := []string{"price", "lowPrice"}
	if isType(m, "AggregateOffer") {
		keys = []string{"lowPrice", "price"}
	}
	cur := ldString(m["priceCurrency"])
	for _, k := range keys {
		if amount, raw, ok := ldAmount(m[k]); ok {
			return Price{Amount: amount, Currency: currencyCode(cur, raw), From: "jsonld"}, true
		}
	}
	if p, ok := ld.offers(m["priceSpecification"]); ok {
		if p.Currency == "" {
			p.Currency = currencyCode(cur, "")
		}
		return p, true
	}
	return ld.offers(m["offers"])
}

func isType(m map[string]any, names ...string) bool {
	var types []string
	switch t := m["@type"].(type) {
	case string:
		types = []string{t}
	case []any:
		for _, x := range t {
			if s, ok := x.(string); ok {
				types = append(types, s)
			}
		}
	}
	for _, t := range types {
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

func ldString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		if len(t) > 0 {
			return ldString(t[0])
		}
	}
	return ""
}

func ldAmount(v any) (float64, string, bool) {
	switch t := v.(type) {
	case json.Number:
		f, err := t.Float64()
		return f, t.String(), err == nil && f > 0 && !math.IsInf(f, 0)
	case string:
		f, ok := machineAmount(t)
		return f, t, ok
	case []any:
		if len(t) > 0 {
			return ldAmount(t[0])
		}
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
