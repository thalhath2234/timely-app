package bots

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"timely-api/internal/models"
)

// "Pause all bots" holds every Bot of the account still: the sweep queues
// nothing, a queued check ends unclaimed, a passed item folds, a re-judge
// stops, and Run now and Ask answer 409. Each Bot keeps its own status, and
// turning it off lets due Bots run.
func TestIntegrationBotPauseAll(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	e.net.serve(dealsPage, 200, "text/html", "<html><body><p>Drives we like</p></body></html>")
	e.net.serve(itemPrefix+"2", 200, "text/html", "<html><body><p>Samsung 990 EVO 2TB NVMe</p></body></html>")
	pp := e.dealsPair(Input{Name: "Price check", Watches: []WatchInput{{Kind: WatchPage, URL: dealsPage,
		Rules: []Rule{{Kind: RuleWordsAppear, Words: []string{"NVMe"}}}}}}, "NVMe")
	other := e.create(pageInput("Other", "https://other.example.com/"))
	e.net.serve("https://other.example.com/", 200, "text/html", "<p>hello</p>")
	mine := addUser(t, e.db) // another account's Bot keeps running
	must(t, e.db.Create(&models.Config{ID: "cfg_" + mine, UserID: mine}).Error)
	theirs, err := e.s.Create(ctx, mine, pageInput("Theirs", "https://theirs.example.com/"), OriginApp)
	must(t, err)

	// A's next check passes an item on; the pass waits as a job.
	*pp.feed = feedOf([2]string{"2", "Samsung 990 EVO 2TB NVMe"}, [2]string{"1", "Old news"})
	e.again(pp.a.ID)
	if n := len(e.passes("state = ?", passPending)); n != 1 {
		t.Fatalf("%d pending passes", n)
	}

	if code, body := call(t, e.s, e.user, http.MethodPut, "/bots/paused", map[string]any{}); code != http.StatusBadRequest {
		t.Fatalf("no paused %d %v", code, body)
	}
	if code, body := call(t, e.s, e.user, http.MethodPut, "/bots/paused", map[string]any{"paused": true}); code != http.StatusOK || body["allPaused"] != true {
		t.Fatalf("pause all %d %v", code, body)
	}
	var cfg models.Config
	must(t, e.db.Where("user_id = ?", e.user).First(&cfg).Error)
	if cfg.BotsPausedAt == nil {
		t.Fatal("bots_paused_at not set")
	}
	pausedAt := *cfg.BotsPausedAt
	// Again keeps the first time.
	e.now = e.now.Add(time.Minute)
	if _, err := e.s.SetAllPaused(ctx, e.user, true); err != nil {
		t.Fatal(err)
	}
	cfg = models.Config{}
	must(t, e.db.Where("user_id = ?", e.user).First(&cfg).Error)
	if cfg.BotsPausedAt == nil || !cfg.BotsPausedAt.Equal(pausedAt) {
		t.Fatalf("paused at moved: %v, was %v", cfg.BotsPausedAt, pausedAt)
	}
	code, body := call(t, e.s, e.user, http.MethodGet, "/bots", nil)
	summary, _ := body["summary"].(map[string]any)
	if code != http.StatusOK || summary["allPaused"] != true {
		t.Fatalf("board %d %v", code, summary)
	}
	for _, b := range body["bots"].([]any) {
		if st := b.(map[string]any)["status"]; st != StatusActive {
			t.Fatalf("a Bot's own status changed: %v", b)
		}
	}

	// The passed item folds instead of running.
	ran := e.passJobs()
	if len(ran) != 1 || e.pass(ran[0]).State != passFolded || e.pass(ran[0]).CheckID != nil {
		t.Fatalf("pass while paused %v", ran)
	}

	// The sweep queues nothing of this account; the other account's runs.
	must(t, e.db.Exec(`DELETE FROM jobs`).Error)
	must(t, e.db.Model(&Bot{}).Where("id IN ?", []string{other.ID, theirs.ID}).Update("next_check_at", e.now.Add(-time.Minute)).Error)
	must(t, e.s.Sweep(ctx))
	var queued []models.Job
	must(t, e.db.Where("kind = ?", models.JobBotCheck).Find(&queued).Error)
	if len(queued) != 1 || queued[0].Payload.String("botId") != theirs.ID {
		t.Fatalf("queued while paused %+v", queued)
	}

	// A check queued before the pause ends unclaimed; the Bot stays due.
	before := e.bot(other.ID)
	checks := e.count("bot_checks", "bot_id = ?", other.ID)
	must(t, e.s.HandleCheck(ctx, e.job(other.ID, TriggerRunNow)))
	after := e.bot(other.ID)
	if e.count("bot_checks", "bot_id = ?", other.ID) != checks || after.CheckingJobID != nil || after.CheckStartedAt != nil && !after.CheckStartedAt.Equal(*before.CheckStartedAt) ||
		!after.NextCheckAt.Equal(*before.NextCheckAt) {
		t.Fatalf("a queued check ran while paused: %+v", after)
	}

	// Run now and Ask answer 409 with the line; a missing Bot is still 404.
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+other.ID+"/run", nil); code != http.StatusConflict || body["message"] != ErrAllPaused.Error() {
		t.Fatalf("run now while paused %d %v", code, body)
	}
	if _, err := e.s.RunNow(ctx, e.user, "no such bot", OriginApp); !errors.Is(err, ErrNotFound) {
		t.Fatalf("run now on a missing bot %v", err)
	}
	if _, err := e.s.Ask(ctx, e.user, other.ID); !errors.Is(err, ErrAllPaused) {
		t.Fatalf("ask while paused %v", err)
	}

	// Turned off: the due Bot is queued and runs.
	if code, body := call(t, e.s, e.user, http.MethodPut, "/bots/paused", map[string]any{"paused": false}); code != http.StatusOK || body["allPaused"] != false {
		t.Fatalf("resume all %d %v", code, body)
	}
	cfg = models.Config{}
	must(t, e.db.Where("user_id = ?", e.user).First(&cfg).Error)
	if cfg.BotsPausedAt != nil {
		t.Fatal("bots_paused_at still set")
	}
	e.now = e.now.Add(10 * time.Second)
	must(t, e.s.Sweep(ctx))
	var job models.Job
	must(t, e.db.Where("kind = ? AND dedupe_key = ?", models.JobBotCheck, checkKey(other.ID)).First(&job).Error)
	e.now = maxTime(e.now, job.RunAt)
	must(t, e.s.HandleCheck(ctx, &job))
	if e.count("bot_checks", "bot_id = ?", other.ID) != checks+1 {
		t.Fatal("the due Bot did not run after Pause all was turned off")
	}
	if _, err := e.s.Ask(ctx, e.user, other.ID); err != nil {
		t.Fatalf("ask after %v", err)
	}
}

