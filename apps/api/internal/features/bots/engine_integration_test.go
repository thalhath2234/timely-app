package bots

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// fakeNet answers the engine's requests from routes keyed by host and path,
// so no test opens a real site. robots.txt is a 404 (allow all) unless set.
type fakeNet struct {
	mu     sync.Mutex
	routes map[string]func(*http.Request) (*http.Response, error)
	hits   map[string]int
}

func newFakeNet() *fakeNet {
	return &fakeNet{routes: map[string]func(*http.Request) (*http.Response, error){}, hits: map[string]int{}}
}

func netKey(raw string) string {
	u, _ := url.Parse(raw)
	return u.Host + u.Path
}

func (n *fakeNet) set(raw string, fn func(*http.Request) (*http.Response, error)) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.routes[netKey(raw)] = fn
}

// serve answers raw with a fixed reply.
func (n *fakeNet) serve(raw string, status int, contentType, body string) {
	n.set(raw, func(req *http.Request) (*http.Response, error) { return reply(req, status, contentType, body), nil })
}

func (n *fakeNet) RoundTrip(req *http.Request) (*http.Response, error) {
	key := req.URL.Host + req.URL.Path
	n.mu.Lock()
	fn := n.routes[key]
	n.hits[key]++
	n.mu.Unlock()
	if fn == nil {
		return reply(req, http.StatusNotFound, "text/plain", "not found"), nil
	}
	return fn(req)
}

func reply(req *http.Request, status int, contentType, body string, header ...string) *http.Response {
	h := http.Header{"Content-Type": {contentType}}
	for i := 0; i+1 < len(header); i += 2 {
		h.Set(header[i], header[i+1])
	}
	return &http.Response{StatusCode: status, Header: h, Body: io.NopCloser(strings.NewReader(body)), Request: req, ContentLength: int64(len(body))}
}

// engine is one account, a Service on a fake clock and a fake network.
type engine struct {
	t    *testing.T
	db   *gorm.DB
	s    *Service
	net  *fakeNet
	now  time.Time
	user string
}

func newEngine(t *testing.T) *engine {
	db := migratedDB(t)
	e := &engine{t: t, db: db, net: newFakeNet(), now: botNow}
	e.user = addUser(t, db)
	e.s = e.service()
	return e
}

// service is another process on the same database, network and clock.
func (e *engine) service() *Service {
	s := New(e.db, jobs.NewQueue(e.db))
	s.now = func() time.Time { return e.now }
	s.rnd = rand.New(rand.NewPCG(1, 2))
	s.fetch = fetch.New(fetch.Config{
		Client: &http.Client{Transport: e.net}, Robots: s.store,
		Now: func() time.Time { return e.now }, Sleep: func(context.Context, time.Duration) error { return nil },
	})
	return s
}

func (e *engine) zone(settings models.NotificationSettings) {
	e.t.Helper()
	must(e.t, e.db.Create(&models.Config{ID: "cfg_" + e.user, UserID: e.user, NotificationSettings: settings}).Error)
}

func (e *engine) create(in Input) View {
	e.t.Helper()
	v, err := e.s.Create(context.Background(), e.user, in, OriginApp)
	must(e.t, err)
	return v
}

func (e *engine) bot(id string) Bot {
	e.t.Helper()
	var b Bot
	must(e.t, e.db.Where("id = ?", id).First(&b).Error)
	return b
}

func (e *engine) job(botID, trigger string) *models.Job {
	return &models.Job{ID: utils.NewJobID(), UserID: e.user, Kind: models.JobBotCheck, Attempts: 1, MaxAttempts: 2,
		Payload: models.JobPayload{"botId": botID, "trigger": trigger}}
}

// run runs one check job for the Bot now.
func (e *engine) run(botID string) error {
	return e.s.HandleCheck(context.Background(), e.job(botID, TriggerSchedule))
}

// due moves the clock to when the Bot may be checked again.
func (e *engine) due(botID string) {
	e.t.Helper()
	b := e.bot(botID)
	at := e.now.Add(time.Second)
	if b.NextCheckAt != nil && b.NextCheckAt.After(at) {
		at = b.NextCheckAt.Add(time.Second)
	}
	ws, err := loadWatches(e.db, botID, false)
	must(e.t, err)
	if b.CheckStartedAt != nil {
		if f := b.CheckStartedAt.Add(Floor(ws)); f.After(at) {
			at = f
		}
	}
	e.now = at
}

// again moves to the Bot's next check and runs it.
func (e *engine) again(botID string) {
	e.t.Helper()
	e.due(botID)
	must(e.t, e.run(botID))
}

func (e *engine) lastCheck(botID string) Check {
	e.t.Helper()
	var c Check
	must(e.t, e.db.Where("bot_id = ?", botID).Order("finished_at DESC, created_at DESC").First(&c).Error)
	return c
}

func (e *engine) count(table, where string, args ...any) int64 {
	e.t.Helper()
	return count(e.t, e.db, table, where, args...)
}

func (e *engine) notifications() []models.Notification {
	e.t.Helper()
	var out []models.Notification
	must(e.t, e.db.Where("user_id = ? AND category = ?", e.user, models.NotifyBot).Order("created_at, id").Find(&out).Error)
	return out
}

const coinbaseBTC = "https://api.coinbase.com/v2/prices/BTC-USD/spot"

// coinbase serves a moving BTC spot price, shaped like Coinbase's reply.
func (e *engine) coinbase(amount *string) {
	e.net.set(coinbaseBTC, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "application/json", `{"data":{"amount":"`+*amount+`","base":"BTC","currency":"USD"}}`), nil
	})
}

