package fetch

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"timely-api/internal/netguard"
)

// reply is one canned answer from fakeNet.
type reply struct {
	status int
	header http.Header
	body   string
	err    error
}

// fakeNet answers requests by full URL. A robots.txt with no reply is a 404,
// so tests that do not care about robots are allowed everything.
type fakeNet struct {
	mu       sync.Mutex
	replies  map[string]reply
	requests []*http.Request
}

func newNet(replies map[string]reply) *fakeNet { return &fakeNet{replies: replies} }

func (n *fakeNet) RoundTrip(r *http.Request) (*http.Response, error) {
	n.mu.Lock()
	n.requests = append(n.requests, r)
	rep, ok := n.replies[r.URL.String()]
	n.mu.Unlock()
	if !ok {
		rep = reply{status: http.StatusNotFound}
	}
	if rep.err != nil {
		return nil, rep.err
	}
	h := rep.header
	if h == nil {
		h = http.Header{}
	}
	return &http.Response{StatusCode: rep.status, Header: h, Body: io.NopCloser(strings.NewReader(rep.body)), Request: r}, nil
}

func (n *fakeNet) count(rawURL string) int {
	n.mu.Lock()
	defer n.mu.Unlock()
	c := 0
	for _, r := range n.requests {
		if r.URL.String() == rawURL {
			c++
		}
	}
	return c
}

func (n *fakeNet) last(rawURL string) *http.Request {
	n.mu.Lock()
	defer n.mu.Unlock()
	for i := len(n.requests) - 1; i >= 0; i-- {
		if n.requests[i].URL.String() == rawURL {
			return n.requests[i]
		}
	}
	return nil
}

var testNow = time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)

// newFetcher keeps netguard's redirect check and swaps the transport.
func newFetcher(n http.RoundTripper, c Config) *Fetcher {
	client := netguard.NewClient(netguard.Options{Timeout: time.Second, MaxRedirects: 4, Ports: []string{"80", "443"}})
	client.Transport = n
	c.Client = client
	if c.Now == nil {
		c.Now = func() time.Time { return testNow }
	}
	if c.Sleep == nil {
		c.Sleep = func(context.Context, time.Duration) error { return nil }
	}
	return New(c)
}

func html(body string) reply {
	return reply{status: 200, header: http.Header{"Content-Type": {"text/html; charset=utf-8"}}, body: body}
}

const page = "https://shop.example/p/1"

func TestHeaders(t *testing.T) {
	n := newNet(map[string]reply{page: html("<html><body>hi</body></html>")})
	res, err := newFetcher(n, Config{}).Get(context.Background(), Request{URL: page, Want: WantPage})
	if err != nil {
		t.Fatal(err)
	}
	if string(res.Body) != "<html><body>hi</body></html>" || res.FinalURL != page || res.Status != 200 || !res.FetchedAt.Equal(testNow) {
		t.Errorf("response = %+v", res)
	}
	r := n.last(page)
	if ua := r.Header.Get("User-Agent"); !strings.HasPrefix(ua, "Timely/") || !strings.Contains(ua, "github.com/thalhath2234/timely-app") {
		t.Errorf("User-Agent = %q", ua)
	}
	if acc := r.Header.Get("Accept"); !strings.Contains(acc, "text/html") || !strings.Contains(acc, "application/rss+xml") || !strings.Contains(acc, "application/json") {
		t.Errorf("Accept = %q", acc)
	}
	if r.Header.Get("Accept-Encoding") != "" {
		t.Error("Accept-Encoding must be left to the transport")
	}
	if got := n.last("https://shop.example/robots.txt").Header.Get("User-Agent"); !strings.HasPrefix(got, "Timely/") {
		t.Errorf("robots.txt User-Agent = %q", got)
	}
}

