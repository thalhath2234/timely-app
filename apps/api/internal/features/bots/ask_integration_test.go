package bots

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
	"timely-api/internal/features/bots/botstest"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

const (
	askFeedURL = "https://news.example/feed"
	askShopURL = "https://shop.example/p/headphones"
)

// askEngine is an engine reading through botstest, whose Ask sleeps a
// little real time between looks, so a worker goroutine can run the check.
func askEngine(t *testing.T) (*engine, *botstest.Network) {
	t.Helper()
	e := newEngine(t)
	shop, err := os.ReadFile("extract/testdata/shop_struck.html")
	must(t, err)
	n := botstest.NewNetwork(map[string]botstest.Response{
		askFeedURL:  botstest.Feed(rss("1", "2", "3", "4")),
		askShopURL:  botstest.Page(string(shop)),
		coinbaseBTC: botstest.JSON(`{"data":{"amount":"27499.00","base":"BTC","currency":"USD"}}`),
	})
	e.s.SetFetcher(n.Fetcher())
	e.s.sleep = func(ctx context.Context, _ time.Duration) error {
		time.Sleep(20 * time.Millisecond)
		return ctx.Err()
	}
	return e, n
}

// worker runs the account's bot_check jobs as they are queued, whatever
// their run_at says (the clock is fake), until the returned stop is called.
func (e *engine) worker() (stop func()) {
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for ctx.Err() == nil {
			var job models.Job
			res := e.db.Raw(`
UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id = (SELECT id FROM jobs WHERE user_id = ? AND kind = ? AND status = 'pending' ORDER BY run_at LIMIT 1)
RETURNING *`, e.user, models.JobBotCheck).Scan(&job)
			if res.Error != nil || res.RowsAffected == 0 || job.ID == "" {
				time.Sleep(5 * time.Millisecond)
				continue
			}
			if err := e.s.HandleCheck(ctx, &job); err != nil {
				e.t.Errorf("check: %v", err)
			}
			e.db.Model(&models.Job{}).Where("id = ?", job.ID).Update("status", models.JobSucceeded)
		}
	}()
	return func() { cancel(); wg.Wait() }
}

func (e *engine) ask(idOrName string) Answer {
	e.t.Helper()
	a, err := e.s.Ask(context.Background(), e.user, idOrName)
	must(e.t, err)
	return a
}

func (e *engine) askedAt(botID string) *time.Time {
	e.t.Helper()
	return e.bot(botID).AskedAt
}

func (e *engine) waitingChecks(botID string) int64 {
	return e.count("jobs", "dedupe_key = ? AND status IN ('pending', 'running')", checkKey(botID))
}

