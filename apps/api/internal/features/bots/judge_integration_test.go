package bots

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// fakeJudge stands in for the provider's judge: a fixed verdict or error,
// and a record of what it was asked. during runs inside each call.
type fakeJudge struct {
	mu        sync.Mutex
	ready     *bool  // nil: ready
	reason    string // the reason when not ready
	verdict   Verdict
	err       error
	inputs    []JudgeInput
	deadlines []time.Duration
	during    func(ctx context.Context)
	// A brief's write: the text, or briefErr, and what it was asked.
	brief    BriefText
	briefErr error
	briefs   []BriefInput
}

func (f *fakeJudge) Ready(context.Context, string) AIStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	if (f.ready != nil && !*f.ready) || f.reason != "" {
		reason := f.reason
		if reason == "" {
			reason = AIReasonNone
		}
		return AIStatus{Reason: reason}
	}
	return AIStatus{Ready: true, Provider: "fake", Label: "Fake", Model: "small"}
}

func (f *fakeJudge) Judge(ctx context.Context, _ string, in JudgeInput) (Verdict, error) {
	f.mu.Lock()
	f.inputs = append(f.inputs, in)
	if dl, ok := ctx.Deadline(); ok {
		f.deadlines = append(f.deadlines, time.Until(dl))
	}
	v, err, during := f.verdict, f.err, f.during
	f.mu.Unlock()
	if during != nil {
		during(ctx)
	}
	return v, err
}

func (f *fakeJudge) WriteBrief(_ context.Context, _ string, in BriefInput) (BriefText, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.briefs = append(f.briefs, in)
	if f.briefErr == nil && f.brief == (BriefText{}) {
		return BriefText{}, errors.New("no brief set")
	}
	return f.brief, f.briefErr
}

func (f *fakeJudge) set(v Verdict, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verdict, f.err = v, err
}

func (f *fakeJudge) calls() []JudgeInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]JudgeInput(nil), f.inputs...)
}

// aiBTC is an AI-judged Bot on a moving BTC price that fires on every move
// of 1% or more.
func (e *engine) aiBTC(name string, amount *string) View {
	e.t.Helper()
	e.coinbase(amount)
	in := btcBot(name, Rule{Kind: RuleMovePct, Percent: f64(1), Direction: DirAny})
	in.JudgeMode = JudgeAI
	v := e.create(in)
	must(e.t, e.run(v.ID)) // baseline
	return v
}

func (e *engine) alertRow(checkID string) Alert {
	e.t.Helper()
	var a Alert
	must(e.t, e.db.Where("check_id = ?", checkID).First(&a).Error)
	return a
}

func (e *engine) rejudgeJob(alertID string) *models.Job {
	e.t.Helper()
	var j models.Job
	must(e.t, e.db.Where("dedupe_key = ? AND status = ?", rejudgeKey(alertID), models.JobPending).First(&j).Error)
	j.Attempts++ // as the worker's claim does
	return &j
}

