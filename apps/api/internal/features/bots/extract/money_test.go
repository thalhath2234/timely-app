package extract

import "testing"

func TestParseMoney(t *testing.T) {
	cases := []struct {
		text     string
		amount   float64
		currency string
		ok       bool
	}{
		{"₹19,999", 19999, "INR", true},
		{"₹ 1,23,456", 123456, "INR", true},
		{"₹1,23,456.50", 123456.5, "INR", true},
		{"Rs. 1,49,999", 149999, "INR", true},
		{"Rs 799", 799, "INR", true},
		{"rs.1,299", 1299, "INR", true},
		{"INR 2,500", 2500, "INR", true},
		{"$1,249.50", 1249.5, "", true},
		{"US$ 30", 30, "USD", true},
		{"C$149.99", 149.99, "CAD", true},
		{"£51.77", 51.77, "GBP", true},
		{"€1.299,99", 1299.99, "EUR", true},
		{"1.299,99 €", 1299.99, "EUR", true},
		{"12,50 €", 12.5, "EUR", true},
		{"1 299,99 €", 1299.99, "EUR", true},
		{"¥12,800", 12800, "", true},
		{"EUR 15", 15, "EUR", true},
		{"40 GBP", 40, "GBP", true},
		{"Deal Price: ₹19,999.00 incl. GST", 19999, "INR", true},
		{"M.R.P.: ₹24,990 Deal Price: ₹19,999", 24990, "INR", true},
		{"Was £60, now £45", 60, "GBP", true},
		{"₹10,288/-", 10288, "INR", true},
		{"$1,234,567.89", 1234567.89, "", true},
		// A bare $ or ¥ takes a code next to it, else none.
		{"$19.99 CAD", 19.99, "CAD", true},
		{"AUD $45", 45, "AUD", true},
		{"¥12,800 JPY", 12800, "JPY", true},
		{"$19.99 USD", 19.99, "USD", true},
		{"CAD 30", 30, "CAD", true},
		// Plain spaces after a leading marker part two numbers.
		{"$25 100% cotton", 25, "", true},
		{"From $25 100 reviews", 25, "", true},
		{"€ 12 500 sold", 12, "EUR", true},
		{"1 299 €", 1299, "EUR", true},
		{"1\u00a0299,99 €", 1299.99, "EUR", true},
		{"₹\u00a01\u00a0299", 1299, "INR", true},
		// A text that is only a number has no currency.
		{"19,999.", 19999, "", true},
		{" 27499 ", 27499, "", true},
		{"₹19,999/-", 19999, "INR", true},
		// Not money.
		{"In stock (22 available)", 0, "", false},
		{"Model RS-692", 0, "", false},
		{"Model A4 $", 0, "", false},
		{"₹0", 0, "", false},
		{"Price", 0, "", false},
		{"", 0, "", false},
		{"Ships in 3 days", 0, "", false},
	}
	for _, c := range cases {
		amount, currency, ok := ParseMoney(c.text)
		if ok != c.ok || !sameAmount(amount, c.amount) || currency != c.currency {
			t.Errorf("%q: %v %q %v, want %v %q %v", c.text, amount, currency, ok, c.amount, c.currency, c.ok)
		}
	}
}

// Each marker belongs to one amount: "500 € 600 €" is two prices.
func TestFindMoneyPairsMarkers(t *testing.T) {
	ms := findMoney("500 € 600 € and ₹700 ₹800", 0)
	want := []float64{500, 600, 700, 800}
	if len(ms) != len(want) {
		t.Fatalf("%+v", ms)
	}
	for i, m := range ms {
		if m.amount != want[i] {
			t.Errorf("%d: %v", i, m.amount)
		}
	}
	if ms := findMoney("₹100 ₹200", 1); len(ms) != 1 {
		t.Fatalf("limit 1 gave %d", len(ms))
	}
}
