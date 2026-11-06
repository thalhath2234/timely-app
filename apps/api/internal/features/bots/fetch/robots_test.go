package fetch

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"
)

func TestParseRobots(t *testing.T) {
	const body = `# Made up, in the shape of a shop's robots.txt
User-agent: *
Disallow: /cart
Allow: /cart/share
Disallow: /*?session=
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: Googlebot
User-agent: Timely/1.0
Disallow: /search
Allow: /search/about
Disallow: /dp/*/reviews
Crawl-delay: 30

User-agent: timely
Disallow: /private   # merged with the group above
`
	timely := parseRobots(body, "timely")
	if timely.crawlDelay != 30*time.Second {
		t.Errorf("crawl delay = %v, want 30s", timely.crawlDelay)
	}
	other := parseRobots(body, "somebot")
	if other.crawlDelay != 2*time.Second {
		t.Errorf("* crawl delay = %v, want 2s", other.crawlDelay)
	}
	for _, c := range []struct {
		g    robotsGroup
		path string
		ok   bool
	}{
		// The timely group replaces *, so /cart is allowed for Timely.
		{timely, "/cart", true},
		{timely, "/search", false},
		{timely, "/search?q=phone", false},
		{timely, "/search/about", true}, // the longer Allow wins
		{timely, "/dp/B0/reviews", false},
		{timely, "/dp/B0", true},
		{timely, "/private/x", false},
		{other, "/cart", false},
		{other, "/cart/share", true},
		{other, "/p?session=abc", false},
		{other, "/files/a.pdf", false},
		{other, "/files/a.pdf?x=1", true}, // $ anchors the end
		{other, "/search", true},
		{robotsGroup{}, "/anything", true},
	} {
		if got := c.g.Allowed(c.path); got != c.ok {
			t.Errorf("Allowed(%q) = %v, want %v", c.path, got, c.ok)
		}
	}

	tie := parseRobots("User-agent: *\nDisallow: /page\nAllow: /page\n", "timely")
	if !tie.Allowed("/page") {
		t.Error("Allow must win a tie")
	}
	empty := parseRobots("User-agent: *\nDisallow:\n", "timely")
	if !empty.Allowed("/") {
		t.Error("an empty Disallow allows everything")
	}
	if parseRobots("User-agent: *\nCrawl-delay: 600\n", "timely").crawlDelay != time.Minute {
		t.Error("Crawl-delay must be capped at 60s")
	}
}

func TestMatchRobots(t *testing.T) {
	for _, c := range []struct {
		pattern, path string
		ok            bool
	}{
		{"/", "/", true},
		{"/fish", "/fish.html", true},
		{"/fish", "/Fish", false},
		{"/fish$", "/fish", true},
		{"/fish$", "/fish/", false},
		{"/*.php", "/index.php", true},
		{"/*.php", "/a/b.php?x", true},
		{"/*.php$", "/a/b.php?x", false},
		{"/a*b*c", "/a-b-c", true},
		{"/a*b*c", "/a-c-b", false},
		{"/a*c$", "/abcc", true},
		{"*", "/x", true},
		{"fish", "/fish", false}, // a pattern matches from the start of the path
	} {
		if got := matchRobots(c.pattern, c.path); got != c.ok {
			t.Errorf("matchRobots(%q, %q) = %v, want %v", c.pattern, c.path, got, c.ok)
		}
	}
}

// memRobots is an in-memory RobotsCache that records what was stored.
type memRobots struct {
	mu      sync.Mutex
	entries map[string]memEntry
	gets    int
}

type memEntry struct {
	status    int
	body      string
	expiresAt time.Time
}

func (m *memRobots) RobotsGet(_ context.Context, origin string, now time.Time) (int, string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gets++
	e, ok := m.entries[origin]
	if !ok || !e.expiresAt.After(now) {
		return 0, "", false, nil
	}
	return e.status, e.body, true, nil
}

func (m *memRobots) RobotsPut(_ context.Context, origin string, status int, body string, now time.Time, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries == nil {
		m.entries = map[string]memEntry{}
	}
	m.entries[origin] = memEntry{status: status, body: body, expiresAt: now.Add(ttl)}
	return nil
}

const robotsURL = "https://shop.example/robots.txt"

