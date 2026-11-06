// Package fetch reads one web address for a Bot, politely and safely. It
// knows nothing about Bots: it keeps to public addresses (netguard),
// honours robots.txt, spaces requests to one site through a Spacer, sends
// conditional GETs, caps bodies, and sorts every failure into a typed error
// the caller can act on (see ADR 0021).
package fetch

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/publicsuffix"

	"timely-api/internal/buildinfo"
	"timely-api/internal/netguard"
)

// Want is what the caller expects the address to hold.
type Want string

const (
	WantPage Want = "page"
	WantFeed Want = "feed"
	WantJSON Want = "json"
)

type Request struct {
	URL  string
	Want Want
	// The validators from the last read. They are sent only when
	// ValidatorsURL == URL, so an edited address never gets a stale 304.
	ETag, LastModified, ValidatorsURL string
	// IgnoreRobots skips robots.txt. It is false everywhere; only a
	// price.Source registry entry may set it.
	IgnoreRobots bool
}

type Response struct {
	FinalURL     string
	Status       int
	ContentType  string
	Body         []byte
	ETag         string
	LastModified string
	NotModified  bool
	FetchedAt    time.Time
}

// Spacer hands out request slots per site, shared across processes. It
// returns *SiteBusyError when the next slot is more than maxWait away.
type Spacer interface {
	Reserve(ctx context.Context, site string, gap, maxWait time.Duration, now time.Time) (slot time.Time, err error)
}

// RobotsCache keeps robots.txt answers per origin (scheme://host:port).
// Status 0 means the site gave no answer.
type RobotsCache interface {
	RobotsGet(ctx context.Context, origin string, now time.Time) (status int, body string, ok bool, err error)
	RobotsPut(ctx context.Context, origin string, status int, body string, now time.Time, ttl time.Duration) error
}

type Config struct {
	// Client defaults to a netguard client (public addresses, ports 80 and
	// 443, no proxy, 4 redirects). Tests swap in a fake transport.
	Client *http.Client
	// Spacer and Robots may be nil in tests: no spacing, no cache.
	Spacer    Spacer
	Robots    RobotsCache
	UserAgent string // default UserAgent()
	Now       func() time.Time
	Sleep     func(context.Context, time.Duration) error
	// SiteGap is the least time between two requests to one site, and
	// SiteMaxWait the longest a Get waits for its slot. Default 10s and 20s.
	SiteGap, SiteMaxWait time.Duration
}

type Fetcher struct{ cfg Config }

func New(c Config) *Fetcher {
	if c.Client == nil {
		c.Client = netguard.NewClient(netguard.Options{
			Timeout:       20 * time.Second,
			DialTimeout:   5 * time.Second,
			HeaderTimeout: 10 * time.Second,
			MaxRedirects:  4,
			Ports:         []string{"80", "443"},
		})
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Sleep == nil {
		c.Sleep = sleep
	}
	if c.SiteGap <= 0 {
		c.SiteGap = 10 * time.Second
	}
	if c.SiteMaxWait <= 0 {
		c.SiteMaxWait = 20 * time.Second
	}
	return &Fetcher{cfg: c}
}

// UserAgent names Timely and where to read about it.
func UserAgent() string {
	return "Timely/" + buildinfo.Version + " (+https://github.com/thalhath2234/timely-app)"
}

// Accept lists every type a Bot can read, so a site that negotiates sends
// one of them.
const accept = "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/feed+json,application/json;q=0.9,*/*;q=0.1"

// MaxBody is the most Get reads for w, counted after decompression.
func MaxBody(w Want) int64 {
	switch w {
	case WantPage:
		return 5 << 20
	case WantFeed:
		return 2 << 20
	}
	return 1 << 20
}

// Site is the registrable domain requests are spaced by, so shop.example.com
// and www.example.com share a slot. An IP or unknown suffix is the host.
func Site(u *url.URL) string {
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if _, err := netip.ParseAddr(host); err == nil {
		return host
	}
	if site, err := publicsuffix.EffectiveTLDPlusOne(host); err == nil {
		return site
	}
	return host
}

// ParseRetryAfter reads a Retry-After header, delta-seconds or an HTTP date,
// clamped to [30s, 6h]. It is 0 when the header is absent or unreadable.
func ParseRetryAfter(v string, now time.Time) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	var d time.Duration
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		if n < 0 {
			return 0
		}
		d = time.Duration(min(n, int64(6*time.Hour/time.Second))) * time.Second
	} else if t, err := http.ParseTime(v); err == nil {
		d = t.Sub(now)
	} else {
		return 0
	}
	return min(max(d, 30*time.Second), 6*time.Hour)
}

