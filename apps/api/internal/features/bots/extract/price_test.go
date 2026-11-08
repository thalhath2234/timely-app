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
		{"product_jsonld.html", Price{Amount: 27499, Currency: "INR", From: "jsonld"}},
		{"product_graph.html", Price{Amount: 89, Currency: "GBP", From: "jsonld"}},
		{"product_og.html", Price{Amount: 1249.5, Currency: "USD", From: "og"}},
		{"product_itemprop.html", Price{Amount: 149.99, Currency: "CAD", From: "itemprop"}},
		{"product_eu.html", Price{Amount: 1299.99, Currency: "EUR", From: "itemprop"}},
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
		{"number price", `{"@type":"Product","offers":{"@type":"Offer","price":19.5,"priceCurrency":"usd"}}`, Price{19.5, "USD", "jsonld"}},
		{"type array and schema URL", `{"@type":["http://schema.org/Product","Thing"],"offers":{"price":"7"}}`, Price{7, "", "jsonld"}},
		{"price specification", `{"@type":"Product","offers":{"@type":"Offer","priceSpecification":{"@type":"UnitPriceSpecification","price":"12.00","priceCurrency":"EUR"}}}`, Price{12, "EUR", "jsonld"}},
		{"aggregate with only price", `{"@type":"Product","offers":{"@type":"AggregateOffer","price":"30"}}`, Price{30, "", "jsonld"}},
		{"zero price skipped", `{"@type":"Product","offers":[{"price":"0"},{"price":"5","priceCurrency":"INR"}]}`, Price{5, "INR", "jsonld"}},
		{"nested under WebPage", `{"@type":"WebPage","mainEntity":{"@type":"Product","offers":{"price":"3.25"}}}`, Price{3.25, "", "jsonld"}},
		{"lone top offer", `[{"@type":"Offer","price":"44","priceCurrency":"GBP"}]`, Price{44, "GBP", "jsonld"}},
		{"variant group", `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"60"}}]}`, Price{60, "", "jsonld"}},
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
	if want := (Price{10, "AUD", "og"}); got != want {
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
		{name: "loop beside a product", ld: `[{"@id":"a","@type":"Thing","x":{"@id":"a"}},{"@type":"Product","offers":{"price":"12","priceCurrency":"EUR"}}]`, want: Price{12, "EUR", "jsonld"}},
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
