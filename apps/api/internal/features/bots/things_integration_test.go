package bots

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"
)

const thingsFeed = "https://news.example.com/feed.xml"

// rssWith is a feed of stories 1..n, newest first.
func rssWith(n int) string {
	ids := make([]string, 0, n)
	for i := n; i >= 1; i-- {
		ids = append(ids, fmt.Sprint(i))
	}
	return rss(ids...)
}

// A feed rule writes one note per new item, with the item's link, at most
// 10 a check plus one that counts the rest; the digest lists them.
func TestIntegrationBotItemFindings(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	feed := rssWith(1)
	e.net.set(thingsFeed, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "application/rss+xml", feed), nil
	})
	v := e.create(Input{Name: "News", Watches: []WatchInput{{Kind: WatchFeed, URL: thingsFeed}}})
	must(t, e.run(v.ID)) // baseline
	feed = rssWith(4)
	e.again(v.ID)
	c := e.lastCheck(v.ID)
	var rows []Finding
	must(t, e.db.Where("check_id = ?", c.ID).Order("title").Find(&rows).Error)
	if c.Outcome != outFired || len(rows) != 3 {
		t.Fatalf("outcome %s, %d findings", c.Outcome, len(rows))
	}
	for i, r := range rows {
		n := i + 2
		if r.Title != fmt.Sprintf("Story %d", n) || r.URL != fmt.Sprintf("https://news.example.com/%d", n) || r.Kind != "item" ||
			r.ThingKey != fmt.Sprintf("link:https://news.example.com/%d", n) || r.Why != "New in example.com" || !r.OutsideData || !r.Alerted {
			t.Fatalf("finding %d: %+v", i, r)
		}
	}
	a := e.alertRow(c.ID)
	if len(a.Things) != 3 || a.Things[0].Urgency != UrgencyNormal || !strings.HasPrefix(a.Things[0].Key, "link:https://news.example.com/") {
		t.Fatalf("the alert's things %+v", a.Things)
	}
	lines, _, err := e.s.DigestLines(ctx, e.user, e.now)
	must(t, err)
	slices.Sort(lines)
	if want := []string{"News: Story 2", "News: Story 3", "News: Story 4"}; !slices.Equal(lines, want) {
		t.Fatalf("digest lines %q", lines)
	}

	feed = rssWith(16) // 12 new
	e.again(v.ID)
	c = e.lastCheck(v.ID)
	rows = nil
	must(t, e.db.Where("check_id = ?", c.ID).Find(&rows).Error)
	titles := map[string]Finding{}
	for _, r := range rows {
		titles[r.Title] = r
	}
	if len(rows) != MaxItemFindings+1 {
		t.Fatalf("%d findings for 12 items", len(rows))
	}
	more, ok := titles["2 more new items"]
	if !ok || more.URL != thingsFeed || more.ThingKey != "" {
		t.Fatalf("no count of the rest: %+v", titles)
	}
	for n := 7; n <= 16; n++ {
		if _, ok := titles[fmt.Sprintf("Story %d", n)]; !ok {
			t.Fatalf("Story %d is missing: %v", n, titles)
		}
	}
	if a := e.alertRow(c.ID); len(a.Things) != 12 {
		t.Fatalf("the alert has %d things", len(a.Things))
	}
}