func TestConditionalGet(t *testing.T) {
	n := newNet(map[string]reply{page: {status: http.StatusNotModified, header: http.Header{"Etag": {`"v2"`}}}})
	f := newFetcher(n, Config{})
	res, err := f.Get(context.Background(), Request{URL: page, Want: WantPage, ETag: `"v1"`, LastModified: "Wed, 04 Nov 2026 10:00:00 GMT", ValidatorsURL: page})
	if err != nil {
		t.Fatal(err)
	}
	if !res.NotModified || res.Status != 304 || res.ETag != `"v2"` {
		t.Errorf("response = %+v", res)
	}
	r := n.last(page)
	if r.Header.Get("If-None-Match") != `"v1"` || r.Header.Get("If-Modified-Since") != "Wed, 04 Nov 2026 10:00:00 GMT" {
		t.Errorf("validators not sent: %v", r.Header)
	}

	n.replies[page] = html("<html>new</html>")
	if _, err := f.Get(context.Background(), Request{URL: page, Want: WantPage, ETag: `"v1"`, LastModified: "x", ValidatorsURL: "https://shop.example/p/old"}); err != nil {
		t.Fatal(err)
	}
	r = n.last(page)
	if r.Header.Get("If-None-Match") != "" || r.Header.Get("If-Modified-Since") != "" {
		t.Errorf("validators for another address were sent: %v", r.Header)
	}
}

func TestBodyCap(t *testing.T) {
	limit := MaxBody(WantJSON)
	n := newNet(map[string]reply{
		"https://api.example/big": {status: 200, header: http.Header{"Content-Type": {"application/json"}}, body: "[" + strings.Repeat(" ", int(limit)) + "]"},
		"https://api.example/fit": {status: 200, header: http.Header{"Content-Type": {"application/json"}}, body: "[" + strings.Repeat(" ", int(limit)-2) + "]"},
	})
	f := newFetcher(n, Config{})
	if _, err := f.Get(context.Background(), Request{URL: "https://api.example/big", Want: WantJSON}); !errors.Is(err, ErrTooBig) {
		t.Errorf("MaxBody+1: got %v, want ErrTooBig", err)
	}
	if _, err := f.Get(context.Background(), Request{URL: "https://api.example/fit", Want: WantJSON}); err != nil {
		t.Errorf("MaxBody exactly: %v", err)
	}
	if MaxBody(WantPage) != 5<<20 || MaxBody(WantFeed) != 2<<20 || limit != 1<<20 {
		t.Error("MaxBody sizes changed")
	}
}

func TestStatuses(t *testing.T) {
	robotCheck, err := os.ReadFile("testdata/amazon_robot_check.html")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		reply reply
		check func(error) bool
	}{
		{"429 with seconds", reply{status: 429, header: http.Header{"Retry-After": {"120"}}}, func(err error) bool {
			var rl *RateLimitedError
			return errors.As(err, &rl) && rl.Status == 429 && rl.RetryAfter == 120*time.Second
		}},
		{"429 with a date", reply{status: 429, header: http.Header{"Retry-After": {testNow.Add(10 * time.Minute).Format(http.TimeFormat)}}}, func(err error) bool {
			var rl *RateLimitedError
			return errors.As(err, &rl) && rl.RetryAfter == 10*time.Minute
		}},
		{"503 captcha", reply{status: 503, body: `<form action="/errors/validateCaptcha">`}, func(err error) bool { return errors.Is(err, ErrCaptcha) }},
		{"200 robot check", reply{status: 200, header: http.Header{"Content-Type": {"text/html"}}, body: string(robotCheck)}, func(err error) bool { return errors.Is(err, ErrCaptcha) }},
		{"403 challenge", reply{status: 403, body: `<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>`}, func(err error) bool { return errors.Is(err, ErrCaptcha) }},
		{"plain 503", reply{status: 503, body: "down for maintenance"}, func(err error) bool {
			var rl *RateLimitedError
			return errors.As(err, &rl) && rl.Status == 503 && rl.RetryAfter == 0
		}},
		{"404", reply{status: 404}, func(err error) bool { return errors.Is(err, ErrNotFound) }},
		{"410", reply{status: 410}, func(err error) bool { return errors.Is(err, ErrNotFound) }},
		{"403", reply{status: 403, body: "no"}, func(err error) bool { return errors.Is(err, ErrForbidden) }},
		{"500", reply{status: 500}, func(err error) bool {
			var se *StatusError
			return errors.As(err, &se) && se.Status == 500
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			n := newNet(map[string]reply{page: c.reply})
			_, err := newFetcher(n, Config{}).Get(context.Background(), Request{URL: page, Want: WantPage})
			if !c.check(err) {
				t.Errorf("got %v (%T)", err, err)
			}
		})
	}
}