func btcBot(name string, rules ...Rule) Input {
	return Input{Name: name, Watches: []WatchInput{{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Rules: rules}}}
}

func pageInput(name, u string) Input {
	return Input{Name: name, Watches: []WatchInput{{Kind: WatchPage, URL: u}}}
}

func rss(ids ...string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><rss version="2.0"><channel><title>Made-up news</title>`)
	for _, id := range ids {
		fmt.Fprintf(&b, `<item><guid>%s</guid><title>Story %s</title><link>https://news.example.com/%s</link></item>`, id, id, id)
	}
	b.WriteString(`</channel></rss>`)
	return b.String()
}

func TestIntegrationBotPriceFiresOnce(t *testing.T) {
	e := newEngine(t)
	amount := "27499.00"
	e.coinbase(&amount)
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))

	must(t, e.run(v.ID))
	if c := e.lastCheck(v.ID); c.Outcome != outBaseline || c.Reading == nil {
		t.Fatalf("first check %+v", c)
	}
	if n := len(e.notifications()); n != 0 {
		t.Fatalf("a baseline alerted %d times", n)
	}
	want := []struct{ amount, outcome string }{
		{"24999.00", outFired}, {"24500.00", outChanged}, {"25200.00", outChanged}, {"24900.00", outFired},
	}
	for _, step := range want {
		amount = step.amount
		e.again(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != step.outcome {
			t.Fatalf("%s: outcome %s", step.amount, c.Outcome)
		}
	}
	ntfs := e.notifications()
	if len(ntfs) != 2 || ntfs[0].Title != "BTC dip: below 25,000" || ntfs[0].Body != "BTC now $24,999 (was $27,499)" {
		t.Fatalf("notifications %+v", ntfs)
	}
	if ntfs[1].Body != "BTC now $24,900 (was $25,200)" || ntfs[0].Data.String("botAlert") != "alert" || ntfs[0].Data["kind"] != nil {
		t.Fatalf("second alert %+v", ntfs[1])
	}
	if n := e.count("bot_findings", "bot_id = ? AND kind = 'price' AND alerted", v.ID); n != 2 {
		t.Fatalf("%d findings", n)
	}
	var day PriceDay
	must(t, e.db.Where("bot_id = ?", v.ID).First(&day).Error)
	if len(day.Points) != 5 || *day.Open != 27499 || *day.High != 27499 || *day.Low != 24500 || *day.Close != 24900 {
		t.Fatalf("price day %+v", day)
	}
	// A repeat of the last quote time adds no point.
	w := watchRow(t, e.db, v.Watches[0].ID)
	must(t, addPricePoint(e.db, w, *w.LastReading))
	must(t, e.db.Where("bot_id = ?", v.ID).First(&day).Error)
	if len(day.Points) != 5 {
		t.Fatalf("a repeated quote added a point: %d", len(day.Points))
	}
	b := e.bot(v.ID)
	if b.Strikes != 0 || b.Health != healthWorking || b.CheckingJobID != nil || b.LastOkAt == nil || !b.NextCheckAt.After(e.now) {
		t.Fatalf("bot after checks %+v", b)
	}
}

