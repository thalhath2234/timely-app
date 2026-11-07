package extract

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPriceExcerpt(t *testing.T) {
	cases := []struct {
		file   string
		amount float64
		mark   string
		struck []string
	}{
		{"shop_struck.html", 19999, "₹19,999", []string{"₹24,990"}},
		{"shop_struck.html", 24990, "₹24,990", []string{"₹24,990"}},
		{"shop_books.html", 51.77, "£51.77", nil},
		{"shop_inr_grouping.html", 123456, "Rs. 1,23,456", []string{"₹ 1,49,999.50"}},
		{"product_eu.html", 1299.99, "1.299,99 €", nil},
	}
	for _, c := range cases {
		text, mark, struck := PriceExcerpt(fixture(t, c.file), "text/html", c.amount)
		r := []rune(text)
		if utf8.RuneCountInString(text) > MaxExcerpt || mark[1] > len(r) || string(r[mark[0]:mark[1]]) != c.mark {
			t.Fatalf("%s %g: %q mark %v", c.file, c.amount, text, mark)
		}
		var got []string
		for _, s := range struck {
			got = append(got, string(r[s[0]:s[1]]))
		}
		if strings.Join(got, "|") != strings.Join(c.struck, "|") {
			t.Errorf("%s %g: struck %q", c.file, c.amount, got)
		}
	}
	if text, _, _ := PriceExcerpt(fixture(t, "shop_books.html"), "text/html", 999); text != "" {
		t.Errorf("an amount not on the page gave %q", text)
	}
}

// A long page is cut to MaxExcerpt runes around the price, at word breaks,
// with an ellipsis at each cut.
func TestPriceExcerptWindow(t *testing.T) {
	words := strings.Repeat("lorem ipsum dolor sit amet ", 40)
	page := "<html><body><p>" + words + "</p><p>Deal Price: <b>Rs 19,999</b></p><p>" + words + "</p></body></html>"
	text, mark, _ := PriceExcerpt([]byte(page), "text/html", 19999)
	r := []rune(text)
	if n := len(r); n > MaxExcerpt || n < MaxExcerpt-20 {
		t.Fatalf("%d runes: %q", n, text)
	}
	if !strings.HasPrefix(text, "…") || !strings.HasSuffix(text, "…") || strings.HasPrefix(text, "… ") || strings.HasSuffix(text, " …") {
		t.Fatalf("%q", text)
	}
	if string(r[mark[0]:mark[1]]) != "Rs 19,999" {
		t.Fatalf("mark %v in %q", mark, text)
	}
	if mid := (mark[0] + mark[1]) / 2; mid < len(r)/2-20 || mid > len(r)/2+20 {
		t.Errorf("the price is not centred: %v of %d", mark, len(r))
	}
	// A price printed with no currency is still found.
	text, mark, _ = PriceExcerpt([]byte(`<html><body><p>Now only 1,299 while stocks last</p></body></html>`), "text/html", 1299)
	if r := []rune(text); string(r[mark[0]:mark[1]]) != "1,299" {
		t.Fatalf("bare: %q %v", text, mark)
	}
}
