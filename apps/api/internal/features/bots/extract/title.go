package extract

import (
	"cmp"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// MaxTitle caps a page title, in characters.
const MaxTitle = 120

// titleMaxSteps bounds the JSON-LD nodes PageTitle visits.
const titleMaxSteps = 10_000

// PageTitle is the name a page gives itself: the JSON-LD name of its
// Product, else og:title, else <title>. Whitespace is collapsed and the
// result clipped to MaxTitle characters; a page with none gives "".
func PageTitle(body []byte, contentType string) string {
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return ""
	}
	var ld []string
	var og, title string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		// An SVG's <title> names a drawing, not the page: only HTML elements count.
		if n.Type == html.ElementNode && n.Namespace == "" {
			switch n.DataAtom {
			case atom.Script:
				if t, _, _ := strings.Cut(strings.ToLower(attr(n, "type")), ";"); strings.TrimSpace(t) == "application/ld+json" {
					ld = append(ld, innerText(n))
				}
				return
			case atom.Meta:
				if og == "" && strings.EqualFold(cmp.Or(attr(n, "property"), attr(n, "name")), "og:title") {
					og = cleanTitle(attr(n, "content"))
				}
			case atom.Title:
				if title == "" {
					title = cleanTitle(innerText(n))
				}
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	for _, raw := range ld {
		if v, ok := decodeLD(raw); ok {
			steps := 0
			if name := productName(v, 0, &steps); name != "" {
				return name
			}
		}
	}
	if og != "" {
		return og
	}
	return title
}

// productName is the cleaned name of the first Product under v.
func productName(v any, depth int, steps *int) string {
	if depth > ldMaxDepth || *steps >= titleMaxSteps {
		return ""
	}
	*steps++
	switch t := v.(type) {
	case []any:
		for _, c := range t {
			if name := productName(c, depth+1, steps); name != "" {
				return name
			}
		}
	case map[string]any:
		if isType(t, "Product", "IndividualProduct", "ProductModel", "ProductGroup") {
			if name := cleanTitle(ldString(t["name"])); name != "" {
				return name
			}
		}
		if g, ok := t["@graph"]; ok {
			if name := productName(g, depth+1, steps); name != "" {
				return name
			}
		}
		for _, k := range sortedKeys(t) {
			if k == "@graph" {
				continue
			}
			if name := productName(t[k], depth+1, steps); name != "" {
				return name
			}
		}
	}
	return ""
}

// cleanTitle collapses whitespace and clips to MaxTitle characters, ending
// in "…" when cut.
func cleanTitle(s string) string {
	s = strings.Join(strings.Fields(strings.ToValidUTF8(s, "")), " ")
	if utf8.RuneCountInString(s) <= MaxTitle {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:MaxTitle-1])) + "…"
}
