package extract

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/utils"
)

func TestTextArticle(t *testing.T) {
	got, err := Text(fixture(t, "article.html"), "text/html; charset=utf-8")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{
		"City opens new library",
		"The central library opened its doors on Saturday, with room for 400 readers.",
		"Entry is free for residents.",
		"Children's hours start at 10.",
	}, "\n")
	if got != want {
		t.Fatalf("Text =\n%s\nwant\n%s", got, want)
	}
	for _, gone := range []string{"Daily Example", "Sport", "dataLayer", "font-family", "JavaScript", "comment template", "chart label", "Most read", "newsletter", "Privacy", "renderComments"} {
		if strings.Contains(got, gone) {
			t.Errorf("Text kept %q", gone)
		}
	}
}

func TestTextClipsAt64KB(t *testing.T) {
	page := fixture(t, "article.html")
	long := "<p>" + strings.Repeat("word ", 20000) + "</p></main>"
	page = bytes.Replace(page, []byte("</main>"), []byte(long), 1)
	got, err := Text(page, "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) > MaxText+len("…") || !strings.HasSuffix(got, "…") {
		t.Fatalf("len = %d, suffix %q; want clipped at %d", len(got), got[len(got)-8:], MaxText)
	}
	if !strings.HasPrefix(got, "City opens new library") {
		t.Fatalf("clip lost the start: %q", got[:40])
	}
}

func TestTextEmpty(t *testing.T) {
	for _, page := range []string{
		"",
		"<html><head><title>Only a title</title></head><body>  </body></html>",
		"<html><body><nav>Menu</nav><script>app()</script><footer>©</footer></body></html>",
	} {
		if _, err := Text([]byte(page), "text/html"); !errors.Is(err, ErrEmpty) {
			t.Errorf("Text(%q) err = %v, want ErrEmpty", page, err)
		}
	}
}

func TestTextStorable(t *testing.T) {
	got, err := Text([]byte("<p>a\x00b</p><p>\xff\xfe c</p>"), "text/html; charset=utf-8")
	if err != nil {
		t.Fatal(err)
	}
	if got != utils.StorableText(got, MaxText) || strings.ContainsRune(got, 0) {
		t.Fatalf("Text gave unstorable %q", got)
	}
}

func TestDecodeLatin1(t *testing.T) {
	body := fixture(t, "latin1.html")
	got, err := Text(body, "text/html")
	if err != nil {
		t.Fatal(err)
	}
	want := "Café et crème brûlée\nLe gâteau du jour coûte 4,50 € – naïve recette."
	if got != want {
		t.Fatalf("Text = %q, want %q", got, want)
	}
	// A charset in the header wins over the guess.
	d, err := Decode([]byte("caf\xe9"), "text/plain; charset=iso-8859-1")
	if err != nil || string(d) != "café" {
		t.Fatalf("Decode = %q, %v", d, err)
	}
}

func TestDecodeKeepsUndeclaredUTF8(t *testing.T) {
	// The first 1 KB is plain ASCII, so the meta prescan finds nothing and
	// the html package would guess windows-1252.
	body := []byte("<html><body><p>" + strings.Repeat("a", 2000) + "</p><p>₹27,499</p></body></html>")
	got, err := Text(body, "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(got, "₹27,499") {
		t.Fatalf("Text ends %q", got[len(got)-20:])
	}
}