// Two Bots that alert on the same thing the same day share one alert: the
// later is held 'shared' and named on the first, whose notification is
// rewritten without a new push. A further 5% move, a jump in urgency or a
// new day gets through.
func TestIntegrationBotOneAlertPerThing(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	amount := "50000"
	e.coinbase(&amount)
	yes := true
	anyChange := Rule{Kind: RuleAnyChange}
	a := e.create(btcBot("BTC A", anyChange))
	b := e.create(btcBot("BTC B", anyChange))
	urgent := btcBot("BTC C", anyChange)
	urgent.Urgent = &yes
	c := e.create(urgent)
	for _, id := range []string{a.ID, b.ID, c.ID} {
		must(t, e.run(id)) // baselines
	}
	runAll := func(ids ...string) {
		t.Helper()
		for _, id := range ids {
			e.due(id)
		}
		for _, id := range ids {
			must(t, e.run(id))
		}
	}
	pushes := func() int64 { return e.count("jobs", "user_id = ? AND kind = ?", e.user, models.JobSendPush) }

	amount = "61000"
	runAll(a.ID, b.ID)
	first := e.alertRow(e.lastCheck(a.ID).ID)
	shared := e.alertRow(e.lastCheck(b.ID).ID)
	if first.Held != "" || first.NotificationID == nil || len(first.Things) != 1 || first.Things[0].Key != "price:coinbase:BTC:USD" ||
		first.Things[0].Value == nil || *first.Things[0].Value != 61000 {
		t.Fatalf("first alert %+v", first)
	}
	if shared.Held != heldShared || shared.SharedWith == nil || *shared.SharedWith != first.ID || shared.NotificationID != nil || len(shared.Things) != 0 {
		t.Fatalf("second alert %+v", shared)
	}
	first = e.alertRow(e.lastCheck(a.ID).ID)
	if len(first.AlsoSeenBy) != 1 || first.AlsoSeenBy[0] != (BotRef{BotID: b.ID, Name: "BTC B"}) {
		t.Fatalf("also seen by %+v", first.AlsoSeenBy)
	}
	var ntf models.Notification
	must(t, e.db.Where("id = ?", *first.NotificationID).First(&ntf).Error)
	if ntf.Body != first.Body+" · Also seen by BTC B" || ntf.Title != first.Title {
		t.Fatalf("notification %q / %q", ntf.Title, ntf.Body)
	}
	if n := pushes(); n != 1 {
		t.Fatalf("%d pushes for one thing", n)
	}
	if n := e.count("notifications", "user_id = ? AND category = ?", e.user, models.NotifyBot); n != 1 {
		t.Fatalf("%d notifications", n)
	}
	if n := e.count("bot_findings", "bot_id = ? AND thing_key = 'price:coinbase:BTC:USD' AND NOT alerted", b.ID); n != 1 {
		t.Fatalf("the shared Bot's note: %d", n)
	}

	// What the clients see.
	dB, err := e.s.Get(ctx, e.user, b.ID)
	must(t, err)
	if got := dB.Alerts[0]; got.Held != heldShared || got.SharedWith == nil || *got.SharedWith != (SharedRef{AlertID: first.ID, BotID: a.ID, Name: "BTC A"}) ||
		got.AlsoSeenBy == nil {
		t.Fatalf("shared alert view %+v", got)
	}
	// Held as shared, it is not B's alert to count, as its card says "No alerts yet".
	if dB.Week.Alerts != 0 || dB.AlertsMonth != 0 || dB.LatestAlert != nil {
		t.Fatalf("B counts a shared alert: week %+v, month %d, latest %+v", dB.Week, dB.AlertsMonth, dB.LatestAlert)
	}
	dA, err := e.s.Get(ctx, e.user, a.ID)
	must(t, err)
	if got := dA.Alerts[0]; len(got.AlsoSeenBy) != 1 || got.SharedWith != nil {
		t.Fatalf("first alert view %+v", got)
	}
	if dA.LatestAlert == nil || len(dA.LatestAlert.AlsoSeenBy) != 1 || dA.LatestAlert.AlsoSeenBy[0].Name != "BTC B" {
		t.Fatalf("the board's latest alert %+v", dA.LatestAlert)
	}
	list, err := e.s.List(ctx, e.user)
	must(t, err)
	if list.Summary.SharedToday != 1 || list.Summary.AlertsToday != 1 {
		t.Fatalf("summary %+v", list.Summary)
	}
	for _, bv := range list.Bots {
		if bv.ID == c.ID && (bv.LatestAlert != nil) {
			t.Fatalf("C has not alerted yet: %+v", bv.LatestAlert)
		}
	}
	// The anchor's notification is gone (Clear all): sharing still holds.
	must(t, e.db.Where("id = ?", *first.NotificationID).Delete(&models.Notification{}).Error)

	// Same price, but C is urgent: more urgent than what was told, so sent.
	runAll(c.ID)
	if got := e.alertRow(e.lastCheck(c.ID).ID); got.Held != "" || got.Urgency != UrgencyHigh || got.NotificationID == nil {
		t.Fatalf("an urgent alert on the same thing %+v", got)
	}

	// 6% more than the last told of: B gets through.
	amount = "64700"
	runAll(b.ID)
	if got := e.alertRow(e.lastCheck(b.ID).ID); got.Held != "" || got.NotificationID == nil {
		t.Fatalf("after a 6%% move %+v", got)
	}
	// A at the same price joins B's alert.
	runAll(a.ID)
	if got := e.alertRow(e.lastCheck(a.ID).ID); got.Held != heldShared || got.SharedWith == nil {
		t.Fatalf("A after B %+v", got)
	} else if anchor := e.alertRow(e.lastCheck(b.ID).ID); *got.SharedWith != anchor.ID || len(anchor.AlsoSeenBy) != 1 || anchor.AlsoSeenBy[0].BotID != a.ID {
		t.Fatalf("A joined %s, B's alert %+v", *got.SharedWith, anchor)
	}

	// The next day, a small move gets through.
	e.now = time.Date(e.now.Year(), e.now.Month(), e.now.Day()+1, 9, 0, 0, 0, time.UTC)
	amount = "64800"
	runAll(a.ID)
	if got := e.alertRow(e.lastCheck(a.ID).ID); got.Held != "" || got.NotificationID == nil {
		t.Fatalf("the next day %+v", got)
	}
	list, err = e.s.List(ctx, e.user)
	must(t, err)
	if list.Summary.SharedToday != 0 {
		t.Fatalf("shared today on a new day: %d", list.Summary.SharedToday)
	}

	// Deleting the Bot whose alert was joined leaves the shared row,
	// pointing nowhere.
	must(t, e.s.Delete(ctx, e.user, b.ID))
	if n := e.count("bot_alerts", "bot_id = ? AND held = 'shared' AND shared_with IS NULL", a.ID); n != 1 {
		t.Fatalf("%d shared rows let go of a deleted anchor", n)
	}
}

