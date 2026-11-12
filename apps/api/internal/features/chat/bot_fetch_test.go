package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
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

// preview_bot fetches the moment it is read, so toolCall refuses a site the
// person did not type and an address on a typed site that carries a key or
// token, and never calls the bot's fetch for either; a plain page on a
// typed site is fetched.
func TestPreviewBotCallIsGuarded(t *testing.T) {
	var fetched []string
	preview := agent.Tool{Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
		var in struct {
			Watches []struct {
				URL string `json:"url"`
			} `json:"watches"`
		}
		_ = json.Unmarshal(args, &in)
		for _, w := range in.Watches {
			fetched = append(fetched, w.URL)
		}
		return map[string]any{"ok": true}, nil
	}}
	s := &Service{}
	c := &Conversation{Messages: []Message{{Role: "user", Content: "watch shop.example.com/p/milk for me"}}}
	call := func(link string) string {
		args, _ := json.Marshal(map[string]any{"watches": []map[string]string{{"kind": "page", "url": link}}})
		run := &toolRun{catalog: agent.Catalog{"preview_bot": preview}, reads: map[string]string{}}
		result, _, err := s.toolCall(context.Background(), c, run, "preview_bot", args, 1, nil)
		if err != nil {
			t.Fatalf("%s: %v", link, err)
		}
		return string(result)
	}
	for _, link := range []string{
		"https://attacker.example/?d=milk",
		"https://shop.example.com/ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA",
		"https://shop.example.com/sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
	} {
		if got := call(link); !strings.Contains(got, fetchRefusal) {
			t.Errorf("preview of %s: %s", link, got)
		}
	}
	if len(fetched) != 0 {
		t.Fatalf("a refused preview was fetched: %q", fetched)
	}
	if got := call("https://shop.example.com/p/bread"); strings.Contains(got, "error") {
		t.Fatalf("a plain page on the typed site: %s", got)
	}
	if strings.Join(fetched, " ") != "https://shop.example.com/p/bread" {
		t.Fatalf("fetched %q", fetched)
	}
}