func TestOrdinaryPageWithACaptchaWidget(t *testing.T) {
	body := `<html><body><h1>Phone</h1><span class="price">₹27,499</span><div class="g-recaptcha" data-sitekey="x"></div>` +
		`<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`
	n := newNet(map[string]reply{page: html(body)})
	if _, err := newFetcher(n, Config{}).Get(context.Background(), Request{URL: page, Want: WantPage}); err != nil {
		t.Errorf("a 200 page with a reCAPTCHA form is not a robot check: %v", err)
	}
}

func TestTypeSniffing(t *testing.T) {
	rss, err := os.ReadFile("testdata/rss2.xml")
	if err != nil {
		t.Fatal(err)
	}
	const feed = "https://blog.example/feed"
	n := newNet(map[string]reply{feed: {status: 200, header: http.Header{"Content-Type": {"application/octet-stream"}}, body: string(rss)}})
	f := newFetcher(n, Config{})
	if _, err := f.Get(context.Background(), Request{URL: feed, Want: WantFeed}); err != nil {
		t.Errorf("RSS served as octet-stream: %v", err)
	}
	n.replies[feed] = html("<!doctype html><html><body>blog</body></html>")
	if _, err := f.Get(context.Background(), Request{URL: feed, Want: WantFeed}); !errors.Is(err, ErrUnsupported) {
		t.Errorf("HTML for a feed: got %v, want ErrUnsupported", err)
	}

	for _, c := range []struct {
		want Want
		ct   string
		body string
		ok   bool
	}{
		{WantPage, "text/html", "anything", true},
		{WantPage, "", "<!DOCTYPE html><html>", true},
		{WantPage, "application/json", `{"a":1}`, false},
		{WantPage, "image/png", "\x89PNG", false},
		{WantFeed, "application/atom+xml", "", true},
		{WantFeed, "text/xml; charset=utf-8", `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">`, true},
		{WantFeed, "application/xml", `<?xml version="1.0"?><rdf:RDF xmlns:rdf="x">`, true},
		{WantFeed, "application/json", `{"version": "https://jsonfeed.org/version/1.1", "items": []}`, true},
		{WantFeed, "application/json", `{"a":1}`, false},
		{WantFeed, "text/xml", `<?xml version="1.0"?><sitemap/>`, false},
		{WantJSON, "application/json; charset=utf-8", "", true},
		{WantJSON, "application/vnd.api+json", "", true},
		{WantJSON, "text/plain", ` [1,2]`, true},
		{WantJSON, "text/html", "<html><body>Sorry</body></html>", false},
		{"other", "text/html", "<html>", false},
	} {
		if got := wanted(c.want, c.ct, []byte(c.body)); got != c.ok {
			t.Errorf("wanted(%s, %q, %.30q) = %v, want %v", c.want, c.ct, c.body, got, c.ok)
		}
	}
}

func TestRedirects(t *testing.T) {
	n := newNet(map[string]reply{
		page:                           {status: 302, header: http.Header{"Location": {"http://example.com:8080/"}}},
		"https://shop.example/loop":    {status: 302, header: http.Header{"Location": {"https://shop.example/loop"}}},
		"https://shop.example/moved":   {status: 301, header: http.Header{"Location": {"https://www.shop.example/p/1"}}},
		"https://www.shop.example/p/1": html("<html>moved</html>"),
	})
	f := newFetcher(n, Config{})
	if _, err := f.Get(context.Background(), Request{URL: page, Want: WantPage}); !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("redirect to port 8080: got %v, want ErrBlockedAddress", err)
	}
	var se *StatusError
	if _, err := f.Get(context.Background(), Request{URL: "https://shop.example/loop", Want: WantPage}); !errors.As(err, &se) || se.Status != 302 {
		t.Errorf("redirect loop: got %v, want StatusError 302", err)
	}
	res, err := f.Get(context.Background(), Request{URL: "https://shop.example/moved", Want: WantPage})
	if err != nil || res.FinalURL != "https://www.shop.example/p/1" {
		t.Errorf("plain redirect: %v %+v", err, res)
	}
}

