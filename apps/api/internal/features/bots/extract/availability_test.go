package extract

import "testing"

func TestNormalizeAvailability(t *testing.T) {
	cases := map[string]string{
		"https://schema.org/InStock":                  AvailInStock,
		"http://schema.org/InStock":                   AvailInStock,
		"InStock":                                     AvailInStock,
		"schema:InStock":                              AvailInStock,
		" https://schema.org/OutOfStock ":             AvailOutOfStock,
		"http://schema.org/OutOfStock":                AvailOutOfStock,
		"OutOfStock":                                  AvailOutOfStock,
		"https://schema.org/SoldOut":                  AvailOutOfStock,
		"http://schema.org/LimitedAvailability":       AvailLimited,
		"OnlineOnly":                                  AvailInStock,
		"https://schema.org/InStoreOnly":              AvailInStock,
		"PreOrder":                                    AvailPreorder,
		"https://schema.org/PreSale":                  AvailPreorder,
		"BackOrder":                                   AvailBackorder,
		"MadeToOrder":                                 AvailBackorder,
		"https://schema.org/Discontinued":             AvailDiscontinued,
		"http://schema.org/ItemAvailability#Reserved": AvailOutOfStock,
		// Open Graph / Facebook product:availability values.
		"in stock":            AvailInStock,
		"out of stock":        AvailOutOfStock,
		"available for order": AvailBackorder,
		"preorder":            AvailPreorder,
		"discontinued":        AvailDiscontinued,
		// The words Timely stores read back as themselves.
		"in_stock":     AvailInStock,
		"out_of_stock": AvailOutOfStock,
		"":             AvailUnknown,
		"pending":      AvailUnknown,
		"Call us":      AvailUnknown,
	}
	for raw, want := range cases {
		if got := NormalizeAvailability(raw); got != want {
			t.Errorf("NormalizeAvailability(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestAvailabilityKinds(t *testing.T) {
	for _, a := range []string{AvailOutOfStock, AvailDiscontinued} {
		if !Unbuyable(a) || Buyable(a) || !KnownAvailability(a) {
			t.Errorf("%s should be unbuyable and known", a)
		}
	}
	for _, a := range []string{AvailInStock, AvailLimited, AvailPreorder, AvailBackorder} {
		if Unbuyable(a) || !Buyable(a) || !KnownAvailability(a) {
			t.Errorf("%s should be buyable and known", a)
		}
	}
	for _, a := range []string{AvailUnknown, ""} {
		if Unbuyable(a) || Buyable(a) || KnownAvailability(a) {
			t.Errorf("%q should be neither buyable nor unbuyable", a)
		}
	}
}

func TestProductPriceFlipkartOutOfStock(t *testing.T) {
	got, err := ProductPrice(fixture(t, "product_flipkart_oos.html"), "text/html; charset=utf-8")
	if err != nil {
		t.Fatal(err)
	}
	if want := (Price{Amount: 89999, Currency: "INR", From: "jsonld", Availability: AvailOutOfStock}); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestProductPriceAvailabilityJSONLD(t *testing.T) {
	cases := []struct{ name, ld, want string }{
		{"https URL", `{"@type":"Product","offers":{"@type":"Offer","price":"10","availability":"https://schema.org/InStock"}}`, AvailInStock},
		{"http URL", `{"@type":"Product","offers":{"@type":"Offer","price":"10","availability":"http://schema.org/OutOfStock"}}`, AvailOutOfStock},
		{"bare word", `{"@type":"Product","offers":{"@type":"Offer","price":"10","availability":"PreOrder"}}`, AvailPreorder},
		{"absent", `{"@type":"Product","offers":{"@type":"Offer","price":"10"}}`, AvailUnknown},
		{"offer array: the priced offer's", `{"@type":"Product","offers":[{"price":"0","availability":"InStock"},{"price":"12","availability":"SoldOut"}]}`, AvailOutOfStock},
		{"aggregate states its own", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","highPrice":"20","availability":"https://schema.org/InStock"}}`, AvailInStock},
		{"aggregate: the low price's seller sold out", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"@type":"Offer","price":"8","availability":"OutOfStock"},{"@type":"Offer","price":"9","availability":"http://schema.org/InStock"}]}}`, AvailOutOfStock},
		{"aggregate: any seller at the low price in stock", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"price":"8","availability":"OutOfStock"},{"price":"8.00","availability":"InStock"},{"price":"9","availability":"OutOfStock"}]}}`, AvailInStock},
		{"aggregate: no seller priced, any in stock", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"availability":"OutOfStock"},{"availability":"InStock"}]}}`, AvailInStock},
		{"offer array: one variant sold out, another at the price in stock", `{"@type":"Product","offers":[{"price":"12","priceCurrency":"USD","availability":"OutOfStock"},{"price":"12.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}]}`, AvailInStock},
		{"offer array: every variant sold out", `{"@type":"Product","offers":[{"price":"12","availability":"OutOfStock"},{"price":"12","availability":"SoldOut"}]}`, AvailOutOfStock},
		{"offer array: in stock only at another price", `{"@type":"Product","offers":[{"price":"12","availability":"OutOfStock"},{"price":"15","availability":"InStock"}]}`, AvailOutOfStock},
		{"offer array: in stock only in another currency", `{"@type":"Product","offers":[{"price":"12","priceCurrency":"USD","availability":"OutOfStock"},{"price":"12","priceCurrency":"EUR","availability":"InStock"}]}`, AvailOutOfStock},
		{"variants: first sold out, a sibling in stock", `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"20","availability":"OutOfStock"}},{"@type":"Product","offers":{"price":"20","availability":"InStock"}}]}`, AvailInStock},
		{"variants: every one sold out", `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"20","availability":"OutOfStock"}},{"@type":"Product","offers":{"price":"20","availability":"Discontinued"}}]}`, AvailOutOfStock},
		{"availability as an @id node", `{"@type":"Product","offers":{"price":"10","availability":{"@id":"https://schema.org/OutOfStock"}}}`, AvailOutOfStock},
		{"aggregate: every seller sold out", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"price":"8","availability":"OutOfStock"},{"price":"9","availability":"https://schema.org/Discontinued"}]}}`, AvailOutOfStock},
		{"price specification keeps its offer's", `{"@type":"Product","offers":{"@type":"Offer","availability":"https://schema.org/LimitedAvailability","priceSpecification":{"price":"12","priceCurrency":"EUR"}}}`, AvailLimited},
		{"graph", `{"@graph":[{"@type":"WebPage"},{"@type":"Product","offers":{"price":"3","availability":"BackOrder"}}]}`, AvailBackorder},
		{"offer array: one at the price says nothing, a sibling sold out", `{"@type":"Product","offers":[{"price":"12"},{"price":"12","availability":"OutOfStock"}]}`, AvailUnknown},
		{"offer array: a sold-out offer, a sibling at the price says nothing", `{"@type":"Product","offers":[{"price":"12","availability":"OutOfStock"},{"price":"12"}]}`, AvailUnknown},
		{"offer array: one at the price says nothing, a sibling at the price in stock", `{"@type":"Product","offers":[{"price":"12"},{"price":"12","availability":"InStock"}]}`, AvailInStock},
		{"offer array: one says nothing, in stock only at another price", `{"@type":"Product","offers":[{"price":"12"},{"price":"15","availability":"InStock"}]}`, AvailUnknown},
		{"offer array: siblings naming one price specification each keep their own", `{"@type":"Product","offers":[{"price":"12","priceCurrency":"EUR","availability":"OutOfStock"},{"@type":"Offer","availability":"OutOfStock","priceSpecification":{"@id":"#ps","price":"12","priceCurrency":"EUR"}},{"@type":"Offer","availability":"InStock","priceSpecification":{"@id":"#ps"}}]}`, AvailInStock},
		{"variants: one says nothing, a sibling discontinued", `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"20"}},{"@type":"Product","offers":{"price":"20","availability":"Discontinued"}}]}`, AvailUnknown},
		{"aggregate: a seller at the low price says nothing, another sold out", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"price":"8","availability":"OutOfStock"},{"price":"8"},{"price":"9","availability":"OutOfStock"}]}}`, AvailUnknown},
		{"aggregate: the low price's seller says nothing, a dearer one in stock", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"price":"8"},{"price":"9","availability":"InStock"}]}}`, AvailUnknown},
		{"aggregate: the low price's seller says nothing, a dearer one sold out", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"price":"8"},{"price":"9","availability":"OutOfStock"}]}}`, AvailUnknown},
		{"aggregate with no price of its own: the first priced seller says nothing, a dearer one in stock", `{"@type":"Product","offers":{"@type":"AggregateOffer","offers":[{"price":"8"},{"price":"9","availability":"InStock"}]}}`, AvailUnknown},
		{"aggregate with no price of its own: a seller at the first price in stock", `{"@type":"Product","offers":{"@type":"AggregateOffer","offers":[{"price":"8","availability":"OutOfStock"},{"price":"8","availability":"InStock"}]}}`, AvailInStock},
		{"aggregate: the low price sits in a seller's price specification", `{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"priceSpecification":{"price":"8"},"availability":"OutOfStock"},{"price":"9","availability":"InStock"}]}}`, AvailOutOfStock},
		{"variants naming one price specification each keep their own", `{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"availability":"OutOfStock","priceSpecification":{"@id":"#ps","price":"20"}}},{"@type":"Product","offers":{"availability":"InStock","priceSpecification":{"@id":"#ps"}}}]}`, AvailInStock},
		{"offer array: a nested list holds an offer at the price in stock", `{"@type":"Product","offers":[{"@type":"Offer","price":"10","priceCurrency":"USD","availability":"OutOfStock"},[{"@type":"Offer","price":"12","priceCurrency":"USD","availability":"InStock"},{"@type":"Offer","price":"10","priceCurrency":"USD","availability":"InStock"}]]}`, AvailInStock},
		{"lone top offer", `{"@type":"Offer","price":"44","availability":"https://schema.org/Discontinued"}`, AvailDiscontinued},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			page := `<html><head><script type="application/ld+json">` + c.ld + `</script></head></html>`
			got, err := ProductPrice([]byte(page), "text/html")
			if err != nil {
				t.Fatal(err)
			}
			if got.Availability != c.want {
				t.Fatalf("availability %q, want %q (%+v)", got.Availability, c.want, got)
			}
		})
	}
}