func TestIntegrationBotAskFreshness(t *testing.T) {
	e, n := askEngine(t)
	start := e.now
	// Checked every 6 hours, so it is never due during the test: each
	// check a tag starts passes the claim only as run now does.
	v := e.create(Input{Name: "Go news", IntervalMinutes: 360,
		Watches: []WatchInput{{Kind: WatchFeed, URL: askFeedURL, Rules: []Rule{{Kind: RuleNewItem}}}}})
	must(t, e.run(v.ID))

	// Recent: the last check is 40 minutes old, so nothing is checked.
	e.now = start.Add(40 * time.Minute)
	a := e.ask("go news")
	if a.Fresh != FreshRecent || a.FreshLine != "Checked 40 min ago" || a.CheckedAt == nil || !a.CheckedAt.Equal(start) {
		t.Fatalf("recent %q %q %v", a.Fresh, a.FreshLine, a.CheckedAt)
	}
	if e.askedAt(v.ID) != nil || e.waitingChecks(v.ID) != 0 {
		t.Fatal("a recent answer started a check")
	}
	if a.Bot.ID != v.ID || a.Bot.Name != "Go news" || a.Bot.Status != StatusActive || a.Bot.Health.Code != healthWorking || len(a.Watches) != 1 {
		t.Fatalf("answer %+v", a)
	}
	w := a.Watches[0]
	if w.Kind != WatchFeed || w.Site != "news.example" || w.Title != "news.example · Feed" || len(w.Items) != askItems || w.Items[0].Title == "" || w.Excerpt == "" {
		t.Fatalf("watch %+v", w)
	}
	if len(a.Findings) != 0 || a.AlertsToday != 0 {
		t.Fatalf("a baseline has no findings: %+v", a.Findings)
	}

	// Checked now: the last check is over an hour old and the Bot is not
	// due, so the tag's check runs as run now would.
	e.now = start.Add(2 * time.Hour)
	if b := e.bot(v.ID); !b.NextCheckAt.After(e.now) {
		t.Fatalf("the Bot is due at %v", b.NextCheckAt)
	}
	n.Set(askFeedURL, botstest.Feed(rss("1", "2", "3", "4", "5")))
	stop := e.worker()
	a = e.ask(v.ID)
	stop()
	if a.Fresh != FreshCheckedNow || a.FreshLine != "Checked just now" || a.CheckedAt == nil || !a.CheckedAt.Equal(e.now) {
		t.Fatalf("checked now %q %q %v", a.Fresh, a.FreshLine, a.CheckedAt)
	}
	if c := e.lastCheck(v.ID); c.Trigger != TriggerAsk || c.Outcome != outFired {
		t.Fatalf("the tag's check %s %s", c.Trigger, c.Outcome)
	}
	if len(a.Findings) != 1 || a.Findings[0].Kind != "item" || a.AlertsToday != 1 {
		t.Fatalf("findings %+v, alerts today %d", a.Findings, a.AlertsToday)
	}
	if at := e.askedAt(v.ID); at == nil || !at.Equal(e.now) {
		t.Fatalf("asked at %v", at)
	}

	// Waiting, then limited: with no worker the tag's check never runs in
	// time; a second tag in 5 minutes starts no other.
	e.now = start.Add(4 * time.Hour)
	a = e.ask(v.ID)
	if a.Fresh != FreshWaiting || a.FreshLine != "Checking now; the result shows on the bot" || e.waitingChecks(v.ID) != 1 {
		t.Fatalf("waiting %q %q, %d checks queued", a.Fresh, a.FreshLine, e.waitingChecks(v.ID))
	}
	e.now = e.now.Add(2 * time.Minute)
	a = e.ask(v.ID)
	if a.Fresh != FreshLimited || a.FreshLine != "Checking now for an earlier tag; the result shows on the bot" || e.waitingChecks(v.ID) != 1 {
		t.Fatalf("limited %q %q", a.Fresh, a.FreshLine)
	}
	if at := e.askedAt(v.ID); at == nil || !at.Equal(e.now.Add(-2*time.Minute)) {
		t.Fatalf("a limited tag moved asked_at to %v", at)
	}
	// The earlier tag's check went nowhere (it lost its job): still
	// limited until 5 minutes pass, then the next tag checks.
	must(t, e.db.Model(&models.Job{}).Where("dedupe_key = ?", checkKey(v.ID)).Update("status", models.JobCancelled).Error)
	e.now = e.now.Add(time.Minute)
	// No check ran since that tag asked, so the answer does not claim one.
	if a = e.ask(v.ID); a.Fresh != FreshLimited || a.FreshLine != "An earlier tag asked for a check 3 min ago. Tag it again in a few minutes if nothing shows" {
		t.Fatalf("limited %q %q", a.Fresh, a.FreshLine)
	}
	e.now = e.now.Add(3 * time.Minute)
	stop = e.worker()
	a = e.ask(v.ID)
	stop()
	if a.Fresh != FreshCheckedNow {
		t.Fatalf("after 5 minutes %q %q", a.Fresh, a.FreshLine)
	}
	if n := e.count("bot_checks", "bot_id = ? AND trigger = ?", v.ID, TriggerAsk); n != 2 {
		t.Fatalf("%d checks by tags", n)
	}

	// Paused: answered from the last check, with no check.
	_, err := e.s.Pause(context.Background(), e.user, v.ID, PausePerson)
	must(t, err)
	e.now = e.now.Add(48 * time.Hour)
	a = e.ask(v.ID)
	if a.Fresh != FreshPaused || a.FreshLine != "Paused, so this is from Nov 6" || a.Bot.Status != StatusPaused || e.waitingChecks(v.ID) != 0 {
		t.Fatalf("paused %q %q %+v", a.Fresh, a.FreshLine, a.Bot)
	}
	fresh := e.create(Input{Name: "Never", Watches: []WatchInput{{Kind: WatchFeed, URL: askFeedURL}}})
	_, err = e.s.Pause(context.Background(), e.user, fresh.ID, PausePerson)
	must(t, err)
	if a = e.ask(fresh.ID); a.Fresh != FreshPaused || a.FreshLine != "Paused, and not checked yet" || a.CheckedAt != nil {
		t.Fatalf("never checked %q %q", a.Fresh, a.FreshLine)
	}

	if _, err := e.s.Ask(context.Background(), e.user, "no such bot"); err != ErrNotFound {
		t.Fatalf("unknown bot: %v", err)
	}
	if _, err := e.s.Ask(context.Background(), addUser(t, e.db), v.ID); err != ErrNotFound {
		t.Fatalf("another account's bot: %v", err)
	}
}

