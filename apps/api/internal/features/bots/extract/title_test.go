package extract

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPageTitle(t *testing.T) {
	ld := func(s string) string { return `<script type="application/ld+json">` + s + `</script>` }
	cases := []struct {
		name, head, body, want string
	}{
		{"JSON-LD product name wins", ld(`{"@type":"Product","name":"Sony WH-1000XM6 Wireless","offers":{"price":"27499"}}`) +
			`<meta property="og:title" content="Buy Sony WH-1000XM6 | Shop"><title>Shop - Sony</title>`, "", "Sony WH-1000XM6 Wireless"},
		{"product in a graph", ld(`{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Page"},{"@type":"Product","name":"  Kettle\n  1.7 L "}]}`), "", "Kettle 1.7 L"},
		{"nested product", ld(`{"@type":"WebPage","name":"Not this","mainEntity":{"@type":["Thing","http://schema.org/Product"],"name":"Lamp"}}`), "", "Lamp"},
		{"broken JSON-LD falls back to og", ld(`{"@type":"Product","name":`) + `<meta property="og:title" content="Og name">`, "", "Og name"},
		{"product without a name falls back", ld(`{"@type":"Product","offers":{"price":"3"}}`) + `<title>Page &amp; title</title>`, "", "Page & title"},
		{"og:title as name attribute", `<meta name="og:title" content="By name"><title>Title</title>`, "", "By name"},
		{"title tag", `<title>
			Hello   world
		</title>`, "", "Hello world"},
		{"svg title is not the page's", "", `<svg><title>An icon</title></svg>`, ""},
		{"none", "", "<p>Just text</p>", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			page := "<html><head>" + c.head + "</head><body>" + c.body + "</body></html>"
			if got := PageTitle([]byte(page), "text/html; charset=utf-8"); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestPageTitleClips(t *testing.T) {
	long := strings.Repeat("ü", 200)
	got := PageTitle([]byte("<title>"+long+"</title>"), "text/html")
	if n := utf8.RuneCountInString(got); n != MaxTitle || !strings.HasSuffix(got, "…") {
		t.Fatalf("clipped to %d runes: %q", n, got)
	}
	if got := PageTitle(fixture(t, "product_jsonld.html"), "text/html"); got == "" {
		t.Fatal("a product page gave no title")
	}
}