func TestProductPriceAvailabilityMicrodataAndMeta(t *testing.T) {
	cases := []struct{ name, page, want string }{
		{"microdata link", `<div itemscope itemtype="https://schema.org/Product"><div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
<span itemprop="price" content="499.00">$499</span><meta itemprop="priceCurrency" content="USD">
<link itemprop="availability" href="https://schema.org/OutOfStock">Sold out</div></div>`, AvailOutOfStock},
		{"microdata meta", `<div itemscope itemtype="http://schema.org/Offer"><span itemprop="price">19.99</span>
<meta itemprop="availability" content="http://schema.org/InStock"></div>`, AvailInStock},
		{"microdata text", `<div itemscope itemtype="https://schema.org/Offer"><span itemprop="price">5</span><span itemprop="availability">InStock</span></div>`, AvailInStock},
		{"product meta", `<meta property="product:price:amount" content="10.00"><meta property="product:price:currency" content="AUD">
<meta property="product:availability" content="out of stock">`, AvailOutOfStock},
		{"og meta", `<meta property="og:price:amount" content="10.00"><meta property="og:availability" content="instock">`, AvailInStock},
		{"JSON-LD price skips microdata, which may be another product's", `<script type="application/ld+json">{"@type":"Product","offers":{"price":"10"}}</script>
<link itemprop="availability" href="https://schema.org/SoldOut">`, AvailUnknown},
		{"JSON-LD price still takes og meta", `<script type="application/ld+json">{"@type":"Product","offers":{"price":"10"}}</script>
<meta property="og:availability" content="out of stock"><link itemprop="availability" href="https://schema.org/InStock">`, AvailOutOfStock},
		{"none", `<meta property="og:price:amount" content="10.00">`, AvailUnknown},
		{"JSON-LD offer that says nothing beside a sold-out one takes og meta", `<script type="application/ld+json">{"@type":"Product","offers":[{"price":"10"},{"price":"10","availability":"OutOfStock"}]}</script>
<meta property="og:availability" content="instock">`, AvailInStock},
		{"JSON-LD aggregate whose low-price sellers say nothing or sold out takes og meta, not a dearer seller's stock", `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"8","offers":[{"price":"8","availability":"OutOfStock"},{"price":"8"},{"price":"9","availability":"InStock"}]}}</script>
<meta property="og:availability" content="out of stock">`, AvailOutOfStock},
		{"JSON-LD aggregate with no price of its own whose first priced seller says nothing takes og meta", `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"AggregateOffer","offers":[{"price":"8"},{"price":"9","availability":"InStock"}]}}</script>
<meta property="og:availability" content="out of stock">`, AvailOutOfStock},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ProductPrice([]byte(`<html><head></head><body>`+c.page+`</body></html>`), "text/html")
			if err != nil {
				t.Fatal(err)
			}
			if got.Availability != c.want {
				t.Fatalf("availability %q, want %q (%+v)", got.Availability, c.want, got)
			}
		})
	}
}
