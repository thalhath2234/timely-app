package bots

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// jobsEnqueue is a check job for botID at runAt, as a sweep queues one.
func jobsEnqueue(user, botID string, runAt time.Time, trigger string) jobs.Enqueue {
	return jobs.Enqueue{UserID: user, Kind: models.JobBotCheck, DedupeKey: checkKey(botID), MaxAttempts: checkAttempts, RunAt: runAt,
		Payload: models.JobPayload{"botId": botID, "trigger": trigger}}
}

// lateBots inserts n active page Bots for user straight into the table, the
// i-th due at first + i*step, and returns their ids in that order.
func lateBots(t *testing.T, e *engine, user string, n int, first time.Time, step time.Duration, prefix string) []string {
	t.Helper()
	ids := make([]string, n)
	for i := range n {
		ids[i] = fmt.Sprintf("bot_%s_%03d", prefix, i)
		must(t, e.db.Exec(`INSERT INTO bots (id, user_id, name, origin, status, interval_seconds, next_check_at, health, health_detail)
			VALUES (?, ?, ?, 'app', 'active', 900, ?, 'working', '')`, ids[i], user, fmt.Sprintf("%s %d", prefix, i), first.Add(time.Duration(i)*step)).Error)
	}
	return ids
}

// pendingChecks are the waiting check jobs, earliest first.
func (e *engine) pendingChecks() []models.Job {
	e.t.Helper()
	var out []models.Job
	must(e.t, e.db.Where("kind = ? AND status = ?", models.JobBotCheck, models.JobPending).Order("run_at, id").Find(&out).Error)
	return out
}

// checkJob is the Bot's waiting check job.
func (e *engine) checkJob(botID string) models.Job {
	e.t.Helper()
	var j models.Job
	must(e.t, e.db.Where("dedupe_key = ? AND status = ?", checkKey(botID), models.JobPending).First(&j).Error)
	return j
}

// runJob runs a queued check at its time, as the worker would.
func (e *engine) runJob(j models.Job) {
	e.t.Helper()
	e.now = maxTime(e.now, j.RunAt)
	j.Attempts = 1
	must(e.t, e.s.HandleCheck(context.Background(), &j))
	must(e.t, e.db.Model(&models.Job{}).Where("id = ?", j.ID).Update("status", models.JobSucceeded).Error)
}

// markAwayRow gives a Bot a gap it has not caught up on, as the sweep does.
func (e *engine) markAwayRow(botID string, d time.Duration, reason string) {
	e.t.Helper()
	must(e.t, e.db.Exec(`UPDATE bots SET away_since = ?, away_until = ?, away_reason = ? WHERE id = ?`, e.now.Add(-d), e.now, reason, botID).Error)
}

// awayAlerts are the account's "Bots were paused" notifications.
func awayAlerts(t *testing.T, e *engine, user string) []models.Notification {
	t.Helper()
	var out []models.Notification
	must(t, e.db.Where("user_id = ? AND category = ? AND data->>'botAlert' = ?", user, models.NotifyBot, awayKind).Order("created_at, id").Find(&out).Error)
	return out
}

func assertRising(t *testing.T, js []models.Job, start time.Time) {
	t.Helper()
	for i, j := range js {
		if j.Payload.String("trigger") != TriggerWake {
			t.Fatalf("job %d trigger %s", i, j.Payload.String("trigger"))
		}
		if i == 0 {
			if j.RunAt.Before(start.Add(WakeSettle + WakeStep)) {
				t.Fatalf("the first wake check starts %v after the sweep", j.RunAt.Sub(start))
			}
			continue
		}
		if gap := j.RunAt.Sub(js[i-1].RunAt); gap < WakeStep/2 {
			t.Fatalf("jobs %d and %d start %v apart", i-1, i, gap)
		}
	}
}

