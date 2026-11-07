// Package linkpreview reads a web page's title and description for doc
// bookmarks (GET /docs/link-preview?url=...).
//
// The server fetches a URL the user typed, so it refuses anything that is
// not a public web address: only http and https on ports 80 and 443, and
// every address the name resolves to (checked again on each redirect, at
// connect time, so DNS cannot swap in a private address later) must be a
// public unicast IP. Bodies are capped and fetches time out.
package linkpreview

import (
	"context"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v5"

	"timely-api/internal/netguard"
)

const (
	maxBody      = 512 << 10
	fetchTimeout = 8 * time.Second
	maxRedirects = 4
)

type Preview struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SiteName    string `json:"siteName"`
}

type Service struct{ client *http.Client }

func New() *Service { return &Service{client: newClient()} }

func (s *Service) Routes(protected *echo.Group) {
	protected.GET("/docs/link-preview", s.preview)
}

// publicIP reports whether ip is a public unicast address.
func publicIP(ip net.IP) bool {
	a, ok := netip.AddrFromSlice(ip)
	return ok && netguard.PublicAddr(a)
}

func newClient() *http.Client {
	return netguard.NewClient(netguard.Options{
		Timeout:       fetchTimeout,
		DialTimeout:   5 * time.Second,
		HeaderTimeout: 6 * time.Second,
		MaxRedirects:  maxRedirects,
		MaxIdleConns:  4,
		Ports:         []string{"80", "443"},
	})
}

func checkURL(u *url.URL) error { return netguard.CheckURL(u) }

func (s *Service) preview(c *echo.Context) error {
	raw := strings.TrimSpace(c.QueryParam("url"))
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 {
		return echo.NewHTTPError(http.StatusBadRequest, "That is not a link")
	}
	if err := checkURL(u); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	preview, err := s.Fetch(c.Request().Context(), u)
	if err != nil {
		// The bookmark still works without a title, so a page that cannot
		// be read is not an error.
		return c.JSON(http.StatusOK, Preview{URL: u.String()})
	}
	return c.JSON(http.StatusOK, preview)
}

// Fetch reads the page's title, description and site name.
func (s *Service) Fetch(ctx context.Context, u *url.URL) (Preview, error) {
	out := Preview{URL: u.String()}
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; TimelyLinkPreview/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
	res, err := s.client.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return out, fmt.Errorf("status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "html") {
		return out, nil
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return out, err
	}
	out.Title, out.Description, out.SiteName = Parse(string(body))
	return out, nil
}

var (
	titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	metaRe  = regexp.MustCompile(`(?is)<meta\s[^>]*>`)
	attrRe  = regexp.MustCompile(`(?is)([a-z:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)`)
	spaceRe = regexp.MustCompile(`\s+`)
)

// Parse picks the Open Graph title and description, falling back to <title>
// and <meta name="description">.
func Parse(page string) (title, description, site string) {
	meta := map[string]string{}
	for _, tag := range metaRe.FindAllString(page, 200) {
		attrs := map[string]string{}
		for _, m := range attrRe.FindAllStringSubmatch(tag, -1) {
			attrs[strings.ToLower(m[1])] = strings.Trim(m[2], `"'`)
		}
		key := strings.ToLower(attrs["property"])
		if key == "" {
			key = strings.ToLower(attrs["name"])
		}
		if key != "" && meta[key] == "" {
			meta[key] = attrs["content"]
		}
	}
	title = first(meta["og:title"], meta["twitter:title"])
	if title == "" {
		if m := titleRe.FindStringSubmatch(page); m != nil {
			title = m[1]
		}
	}
	description = first(meta["og:description"], meta["description"], meta["twitter:description"])
	return clean(title, 200), clean(description, 300), clean(meta["og:site_name"], 80)
}

func first(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func clean(s string, limit int) string {
	s = strings.TrimSpace(spaceRe.ReplaceAllString(html.UnescapeString(s), " "))
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	if utf8.RuneCountInString(s) > limit {
		s = string([]rune(s)[:limit-1]) + "…"
	}
	return s
}
