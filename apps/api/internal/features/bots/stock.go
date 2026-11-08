package bots

import "timely-api/internal/features/bots/extract"

// stockWords is an availability as a person says it after "it is": "in
// stock", "out of stock", "up for preorder". "" for one the page did not
// state.
func stockWords(a string) string {
	switch a {
	case extract.AvailInStock:
		return "in stock"
	case extract.AvailOutOfStock:
		return "out of stock"
	case extract.AvailPreorder:
		return "up for preorder"
	case extract.AvailBackorder:
		return "on backorder"
	case extract.AvailLimited:
		return "in limited stock"
	case extract.AvailDiscontinued:
		return "discontinued"
	}
	return ""
}

// availabilityOf is a reading's availability as the views give it: the
// Avail word for a price read off a product page, extract.AvailUnknown for
// one saved before availability was read, "" for every other reading.
func availabilityOf(r *Reading, w Watch) string {
	if r == nil || r.Kind != ReadingPrice || !readsStock(w.Kind, w.ReadMode) {
		return ""
	}
	if r.Availability == "" {
		return extract.AvailUnknown
	}
	return r.Availability
}

// stockLine is a product's availability for the judge: "in stock", or
// "out of stock, now in stock" when the page said something else before.
// "" when the page states none now.
func stockLine(before, after Reading) string {
	now := stockWords(after.Availability)
	if now == "" {
		return ""
	}
	if stockMoved(before, after) {
		return stockWords(before.Availability) + ", now " + now
	}
	return now
}

// restockWords says a product came back: "back in stock", "open for
// preorder", "open for backorder", when before's page said it could not be
// bought and after's says it can. "" otherwise.
func restockWords(before, after Reading) string {
	if !extract.Unbuyable(before.Availability) || !extract.Buyable(after.Availability) {
		return ""
	}
	switch after.Availability {
	case extract.AvailPreorder:
		return "open for preorder"
	case extract.AvailBackorder:
		return "open for backorder"
	}
	return "back in stock"
}

// summaryWithStock is a reading's summary with what its page says about
// stock, for the judge: "₹89,999, out of stock".
func summaryWithStock(r *Reading) string {
	line := summary(r)
	if w := stockWords(r.Availability); w != "" && line != "" {
		line += ", " + w
	}
	return line
}