// The first sweep of a process marks every active Bot at least 30 minutes
// late as away while Timely was closed; a later gap in the same process is
// "asleep" and keeps a gap not caught up on. A Bot 20 minutes late and a
// paused Bot are not marked, and with every marked Bot's Phone off the away
// alert stays off the phone.
func TestIntegrationBotAwayMark(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	late := lateBots(t, e, e.user, 1, e.now.Add(-9*time.Hour), 0, "Late")[0]
	recent := lateBots(t, e, e.user, 1, e.now.Add(-20*time.Minute), 0, "Recent")[0]
	paused := lateBots(t, e, e.user, 1, e.now.Add(-9*time.Hour), 0, "Paused")[0]
	must(t, e.db.Exec(`UPDATE bots SET status = 'paused', pause_reason = 'person', next_check_at = NULL WHERE id = ?`, paused).Error)
	must(t, e.db.Exec(`UPDATE bots SET notify_phone = false WHERE user_id = ?`, e.user).Error)
	e.s.lastPrune = e.now

	must(t, e.s.Sweep(ctx))
	b := e.bot(late)
	if b.AwayReason == nil || *b.AwayReason != AwayClosed || !b.AwaySince.Equal(e.now.Add(-9*time.Hour)) || !b.AwayUntil.Equal(e.now) {
		t.Fatalf("late Bot away %v %v %v", b.AwaySince, b.AwayUntil, b.AwayReason)
	}
	for _, id := range []string{recent, paused} {
		if b := e.bot(id); b.AwaySince != nil || b.AwayReason != nil {
			t.Fatalf("%s was marked", id)
		}
	}
	if j := e.checkJob(recent); j.Payload.String("trigger") != TriggerWake {
		t.Fatalf("a check after a wake has trigger %s", j.Payload.String("trigger"))
	}
	ntfs := awayAlerts(t, e, e.user)
	if len(ntfs) != 1 || ntfs[0].Body != "Timely was closed. 1 bot is checking now." || ntfs[0].Title != "Bots were paused for 9 hours" ||
		ntfs[0].Data["phone"] != false {
		t.Fatalf("away alerts %+v", ntfs)
	}

	// The computer sleeps two hours: a newly late Bot is away while asleep,
	// the late one keeps its start and reason, and is away until now.
	asleep := lateBots(t, e, e.user, 1, e.now.Add(-time.Minute), 0, "Asleep")[0]
	e.now = e.now.Add(2 * time.Hour)
	e.s.lastSweepWall = e.now.Add(-2 * time.Hour)
	must(t, e.s.Sweep(ctx))
	if b := e.bot(asleep); b.AwayReason == nil || *b.AwayReason != AwayAsleep || !b.AwaySince.Equal(e.now.Add(-2*time.Hour-time.Minute)) {
		t.Fatalf("asleep Bot away %v %v", b.AwaySince, b.AwayReason)
	}
	if b := e.bot(late); *b.AwayReason != AwayClosed || !b.AwaySince.Equal(e.now.Add(-11*time.Hour)) || !b.AwayUntil.Equal(e.now) {
		t.Fatalf("late Bot after a second gap %v %v %v", b.AwaySince, b.AwayUntil, *b.AwayReason)
	}
	if e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotCheck) != 3 {
		t.Fatal("a Bot with a waiting check got another")
	}
}

// 25 overdue Bots get 25 checks, oldest first, each on the next slot of the
// tail.
func TestIntegrationBotWakeOneByOne(t *testing.T) {
	e := newEngine(t)
	ids := lateBots(t, e, e.user, 25, e.now.Add(-9*time.Hour), time.Minute, "Due")
	e.s.lastPrune = e.now
	start := e.now
	must(t, e.s.Sweep(context.Background()))
	js := e.pendingChecks()
	if len(js) != 25 {
		t.Fatalf("%d jobs", len(js))
	}
	for i, j := range js {
		if j.Payload.String("botId") != ids[i] {
			t.Fatalf("job %d checks %s, want %s", i, j.Payload.String("botId"), ids[i])
		}
	}
	assertRising(t, js, start)
	// 25 slots: about four minutes.
	if last := js[24].RunAt.Sub(start); last > WakeSettle+25*WakeStep+WakeStep/2 {
		t.Fatalf("the last check starts %v after the sweep", last)
	}
}