// A re-judge stops while "Pause all bots" is on: no AI call, the stored
// input is dropped and the alert stays unchecked.
func TestIntegrationBotPauseAllStopsRejudge(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC paused", &amount)
	fj.set(Verdict{}, errors.New("provider overloaded"))
	amount = "102.00"
	e.again(v.ID)
	a := e.alertRow(e.lastCheck(v.ID).ID)
	if a.AIState != aiUnchecked || len(a.AIInput) == 0 {
		t.Fatalf("unchecked alert %+v", a)
	}
	calls := len(fj.calls())
	_, err := e.s.SetAllPaused(ctx, e.user, true)
	must(t, err)
	fj.set(Verdict{Alert: false, Why: "Noise"}, nil)
	must(t, e.s.HandleRejudge(ctx, e.rejudgeJob(a.ID)))
	a = e.alertRow(e.lastCheck(v.ID).ID)
	if len(fj.calls()) != calls || a.AIState != aiUnchecked || len(a.AIInput) != 0 {
		t.Fatalf("re-judge while paused: %d calls, alert %+v", len(fj.calls())-calls, a)
	}
}

// The board's summary carries today's passed items and every link of the
// account.
func TestIntegrationBotSummaryLinks(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	code, body := call(t, e.s, e.user, http.MethodGet, "/bots", nil)
	summary, _ := body["summary"].(map[string]any)
	if links, ok := summary["links"].([]any); code != http.StatusOK || !ok || len(links) != 0 || summary["passedToday"] != float64(0) || summary["allPaused"] != false {
		t.Fatalf("empty board %d %v", code, summary)
	}

	e.net.serve(dealsPage, 200, "text/html", "<html><body><p>Drives we like</p></body></html>")
	pp := e.dealsPair(Input{Name: "Price check", Watches: []WatchInput{{Kind: WatchPage, URL: dealsPage,
		Rules: []Rule{{Kind: RuleWordsAppear, Words: []string{"NVMe"}}}}}})
	*pp.feed = feedOf([2]string{"3", "Crucial P3"}, [2]string{"2", "Samsung 990"}, [2]string{"1", "Old news"})
	e.again(pp.a.ID)
	list, err := e.s.List(context.Background(), e.user)
	must(t, err)
	s := list.Summary
	if s.PassedToday != 2 || len(s.Links) != 1 || s.Links[0].ID != pp.link.ID || s.Links[0].PassedToday != 2 || s.AllPaused {
		t.Fatalf("summary %+v", s)
	}
	raw, _ := json.Marshal(s)
	var keys map[string]any
	must(t, json.Unmarshal(raw, &keys))
	for _, k := range []string{"allPaused", "passedToday", "links"} {
		if _, ok := keys[k]; !ok {
			t.Fatalf("summary has no %q: %s", k, raw)
		}
	}
}

