package bots

import (
	"context"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// Site logos for the Bots page. A bot_icon job reads a site's logo through
// the Bots fetcher (public addresses, robots.txt, site spacing), redraws it
// as a 64 px PNG and keeps it in bot_site_icons, one row per registrable
// domain shared by everyone who watches it. GET /bots/icons serves them as
// data URIs, since an <img> cannot send the signed-in token, and only for
// sites the caller watches.
const (
	// IconRefreshDays is how old a logo may get before a save or a check
	// asks for it again; a site with none found is asked again as often.
	IconRefreshDays = 30
	// IconKeepDays drops a logo no one has asked for in that long.
	IconKeepDays = 60
	// MaxIconSites caps the sites one GET /bots/icons asks for.
	MaxIconSites = 30
	// iconBudget bounds one job: robots.txt, the home page and a few logo
	// addresses, each waiting for its site's slot.
	iconBudget   = 2 * time.Minute
	iconAttempts = 3
	// iconTries caps the logo addresses one job reads, /favicon.ico
	// included.
	iconTries = 4
	// iconRetryAfter is when a site that answered but failed a read for a
	// while is asked again.
	iconRetryAfter = 24 * time.Hour
	// iconTouchEvery is how stale used_at may get before a read moves it.
	iconTouchEvery = 24 * time.Hour
)

func iconKey(site string) string { return "bot_icon:" + site }

// iconSites maps the site of each page and feed watch in ws to the first
// address read on it. Price watches have no logo (their source's logo would
// be the wrong brand).
func iconSites(ws []Watch) map[string]string {
	out := map[string]string{}
	for _, w := range ws {
		if w.Kind != WatchPage && w.Kind != WatchFeed {
			continue
		}
		u, err := url.Parse(w.URL)
		if err != nil || u.Host == "" {
			continue
		}
		if site := fetch.Site(u); site != "" && out[site] == "" {
			out[site] = w.URL
		}
	}
	return out
}

func viewWatches(v View) []Watch {
	ws := make([]Watch, len(v.Watches))
	for i, w := range v.Watches {
		ws[i] = Watch{Kind: w.Kind, URL: w.URL}
	}
	return ws
}

// queueIcons queues a bot_icon job for each site in ws that has no logo row
// yet, or one fetched more than IconRefreshDays ago. The dedupe key is the
// site, so one job serves everyone who watches it; userID is whose save or
// check asked.
func (s *Service) queueIcons(ctx context.Context, userID string, ws []Watch) error {
	sites := iconSites(ws)
	if len(sites) == 0 {
		return nil
	}
	names := make([]string, 0, len(sites))
	for site := range sites {
		names = append(names, site)
	}
	slices.Sort(names)
	var fresh []string
	if err := s.db.WithContext(ctx).Raw(`SELECT site FROM bot_site_icons WHERE site IN ? AND fetched_at > ?`,
		names, s.now().UTC().Add(-IconRefreshDays*24*time.Hour)).Scan(&fresh).Error; err != nil {
		return err
	}
	var errs []error
	for _, site := range names {
		if slices.Contains(fresh, site) {
			continue
		}
		_, err := s.queue.Enqueue(jobs.Enqueue{
			UserID: userID, Kind: models.JobBotIcon, DedupeKey: iconKey(site), MaxAttempts: iconAttempts,
			Payload: models.JobPayload{"site": site, "pageUrl": sites[site]},
		})
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// askIcons is queueIcons for a save or a check that has already succeeded:
// a logo is never worth failing either, so an error is only logged.
func (s *Service) askIcons(ctx context.Context, userID string, ws []Watch) {
	if err := s.queueIcons(ctx, userID, ws); err != nil {
		log.Printf("bots: queue site logos: %v", err)
	}
}

// HandleIcon runs one bot_icon job. A logo found is stored redrawn; a site
// with none Timely can read stores NULL, and the job still succeeds, so it
// never shows in anyone's job health. A site that answered but failed a read
// for a while (a 5xx, a timeout) keeps any logo it had and is asked again in
// iconRetryAfter. A site that could not be reached at all (offline, busy)
// stores nothing: the next save or check asks again. Only a database error
// fails the job.
func (s *Service) HandleIcon(ctx context.Context, job *models.Job) error {
	site := cleanIconSite(job.Payload.String("site"))
	if site == "" {
		return nil
	}
	readCtx, cancel := context.WithTimeout(fetch.ShareSlots(ctx), iconBudget)
	body, got := s.findIcon(readCtx, site, job.Payload.String("pageUrl"))
	cancel()
	if got == iconUnreached || ctx.Err() != nil {
		return nil
	}
	now := s.now().UTC()
	db := s.db.WithContext(ctx)
	if got == iconRetry {
		return db.Exec(`INSERT INTO bot_site_icons (site, body, fetched_at, used_at) VALUES (?, NULL, ?, ?)
			ON CONFLICT (site) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`,
			site, now.Add(iconRetryAfter-IconRefreshDays*24*time.Hour), now).Error
	}
	var stored any // NULL: none found
	if body != nil {
		stored = body
	}
	return db.Exec(`INSERT INTO bot_site_icons (site, body, fetched_at, used_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (site) DO UPDATE SET body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at`, site, stored, now, now).Error
}

// iconOutcome is how a bot_icon job's reads ended.
type iconOutcome int

const (
	// iconDone: a logo was found, or every read had the site's final answer.
	iconDone iconOutcome = iota
	// iconRetry: the site answered, but some read failed for a while.
	iconRetry
	// iconUnreached: no read had any answer from the site.
	iconUnreached
)

// findIcon reads the site's home page for the logos it names (the watched
// page when the home page cannot be read), then the first few of them, best
// first, until one redraws. /favicon.ico is always among those read. The
// outcome tells a site that has no logo apart from one that could not be
// read, so that "none found" is never stored for an outage.
func (s *Service) findIcon(ctx context.Context, site, pageURL string) ([]byte, iconOutcome) {
	home := "https://" + site + "/"
	answered, passing := false, false
	note := func(err error) {
		if err == nil || iconAnswered(err) {
			answered = true
		}
		if err != nil && !iconDefinite(err) {
			passing = true
		}
	}
	outcome := func() iconOutcome {
		switch {
		case !answered:
			return iconUnreached
		case passing || ctx.Err() != nil:
			return iconRetry
		}
		return iconDone
	}
	var links []string
	res, err := s.fetch.Get(ctx, fetch.Request{URL: home, Want: fetch.WantPage})
	if err != nil {
		if u, perr := url.Parse(pageURL); perr == nil && pageURL != home && (u.Scheme == "https" || u.Scheme == "http") && fetch.Site(u) == site {
			// The home page's failure matters only when the watched page
			// cannot stand in for it.
			if res2, err2 := s.fetch.Get(ctx, fetch.Request{URL: pageURL, Want: fetch.WantPage}); err2 == nil {
				res, err = res2, nil
			} else {
				note(err)
				err = err2
			}
		}
	}
	note(err)
	if err == nil {
		links = extract.IconLinks(res.Body, res.ContentType, res.FinalURL)
	}
	if len(links) == 0 {
		links = []string{home + "favicon.ico"}
	}
	for _, link := range iconCandidates(links) {
		if ctx.Err() != nil {
			return nil, outcome()
		}
		res, err := s.fetch.Get(ctx, fetch.Request{URL: link, Want: fetch.WantIcon})
		note(err)
		if err != nil {
			continue
		}
		if png, err := extract.IconPNG(res.Body); err == nil {
			return png, iconDone
		}
	}
	return nil, outcome()
}

// iconCandidates is the first iconTries of links, best first, and always
// the last one, the /favicon.ico IconLinks ends with.
func iconCandidates(links []string) []string {
	if len(links) <= iconTries {
		return links
	}
	return append(slices.Clip(links[:iconTries-1]), links[len(links)-1])
}

// iconDefinite reports whether a read failed for good, the site's own
// answer: gone, refused, robots.txt, not an image, a 4xx. Anything else
// (offline, busy, rate limited, a 5xx, a timeout, an error from the robots
// cache) may pass.
func iconDefinite(err error) bool {
	for _, e := range []error{fetch.ErrCaptcha, fetch.ErrForbidden, fetch.ErrNotFound, fetch.ErrTooBig, fetch.ErrRobots,
		fetch.ErrUnsupported, fetch.ErrBlockedAddress, fetch.ErrNoSuchHost} {
		if errors.Is(err, e) {
			return true
		}
	}
	var status *fetch.StatusError
	return errors.As(err, &status) && status.Status < 500
}

// iconAnswered reports whether a failed read still had an answer from the
// site: a final one, or a status that asks to try later.
func iconAnswered(err error) bool {
	var status *fetch.StatusError
	var limited *fetch.RateLimitedError
	return iconDefinite(err) || errors.As(err, &status) || errors.As(err, &limited)
}

// cleanIconSite is site as a registrable domain (lower case, no port, path
// or trailing dot), or "" when it is not one.
func cleanIconSite(site string) string {
	site = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(site)), ".")
	if site == "" || strings.ContainsAny(site, "/:@?#%\\ ") {
		return ""
	}
	u := &url.URL{Scheme: "https", Host: site}
	if fetch.Site(u) != site {
		return ""
	}
	return site
}

// Icons answers GET /bots/icons: a data URI for each asked site the person
// watches, or nil when the site has no logo Timely could read. A site they
// do not watch is left out, so the answer never tells what others watch,
// and so is one whose logo has not been fetched yet. pending reports that.
func (s *Service) Icons(ctx context.Context, userID string, sites []string) (icons map[string]*string, pending bool, err error) {
	icons = map[string]*string{}
	if userID == "" || len(sites) == 0 {
		return icons, false, nil
	}
	db := s.db.WithContext(ctx)
	var urls []string
	if err := db.Model(&Watch{}).Where("user_id = ? AND kind IN ?", userID, []string{WatchPage, WatchFeed}).Pluck("url", &urls).Error; err != nil {
		return nil, false, err
	}
	ws := make([]Watch, len(urls))
	for i, u := range urls {
		ws[i] = Watch{Kind: WatchPage, URL: u}
	}
	mine := iconSites(ws)
	var want []string
	for _, site := range sites {
		if mine[site] != "" {
			want = append(want, site)
		}
	}
	if len(want) == 0 {
		return icons, false, nil
	}
	var rows []struct {
		Site   string
		Body   []byte
		UsedAt time.Time
	}
	if err := db.Raw(`SELECT site, body, used_at FROM bot_site_icons WHERE site IN ?`, want).Scan(&rows).Error; err != nil {
		return nil, false, err
	}
	now := s.now().UTC()
	var touch []string
	for _, r := range rows {
		var uri *string
		if len(r.Body) > 0 {
			v := "data:image/png;base64," + base64.StdEncoding.EncodeToString(r.Body)
			uri = &v
		}
		icons[r.Site] = uri
		if now.Sub(r.UsedAt) >= iconTouchEvery {
			touch = append(touch, r.Site)
		}
	}
	if len(touch) > 0 {
		if err := db.Exec(`UPDATE bot_site_icons SET used_at = ? WHERE site IN ?`, now, touch).Error; err != nil {
			return nil, false, err
		}
	}
	return icons, len(rows) < len(want), nil
}

// parseIconSites reads ?sites=a.com,b.org: trimmed, lower case and without
// repeats, at most MaxIconSites.
func parseIconSites(raw string) ([]string, error) {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		site := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(part)), ".")
		if site == "" || slices.Contains(out, site) {
			continue
		}
		out = append(out, site)
	}
	if len(out) > MaxIconSites {
		return nil, invalid("Ask for %d sites at most.", MaxIconSites)
	}
	return out, nil
}

// icons serves GET /bots/icons?sites=a.com,b.org. The answer is kept a day
// by the person's own browser, unless a logo is still on its way.
func (s *Service) icons(c *echo.Context) error {
	sites, err := parseIconSites(c.QueryParam("sites"))
	if err != nil {
		return httpError(err)
	}
	icons, pending, err := s.Icons(c.Request().Context(), user(c), sites)
	if err != nil {
		return httpError(err)
	}
	cache := "private, max-age=86400"
	if pending {
		cache = "private, no-store"
	}
	c.Response().Header().Set("Cache-Control", cache)
	return c.JSON(http.StatusOK, map[string]any{"icons": icons})
}