// 450 overdue Bots in 18 accounts take three sweeps of 200: a wake, then
// two plain ones that take the next rows (a Bot with a waiting check is
// skipped) and carry the tail on. Every Bot gets one check, the start times
// rise across the batches, and each account's away alert counts all 25 of
// its Bots.
func TestIntegrationBotWakeManyAccounts(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	const accounts, each = 18, 25
	users := []string{e.user}
	for len(users) < accounts {
		users = append(users, addUser(t, e.db))
	}
	due := map[string]time.Time{}
	first := e.now.Add(-9 * time.Hour)
	for k := range each {
		for u, user := range users {
			at := first.Add(time.Duration(k*accounts+u) * time.Second)
			id := lateBots(t, e, user, 1, at, 0, fmt.Sprintf("Many%02d_%02d", u, k))[0]
			due[id] = at
		}
	}
	e.s.lastPrune = e.now
	start := e.now
	for i, want := range []int{200, 400, 450} {
		if i > 0 {
			e.now = e.now.Add(10 * time.Second)
		}
		must(t, e.s.Sweep(ctx))
		if got := len(e.pendingChecks()); got != want {
			t.Fatalf("after sweep %d: %d jobs, want %d", i+1, got, want)
		}
	}
	js := e.pendingChecks()
	seen := map[string]bool{}
	for _, j := range js {
		id := j.Payload.String("botId")
		if seen[id] {
			t.Fatalf("%s has two checks", id)
		}
		seen[id] = true
	}
	if !sort.SliceIsSorted(js, func(a, b int) bool {
		return due[js[a].Payload.String("botId")].Before(due[js[b].Payload.String("botId")])
	}) {
		t.Fatal("checks do not start in the order the Bots were due")
	}
	assertRising(t, js, start)
	for _, user := range users {
		ntfs := awayAlerts(t, e, user)
		if len(ntfs) != 1 || ntfs[0].Body != "Timely was closed. 25 bots are checking now." {
			t.Fatalf("%s away alerts %+v", user, ntfs)
		}
	}
	if n := e.count("bots", "away_reason = ?", AwayClosed); n != accounts*each {
		t.Fatalf("%d Bots marked", n)
	}
}

// A check queued before the gap, whose time has passed, moves onto the tail
// as a wake check, ahead of the Bots the sweep queues; no second job.
func TestIntegrationBotWakeReslots(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	ids := lateBots(t, e, e.user, 2, e.now.Add(-9*time.Hour), time.Minute, "Queued")
	_, err := e.s.queue.Enqueue(jobsEnqueue(e.user, ids[1], e.now.Add(-9*time.Hour), TriggerSchedule))
	must(t, err)
	e.s.lastPrune = e.now
	start := e.now
	must(t, e.s.Sweep(ctx))
	js := e.pendingChecks()
	if len(js) != 2 || js[0].Payload.String("botId") != ids[1] || js[1].Payload.String("botId") != ids[0] {
		t.Fatalf("jobs %+v", js)
	}
	assertRising(t, js, start)
	if b := e.bot(ids[1]); b.AwayReason == nil {
		t.Fatal("the Bot with a waiting check was not marked")
	}
}

// A check the person asked for (Check now, a chat tag) waiting across a
// gap keeps its trigger and time: as a wake check it would lose the claim on
// a Bot that is not due, and never run.
func TestIntegrationBotWakeKeepsAskedChecks(t *testing.T) {
	for _, trigger := range []string{TriggerRunNow, TriggerAsk} {
		t.Run(trigger, func(t *testing.T) {
			e := newEngine(t)
			u := "https://asked.example.com/"
			e.net.serve(u, 200, "text/html", "<p>hello</p>")
			v := e.create(pageInput("Asked", u))
			must(t, e.db.Model(&Bot{}).Where("id = ?", v.ID).Update("next_check_at", e.now.Add(time.Hour)).Error)
			runAt := e.now.Add(-time.Minute)
			_, err := e.s.queue.Enqueue(jobsEnqueue(e.user, v.ID, runAt, trigger))
			must(t, err)
			e.s.lastPrune = e.now
			must(t, e.s.Sweep(context.Background()))
			j := e.checkJob(v.ID)
			if j.Payload.String("trigger") != trigger || !j.RunAt.Equal(runAt) {
				t.Fatalf("asked check moved to %v as %s", j.RunAt.Sub(e.now), j.Payload.String("trigger"))
			}
			e.runJob(j)
			if c := e.lastCheck(v.ID); c.Trigger != trigger || c.Outcome == outSuperseded {
				t.Fatalf("asked check %+v", c)
			}
		})
	}
}

