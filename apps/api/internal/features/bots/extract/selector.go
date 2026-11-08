package extract

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
)

// A person's selector runs on pages anyone can write, so it is matched in a
// way whose cost grows with the page, not exponentially with the selector.
// cascadia's own matcher backtracks through ancestors for every descendant
// combinator and walks subtrees for :has, which on a deeply nested page takes
// hours. Here a selector is split into compound selectors (no combinators),
// cascadia matches each one on a single element, and each combinator is one
// pass over the page. :has is refused, :not may hold only compound selectors,
// and the whole match runs under selectBudget.

var (
	// ErrTooComplex means matching a selector on the page ran out of time.
	ErrTooComplex = errors.New("the page took too long to read with this selector")

	errHas     = errors.New("the CSS selector uses :has, which Timely cannot read")
	errComplex = errors.New("the CSS selector is too complex: keep :not() to simple selectors")
)

// selectBudget caps the time one Select spends matching.
var selectBudget = 5 * time.Second

// step is one compound selector and the combinator before it: ' ', '>',
// '+', '~', or 0 for the first.
type step struct {
	comb byte
	sel  cascadia.Sel
}

type part struct {
	comb byte
	text string
}

// plan splits a selector cascadia accepted into chains of compound
// selectors, one chain per comma-separated selector.
func plan(css string) ([][]step, error) {
	groups, err := split(css)
	if err != nil {
		return nil, err
	}
	out := make([][]step, 0, len(groups))
	for _, g := range groups {
		chain := make([]step, 0, len(g))
		for _, p := range g {
			sel, err := cascadia.Parse(p.text)
			// A part that still parses as a combined selector was split
			// wrongly; matching it would bring back the backtracking.
			if err != nil || fmt.Sprintf("%T", sel) == "cascadia.combinedSelector" {
				return nil, errComplex
			}
			chain = append(chain, step{comb: p.comb, sel: sel})
		}
		if len(chain) == 0 {
			return nil, errComplex
		}
		out = append(out, chain)
	}
	return out, nil
}

// split cuts css at its top-level combinators and commas, the way cascadia
// reads it: strings, [attributes], (arguments), escapes and comments are
// kept whole.
func split(css string) ([][]part, error) {
	var groups [][]part
	var cur []part
	var buf strings.Builder
	comb := byte(0)
	flush := func() {
		if buf.Len() > 0 {
			cur = append(cur, part{comb: comb, text: buf.String()})
			buf.Reset()
			comb = 0
		}
	}
	space := func() {
		flush()
		if len(cur) > 0 && comb == 0 {
			comb = ' '
		}
	}
	for i := 0; i < len(css); {
		c := css[i]
		switch {
		case c == '\\':
			j := escapeEnd(css, i)
			buf.WriteString(css[i:j])
			i = j
		case c == '"' || c == '\'':
			j := quoteEnd(css, i)
			buf.WriteString(css[i:j])
			i = j
		case c == '[':
			j := closeEnd(css, i, '[', ']')
			buf.WriteString(css[i:j])
			i = j
		case c == '(':
			name := pseudoName(buf.String())
			var j int
			if name == "matches" || name == "matchesown" {
				j = regexEnd(css, i)
			} else {
				j = closeEnd(css, i, '(', ')')
			}
			if err := checkArg(name, css[i+1:max(i+1, j-1)]); err != nil {
				return nil, err
			}
			buf.WriteString(css[i:j])
			i = j
		case c == '/' && strings.HasPrefix(css[i:], "/*"):
			end := strings.Index(css[i+2:], "*/")
			if end < 0 {
				return nil, errComplex
			}
			space()
			i += end + 4
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f':
			space()
			i++
		case c == '>' || c == '+' || c == '~':
			flush()
			comb = c
			i++
		case c == ',':
			flush()
			groups = append(groups, cur)
			cur, comb = nil, 0
			i++
		default:
			buf.WriteByte(c)
			i++
		}
	}
	flush()
	if len(cur) > 0 {
		groups = append(groups, cur)
	}
	return groups, nil
}

// checkArg refuses the pseudo-class arguments that would make matching one
// element expensive: :has walks a subtree, and a combinator inside :not
// backtracks.
func checkArg(name, arg string) error {
	switch name {
	case "has", "haschild":
		return errHas
	case "not":
		groups, err := split(arg)
		if err != nil {
			return err
		}
		for _, g := range groups {
			if len(g) != 1 {
				return errComplex
			}
		}
	}
	return nil
}

// pseudoName is the pseudo-class whose "(" follows text: the name after the
// last ':'.
func pseudoName(text string) string {
	i := strings.LastIndexByte(text, ':')
	if i < 0 {
		return ""
	}
	return strings.ToLower(text[i+1:])
}

// escapeEnd is the index after the CSS escape at s[i]: up to six hex digits
// and one space, or one character.
func escapeEnd(s string, i int) int {
	j := i + 1
	for n := 0; n < 6 && j < len(s) && isHex(s[j]); n++ {
		j++
	}
	switch {
	case j > i+1:
		if j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r' || s[j] == '\f') {
			j++
		}
	case j < len(s):
		j++
	}
	return j
}

func isHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

// quoteEnd is the index after the string that starts at s[i].
func quoteEnd(s string, i int) int {
	for j := i + 1; j < len(s); j++ {
		switch s[j] {
		case '\\':
			j++
		case s[i]:
			return j + 1
		}
	}
	return len(s)
}

// closeEnd is the index after the bracket that closes the one at s[i].
func closeEnd(s string, i int, open, close byte) int {
	depth := 0
	for j := i; j < len(s); {
		switch c := s[j]; {
		case c == '\\':
			j = escapeEnd(s, j)
			continue
		case c == '"' || c == '\'':
			j = quoteEnd(s, j)
			continue
		case c == open:
			depth++
		case c == close:
			depth--
			if depth == 0 {
				return j + 1
			}
		}
		j++
	}
	return len(s)
}

// regexEnd is the index after the ")" that closes a :matches regex, which
// cascadia finds by counting brackets alone.
func regexEnd(s string, i int) int {
	open := 0
	for j := i + 1; j < len(s); j++ {
		switch s[j] {
		case '(', '[':
			open++
		case ')', ']':
			open--
			if open < 0 {
				return j + 1
			}
		}
	}
	return len(s)
}

// budget stops a match that runs past its deadline. It reads the clock
// every few nodes; one compound match costs at most one pass over the page.
type budget struct {
	until time.Time
	n     int
}

func newBudget() *budget { return &budget{until: time.Now().Add(selectBudget)} }

func (b *budget) spend() error {
	b.n++
	if b.n%16 == 0 && time.Now().After(b.until) {
		return ErrTooComplex
	}
	return nil
}

// walk visits root's subtree in document order without recursion: enter on
// the way down, leave (if set) on the way back up.
func walk(root *html.Node, b *budget, enter, leave func(*html.Node)) error {
	n := root
	for {
		if err := b.spend(); err != nil {
			return err
		}
		enter(n)
		if n.FirstChild != nil {
			n = n.FirstChild
			continue
		}
		for {
			if leave != nil {
				leave(n)
			}
			if n == root {
				return nil
			}
			if n.NextSibling != nil {
				n = n.NextSibling
				break
			}
			n = n.Parent
		}
	}
}

// matchAll returns the elements under doc that any chain matches, in
// document order.
func matchAll(doc *html.Node, chains [][]step, b *budget) ([]*html.Node, error) {
	all := map[*html.Node]bool{}
	for _, chain := range chains {
		set, err := matchChain(doc, chain, b)
		if err != nil {
			return nil, err
		}
		for n := range set {
			all[n] = true
		}
	}
	var out []*html.Node
	err := walk(doc, b, func(n *html.Node) {
		if all[n] {
			out = append(out, n)
		}
	}, nil)
	return out, err
}

// matchChain matches one chain: the first compound on every element, then
// each combinator as one pass that keeps the elements standing in that
// relation to the previous set.
func matchChain(doc *html.Node, chain []step, b *budget) (map[*html.Node]bool, error) {
	set := map[*html.Node]bool{}
	is := func(n *html.Node) bool { return n.Type == html.ElementNode }
	first := chain[0].sel
	if err := walk(doc, b, func(n *html.Node) {
		if is(n) && first.Match(n) {
			set[n] = true
		}
	}, nil); err != nil {
		return nil, err
	}
	for _, st := range chain[1:] {
		if len(set) == 0 {
			return set, nil
		}
		prev, next := set, map[*html.Node]bool{}
		var enter, leave func(*html.Node)
		switch st.comb {
		case ' ':
			inside := 0
			enter = func(n *html.Node) {
				if is(n) && inside > 0 && st.sel.Match(n) {
					next[n] = true
				}
				if prev[n] {
					inside++
				}
			}
			leave = func(n *html.Node) {
				if prev[n] {
					inside--
				}
			}
		case '>':
			enter = func(n *html.Node) {
				if is(n) && n.Parent != nil && prev[n.Parent] && st.sel.Match(n) {
					next[n] = true
				}
			}
		case '+':
			enter = func(n *html.Node) {
				if !is(n) {
					return
				}
				s := n.PrevSibling
				for s != nil && !is(s) {
					s = s.PrevSibling
				}
				if s != nil && prev[s] && st.sel.Match(n) {
					next[n] = true
				}
			}
		case '~':
			// The parents under which an element of prev came already.
			after := map[*html.Node]bool{}
			enter = func(n *html.Node) {
				if !is(n) || n.Parent == nil {
					return
				}
				if after[n.Parent] && st.sel.Match(n) {
					next[n] = true
				}
				if prev[n] {
					after[n.Parent] = true
				}
			}
		default:
			return nil, errComplex
		}
		if err := walk(doc, b, enter, leave); err != nil {
			return nil, err
		}
		set = next
	}
	return set, nil
}
