package extract

import "strings"

// Availability words: whether a product can be bought, as the page states it.
const (
	AvailInStock      = "in_stock"
	AvailOutOfStock   = "out_of_stock"
	AvailPreorder     = "preorder"
	AvailBackorder    = "backorder"
	AvailLimited      = "limited"
	AvailDiscontinued = "discontinued"
	AvailUnknown      = "unknown"
)

// availabilityWords maps a stated availability, lowercased with spaces,
// dashes and underscores dropped, to its word. Keys cover schema.org
// ItemAvailability and the Open Graph / Facebook product:availability values.
var availabilityWords = map[string]string{
	"instock":             AvailInStock,
	"available":           AvailInStock,
	"onlineonly":          AvailInStock,
	"instoreonly":         AvailInStock,
	"outofstock":          AvailOutOfStock,
	"oos":                 AvailOutOfStock,
	"soldout":             AvailOutOfStock,
	"unavailable":         AvailOutOfStock,
	"notavailable":        AvailOutOfStock,
	"reserved":            AvailOutOfStock,
	"markassold":          AvailOutOfStock,
	"preorder":            AvailPreorder,
	"presale":             AvailPreorder,
	"backorder":           AvailBackorder,
	"madetoorder":         AvailBackorder,
	"availablefororder":   AvailBackorder,
	"limitedavailability": AvailLimited,
	"limited":             AvailLimited,
	"discontinued":        AvailDiscontinued,
}

// NormalizeAvailability reads a stated availability ("https://schema.org/InStock",
// "http://schema.org/OutOfStock", "schema:SoldOut", "InStock", "in stock",
// "out_of_stock") as one of the Avail words. Anything else, empty included,
// is AvailUnknown.
func NormalizeAvailability(raw string) string {
	s := strings.TrimSpace(raw)
	if i := strings.LastIndexAny(s, "/:#"); i >= 0 {
		s = s[i+1:]
	}
	s = strings.NewReplacer(" ", "", "-", "", "_", "").Replace(strings.ToLower(s))
	if w, ok := availabilityWords[s]; ok {
		return w
	}
	return AvailUnknown
}

// Unbuyable reports a known availability that rules out buying: out of stock
// or discontinued. Unknown never counts.
func Unbuyable(a string) bool {
	return a == AvailOutOfStock || a == AvailDiscontinued
}

// Buyable reports a known availability that lets the person order it now,
// even if it ships later (preorder, backorder).
func Buyable(a string) bool {
	switch a {
	case AvailInStock, AvailLimited, AvailPreorder, AvailBackorder:
		return true
	}
	return false
}

// KnownAvailability reports an availability the page stated: not "" (never
// read) and not AvailUnknown.
func KnownAvailability(a string) bool {
	return a != "" && a != AvailUnknown
}

// buyRank orders availabilities from most to least buyable, for offers at
// one price that disagree. Unknown sits between the buyable words and the
// unbuyable ones: an offer that states nothing never lets a sibling's "sold
// out" hold an alert, and the page's meta tags get their say instead. ""
// (nothing read yet) ranks last.
func buyRank(a string) int {
	switch a {
	case AvailInStock:
		return 0
	case AvailLimited:
		return 1
	case AvailPreorder:
		return 2
	case AvailBackorder:
		return 3
	case AvailUnknown:
		return 4
	case AvailOutOfStock:
		return 5
	case AvailDiscontinued:
		return 6
	}
	return 7
}