// A Bot that keeps timing out never catches up, but a check that ran and
// failed ends its gap: the next gap is its own, with its own reason and
// length, and the account gets that gap's away alert.
func TestIntegrationBotWakeStuckBotSpansGaps(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	u := "https://slow.example.com/"
	e.net.set(u, func(*http.Request) (*http.Response, error) { return nil, context.DeadlineExceeded })
	stuck := e.create(pageInput("Slow", u)).ID
	must(t, e.db.Model(&Bot{}).Where("id = ?", stuck).Update("next_check_at", e.now.Add(-9*time.Hour)).Error)
	e.s.lastPrune = e.now
	must(t, e.s.Sweep(ctx)) // Timely was closed
	e.runJob(e.checkJob(stuck))
	if c, b := e.lastCheck(stuck), e.bot(stuck); c.Outcome != outOffline || b.AwaySince == nil {
		t.Fatalf("timed-out catch-up %+v, away %v", c, b.AwaySince)
	}

	// Two days of timeouts while Timely runs.
	for range 3 {
		e.now = e.bot(stuck).NextCheckAt.Add(time.Second)
		e.s.lastSweepWall = e.now.Add(-10 * time.Second)
		e.s.lastPrune = e.now
		must(t, e.s.Sweep(ctx))
		e.runJob(e.checkJob(stuck))
	}
	e.now = e.now.Add(2 * 24 * time.Hour)
	must(t, e.db.Model(&Bot{}).Where("id = ?", stuck).Update("last_check_at", e.now).Error)
	must(t, e.db.Model(&Bot{}).Where("id = ?", stuck).Update("next_check_at", e.now.Add(5*time.Minute)).Error)

	// The computer sleeps five hours.
	slept := e.now.Add(5 * time.Minute)
	fresh := lateBots(t, e, e.user, 3, slept, time.Minute, "Fresh")
	e.now = e.now.Add(5 * time.Hour)
	e.s.lastSweepWall = e.now.Add(-5 * time.Hour)
	e.s.lastPrune = e.now
	must(t, e.s.Sweep(ctx))
	b := e.bot(stuck)
	if b.AwayReason == nil || *b.AwayReason != AwayAsleep || !b.AwaySince.Equal(slept) || !b.AwayUntil.Equal(e.now) {
		t.Fatalf("stuck Bot's second gap %v %v %v", b.AwaySince, b.AwayUntil, b.AwayReason)
	}
	for _, id := range fresh {
		if b := e.bot(id); b.AwayReason == nil || *b.AwayReason != AwayAsleep {
			t.Fatalf("%s not marked asleep", id)
		}
	}
	ntfs := awayAlerts(t, e, e.user)
	if len(ntfs) != 2 || ntfs[1].Title != "Bots were paused for "+awayFor(e.now.Sub(slept)) ||
		ntfs[1].Body != "This computer was asleep. 4 bots are checking now." {
		t.Fatalf("away alerts %+v", ntfs)
	}
	e.runJob(e.checkJob(stuck))
	if c := e.lastCheck(stuck); c.AwaySecs == nil || *c.AwaySecs != int(e.bot(stuck).AwayUntil.Sub(slept).Seconds()) || *c.AwayReason != AwayAsleep {
		t.Fatalf("stuck Bot's check after the second gap %+v", c)
	}
}

