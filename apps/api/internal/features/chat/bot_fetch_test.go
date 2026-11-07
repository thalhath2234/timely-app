package chat

import (
	"encoding/json"
	"testing"
)

// Before approval Timely reads only sites the person typed (with the query
// strings they typed) and addresses their bots already read, so a page or a
// search result cannot have it send their data to a site in an address.
func TestFetchGuard(t *testing.T) {
	g := &fetchGuard{
		typed: "watch https://books.toscrape.com/catalogue/a_1/index.html and www.shop.example/p?id=7 for me",
		known: map[string]bool{"https://news.example/feed?x=1": true},
	}
	for _, c := range []struct {
		url  string
		want bool
	}{
		{"https://books.toscrape.com/catalogue/a_1/index.html", true},
		{"https://books.toscrape.com/catalogue/other/index.html", true}, // another page on a site they gave
		{"https://shop.example/p?id=7", true},
		{"https://www.shop.example/p", true},
		{"https://shop.example/p?id=7&d=secret", false},
		{"https://toscrape.com/", false},
		{"https://attacker.example/?d=secret", false},
		{"https://notshop.example/", false},
		{"https://news.example/feed?x=1", true},
		{"not a url", false},
	} {
		if got := g.allowsURL(c.url); got != c.want {
			t.Errorf("%s: %v, want %v", c.url, got, c.want)
		}
	}
	if !g.allows(json.RawMessage(`[{"kind":"price","source":"crypto","symbol":"BTC"},{"kind":"feed","url":"https://news.example/feed?x=1"}]`)) {
		t.Error("a price watch and a bot's own feed")
	}
	if g.allows(json.RawMessage(`[{"kind":"page","url":"https://shop.example/p"},{"kind":"page","url":"https://evil.example/"}]`)) {
		t.Error("one address the person did not give refuses the read")
	}
}
