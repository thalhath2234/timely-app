package extract

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// MaxExcerpt caps PriceExcerpt's text, in runes.
const MaxExcerpt = 240

// PriceExcerpt returns up to MaxExcerpt runes of the page's visible text
// around the first price that equals amount, so a person sees the price
// where the page shows it: "…M.R.P. ₹24,990 Deal Price: Rs 19,999…". mark
// is the rune range of that price in text, and struck the rune ranges of
// crossed-out prices in it. A cut at either end is shown with "…". A page
// that does not show the amount gives "".
func PriceExcerpt(body []byte, contentType string, amount float64) (text string, mark [2]int, struck [][2]int) {
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return "", mark, nil
	}
	var fl flatText
	fl.walk(doc, 0)
	all := fl.b.String()
	ms := findMoney(all, 0)

	hit := -1
	for i, m := range ms {
		if sameAmount(m.amount, amount) {
			hit = i
			break
		}
	}
	var start, end int
	if hit >= 0 {
		start, end = ms[hit].start, ms[hit].end
	} else if s, e, ok := bareAmount(all, amount); ok {
		start, end = s, e
	} else {
		return "", mark, nil
	}

	runes := []rune(all)
	rs := utf8.RuneCountInString(all[:start])
	re := rs + utf8.RuneCountInString(all[start:end])
	from, to := window(runes, rs, re)
	var b strings.Builder
	lead := 0
	if from > 0 {
		b.WriteString("…")
		lead = 1
	}
	b.WriteString(string(runes[from:to]))
	if to < len(runes) {
		b.WriteString("…")
	}
	mark = [2]int{rs - from + lead, re - from + lead}
	// The crossed-out prices inside the window, by their byte offsets.
	fromByte := len(string(runes[:from]))
	toByte := fromByte + len(string(runes[from:to]))
	for _, m := range ms {
		if m.start < fromByte || m.end > toByte || !fl.struckAt(m.start, m.end) {
			continue
		}
		s := from + utf8.RuneCountInString(all[fromByte:m.start])
		e := s + utf8.RuneCountInString(all[m.start:m.end])
		struck = append(struck, [2]int{s - from + lead, e - from + lead})
	}
	return b.String(), mark, struck
}

// window picks the runes around [rs, re) that fit MaxExcerpt with room for
// an ellipsis at each end, centred on the match, and moves a cut that falls
// inside a word to the space next to it.
func window(runes []rune, rs, re int) (from, to int) {
	if len(runes) <= MaxExcerpt {
		return 0, len(runes)
	}
	size := MaxExcerpt - 2
	from = max(0, rs-(size-(re-rs))/2)
	to = min(len(runes), from+size)
	from = max(0, to-size)
	const slack = 16
	if from > 0 {
		for i := from; i < min(rs, from+slack); i++ {
			if unicode.IsSpace(runes[i]) {
				from = i + 1
				break
			}
		}
	}
	if to < len(runes) {
		for i := to; i > max(re, to-slack); i-- {
			if unicode.IsSpace(runes[i-1]) {
				to = i - 1
				break
			}
		}
	}
	return from, to
}

// bareAmount finds the first number in s that equals amount, for a price
// the page prints without a currency.
func bareAmount(s string, amount float64) (start, end int, ok bool) {
	for _, num := range numberRe.FindAllStringIndex(s, -1) {
		if num[0] > 0 {
			if r, _ := utf8.DecodeLastRuneInString(s[:num[0]]); unicode.IsLetter(r) || unicode.IsDigit(r) {
				continue
			}
		}
		if f, ok := parseAmount(s[num[0]:num[1]]); ok && sameAmount(f, amount) {
			return num[0], num[1], true
		}
	}
	return 0, 0, false
}

// flatText is a page's visible text on one line, with the byte ranges that
// are crossed out.
type flatText struct {
	b      strings.Builder
	space  bool
	struck [][2]int
}

func (fl *flatText) walk(n *html.Node, struck int) {
	switch n.Type {
	case html.TextNode:
		fl.text(n.Data, struck > 0)
		return
	case html.ElementNode:
		if hidden[n.DataAtom] || n.DataAtom == atom.Nav || n.DataAtom == atom.Footer {
			return
		}
		if isStruck(n) {
			struck++
		}
		if block[n.DataAtom] {
			fl.space = true
			defer func() { fl.space = true }()
		}
	case html.DocumentNode:
	default:
		return
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		fl.walk(c, struck)
	}
}

func (fl *flatText) text(s string, struck bool) {
	start := -1
	for _, r := range s {
		if unicode.IsSpace(r) {
			fl.space = true
			continue
		}
		if fl.space && fl.b.Len() > 0 {
			fl.b.WriteByte(' ')
		}
		fl.space = false
		if start < 0 {
			start = fl.b.Len()
		}
		fl.b.WriteRune(r)
	}
	if struck && start >= 0 {
		fl.struck = append(fl.struck, [2]int{start, fl.b.Len()})
	}
}

// struckAt reports whether any of [start, end) is crossed out.
func (fl *flatText) struckAt(start, end int) bool {
	for _, r := range fl.struck {
		if r[0] < end && start < r[1] {
			return true
		}
	}
	return false
}