// An AI-judged Bot alerts in the judge's words, keeps the rules' words for
// lessons and the next judge input, and calls the judge outside the save's
// transaction.
func TestIntegrationBotJudgeAlerts(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC moves", &amount)
	if len(fj.calls()) != 0 {
		t.Fatal("a baseline was judged")
	}
	var lockErr error
	fj.during = func(context.Context) {
		lockErr = e.db.Transaction(func(tx *gorm.DB) error {
			return tx.Exec(`SELECT id FROM bots WHERE id = ? FOR UPDATE NOWAIT`, v.ID).Error
		})
	}
	fj.set(Verdict{Alert: true, Title: "BTC jumped past your buy line", Why: "You said you sell above 102", Urgency: UrgencyHigh}, nil)
	amount = "102.00"
	e.again(v.ID)
	if lockErr != nil {
		t.Fatalf("the judge ran while the Bot's row was locked: %v", lockErr)
	}
	c := e.lastCheck(v.ID)
	a := e.alertRow(c.ID)
	if c.Outcome != outFired || c.AlertID == nil || *c.AlertID != a.ID {
		t.Fatalf("check %+v", c)
	}
	if a.Title != "BTC moves: BTC jumped past your buy line" || a.Body != "You said you sell above 102" || a.AIState != aiJudged ||
		a.AIWhy != "You said you sell above 102" || a.Urgency != UrgencyHigh || a.Urgent || a.Figures["what"] != "up 2.0%" || len(a.AIInput) != 0 {
		t.Fatalf("judged alert %+v", a)
	}
	ntfs := e.notifications()
	if len(ntfs) != 1 || ntfs[0].Title != a.Title || ntfs[0].Body != a.Body {
		t.Fatalf("notifications %+v", ntfs)
	}
	var f Finding
	must(t, e.db.Where("check_id = ?", c.ID).First(&f).Error)
	if f.Title != "up 2.0%" || f.Urgency != UrgencyHigh || !f.Alerted || !f.OutsideData {
		t.Fatalf("finding %+v", f)
	}
	in := fj.calls()[0]
	if in.Bot != "BTC moves" || len(in.Changes) != 1 || in.Changes[0].What != "up 2.0%" || in.Changes[0].Before != "$100" ||
		in.Changes[0].After != "$102" || in.Changes[0].Rule != "Moves 1% either way" || in.LastAlert != nil || in.Now != "Fri 6 Nov 09:45" {
		t.Fatalf("judge input %+v", in)
	}
	if n := e.count("bot_ai_calls", "bot_id = ? AND purpose = 'judge' AND ok AND chain_id = ?", v.ID, c.ID); n != 1 {
		t.Fatalf("%d AI calls logged", n)
	}

	// The board shows how AI saw the latest alert, and today's AI count.
	d, err := e.s.Get(context.Background(), e.user, v.ID)
	must(t, err)
	la := d.LatestAlert
	if la == nil || la.ID != a.ID || la.Kind != alertKindAlert || la.AIState != aiJudged || la.AIWhy != a.AIWhy || la.Urgency != UrgencyHigh ||
		la.RulesTitle != "BTC moves: up 2.0%" || d.AIChecksToday != 1 || d.Alerts[0].AIState != aiJudged || d.Alerts[0].Urgency != UrgencyHigh {
		t.Fatalf("latest alert %+v, AI today %d", la, d.AIChecksToday)
	}
	list, err := e.s.List(context.Background(), e.user)
	must(t, err)
	if list.Summary.AIChecksToday != 1 || list.Summary.AICap != AIPerAccount {
		t.Fatalf("summary %+v", list.Summary)
	}

	// Rating it teaches the rules' words, never the judge's title, and the
	// next judge input shows the last alert in the rules' words too.
	res, err := e.s.RateAlert(context.Background(), e.user, v.ID, a.ID, Rating{Feedback: ptr(FeedbackUseful)})
	must(t, err)
	if res.Lesson == nil || res.Lesson.Text != "Wanted: “up 2.0%”" {
		t.Fatalf("lesson %+v", res.Lesson)
	}
	amount = "104.50"
	e.again(v.ID)
	in = fj.calls()[1]
	if in.LastAlert == nil || in.LastAlert.Title != "BTC moves: up 2.0%" || in.LastAlert.Body != "" || in.LastAlert.Feedback != FeedbackUseful ||
		len(in.Lessons) != 1 || in.Lessons[0] != "Wanted: “up 2.0%”" {
		t.Fatalf("second judge input %+v", in)
	}
}