func TestSelect(t *testing.T) {
	page := fixture(t, "selector.html")
	cases := []struct {
		css, want string
	}{
		{"#openings .status", "Open\nClosed"},
		{"tr.job:first-child td.title", "Backend engineer"},
		// A selector may pick the site's furniture on purpose.
		{"footer", "Site status: fine"},
		// Nested matches are read once.
		{".banner", "Hiring in Pune"},
	}
	for _, c := range cases {
		got, err := Select(page, "text/html", c.css)
		if err != nil {
			t.Fatalf("%s: %v", c.css, err)
		}
		if got != c.want {
			t.Errorf("Select(%q) = %q, want %q", c.css, got, c.want)
		}
	}
	if _, err := Select(page, "text/html", ".salary"); !errors.Is(err, ErrEmpty) {
		t.Fatalf("no match err = %v, want ErrEmpty", err)
	}
	if _, err := Select(page, "text/html", "div[unclosed"); err == nil || errors.Is(err, ErrEmpty) {
		t.Fatalf("bad selector err = %v", err)
	}
}

func TestValidSelector(t *testing.T) {
	for _, ok := range []string{".price", "#main > span.amount", "div:nth-child(2) a[href^='/p/']", "h1, h2"} {
		if err := ValidSelector(ok); err != nil {
			t.Errorf("ValidSelector(%q) = %v", ok, err)
		}
	}
	for _, bad := range []string{"", "   ", "div[", "p::before", ">>>", "." + strings.Repeat("a", MaxSelector)} {
		if err := ValidSelector(bad); err == nil {
			t.Errorf("ValidSelector(%q) = nil, want an error", bad)
		}
	}
}

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  a \n\t b  ", "a b"},
		{"Posted 5 minutes ago by Ana", "Posted by Ana"},
		{"an hour ago · 3 hrs ago · 2d ago · just now", "· · ·"},
		{"Updated 06 Nov 2026, 09:14 IST — all good", "— all good"},
		{"Last updated: Friday, November 6, 2026 at 9:14 a.m. ok", "ok"},
		{"Updated 5 minutes ago", ""},
		{"Doors open 09:30, close 17:45:10 PM", "Doors open , close"},
		{"Price 27,499", "Price 27,499"},
	}
	for _, c := range cases {
		if got := Normalize(c.in); got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNoisyPageHashIsStable(t *testing.T) {
	page := fixture(t, "noisy.html")
	a, err := Text(page, "text/html")
	if err != nil {
		t.Fatal(err)
	}
	moved := strings.NewReplacer("5 minutes ago", "2 hours ago", "09:14", "11:52", "06 Nov 2026", "07 Nov 2026").Replace(string(page))
	b, err := Text([]byte(moved), "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("the edit did not change the text")
	}
	if Hash(a) != Hash(b) {
		t.Fatalf("Hash moved:\n%q\n%q", Normalize(a), Normalize(b))
	}
	changed := strings.Replace(moved, "Dashboard: operational", "Dashboard: degraded", 1)
	c, _ := Text([]byte(changed), "text/html")
	if Hash(c) == Hash(a) {
		t.Fatal("a real change kept the same Hash")
	}
	if len(Hash(a)) != 64 {
		t.Fatalf("Hash = %q, want 64 hex characters", Hash(a))
	}
}

func TestSelectPrice(t *testing.T) {
	page := []byte(`<html><body>
<p class="a">Now ₹499 <s>₹999</s></p>
<p class="b"><del>₹999</del> ₹499</p>
<p class="c"><span class="strike">$20</span> $15 <small>Save $5</small></p>
<s class="d">₹999</s>
<p class="e"><del>₹999</del></p>
<p class="f">Out of stock</p>
</body></html>`)
	cases := []struct {
		css    string
		amount float64
		err    error
	}{
		{"p.a", 499, nil},
		{"p.b", 499, nil},
		{"p.c", 15, nil},
		// A part that is only a crossed-out price still reads it.
		{"s.d", 999, nil},
		{"p.e", 999, nil},
		{"p.f", 0, ErrEmpty},
		{"p.none", 0, ErrEmpty},
	}
	for _, c := range cases {
		amount, _, err := SelectPrice(page, "text/html", c.css)
		if !errors.Is(err, c.err) || amount != c.amount {
			t.Errorf("%s: %v %v, want %v %v", c.css, amount, err, c.amount, c.err)
		}
	}
}
