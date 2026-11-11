package chat

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// publicURL refuses this machine, private and tailnet addresses, local-only
// names and odd ports before anything is fetched.
func TestPublicURLRefusesLocalAndPrivateAddresses(t *testing.T) {
	for _, link := range []string{
		"http://127.0.0.1/", "http://10.0.0.8/admin", "http://192.168.1.20/", "http://172.16.4.1/", "http://169.254.169.254/latest/meta-data",
		"http://100.101.102.103/", "http://[::1]/", "http://[fd00::1]/", "http://0.0.0.0/", "http://localhost/", "http://api.localhost/",
		"http://nas.local/", "http://db.internal/", "http://box.tail1234.ts.net/", "http://printer/", "https://example.com:8443/",
		"ftp://example.com/", "file:///etc/passwd", "https://user:pw@example.com/",
	} {
		u, err := url.Parse(link)
		if err == nil && publicURL(u) == nil {
			t.Errorf("%s was allowed", link)
		}
	}
	for _, link := range []string{"https://example.com/", "http://news.example.org/a?b=c", "https://93.184.216.34/", "https://news.fixture.invalid/"} {
		u, _ := url.Parse(link)
		if err := publicURL(u); err != nil {
			t.Errorf("%s was refused: %v", link, err)
		}
	}
}

// FixtureFetcher serves only https://<name>.fixture.invalid pages from its
// folder, as readable text, and never a file outside it.
func TestFixtureFetcherServesOnlyFixturePages(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "shop", "items"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "shop", "index.html"), []byte("<title>Shop</title><nav>Menu</nav><p>Welcome</p><script>evil()</script>"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "shop", "items", "milk.txt"), []byte("Milk 1.10"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("secret"), 0o644)
	fetch := FixtureFetcher(dir)
	ctx := context.Background()
	page, err := fetch(ctx, "https://shop.fixture.invalid/")
	if err != nil || page.Title != "Shop" || !strings.Contains(page.Content, "Welcome") || strings.Contains(page.Content, "evil") || strings.Contains(page.Content, "Menu") {
		t.Fatalf("index: %+v %v", page, err)
	}
	if page, err := fetch(ctx, "https://shop.fixture.invalid/items/milk.txt"); err != nil || !strings.Contains(page.Content, "Milk 1.10") {
		t.Fatalf("text page: %+v %v", page, err)
	}
	for _, link := range []string{"https://shop.fixture.invalid/../secret.txt", "https://shop.fixture.invalid/%2e%2e/secret.txt", "http://shop.fixture.invalid/",
		"https://example.com/", "https://evil.example.fixture.invalid/", "https://shop.fixture.invalid/missing.html"} {
		if page, err := fetch(ctx, link); err == nil {
			t.Errorf("%s served %+v", link, page)
		}
	}
}

// A search answer's sources: url citations first, then the links its text
// names, each once, at most limit.
func TestSearchResultsListCitationsThenLinks(t *testing.T) {
	citation, _ := json.Marshal(map[string]any{"type": "url_citation", "url_citation": map[string]string{"url": "https://a.example.com/1", "title": "A", "content": "about a"}})
	answer := WireMessage{Content: "See [B](https://b.example.com/2), https://a.example.com/1 and https://c.example.com/3.", Annotations: []json.RawMessage{citation, json.RawMessage(`{"type":"other"}`)}}
	got := searchResults(answer, 0)
	want := []webResult{{URL: "https://a.example.com/1", Title: "A", Description: "about a"}, {URL: "https://b.example.com/2", Title: "B"}, {URL: "https://c.example.com/3"}}
	if !slices.Equal(got, want) {
		t.Fatalf("results %+v", got)
	}
	if got := searchResults(answer, 2); len(got) != 2 {
		t.Fatalf("limit 2 gave %d", len(got))
	}
}

