package bots

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/bots/botstest"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

func logoPNG(t *testing.T, side int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, side, side))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+3] = 200, 255
	}
	var b bytes.Buffer
	must(t, png.Encode(&b, img))
	return b.Bytes()
}

type iconJob struct {
	Site    string
	PageURL string
	UserID  string
	Status  string
}

func iconJobs(t *testing.T, db *gorm.DB) map[string]iconJob {
	t.Helper()
	var rows []models.Job
	must(t, db.Where("kind = ?", models.JobBotIcon).Order("created_at").Find(&rows).Error)
	out := map[string]iconJob{}
	for _, r := range rows {
		if r.DedupeKey == nil || *r.DedupeKey != iconKey(r.Payload.String("site")) {
			t.Fatalf("job %s has dedupe key %v", r.ID, r.DedupeKey)
		}
		out[r.Payload.String("site")] = iconJob{Site: r.Payload.String("site"), PageURL: r.Payload.String("pageUrl"), UserID: r.UserID, Status: r.Status}
	}
	return out
}

func finishIconJobs(t *testing.T, db *gorm.DB) {
	t.Helper()
	must(t, db.Exec(`UPDATE jobs SET status = 'succeeded', finished_at = now() WHERE kind = ? AND status = 'pending'`, models.JobBotIcon).Error)
}

type iconRow struct {
	Site      string
	Body      []byte
	FetchedAt time.Time
	UsedAt    time.Time
}

func iconRowOf(t *testing.T, db *gorm.DB, site string) (iconRow, bool) {
	t.Helper()
	var rows []iconRow
	must(t, db.Raw(`SELECT site, body, fetched_at, used_at FROM bot_site_icons WHERE site = ?`, site).Scan(&rows).Error)
	if len(rows) == 0 {
		return iconRow{}, false
	}
	return rows[0], true
}

func TestIntegrationIconsQueuedOnSaveAndCheck(t *testing.T) {
	e := newEngine(t)
	const page = "https://www.shop.example/p/1"
	e.net.serve(page, 200, "text/html", "<html><body><p>Headphones</p></body></html>")

	// A new Bot asks for its sites' logos before its first check: pages and
	// feeds only, one job per site whoever asks.
	v := e.create(pageInput("Shop", page))
	e.create(Input{Name: "Feed", Watches: []WatchInput{{Kind: WatchFeed, URL: "https://news.example/rss"}, {Kind: WatchPage, URL: "https://shop.example/other"}}})
	e.create(btcBot("Coin"))
	other := addUser(t, e.db)
	if _, err := e.s.Create(context.Background(), other, pageInput("Mine too", "https://m.shop.example/x"), OriginApp); err != nil {
		t.Fatal(err)
	}
	got := iconJobs(t, e.db)
	if len(got) != 2 || got["shop.example"] != (iconJob{"shop.example", page, e.user, models.JobPending}) ||
		got["news.example"] != (iconJob{"news.example", "https://news.example/rss", e.user, models.JobPending}) {
		t.Fatalf("icon jobs after saves: %+v", got)
	}

	// After a clean check, a site with no logo row is asked for again.
	finishIconJobs(t, e.db)
	must(t, e.run(v.ID))
	if c := e.lastCheck(v.ID); c.Outcome != outBaseline {
		t.Fatalf("check outcome %s", c.Outcome)
	}
	if got := iconJobs(t, e.db); got["shop.example"].Status != models.JobPending {
		t.Fatalf("no icon job after a check: %+v", got)
	}

	// A fresh row asks for nothing; one older than 30 days is refreshed.
	finishIconJobs(t, e.db)
	must(t, e.db.Exec(`INSERT INTO bot_site_icons (site, body, fetched_at, used_at) VALUES ('shop.example', NULL, ?, ?)`, e.now, e.now).Error)
	e.again(v.ID)
	if n := e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotIcon); n != 0 {
		t.Fatalf("%d icon jobs for a fresh logo", n)
	}
	must(t, e.db.Exec(`UPDATE bot_site_icons SET fetched_at = ?`, e.now.Add(-(IconRefreshDays*24+1)*time.Hour)).Error)
	e.again(v.ID)
	if n := e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotIcon); n != 1 {
		t.Fatalf("%d icon jobs for a stale logo, want 1", n)
	}

	// A check that fails asks for nothing.
	finishIconJobs(t, e.db)
	must(t, e.db.Exec(`DELETE FROM bot_site_icons`).Error)
	e.net.serve(page, 404, "text/html", "gone")
	e.due(v.ID)
	must(t, e.run(v.ID))
	if n := e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotIcon); n != 0 {
		t.Fatalf("%d icon jobs after a failed check", n)
	}

	// A save over MCP fetches nothing, a logo included: that Bot is paused.
	finishIconJobs(t, e.db)
	m, err := e.s.Create(context.Background(), e.user, pageInput("Outside", "https://outside.example/a"), OriginMCP)
	must(t, err)
	_, err = e.s.Update(context.Background(), e.user, m.ID, Patch{Watches: &[]WatchInput{{Kind: WatchPage, URL: "https://outside.example.net/b"}}}, OriginMCP)
	must(t, err)
	if n := e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotIcon); n != 0 {
		t.Fatalf("%d icon jobs after MCP saves", n)
	}

	// An edit that adds a site asks for it.
	_, err = e.s.Update(context.Background(), e.user, v.ID, Patch{Watches: &[]WatchInput{{Kind: WatchPage, URL: "https://blog.example.org/a"}}}, OriginApp)
	must(t, err)
	if got := iconJobs(t, e.db); got["example.org"].Status != models.JobPending || got["example.org"].PageURL != "https://blog.example.org/a" {
		t.Fatalf("icon jobs after an edit: %+v", got)
	}
}