// A verdict of "not worth it" holds the alert back: the row is kept for the
// person to see and rate, nothing is sent, and it does not count toward the
// day's cap.
func TestIntegrationBotJudgeHoldsBack(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC quiet", &amount)
	fj.set(Verdict{Alert: false, Title: "Small move", Why: "Under the 5% the person cares about", Urgency: UrgencyLow}, nil)
	amount = "102.00"
	e.again(v.ID)
	c := e.lastCheck(v.ID)
	a := e.alertRow(c.ID)
	if c.Outcome != outJudgedQuiet || c.AlertID == nil || *c.AlertID != a.ID {
		t.Fatalf("check %+v", c)
	}
	if a.Held != heldJudged || a.NotificationID != nil || a.AIState != aiJudged || a.AIWhy != "Under the 5% the person cares about" ||
		a.Urgency != UrgencyLow || a.Title != "BTC quiet: up 2.0%" || a.Figures["what"] != "up 2.0%" {
		t.Fatalf("held alert %+v", a)
	}
	if n := len(e.notifications()); n != 0 {
		t.Fatalf("a held alert notified %d times", n)
	}
	if n := e.count("bot_findings", "check_id = ? AND NOT alerted AND urgency = 'low'", c.ID); n != 1 {
		t.Fatal("the held check's finding")
	}
	// A held note stays on the rail: no brief or digest brings it back.
	d0, err := collectBrief(e.db, e.user, []BotRef{{BotID: v.ID, Name: v.Name}}, c.StartedAt.Add(-time.Hour), e.now.Add(time.Hour))
	must(t, err)
	lines, _, err := e.s.DigestLines(context.Background(), e.user, e.now)
	must(t, err)
	if d0.n != 0 || len(lines) != 0 {
		t.Fatalf("a held note in a brief (%d) or the digest %q", d0.n, lines)
	}
	if b := e.bot(v.ID); b.Health != healthWorking {
		t.Fatalf("bot %+v", b)
	}
	d, err := e.s.Get(context.Background(), e.user, v.ID)
	must(t, err)
	if d.LatestAlert != nil || d.AlertsToday != 0 || !strings.HasSuffix(d.Strip, "c") {
		t.Fatalf("board after a held alert: latest %+v, today %d, strip %q", d.LatestAlert, d.AlertsToday, d.Strip)
	}
	if d.Week.Alerts != 0 || d.AlertsMonth != 0 {
		t.Fatalf("a held alert counted as sent: week %+v, month %d", d.Week, d.AlertsMonth)
	}
	// Useful on a held alert teaches "should have told me".
	res, err := e.s.RateAlert(context.Background(), e.user, v.ID, a.ID, Rating{Feedback: ptr(FeedbackUseful)})
	must(t, err)
	if res.Lesson == nil || res.Lesson.Text != "Should have told me: “up 2.0%”" {
		t.Fatalf("lesson %+v", res.Lesson)
	}

	// Three alerts worth it still go out: the held one used no slot.
	fj.set(Verdict{Alert: true, Title: "Moved", Why: "Worth it", Urgency: UrgencyNormal}, nil)
	for _, next := range []string{"104.10", "106.20", "108.40"} {
		amount = next
		e.again(v.ID)
	}
	if n := len(e.notifications()); n != AlertsPerDay {
		t.Fatalf("%d notifications after a held alert and %d sent", n, AlertsPerDay)
	}
	if n := e.count("bot_alerts", "bot_id = ? AND held = 'cap'", v.ID); n != 0 {
		t.Fatalf("%d capped", n)
	}
}