// person_hosts are the sites the person typed (any spelling of a link or a
// bare name) and the sites their bots read, each once.
func TestFetchGuardHosts(t *testing.T) {
	g := &fetchGuard{typed: strings.ToLower("Look at https://www.Shop.example.org/p?x=1, news.example.com and NEWS.example.com.\nnot a host: v1.2"), known: map[string]bool{"https://feeds.example.net/rss": true}}
	got := g.hosts()
	want := []string{"feeds.example.net", "news.example.com", "shop.example.org"}
	if !slices.Equal(got, want) {
		t.Fatalf("hosts %v, want %v", got, want)
	}
}

// After taint, mayOpen allows a typed link (its path and query as typed), a
// search's exact results, a bot's page and the front page of a typed or
// searched site; any other path or query could carry the person's data.
func TestWebRunMayOpen(t *testing.T) {
	g := &fetchGuard{typed: "see typed.example.com/?q=mine and typed.example.com/docs/intro", known: map[string]bool{"https://bot.example.org/feed": true}}
	var w webRun
	w.seen("https://found.example.net/a?id=7")
	for link, want := range map[string]bool{
		"https://typed.example.com/":                     true,
		"https://typed.example.com":                      true,
		"https://typed.example.com/?q=mine":              true,
		"https://typed.example.com/docs/intro":           true,
		"https://typed.example.com/page":                 false,
		"https://typed.example.com/log/ivf-consult-okon": false,
		"https://typed.example.com/?q=secret":            false,
		"https://found.example.net/a?id=7":               true,
		"https://found.example.net/":                     true,
		"https://found.example.net/b":                    false,
		"https://found.example.net/b?q=secret":           false,
		"https://bot.example.org/feed":                   true,
		"https://attacker.example/":                      false,
	} {
		if got := w.mayOpen(g, link); got != want {
			t.Errorf("mayOpen(%s) = %v, want %v", link, got, want)
		}
	}
}

// After taint, a search query that names a site the person did not type
// and no search returned is refused: the provider's search could open it.
func TestWebRunSearchNamesOtherSite(t *testing.T) {
	g := &fetchGuard{typed: "what does news.example.com say", known: map[string]bool{}}
	var w webRun
	w.seen("https://found.example.net/a")
	for query, want := range map[string]string{
		"node.js streams tutorial":                     "",
		"news.example.com/today weather":               "",
		"site:found.example.net prices":                "",
		"https://evil.example/log/K48213977":           "evil.example",
		"site:evil.example passport":                   "evil.example",
		"read evil.example/ivf-consult-okonkwo for me": "evil.example",
		"open //www.Evil.example/x":                    "evil.example",
	} {
		if got := w.searchNamesOtherSite(g, query); got != want {
			t.Errorf("searchNamesOtherSite(%q) = %q, want %q", query, got, want)
		}
	}
}

// The gate allows the web tools only for a run with the web, and blocks
// everything else as in phase 2.
func TestGateVerdict(t *testing.T) {
	on := &toolRun{web: webRun{on: true}}
	off := &toolRun{}
	for _, tc := range []struct {
		run              *toolRun
		tool             string
		verdict, message string
	}{
		{on, "web_search", "allow", ""}, {on, "web_extract", "allow", ""}, {on, "browser_navigate", "block", gateBlocked},
		{off, "web_search", "block", webOff}, {off, "web_extract", "block", webOff}, {off, "terminal", "block", gateBlocked},
	} {
		if v, m := gateVerdict(tc.run, tc.tool); v != tc.verdict || m != tc.message {
			t.Errorf("%s (web %v): %s %q", tc.tool, tc.run.web.on, v, m)
		}
	}
}

// A run without the web never searches or reads pages through toolCall,
// whatever the worker sends.
func TestToolCallRefusesWebToolsWithoutTheWeb(t *testing.T) {
	s := &Service{}
	run := &toolRun{reads: map[string]string{}}
	for _, name := range []string{"web_search", "web_extract"} {
		result, outside, err := s.toolCall(context.Background(), &Conversation{}, run, name, json.RawMessage(`{"query":"x","urls":["https://example.com/"]}`), 1, nil)
		if err != nil || outside || !strings.Contains(string(result), "Unknown tool") {
			t.Fatalf("%s: %s %v %v", name, result, outside, err)
		}
	}
}