func TestIntegrationBotProblems(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()

	t.Run("offline", func(t *testing.T) {
		amount := "100"
		e.coinbase(&amount)
		v := e.create(btcBot("Offline"))
		e.net.set(coinbaseBTC, func(*http.Request) (*http.Response, error) { return nil, io.ErrUnexpectedEOF })
		must(t, e.run(v.ID))
		b := e.bot(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outOffline || b.Strikes != 0 || !b.NextCheckAt.Equal(e.now.Add(5*time.Minute)) ||
			b.OfflineSince == nil || b.Health != "offline" || b.HealthDetail != "Waiting for the network" {
			t.Fatalf("offline %+v / %+v", c, b)
		}
		e.coinbase(&amount)
		e.again(v.ID)
		if b := e.bot(v.ID); b.OfflineSince != nil || e.lastCheck(v.ID).Outcome != outBaseline {
			t.Fatalf("back online %+v", b)
		}
	})

	t.Run("rate limited", func(t *testing.T) {
		u := "https://busy.example.com/"
		e.net.set(u, func(req *http.Request) (*http.Response, error) {
			return reply(req, 429, "text/html", "slow down", "Retry-After", "600"), nil
		})
		v := e.create(pageInput("Busy", u))
		must(t, e.run(v.ID))
		b := e.bot(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outRateLimited || b.Strikes != 0 || b.NextCheckAt.Before(e.now.Add(10*time.Minute)) ||
			!strings.HasPrefix(b.HealthDetail, "example.com asked Timely to wait until ") {
			t.Fatalf("429 %+v / %+v", c, b)
		}
	})

	t.Run("captcha five times pauses once", func(t *testing.T) {
		robot, err := os.ReadFile("fetch/testdata/amazon_robot_check.html")
		must(t, err)
		u := "https://www.shop.example.in/dp/B0TEST"
		e.net.serve(u, 200, "text/html", string(robot))
		v := e.create(pageInput("Shop", u))
		for i := range MaxStrikes {
			if i > 0 {
				e.due(v.ID)
			}
			must(t, e.run(v.ID))
		}
		b := e.bot(v.ID)
		if b.Status != StatusPaused || *b.PauseReason != PauseStrikes || b.Strikes != MaxStrikes || b.NextCheckAt != nil || b.Health != "captcha" {
			t.Fatalf("after 5 robot checks %+v", b)
		}
		if n := e.count("bot_alerts", "bot_id = ? AND kind = 'paused'", v.ID); n != 1 {
			t.Fatalf("%d paused alerts", n)
		}
		var ntf models.Notification
		must(t, e.db.Where("entity_id = ? AND data->>'botAlert' = 'paused'", v.ID).First(&ntf).Error)
		if ntf.Title != "Shop paused after 5 failed checks" || ntf.Body != "example.in showed a robot check. Resume it in Timely." {
			t.Fatalf("paused alert %q / %q", ntf.Title, ntf.Body)
		}
		if n := e.count("notifications", "entity_id = ?", v.ID); n != 1 {
			t.Fatalf("%d notifications", n)
		}
		// A paused Bot is never checked.
		before := e.count("bot_checks", "bot_id = ?", v.ID)
		must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerRunNow)))
		if e.count("bot_checks", "bot_id = ?", v.ID) != before {
			t.Fatal("a paused Bot was checked")
		}
	})

	t.Run("empty selector", func(t *testing.T) {
		u := "https://example.net/item"
		e.net.serve(u, 200, "text/html", `<html><body><p class="other">Hello</p></body></html>`)
		v := e.create(Input{Name: "Selector", Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadSelector, Selector: ".price"}}})
		must(t, e.run(v.ID))
		b := e.bot(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outStrike || c.ErrorKind != "cant_find" || b.Strikes != 1 || b.Health != "cant_find" {
			t.Fatalf("empty selector %+v / %+v", c, b)
		}
		if w := watchRow(t, e.db, v.Watches[0].ID); w.Health != "cant_find" || w.HealthDetail != "The selector matched nothing on the page" {
			t.Fatalf("watch health %+v", w)
		}
	})

	t.Run("not modified", func(t *testing.T) {
		u := "https://etag.example.com/page"
		e.net.set(u, func(req *http.Request) (*http.Response, error) {
			if req.Header.Get("If-None-Match") == `"v1"` {
				return reply(req, 304, "text/html", ""), nil
			}
			return reply(req, 200, "text/html", "<html><body><p>Same as ever</p></body></html>", "ETag", `"v1"`), nil
		})
		v := e.create(pageInput("ETag", u))
		must(t, e.run(v.ID))
		if w := watchRow(t, e.db, v.Watches[0].ID); w.ETag != `"v1"` || w.ValidatorsURL != u {
			t.Fatalf("validators %+v", w)
		}
		e.again(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outNotModified || c.Reading != nil {
			t.Fatalf("304 %+v", c)
		}
	})

	t.Run("feed with three new items", func(t *testing.T) {
		u := "https://news.example.com/rss"
		e.net.serve(u, 200, "application/rss+xml", rss("b", "a"))
		v := e.create(Input{Name: "News", Watches: []WatchInput{{Kind: WatchFeed, URL: u}}})
		must(t, e.run(v.ID))
		e.net.serve(u, 200, "application/rss+xml", rss("e", "d", "c", "b", "a"))
		e.again(v.ID)
		var ntfs []models.Notification
		must(t, e.db.Where("entity_id = ?", v.ID).Find(&ntfs).Error)
		if len(ntfs) != 1 || ntfs[0].Title != "News: 3 new items" || ntfs[0].Body != "Story e and 2 more" {
			t.Fatalf("feed alerts %+v", ntfs)
		}
		e.again(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outUnchanged {
			t.Fatalf("seen items alerted again: %s", c.Outcome)
		}
	})

	t.Run("robots", func(t *testing.T) {
		u := "https://private.example.org/notes"
		e.net.serve("https://private.example.org/robots.txt", 200, "text/plain", "User-agent: *\nDisallow: /\n")
		e.net.serve(u, 200, "text/html", "<p>never read</p>")
		v := e.create(pageInput("Robots", u))
		must(t, e.run(v.ID))
		b := e.bot(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outRobots || b.Strikes != 0 || !b.NextCheckAt.Equal(e.now.Add(24*time.Hour)) || b.Health != "robots" {
			t.Fatalf("robots %+v / %+v", c, b)
		}
		if e.net.hits[netKey(u)] != 0 {
			t.Fatal("a disallowed page was read")
		}
	})

	t.Run("one source down pauses two bots with one notification", func(t *testing.T) {
		gone, err := os.ReadFile("price/testdata/yahoo_gone.html")
		must(t, err)
		e.net.serve("https://query1.finance.yahoo.com/v8/finance/chart/AAPL", 200, "text/html", string(gone))
		var ids []string
		for _, name := range []string{"Apple one", "Apple two"} {
			v := e.create(Input{Name: name, Watches: []WatchInput{{Kind: WatchPrice, Source: "yahoo", Symbol: "AAPL"}}})
			must(t, e.db.Model(&Bot{}).Where("id = ?", v.ID).Update("strikes", MaxStrikes-1).Error)
			must(t, e.run(v.ID))
			ids = append(ids, v.ID)
		}
		for _, id := range ids {
			if b := e.bot(id); b.Status != StatusPaused || b.Health != "source_down" {
				t.Fatalf("bot %+v", b)
			}
		}
		if n := e.count("bot_alerts", "bot_id IN ? AND kind = 'paused'", ids); n != 2 {
			t.Fatalf("%d paused rows", n)
		}
		if n := e.count("notifications", "user_id = ? AND data->>'botAlert' = 'paused' AND dedupe_key LIKE 'bot:source:%'", e.user); n != 1 {
			t.Fatalf("%d source notifications", n)
		}
	})
}

// A firing check is one transaction: a failure before commit leaves no trace.
func TestIntegrationBotCheckIsOneTransaction(t *testing.T) {
	e := newEngine(t)
	amount := "27499"
	e.coinbase(&amount)
	v := e.create(btcBot("Atomic", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	must(t, e.run(v.ID))
	snapshot := func() string {
		w := watchRow(t, e.db, v.Watches[0].ID)
		var points int64
		must(t, e.db.Raw(`SELECT COALESCE(sum(jsonb_array_length(points)), 0) FROM bot_price_days WHERE bot_id = ?`, v.ID).Scan(&points).Error)
		return fmt.Sprint(e.count("bot_checks", "bot_id = ?", v.ID), e.count("bot_alerts", "bot_id = ?", v.ID),
			e.count("bot_findings", "bot_id = ?", v.ID), points, e.count("notifications", "user_id = ?", e.user),
			e.count("jobs", "user_id = ? AND kind = ?", e.user, models.JobSendPush), *w.LastReading.Price, string(mustJSON(t, w.RuleState)))
	}
	before := snapshot()
	amount = "24000"
	e.due(v.ID)
	e.s.beforeCommit = func(*gorm.DB) error { return errFake }
	if err := e.run(v.ID); !errors.Is(err, errFake) {
		t.Fatalf("save error %v", err)
	}
	if after := snapshot(); after != before {
		t.Fatalf("a failed save left a trace:\n%s\n%s", before, after)
	}
	if b := e.bot(v.ID); !b.NextCheckAt.Equal(Provisional(b.Interval(), e.now)) {
		t.Fatalf("next check %v", b.NextCheckAt)
	}
}

// A job that fails both attempts leaves the Bot at its provisional time, so
// the sweep does not queue it again in a loop.
func TestIntegrationBotFinalFailure(t *testing.T) {
	e := newEngine(t)
	amount := "100"
	e.coinbase(&amount)
	v := e.create(btcBot("Fails"))
	must(t, e.run(v.ID))
	e.due(v.ID)
	q := e.s.queue
	_, err := q.Enqueue(jobs.Enqueue{UserID: e.user, Kind: models.JobBotCheck, DedupeKey: checkKey(v.ID), MaxAttempts: checkAttempts,
		RunAt: time.Now(), Payload: models.JobPayload{"botId": v.ID, "trigger": TriggerSchedule}})
	must(t, err)
	e.s.beforeCommit = func(*gorm.DB) error { return errFake }
	var job *models.Job
	for range checkAttempts {
		job, err = q.Claim(context.Background(), "test", jobs.Lane{Kinds: []string{models.JobBotCheck}})
		must(t, err)
		if job == nil {
			t.Fatal("no job to claim")
		}
		must(t, q.Fail(job, e.s.HandleCheck(context.Background(), job)))
		must(t, e.db.Exec(`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = ?`, job.ID).Error)
	}
	var row models.Job
	must(t, e.db.Where("id = ?", job.ID).First(&row).Error)
	if row.Status != models.JobFailed {
		t.Fatalf("job %s after %d attempts", row.Status, row.Attempts)
	}
	if b := e.bot(v.ID); !b.NextCheckAt.Equal(Provisional(b.Interval(), e.now)) {
		t.Fatalf("next check %v, want %v", b.NextCheckAt, Provisional(b.Interval(), e.now))
	}
	for range 3 {
		must(t, e.s.Sweep(context.Background()))
	}
	if n := e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotCheck); n != 0 {
		t.Fatalf("%d jobs queued after a final failure", n)
	}
}

func TestIntegrationBotShutdown(t *testing.T) {
	e := newEngine(t)
	amount := "100"
	e.coinbase(&amount)
	v := e.create(btcBot("Shutdown"))
	must(t, e.run(v.ID))
	started := e.bot(v.ID).CheckStartedAt
	e.due(v.ID)
	ctx, cancel := context.WithCancel(context.Background())
	e.net.set(coinbaseBTC, func(req *http.Request) (*http.Response, error) {
		cancel()
		return nil, context.Canceled
	})
	checks := e.count("bot_checks", "bot_id = ?", v.ID)
	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerSchedule)))
	b := e.bot(v.ID)
	if b.Strikes != 0 || !b.NextCheckAt.Equal(e.now) || b.CheckingJobID != nil || !b.CheckStartedAt.Equal(*started) {
		t.Fatalf("after shutdown %+v", b)
	}
	if e.count("bot_checks", "bot_id = ?", v.ID) != checks {
		t.Fatal("a shutdown wrote a check")
	}
}

