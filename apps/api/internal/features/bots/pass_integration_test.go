package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"
)

const (
	dealsFeed  = "https://news.example.com/deals.xml"
	dealsPage  = "https://news.example.com/watch"
	otherShop  = "https://shop.example.org/ssd"
	itemPrefix = "https://news.example.com/item/"
)

// feedOf is a feed of items given as id and title, newest first; each links
// to itemPrefix + id.
func feedOf(items ...[2]string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><rss version="2.0"><channel><title>Deals</title>`)
	for _, it := range items {
		fmt.Fprintf(&b, `<item><guid>%s</guid><title>%s</title><link>%s%s</link></item>`, it[0], it[1], itemPrefix, it[0])
	}
	b.WriteString(`</channel></rss>`)
	return b.String()
}

// passJobs runs every waiting bot_pass job of the account, oldest first,
// as the worker would, and drops them. It returns the pass ids it ran.
func (e *engine) passJobs() []string {
	e.t.Helper()
	var jobs []models.Job
	must(e.t, e.db.Where("user_id = ? AND kind = ? AND status = ?", e.user, models.JobBotPass, models.JobPending).Order("created_at, id").Find(&jobs).Error)
	var ids []string
	for i := range jobs {
		j := jobs[i]
		j.Attempts++
		must(e.t, e.s.HandlePass(context.Background(), &j))
		must(e.t, e.db.Delete(&models.Job{}, "id = ?", j.ID).Error)
		ids = append(ids, j.Payload.String("passId"))
	}
	return ids
}

func (e *engine) passes(where string, args ...any) []Pass {
	e.t.Helper()
	var out []Pass
	must(e.t, e.db.Where("user_id = ?", e.user).Where(where, args...).Order("created_at, id").Find(&out).Error)
	return out
}

func (e *engine) pass(id string) Pass {
	e.t.Helper()
	var p Pass
	must(e.t, e.db.Where("id = ?", id).First(&p).Error)
	return p
}

func (e *engine) passCheck(passID string) Check {
	e.t.Helper()
	var p Pass
	must(e.t, e.db.Where("id = ?", passID).First(&p).Error)
	if p.CheckID == nil {
		e.t.Fatalf("pass %s (%s) has no check", passID, p.State)
	}
	var c Check
	must(e.t, e.db.Where("id = ?", *p.CheckID).First(&c).Error)
	return c
}

// passPair is a feed Bot A passing to a page Bot B.
type passPair struct {
	a, b View
	link LinkView
	feed *string
}

// dealsPair makes "Deals feed" (a feed on news.example.com) pass items that
// mention one of filter to bIn, and records both baselines.
func (e *engine) dealsPair(bIn Input, filter ...string) passPair {
	e.t.Helper()
	feed := feedOf([2]string{"1", "Old news"})
	e.net.set(dealsFeed, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "application/rss+xml", feed), nil
	})
	b := e.create(bIn)
	a := e.create(Input{Name: "Deals feed", Watches: []WatchInput{{Kind: WatchFeed, URL: dealsFeed}},
		PassesTo: &[]LinkInput{{BotID: b.Name, Filter: filter}}})
	must(e.t, e.run(a.ID))
	must(e.t, e.run(b.ID))
	d, err := e.s.Get(context.Background(), e.user, a.ID)
	must(e.t, err)
	if len(d.Links) != 1 {
		e.t.Fatalf("links %+v", d.Links)
	}
	return passPair{a: a, b: b, link: d.Links[0], feed: &feed}
}

// A note goes on to the Bot it is passed to, which checks it under its own
// rules; the first Bot stays quiet about it, and the alert comes from the
// end of the chain with how it came.
func TestIntegrationBotPassTo(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	e.net.serve(dealsPage, 200, "text/html", "<html><body><p>Drives we like</p></body></html>")
	for _, id := range []string{"2", "3"} {
		e.net.serve(itemPrefix+id, 200, "text/html", "<html><body><p>Samsung 990 EVO 2TB NVMe, now $99</p></body></html>")
	}
	priceCheck := Input{Name: "Price check", Watches: []WatchInput{{Kind: WatchPage, URL: dealsPage, Rules: []Rule{{Kind: RuleWordsAppear, Words: []string{"NVMe"}}}}}}
	pp := e.dealsPair(priceCheck, "NVMe")
	bBefore := e.bot(pp.b.ID)

	// Two matching items: A alerts on neither, writes its notes unalerted
	// and passes both on.
	*pp.feed = feedOf([2]string{"3", "Crucial P3 2TB NVMe"}, [2]string{"2", "Samsung 990 EVO 2TB NVMe"}, [2]string{"1", "Old news"})
	e.again(pp.a.ID)
	ac := e.lastCheck(pp.a.ID)
	if ac.Outcome != outPassed || ac.AlertID != nil || e.count("bot_alerts", "bot_id = ?", pp.a.ID) != 0 {
		t.Fatalf("A's check %+v", ac)
	}
	var notes []Finding
	must(t, e.db.Where("check_id = ?", ac.ID).Order("title").Find(&notes).Error)
	if len(notes) != 2 || notes[0].Alerted || notes[1].Alerted {
		t.Fatalf("A's notes %+v", notes)
	}
	pending := e.passes("state = ?", passPending)
	if len(pending) != 2 || e.count("jobs", "user_id = ? AND kind = ?", e.user, models.JobBotPass) != 2 {
		t.Fatalf("pending passes %+v", pending)
	}
	for _, p := range pending {
		if p.ChainID != ac.ID || p.Depth != 1 || p.ToBotID != pp.b.ID || p.FromBotID != pp.a.ID || p.LinkID == nil || *p.LinkID != pp.link.ID ||
			p.FindingID == nil || !strings.HasPrefix(p.ThingKey, "link:"+itemPrefix) {
			t.Fatalf("pass %+v", p)
		}
	}

	ran := e.passJobs()
	if len(ran) != 2 {
		t.Fatalf("ran %v", ran)
	}
	// The first reads the item's link through B's page watch on that site;
	// the second, inside B's floor, tests the note itself.
	first, second := e.passCheck(ran[0]), e.passCheck(ran[1])
	if first.Trigger != TriggerPass || len(first.Watches) != 1 || first.Watches[0].WatchID != pp.b.Watches[0].ID || first.Outcome != outFired {
		t.Fatalf("first pass check %+v", first)
	}
	if second.Trigger != TriggerPass || len(second.Watches) != 0 || second.Outcome != outFired {
		t.Fatalf("second pass check %+v", second)
	}
	e.net.mu.Lock()
	reads := e.net.hits["news.example.com/item/2"] + e.net.hits["news.example.com/item/3"]
	e.net.mu.Unlock()
	if reads != 1 {
		t.Fatalf("B read %d item pages", reads)
	}
	for _, id := range ran {
		if p := e.pass(id); p.State != passAlerted {
			t.Fatalf("pass %s is %s", id, p.State)
		}
	}
	alert := e.alertRow(first.ID)
	var src Finding
	must(t, e.db.Where("id = (SELECT finding_id FROM bot_passes WHERE id = ?)", ran[0]).First(&src).Error)
	if alert.Title != "Price check: “NVMe” appeared" || alert.NotificationID == nil || len(alert.Via) != 1 ||
		alert.Via[0].BotID != pp.a.ID || alert.Via[0].Name != "Deals feed" || alert.Via[0].LinkID == nil || *alert.Via[0].LinkID != pp.link.ID ||
		alert.Via[0].Title != src.Title {
		t.Fatalf("B's alert %+v", alert)
	}
	if len(alert.Things) != 1 || alert.Things[0].Key != src.ThingKey {
		t.Fatalf("B's alert tells of %+v, not the item %s", alert.Things, src.ThingKey)
	}
	// It opens the item, not B's own page whose rule did not fire.
	var ntf models.Notification
	must(t, e.db.Where("id = ?", *alert.NotificationID).First(&ntf).Error)
	if !strings.HasPrefix(src.URL, itemPrefix) || alert.URL != src.URL || ntf.Data.String("url") != src.URL {
		t.Fatalf("B's alert opens %q (notification %q), not the item %q", alert.URL, ntf.Data.String("url"), src.URL)
	}
	var bNote Finding
	must(t, e.db.Where("check_id = ?", first.ID).First(&bNote).Error)
	if bNote.SourceFindingID == nil || *bNote.SourceFindingID != src.ID || bNote.ChainID != ac.ID || bNote.Depth != 1 || bNote.URL != src.URL ||
		bNote.ThingKey != src.ThingKey || bNote.Title != "“NVMe” appeared" || !bNote.OutsideData || !bNote.Alerted {
		t.Fatalf("B's note %+v", bNote)
	}
	bAfter := e.bot(pp.b.ID)
	if !timeEq(bAfter.NextCheckAt, bBefore.NextCheckAt) || !timeEq(bAfter.LastCheckAt, bBefore.LastCheckAt) || bAfter.Strikes != 0 {
		t.Fatalf("a pass moved B's schedule: %+v", bAfter)
	}
	d, err := e.s.Get(ctx, e.user, pp.b.ID)
	must(t, err)
	if len(d.Links) != 1 || d.Links[0].ID != pp.link.ID || d.Links[0].PassedToday != 2 || len(d.Alerts) == 0 || len(d.Alerts[0].Via) != 1 ||
		d.LatestAlert == nil || len(d.LatestAlert.Via) != 1 || d.Checks[0].Trigger != TriggerPass {
		t.Fatalf("B's page %+v", d)
	}

	// "Shouldn't have been passed on" is for a passed alert only, and
	// teaches B.
	notUseful := FeedbackNotUseful
	res, err := e.s.RateAlert(ctx, e.user, pp.b.ID, alert.ID, Rating{Feedback: &notUseful, Reason: PassFeedbackReason})
	must(t, err)
	if res.FeedbackReason != PassFeedbackReason || res.Lesson == nil || res.Lesson.Text != "Not worth passing on from Deals feed: ““NVMe” appeared”" {
		t.Fatalf("rating %+v / %+v", res.AlertView, res.Lesson)
	}
	plain := e.create(pageInput("Plain page", "https://plain.example.net/"))
	e.net.serve("https://plain.example.net/", 200, "text/html", "<p>one</p>")
	must(t, e.run(plain.ID))
	e.net.serve("https://plain.example.net/", 200, "text/html", "<p>two</p>")
	e.again(plain.ID)
	plainAlert := e.alertRow(e.lastCheck(plain.ID).ID)
	var bad *InputError
	if _, err := e.s.RateAlert(ctx, e.user, plain.ID, plainAlert.ID, Rating{Feedback: &notUseful, Reason: PassFeedbackReason}); !errors.As(err, &bad) ||
		bad.Message != "This alert was not passed on" {
		t.Fatalf("not_passed on an alert of its own: %v", err)
	}

	// After B's floor, a read that fails is logged with no strike and no
	// alert.
	e.net.serve(itemPrefix+"4", 500, "text/html", "down")
	*pp.feed = feedOf([2]string{"4", "Kingston NV2 NVMe"}, [2]string{"3", "Crucial P3 2TB NVMe"})
	e.again(pp.a.ID)
	e.now = e.now.Add(MinPageEvery)
	ran = e.passJobs()
	failed := e.passCheck(ran[0])
	p := e.pass(ran[0])
	if p.State != passFailed || failed.ErrorKind != "server_error" || failed.AlertID != nil || failed.Outcome != outUnchanged ||
		len(failed.Watches) != 1 || failed.Watches[0].ErrorKind != "server_error" {
		t.Fatalf("failed pass %s, check %+v", p.State, failed)
	}
	if b := e.bot(pp.b.ID); b.Strikes != 0 || b.Health != bAfter.Health {
		t.Fatalf("a failed pass struck B: %+v", b)
	}

	// The link off route: "Turn off this pass", on again; a pass waiting
	// while its link is off folds.
	*pp.feed = feedOf([2]string{"5", "WD SN770 NVMe"}, [2]string{"4", "Kingston NV2 NVMe"})
	e.again(pp.a.ID)
	code, body := call(t, e.s, e.user, http.MethodPatch, "/bots/links/"+pp.link.ID, map[string]any{"enabled": false})
	if code != http.StatusOK || body["enabled"] != false || body["offReason"] != "person" {
		t.Fatalf("turn off: %d %v", code, body)
	}
	ran = e.passJobs()
	p = e.pass(ran[0])
	if p.State != passFolded || p.CheckID != nil {
		t.Fatalf("a pass on a link turned off is %s", p.State)
	}
	if code, body := call(t, e.s, e.user, http.MethodPatch, "/bots/links/blk_nope", map[string]any{"enabled": true}); code != http.StatusNotFound || body["message"] != "Link not found" {
		t.Fatalf("missing link: %d %v", code, body)
	}
	if code, _ := call(t, e.s, e.user, http.MethodPatch, "/bots/links/"+pp.link.ID, map[string]any{}); code != http.StatusBadRequest {
		t.Fatalf("no enabled: %d", code)
	}
	other := addUser(t, e.db)
	if code, _ := call(t, e.s, other, http.MethodPatch, "/bots/links/"+pp.link.ID, map[string]any{"enabled": true}); code != http.StatusNotFound {
		t.Fatalf("another account turned the link on: %d", code)
	}
	if code, body := call(t, e.s, e.user, http.MethodPatch, "/bots/links/"+pp.link.ID, map[string]any{"enabled": true}); code != http.StatusOK || body["offReason"] != "" {
		t.Fatalf("turn on: %d %v", code, body)
	}

	// A pass that waited over a day folds into the next brief instead.
	*pp.feed = feedOf([2]string{"6", "Lexar NM790 NVMe"}, [2]string{"5", "WD SN770 NVMe"})
	e.again(pp.a.ID)
	e.now = e.now.Add(PassFoldAfter + time.Minute)
	ran = e.passJobs()
	p = e.pass(ran[0])
	if p.State != passFolded {
		t.Fatalf("a day-old pass is %s", p.State)
	}

	// A note no filter word matches stays with A, which alerts on it.
	*pp.feed = feedOf([2]string{"7", "A cheap mouse"}, [2]string{"6", "Lexar NM790 NVMe"})
	e.again(pp.a.ID)
	if c := e.lastCheck(pp.a.ID); c.Outcome != outFired || c.AlertID == nil || len(e.passes("chain_id = ?", c.ID)) != 0 {
		t.Fatalf("an unmatched item: %+v", c)
	}
}

func timeEq(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// An AI-judged Bot judges a passed note with the note as data; a quiet
// verdict holds its alert back, and its note keeps the rules' words. With
// no watch on the note's site, it tests the note's own price. The judge
// call counts against the chain, whoever makes it.
func TestIntegrationBotPassJudged(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "50000"
	e.coinbase(&amount)
	bIn := btcBot("BTC check", Rule{Kind: RuleBelow, Threshold: f64(60000)})
	bIn.JudgeMode = JudgeAI
	b := e.create(bIn)
	aIn := btcBot("BTC feed", Rule{Kind: RuleAnyChange})
	aIn.PassesTo = &[]LinkInput{{BotID: b.ID}}
	a := e.create(aIn)
	must(t, e.run(a.ID))
	must(t, e.run(b.ID))
	fj.set(Verdict{Alert: false, Title: "Nothing to see", Why: "Above your usual buy price", Urgency: UrgencyLow}, nil)

	amount = "51000"
	e.again(a.ID)
	ac := e.lastCheck(a.ID)
	if ac.Outcome != outPassed || len(fj.calls()) != 0 {
		t.Fatalf("A's check %+v, judge calls %d", ac, len(fj.calls()))
	}
	ran := e.passJobs()
	c := e.passCheck(ran[0])
	if c.Outcome != outJudgedQuiet || len(c.Watches) != 0 {
		t.Fatalf("B's check %+v", c)
	}
	calls := fj.calls()
	if len(calls) != 1 || calls[0].Passed == nil || calls[0].Passed.From != "BTC feed" || calls[0].Passed.Reading != "$51,000" ||
		len(calls[0].Changes) != 1 || calls[0].Changes[0].Rule != "Price is below $60,000" {
		t.Fatalf("judge input %+v", calls)
	}
	al := e.alertRow(c.ID)
	if al.Held != heldJudged || al.NotificationID != nil || al.AIState != aiJudged || len(al.Via) != 1 || al.Via[0].Name != "BTC feed" {
		t.Fatalf("B's alert %+v", al)
	}
	var note Finding
	must(t, e.db.Where("check_id = ?", c.ID).First(&note).Error)
	if note.Title != "below 60,000" || note.Why != "BTC now $51,000" || note.Urgency != UrgencyLow || note.Alerted || note.Kind != "price" {
		t.Fatalf("B's note %+v", note)
	}
	if p := e.pass(ran[0]); p.State != passQuiet {
		t.Fatalf("pass %s", p.State)
	}
	var chains []string
	must(t, e.db.Model(&AICall{}).Where("bot_id = ?", b.ID).Pluck("chain_id", &chains).Error)
	if len(chains) != 1 || chains[0] != ac.ID {
		t.Fatalf("the judge call counted against %v, not A's chain %s", chains, ac.ID)
	}

	// A chain uses at most ChainAI calls across its Bots, and a re-judge
	// of it counts too.
	for i := range ChainAI - 2 {
		botID := a.ID
		if i%2 == 0 {
			botID = b.ID
		}
		must(t, e.db.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, chain_id, local_day, purpose) VALUES (?, ?, ?, ?, '2026-11-06', 'judge')`,
			fmt.Sprintf("bai_chain_%d", i), e.user, botID, ac.ID).Error)
	}
	if _, err := e.s.reserveAI(ctx, e.bot(a.ID), ac.ID, purposeJudge, e.now); err != nil {
		t.Fatalf("the sixth call of the chain: %v", err)
	}
	if _, err := e.s.reserveAI(ctx, e.bot(b.ID), ac.ID, purposeJudge, e.now); !errors.Is(err, errAICap) {
		t.Fatalf("a seventh call of the chain: %v", err)
	}
	raw, _ := json.Marshal(JudgeJob{ChainID: ac.ID, Input: calls[0]})
	must(t, e.db.Exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, ai_state, ai_input) VALUES ('bal_rejudge', ?, ?, 'alert', '2026-11-06', 'BTC check: below $60,000', 'unchecked', ?)`,
		b.ID, e.user, string(raw)).Error)
	job := &models.Job{ID: "job_rejudge", UserID: e.user, Kind: models.JobBotJudge, Attempts: 1, MaxAttempts: 3, Payload: models.JobPayload{"alertId": "bal_rejudge"}}
	must(t, e.s.HandleRejudge(ctx, job))
	if len(fj.calls()) != 1 || e.count("bot_alerts", "id = 'bal_rejudge' AND ai_input IS NULL AND ai_state = 'unchecked'") != 1 {
		t.Fatal("a re-judge went past the chain's cap")
	}
}

// The limits: a check passes at most 10 items, a link 20 a day, the same
// thing goes to the same Bot once a week, and A stays quiet in each case.
func TestIntegrationBotPassLimits(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	e.net.serve(otherShop, 200, "text/html", "<p>SSDs</p>")
	pp := e.dealsPair(Input{Name: "Checker", Watches: []WatchInput{{Kind: WatchPage, URL: otherShop}}})
	items := func(from, to int) string {
		var list [][2]string
		for i := to; i >= from; i-- {
			list = append(list, [2]string{fmt.Sprint(i), fmt.Sprintf("Drive %d", i)})
		}
		return feedOf(list...)
	}

	*pp.feed = items(2, 12) // 11 new
	e.again(pp.a.ID)
	c := e.lastCheck(pp.a.ID)
	states := map[string]int{}
	for _, p := range e.passes("chain_id = ?", c.ID) {
		states[p.State]++
	}
	if states[passPending] != PassPerCheck || states[passOverflow] != 1 || len(states) != 2 || c.AlertID != nil || c.Outcome != outPassed {
		t.Fatalf("11 items: %v, check %+v", states, c)
	}
	if n := e.count("jobs", "user_id = ? AND kind = ?", e.user, models.JobBotPass); n != PassPerCheck {
		t.Fatalf("%d pass jobs", n)
	}

	// The link has passed 10 today; 10 more make 20, and the 21st overflows.
	for i := range LinkPerDay - PassPerCheck {
		must(t, e.db.Exec(`INSERT INTO bot_passes (id, user_id, link_id, from_bot_id, to_bot_id, thing_key, chain_id, depth, local_day, state, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 'bchk_x', 1, ?, 'quiet', ?, ?)`, fmt.Sprintf("bps_fill_%d", i), e.user, pp.link.ID, pp.a.ID, pp.b.ID,
			fmt.Sprintf("link:https://elsewhere.example/%d", i), e.now.Format(dayLayout), e.now, e.now).Error)
	}
	*pp.feed = items(2, 13)
	e.again(pp.a.ID)
	c = e.lastCheck(pp.a.ID)
	if ps := e.passes("chain_id = ?", c.ID); len(ps) != 1 || ps[0].State != passOverflow || c.AlertID != nil {
		t.Fatalf("the 21st of the day: %+v", ps)
	}

	// The same thing to the same Bot within 7 days is a repeat.
	must(t, e.db.Exec(`DELETE FROM bot_passes WHERE id LIKE 'bps_fill_%'`).Error)
	must(t, e.db.Exec(`UPDATE bot_passes SET local_day = local_day - 1 WHERE user_id = ?`, e.user).Error)
	must(t, e.db.Exec(`INSERT INTO bot_passes (id, user_id, link_id, from_bot_id, to_bot_id, thing_key, chain_id, depth, local_day, state, created_at, updated_at)
		VALUES ('bps_old', ?, NULL, 'bot_gone', ?, ?, 'bchk_y', 1, ?, 'alerted', ?, ?)`, e.user, pp.b.ID, "link:"+itemPrefix+"14",
		e.now.AddDate(0, 0, -3).Format(dayLayout), e.now.AddDate(0, 0, -3), e.now.AddDate(0, 0, -3)).Error)
	*pp.feed = items(2, 14)
	e.again(pp.a.ID)
	c = e.lastCheck(pp.a.ID)
	if ps := e.passes("chain_id = ?", c.ID); len(ps) != 1 || ps[0].State != passRepeat || c.AlertID != nil || c.Outcome != outPassed {
		t.Fatalf("a repeat within 7 days: %+v, check %+v", ps, c)
	}
	// After 7 days it goes again.
	must(t, e.db.Exec(`INSERT INTO bot_passes (id, user_id, link_id, from_bot_id, to_bot_id, thing_key, chain_id, depth, local_day, state, created_at, updated_at)
		VALUES ('bps_older', ?, NULL, 'bot_gone', ?, ?, 'bchk_z', 1, ?, 'alerted', ?, ?)`, e.user, pp.b.ID, "link:"+itemPrefix+"15",
		e.now.AddDate(0, 0, -8).Format(dayLayout), e.now.AddDate(0, 0, -8), e.now.AddDate(0, 0, -8)).Error)
	*pp.feed = items(2, 15)
	e.again(pp.a.ID)
	if ps := e.passes("chain_id = ?", e.lastCheck(pp.a.ID).ID); len(ps) != 1 || ps[0].State != passPending {
		t.Fatalf("a week later: %+v", ps)
	}
}

// A page watch passes the same thing every time, so only a pass that was
// handed on starts the 7 days: the repeat row it writes does not, and the
// next fire a week after the first pass goes out again.
func TestIntegrationBotPassRepeatWindow(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	const aPage, bPage = "https://a.example.net/", "https://b.example.net/"
	e.net.serve(aPage, 200, "text/html", "<p>version 0</p>")
	e.net.serve(bPage, 200, "text/html", "<p>inbox</p>")
	b := e.create(pageInput("Inbox", bPage))
	aIn := pageInput("Page A", aPage)
	aIn.PassesTo = &[]LinkInput{{BotID: b.Name}}
	a := e.create(aIn)
	must(t, e.run(a.ID))
	must(t, e.run(b.ID))

	start := e.now
	fire := func(n int, at time.Time) Pass {
		t.Helper()
		e.now = at
		e.net.serve(aPage, 200, "text/html", fmt.Sprintf("<p>version %d</p>", n))
		e.again(a.ID)
		ps := e.passes("chain_id = ?", e.lastCheck(a.ID).ID)
		if len(ps) != 1 {
			t.Fatalf("fire %d passes %+v", n, ps)
		}
		e.passJobs()
		return ps[0]
	}
	first := fire(1, start)
	if first.State != passPending || first.ThingKey != "page:"+normURL(aPage) {
		t.Fatalf("first fire %+v", first)
	}
	if p := fire(2, start.AddDate(0, 0, 3)); p.State != passRepeat {
		t.Fatalf("3 days later: %s", p.State)
	}
	if p := fire(3, start.AddDate(0, 0, 8)); p.State != passPending {
		t.Fatalf("8 days after the first pass: %s", p.State)
	}
}

// Links are saved whole with the Bot and keep to the safety rules: no
// circles, chains of at most 3, at most 4 per Bot, 5 filter words; an
// outside app sets none.
func TestIntegrationBotLinksSave(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	mk := func(name string) View {
		return e.create(pageInput(name, "https://"+strings.ToLower(name)+".example.com/"))
	}
	a, b, c, d, x := mk("A"), mk("B"), mk("C"), mk("D"), mk("X")
	update := func(v View, links ...LinkInput) error {
		_, err := e.s.Update(ctx, e.user, v.ID, Patch{PassesTo: &links}, OriginApp)
		return err
	}
	wantErr := func(err error, msg string) {
		t.Helper()
		var bad *InputError
		if !errors.As(err, &bad) || bad.Message != msg {
			t.Fatalf("want %q, got %v", msg, err)
		}
	}
	must(t, update(a, LinkInput{BotID: "b", Filter: []string{" NVMe ", "nvme"}}))
	must(t, update(b, LinkInput{BotID: c.ID}))
	must(t, update(c, LinkInput{BotID: "D"}))
	wantErr(update(d, LinkInput{BotID: x.ID}), "A chain can be at most 3 steps")
	wantErr(update(d, LinkInput{BotID: a.ID}), "That would make bots pass items in a circle")
	wantErr(update(c, LinkInput{BotID: b.ID}), "That would make bots pass items in a circle")
	wantErr(update(a, LinkInput{BotID: a.ID}), "A bot cannot pass to itself")
	wantErr(update(a, LinkInput{BotID: "Nobody"}), `There is no bot called "Nobody" to pass to`)
	wantErr(update(a, LinkInput{BotID: b.ID}, LinkInput{BotID: "B"}), "B is in the list twice")
	wantErr(update(a, LinkInput{BotID: b.ID, Filter: []string{"1", "2", "3", "4", "5", "6"}}), "Up to 5 filter words")
	e2, e3 := mk("E2"), mk("E3")
	wantErr(update(x, LinkInput{BotID: a.ID}, LinkInput{BotID: d.ID}, LinkInput{BotID: e2.ID}, LinkInput{BotID: e3.ID}, LinkInput{BotID: c.ID}),
		"A bot can pass to up to 4 bots")
	if n := e.count("bot_links", "user_id = ?", e.user); n != 3 {
		t.Fatalf("a refused save kept %d links", n)
	}

	da, err := e.s.Get(ctx, e.user, a.ID)
	must(t, err)
	ab := da.Links[0]
	if len(da.Links) != 1 || ab.ToBotID != b.ID || !slices.Equal(ab.Filter, []string{"NVMe"}) || !ab.Enabled || ab.Kind != LinkPass {
		t.Fatalf("A's links %+v", da.Links)
	}
	dB, err := e.s.Get(ctx, e.user, b.ID)
	must(t, err)
	if len(dB.Links) != 2 {
		t.Fatalf("B's links (to and from) %+v", dB.Links)
	}
	// Saved again, a link keeps its id and stays off unless told.
	if _, err := e.s.SetLink(ctx, e.user, ab.ID, false); err != nil {
		t.Fatal(err)
	}
	must(t, update(a, LinkInput{BotID: b.ID, Filter: []string{"SSD"}}))
	da, err = e.s.Get(ctx, e.user, a.ID)
	must(t, err)
	if da.Links[0].ID != ab.ID || da.Links[0].Enabled || da.Links[0].OffReason != linkOffPerson || !slices.Equal(da.Links[0].Filter, []string{"SSD"}) {
		t.Fatalf("re-saved link %+v", da.Links[0])
	}
	on := true
	must(t, update(a, LinkInput{BotID: b.ID, Enabled: &on}))
	must(t, e.db.Where("id = ?", ab.ID).First(&Link{}).Error)
	if e.count("bot_links", "id = ? AND enabled AND off_reason = ''", ab.ID) != 1 {
		t.Fatal("enabled true did not turn the link on")
	}
	// Left out of the list, a link goes; a Patch without passesTo keeps them.
	desc := "Checks prices"
	if _, err := e.s.Update(ctx, e.user, a.ID, Patch{Description: &desc}, OriginApp); err != nil {
		t.Fatal(err)
	}
	if e.count("bot_links", "from_bot_id = ?", a.ID) != 1 {
		t.Fatal("an edit without passesTo dropped the links")
	}
	must(t, update(a))
	if e.count("bot_links", "from_bot_id = ?", a.ID) != 0 {
		t.Fatal("an empty list kept a link")
	}

	// An outside app sets up no links, at the Store.
	if _, err := e.s.Update(ctx, e.user, b.ID, Patch{PassesTo: &[]LinkInput{}}, OriginMCP); !errors.Is(err, errMCPSetup) {
		t.Fatalf("MCP update with passesTo: %v", err)
	}
	in := pageInput("From outside", "https://outside.example.com/")
	in.PassesTo = &[]LinkInput{{BotID: b.ID}}
	if _, err := e.s.Create(ctx, e.user, in, OriginMCP); !errors.Is(err, errMCPSetup) {
		t.Fatalf("MCP create with passesTo: %v", err)
	}
	// Made with links, a Bot has them at once; deleting a Bot removes its
	// links at both ends.
	in = pageInput("New one", "https://new.example.com/")
	in.PassesTo = &[]LinkInput{{BotID: d.ID, Filter: []string{"deal"}}}
	n := e.create(in)
	if e.count("bot_links", "from_bot_id = ? AND to_bot_id = ?", n.ID, d.ID) != 1 {
		t.Fatal("create did not save its links")
	}
	must(t, e.s.Delete(ctx, e.user, d.ID))
	if e.count("bot_links", "from_bot_id = ? OR to_bot_id = ?", d.ID, d.ID) != 0 {
		t.Fatal("a deleted bot's links are still there")
	}
}

// A chain: A passes to B, whose rule holds and who passes it to C, so B
// stays quiet too and C alerts, showing both steps it came through.
func TestIntegrationBotPassChain(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	e.net.serve(otherShop, 200, "text/html", "<p>SSDs</p>")
	e.net.serve("https://third.example.net/", 200, "text/html", "<p>Third</p>")
	c := e.create(pageInput("Third", "https://third.example.net/"))
	must(t, e.run(c.ID))
	bIn := Input{Name: "Middle", Watches: []WatchInput{{Kind: WatchPage, URL: otherShop}}, PassesTo: &[]LinkInput{{BotID: c.ID}}}
	pp := e.dealsPair(bIn, "NVMe")

	*pp.feed = feedOf([2]string{"2", "Samsung 2TB NVMe"}, [2]string{"1", "Old news"})
	e.again(pp.a.ID)
	chain := e.lastCheck(pp.a.ID).ID
	first := e.passJobs()
	mid := e.passCheck(first[0])
	if mid.Outcome != outPassed || mid.AlertID != nil || e.pass(first[0]).State != passQuiet {
		t.Fatalf("B's check %+v", mid)
	}
	next := e.passes("chain_id = ? AND depth = 2", chain)
	if len(next) != 1 || next[0].FromBotID != pp.b.ID || next[0].ToBotID != c.ID || next[0].State != passPending {
		t.Fatalf("B's pass on %+v", next)
	}
	e.passJobs()
	end := e.passCheck(next[0].ID)
	al := e.alertRow(end.ID)
	if end.Outcome != outFired || len(al.Via) != 2 || al.Via[0].BotID != pp.a.ID || al.Via[0].Title != "Samsung 2TB NVMe" ||
		al.Via[0].LinkID == nil || *al.Via[0].LinkID != pp.link.ID || al.Via[1].BotID != pp.b.ID || al.Via[1].Name != "Middle" ||
		al.Via[1].LinkID == nil || *al.Via[1].LinkID != *next[0].LinkID {
		t.Fatalf("C's alert %+v / %+v", end, al.Via)
	}
	var note Finding
	must(t, e.db.Where("check_id = ?", end.ID).First(&note).Error)
	if note.Depth != 2 || note.ChainID != chain || note.SourceFindingID == nil || *note.SourceFindingID != *next[0].FindingID {
		t.Fatalf("C's note %+v", note)
	}
	if e.count("bot_alerts", "bot_id IN (?, ?)", pp.a.ID, pp.b.ID) != 0 {
		t.Fatal("A or B alerted on what they passed on")
	}
}
