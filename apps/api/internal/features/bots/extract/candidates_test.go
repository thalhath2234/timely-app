package extract

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
)

func TestPriceCandidates(t *testing.T) {
	cases := []struct {
		file string
		want []string // label amount currency from struck selector
	}{
		{"shop_struck.html", []string{
			"Deal Price 19999 INR jsonld false #corePrice > table.a-lineitem > tbody > tr:nth-of-type(2) > td:nth-of-type(2) > span.a-price",
			"M.R.P. 24990 INR text true span.a-price.a-text-strike > span.a-offscreen",
			"You Save 4991 INR text false #corePrice span.a-color-price",
			"Up to 3150 INR text false #exchange span.a-offscreen",
		}},
		{"shop_books.html", []string{
			"Price 51.77 GBP text false div.col-sm-6.product_main > p.price_color",
			"Price 53.74 GBP text false li.col-xs-6:nth-of-type(1) > article.product_pod > div.product_price > p.price_color",
			"Price 50.1 GBP text false li.col-xs-6:nth-of-type(2) > article.product_pod > div.product_price > p.price_color",
		}},
		{"shop_inr_grouping.html", []string{
			"Our price 123456 INR text false dd.now",
			"List price 149999.5 INR text true del",
			"Monthly EMI 10288 INR text false span",
		}},
		{"product_jsonld.html", []string{
			"Price 27499 INR jsonld false div.price",
			"Price 29999 INR jsonld false ",
		}},
		{"product_og.html", []string{"Price 1249.5 USD og false span.money"}},
		{"product_noprice.html", nil},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			body := fixture(t, c.file)
			got, err := PriceCandidates(body, "text/html; charset=utf-8")
			if err != nil {
				t.Fatal(err)
			}
			checkCandidates(t, body, got, c.want)
		})
	}
}

// checkCandidates compares candidates with want lines, then checks that
// every selector reads its price back the way a selector_price watch will.
func checkCandidates(t *testing.T, body []byte, got []Candidate, want []string) {
	t.Helper()
	var lines []string
	for _, g := range got {
		lines = append(lines, fmt.Sprintf("%s %g %s %s %v %s", g.Label, g.Amount, g.Currency, g.From, g.Struck, g.Selector))
	}
	if strings.Join(lines, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got\n%s\nwant\n%s", strings.Join(lines, "\n"), strings.Join(want, "\n"))
	}
	for _, g := range got {
		if g.Selector == "" {
			continue
		}
		amount, _, err := SelectPrice(body, "text/html", g.Selector)
		if err != nil || !sameAmount(amount, g.Amount) {
			t.Fatalf("%s reads %g (%v), want %g", g.Selector, amount, err, g.Amount)
		}
	}
}

// A price printed as bare text next to another price in the same element
// is a candidate for that element, and its selector reads it back past the
// crossed-out one.
func TestPriceCandidatesOwnText(t *testing.T) {
	cases := []struct {
		page string
		want []string
	}{
		{`<p class="price">Now ₹499 <s>₹999</s></p>`, []string{
			"Now 499 INR text false p.price",
			"Price 999 INR text true s",
		}},
		{`<p class="price"><s>₹999</s> ₹499</p>`, []string{
			"Price 999 INR text true s",
			"Price 499 INR text false p.price",
		}},
		{`<div class="price">$30 <small>Save $10</small></div>`, []string{
			"Price 30  text false div.price",
			"Save 10  text false small",
		}},
		// Read first, the saving would be the price, so this one has no
		// selector to follow.
		{`<div class="price"><small>Save $10</small> $30</div>`, []string{
			"Save 10  text false small",
			"Price 30  text false ",
		}},
	}
	for _, c := range cases {
		t.Run(c.page, func(t *testing.T) {
			body := []byte("<html><body><h1>Mug</h1>" + c.page + "</body></html>")
			got, err := PriceCandidates(body, "text/html")
			if err != nil {
				t.Fatal(err)
			}
			checkCandidates(t, body, got, c.want)
		})
	}
}

// A JSON-LD strikethrough or list price is the crossed-out M.R.P., and it
// takes the struck price the page shows.
func TestPriceCandidatesJSONLDListPrice(t *testing.T) {
	for _, pt := range []string{"https://schema.org/StrikethroughPrice", "ListPrice"} {
		page := `<html><head><script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"19999","priceCurrency":"INR",
"priceSpecification":{"@type":"UnitPriceSpecification","priceType":"` + pt + `","price":"24990","priceCurrency":"INR"}}}</script></head>
<body><div id="buy"><span class="deal">₹19,999</span> M.R.P. <del>₹24,990</del></div></body></html>`
		got, err := PriceCandidates([]byte(page), "text/html")
		if err != nil {
			t.Fatal(err)
		}
		checkCandidates(t, []byte(page), got, []string{
			"Price 19999 INR jsonld false #buy span.deal",
			"M.R.P. 24990 INR jsonld true #buy del",
		})
	}
}