func TestIntegrationBotFence(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	amount := "100"
	e.coinbase(&amount)
	checks := func(id string) int64 { return e.count("bot_checks", "bot_id = ?", id) }

	// A job that arrives after another job checked the Bot does nothing.
	v := e.create(btcBot("Fence"))
	must(t, e.run(v.ID))
	must(t, e.run(v.ID))
	if n := checks(v.ID); n != 1 {
		t.Fatalf("%d checks", n)
	}

	// Two run-now checks within the floor give one check.
	e.due(v.ID)
	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerRunNow)))
	e.now = e.now.Add(time.Minute)
	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerRunNow)))
	if n := checks(v.ID); n != 2 {
		t.Fatalf("%d checks after two run-now jobs", n)
	}

	// A retry of the same job passes the fence.
	e.due(v.ID)
	job := e.job(v.ID, TriggerSchedule)
	e.s.beforeCommit = func(*gorm.DB) error { return errFake }
	if err := e.s.HandleCheck(ctx, job); !errors.Is(err, errFake) {
		t.Fatalf("first attempt %v", err)
	}
	e.s.beforeCommit = nil
	job.Attempts = 2
	must(t, e.s.HandleCheck(ctx, job))
	if n := checks(v.ID); n != 3 {
		t.Fatalf("%d checks after a retry", n)
	}

	// A person's Retry of a failed job on a paused Bot does nothing.
	e.due(v.ID)
	q := e.s.queue
	failed, err := q.Enqueue(jobs.Enqueue{UserID: e.user, Kind: models.JobBotCheck, DedupeKey: checkKey(v.ID), MaxAttempts: checkAttempts,
		RunAt: time.Now(), Payload: models.JobPayload{"botId": v.ID, "trigger": TriggerSchedule}})
	must(t, err)
	must(t, e.db.Model(&models.Job{}).Where("id = ?", failed.ID).Updates(map[string]any{"status": models.JobFailed, "attempts": 2}).Error)
	_, err = e.s.Pause(ctx, e.user, v.ID, PausePerson)
	must(t, err)
	retried, err := q.Retry(e.user, failed.ID)
	must(t, err)
	must(t, e.s.HandleCheck(ctx, retried))
	if n := checks(v.ID); n != 3 {
		t.Fatalf("a paused Bot was checked: %d", n)
	}

	// A deleted Bot does nothing.
	must(t, e.s.Delete(ctx, e.user, v.ID))
	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerRunNow)))
}