// A shop page is read at most every 6 hours, so a tag 2 hours after its
// last check starts none, and leaves the 5 minutes for the next tag.
func TestIntegrationBotAskFloor(t *testing.T) {
	e, _ := askEngine(t)
	e.zone(models.NotificationSettings{Timezone: "Asia/Kolkata"})
	v := e.create(Input{Name: "Headphones", Watches: []WatchInput{{Kind: WatchPage, URL: askShopURL, Read: ReadProductPrice}}})
	must(t, e.run(v.ID))
	e.now = e.now.Add(2 * time.Hour)
	b := e.bot(v.ID)
	want := maxTime(spacedAt(b.CheckStartedAt, MinProductEvery), b.NextCheckAt.UTC())
	kolkata, err := time.LoadLocation("Asia/Kolkata")
	must(t, err)

	a := e.ask(v.ID)
	if a.Fresh != FreshFloor || a.FreshLine != "Shop prices are checked every 6 hours at most. Next check "+want.In(kolkata).Format("15:04") {
		t.Fatalf("floor %q %q", a.Fresh, a.FreshLine)
	}
	if a.NextCheckAt == nil || !a.NextCheckAt.Equal(want) {
		t.Fatalf("next check %v, want %v", a.NextCheckAt, want)
	}
	if e.askedAt(v.ID) != nil || e.waitingChecks(v.ID) != 0 {
		t.Fatal("a floor answer took the 5 minutes or queued a check")
	}
	w := a.Watches[0]
	if w.Value == nil || *w.Value != 19999 || w.Currency != "INR" || w.Summary != "₹19,999" || w.Site != "shop.example" {
		t.Fatalf("shop watch %+v", w)
	}
}

// A check a tag starts is a normal check: a Bot that has sent its alerts
// for the day holds the new one under the cap.
func TestIntegrationBotAskCountsTowardAlerts(t *testing.T) {
	e, n := askEngine(t)
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	must(t, e.run(v.ID))
	day := time.Date(e.now.Year(), e.now.Month(), e.now.Day(), 0, 0, 0, 0, time.UTC)
	for i := range AlertsPerDay {
		must(t, e.db.Create(&Alert{ID: utils.PrefixedUUID("bal"), BotID: v.ID, UserID: e.user, Kind: alertKindAlert, LocalDay: day,
			Title: "BTC dip: earlier", Figures: jsonMap[string, any]{}, CreatedAt: e.now.Add(time.Duration(i) * time.Minute)}).Error)
	}
	e.now = e.now.Add(2 * time.Hour)
	n.Set(coinbaseBTC, botstest.JSON(`{"data":{"amount":"24000.00","base":"BTC","currency":"USD"}}`))
	stop := e.worker()
	a := e.ask(v.ID)
	stop()
	if a.Fresh != FreshCheckedNow || a.AlertsToday != AlertsPerDay {
		t.Fatalf("ask %q %q, %d alerts today", a.Fresh, a.FreshLine, a.AlertsToday)
	}
	if c := e.lastCheck(v.ID); c.Trigger != TriggerAsk || c.Outcome != outFired {
		t.Fatalf("check %s %s", c.Trigger, c.Outcome)
	}
	if n := e.count("bot_alerts", "bot_id = ? AND kind = 'alert' AND held = 'cap'", v.ID); n != 1 {
		t.Fatalf("%d capped alerts", n)
	}
	ntfs := e.notifications()
	if len(ntfs) != 1 || ntfs[0].Title != "BTC dip: and 1 more today" {
		t.Fatalf("notifications %+v", ntfs)
	}
	if w := a.Watches[0]; w.Value == nil || *w.Value != 24000 || w.Title != "BTC-USD · Coinbase" {
		t.Fatalf("watch %+v", w)
	}
}