// The check that catches up records the gap, clears it from the Bot and
// ends its alert with how long the Bot was paused; the board shows the gap
// while it waits, and the Bot's checks keep it.
func TestIntegrationBotCatchUpCheck(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	amount := "100"
	e.coinbase(&amount)
	v := e.create(btcBot("BTC", Rule{Kind: RuleMovePct, Percent: f64(1), Direction: DirAny}))
	must(t, e.run(v.ID)) // baseline
	e.now = e.now.Add(9 * time.Hour)
	must(t, e.db.Model(&Bot{}).Where("id = ?", v.ID).Update("next_check_at", e.now.Add(-9*time.Hour)).Error)
	e.s.lastPrune = e.now
	must(t, e.s.Sweep(ctx))

	code, list := call(t, e.s, e.user, http.MethodGet, "/bots", nil)
	away, _ := list["bots"].([]any)[0].(map[string]any)["away"].(map[string]any)
	if code != http.StatusOK || away["seconds"] != float64(32400) || away["reason"] != AwayClosed || away["since"] == nil {
		t.Fatalf("board away %d %v", code, away)
	}

	amount = "102"
	e.runJob(e.checkJob(v.ID))
	c := e.lastCheck(v.ID)
	line := "Paused for 9 hours while Timely was closed"
	if c.Outcome != outFired || c.Trigger != TriggerWake || c.AwaySecs == nil || *c.AwaySecs != 32400 || *c.AwayReason != AwayClosed {
		t.Fatalf("catch-up check %+v", c)
	}
	if b := e.bot(v.ID); b.AwaySince != nil || b.AwayUntil != nil || b.AwayReason != nil {
		t.Fatal("the Bot kept its gap after catching up")
	}
	a := e.alertRow(c.ID)
	if a.Body != "BTC now $102 (was $100)\n"+line || a.Figures["away"] != line {
		t.Fatalf("catch-up alert %q %v", a.Body, a.Figures)
	}
	var ntf models.Notification
	must(t, e.db.Where("id = ?", *a.NotificationID).First(&ntf).Error)
	if !strings.HasSuffix(ntf.Body, "\n"+line) {
		t.Fatalf("notification %q", ntf.Body)
	}

	_, list = call(t, e.s, e.user, http.MethodGet, "/bots", nil)
	if got := list["bots"].([]any)[0].(map[string]any)["away"]; got != nil {
		t.Fatalf("board away after catching up %v", got)
	}
	_, detail := call(t, e.s, e.user, http.MethodGet, "/bots/"+v.ID, nil)
	check := detail["checks"].([]any)[0].(map[string]any)
	checkAway, _ := check["away"].(map[string]any)
	alert := detail["alerts"].([]any)[0].(map[string]any)
	if checkAway["seconds"] != float64(32400) || checkAway["reason"] != AwayClosed || checkAway["since"] != nil ||
		alert["figures"].(map[string]any)["away"] != line {
		t.Fatalf("detail check %v, alert %v", check, alert)
	}
	if older := detail["checks"].([]any)[1].(map[string]any); older["away"] != nil {
		t.Fatalf("the baseline check has a gap %v", older)
	}
}

// Shop-price Bots on one site, all overdue after a restart: each catch-up
// check that finds the site busy waits only for the site's next slot, not
// its 6-hour floor, and keeps its gap, so every Bot reads once within a few
// minutes and catches up.
func TestIntegrationBotCatchUpSharedSite(t *testing.T) {
	e := newEngine(t)
	ids := make([]string, 3)
	for i := range ids {
		u := fmt.Sprintf("https://shop.example.com/item-%d", i)
		e.net.serve(u, 200, "text/html", `<html><head><meta property="og:price:amount" content="10"></head><body></body></html>`)
		v := e.create(Input{Name: fmt.Sprintf("Shop item %d", i), Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadProductPrice}}})
		must(t, e.run(v.ID)) // baseline, with no site spacing
		ids[i] = v.ID
	}
	e.s.fetch = fetch.New(fetch.Config{
		Client: &http.Client{Transport: e.net}, Spacer: e.s.store, Robots: e.s.store,
		Now: func() time.Time { return e.now }, Sleep: func(context.Context, time.Duration) error { return nil },
	})
	e.now = e.now.Add(9 * time.Hour)
	must(t, e.db.Exec(`UPDATE bots SET next_check_at = ? WHERE user_id = ?`, e.now.Add(-9*time.Hour), e.user).Error)
	// Another check holds the site for the first minute and a half, so the
	// first wake checks are turned away.
	must(t, e.db.Exec(`INSERT INTO bot_sites (site, next_slot_at, used_at) VALUES ('example.com', ?, ?)`, e.now.Add(90*time.Second), e.now).Error)
	e.s.lastSweepWall, e.s.lastPrune = time.Time{}, e.now // the restart

	start := e.now
	busy := 0
	for e.now.Before(start.Add(5 * time.Minute)) {
		e.tick()
		for _, id := range ids {
			if c := e.lastCheck(id); c.Outcome == outSiteBusy && c.StartedAt.Equal(e.now) {
				busy++
				b := e.bot(id)
				if b.AwaySince == nil || b.CheckStartedAt == nil || !b.CheckStartedAt.Equal(start.Add(-9*time.Hour)) ||
					b.NextCheckAt.After(e.now.Add(2*time.Minute)) {
					t.Fatalf("a turned-away check used up the floor: started %v, next %v, away %v", b.CheckStartedAt, b.NextCheckAt, b.AwaySince)
				}
				e.spacedOK(id)
			}
		}
		e.now = e.now.Add(10 * time.Second)
	}
	if busy == 0 {
		t.Fatal("no check was turned away; the test sets nothing up")
	}
	for _, id := range ids {
		var read []Check
		must(t, e.db.Where("bot_id = ? AND started_at >= ? AND outcome <> ?", id, start, outSiteBusy).Find(&read).Error)
		if len(read) != 1 || read[0].Outcome != outUnchanged || read[0].AwaySecs == nil || *read[0].AwaySecs != 32400 {
			t.Fatalf("%s: reading checks after the restart %+v", id, read)
		}
		if b := e.bot(id); b.AwaySince != nil || b.NextCheckAt.Before(read[0].StartedAt.Add(MinProductEvery-FenceSlack)) {
			t.Fatalf("%s after catching up: away %v, next %v", id, b.AwaySince, b.NextCheckAt)
		}
	}
}