func TestIntegrationBotAlerts(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "Asia/Kolkata"})
	text := 0
	u := "https://changes.example.com/"
	e.net.set(u, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "text/html", fmt.Sprintf("<html><body><p>Headline</p><p>Version %d</p></body></html>", text)), nil
	}) // 09:30 UTC is 15:00 in Kolkata: six hourly checks stay in one local day
	v := e.create(pageInput("Watcher", u))
	must(t, e.run(v.ID))
	for range 5 {
		text++
		e.again(v.ID)
	}
	ntfs := e.notifications()
	if len(ntfs) != 4 {
		t.Fatalf("%d notifications", len(ntfs))
	}
	if ntfs[0].Title != "Watcher: page changed" || ntfs[0].Body != "Version 1" {
		t.Fatalf("first alert %q / %q", ntfs[0].Title, ntfs[0].Body)
	}
	more := ntfs[3]
	if more.Title != "Watcher: and 2 more today" || more.Data.String("botAlert") != "more" {
		t.Fatalf("more alert %+v", more)
	}
	if n := e.count("jobs", "kind = ? AND payload->>'notificationId' = ?", models.JobSendPush, more.ID); n != 1 {
		t.Fatalf("the more alert has %d pushes", n)
	}
	if n := e.count("jobs", "user_id = ? AND kind = ?", e.user, models.JobSendPush); n != 4 {
		t.Fatalf("%d pushes", n)
	}
	if n := e.count("bot_alerts", "bot_id = ? AND kind = 'alert' AND held = 'cap'", v.ID); n != 2 {
		t.Fatalf("%d capped alerts", n)
	}
	var row Alert
	must(t, e.db.Where("bot_id = ? AND kind = 'more'", v.ID).First(&row).Error)
	if row.MoreCount != 2 || row.NotificationID == nil || *row.NotificationID != more.ID || row.LocalDay.Format(dayLayout) != "2026-11-06" {
		t.Fatalf("more row %+v", row)
	}
	if d, err := e.s.Get(context.Background(), e.user, v.ID); err != nil || d.AlertsToday != AlertsPerDay {
		t.Fatalf("alerts today %d %v", d.AlertsToday, err)
	}
	// Clear all removed the more alert: the next one writes a fresh one.
	must(t, e.db.Where("id = ?", more.ID).Delete(&models.Notification{}).Error)
	text++
	e.again(v.ID)
	var fresh []models.Notification
	must(t, e.db.Where("entity_id = ? AND data->>'botAlert' = 'more'", v.ID).Find(&fresh).Error)
	if len(fresh) != 1 || fresh[0].Title != "Watcher: and 3 more today" {
		t.Fatalf("after clear all %+v", fresh)
	}

	// Saving the same check twice raises one notification.
	b := e.bot(v.ID)
	checkID := utils.PrefixedUUID("bchk")
	must(t, e.db.Create(&Check{ID: checkID, BotID: b.ID, UserID: e.user, Trigger: TriggerSchedule, StartedAt: e.now, FinishedAt: e.now, Outcome: outFired}).Error)
	fired := []firedEvent{{w: watchRow(t, e.db, v.Watches[0].ID), rule: Rule{Kind: RuleAnyChange}, ev: Event{After: Reading{Kind: ReadingText, Text: "x"}}}}
	must(t, e.db.Exec(`DELETE FROM bot_alerts WHERE bot_id = ?`, b.ID).Error)
	for range 2 {
		must(t, e.db.Transaction(func(tx *gorm.DB) error {
			_, err := e.s.alert(tx, b, checkID, utils.PrefixedUUID("bal"), fired, e.now)
			return err
		}))
	}
	if n := e.count("notifications", "dedupe_key = ?", "bot:"+b.ID+":"+checkID); n != 1 {
		t.Fatalf("%d notifications for one check", n)
	}
}