func TestRobotsAnswers(t *testing.T) {
	for _, c := range []struct {
		name    string
		robots  reply
		want    error
		ttl     time.Duration
		cached  bool
		fetched bool
	}{
		{"404 allows", reply{status: 404}, nil, 24 * time.Hour, true, true},
		{"401 allows", reply{status: 401}, nil, 24 * time.Hour, true, true},
		{"500 refuses", reply{status: 500}, ErrRobots, time.Hour, true, false},
		{"429 refuses", reply{status: 429}, ErrRobots, time.Hour, true, false},
		{"no answer refuses", reply{err: errors.New("remote error: tls: handshake failure")}, ErrRobots, time.Hour, true, false},
		{"disallowed", reply{status: 200, body: "User-agent: *\nDisallow: /p/\n"}, ErrRobots, 24 * time.Hour, true, false},
		{"allowed", reply{status: 200, body: "User-agent: *\nDisallow: /cart\n"}, nil, 24 * time.Hour, true, true},
		{"our own outage is offline", reply{err: &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}}, ErrOffline, 0, false, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			n := newNet(map[string]reply{robotsURL: c.robots, page: html("<html>ok</html>")})
			cache := &memRobots{}
			_, err := newFetcher(n, Config{Robots: cache}).Get(context.Background(), Request{URL: page, Want: WantPage})
			if c.want == nil && err != nil || c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("got %v, want %v", err, c.want)
			}
			e, ok := cache.entries["https://shop.example:443"]
			if ok != c.cached {
				t.Fatalf("cached = %v, want %v", ok, c.cached)
			}
			if ok && !e.expiresAt.Equal(testNow.Add(c.ttl)) {
				t.Errorf("cached until %v, want now+%v", e.expiresAt, c.ttl)
			}
			if got := n.count(page) == 1; got != c.fetched {
				t.Errorf("page fetched = %v, want %v", got, c.fetched)
			}
		})
	}
}

func TestRobotsIgnored(t *testing.T) {
	n := newNet(map[string]reply{robotsURL: {status: 200, body: "User-agent: *\nDisallow: /\n"}, page: html("<html>ok</html>")})
	if _, err := newFetcher(n, Config{}).Get(context.Background(), Request{URL: page, Want: WantPage, IgnoreRobots: true}); err != nil {
		t.Fatal(err)
	}
	if n.count(robotsURL) != 0 {
		t.Error("IgnoreRobots must not read robots.txt")
	}
}

func TestRobotsCacheAndCrawlDelay(t *testing.T) {
	n := newNet(map[string]reply{
		robotsURL: {status: 200, body: "User-agent: timely\nCrawl-delay: 30\nDisallow: /cart\n"},
		page:      html("<html>ok</html>"),
	})
	cache, spacer := &memRobots{}, &fakeSpacer{}
	f := newFetcher(n, Config{Robots: cache, Spacer: spacer})
	for range 2 {
		if _, err := f.Get(context.Background(), Request{URL: page, Want: WantPage}); err != nil {
			t.Fatal(err)
		}
	}
	if got := n.count(robotsURL); got != 1 {
		t.Errorf("robots.txt fetched %d times, want 1", got)
	}
	if cache.gets != 2 {
		t.Errorf("cache read %d times, want 2", cache.gets)
	}
	// The robots fetch is spaced at the site gap; both page fetches at the crawl delay.
	want := []time.Duration{10 * time.Second, 30 * time.Second, 30 * time.Second}
	if len(spacer.gaps) != len(want) {
		t.Fatalf("gaps = %v, want %v", spacer.gaps, want)
	}
	for i := range want {
		if spacer.gaps[i] != want[i] {
			t.Errorf("gaps = %v, want %v", spacer.gaps, want)
		}
	}
}

func TestRobotsRedirectsAndOrigins(t *testing.T) {
	n := newNet(map[string]reply{
		"http://shop.example/robots.txt":   {status: 301, header: http.Header{"Location": {"https://shop.example/robots.txt"}}},
		robotsURL:                          {status: 200, body: "User-agent: *\nDisallow: /p/\n"},
		"http://shop.example/p/1":          html("<html>ok</html>"),
		"https://other.example/robots.txt": {status: 302, header: http.Header{"Location": {"http://other.example:8080/robots.txt"}}},
		"https://other.example/a":          html("<html>ok</html>"),
	})
	cache := &memRobots{}
	f := newFetcher(n, Config{Robots: cache})
	if _, err := f.Get(context.Background(), Request{URL: "http://shop.example/p/1", Want: WantPage}); !errors.Is(err, ErrRobots) {
		t.Errorf("redirected robots.txt: got %v, want ErrRobots", err)
	}
	if _, ok := cache.entries["http://shop.example:80"]; !ok {
		t.Errorf("cache keys = %v, want http://shop.example:80", cache.entries)
	}
	// A robots.txt redirect that cannot be followed is an unavailable file.
	if _, err := f.Get(context.Background(), Request{URL: "https://other.example/a", Want: WantPage}); err != nil {
		t.Errorf("unfollowable robots.txt redirect: %v", err)
	}
}

func TestRobotsCancelledIsNotCached(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	n := newNet(nil)
	cache := &memRobots{}
	f := newFetcher(n, Config{Robots: cache, Spacer: &fakeSpacer{after: time.Second}, Sleep: func(context.Context, time.Duration) error {
		cancel()
		return context.Canceled
	}})
	if _, err := f.Get(ctx, Request{URL: page, Want: WantPage}); !errors.Is(err, context.Canceled) {
		t.Errorf("got %v, want context.Canceled", err)
	}
	if len(cache.entries) != 0 {
		t.Error("a cancelled robots fetch must not be cached")
	}
}