func TestIntegrationIconJob(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	logo := logoPNG(t, 32)
	n := botstest.NewNetwork(map[string]botstest.Response{
		"https://logo.example/":            botstest.Page(`<html><head><link rel="icon" href="/logo.svg"><link rel="icon" type="image/png" sizes="32x32" href="/i.png"></head></html>`),
		"https://logo.example/logo.svg":    {ContentType: "image/svg+xml", Body: `<svg xmlns="http://www.w3.org/2000/svg"/>`},
		"https://logo.example/i.png":       {ContentType: "image/png", Body: string(logo)},
		"https://plain.example/":           botstest.Page(`<html><body>No logo here</body></html>`),
		"https://svg.example/":             botstest.Page(`<html><head><link rel="icon" href="/logo.svg"></head></html>`),
		"https://svg.example/favicon.ico":  {ContentType: "image/svg+xml", Body: `<svg xmlns="http://www.w3.org/2000/svg"/>`},
		"https://shut.example/":            {Status: http.StatusForbidden, Body: "no"},
		"https://shut.example/p/1":         botstest.Page(`<html><head><link rel="apple-touch-icon" href="https://cdn.shut.example/t.png"></head></html>`),
		"https://cdn.shut.example/t.png":   {ContentType: "image/png", Body: string(logo)},
		"https://down.example/":            {Err: syscall.ECONNRESET},
		"https://down.example/favicon.ico": {Err: syscall.ECONNRESET},
		"https://junk.example/":            botstest.Page(`<html></html>`),
		"https://junk.example/favicon.ico": {ContentType: "image/png", Body: "\x89PNG\r\n\x1a\nnot really"},
		"https://many.example/": botstest.Page(`<html><head><link rel="apple-touch-icon" sizes="180x180" href="/t180.png">` +
			`<link rel="apple-touch-icon" sizes="152x152" href="/t152.png"><link rel="apple-touch-icon" sizes="120x120" href="/t120.png">` +
			`<link rel="icon" type="image/png" sizes="32x32" href="/i32.png"><link rel="icon" type="image/png" sizes="16x16" href="/i16.png"></head></html>`),
		"https://many.example/favicon.ico":     {ContentType: "image/png", Body: string(logo)},
		"https://flaky.example/":               {Status: http.StatusBadGateway, Body: "bad gateway"},
		"https://flaky.example/favicon.ico":    {Status: http.StatusGatewayTimeout, Body: "timeout"},
		"https://apex.example/":                {Err: syscall.ECONNRESET},
		"https://www.apex.example/p":           botstest.Page(`<html><head><link rel="icon" href="/gone.png"></head></html>`),
		"https://www.apex.example/favicon.ico": {Status: http.StatusNotFound, Body: "no"},
	})
	s := testService(db)
	s.SetFetcher(n.Fetcher())
	q := jobs.NewQueue(db)

	// Each job goes through the queue as the worker runs it, and finishes.
	run := func(site, pageURL string) models.Job {
		t.Helper()
		_, err := q.Enqueue(jobs.Enqueue{UserID: user, Kind: models.JobBotIcon, DedupeKey: iconKey(site), MaxAttempts: iconAttempts,
			Payload: models.JobPayload{"site": site, "pageUrl": pageURL}})
		must(t, err)
		job, err := q.Claim(context.Background(), "test", jobs.Lane{Kinds: []string{models.JobBotIcon}})
		must(t, err)
		if job == nil {
			t.Fatal("no icon job to claim")
		}
		if err := s.HandleIcon(context.Background(), job); err != nil {
			must(t, q.Fail(job, err))
		} else {
			must(t, q.Succeed(job))
		}
		var row models.Job
		must(t, db.Where("id = ?", job.ID).First(&row).Error)
		return row
	}
	png64 := func(site string) {
		t.Helper()
		row, ok := iconRowOf(t, db, site)
		if !ok || row.Body == nil {
			t.Fatalf("%s: no logo stored", site)
		}
		img, err := png.Decode(bytes.NewReader(row.Body))
		if err != nil || img.Bounds().Dx() != 64 || img.Bounds().Dy() != 64 || bytes.Equal(row.Body, logo) {
			t.Fatalf("%s: stored logo is not a redrawn 64 px PNG: %v", site, err)
		}
		if c := color.NRGBAModel.Convert(img.At(32, 32)).(color.NRGBA); c.R < 180 || c.A != 255 {
			t.Fatalf("%s: logo centre %v", site, c)
		}
		if !row.FetchedAt.Equal(botNow) || !row.UsedAt.Equal(botNow) {
			t.Fatalf("%s: times %v %v", site, row.FetchedAt, row.UsedAt)
		}
	}

	// The SVG link is skipped for the PNG one.
	if job := run("logo.example", "https://logo.example/a"); job.Status != models.JobSucceeded {
		t.Fatalf("logo job %s", job.Status)
	}
	png64("logo.example")
	if n.Hits("https://logo.example/logo.svg") != 0 {
		t.Error("an SVG link was read")
	}

	// A home page that refuses falls back to the watched page's links.
	run("shut.example", "https://shut.example/p/1")
	png64("shut.example")

	// None found stores NULL and still succeeds.
	for _, site := range []string{"plain.example", "svg.example", "junk.example"} {
		if job := run(site, ""); job.Status != models.JobSucceeded || job.LastError != nil && *job.LastError != "" {
			t.Fatalf("%s: job %s %v", site, job.Status, job.LastError)
		}
		if row, ok := iconRowOf(t, db, site); !ok || row.Body != nil {
			t.Fatalf("%s: row %v %+v, want body NULL", site, ok, row)
		}
	}
	if n.Hits("https://plain.example/favicon.ico") != 1 {
		t.Errorf("/favicon.ico read %d times", n.Hits("https://plain.example/favicon.ico"))
	}

	// A site that cannot be reached stores nothing, so a later save or
	// check asks again, and the job still succeeds.
	if job := run("down.example", ""); job.Status != models.JobSucceeded {
		t.Fatalf("offline job %s", job.Status)
	}
	if _, ok := iconRowOf(t, db, "down.example"); ok {
		t.Fatal("an unreachable site stored a row")
	}

	// /favicon.ico is read even after every one of many named logos fails.
	run("many.example", "")
	png64("many.example")
	if n.Hits("https://many.example/i16.png") != 0 || n.Hits("https://many.example/t180.png") != 1 {
		t.Errorf("named logos read: i16 %d, t180 %d", n.Hits("https://many.example/i16.png"), n.Hits("https://many.example/t180.png"))
	}

	// A site that answers 5xx keeps the logo it had and is asked again in a
	// day, not in 30.
	must(t, db.Exec(`INSERT INTO bot_site_icons (site, body, fetched_at, used_at) VALUES ('flaky.example', ?, ?, ?)`, logo, botNow.AddDate(0, -2, 0), botNow.AddDate(0, 0, -3)).Error)
	if job := run("flaky.example", ""); job.Status != models.JobSucceeded {
		t.Fatalf("5xx job %s", job.Status)
	}
	if row, ok := iconRowOf(t, db, "flaky.example"); !ok || !bytes.Equal(row.Body, logo) ||
		!row.FetchedAt.Equal(botNow.Add(iconRetryAfter-IconRefreshDays*24*time.Hour)) || !row.UsedAt.Equal(botNow.AddDate(0, 0, -3)) {
		t.Fatalf("5xx: row %v %+v", ok, row)
	}

	// A home page that cannot be reached does not matter once the watched
	// page stands in for it: no logo there is stored as none.
	run("apex.example", "https://www.apex.example/p")
	if row, ok := iconRowOf(t, db, "apex.example"); !ok || row.Body != nil || !row.FetchedAt.Equal(botNow) {
		t.Fatalf("apex: row %v %+v, want body NULL fetched now", ok, row)
	}

	// A refresh replaces the logo, and keeps when it was last asked for.
	must(t, db.Exec(`UPDATE bot_site_icons SET body = NULL, fetched_at = ?, used_at = ? WHERE site = 'logo.example'`, botNow.AddDate(0, -2, 0), botNow.AddDate(0, 0, -3)).Error)
	run("logo.example", "")
	if row, _ := iconRowOf(t, db, "logo.example"); row.Body == nil || !row.FetchedAt.Equal(botNow) || !row.UsedAt.Equal(botNow.AddDate(0, 0, -3)) {
		t.Fatalf("refresh: %+v", row)
	}

	// A payload that is not a site does nothing.
	for _, site := range []string{"", "a.example/b", "user@a.example", "a.example:8080", "www.logo.example"} {
		if err := s.HandleIcon(context.Background(), &models.Job{UserID: user, Kind: models.JobBotIcon, Payload: models.JobPayload{"site": site}}); err != nil {
			t.Fatalf("%q: %v", site, err)
		}
		if _, ok := iconRowOf(t, db, site); ok {
			t.Fatalf("%q stored a row", site)
		}
	}

	// Only the database failing fails the job.
	must(t, db.Exec(`ALTER TABLE bot_site_icons RENAME TO bot_site_icons_gone`).Error)
	if job := run("plain.example", ""); job.Status != models.JobPending || job.LastError == nil {
		t.Fatalf("a database error: job %s %v", job.Status, job.LastError)
	}
}