func TestRefusedAddresses(t *testing.T) {
	f := newFetcher(newNet(nil), Config{})
	for _, raw := range []string{"ftp://shop.example/", "http://shop.example:8080/", "http://user:pw@shop.example/", "://"} {
		if _, err := f.Get(context.Background(), Request{URL: raw, Want: WantPage}); !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("%s: got %v, want ErrBlockedAddress", raw, err)
		}
	}
}

func TestTransportErrors(t *testing.T) {
	for _, c := range []struct {
		name string
		err  error
		want error
	}{
		{"timeout", &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}, ErrOffline},
		{"cut-off body", io.ErrUnexpectedEOF, ErrOffline},
		{"refused", &net.OpError{Op: "dial", Net: "tcp", Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}, ErrOffline},
		{"dns temporary", &net.DNSError{Err: "server misbehaving", Name: "shop.example", IsTemporary: true}, ErrOffline},
		{"blocked", &net.OpError{Op: "dial", Net: "tcp", Err: netguard.ErrBlocked}, ErrBlockedAddress},
	} {
		t.Run(c.name, func(t *testing.T) {
			n := newNet(map[string]reply{page: {err: c.err}})
			if _, err := newFetcher(n, Config{}).Get(context.Background(), Request{URL: page, Want: WantPage}); !errors.Is(err, c.want) {
				t.Errorf("got %v, want %v", err, c.want)
			}
		})
	}

	n := newNet(map[string]reply{page: {err: &net.DNSError{Err: "no such host", Name: "shop.example", IsNotFound: true}}})
	if _, err := newFetcher(n, Config{}).Get(context.Background(), Request{URL: page, Want: WantPage}); err == nil || errors.Is(err, ErrOffline) {
		t.Errorf("a name that does not exist is not offline: %v", err)
	}
}

func TestCancelledIsNotOffline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	n := newNet(nil)
	f := newFetcher(n, Config{Spacer: &fakeSpacer{after: 5 * time.Second}, Sleep: func(context.Context, time.Duration) error {
		cancel()
		return context.Canceled
	}})
	_, err := f.Get(ctx, Request{URL: page, Want: WantPage, IgnoreRobots: true})
	if !errors.Is(err, context.Canceled) || errors.Is(err, ErrOffline) {
		t.Errorf("got %v, want context.Canceled", err)
	}
}

// fakeSpacer hands out a slot `after` from now, or err, and records gaps.
type fakeSpacer struct {
	mu    sync.Mutex
	after time.Duration
	err   error
	sites []string
	gaps  []time.Duration
}

func (s *fakeSpacer) Reserve(_ context.Context, site string, gap, maxWait time.Duration, now time.Time) (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sites, s.gaps = append(s.sites, site), append(s.gaps, gap)
	if maxWait != 20*time.Second {
		return time.Time{}, errors.New("unexpected maxWait")
	}
	if s.err != nil {
		return time.Time{}, s.err
	}
	return now.Add(s.after), nil
}