func TestPriceCandidatesCapAndDedupe(t *testing.T) {
	var b strings.Builder
	b.WriteString("<html><body>")
	for i := range 10 {
		fmt.Fprintf(&b, `<div class="tile"><span class="p">$%d.00</span><s class="p">$%d.00</s><span class="p">$%d.00</span></div>`, 10+i, 10+i, 10+i)
	}
	b.WriteString("</body></html>")
	got, err := PriceCandidates([]byte(b.String()), "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != MaxCandidates {
		t.Fatalf("%d candidates", len(got))
	}
	// The same amount crossed out is its own candidate; shown twice is one.
	want := []string{"10 false", "10 true", "11 false", "11 true", "12 false", "12 true"}
	for i, g := range got {
		if s := fmt.Sprintf("%g %v", g.Amount, g.Struck); s != want[i] {
			t.Errorf("%d: %s, want %s", i, s, want[i])
		}
	}
}

func TestPriceCandidatesJSONLDRange(t *testing.T) {
	page := `<html><head><script type="application/ld+json">{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"12.50","highPrice":"30","priceCurrency":"EUR"}}</script></head><body><p>Long text that mentions €12.50 somewhere in a sentence that goes on and on for a while.</p></body></html>`
	got, err := PriceCandidates([]byte(page), "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Lowest price" || got[0].Amount != 12.5 || got[1].Label != "Highest price" || got[1].Amount != 30 || got[0].Selector != "" {
		t.Fatalf("%+v", got)
	}
}

// SelectorFor's path finds exactly its element, with cascadia and with
// Select's own matcher, for every element on every fixture.
func TestSelectorForRoundTrip(t *testing.T) {
	for _, file := range []string{"shop_struck.html", "shop_books.html", "shop_inr_grouping.html", "selector.html", "article.html", "noisy.html"} {
		doc, err := html.Parse(bytes.NewReader(fixture(t, file)))
		if err != nil {
			t.Fatal(err)
		}
		var all []*html.Node
		var walk func(*html.Node)
		walk = func(n *html.Node) {
			if n.Type == html.ElementNode {
				all = append(all, n)
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
		walk(doc)
		found := 0
		for _, n := range all {
			sel := SelectorFor(n)
			if sel == "" {
				continue
			}
			found++
			if got := cascadia.MustCompile(sel).MatchAll(doc); len(got) != 1 || got[0] != n {
				t.Fatalf("%s: %q matches %d elements", file, sel, len(got))
			}
			chains, err := compile(sel)
			if err != nil {
				t.Fatalf("%s: %q: %v", file, sel, err)
			}
			if got, err := matchAll(doc, chains, newBudget()); err != nil || len(got) != 1 || got[0] != n {
				t.Fatalf("%s: %q: Select matches %d (%v)", file, sel, len(got), err)
			}
		}
		if found < len(all)/2 {
			t.Errorf("%s: only %d of %d elements got a selector", file, found, len(all))
		}
	}
}

func TestSelectorForShapes(t *testing.T) {
	page := `<html><body>
<div id="buy"><span class="x">a</span><span class="x">b</span></div>
<div id="dup"></div><div id="dup"><b>c</b></div>
<ul><li class="css-1a2b3c item">1</li><li class="is-active item">2</li></ul>
<span id="1bad">d</span>
</body></html>`
	doc, err := html.Parse(strings.NewReader(page))
	if err != nil {
		t.Fatal(err)
	}
	find := func(css string, i int) *html.Node { return cascadia.MustCompile(css).MatchAll(doc)[i] }
	cases := []struct {
		n    *html.Node
		want string
	}{
		{find("#buy", 0), "#buy"},
		{find("#buy span", 1), "#buy span.x:nth-of-type(2)"},
		{find("#buy span", 0), "#buy span.x:nth-of-type(1)"},
		{find("b", 0), "b"},
		{find("li", 1), "li.item:nth-of-type(2)"},
		{find("span", 2), "body > span"},
		{nil, ""},
	}
	for _, c := range cases {
		if got := SelectorFor(c.n); got != c.want {
			t.Errorf("got %q, want %q", got, c.want)
		}
	}
	// Seven levels with nothing unique below the top is past the cap.
	deep := "<html><body>" + strings.Repeat("<div><div></div>", 7) + "<p>x</p>" + strings.Repeat("</div>", 7) + "<div>" + strings.Repeat("<div>", 7) + "<p>y</p>" + strings.Repeat("</div>", 8) + "</body></html>"
	doc, err = html.Parse(strings.NewReader(deep))
	if err != nil {
		t.Fatal(err)
	}
	if got := SelectorFor(cascadia.MustCompile("p").MatchAll(doc)[1]); got != "" {
		t.Errorf("deep: %q", got)
	}
}
