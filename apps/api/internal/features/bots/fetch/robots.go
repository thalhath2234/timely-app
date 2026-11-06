package fetch

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"timely-api/internal/utils"
)

const (
	robotsAgent    = "timely"
	robotsMaxBytes = 512 << 10
	robotsTTL      = 24 * time.Hour // after a 2xx or 4xx
	robotsRetryTTL = time.Hour      // after a 5xx or no answer
	maxCrawlDelay  = 60 * time.Second
)

type robotsRule struct {
	pattern string
	allow   bool
}

type robotsGroup struct {
	rules      []robotsRule
	crawlDelay time.Duration
}

// parseRobots reads the rules for agent (RFC 9309): every group naming the
// agent, merged, or else every "*" group. Crawl-delay is not in the RFC but
// is honoured when the chosen group sets it.
func parseRobots(body, agent string) robotsGroup {
	agent = strings.ToLower(agent)
	var named, star robotsGroup
	var hasNamed bool
	var forNamed, forStar, inAgents bool
	for _, line := range strings.Split(body, "\n") {
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key, value = strings.ToLower(strings.TrimSpace(key)), strings.TrimSpace(value)
		if key == "user-agent" {
			if !inAgents {
				forNamed, forStar, inAgents = false, false, true
			}
			token := strings.ToLower(value)
			if i := strings.IndexAny(token, "/ \t"); i >= 0 {
				token = token[:i]
			}
			switch token {
			case agent:
				forNamed, hasNamed = true, true
			case "*":
				forStar = true
			}
			continue
		}
		inAgents = false
		var groups []*robotsGroup
		if forNamed {
			groups = append(groups, &named)
		}
		if forStar {
			groups = append(groups, &star)
		}
		for _, g := range groups {
			switch key {
			case "allow", "disallow":
				if value != "" {
					g.rules = append(g.rules, robotsRule{pattern: value, allow: key == "allow"})
				}
			case "crawl-delay":
				if s, err := strconv.ParseFloat(value, 64); err == nil && s > 0 {
					g.crawlDelay = min(time.Duration(s*float64(time.Second)), maxCrawlDelay)
				}
			}
		}
	}
	if hasNamed {
		return named
	}
	return star
}

// Allowed reports whether path (with its query) may be read: the longest
// matching pattern wins, and Allow wins a tie.
func (g robotsGroup) Allowed(path string) bool {
	best, allowed := -1, true
	for _, r := range g.rules {
		if !matchRobots(r.pattern, path) {
			continue
		}
		if n := len(r.pattern); n > best || n == best && r.allow {
			best, allowed = n, r.allow
		}
	}
	return allowed
}

// matchRobots matches a prefix pattern where * is any run of characters and
// a trailing $ anchors the end.
func matchRobots(pattern, path string) bool {
	anchored := strings.HasSuffix(pattern, "$")
	if anchored {
		pattern = pattern[:len(pattern)-1]
	}
	parts := strings.Split(pattern, "*")
	if !strings.HasPrefix(path, parts[0]) {
		return false
	}
	rest := path[len(parts[0]):]
	if len(parts) == 1 {
		return !anchored || rest == ""
	}
	for _, p := range parts[1 : len(parts)-1] {
		i := strings.Index(rest, p)
		if i < 0 {
			return false
		}
		rest = rest[i+len(p):]
	}
	last := parts[len(parts)-1]
	if anchored {
		return strings.HasSuffix(rest, last)
	}
	return strings.Contains(rest, last)
}

// robotsFor returns the rules for u's origin, from the cache or a fetch.
// Under RFC 9309 a 4xx allows everything and a 5xx or no answer refuses
// everything. Our own lack of network is ErrOffline, not a refusal, so a
// laptop that wakes up offline does not push every Bot a day out.
func (f *Fetcher) robotsFor(ctx context.Context, u *url.URL) (robotsGroup, error) {
	origin := originOf(u)
	status, body, ok, err := f.robots(ctx, origin)
	if err != nil {
		return robotsGroup{}, err
	}
	if !ok {
		if status, body, err = f.fetchRobots(ctx, u, origin); err != nil {
			return robotsGroup{}, err
		}
	}
	switch {
	case status >= 200 && status < 300:
		return parseRobots(body, robotsAgent), nil
	case status >= 400 && status < 500 && status != http.StatusTooManyRequests:
		return robotsGroup{}, nil
	}
	return robotsGroup{rules: []robotsRule{{pattern: "/", allow: false}}}, nil
}

func (f *Fetcher) robots(ctx context.Context, origin string) (int, string, bool, error) {
	if f.cfg.Robots == nil {
		return 0, "", false, nil
	}
	return f.cfg.Robots.RobotsGet(ctx, origin, f.cfg.Now())
}

func (f *Fetcher) fetchRobots(ctx context.Context, u *url.URL, origin string) (int, string, error) {
	if err := f.wait(ctx, Site(u), f.cfg.SiteGap); err != nil {
		return 0, "", err
	}
	robotsURL := &url.URL{Scheme: u.Scheme, Host: u.Host, Path: "/robots.txt"}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, robotsURL.String(), nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("User-Agent", f.userAgent())
	req.Header.Set("Accept", "text/plain,*/*;q=0.1")
	status, body := 0, ""
	res, err := f.cfg.Client.Do(req)
	switch {
	case ctx.Err() != nil:
		if res != nil {
			_ = res.Body.Close()
		}
		return 0, "", transportError(ctx, ctx.Err())
	case res != nil && err != nil:
		// A redirect that could not be followed: the file is unavailable.
		status = http.StatusNotFound
	case err != nil:
		if sorted := transportError(ctx, err); errors.Is(sorted, ErrOffline) || errors.Is(sorted, ErrBlockedAddress) {
			return 0, "", sorted
		}
	default:
		raw, readErr := io.ReadAll(io.LimitReader(res.Body, robotsMaxBytes))
		_ = res.Body.Close()
		if ctx.Err() != nil {
			return 0, "", transportError(ctx, ctx.Err())
		}
		if readErr != nil {
			if sorted := transportError(ctx, readErr); errors.Is(sorted, ErrOffline) {
				return 0, "", sorted
			}
		} else {
			status, body = res.StatusCode, utils.StorableText(string(raw), robotsMaxBytes)
		}
	}
	ttl := robotsTTL
	if status == 0 || status >= 500 || status == http.StatusTooManyRequests {
		ttl = robotsRetryTTL
	}
	if f.cfg.Robots != nil {
		if err := f.cfg.Robots.RobotsPut(ctx, origin, status, body, f.cfg.Now(), ttl); err != nil {
			return 0, "", err
		}
	}
	return status, body, nil
}

// originOf is scheme://host:port with the default port spelled out, the key
// robots.txt applies to.
func originOf(u *url.URL) string {
	port := u.Port()
	if port == "" {
		port = "80"
		if u.Scheme == "https" {
			port = "443"
		}
	}
	return strings.ToLower(u.Scheme) + "://" + net.JoinHostPort(strings.ToLower(u.Hostname()), port)
}

// robotsPath is the part of u that robots.txt rules match against.
func robotsPath(u *url.URL) string {
	p := u.EscapedPath()
	if p == "" {
		p = "/"
	}
	if u.RawQuery != "" {
		p += "?" + u.RawQuery
	}
	return p
}