// A check job a tag queued passes the claim of a Bot that is not due, as
// run now does; a scheduled one does not. A waiting check keeps a run-now
// trigger, so Run now after a tag (or a tag after Run now) adds no job.
func TestIntegrationBotAskClaim(t *testing.T) {
	e, _ := askEngine(t)
	ctx := context.Background()
	v := e.create(Input{Name: "Feed", IntervalMinutes: 360, Watches: []WatchInput{{Kind: WatchFeed, URL: askFeedURL}}})
	must(t, e.run(v.ID))
	e.now = e.now.Add(time.Hour)

	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerSchedule)))
	if n := e.count("bot_checks", "bot_id = ?", v.ID); n != 1 {
		t.Fatalf("a scheduled check of a Bot not due ran: %d checks", n)
	}
	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerAsk)))
	if n := e.count("bot_checks", "bot_id = ? AND trigger = ?", v.ID, TriggerAsk); n != 1 {
		t.Fatalf("%d ask checks", n)
	}

	e.now = e.now.Add(time.Hour)
	b := e.bot(v.ID)
	job, err := e.s.queueCheck(b, MinPageEvery, TriggerAsk, e.now)
	must(t, err)
	res, err := e.s.RunNow(ctx, e.user, v.ID, OriginApp)
	must(t, err)
	var row models.Job
	must(t, e.db.Where("id = ?", job.ID).First(&row).Error)
	if res.JobID != job.ID || row.Payload.String("trigger") != TriggerAsk || e.waitingChecks(v.ID) != 1 {
		t.Fatalf("run now after a tag: job %s, trigger %s", res.JobID, row.Payload.String("trigger"))
	}
}