func TestIntegrationBotAlertDelivery(t *testing.T) {
	e := newEngine(t)
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	e.zone(models.NotificationSettings{Timezone: "Asia/Kolkata", QuietHoursStart: "14:00", QuietHoursEnd: "23:00"})
	version := 0
	no, yes := false, true
	bots := map[string]Input{}
	for _, name := range []string{"Quiet", "Urgent", "Desktop only", "Snoozed"} {
		u := "https://" + strings.ReplaceAll(strings.ToLower(name), " ", "-") + ".example.com/"
		e.net.set(u, func(req *http.Request) (*http.Response, error) {
			return reply(req, 200, "text/html", fmt.Sprintf("<p>Version %d</p>", version)), nil
		})
		in := pageInput(name, u)
		switch name {
		case "Urgent":
			in.Urgent = &yes
		case "Desktop only":
			in.Phone = &no
		}
		bots[name] = in
	}
	ids := map[string]string{}
	for name, in := range bots {
		v := e.create(in)
		ids[name] = v.ID
		must(t, e.run(v.ID))
	}
	until := e.now.Add(48 * time.Hour)
	_, err := e.s.Snooze(context.Background(), e.user, ids["Snoozed"], &until)
	must(t, err)
	version++
	e.now = e.now.Add(time.Hour + 3*time.Minute) // 16:03 in Kolkata, inside quiet hours
	for _, id := range ids {
		must(t, e.run(id))
	}
	quietEnd := time.Date(2026, 11, 6, 23, 0, 0, 0, kolkata).UTC()
	alertFor := func(name string) (models.Notification, []models.Job) {
		var n models.Notification
		must(t, e.db.Where("entity_id = ?", ids[name]).First(&n).Error)
		var js []models.Job
		must(t, e.db.Where("kind = ? AND payload->>'notificationId' = ?", models.JobSendPush, n.ID).Find(&js).Error)
		return n, js
	}

	n, js := alertFor("Quiet")
	if n.SnoozedUntil == nil || !n.SnoozedUntil.Equal(quietEnd) || len(js) != 1 || !js[0].RunAt.Equal(quietEnd) || n.Title != "Quiet: page changed (at 16:03)" {
		t.Fatalf("quiet %+v %+v", n, js)
	}
	n, js = alertFor("Urgent")
	if n.SnoozedUntil != nil || len(js) != 1 || !js[0].RunAt.Equal(e.now) || n.Title != "Urgent: page changed" || n.Data["urgent"] != true {
		t.Fatalf("urgent %+v %+v", n, js)
	}
	n, js = alertFor("Desktop only")
	if n.DeliveredAt == nil || len(js) != 0 || n.Data["phone"] != false {
		t.Fatalf("phone off %+v %+v", n, js)
	}
	if c := e.count("notifications", "entity_id = ?", ids["Snoozed"]); c != 0 {
		t.Fatalf("a snoozed Bot sent %d", c)
	}
	if c := e.count("bot_alerts", "bot_id = ? AND held = 'snoozed'", ids["Snoozed"]); c != 1 {
		t.Fatalf("%d held rows", c)
	}
	if c := e.count("bot_findings", "bot_id = ? AND NOT alerted", ids["Snoozed"]); c != 1 {
		t.Fatalf("%d findings for the snoozed Bot", c)
	}
}

func TestIntegrationBotSweep(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.now = time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC) // ahead of the database clock
	due1, due2 := e.create(pageInput("Due one", "https://a.example.com/")), e.create(pageInput("Due two", "https://b.example.com/"))
	later := e.create(pageInput("Later", "https://c.example.com/"))
	paused := e.create(pageInput("Paused", "https://d.example.com/"))
	_, err := e.s.Pause(ctx, e.user, paused.ID, PausePerson)
	must(t, err)
	must(t, e.db.Model(&Bot{}).Where("id IN ?", []string{due1.ID, due2.ID}).Update("next_check_at", e.now.Add(-time.Minute)).Error)
	must(t, e.db.Model(&Bot{}).Where("id = ?", later.ID).Update("next_check_at", e.now.Add(time.Minute)).Error)

	a, b := e.s, e.service()
	must(t, a.Sweep(ctx))
	must(t, b.Sweep(ctx))
	var queued []models.Job
	must(t, e.db.Where("kind = ? AND status = 'pending'", models.JobBotCheck).Find(&queued).Error)
	got := map[string]int{}
	for _, j := range queued {
		got[j.Payload.String("botId")]++
		if j.MaxAttempts != checkAttempts {
			t.Fatalf("max attempts %d", j.MaxAttempts)
		}
	}
	if len(queued) != 2 || got[due1.ID] != 1 || got[due2.ID] != 1 {
		t.Fatalf("queued %v", got)
	}

	// After the first sweep, one sweep is one query on bots.
	var mu sync.Mutex
	statements := 0
	countBots := func(tx *gorm.DB) {
		if strings.Contains(tx.Statement.SQL.String(), "FROM bots") {
			mu.Lock()
			statements++
			mu.Unlock()
		}
	}
	must(t, e.db.Callback().Query().After("gorm:query").Register("bots_test:count_query", countBots))
	must(t, e.db.Callback().Row().After("gorm:row").Register("bots_test:count_row", countBots))
	e.now = e.now.Add(10 * time.Second)
	must(t, a.Sweep(ctx))
	if statements != 1 {
		t.Fatalf("%d statements on bots in one sweep", statements)
	}
}