// Get reads r.URL. Every failure is one of the errors in errors.go, the
// caller's ctx error, or an error from the Spacer or RobotsCache.
func (f *Fetcher) Get(ctx context.Context, r Request) (*Response, error) {
	if r.Want != WantPage && r.Want != WantFeed && r.Want != WantJSON {
		return nil, ErrUnsupported
	}
	u, err := url.Parse(r.URL)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	if err := netguard.CheckURL(u); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	gap := f.cfg.SiteGap
	if !r.IgnoreRobots {
		rules, err := f.robotsFor(ctx, u)
		if err != nil {
			return nil, err
		}
		if !rules.Allowed(robotsPath(u)) {
			return nil, ErrRobots
		}
		gap = max(gap, rules.crawlDelay)
	}
	if err := f.wait(ctx, Site(u), gap); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	// No Accept-Encoding: the transport then asks for gzip itself and
	// decodes it, so the size cap counts decoded bytes.
	req.Header.Set("User-Agent", f.userAgent())
	req.Header.Set("Accept", accept)
	if r.ValidatorsURL == r.URL {
		if r.ETag != "" {
			req.Header.Set("If-None-Match", r.ETag)
		}
		if r.LastModified != "" {
			req.Header.Set("If-Modified-Since", r.LastModified)
		}
	}
	res, err := f.cfg.Client.Do(req)
	if err != nil {
		if res != nil && ctx.Err() == nil && !errors.Is(err, netguard.ErrBlocked) {
			// A redirect the client would not follow (too many, or not http).
			return nil, &StatusError{Status: res.StatusCode}
		}
		return nil, transportError(ctx, err)
	}
	defer func() { _ = res.Body.Close() }()

	out := &Response{
		FinalURL:     res.Request.URL.String(),
		Status:       res.StatusCode,
		ContentType:  res.Header.Get("Content-Type"),
		ETag:         res.Header.Get("ETag"),
		LastModified: res.Header.Get("Last-Modified"),
	}
	if res.StatusCode == http.StatusNotModified {
		out.NotModified, out.FetchedAt = true, f.cfg.Now()
		return out, nil
	}
	limit := MaxBody(r.Want)
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, transportError(ctx, err)
	}
	if int64(len(body)) > limit {
		if res.StatusCode < 400 {
			return nil, ErrTooBig
		}
		body = body[:limit] // an error page only needs reading for a robot check
	}
	out.Body, out.FetchedAt = body, f.cfg.Now()

	if err := looksBlocked(res.StatusCode, out.FinalURL, body); err != nil {
		return nil, err
	}
	switch s := res.StatusCode; {
	case s == http.StatusNotFound || s == http.StatusGone:
		return nil, ErrNotFound
	case s == http.StatusForbidden:
		return nil, ErrForbidden
	case s == http.StatusTooManyRequests || s == http.StatusServiceUnavailable:
		return nil, &RateLimitedError{Status: s, RetryAfter: ParseRetryAfter(res.Header.Get("Retry-After"), f.cfg.Now())}
	case s >= 400:
		return nil, &StatusError{Status: s}
	}
	if !wanted(r.Want, out.ContentType, body) {
		return nil, ErrUnsupported
	}
	return out, nil
}

// wait reserves the next slot for site and sleeps until it. A busy site's
// *SiteBusyError comes back unchanged.
func (f *Fetcher) wait(ctx context.Context, site string, gap time.Duration) error {
	if f.cfg.Spacer == nil {
		return nil
	}
	now := f.cfg.Now()
	slot, err := f.cfg.Spacer.Reserve(ctx, site, gap, f.cfg.SiteMaxWait, now)
	if err != nil {
		return err
	}
	if d := slot.Sub(now); d > 0 {
		if err := f.cfg.Sleep(ctx, d); err != nil {
			return transportError(ctx, err)
		}
	}
	return nil
}

func (f *Fetcher) userAgent() string {
	if f.cfg.UserAgent != "" {
		return f.cfg.UserAgent
	}
	return UserAgent()
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

var jsonFeedVersion = regexp.MustCompile(`"version"\s*:\s*"https://jsonfeed\.org`)

// sniff names what the first 512 bytes look like: page, feed, json or "".
// Markup goes by whichever tag comes first.
func sniff(body []byte) Want {
	head := bytes.TrimPrefix(body[:min(len(body), 512)], []byte("\xef\xbb\xbf"))
	lower := bytes.ToLower(bytes.TrimSpace(head))
	if jsonFeedVersion.Match(lower) {
		return WantFeed
	}
	if bytes.HasPrefix(lower, []byte("{")) || bytes.HasPrefix(lower, []byte("[")) {
		return WantJSON
	}
	page, feed := firstOf(lower, "<html", "<!doctype html"), firstOf(lower, "<rss", "<feed", "<rdf:rdf")
	switch {
	case feed >= 0 && (page < 0 || feed < page):
		return WantFeed
	case page >= 0:
		return WantPage
	}
	return ""
}

func firstOf(s []byte, subs ...string) int {
	first := -1
	for _, sub := range subs {
		if i := bytes.Index(s, []byte(sub)); i >= 0 && (first < 0 || i < first) {
			first = i
		}
	}
	return first
}

// wanted checks the answer against w: a type that says what it is decides,
// and a generic or wrong-looking one is sniffed.
func wanted(w Want, contentType string, body []byte) bool {
	mt, _, _ := mime.ParseMediaType(contentType)
	switch w {
	case WantPage:
		switch mt {
		case "text/html", "application/xhtml+xml", "text/plain":
			return true
		}
	case WantFeed:
		switch mt {
		case "application/rss+xml", "application/atom+xml", "application/rdf+xml", "application/feed+json":
			return true
		}
	case WantJSON:
		if mt == "application/json" || mt == "text/json" || strings.HasSuffix(mt, "+json") {
			return true
		}
	default:
		return false
	}
	return sniff(body) == w
}