func TestSpacing(t *testing.T) {
	spacer := &fakeSpacer{after: 5 * time.Second}
	var slept []time.Duration
	n := newNet(map[string]reply{page: html("<html>ok</html>")})
	f := newFetcher(n, Config{Spacer: spacer, Sleep: func(_ context.Context, d time.Duration) error {
		slept = append(slept, d)
		return nil
	}})
	if _, err := f.Get(context.Background(), Request{URL: page, Want: WantPage, IgnoreRobots: true}); err != nil {
		t.Fatal(err)
	}
	if len(slept) != 1 || slept[0] != 5*time.Second {
		t.Errorf("slept %v, want [5s]", slept)
	}
	if len(spacer.gaps) != 1 || spacer.gaps[0] != 10*time.Second || spacer.sites[0] != "shop.example" {
		t.Errorf("reserved %v %v", spacer.sites, spacer.gaps)
	}

	busy := &SiteBusyError{Until: testNow.Add(time.Minute)}
	f = newFetcher(n, Config{Spacer: &fakeSpacer{err: busy}})
	if _, err := f.Get(context.Background(), Request{URL: page, Want: WantPage, IgnoreRobots: true}); err != busy {
		t.Errorf("got %v, want the Spacer's SiteBusyError unchanged", err)
	}
	if n.count(page) != 1 {
		t.Error("a busy site must not be fetched")
	}
}

// TestGzipThroughATransport uses a real http.Transport, dialled to a local
// server, so the transport's own gzip handling is what is tested.
func TestGzipThroughATransport(t *testing.T) {
	big := strings.Repeat("a", int(MaxBody(WantJSON))+1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept-Encoding") != "gzip" {
			t.Errorf("Accept-Encoding = %q, want the transport's gzip", r.Header.Get("Accept-Encoding"))
		}
		body := `{"price": 27499}`
		if r.URL.Path == "/big" {
			body = `"` + big + `"`
		}
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		_, _ = zw.Write([]byte(body))
		_ = zw.Close()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Encoding", "gzip")
		_, _ = w.Write(buf.Bytes())
	}))
	defer srv.Close()
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}}
	defer transport.CloseIdleConnections()
	f := New(Config{Client: &http.Client{Transport: transport, Timeout: 5 * time.Second}})

	res, err := f.Get(context.Background(), Request{URL: "http://api.example/small", Want: WantJSON, IgnoreRobots: true})
	if err != nil {
		t.Fatal(err)
	}
	if string(res.Body) != `{"price": 27499}` {
		t.Errorf("body = %q, want it decoded", res.Body)
	}
	if _, err := f.Get(context.Background(), Request{URL: "http://api.example/big", Want: WantJSON, IgnoreRobots: true}); !errors.Is(err, ErrTooBig) {
		t.Errorf("a small gzip body that decodes past the cap: got %v, want ErrTooBig", err)
	}
}

func TestParseRetryAfter(t *testing.T) {
	for _, c := range []struct {
		in   string
		want time.Duration
	}{
		{"", 0},
		{"soon", 0},
		{"-5", 0},
		{"0", 30 * time.Second},
		{"120", 2 * time.Minute},
		{" 600 ", 10 * time.Minute},
		{"999999999999", 6 * time.Hour},
		{testNow.Add(90 * time.Minute).Format(http.TimeFormat), 90 * time.Minute},
		{testNow.Add(-time.Hour).Format(http.TimeFormat), 30 * time.Second},
		{testNow.Add(48 * time.Hour).Format(http.TimeFormat), 6 * time.Hour},
	} {
		if got := ParseRetryAfter(c.in, testNow); got != c.want {
			t.Errorf("ParseRetryAfter(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestSite(t *testing.T) {
	for raw, want := range map[string]string{
		"https://www.amazon.in/dp/B0":         "amazon.in",
		"https://shop.example.co.uk/x":        "example.co.uk",
		"https://WWW.Example.COM./":           "example.com",
		"https://query1.finance.yahoo.com/v8": "yahoo.com",
		"http://93.184.216.34/":               "93.184.216.34",
		"http://[2606:2800:220:1::1]/":        "2606:2800:220:1::1",
		"http://localhost/":                   "localhost",
	} {
		u, _ := url.Parse(raw)
		if got := Site(u); got != want {
			t.Errorf("Site(%s) = %q, want %q", raw, got, want)
		}
	}
}

func TestUserAgent(t *testing.T) {
	if ua := UserAgent(); !strings.HasPrefix(ua, "Timely/") || !strings.HasSuffix(ua, "(+https://github.com/thalhath2234/timely-app)") {
		t.Errorf("UserAgent() = %q", ua)
	}
}
