package extract

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestProductPrice(t *testing.T) {
	cases := []struct {
		file string
		want Price
	}{
		{"product_jsonld.html", Price{Amount: 27499, Currency: "INR", From: "jsonld", Availability: AvailInStock}},
		{"product_graph.html", Price{Amount: 89, Currency: "GBP", From: "jsonld", Availability: AvailUnknown}},
		{"product_og.html", Price{Amount: 1249.5, Currency: "USD", From: "og", Availability: AvailUnknown}},
		{"product_itemprop.html", Price{Amount: 149.99, Currency: "CAD", From: "itemprop", Availability: AvailUnknown}},
		{"product_eu.html", Price{Amount: 1299.99, Currency: "EUR", From: "itemprop", Availability: AvailUnknown}},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			got, err := ProductPrice(fixture(t, c.file), "text/html; charset=utf-8")
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestProductPriceNone(t *testing.T) {
	_, err := ProductPrice(fixture(t, "product_noprice.html"), "text/html")
	if !errors.Is(err, ErrEmpty) {
		t.Fatalf("err = %v, want ErrEmpty", err)
	}
}

func TestProductPriceJSONLDShapes(t *testing.T) {
	cases := []struct {
		name, ld string
		want     Price
	}{
		{"number price", `{"@type":"Product","offers":{"@type":"Offer","price":19.5,"priceCurrency":"usd"}}`, Price{19.5, "USD", "jsonld", AvailUnknown}},
		{"type array and schema URL", `{"@type":["http://schema.org/Product","Thing"],"offers":{"price":"7"}}`, Price{7, "", "jsonld", AvailUnknown}},
		{"price specification", `{"@type":"Product","offers":{"@type":"Offer","priceSpecification":{"@type":"UnitPriceSpecification","price":"12.00","priceCurrency":"EUR"}}}`, Price{12, "EUR", "jsonld", AvailUnknown}},
		{"aggregate with only price", `{"@type":"Product","offers":{"@type":"AggregateOffer","price":"30"}}`, Price{30, "", "jsonld", AvailUnknown}},
		{"zero price skipped", `{"@type":"Product","offers":[{"price":"0"},{"price":"5","priceCurrency":"INR"}]}`, Price{5, "INR", "jsonld", AvailUnknown}},
		{"nested under WebPage", `{"@type":"WebPage","mainEntity":{"@type":"Product","offers":{"price":"3.25"}}}`, Price{3.25, "", "jsonld", AvailUnknown}},
		{"lone top offer", `[{"@type":"Offer","price":"44","priceCurrency":"GBP"}]`, Price{44, "GBP", "jsonld", AvailUnknown}},
		{"variant group", `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"60"}}]}`, Price{60, "", "jsonld", AvailUnknown}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			page := `<html><head><script type="application/ld+json">` + c.ld + `</script></head><body></body></html>`
			got, err := ProductPrice([]byte(page), "text/html")
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestProductPriceBrokenJSONLDFallsBack(t *testing.T) {
	page := `<html><head><script type="application/ld+json">{"@type":"Product",</script>
<meta property="product:price:amount" content="10.00"><meta property="product:price:currency" content="AUD"></head></html>`
	got, err := ProductPrice([]byte(page), "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if want := (Price{10, "AUD", "og", AvailUnknown}); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestParseAmount(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"27,499.00", 27499, true},
		{"1.299,99", 1299.99, true},
		{"₹ 27,499", 27499, true},
		{"Rs. 1,27,499.50", 127499.5, true},
		{"1 299,99 €", 1299.99, true},
		{"1 299,99 €", 1299.99, true},
		{"$1,249.50", 1249.5, true},
		{"1.299", 1299, true},
		{"0.299", 0.299, true},
		{"12.5", 12.5, true},
		{"1299.000", 1299, true},
		{"19,99 €", 19.99, true},
		{"1,000,000", 1000000, true},
		{"CHF 1'299.00", 1299, true},
		{"49.", 49, true},
		{"from 15 to 20", 15, true},
		{"0", 0, false},
		{"free", 0, false},
		{"", 0, false},
	}
	for _, c := range cases {
		got, ok := parseAmount(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("parseAmount(%q) = %v, %v; want %v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestCurrencyCode(t *testing.T) {
	cases := []struct{ stated, text, want string }{
		{"inr", "", "INR"},
		{"", "₹ 27,499", "INR"},
		{"", "1.299,99 €", "EUR"},
		{"", "£89", "GBP"},
		{"", "EUR 12,99", "EUR"},
		{"", "US$ 5", "USD"},
		{"", "$5", ""},
		{"Rs.", "", "INR"},
	}
	for _, c := range cases {
		if got := currencyCode(c.stated, c.text); got != c.want {
			t.Errorf("currencyCode(%q, %q) = %q, want %q", c.stated, c.text, got, c.want)
		}
	}
}

// JSON-LD @id references may loop or share subtrees. Following them must
// end, quickly, and still find a price that is there.
func TestProductPriceJSONLDReferences(t *testing.T) {
	page := func(ld string) []byte {
		return []byte(`<html><head><script type="application/ld+json">` + ld + `</script></head><body></body></html>`)
	}
	var dag strings.Builder
	dag.WriteString(`{"@graph":[`)
	for i := range 40 {
		fmt.Fprintf(&dag, `{"@id":"n%d","@type":"Thing","x":{"@id":"n%d"},"y":{"@id":"n%d"}},`, i, i+1, i+1)
	}
	dag.WriteString(`{"@id":"n40","@type":"Thing","name":"end"}]}`)
	deep := strings.Repeat(`{"@type":"Thing","x":`, 200) + `{"@type":"Product","offers":{"price":"9"}}` + strings.Repeat(`}`, 200)
	cases := []struct {
		name, ld string
		want     Price
		empty    bool
	}{
		{name: "self reference", ld: `{"@id":"a","@type":"Thing","x":{"@id":"a"}}`, empty: true},
		{name: "offer that offers itself", ld: `{"@type":"Product","offers":{"@id":"o"}}<\/script><script type="application/ld+json">{"@id":"o","@type":"Offer","offers":{"@id":"o"}}`, empty: true},
		{name: "two-node loop", ld: `[{"@id":"a","@type":"Thing","x":{"@id":"b"}},{"@id":"b","@type":"Thing","x":{"@id":"a"}}]`, empty: true},
		{name: "shared subtrees", ld: dag.String(), empty: true},
		{name: "too deep", ld: deep, empty: true},
		{name: "loop beside a product", ld: `[{"@id":"a","@type":"Thing","x":{"@id":"a"}},{"@type":"Product","offers":{"price":"12","priceCurrency":"EUR"}}]`, want: Price{12, "EUR", "jsonld", AvailUnknown}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start := time.Now()
			got, err := ProductPrice(page(strings.ReplaceAll(c.ld, `<\/script>`, `</script>`)), "text/html")
			if d := time.Since(start); d > 2*time.Second {
				t.Fatalf("took %v", d)
			}
			if c.empty {
				if !errors.Is(err, ErrEmpty) {
					t.Fatalf("got %+v, %v; want ErrEmpty", got, err)
				}
				return
			}
			if err != nil || got != c.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, c.want)
			}
		})
	}
}

// Many offers that all name one shared AggregateOffer read it once: each
// sibling re-reading its offers made the work offers × siblings.
func TestProductPriceSharedAggregateOfferReadOnce(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"@graph":[{"@type":"Product","offers":[`)
	for i := range 3000 {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"@id":"#agg"}`)
	}
	b.WriteString(`]},{"@type":"WebPage","mainEntity":{"@id":"#agg","@type":"AggregateOffer","lowPrice":"8","priceCurrency":"EUR","offers":[`)
	for i := range 1000 {
		if i > 0 {
			b.WriteString(",")
		}
		fmt.Fprintf(&b, `{"price":"%d","availability":"InStock"}`, 8+i%5)
	}
	b.WriteString(`]}}]}`)
	page := []byte(`<html><head><script type="application/ld+json">` + b.String() + `</script></head><body></body></html>`)
	start := time.Now()
	got, err := ProductPrice(page, "text/html")
	if d := time.Since(start); d > 300*time.Millisecond {
		t.Fatalf("took %v for a %d KB page", d, len(page)/1024)
	}
	if want := (Price{8, "EUR", "jsonld", AvailInStock}); err != nil || got != want {
		t.Fatalf("got %+v, %v; want %+v", got, err, want)
	}
}

// offersAvailability counts the offers it looks at against the step cap and
// stops once the cap is reached.
func TestOffersAvailabilityCountsSteps(t *testing.T) {
	offers := []any{map[string]any{"price": "8", "availability": "InStock"}, map[string]any{"price": "9", "availability": "OutOfStock"}}
	ld := newLDReader(nil)
	if got := ld.offersAvailability(offers, 8, ""); got != AvailInStock || ld.steps != 3 {
		t.Fatalf("got %q after %d steps", got, ld.steps)
	}
	ld = newLDReader(nil)
	ld.steps = ldMaxSteps
	if got := ld.offersAvailability(offers, 8, ""); got != AvailUnknown || ld.steps != ldMaxSteps {
		t.Fatalf("past the cap: got %q after %d steps", got, ld.steps)
	}
}

// Pages that name shared nodes from many places stay fast: every node is
// read once per way of reading it, whatever the number of paths to it.
func TestProductPriceSharedNodesStayFast(t *testing.T) {
	ladder := func(levels, pad int) string {
		var b strings.Builder
		b.WriteString(`{"@graph":[{"@type":"Product","offers":[{"@id":"#A0"},{"@id":"#B0"}]}`)
		for k := range levels {
			for _, side := range []string{"A", "B"} {
				fmt.Fprintf(&b, `,{"@id":"#%s%d","@type":"Offer","offers":[{"@id":"#A%d"},{"@id":"#B%d"}`, side, k, k+1, k+1)
				b.WriteString(strings.Repeat(",1", pad))
				b.WriteString(`]}`)
			}
		}
		fmt.Fprintf(&b, `,{"@id":"#A%d","@type":"Offer","price":"8","availability":"InStock"},{"@id":"#B%d","@type":"Offer","price":"8","availability":"OutOfStock"}]}`, levels, levels)
		return b.String()
	}
	many := func(item string) string {
		var b strings.Builder
		b.WriteString(`{"@graph":[{"@type":"Product","offers":[`)
		for i := range 3000 {
			if i > 0 {
				b.WriteString(",")
			}
			fmt.Fprintf(&b, item, i)
		}
		b.WriteString(`]},{"@id":"#agg","@type":"AggregateOffer","lowPrice":"8","priceCurrency":"EUR","price":"8","offers":[`)
		for i := range 1000 {
			if i > 0 {
				b.WriteString(",")
			}
			fmt.Fprintf(&b, `{"price":"%d","availability":"InStock"}`, 8+i%5)
		}
		b.WriteString(`]}]}`)
		return b.String()
	}
	huge := strings.Repeat("x", 1<<20)
	refs := func(ref string, n int) string { return strings.TrimSuffix(strings.Repeat(ref+",", n), ",") }
	cases := []struct{ name, ld string }{
		{"one shared price specification with a 1 MB price named by every offer", `{"@graph":[{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"10","offers":[` +
			refs(`{"priceSpecification":{"@id":"#s"}}`, 3000) + `]}},{"@id":"#s","price":"` + huge + `"}]}`},
		{"many aggregates naming one offer with 1 MB price and availability", `{"@graph":[{"@type":"Product","offers":[` +
			refs(`{"@type":"AggregateOffer","lowPrice":"10","offers":{"@id":"#o"}}`, 3000) + `]},{"@id":"#o","price":"` + huge + `","availability":"In` + huge + `Stock"}]}`},
		{"a 1 MB number named many times", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":1,"offers":{"priceSpecification":[` +
			refs(`{"@id":"S"}`, 3000) + `]}},"x":{"@id":"S","price":` + strings.Repeat("1", 1<<20) + `}}`},
		{"two refs per level, 40 levels, padded lists", ladder(40, 8000)},
		{"every sibling an array around one ref", many(`[{"@id":"#agg","n":%d}]`)},
		{"distinct offers naming one price specification", many(`{"@type":"Offer","n":%d,"priceSpecification":{"@id":"#agg"}}`)},
		{"distinct nodes pointing at one shared node", many(`{"n":%d,"r":{"@id":"#agg"}}`)},
		{"an aggregate's offers all naming one node with a long price specification list", `{"@type":"AggregateOffer","lowPrice":1,"priceCurrency":"USD","offers":[` +
			strings.TrimSuffix(strings.Repeat(`{"@id":"x"},`, 20000), ",") + `]}</script><script type="application/ld+json">{"@id":"x","priceSpecification":[` +
			strings.TrimSuffix(strings.Repeat("0,", 200000), ",") + `]}`},
		{"an aggregate's offers all naming one node with deeply nested values", `{"@type":"AggregateOffer","lowPrice":1,"priceCurrency":"USD","offers":[` +
			strings.TrimSuffix(strings.Repeat(`{"@id":"x"},`, 20000), ",") + `]}</script><script type="application/ld+json">{"@id":"x","availability":` +
			strings.Repeat("[", 5000) + `"InStock"` + strings.Repeat("]", 5000) + `,"price":` + strings.Repeat("[", 5000) + `"a"` + strings.Repeat("]", 5000) + `}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			page := []byte(`<html><head><script type="application/ld+json">` + c.ld + `</script></head><body></body></html>`)
			start := time.Now()
			if _, err := ProductPrice(page, "text/html"); err != nil && !errors.Is(err, ErrEmpty) {
				t.Fatal(err)
			}
			if d := time.Since(start); d > 300*time.Millisecond {
				t.Fatalf("took %v for a %d KB page", d, len(page)/1024)
			}
		})
	}
}

// A read the depth cap cut short is remembered as cut: the same node reached
// again from a shallower path reuses it, and a sold-out sibling no longer
// holds the alert, because the cut node may have been buyable.
func TestProductPriceDepthCutNeverHolds(t *testing.T) {
	var deep strings.Builder
	for range 61 {
		deep.WriteString(`{"@type":"Offer","offers":`)
	}
	deep.WriteString(`{"@id":"#x","@type":"Offer","offers":{"@type":"Offer","price":"10","priceCurrency":"USD","availability":"InStock"}}`)
	deep.WriteString(strings.Repeat("}", 61))
	ld := `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":[` + deep.String() +
		`,{"@type":"Offer","price":"10","priceCurrency":"USD","availability":"OutOfStock"}]},{"@type":"Product","offers":{"@id":"#x"}}]}`
	page := `<html><head><script type="application/ld+json">` + ld + `</script></head></html>`
	got, err := ProductPrice([]byte(page), "text/html")
	if want := (Price{10, "USD", "jsonld", AvailUnknown}); err != nil || got != want {
		t.Fatalf("got %+v, %v; want %+v", got, err, want)
	}
}

// A look the step cap cut short never holds an alert: a sibling it did not
// reach may be buyable.
func TestProductPriceCutLookReadsUnknown(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"@type":"Product","offers":[{"price":"19","priceCurrency":"USD","availability":"OutOfStock"}`)
	for range 1_100_000 {
		b.WriteString(`,1`)
	}
	b.WriteString(`,{"price":"19","priceCurrency":"USD","availability":"InStock"}]}`)
	page := `<html><head><script type="application/ld+json">` + b.String() + `</script></head></html>`
	got, err := ProductPrice([]byte(page), "text/html")
	if err != nil || got.Amount != 19 || got.Availability != AvailUnknown {
		t.Fatalf("got %+v, %v; want 19 with unknown availability", got, err)
	}
}

// A shared structure deeper than the depth cap is read once, not once per
// path, and the real offer after it is still read.
func TestProductPriceDeepSharedStructure(t *testing.T) {
	specDAG := func(types int) string {
		var b strings.Builder
		b.WriteString(`{"@graph":[{"@type":"Product","offers":[{"@id":"#s0"},{"@type":"Offer","price":"10","priceCurrency":"USD","availability":"InStock"}]}`)
		for i := range 58 {
			fmt.Fprintf(&b, `,{"@type":"Offer","@id":"#s%d","priceSpecification":[{"@id":"#s%d"},{"@id":"#s%d"}]}`, i, i+1, i+1)
		}
		b.WriteString(`,{"@id":"#s58","@type":[` + strings.TrimSuffix(strings.Repeat(`"PriceSpecification",`, types), ",") + `],"priceSpecification":{"@id":"#t0"}}`)
		for i := range 6 {
			fmt.Fprintf(&b, `,{"@id":"#t%d","priceSpecification":{"@id":"#t%d"}}`, i, i+1)
		}
		b.WriteString(`,{"@id":"#t6","x":1}]}`)
		return b.String()
	}
	deepRefs := func(n int, node string) string {
		return strings.Repeat(`{"a":`, 62) + `{"l":[` + strings.TrimSuffix(strings.Repeat(`{"@id":"n"},`, n), ",") + `]}` + strings.Repeat("}", 62) +
			`</script><script type="application/ld+json">` + node +
			`</script><script type="application/ld+json">{"@type":"Product","offers":{"price":"10","priceCurrency":"USD","availability":"InStock"}}`
	}
	cases := []struct{ name, ld string }{
		{"two refs per level past the depth cap", specDAG(1)},
		{"the same with a long @type list", specDAG(10000)},
		{"many deep refs to a node with a huge @type list", deepRefs(2000, `{"@id":"n","@type":[`+strings.Repeat(`"x",`, 200000)+`"Product"],"hasVariant":{"b":1}}`)},
		{"many deep refs to a node with a huge @type string", deepRefs(2000, `{"@id":"n","@type":"`+strings.Repeat("a", 1<<20)+`","0":{}}`)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			page := []byte(`<html><head><script type="application/ld+json">` + c.ld + `</script></head><body></body></html>`)
			start := time.Now()
			got, err := ProductPrice(page, "text/html")
			if d := time.Since(start); d > 300*time.Millisecond {
				t.Fatalf("took %v for a %d KB page", d, len(page)/1024)
			}
			if want := (Price{10, "USD", "jsonld", AvailInStock}); err != nil || got != want {
				t.Fatalf("got %+v, %v; want %+v", got, err, want)
			}
		})
	}
}

// A sibling whose read the step cap cut short never leaves a sold-out
// answer that would hold the alert.
func TestProductPriceCutSiblingNeverHolds(t *testing.T) {
	ld := `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"@type":"Offer","price":10,"priceCurrency":"USD","availability":"OutOfStock"}},{"@type":"Product","offers":[` +
		strings.Repeat("0,", 1_100_000) + `{"@type":"Offer","price":10,"priceCurrency":"USD","availability":"InStock"}]}]}`
	page := `<html><head><script type="application/ld+json">` + ld + `</script></head></html>`
	got, err := ProductPrice([]byte(page), "text/html")
	if err != nil || got.Amount != 10 || Unbuyable(got.Availability) {
		t.Fatalf("got %+v, %v; want 10 and not sold out", got, err)
	}
}

// Prices and stock that many aggregates or price specifications name are
// parsed once per node, so these big pages still read in well under a second.
func TestProductPriceNamedFactsParsedOnce(t *testing.T) {
	slowPrice := `"0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.00"`
	agg := `{"@type":"AggregateOffer","lowPrice":5,"offers":[{"@id":"O"}]}`
	specs := `[{"@type":"Product","offers":[` + strings.TrimSuffix(strings.Repeat(agg+",", 6), ",") + `]},{"@id":"S","price":` + slowPrice +
		`},{"@id":"O","priceSpecification":[` + strings.TrimSuffix(strings.Repeat(`{"@id":"S"},`, 200000), ",") + `]}]`
	var offers, refs strings.Builder
	for i := range 500 {
		fmt.Fprintf(&offers, `,{"@id":"%x","availability":"%s","price":%s}`, i, strings.Repeat("A-", 128), slowPrice)
		if i > 0 {
			refs.WriteString(",")
		}
		fmt.Fprintf(&refs, `{"@id":"%x"}`, i)
	}
	aggs := `{"@type":"AggregateOffer","lowPrice":5,"offers":[` + refs.String() + `]}`
	shared := `[{"@type":"Product","offers":[` + strings.TrimSuffix(strings.Repeat(aggs+",", 300), ",") + `]}` + offers.String() + `]`
	for name, ld := range map[string]string{"one spec named 200k times by six aggregates": specs, "500 offers named by 300 aggregates": shared} {
		t.Run(name, func(t *testing.T) {
			page := []byte(`<html><head><script type="application/ld+json">` + ld + `</script></head><body></body></html>`)
			start := time.Now()
			got, err := ProductPrice(page, "text/html")
			if d := time.Since(start); d > time.Second {
				t.Fatalf("took %v for a %d KB page", d, len(page)/1024)
			}
			if err != nil || got.Amount != 5 {
				t.Fatalf("got %+v, %v", got, err)
			}
		})
	}
}

// Long @id chains past the depth cap are read once per node, not again from
// every shallower entry, so the real Product after them is still reached in
// time.
func TestProductPriceLongChainsStayLinear(t *testing.T) {
	offerChain := func(n int) string {
		var b strings.Builder
		b.WriteString(`{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"x","offers":[`)
		for i := range n {
			if i > 0 {
				b.WriteString(",")
			}
			fmt.Fprintf(&b, `{"@id":"%d"}`, i)
		}
		b.WriteString(`]}`)
		x := strings.Repeat("x", 64)
		for i := range n + 70 {
			fmt.Fprintf(&b, `,{"@id":"%d","price":"%s","lowPrice":"%s","priceSpecification":{"@id":"%d"}}`, i, x, x, i+1)
		}
		b.WriteString(`]}`)
		return b.String()
	}
	listChain := func(n int) string {
		var b strings.Builder
		b.WriteString(`{"@context":"https://schema.org","@graph":[{"@type":"ItemList","itemListElement":[`)
		for i := range n {
			if i > 0 {
				b.WriteString(",")
			}
			fmt.Fprintf(&b, `{"@type":"ListItem","@id":"#li%d","position":%d,"url":"https://shop.example/p/%d"`, i, i+1, i)
			if i+1 < n {
				fmt.Fprintf(&b, `,"nextItem":{"@id":"#li%d"}`, i+1)
			}
			b.WriteString(`}`)
		}
		b.WriteString(`]},{"@type":"Product","name":"Main","offers":{"@type":"Offer","price":"19.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}]}`)
		return b.String()
	}
	t.Run("16,000 offers each starting a price specification chain", func(t *testing.T) {
		page := []byte(`<html><head><script type="application/ld+json">` + offerChain(16000) + `</script></head><body></body></html>`)
		start := time.Now()
		if _, err := ProductPrice(page, "text/html"); err != nil && !errors.Is(err, ErrEmpty) {
			t.Fatal(err)
		}
		if d := time.Since(start); d > time.Second {
			t.Fatalf("took %v for a %d KB page", d, len(page)/1024)
		}
	})
	t.Run("6,000 related items linked by nextItem before the Product", func(t *testing.T) {
		page := []byte(`<html><head><script type="application/ld+json">` + listChain(6000) + `</script></head><body></body></html>`)
		got, err := ProductPrice(page, "text/html")
		if want := (Price{19, "USD", "jsonld", AvailInStock}); err != nil || got != want {
			t.Fatalf("got %+v, %v; want %+v", got, err, want)
		}
	})
}