// When AI is unavailable the rules alert goes out marked unchecked, and a
// re-judge follows: a flip to "not worth it" rewrites the notification, a
// confirmation does not, and after the last try the stored input is gone.
func TestIntegrationBotJudgeUnavailable(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC later", &amount)
	fj.set(Verdict{}, errors.New("provider overloaded"))
	amount = "102.00"
	e.again(v.ID)
	c := e.lastCheck(v.ID)
	a := e.alertRow(c.ID)
	if c.Outcome != outFired || a.AIState != aiUnchecked || a.AIWhy != noteLater || a.Body != "BTC now $102 (was $100)" ||
		a.Title != "BTC later: up 2.0%" || len(a.AIInput) == 0 || a.NotificationID == nil {
		t.Fatalf("unchecked alert %+v", a)
	}
	// Only the notification carries the mark; the alert keeps the rules' words.
	if ntf := e.notifications(); len(ntf) != 1 || ntf[0].Body != "BTC now $102 (was $100) (not checked by AI)" {
		t.Fatalf("unchecked notification %+v", ntf)
	}
	job := e.rejudgeJob(a.ID)
	if job.Kind != models.JobBotJudge || job.MaxAttempts != rejudgeAttempts || !job.RunAt.Equal(e.now.Add(rejudgeFirst)) || job.Payload.String("alertId") != a.ID {
		t.Fatalf("re-judge job %+v", job)
	}

	// The re-judge says it was not worth it: the notification is rewritten.
	fj.set(Verdict{Alert: false, Why: "A 2% move is noise for this coin", Urgency: UrgencyLow}, nil)
	must(t, e.s.HandleRejudge(ctx, job))
	a = e.alertRow(c.ID)
	var ntf models.Notification
	must(t, e.db.Where("id = ?", *a.NotificationID).First(&ntf).Error)
	if a.AIState != aiRejudged || a.AIWhy != "A 2% move is noise for this coin" || len(a.AIInput) != 0 ||
		ntf.Body != "AI checked it later: A 2% move is noise for this coin" || ntf.Title != a.Title {
		t.Fatalf("after a flip: alert %+v, notification %q / %q", a, ntf.Title, ntf.Body)
	}
	if n := e.count("bot_ai_calls", "bot_id = ? AND purpose = 'rejudge' AND chain_id = ?", v.ID, c.ID); n != 1 {
		t.Fatalf("%d re-judge calls on the chain", n)
	}
	// Running the job again does nothing.
	must(t, e.s.HandleRejudge(ctx, job))
	if n := e.count("bot_ai_calls", "bot_id = ?", v.ID); n != 2 {
		t.Fatalf("%d AI calls after a repeat", n)
	}

	// The next one is confirmed: marked judged, the notification left alone.
	fj.set(Verdict{}, errors.New("timeout"))
	amount = "104.50"
	e.again(v.ID)
	c2 := e.lastCheck(v.ID)
	a2 := e.alertRow(c2.ID)
	fj.set(Verdict{Alert: true, Why: "Worth knowing", Urgency: UrgencyHigh}, nil)
	must(t, e.s.HandleRejudge(ctx, e.rejudgeJob(a2.ID)))
	a2 = e.alertRow(c2.ID)
	ntf = models.Notification{}
	must(t, e.db.Where("id = ?", *a2.NotificationID).First(&ntf).Error)
	if a2.AIState != aiJudged || a2.AIWhy != "Worth knowing" || a2.Urgency != UrgencyHigh || len(a2.AIInput) != 0 ||
		ntf.Body != a2.Body+uncheckedSuffix || strings.HasSuffix(a2.Body, uncheckedSuffix) {
		t.Fatalf("after a confirmation: alert %+v, notification %q", a2, ntf.Body)
	}

	// A re-judge that keeps failing retries, then drops the input.
	fj.set(Verdict{}, errors.New("still down"))
	amount = "107.00"
	e.again(v.ID)
	a3 := e.alertRow(e.lastCheck(v.ID).ID)
	job = e.rejudgeJob(a3.ID)
	if err := e.s.HandleRejudge(ctx, job); err == nil {
		t.Fatal("a failed re-judge did not ask to retry")
	}
	if a3 = e.alertRow(*a3.CheckID); len(a3.AIInput) == 0 {
		t.Fatal("the input went before the last try")
	}
	job.Attempts = job.MaxAttempts
	if err := e.s.HandleRejudge(ctx, job); err == nil {
		t.Fatal("the last failed try did not fail the job")
	}
	if a3 = e.alertRow(*a3.CheckID); len(a3.AIInput) != 0 || a3.AIState != aiUnchecked || a3.AIWhy != noteGaveUp {
		t.Fatalf("after the last try %+v", a3)
	}
	if got := rejudgeDelay(1); got != 45*time.Minute {
		t.Fatalf("delay after the first try %s", got)
	}
	if got := rejudgeDelay(2); got != 2*time.Hour {
		t.Fatalf("delay after the second try %s", got)
	}
}