// A page price Bot made over MCP shows its site's currency before any
// check; an edit without a currency keeps it, one with a currency saves it,
// and neither starts a new baseline. Moving to another country's site takes
// that site's currency.
func TestIntegrationBotPageCurrencyHint(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	u := "https://www.amazon.in/dp/B0TEST"
	v, err := e.s.Create(ctx, e.user, Input{Name: "Headphones", Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadProductPrice}}}, OriginMCP)
	must(t, err)
	if v.Watches[0].Currency != "INR" || v.Watches[0].LastReadingAt != nil {
		t.Fatalf("made over MCP %+v", v.Watches[0])
	}
	d, err := e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	if d.Watches[0].Currency != "INR" {
		t.Fatalf("get %+v", d.Watches[0])
	}
	w0 := e.watchRow(v.Watches[0].ID)

	// No currency sent: the hint stays, nothing rebaselines.
	ws := []WatchInput{{ID: w0.ID, Kind: WatchPage, URL: u, Read: ReadProductPrice}}
	v, err = e.s.Update(ctx, e.user, v.ID, Patch{Watches: &ws}, OriginMCP)
	must(t, err)
	if w := e.watchRow(w0.ID); w.Currency != "INR" || w.ConfigVersion != w0.ConfigVersion || v.Watches[0].Currency != "INR" {
		t.Fatalf("an edit without a currency %+v", w)
	}

	// EUR sent: saved, still no rebaseline.
	ws[0].Currency = "EUR"
	v, err = e.s.Update(ctx, e.user, v.ID, Patch{Watches: &ws}, OriginMCP)
	must(t, err)
	if w := e.watchRow(w0.ID); w.Currency != "EUR" || w.ConfigVersion != w0.ConfigVersion || v.Watches[0].Currency != "EUR" {
		t.Fatalf("an edit with EUR %+v", w)
	}

	// Moving to amazon.de with no currency takes the site's EUR over the
	// GBP it had.
	ws[0].Currency = "GBP"
	_, err = e.s.Update(ctx, e.user, v.ID, Patch{Watches: &ws}, OriginMCP)
	must(t, err)
	ws[0].Currency, ws[0].URL = "", "https://www.amazon.de/dp/B0TEST"
	v, err = e.s.Update(ctx, e.user, v.ID, Patch{Watches: &ws}, OriginMCP)
	must(t, err)
	if w := e.watchRow(w0.ID); w.Currency != "EUR" || w.ConfigVersion == w0.ConfigVersion || v.Watches[0].Currency != "EUR" {
		t.Fatalf("moved to amazon.de %+v", w)
	}

	// A check never writes it, even when the page shows another currency.
	e.net.serve("https://www.amazon.de/dp/B0TEST", 200, "text/html",
		`<html><head><script type="application/ld+json">{"@type":"Product","name":"Headphones","offers":{"@type":"Offer","price":"199.00","priceCurrency":"USD"}}</script></head></html>`)
	_, err = e.s.Resume(ctx, e.user, v.ID, OriginApp)
	must(t, err)
	must(t, e.run(v.ID))
	w := e.watchRow(w0.ID)
	if w.Currency != "EUR" || w.LastReading == nil || w.LastReading.Currency != "USD" {
		t.Fatalf("after a check %+v %+v", w, w.LastReading)
	}
	// The view keeps the hint and names the currency the page showed, which
	// the clients put first for a page once it has been read.
	if v.Watches[0].ReadingCurrency != "" {
		t.Fatalf("read before any check %+v", v.Watches[0])
	}
	d, err = e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	if wv := d.Watches[0]; wv.Currency != "EUR" || wv.ReadingCurrency != "USD" || wv.Summary != "$199" {
		t.Fatalf("view after a check %+v", wv)
	}
}

func (e *engine) watchRow(id string) Watch {
	e.t.Helper()
	var w Watch
	must(e.t, e.db.Where("id = ?", id).First(&w).Error)
	return w
}