// An alert the judge held back carries the line too.
func TestIntegrationBotCatchUpJudgedQuiet(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC quiet", &amount)
	fj.set(Verdict{Alert: false, Why: "Noise", Urgency: UrgencyLow}, nil)
	e.markAwayRow(v.ID, 9*time.Hour, AwayAsleep)
	amount = "102.00"
	e.again(v.ID)
	c := e.lastCheck(v.ID)
	a := e.alertRow(c.ID)
	line := "Paused for 9 hours while this computer was asleep"
	if c.Outcome != outJudgedQuiet || a.Held != heldJudged || a.Body != "BTC now $102 (was $100)\n"+line || a.Figures["away"] != line || a.AIWhy != "Noise" {
		t.Fatalf("judged quiet %s / %+v", c.Outcome, a)
	}
	if b := e.bot(v.ID); b.AwaySince != nil {
		t.Fatal("a judged check kept the gap")
	}
}

// A check that read nothing has not caught up: offline and an edit while it
// read record the gap and keep it on the Bot; the next check that reads
// records it again and clears it. A strike is an answer, and clears it.
func TestIntegrationBotCatchUpKeepsGap(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()

	t.Run("offline", func(t *testing.T) {
		amount := "100"
		e.coinbase(&amount)
		v := e.create(btcBot("Offline"))
		must(t, e.run(v.ID))
		e.markAwayRow(v.ID, 9*time.Hour, AwayClosed)
		e.net.set(coinbaseBTC, func(*http.Request) (*http.Response, error) { return nil, io.ErrUnexpectedEOF })
		e.again(v.ID)
		c := e.lastCheck(v.ID)
		if c.Outcome != outOffline || c.AwaySecs == nil || *c.AwaySecs != 32400 {
			t.Fatalf("offline check %+v", c)
		}
		if b := e.bot(v.ID); b.AwaySince == nil || *b.AwayReason != AwayClosed {
			t.Fatal("offline cleared the gap")
		}
		e.coinbase(&amount)
		e.again(v.ID)
		if c := e.lastCheck(v.ID); c.Outcome != outUnchanged || c.AwaySecs == nil || *c.AwaySecs != 32400 || *c.AwayReason != AwayClosed {
			t.Fatalf("the check back online %+v", c)
		}
		if b := e.bot(v.ID); b.AwaySince != nil {
			t.Fatal("the check back online kept the gap")
		}
	})

	t.Run("superseded", func(t *testing.T) {
		u := "https://edited.example.com/"
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput("Edited", u))
		must(t, e.run(v.ID))
		e.markAwayRow(v.ID, 2*time.Hour, AwayAllPaused)
		// The watch is edited while it is read.
		e.net.set(u, func(req *http.Request) (*http.Response, error) {
			if err := e.db.Exec(`UPDATE bot_watches SET config_version = config_version + 1 WHERE bot_id = ?`, v.ID).Error; err != nil {
				return nil, err
			}
			return reply(req, 200, "text/html", "<p>hello</p>"), nil
		})
		e.again(v.ID)
		c := e.lastCheck(v.ID)
		if c.Outcome != outSuperseded || c.AwaySecs == nil || *c.AwaySecs != 7200 || *c.AwayReason != AwayAllPaused {
			t.Fatalf("superseded check %+v", c)
		}
		if b := e.bot(v.ID); b.AwaySince == nil {
			t.Fatal("an all-superseded check cleared the gap")
		}
	})

	t.Run("strike", func(t *testing.T) {
		u := "https://gone.example.com/"
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput("Gone", u))
		must(t, e.run(v.ID))
		e.markAwayRow(v.ID, 9*time.Hour, AwayClosed)
		e.net.serve(u, 404, "text/html", "gone")
		e.again(v.ID)
		c := e.lastCheck(v.ID)
		if c.Outcome != outStrike || c.AwaySecs == nil {
			t.Fatalf("strike check %+v", c)
		}
		if b := e.bot(v.ID); b.AwaySince != nil || b.AwayUntil != nil || b.AwayReason != nil {
			t.Fatal("a strike kept the gap")
		}
	})
	_ = ctx
}