// An unchecked alert held while the Bot is snoozed queues no re-judge and
// keeps no input: a re-judge could only rewrite a notification it never had.
// Prune drops any input left past the retries.
func TestIntegrationBotJudgeUnavailableSnoozed(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	v := e.aiBTC("BTC asleep", &amount)
	until := e.now.Add(24 * time.Hour)
	_, err := e.s.Snooze(ctx, e.user, v.ID, &until)
	must(t, err)
	fj.set(Verdict{}, errors.New("provider overloaded"))
	amount = "102.00"
	e.again(v.ID)
	a := e.alertRow(e.lastCheck(v.ID).ID)
	if a.Held != heldSnoozed || a.AIState != aiUnchecked || len(a.AIInput) != 0 || a.NotificationID != nil {
		t.Fatalf("snoozed unchecked alert %+v", a)
	}
	if n := e.count("jobs", "kind = ?", models.JobBotJudge); n != 0 {
		t.Fatalf("%d re-judges for a held alert", n)
	}

	must(t, e.db.Model(&Alert{}).Where("id = ?", a.ID).Update("ai_input", `{"chainId":"x"}`).Error)
	must(t, e.s.prune(ctx, e.now.Add(rejudgeKeepInput-time.Minute)))
	if a = e.alertRow(*a.CheckID); len(a.AIInput) == 0 {
		t.Fatal("prune dropped an input inside the retries")
	}
	must(t, e.s.prune(ctx, e.now.Add(rejudgeKeepInput+time.Minute)))
	if a = e.alertRow(*a.CheckID); len(a.AIInput) != 0 || a.AIState != aiUnchecked {
		t.Fatalf("after prune %+v", a)
	}
}

