package bots

import (
	"context"
	"net/http"
	"testing"

	"timely-api/internal/features/bots/extract"
)

// The Pixel case end to end: a "below ₹90,000" shop watch whose page drops
// to ₹89,999 while out of stock logs held_stock with the reason and sends
// nothing; once the same price can be bought it alerts once.
func TestIntegrationBotHoldsOutOfStockPrice(t *testing.T) {
	e := newEngine(t)
	u := "https://www.flipkart.com/google-pixel-10-pro/p/itm1"
	amount, avail := "109999", "http://schema.org/InStock"
	e.net.set(u, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "text/html; charset=utf-8", string(flipkartPage(t, amount, avail))), nil
	})
	v := e.create(Input{Name: "Pixel 10 Pro", Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadProductPrice,
		Rules: []Rule{{Kind: RuleBelow, Threshold: f64(90000)}}}}})
	if v.Watches[0].Rules[0].OnlyInStock != nil {
		t.Fatalf("rule %+v", v.Watches[0].Rules[0])
	}
	must(t, e.run(v.ID))
	if c := e.lastCheck(v.ID); c.Outcome != outBaseline {
		t.Fatalf("first check %+v", c)
	}

	amount, avail = "89999", "http://schema.org/OutOfStock"
	for range 2 {
		e.again(v.ID)
		c := e.lastCheck(v.ID)
		if c.Outcome != outHeldStock || c.AlertID != nil || len(c.Fired) != 0 || len(c.Watches) != 1 ||
			c.Watches[0].Outcome != outHeldStock || c.Watches[0].Note != "Price is below ₹90,000, but the page says it is out of stock" {
			t.Fatalf("out of stock check %+v", c)
		}
		if r := c.Reading[v.Watches[0].ID]; r.Availability != extract.AvailOutOfStock {
			t.Fatalf("check reading %+v", c.Reading)
		}
	}
	if n := len(e.notifications()); n != 0 {
		t.Fatalf("out of stock alerted %d times", n)
	}
	d, err := e.s.Get(context.Background(), e.user, v.ID)
	must(t, err)
	if d.Checks[0].Outcome != outHeldStock || d.Checks[0].Note == "" || d.Watches[0].Availability != extract.AvailOutOfStock {
		t.Fatalf("detail check %+v, watch availability %q", d.Checks[0], d.Watches[0].Availability)
	}

	avail = "http://schema.org/InStock"
	e.again(v.ID)
	if c := e.lastCheck(v.ID); c.Outcome != outFired || c.AlertID == nil {
		t.Fatalf("back in stock %+v", c)
	}
	e.again(v.ID)
	if c := e.lastCheck(v.ID); c.Outcome != outUnchanged {
		t.Fatalf("after the alert %+v", c)
	}
	ntfs := e.notifications()
	if len(ntfs) != 1 || ntfs[0].Title != "Pixel 10 Pro: below 90,000" || ntfs[0].Body != "Now ₹89,999, back in stock" {
		t.Fatalf("notifications %+v", ntfs)
	}
	if w := watchRow(t, e.db, v.Watches[0].ID); w.LastReading.Availability != extract.AvailInStock {
		t.Fatalf("last reading %+v", w.LastReading)
	}
}