// Turning Pause all off marks every active Bot that missed a check while it
// was on, from when it was turned on or when the Bot was due (the later),
// once it is at least 30 minutes late.
func TestIntegrationBotAwayPauseAll(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	t0 := e.now
	before := lateBots(t, e, e.user, 1, t0.Add(-time.Hour), 0, "Before")[0]
	during := lateBots(t, e, e.user, 1, t0.Add(30*time.Minute), 0, "During")[0]
	recent := lateBots(t, e, e.user, 1, t0.Add(105*time.Minute), 0, "Recent")[0]
	future := lateBots(t, e, e.user, 1, t0.Add(3*time.Hour), 0, "Future")[0]
	paused := lateBots(t, e, e.user, 1, t0.Add(-time.Hour), 0, "Paused")[0]
	must(t, e.db.Exec(`UPDATE bots SET status = 'paused', pause_reason = 'person', next_check_at = NULL WHERE id = ?`, paused).Error)

	_, err := e.s.SetAllPaused(ctx, e.user, true)
	must(t, err)
	e.now = t0.Add(2 * time.Hour)
	// A sweep while it is on marks nothing.
	e.s.lastPrune = e.now
	must(t, e.s.Sweep(ctx))
	if n := e.count("bots", "user_id = ? AND away_since IS NOT NULL", e.user); n != 0 {
		t.Fatalf("%d Bots marked while all were paused", n)
	}
	_, err = e.s.SetAllPaused(ctx, e.user, false)
	must(t, err)
	for id, since := range map[string]time.Time{before: t0, during: t0.Add(30 * time.Minute)} {
		b := e.bot(id)
		if b.AwayReason == nil || *b.AwayReason != AwayAllPaused || !b.AwaySince.Equal(since) || !b.AwayUntil.Equal(e.now) {
			t.Fatalf("%s away %v %v %v", id, b.AwaySince, b.AwayUntil, b.AwayReason)
		}
	}
	for _, id := range []string{recent, future, paused} {
		if b := e.bot(id); b.AwaySince != nil {
			t.Fatalf("%s was marked", id)
		}
	}
	// Off again changes nothing.
	e.now = e.now.Add(time.Hour)
	_, err = e.s.SetAllPaused(ctx, e.user, false)
	must(t, err)
	if b := e.bot(before); !b.AwayUntil.Equal(t0.Add(2 * time.Hour)) {
		t.Fatalf("off twice moved the gap to %v", b.AwayUntil)
	}
}