// With no AI, AI off or the caps used up, the rules alert goes out marked
// unchecked with a reason and no re-judge; a call AI never made takes no
// slot.
func TestIntegrationBotJudgeOffAndCapped(t *testing.T) {
	e := newEngine(t)
	amount := "100.00"
	v := e.aiBTC("BTC off", &amount)
	step := func(next string) Alert {
		t.Helper()
		amount = next
		e.again(v.ID)
		return e.alertRow(e.lastCheck(v.ID).ID)
	}
	noJob := func(a Alert) {
		t.Helper()
		if len(a.AIInput) != 0 || e.count("jobs", "dedupe_key = ?", rejudgeKey(a.ID)) != 0 {
			t.Fatalf("a re-judge was queued for %+v", a)
		}
	}
	// No judge wired at all.
	if a := step("102.00"); a.AIState != aiUnchecked || a.AIWhy != noteNoProvider || strings.HasSuffix(a.Body, uncheckedSuffix) {
		t.Fatalf("no judge %+v", a)
	} else {
		noJob(a)
	}
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	fj.set(Verdict{}, fmt.Errorf("%w: no key saved", ErrJudgeOff))
	if a := step("104.10"); a.AIState != aiUnchecked || a.AIWhy != noteNoProvider {
		t.Fatalf("judge off %+v", a)
	} else {
		noJob(a)
	}
	fj.reason = AIReasonNotChosen
	if a := step("106.20"); a.AIWhy != noteNotChosen {
		t.Fatalf("provider not chosen %+v", a)
	} else {
		noJob(a)
	}
	if n := e.count("bot_ai_calls", "bot_id = ?", v.ID); n != 0 {
		t.Fatalf("%d slots used by calls AI never made", n)
	}

	// The Bot's 20 for today are used: no call, unchecked, no re-judge.
	fj.reason = ""
	fj.set(Verdict{Alert: true, Why: "x", Urgency: UrgencyNormal}, nil)
	day := e.now.Format(dayLayout)
	for i := range AIPerBot {
		must(t, e.db.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, local_day, purpose, ok) VALUES (?, ?, ?, ?, 'judge', true)`,
			fmt.Sprintf("bai_cap_%d", i), e.user, v.ID, day).Error)
	}
	before := len(fj.calls())
	if a := step("108.40"); a.AIState != aiUnchecked || a.AIWhy != noteUsedUp {
		t.Fatalf("capped %+v", a)
	} else {
		noJob(a)
	}
	if len(fj.calls()) != before {
		t.Fatal("the judge was called past the cap")
	}
}

// A rules Bot never asks the judge and alerts as before.
func TestIntegrationBotJudgeRulesBot(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	amount := "100.00"
	e.coinbase(&amount)
	urgent := true
	in := btcBot("BTC rules", Rule{Kind: RuleMovePct, Percent: f64(1), Direction: DirAny})
	in.Urgent = &urgent
	v := e.create(in)
	must(t, e.run(v.ID))
	amount = "102.00"
	e.again(v.ID)
	a := e.alertRow(e.lastCheck(v.ID).ID)
	if len(fj.calls()) != 0 || a.AIState != "" || a.AIWhy != "" || a.Urgency != UrgencyHigh || a.Body != "BTC now $102 (was $100)" || a.Figures["what"] != "up 2.0%" {
		t.Fatalf("rules alert %+v", a)
	}
	if n := e.count("bot_ai_calls", "user_id = ?", e.user); n != 0 {
		t.Fatalf("%d AI calls for a rules bot", n)
	}
}

// A watch edited between the judge and the save drops out of the save, so
// the verdict is about something else: the alert goes out in the rules'
// words, unchecked, with no re-judge.
func TestIntegrationBotJudgeEditedMeanwhile(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	btc, eth := "100.00", "2000.00"
	e.coinbase(&btc)
	const ethURL = "https://api.coinbase.com/v2/prices/ETH-USD/spot"
	e.net.set(ethURL, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "application/json", `{"data":{"amount":"`+eth+`","base":"ETH","currency":"USD"}}`), nil
	})
	move := Rule{Kind: RuleMovePct, Percent: f64(1), Direction: DirAny}
	v := e.create(Input{Name: "Coins", JudgeMode: JudgeAI, Watches: []WatchInput{
		{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Rules: []Rule{move}},
		{Kind: WatchPrice, Source: "coinbase", Symbol: "ETH", Rules: []Rule{move}},
	}})
	must(t, e.run(v.ID))
	fj.set(Verdict{Alert: false, Why: "Not worth it", Urgency: UrgencyLow}, nil)
	fj.during = func(context.Context) {
		must(t, e.db.Exec(`UPDATE bot_watches SET config_version = config_version + 1 WHERE id = ?`, v.Watches[1].ID).Error)
	}
	btc, eth = "102.00", "2100.00"
	e.again(v.ID)
	if in := fj.calls()[0]; len(in.Changes) != 2 {
		t.Fatalf("the judge saw %d changes", len(in.Changes))
	}
	c := e.lastCheck(v.ID)
	a := e.alertRow(c.ID)
	if c.Outcome != outFired || a.Held != "" || a.AIState != aiUnchecked || a.AIWhy != noteChanged || len(a.AIInput) != 0 ||
		a.Body != "BTC now $102 (was $100)" {
		t.Fatalf("check %s, alert %+v", c.Outcome, a)
	}
	if n := e.count("jobs", "kind = ?", models.JobBotJudge); n != 0 {
		t.Fatalf("%d re-judges", n)
	}
}

// A tag's check gives the judge less time, so its answer still arrives
// within Ask's wait.
func TestIntegrationBotJudgeAskTimeout(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	fj.set(Verdict{Alert: true, Why: "x", Urgency: UrgencyNormal}, nil)
	amount := "100.00"
	v := e.aiBTC("BTC ask", &amount)
	amount = "102.00"
	e.due(v.ID)
	must(t, e.s.HandleCheck(context.Background(), e.job(v.ID, TriggerAsk)))
	amount = "104.50"
	e.again(v.ID)
	if len(fj.deadlines) != 2 || fj.deadlines[0] > AskJudgeTimeout || fj.deadlines[0] < AskJudgeTimeout-5*time.Second ||
		fj.deadlines[1] <= AskJudgeTimeout || fj.deadlines[1] > JudgeTimeout {
		t.Fatalf("judge deadlines %v", fj.deadlines)
	}
}

// The caps hold under concurrent calls: 20 per Bot, 200 per account and 6
// per chain, whoever makes them.
func TestIntegrationBotAICaps(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	race := func(n int, call func(i int) error) (ok int64) {
		var wg sync.WaitGroup
		for i := range n {
			wg.Add(1)
			go func() {
				defer wg.Done()
				err := call(i)
				switch {
				case err == nil:
					atomic.AddInt64(&ok, 1)
				case !errors.Is(err, errAICap):
					t.Errorf("reserve: %v", err)
				}
			}()
		}
		wg.Wait()
		return ok
	}
	one := Bot{ID: "bot_cap_one", UserID: e.user}
	if got := race(8*4, func(int) error { _, err := e.s.reserveAI(ctx, one, "", purposeJudge, e.now); return err }); got != AIPerBot {
		t.Fatalf("one bot made %d calls", got)
	}
	chain := "bchk_chain"
	if got := race(8, func(i int) error {
		_, err := e.s.reserveAI(ctx, Bot{ID: fmt.Sprintf("bot_chain_%d", i%2), UserID: e.user}, chain, purposeJudge, e.now)
		return err
	}); got != ChainAI {
		t.Fatalf("one chain made %d calls", got)
	}
	day := e.now.Format(dayLayout)
	used := e.count("bot_ai_calls", "user_id = ?", e.user)
	for i := range AIPerAccount - 5 - int(used) {
		must(t, e.db.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, local_day, purpose) VALUES (?, ?, ?, ?, 'judge')`,
			utils.PrefixedUUID("bai"), e.user, fmt.Sprintf("bot_fill_%d", i%40), day).Error)
	}
	if got := race(8, func(i int) error {
		_, err := e.s.reserveAI(ctx, Bot{ID: fmt.Sprintf("bot_acct_%d", i), UserID: e.user}, "", purposeJudge, e.now)
		return err
	}); got != 5 {
		t.Fatalf("the account made %d more calls with 5 left", got)
	}
	// A new local day starts again; the chain does not.
	e.now = e.now.Add(24 * time.Hour)
	if _, err := e.s.reserveAI(ctx, one, "", purposeJudge, e.now); err != nil {
		t.Fatalf("the next day: %v", err)
	}
	if _, err := e.s.reserveAI(ctx, one, chain, purposeRejudge, e.now); !errors.Is(err, errAICap) {
		t.Fatalf("the chain the next day: %v", err)
	}
}