func iconsGet(t *testing.T, s *Service, userID, query string) (int, map[string]any, http.Header) {
	t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", userID)
			return next(c)
		}
	})
	s.Routes(e.Group(""))
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/bots/icons"+query, nil))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Header()
}

func TestIntegrationIconsRoute(t *testing.T) {
	db := migratedDB(t)
	me, other := addUser(t, db), addUser(t, db)
	s := testService(db)
	ctx := context.Background()
	for _, in := range []Input{
		pageInput("Shop", "https://www.shop.example/p/1"),
		{Name: "News", Watches: []WatchInput{{Kind: WatchFeed, URL: "https://news.example/rss"}}},
		btcBot("Coin"),
	} {
		_, err := s.Create(ctx, me, in, OriginApp)
		must(t, err)
	}
	_, err := s.Create(ctx, other, pageInput("Secret", "https://secret.example/"), OriginApp)
	must(t, err)
	logo := logoPNG(t, 64)
	old := botNow.Add(-48 * time.Hour)
	for _, r := range []struct {
		site string
		body any
	}{{"shop.example", logo}, {"news.example", nil}, {"secret.example", logo}} {
		must(t, db.Exec(`INSERT INTO bot_site_icons (site, body, fetched_at, used_at) VALUES (?, ?, ?, ?)`, r.site, r.body, old, old).Error)
	}

	code, body, h := iconsGet(t, s, me, "?sites=shop.example,%20NEWS.example.,secret.example,unknown.example,shop.example")
	icons, _ := body["icons"].(map[string]any)
	if code != http.StatusOK || len(icons) != 2 || icons["shop.example"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(logo) {
		t.Fatalf("icons %d %v", code, body)
	}
	if v, ok := icons["news.example"]; !ok || v != nil {
		t.Fatalf("a site with none found is null: %v", icons)
	}
	if h.Get("Cache-Control") != "private, max-age=86400" {
		t.Errorf("Cache-Control %q", h.Get("Cache-Control"))
	}
	for site, want := range map[string]time.Time{"shop.example": botNow, "news.example": botNow, "secret.example": old} {
		if row, _ := iconRowOf(t, db, site); !row.UsedAt.Equal(want) {
			t.Errorf("%s used_at %v, want %v", site, row.UsedAt, want)
		}
	}

	// The other account sees its own site and none of mine.
	if _, body, _ := iconsGet(t, s, other, "?sites=shop.example,secret.example"); len(body["icons"].(map[string]any)) != 1 || body["icons"].(map[string]any)["secret.example"] == nil {
		t.Fatalf("other account: %v", body)
	}

	// A site whose logo is on its way is left out, and the answer not kept.
	_, err = s.Create(ctx, me, pageInput("Fresh", "https://fresh.example/"), OriginApp)
	must(t, err)
	code, body, h = iconsGet(t, s, me, "?sites=fresh.example,shop.example")
	if icons := body["icons"].(map[string]any); code != http.StatusOK || len(icons) != 1 || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("pending: %d %v %q", code, body, h.Get("Cache-Control"))
	}

	if code, body, _ := iconsGet(t, s, me, ""); code != http.StatusOK || len(body["icons"].(map[string]any)) != 0 {
		t.Fatalf("no sites: %d %v", code, body)
	}
	var many []string
	for i := range MaxIconSites + 1 {
		many = append(many, strings.Repeat("a", i+1)+".example")
	}
	if code, body, _ := iconsGet(t, s, me, "?sites="+strings.Join(many, ",")); code != http.StatusBadRequest || !strings.Contains(body["message"].(string), "30 sites") {
		t.Fatalf("31 sites: %d %v", code, body)
	}
	if code, _, _ := iconsGet(t, s, me, "?sites="+strings.Join(many[:MaxIconSites], ",")); code != http.StatusOK {
		t.Fatalf("30 sites: %d", code)
	}
}

func TestIntegrationIconsPrune(t *testing.T) {
	db := migratedDB(t)
	s := testService(db)
	day := 24 * time.Hour
	for site, used := range map[string]time.Time{
		"stale.example":  botNow.Add(-(IconKeepDays*day + time.Hour)),
		"recent.example": botNow.Add(-(IconKeepDays*day - time.Hour)),
	} {
		must(t, db.Exec(`INSERT INTO bot_site_icons (site, body, fetched_at, used_at) VALUES (?, NULL, ?, ?)`, site, used, used).Error)
	}
	must(t, s.prune(context.Background(), botNow))
	if _, ok := iconRowOf(t, db, "stale.example"); ok {
		t.Error("a logo unused for over 60 days was kept")
	}
	if _, ok := iconRowOf(t, db, "recent.example"); !ok {
		t.Error("a logo used within 60 days was pruned")
	}
}