// Pause, Resume, a brief left with no sources and a restore (over MCP too)
// end a gap: the Bot missed nothing it should tell of.
func TestIntegrationBotAwayCleared(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	gapOf := func(id string) bool { return e.bot(id).AwaySince != nil }
	v := e.create(pageInput("Cleared", "https://cleared.example.com/"))

	e.markAwayRow(v.ID, time.Hour, AwayClosed)
	_, err := e.s.Pause(ctx, e.user, v.ID, PausePerson)
	must(t, err)
	if gapOf(v.ID) {
		t.Fatal("Pause kept the gap")
	}
	e.markAwayRow(v.ID, time.Hour, AwayClosed)
	_, err = e.s.Resume(ctx, e.user, v.ID, OriginApp)
	must(t, err)
	if gapOf(v.ID) {
		t.Fatal("Resume kept the gap")
	}

	paused := e.create(pageInput("Paused", "https://paused.example.com/"))
	_, err = e.s.Pause(ctx, e.user, paused.ID, PausePerson)
	must(t, err)
	for _, fromMCP := range []bool{false, true} {
		e.markAwayRow(v.ID, time.Hour, AwayAsleep)
		e.markAwayRow(paused.ID, time.Hour, AwayAsleep)
		must(t, e.s.VetRestore(e.db, e.user, fromMCP))
		if gapOf(v.ID) || gapOf(paused.ID) {
			t.Fatalf("a restore (MCP %v) kept a gap", fromMCP)
		}
	}

	src := e.create(pageInput("Source", "https://source.example.com/"))
	brief := e.create(briefInput("Morning", src.ID))
	e.markAwayRow(brief.ID, time.Hour, AwayClosed)
	must(t, e.s.Delete(ctx, e.user, src.ID))
	if b := e.bot(brief.ID); b.Status != StatusPaused || b.AwaySince != nil {
		t.Fatalf("a brief with no sources: %s, gap %v", b.Status, b.AwaySince)
	}
}

// A brief that catches up ends its alert with the line, records the gap and
// clears it.
func TestIntegrationBotAwayBrief(t *testing.T) {
	e := newEngine(t)
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	v := e.create(briefInput("Morning", deals.ID))
	e.note(deals.ID, "item", "Deal 1", "New in deals.example", e.now.Add(time.Minute))
	b := e.bot(v.ID)
	e.now = b.NextCheckAt.Add(9 * time.Hour)
	e.markAwayRow(v.ID, 9*time.Hour, AwayClosed)
	c := e.runBrief(v.ID)
	line := "Paused for 9 hours while Timely was closed"
	if c.Outcome != outFired || c.AwaySecs == nil || *c.AwaySecs != 32400 {
		t.Fatalf("brief check %+v", c)
	}
	a := e.alertRow(c.ID)
	if !strings.HasSuffix(a.Body, "\n"+line) || a.Figures["away"] != line || !strings.HasPrefix(a.Body, "Deals: Deal 1") {
		t.Fatalf("brief alert %q %v", a.Body, a.Figures)
	}
	ntfs := e.notifications()
	if len(ntfs) != 1 || ntfs[0].Body != a.Body {
		t.Fatalf("brief notification %+v", ntfs)
	}
	if e.bot(v.ID).AwaySince != nil {
		t.Fatal("the brief kept its gap")
	}
}

// An unchecked alert's notification has the AI mark before the line, and a
// re-judge that rewrites it keeps the line last.
func TestIntegrationBotAwayRejudge(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC later", &amount)
	fj.set(Verdict{}, errors.New("provider overloaded"))
	e.markAwayRow(v.ID, 9*time.Hour, AwayClosed)
	amount = "102.00"
	e.again(v.ID)
	line := "Paused for 9 hours while Timely was closed"
	a := e.alertRow(e.lastCheck(v.ID).ID)
	if a.AIState != aiUnchecked || a.Body != "BTC now $102 (was $100)\n"+line {
		t.Fatalf("unchecked alert %+v", a)
	}
	var ntf models.Notification
	must(t, e.db.Where("id = ?", *a.NotificationID).First(&ntf).Error)
	if ntf.Body != "BTC now $102 (was $100) (not checked by AI)\n"+line {
		t.Fatalf("unchecked notification %q", ntf.Body)
	}
	fj.set(Verdict{Alert: false, Why: "A 2% move is noise", Urgency: UrgencyLow}, nil)
	must(t, e.s.HandleRejudge(ctx, e.rejudgeJob(a.ID)))
	ntf = models.Notification{}
	must(t, e.db.Where("id = ?", *a.NotificationID).First(&ntf).Error)
	if ntf.Body != rejudgeLaterLine+"A 2% move is noise\n"+line {
		t.Fatalf("re-judged notification %q", ntf.Body)
	}
	// The next judge input reads the rules' line alone.
	fj.set(Verdict{Alert: true, Why: "Worth it", Urgency: UrgencyNormal}, nil)
	amount = "105.00"
	e.again(v.ID)
	in := fj.calls()
	if last := in[len(in)-1].LastAlert; last == nil || last.Body != "BTC now $102 (was $100)" {
		t.Fatalf("judge input %+v", last)
	}
}