func TestIntegrationBotWake(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	var ids []string
	for i := range 4 {
		ids = append(ids, e.create(pageInput(fmt.Sprintf("Bot %d", i), fmt.Sprintf("https://w%d.example.com/", i))).ID)
	}
	must(t, e.db.Model(&Bot{}).Where("id IN ?", ids).Update("next_check_at", e.now.Add(-9*time.Hour)).Error)
	e.s.lastSweepWall = e.now.Add(-9 * time.Hour)
	e.s.lastPrune = e.now
	must(t, e.s.Sweep(ctx))
	must(t, e.service().Sweep(ctx))

	var queued []models.Job
	must(t, e.db.Where("kind = ? AND status = 'pending'", models.JobBotCheck).Find(&queued).Error)
	if len(queued) != 4 {
		t.Fatalf("%d jobs", len(queued))
	}
	for _, j := range queued {
		if j.RunAt.Before(e.now.Add(WakeSettle)) || j.RunAt.After(e.now.Add(WakeSettle+WakeSpread)) || j.Payload.String("trigger") != TriggerWake {
			t.Fatalf("job runs at %v (%s)", j.RunAt.Sub(e.now), j.Payload.String("trigger"))
		}
	}
	ntfs := e.notifications()
	if len(ntfs) != 1 || ntfs[0].Title != "Bots were paused for 9 hours" || ntfs[0].Body != "Timely was closed or asleep. 4 bots are checking now." ||
		ntfs[0].Data.String("botAlert") != "away" {
		t.Fatalf("away alerts %+v", ntfs)
	}
	// A wake check records its trigger.
	j := queued[0]
	e.now = j.RunAt
	must(t, e.s.HandleCheck(ctx, &j))
	if c := e.lastCheck(j.Payload.String("botId")); c.Trigger != TriggerWake {
		t.Fatalf("trigger %s", c.Trigger)
	}
}

// A sweep that still counts as a wake once the first Bot of the gap was
// checked (a slow tick, a second process starting) sends no second away alert.
func TestIntegrationBotWakeAlertsOncePerGap(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	var ids []string
	for i := range 4 {
		u := fmt.Sprintf("https://gap%d.example.com/", i)
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput(fmt.Sprintf("Gap %d", i), u))
		must(t, e.db.Model(&Bot{}).Where("id = ?", v.ID).Update("next_check_at", e.now.Add(-9*time.Hour+time.Duration(i)*time.Minute)).Error)
		ids = append(ids, v.ID)
	}
	e.s.lastSweepWall = e.now.Add(-9 * time.Hour)
	e.s.lastPrune = e.now
	must(t, e.s.Sweep(ctx))
	var first models.Job
	must(t, e.db.Where("kind = ? AND payload->>'botId' = ?", models.JobBotCheck, ids[0]).First(&first).Error)
	e.now = first.RunAt
	first.Attempts = 1
	must(t, e.s.HandleCheck(ctx, &first))
	must(t, e.db.Model(&first).Update("status", models.JobSucceeded).Error)

	e.now = e.now.Add(70 * time.Second)
	must(t, e.s.Sweep(ctx))
	must(t, e.service().Sweep(ctx))
	if ntfs := e.notifications(); len(ntfs) != 1 {
		t.Fatalf("%d away alerts for one gap", len(ntfs))
	}

	// A later gap gets its own.
	must(t, e.db.Model(&Bot{}).Where("id IN ?", ids).Update("next_check_at", e.now.Add(time.Minute)).Error)
	e.now = e.now.Add(5 * time.Hour)
	e.s.lastSweepWall = e.now.Add(-5 * time.Hour)
	must(t, e.s.Sweep(ctx))
	if ntfs := e.notifications(); len(ntfs) != 2 {
		t.Fatalf("%d away alerts after a second gap", len(ntfs))
	}
}

func TestIntegrationBotSiteBusy(t *testing.T) {
	e := newEngine(t)
	e.s.fetch = fetch.New(fetch.Config{
		Client: &http.Client{Transport: e.net}, Spacer: e.s.store, Robots: e.s.store,
		Now: func() time.Time { return e.now }, Sleep: func(context.Context, time.Duration) error { return nil },
	})
	u := "https://www.crowded.example.com/page"
	e.net.serve(u, 200, "text/html", "<p>hello</p>")
	must(t, e.db.Exec(`INSERT INTO bot_sites (site, next_slot_at, used_at) VALUES ('example.com', ?, ?)`, e.now.Add(time.Hour), e.now).Error)
	v := e.create(pageInput("Crowded", u))
	must(t, e.run(v.ID))
	b := e.bot(v.ID)
	if c := e.lastCheck(v.ID); c.Outcome != outSiteBusy || b.Strikes != 0 || b.Health != "waiting" || b.NextCheckAt.Before(e.now.Add(time.Hour)) {
		t.Fatalf("site busy %+v / %+v", c, b)
	}
	// Another site is not held up.
	other := e.create(pageInput("Elsewhere", "https://quiet.example.org/"))
	e.net.serve("https://quiet.example.org/", 200, "text/html", "<p>hi</p>")
	must(t, e.run(other.ID))
	if c := e.lastCheck(other.ID); c.Outcome != outBaseline {
		t.Fatalf("other site %s", c.Outcome)
	}
}