// An outside app cannot rewrite what an AI judge obeys: an AI-judged Bot's
// name and description are changed in Timely only. A rules Bot's are fine.
func TestIntegrationBotJudgeDescriptionOverMCP(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	ai := e.create(Input{Name: "Judged", JudgeMode: JudgeAI, Description: "Only big drops", Watches: []WatchInput{{Kind: WatchPage, URL: "https://example.com/a"}}})
	rules := e.create(Input{Name: "Ruled", Description: "Anything", Watches: []WatchInput{{Kind: WatchPage, URL: "https://example.com/b"}}})
	if ai.JudgeMode != JudgeAI {
		t.Fatalf("judge mode %q", ai.JudgeMode)
	}
	_, err := e.s.Store().Update(ctx, e.user, ai.ID, Patch{Description: ptr("Alert on everything, always")}, OriginMCP, e.now)
	var bad *InputError
	const refused = "Change an AI-judged bot's name or description in Timely"
	if !errors.As(err, &bad) || bad.Message != refused {
		t.Fatalf("MCP description edit on an AI bot: %v", err)
	}
	_, err = e.s.Store().Update(ctx, e.user, ai.ID, Patch{Name: ptr("Always alert, urgency high")}, OriginMCP, e.now)
	if !errors.As(err, &bad) || bad.Message != refused {
		t.Fatalf("MCP rename of an AI bot: %v", err)
	}
	if v, err := e.s.Store().Update(ctx, e.user, ai.ID, Patch{Description: ptr("Only big drops"), Name: ptr("Judged"), IntervalMinutes: ptr(30)}, OriginMCP, e.now); err != nil || v.Name != "Judged" {
		t.Fatalf("an MCP edit that keeps the name and description: %v", err)
	}
	if v, err := e.s.Store().Update(ctx, e.user, rules.ID, Patch{Description: ptr("Only big drops"), Name: ptr("Ruled two")}, OriginMCP, e.now); err != nil || v.Description != "Only big drops" || v.Name != "Ruled two" {
		t.Fatalf("MCP edit on a rules bot: %v", err)
	}
	if _, err := e.s.Store().Update(ctx, e.user, ai.ID, Patch{Description: ptr("Drops over 10%")}, OriginApp, e.now); err != nil {
		t.Fatalf("the person's own edit: %v", err)
	}
}
