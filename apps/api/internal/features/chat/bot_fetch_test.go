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

// After outside text reached a run, preview_bot and a proposed bot's
// preview read only what web_extract would open: a path on a site the
// person typed could carry their data, so it is refused and never fetched.
func TestPreviewAfterTaintFollowsTheWebRule(t *testing.T) {
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
	c := &Conversation{Messages: []Message{{Role: "user", Content: "summarize evil.example/post for me"}}}
	call := func(run *toolRun, link string) string {
		args, _ := json.Marshal(map[string]any{"watches": []map[string]string{{"kind": "page", "url": link}}})
		result, _, _ := s.toolCall(context.Background(), c, run, "preview_bot", args, 1, nil)
		return string(result)
	}
	clean := &toolRun{catalog: agent.Catalog{"preview_bot": preview}, reads: map[string]string{}}
	if got := call(clean, "https://evil.example/t/jane-okafor-4512"); strings.Contains(got, "error") {
		t.Fatalf("a clean run's preview of a typed site: %s", got)
	}
	tainted := &toolRun{catalog: agent.Catalog{"preview_bot": preview}, reads: map[string]string{}, taintSeen: true}
	fetched = nil
	for _, link := range []string{"https://evil.example/t/jane-okafor-4512", "https://evil.example/?d=4512"} {
		if got := call(tainted, link); !strings.Contains(got, fetchRefusal) {
			t.Errorf("tainted preview of %s: %s", link, got)
		}
	}
	for _, link := range []string{"https://evil.example/post", "https://evil.example/"} {
		if got := call(tainted, link); strings.Contains(got, "error") {
			t.Errorf("tainted preview of %s (typed or front page): %s", link, got)
		}
	}
	if strings.Join(fetched, " ") != "https://evil.example/post https://evil.example/" {
		t.Fatalf("fetched %q", fetched)
	}
	// A proposed bot's preview follows the same rule.
	steps := []Step{{Tool: "create_bot", Arguments: json.RawMessage(`{"kind":"watch","watches":[{"kind":"page","url":"https://evil.example/t/jane-okafor-4512"}]}`)}}
	fetched = nil
	s.previewSteps(context.Background(), tainted.catalog, "u1", steps, s.runGuard(context.Background(), c, tainted))
	if len(fetched) != 0 || !strings.Contains(string(steps[0].Preview), "once you approve") {
		t.Fatalf("proposal preview after taint: fetched %q, preview %s", fetched, steps[0].Preview)
	}
}