// Every migration of the Bots page goes down and up again: the hand-written
// constraint names and the Down data fixes hold.
func TestIntegrationBotMigrationsDownUp(t *testing.T) {
	const beforeBoard = 20261106222047 // the last migration before bots_board
	const beforeLinks = 20261107154900 // the last migration before bot_links
	db := migratedDB(t)
	sqlDB, err := db.DB()
	must(t, err)
	user := addUser(t, db)
	exec := func(q string, args ...any) {
		t.Helper()
		must(t, db.Exec(q, args...).Error)
	}
	// Rows each Down must clear or rewrite first.
	exec(`INSERT INTO bots (id, user_id, name, origin, interval_seconds, next_check_at, asked_at, suggestion, suggestion_dismissed_at)
		VALUES ('bot_m', ?, 'M', 'app', 21600, now(), now(), '{"id": "bsg_m"}', now())`, user)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url, read_mode, selector) VALUES ('bw_m', 'bot_m', ?, 'page', 'https://shop.example/', 'selector_price', '#price')`, user)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES ('bchk_m', 'bot_m', ?, 'ask', now(), now(), 'unchanged')`, user)
	must(t, db.Create(&models.Job{ID: "job_m", UserID: user, Kind: models.JobBotIcon, Status: models.JobPending, Payload: models.JobPayload{},
		RunAt: time.Now(), MaxAttempts: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error)
	exec(`INSERT INTO bot_site_icons (site, fetched_at, used_at) VALUES ('shop.example', now(), now())`)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES
		('bchk_quiet', 'bot_m', ?, 'schedule', now(), now(), 'judged_quiet'), ('bchk_passed', 'bot_m', ?, 'schedule', now(), now(), 'passed')`, user, user)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, held, local_day, title, ai_state, ai_why, urgency) VALUES
		('bal_judged', 'bot_m', ?, 'alert', 'judged', '2026-11-07', 'M: up 2.0%', 'judged', 'Small', 'low'),
		('bal_kept', 'bot_m', ?, 'alert', '', '2026-11-07', 'M: up 3.0%', 'unchecked', 'AI was unavailable', 'normal')`, user, user)
	exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, local_day, purpose) VALUES ('bai_m', ?, 'bot_m', '2026-11-07', 'judge')`, user)
	exec(`UPDATE bot_alerts SET things = '[{"key": "page:https://shop.example/", "urgency": "normal"}]', also_seen_by = '[{"botId": "bot_m", "name": "M"}]' WHERE id = 'bal_kept'`)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, held, local_day, title, shared_with) VALUES
		('bal_shared', 'bot_m', ?, 'alert', 'shared', '2026-11-07', 'M: page changed', 'bal_kept')`, user)
	exec(`INSERT INTO bot_findings (id, bot_id, user_id, kind, title, urgency, thing_key) VALUES ('bfd_m', 'bot_m', ?, 'item', 'Story', 'normal', 'link:https://shop.example/1')`, user)
	must(t, db.Create(&models.Job{ID: "job_judge", UserID: user, Kind: models.JobBotJudge, Status: models.JobPending, Payload: models.JobPayload{},
		RunAt: time.Now(), MaxAttempts: 3, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error)
	exec(`INSERT INTO bots (id, user_id, name, origin, interval_seconds, next_check_at) VALUES ('bot_m2', ?, 'M2', 'app', 900, now())`, user)
	exec(`INSERT INTO bot_links (id, user_id, kind, from_bot_id, to_bot_id, filter) VALUES ('blk_m', ?, 'pass', 'bot_m', 'bot_m2', '["NVMe"]')`, user)
	exec(`INSERT INTO bot_passes (id, user_id, link_id, from_bot_id, to_bot_id, chain_id, depth, local_day, state) VALUES ('bps_m', ?, 'blk_m', 'bot_m', 'bot_m2', 'bchk_m', 1, '2026-11-07', 'pending')`, user)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES ('bchk_pass', 'bot_m2', ?, 'pass', now(), now(), 'fired')`, user)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, feedback, feedback_at, feedback_reason, via) VALUES
		('bal_passed', 'bot_m2', ?, 'alert', '2026-11-07', 'M2: price changed', 'not_useful', now(), 'not_passed', '[{"botId": "bot_m", "name": "M", "linkId": "blk_m", "title": "Story"}]')`, user)
	exec(`INSERT INTO bot_findings (id, bot_id, user_id, kind, title, urgency, chain_id, depth, source_finding_id) VALUES ('bfd_m2', 'bot_m2', ?, 'change', 'Story', 'normal', 'bchk_m', 1, 'bfd_m')`, user)

	// Pass to's Down first, while the columns it rewrites still exist.
	must(t, goose.DownTo(sqlDB, ".", beforeLinks))
	var cols []string
	var tables []string
	if count(t, db, "bot_checks", "id = 'bchk_pass' AND trigger = 'run_now'") != 1 {
		t.Fatal("the pass check was not rewritten as run now")
	}
	if count(t, db, "bot_alerts", "id = 'bal_passed' AND feedback = 'not_useful' AND feedback_reason = ''") != 1 {
		t.Fatal("the not_passed rating was not cleared")
	}
	must(t, db.Raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('bot_links', 'bot_passes')`).Scan(&tables).Error)
	if len(tables) != 0 {
		t.Fatalf("pass tables left after Down: %v", tables)
	}
	must(t, db.Raw(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
		AND ((table_name = 'bot_alerts' AND column_name = 'via') OR (table_name = 'bot_findings' AND column_name IN ('chain_id', 'depth', 'source_finding_id')))`).Scan(&cols).Error)
	if len(cols) != 0 {
		t.Fatalf("pass columns left after Down: %v", cols)
	}

	must(t, goose.DownTo(sqlDB, ".", beforeBoard))
	must(t, db.Raw(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bots' AND column_name IN ('asked_at', 'origin_client', 'suggestion', 'suggestion_dismissed_at')`).Scan(&cols).Error)
	if len(cols) != 0 {
		t.Fatalf("columns left after Down: %v", cols)
	}
	must(t, db.Raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('bot_source_keys', 'bot_site_icons')`).Scan(&tables).Error)
	if len(tables) != 0 {
		t.Fatalf("tables left after Down: %v", tables)
	}
	if n := count(t, db, "bot_checks", "id = 'bchk_m' AND trigger = 'run_now'"); n != 1 {
		t.Fatal("the ask check was not rewritten as run now")
	}
	if count(t, db, "bot_watches", "id = 'bw_m'") != 0 || count(t, db, "jobs", "id = 'job_m'") != 0 {
		t.Fatal("rows the old constraints refuse are still there")
	}
	if count(t, db, "bot_checks", "id IN ('bchk_quiet', 'bchk_passed') AND outcome = 'fired'") != 2 {
		t.Fatal("judged and passed checks were not rewritten as fired")
	}
	if count(t, db, "bot_alerts", "id = 'bal_judged'") != 0 || count(t, db, "bot_alerts", "id = 'bal_kept'") != 1 || count(t, db, "jobs", "id = 'job_judge'") != 0 {
		t.Fatal("a held judged alert or a re-judge job survived the Down")
	}
	if count(t, db, "bot_alerts", "id = 'bal_shared'") != 0 || count(t, db, "bot_findings", "id = 'bfd_m'") != 1 {
		t.Fatal("a held shared alert survived the Down, or a note did not")
	}
	must(t, db.Raw(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
		AND ((table_name = 'bot_alerts' AND column_name IN ('things', 'also_seen_by', 'shared_with')) OR (table_name = 'bot_findings' AND column_name = 'thing_key'))`).Scan(&cols).Error)
	if len(cols) != 0 {
		t.Fatalf("one alert per thing left columns after Down: %v", cols)
	}
	must(t, db.Raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'bot_ai_calls'`).Scan(&tables).Error)
	if len(tables) != 0 {
		t.Fatal("bot_ai_calls left after Down")
	}

	must(t, goose.Up(sqlDB, "."))
	exec(`INSERT INTO bot_links (id, user_id, kind, from_bot_id, to_bot_id) VALUES ('blk_m2', ?, 'pass', 'bot_m', 'bot_m2')`, user)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES ('bchk_pass2', 'bot_m2', ?, 'pass', now(), now(), 'passed')`, user)
	exec(`UPDATE bot_alerts SET feedback_reason = 'not_passed' WHERE id = 'bal_passed'`)
	if count(t, db, "bot_alerts", "id = 'bal_passed' AND via = '[]'::jsonb") != 1 || count(t, db, "bot_findings", "id = 'bfd_m2' AND chain_id = '' AND depth = 0") != 1 {
		t.Fatal("the pass columns came back without their defaults")
	}
	exec(`UPDATE bots SET asked_at = now(), origin_client = 'Claude Code', suggestion = '{"id": "bsg_m"}', suggestion_dismissed_at = now() WHERE id = 'bot_m'`)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES ('bchk_m2', 'bot_m', ?, 'ask', now(), now(), 'unchanged')`, user)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url, read_mode, selector) VALUES ('bw_m2', 'bot_m', ?, 'page', 'https://shop.example/', 'selector_price', '#price')`, user)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES ('bchk_quiet2', 'bot_m', ?, 'schedule', now(), now(), 'judged_quiet')`, user)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, held, local_day, title, ai_state, urgency) VALUES ('bal_judged2', 'bot_m', ?, 'alert', 'judged', '2026-11-07', 'M', 'rejudged', 'high')`, user)
	exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, local_day, purpose) VALUES ('bai_m2', ?, 'bot_m', '2026-11-07', 'rejudge')`, user)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, held, local_day, title, shared_with) VALUES
		('bal_shared2', 'bot_m', ?, 'alert', 'shared', '2026-11-07', 'M: page changed', 'bal_kept')`, user)
	if count(t, db, "bot_alerts", "id = 'bal_kept' AND things = '[]'::jsonb AND also_seen_by = '[]'::jsonb") != 1 || count(t, db, "bot_findings", "id = 'bfd_m' AND thing_key = ''") != 1 {
		t.Fatal("the columns came back without their defaults")
	}
}