func TestIntegrationBotRunNow(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	u := "https://run.example.com/"
	e.net.serve(u, 200, "text/html", "<p>hello</p>")

	paused := e.create(pageInput("Paused", "https://paused.example.com/"))
	_, err := e.s.Pause(ctx, e.user, paused.ID, PausePerson)
	must(t, err)
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+paused.ID+"/run", nil); code != http.StatusConflict || body["message"] != ErrPaused.Error() {
		t.Fatalf("paused run %d %v", code, body)
	}

	// A waiting scheduled check is pulled forward and becomes run now.
	v := e.create(pageInput("Run", u))
	waiting, err := e.s.queue.Enqueue(jobs.Enqueue{UserID: e.user, Kind: models.JobBotCheck, DedupeKey: checkKey(v.ID), MaxAttempts: checkAttempts,
		RunAt: e.now.Add(time.Hour), Payload: models.JobPayload{"botId": v.ID, "trigger": TriggerSchedule}})
	must(t, err)
	code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+v.ID+"/run", nil)
	if code != http.StatusAccepted || body["jobId"] != waiting.ID || body["line"] != "Checking now." {
		t.Fatalf("run %d %v", code, body)
	}
	var job models.Job
	must(t, e.db.Where("id = ?", waiting.ID).First(&job).Error)
	if !job.RunAt.Equal(e.now) || job.Payload.String("trigger") != TriggerRunNow {
		t.Fatalf("expedited job %v %v", job.RunAt, job.Payload)
	}
	must(t, e.s.HandleCheck(ctx, &job))
	must(t, e.db.Model(&job).Update("status", models.JobSucceeded).Error)

	// Right after a check, Run now waits for the floor and says so.
	e.now = e.now.Add(time.Minute)
	res, err := e.s.RunNow(ctx, e.user, "run", OriginApp)
	must(t, err)
	if want := e.now.Add(MinPageEvery - time.Minute); !res.RunAt.Equal(want) ||
		!strings.HasSuffix(res.Line, "Pages and feeds are checked every 15 minutes at most.") {
		t.Fatalf("run at %v (%s)", res.RunAt, res.Line)
	}
	e.now = res.RunAt
	var next models.Job
	must(t, e.db.Where("id = ?", res.JobID).First(&next).Error)
	must(t, e.s.HandleCheck(ctx, &next))
	if n := e.count("bot_checks", "bot_id = ? AND trigger = 'run_now'", v.ID); n != 2 {
		t.Fatalf("%d run-now checks", n)
	}
}

func TestIntegrationBotRetention(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	busy := e.create(btcBot("Busy"))
	old := e.create(btcBot("Old"))
	rows := make([]Check, 0, 600)
	for i := range 600 {
		at := e.now.Add(-time.Duration(i) * time.Minute)
		rows = append(rows, Check{ID: fmt.Sprintf("bchk_%03d", i), BotID: busy.ID, UserID: e.user, Trigger: TriggerSchedule, StartedAt: at, FinishedAt: at, Outcome: outUnchanged})
	}
	must(t, e.db.CreateInBatches(&rows, 200).Error)
	monthAgo := e.now.AddDate(0, 0, -31)
	must(t, e.db.Create(&Check{ID: "bchk_old", BotID: old.ID, UserID: e.user, Trigger: TriggerSchedule, StartedAt: monthAgo, FinishedAt: monthAgo, Outcome: outUnchanged}).Error)
	must(t, e.db.Create(&Check{ID: "bchk_recent", BotID: old.ID, UserID: e.user, Trigger: TriggerSchedule, StartedAt: e.now, FinishedAt: e.now, Outcome: outUnchanged}).Error)
	w := old.Watches[0].ID
	day := func(d time.Time) time.Time { return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC) }
	must(t, e.db.Create(&PriceDay{WatchID: w, Day: day(e.now.AddDate(0, 0, -367)), BotID: old.ID, UserID: e.user}).Error)
	must(t, e.db.Create(&PriceDay{WatchID: w, Day: day(e.now.AddDate(0, 0, -300)), BotID: old.ID, UserID: e.user}).Error)
	must(t, e.s.prune(ctx, e.now))

	if n := e.count("bot_checks", "bot_id = ?", busy.ID); n != LogMax {
		t.Fatalf("%d checks kept", n)
	}
	if n := e.count("bot_checks", "id = 'bchk_599'"); n != 0 {
		t.Fatal("the oldest check beyond 500 was kept")
	}
	if n := e.count("bot_checks", "bot_id = ?", old.ID); n != 1 || e.count("bot_checks", "id = 'bchk_old'") != 0 {
		t.Fatalf("31-day-old check kept (%d left)", n)
	}
	if n := e.count("bot_price_days", "watch_id = ?", w); n != 1 {
		t.Fatalf("%d price days", n)
	}
}

func TestIntegrationBotAfterRestore(t *testing.T) {
	e := newEngine(t)
	amount := "100"
	e.coinbase(&amount)
	var ids []string
	for i := range 3 {
		v := e.create(btcBot(fmt.Sprintf("Restored %d", i)))
		must(t, e.run(v.ID))
		ids = append(ids, v.ID)
	}
	paused := e.create(btcBot("Paused"))
	_, err := e.s.Pause(context.Background(), e.user, paused.ID, PausePerson)
	must(t, err)
	e.now = e.now.Add(time.Hour)
	e.s.AfterRestore(e.user)
	for _, id := range ids {
		b := e.bot(id)
		if b.NextCheckAt.Before(e.now) || b.NextCheckAt.After(e.now.Add(WakeSpread)) || b.CheckingJobID != nil {
			t.Fatalf("restored next check %v", b.NextCheckAt.Sub(e.now))
		}
	}
	if b := e.bot(paused.ID); b.NextCheckAt != nil {
		t.Fatal("a paused Bot was scheduled")
	}
	e.now = e.now.Add(WakeSpread)
	amount = "50" // would have moved 50% since the last reading
	must(t, e.run(ids[0]))
	if c := e.lastCheck(ids[0]); c.Outcome != outBaseline {
		t.Fatalf("first check after restore %s", c.Outcome)
	}
}
