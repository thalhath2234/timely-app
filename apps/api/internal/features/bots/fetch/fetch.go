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
	"sync"
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
	// WantIcon is a site's logo: PNG, ICO, JPEG, GIF or WebP. SVG is
	// refused, since it can carry script and needs a renderer to redraw.
	WantIcon Want = "icon"
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
	// Header holds extra request headers, such as a price source's API key.
	// They go only to URL itself: never to robots.txt, and never on to a
	// redirect target. The fetcher's own headers win over them.
	Header http.Header
	// MaxWait, when above zero, replaces Config.SiteMaxWait for this read:
	// the longest it waits for its site's slot before *SiteBusyError. A
	// preview waits less than a check. A slot right after one this read
	// booked itself is allowed that booking's gap on top (see ownSlots).
	MaxWait time.Duration
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

// acceptIcon lists the logo types Timely redraws, and leaves SVG out.
const acceptIcon = "image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1"

// MaxBody is the most Get reads for w, counted after decompression.
func MaxBody(w Want) int64 {
	switch w {
	case WantPage:
		return 5 << 20
	case WantFeed:
		return 2 << 20
	case WantIcon:
		return 64 << 10
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
	if r.Want != WantPage && r.Want != WantFeed && r.Want != WantJSON && r.Want != WantIcon {
		return nil, ErrUnsupported
	}
	u, err := url.Parse(r.URL)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	if err := netguard.CheckURL(u); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	own := slotsFor(ctx)
	gap := f.cfg.SiteGap
	if !r.IgnoreRobots {
		rules, err := f.robotsFor(ctx, u, r.MaxWait, own)
		if err != nil {
			return nil, err
		}
		if !rules.Allowed(robotsPath(u)) {
			return nil, ErrRobots
		}
		gap = max(gap, rules.crawlDelay)
	}
	if err := f.wait(ctx, Site(u), gap, r.MaxWait, own); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	for k, vs := range r.Header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	// No Accept-Encoding: the transport then asks for gzip itself and
	// decodes it, so the size cap counts decoded bytes.
	req.Header.Del("Accept-Encoding")
	req.Header.Set("User-Agent", f.userAgent())
	if r.Want == WantIcon {
		req.Header.Set("Accept", acceptIcon)
	} else {
		req.Header.Set("Accept", accept)
	}
	if r.ValidatorsURL == r.URL {
		if r.ETag != "" {
			req.Header.Set("If-None-Match", r.ETag)
		}
		if r.LastModified != "" {
			req.Header.Set("If-Modified-Since", r.LastModified)
		}
	}
	res, err := f.client(r, own).Do(req)
	if err != nil {
		var hop *hopError
		if errors.As(err, &hop) && ctx.Err() == nil {
			return nil, hop.err
		}
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

// wait reserves the next slot for site, gap before the one after, and
// sleeps until it. maxWait above zero overrides Config.SiteMaxWait, widened
// by own (see ownSlots.allow). A busy site's *SiteBusyError comes back
// unchanged.
func (f *Fetcher) wait(ctx context.Context, site string, gap, maxWait time.Duration, own *ownSlots) error {
	if f.cfg.Spacer == nil {
		return nil
	}
	now := f.cfg.Now()
	if maxWait = own.allow(site, maxWait, now); maxWait <= 0 {
		maxWait = f.cfg.SiteMaxWait
	}
	slot, err := f.cfg.Spacer.Reserve(ctx, site, gap, maxWait, now)
	if err != nil {
		return err
	}
	own.booked(site, slot, gap)
	if d := slot.Sub(now); d > 0 {
		if err := f.cfg.Sleep(ctx, d); err != nil {
			return transportError(ctx, err)
		}
	}
	return nil
}

// ownSlots is, per site, when the spacing after the latest slot booked here
// ends: one Get's bookings (its robots.txt, its page, a redirect's
// robots.txt), or every Get under one ShareSlots ctx or one Slots. Each
// booking is slept until before the request, so the next slot on that site
// is at most that spacing away: the wait for it is the reads' own spacing,
// not another check on the site.
type ownSlots struct {
	mu    sync.Mutex
	until map[string]time.Time
}

// Slots is a set of bookings that reads made at different times count as
// their own, such as one person's previews a few seconds apart (WithSlots).
type Slots = ownSlots

// NewSlots is an empty Slots.
func NewSlots() *Slots { return &ownSlots{until: map[string]time.Time{}} }

type sharedSlotsKey struct{}

// ShareSlots returns a ctx whose Gets count one another's bookings as their
// own (see ownSlots), so reads made one after another, such as a preview's
// watches on one site, do not take their own spacing for a busy site.
func ShareSlots(ctx context.Context) context.Context {
	if _, ok := ctx.Value(sharedSlotsKey{}).(*ownSlots); ok {
		return ctx
	}
	return WithSlots(ctx, NewSlots())
}

// WithSlots returns a ctx whose Gets book into slots and count its earlier
// bookings as their own.
func WithSlots(ctx context.Context, slots *Slots) context.Context {
	return context.WithValue(ctx, sharedSlotsKey{}, slots)
}

// slotsFor is ctx's shared bookings, or a new set for one Get.
func slotsFor(ctx context.Context) *ownSlots {
	if o, ok := ctx.Value(sharedSlotsKey{}).(*ownSlots); ok {
		return o
	}
	return NewSlots()
}

// allow is maxWait for site: a short wait (above zero) on a site booked
// here also allows what is left of that booking's spacing. The default wait
// (0) is left alone; Config.SiteMaxWait already allows a gap.
func (o *ownSlots) allow(site string, maxWait time.Duration, now time.Time) time.Duration {
	if maxWait <= 0 {
		return maxWait
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if left := o.until[site].Sub(now); left > 0 {
		return maxWait + left
	}
	return maxWait
}

func (o *ownSlots) booked(site string, slot time.Time, gap time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if end := slot.Add(gap); end.After(o.until[site]) {
		o.until[site] = end
	}
}

// Idle is whether every spacing booked here ended before now.
func (o *ownSlots) Idle(now time.Time) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, end := range o.until {
		if end.After(now) {
			return false
		}
	}
	return true
}

// client is the configured client with a redirect check for r: extra
// headers are stripped before any hop, and each hop is vetted like the
// first address (see follow), with the slots r's Get has booked.
func (f *Fetcher) client(r Request, own *ownSlots) *http.Client {
	c := *f.cfg.Client
	next := c.CheckRedirect
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		for k := range r.Header {
			req.Header.Del(k)
		}
		if next != nil {
			if err := next(req, via); err != nil {
				return err
			}
		} else if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return f.follow(req, via[len(via)-1].URL, r, own)
	}
	return &c
}

// hopError is a redirect that Get refuses for the same reasons it refuses
// a first address; Get returns err itself.
type hopError struct{ err error }

func (e *hopError) Error() string { return e.err.Error() }
func (e *hopError) Unwrap() error { return e.err }

// follow vets a redirect hop: robots.txt for the new address, and a slot
// for its site when the hop leaves the previous one, so a redirect can skip
// neither (ADR 0021). A hop to another origin on the same site, such as
// apex to www or http to https, reads that origin's robots.txt in the slot
// right after this read's own request, which own allows for.
func (f *Fetcher) follow(req *http.Request, prev *url.URL, r Request, own *ownSlots) error {
	gap := f.cfg.SiteGap
	if !r.IgnoreRobots {
		rules, err := f.robotsFor(req.Context(), req.URL, r.MaxWait, own)
		if err != nil {
			return &hopError{err: err}
		}
		if !rules.Allowed(robotsPath(req.URL)) {
			return &hopError{err: ErrRobots}
		}
		gap = max(gap, rules.crawlDelay)
	}
	if site := Site(req.URL); site != Site(prev) {
		if err := f.wait(req.Context(), site, gap, r.MaxWait, own); err != nil {
			return &hopError{err: err}
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

// imageMagic reports whether body starts like a PNG, ICO, JPEG, GIF or WebP.
func imageMagic(body []byte) bool {
	for _, m := range [][]byte{[]byte("\x89PNG\r\n\x1a\n"), {0, 0, 1, 0}, {0xff, 0xd8, 0xff}, []byte("GIF87a"), []byte("GIF89a")} {
		if bytes.HasPrefix(body, m) {
			return true
		}
	}
	return len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "WEBP"
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
	case WantIcon:
		// A named image type decides; anything else (octet-stream, a
		// missing type) must start like one of the images Timely reads.
		switch mt {
		case "image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/jpeg", "image/gif", "image/webp":
			return true
		case "image/svg+xml":
			return false
		}
		return mt != "text/html" && imageMagic(body)
	default:
		return false
	}
	return sniff(body) == w
}