// A re-judge's flip and sharing keep each other's words: an alert the AI
// later found not worth telling is no anchor, so another Bot's alert on
// the same thing gets through; and a flip after another Bot joined still
// names it.
func TestIntegrationBotSharedRejudged(t *testing.T) {
	setup := func(t *testing.T) (*engine, *fakeJudge, View, View) {
		e := newEngine(t)
		e.zone(models.NotificationSettings{Timezone: "UTC"})
		fj := &fakeJudge{}
		e.s.SetJudge(fj)
		amount := "100.00"
		a := e.aiBTC("BTC A", &amount)
		b := e.create(btcBot("BTC B", Rule{Kind: RuleAnyChange}))
		must(t, e.run(b.ID)) // baseline
		fj.set(Verdict{}, errors.New("provider overloaded"))
		amount = "102.00"
		e.again(a.ID)
		return e, fj, a, b
	}
	body := func(e *engine, id string) string {
		e.t.Helper()
		var ntf models.Notification
		must(e.t, e.db.Where("id = ?", id).First(&ntf).Error)
		return ntf.Body
	}
	const why = "A 2% move is noise for this coin"

	t.Run("flipped first", func(t *testing.T) {
		e, fj, a, b := setup(t)
		first := e.alertRow(e.lastCheck(a.ID).ID)
		fj.set(Verdict{Alert: false, Why: why, Urgency: UrgencyLow}, nil)
		must(t, e.s.HandleRejudge(context.Background(), e.rejudgeJob(first.ID)))
		e.again(b.ID)
		got := e.alertRow(e.lastCheck(b.ID).ID)
		if got.Held != "" || got.SharedWith != nil || got.NotificationID == nil {
			t.Fatalf("B behind an alert the AI found not worth it: %+v", got)
		}
		if s := body(e, *first.NotificationID); s != rejudgeLaterLine+why {
			t.Fatalf("A's notification %q", s)
		}
		if first = e.alertRow(*first.CheckID); len(first.AlsoSeenBy) != 0 {
			t.Fatalf("A names %+v", first.AlsoSeenBy)
		}
	})

	t.Run("shared first", func(t *testing.T) {
		e, fj, a, b := setup(t)
		first := e.alertRow(e.lastCheck(a.ID).ID)
		e.again(b.ID)
		if got := e.alertRow(e.lastCheck(b.ID).ID); got.Held != heldShared || got.SharedWith == nil || *got.SharedWith != first.ID {
			t.Fatalf("B did not join A: %+v", got)
		}
		fj.set(Verdict{Alert: false, Why: why, Urgency: UrgencyLow}, nil)
		must(t, e.s.HandleRejudge(context.Background(), e.rejudgeJob(first.ID)))
		if s := body(e, *first.NotificationID); s != rejudgeLaterLine+why+" · Also seen by BTC B" {
			t.Fatalf("A's notification after the flip %q", s)
		}
	})
}
