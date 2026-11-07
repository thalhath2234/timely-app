package extract

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// A money marker names a currency next to an amount. The longer dollar
// prefixes come first so "C$" is never read as a bare "$".
var (
	markerRe = regexp.MustCompile(`US\$|CA?\$|AU?\$|NZ\$|HK\$|S\$|₹|\$|€|£|¥|(?i:\brs\b\.?)|\b(?:` + isoCodes + `)\b`)
	// numberRe finds amounts as people write them: grouped by spaces or
	// apostrophes (1 299,99), or by commas and dots in any grouping,
	// Indian (1,23,456) or western (1,234,567).
	numberRe = regexp.MustCompile(`\d{1,3}(?:[ \x{00A0}\x{202F}']\d{3})+(?:[.,]\d+)?|\d[\d.,]*\d|\d`)
	isoRun   = regexp.MustCompile(`^(?:` + isoCodes + `)$`)
	// bareRe is text that is only an amount, with the trailing "." or "/-"
	// shops print after one ("19,999." or "₹19,999/-" without its symbol).
	bareRe = regexp.MustCompile(`^\d[\d.,\x{00A0}\x{202F}' ]*(?:/-|\.)?$`)
)

// isoCodes are the currency codes read as markers, as in currencyCode.
const isoCodes = `USD|EUR|GBP|INR|JPY|CNY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|BRL|MXN|SGD|HKD|AED|ZAR`

// A bare "$" or "¥" names no one currency, so it gives "" unless a code
// stands next to it ("$19.99 CAD").
var markerCodes = map[string]string{
	"US$": "USD", "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD", "NZ$": "NZD", "HK$": "HKD", "S$": "SGD",
	"₹": "INR", "$": "", "€": "EUR", "£": "GBP", "¥": "",
}

// money is one amount found in a text, with its currency marker. start and
// end are byte offsets of the marker and the number together.
type money struct {
	amount     float64
	currency   string
	start, end int
}

// ParseMoney reads the first amount that a currency marker stands next to:
// the symbols ₹ $ € £ ¥, an ISO code (INR, USD, EUR, CAD, ...), or
// "Rs"/"Rs." for rupees, before or after the number. A bare $ or ¥ gives no
// currency unless a code stands next to it ("$19.99 CAD"). Grouping may be
// Indian (₹1,23,456) or western ($1,234.50), and a decimal comma is read
// when it cannot be a thousands separator (12,50 €). Plain spaces group
// digits only before a trailing marker ("1 299,99 €"), so "$25 100% cotton"
// is 25. A text that is only a number ("19,999.")
// is an amount with no currency. Anything else is not ok.
func ParseMoney(text string) (amount float64, currency string, ok bool) {
	if ms := findMoney(text, 1); len(ms) > 0 {
		return ms[0].amount, ms[0].currency, true
	}
	t := strings.TrimSpace(text)
	if bareRe.MatchString(t) {
		t = strings.TrimSuffix(t, "/-")
		if f, ok := parseAmount(t); ok {
			return f, "", true
		}
	}
	return 0, "", false
}

// findMoney returns up to limit amounts with a currency marker in text, in
// order; limit <= 0 means all of them. An amount takes the marker right
// before it, else the one right after it, with only space between; each
// marker belongs to one amount.
func findMoney(text string, limit int) []money {
	markers := markerRe.FindAllStringIndex(text, -1)
	if len(markers) == 0 {
		return nil
	}
	var out []money
	taken := make([]bool, len(markers))
	for _, num := range numberRe.FindAllStringIndex(text, -1) {
		if limit > 0 && len(out) >= limit {
			break
		}
		// Only the last marker before the number can stand right next
		// to it, and only the first one after it.
		pick := -1
		if i := sort.Search(len(markers), func(i int) bool { return markers[i][1] > num[0] }) - 1; i >= 0 &&
			!taken[i] && onlySpace(text[markers[i][1]:num[0]]) {
			pick = i
		}
		// A letter or digit right before the number, with no marker
		// between, makes it part of a word or code ("A4", "B0C9").
		if pick < 0 && num[0] > 0 {
			if r, _ := utf8.DecodeLastRuneInString(text[:num[0]]); unicode.IsLetter(r) || unicode.IsDigit(r) {
				continue
			}
		}
		if pick < 0 {
			if i := sort.Search(len(markers), func(i int) bool { return markers[i][0] >= num[1] }); i < len(markers) &&
				!taken[i] && onlySpace(text[num[1]:markers[i][0]]) {
				pick = i
			}
		}
		if pick < 0 {
			continue
		}
		mk := markers[pick]
		end := num[1]
		// Plain spaces group thousands only in the style that puts the
		// marker after the amount; before it, or with a word or % right
		// after, they part two numbers ("$25 100% cotton").
		if sp := strings.IndexByte(text[num[0]:end], ' '); sp >= 0 && (mk[1] <= num[0] || nextIsWordOrPct(text[end:])) {
			end = num[0] + sp
		}
		f, ok := parseAmount(text[num[0]:end])
		if !ok {
			continue
		}
		taken[pick] = true
		cur := markerCode(text[mk[0]:mk[1]])
		start, stop := min(mk[0], num[0]), max(mk[1], end)
		if cur == "" {
			// A bare $ or ¥ takes a code that stands right before it or
			// right after the amount.
			if pick > 0 && !taken[pick-1] && isoRun.MatchString(text[markers[pick-1][0]:markers[pick-1][1]]) && onlySpace(text[markers[pick-1][1]:start]) {
				cur, start = text[markers[pick-1][0]:markers[pick-1][1]], markers[pick-1][0]
				taken[pick-1] = true
			} else if i := sort.Search(len(markers), func(i int) bool { return markers[i][0] >= stop }); i < len(markers) && !taken[i] &&
				isoRun.MatchString(text[markers[i][0]:markers[i][1]]) && onlySpace(text[stop:markers[i][0]]) {
				cur, stop = text[markers[i][0]:markers[i][1]], markers[i][1]
				taken[i] = true
			}
		}
		out = append(out, money{amount: f, currency: cur, start: start, end: stop})
	}
	return out
}

func nextIsWordOrPct(s string) bool {
	r, _ := utf8.DecodeRuneInString(s)
	return r == '%' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

func markerCode(m string) string {
	if c, ok := markerCodes[m]; ok {
		return c
	}
	if strings.HasPrefix(strings.ToLower(m), "rs") {
		return "INR"
	}
	return strings.ToUpper(m)
}

func onlySpace(s string) bool {
	for _, r := range s {
		if !unicode.IsSpace(r) && r != '\u00a0' && r != '\u202f' {
			return false
		}
	}
	return true
}
