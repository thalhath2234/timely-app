package extract

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
)

// maxSelectorSteps caps how many elements a path from SelectorFor names.
const maxSelectorSteps = 6

var (
	// cssIdent is a class or id that needs no escaping.
	cssIdent = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]*$`)
	// generatedClass looks made by a build tool or a page's state, so it
	// may change on the next visit: long digit runs, CSS-in-JS prefixes,
	// is-/has- state classes.
	generatedClass = regexp.MustCompile(`\d{3,}|^(?:css|sc|jsx|svelte|emotion)-|^(?:is|has)-`)
	tagName        = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
)

// SelectorFor returns a CSS selector that Select resolves to n alone. The
// nearest of n and its ancestors with an id that is unique on the page
// anchors it ("#buy", "#buy span.price", or a child chain from "#buy");
// without one it is the shortest chain of tags and stable classes joined by
// ">", with :nth-of-type where siblings would match too. Every answer is
// checked by matching it on n's document. It gives "" when no path of at
// most six elements is unique.
func SelectorFor(n *html.Node) string {
	if n == nil || n.Type != html.ElementNode {
		return ""
	}
	root := n
	for root.Parent != nil {
		root = root.Parent
	}
	ids := idCounts(root)
	var chain []*html.Node // n, then its ancestors
	for cur := n; cur != nil && cur.Type == html.ElementNode && len(chain) < maxSelectorSteps; cur = cur.Parent {
		chain = append(chain, cur)
	}
	// The nearest element with a unique id anchors the path: a page
	// changes around its ids less than around its classes.
	for i, a := range chain {
		id := attr(a, "id")
		if !cssIdent.MatchString(id) || ids[id] != 1 {
			continue
		}
		if i == 0 {
			return "#" + id
		}
		for _, sel := range []string{"#" + id + " " + compound(n, false), "#" + id + " " + compound(n, true)} {
			if !strings.HasSuffix(sel, " ") && resolvesTo(root, sel, n) {
				return sel
			}
		}
		if sel := path(chain[:i+1], "#"+id); sel != "" && resolvesTo(root, sel, n) {
			return sel
		}
		break
	}
	for depth := 1; depth <= len(chain); depth++ {
		top := chain[depth-1]
		id := attr(top, "id")
		anchored := cssIdent.MatchString(id) && ids[id] == 1
		// Loose first, then with positions on n only, then on every step.
		for tight := range 3 {
			parts := make([]string, depth)
			ok := true
			for i := range depth {
				node := chain[i]
				if i == depth-1 && anchored {
					parts[depth-1-i] = "#" + id
					continue
				}
				c := compound(node, tight == 2 || (tight == 1 && i == 0))
				if c == "" {
					ok = false
					break
				}
				parts[depth-1-i] = c
			}
			if !ok {
				break
			}
			sel := strings.Join(parts, " > ")
			if resolvesTo(root, sel, n) {
				return sel
			}
			if anchored && depth == 1 {
				break
			}
		}
	}
	return ""
}

// path joins chain (n first, then its ancestors) into a child chain from
// its top, which is named top, with every step's position.
func path(chain []*html.Node, top string) string {
	parts := make([]string, len(chain))
	parts[0] = top
	for i := range len(chain) - 1 {
		c := compound(chain[i], true)
		if c == "" {
			return ""
		}
		parts[len(chain)-1-i] = c
	}
	return strings.Join(parts, " > ")
}

// compound names one element: its tag and up to three stable classes, and
// with nth its position among siblings of the same tag when it has any.
func compound(n *html.Node, nth bool) string {
	if !tagName.MatchString(n.Data) {
		return ""
	}
	var b strings.Builder
	b.WriteString(n.Data)
	classes := 0
	seen := map[string]bool{}
	for _, c := range strings.Fields(attr(n, "class")) {
		if classes == 3 || seen[c] || !cssIdent.MatchString(c) || generatedClass.MatchString(c) {
			continue
		}
		seen[c] = true
		classes++
		b.WriteString("." + c)
	}
	if nth {
		if at, of := typePosition(n); of > 1 {
			b.WriteString(":nth-of-type(" + strconv.Itoa(at) + ")")
		}
	}
	return b.String()
}

// typePosition is n's 1-based place among its parent's children of the same
// tag, and how many there are.
func typePosition(n *html.Node) (at, of int) {
	if n.Parent == nil {
		return 1, 1
	}
	for c := n.Parent.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && c.Data == n.Data {
			of++
			if c == n {
				at = of
			}
		}
	}
	return at, of
}

func idCounts(root *html.Node) map[string]int {
	ids := map[string]int{}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if id := attr(n, "id"); id != "" {
				ids[id]++
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return ids
}

// resolvesTo reports whether sel is a selector Select takes that matches
// exactly n on the document under root.
func resolvesTo(root *html.Node, sel string, n *html.Node) bool {
	if ValidSelector(sel) != nil {
		return false
	}
	m, err := cascadia.Compile(sel)
	if err != nil {
		return false
	}
	got := m.MatchAll(root)
	return len(got) == 1 && got[0] == n
}
