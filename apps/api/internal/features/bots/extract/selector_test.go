package extract

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
)

// The pass-per-combinator matcher finds exactly what cascadia finds.
func TestMatchAllAgreesWithCascadia(t *testing.T) {
	selectors := []string{
		"p", "#openings .status", "tr.job:first-child td.title", "footer", ".banner", "div p", "body > div",
		"table tr > td", "tr + tr", "tr ~ tr td", "h1 ~ p", "li:nth-child(2n+1)", "td:not(.title)",
		`[class~="job"] td`, "p, td.title", "*", "div  >  p", "div/* a comment */p", "td:contains(\"engineer\")",
		"tr:matches(^B)", "td:not(.status, .title)", "a[href^='https://'] + span", `.a\:b`, "section :empty",
	}
	for _, file := range []string{"selector.html", "article.html", "product_jsonld.html"} {
		doc, err := html.Parse(bytes.NewReader(fixture(t, file)))
		if err != nil {
			t.Fatal(err)
		}
		for _, css := range selectors {
			want := cascadia.MustCompile(css).MatchAll(doc)
			chains, err := compile(css)
			if err != nil {
				t.Fatalf("%s: %v", css, err)
			}
			got, err := matchAll(doc, chains, newBudget())
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(want) {
				t.Fatalf("%s on %s: %d matches, cascadia %d", css, file, len(got), len(want))
			}
			for i := range got {
				if got[i] != want[i] {
					t.Fatalf("%s on %s: match %d differs", css, file, i)
				}
			}
		}
	}
}

func TestValidSelectorRefusesCostlySelectors(t *testing.T) {
	for _, css := range []string{"div:has(p)", "div:haschild(p)", "li:HAS(span)", "td:not(tr td)", "p:not(a > b)", "p:not(.a:has(b))"} {
		if err := ValidSelector(css); err == nil {
			t.Errorf("%q was accepted", css)
		}
	}
	for _, css := range []string{"td:not(.title)", "#price .a-offscreen", "body > div:nth-child(3) > span", `[title="a b > c"] span`, ":not(a, b) ~ p"} {
		if err := ValidSelector(css); err != nil {
			t.Errorf("%q: %v", css, err)
		}
	}
}

// A deeply nested page with a selector that never matches its first part
// is linear work, not a backtracking search.
func TestSelectNestedPageIsFast(t *testing.T) {
	page := []byte("<html><body>" + strings.Repeat("<div>", 500) + "<p>deep</p>" + strings.Repeat("</div>", 500) + "</body></html>")
	for _, css := range []string{
		"x div div div div div div div p",
		"div:not(.a) div:not(.b) div div div span",
		"div > div div ~ div + div x",
	} {
		start := time.Now()
		if _, err := Select(page, "text/html", css); !errors.Is(err, ErrEmpty) {
			t.Fatalf("%s: %v", css, err)
		}
		if d := time.Since(start); d > time.Second {
			t.Fatalf("%s took %v", css, d)
		}
	}
	if got, err := Select(page, "text/html", "div div div p"); err != nil || got != "deep" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestSelectBudget(t *testing.T) {
	defer func(d time.Duration) { selectBudget = d }(selectBudget)
	selectBudget = 0
	page := []byte("<html><body>" + strings.Repeat("<p>x</p>", 100) + "</body></html>")
	if _, err := Select(page, "text/html", "p"); !errors.Is(err, ErrTooComplex) {
		t.Fatalf("got %v, want ErrTooComplex", err)
	}
}
