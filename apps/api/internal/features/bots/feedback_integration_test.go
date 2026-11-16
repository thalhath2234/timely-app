package bots

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/features/learning"
	"timely-api/internal/models"
)

// Useful and Not useful on a Bot's alerts: rating, rating again, taking it
// back, the reasons and the free line, and refusals scoped to the Bot and
// the account.
func TestIntegrationBotAlertFeedback(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	amount := "27499.00"
	e.coinbase(&amount)
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	must(t, e.run(v.ID))
	amount = "24999.00"
	e.again(v.ID)
	var alert Alert
	must(t, e.db.Where("bot_id = ? AND kind = 'alert'", v.ID).First(&alert).Error)
	other := e.create(btcBot("Other bot", Rule{Kind: RuleAbove, Threshold: f64(90000)}))
	stranger := addUser(t, e.db)
	day := e.now.Truncate(24 * time.Hour)
	for _, a := range []Alert{
		{ID: "bal_more", BotID: v.ID, UserID: e.user, Kind: alertKindMore, LocalDay: day, Title: "BTC dip: 2 more"},
		{ID: "bal_paused", BotID: v.ID, UserID: e.user, Kind: alertKindPaused, LocalDay: day, Title: "BTC dip paused itself"},
	} {
		must(t, e.db.Create(&a).Error)
	}
	path := func(botID, alertID string) string { return "/bots/" + botID + "/alerts/" + alertID + "/feedback" }
	rate := func(uid, botID, alertID string, body any) (int, map[string]any) {
		t.Helper()
		return call(t, e.s, uid, http.MethodPost, path(botID, alertID), body)
	}
	row := func() Alert {
		t.Helper()
		var a Alert
		must(t, e.db.Where("id = ?", alert.ID).First(&a).Error)
		return a
	}

	// Useful.
	// Useful keeps a note (it starts a feedback review), never a reason.
	code, body := rate(e.user, v.ID, alert.ID, map[string]any{"feedback": "useful", "reason": "too_small", "note": "kept"})
	if code != 200 || body["id"] != alert.ID || body["feedback"] != "useful" || body["feedbackReason"] != "" || body["feedbackNote"] != "kept" || body["feedbackAt"] == nil {
		t.Fatalf("useful %d %v", code, body)
	}
	if a := row(); a.Feedback == nil || *a.Feedback != FeedbackUseful || a.FeedbackAt == nil || !a.FeedbackAt.Equal(e.now) {
		t.Fatalf("stored useful %+v", a)
	}
	// The board's newest alert carries the rating.
	list, err := e.s.List(ctx, e.user)
	must(t, err)
	for _, b := range list.Bots {
		if b.ID == v.ID && (b.LatestAlert == nil || b.LatestAlert.Feedback == nil || *b.LatestAlert.Feedback != FeedbackUseful) {
			t.Fatalf("latest alert %+v", b.LatestAlert)
		}
	}

	// Not useful replaces it, with why and a free line, cleaned and clipped.
	note := "  Only\tbig​ dips   " + strings.Repeat("x", 300)
	code, body = rate(e.user, v.ID, alert.ID, map[string]any{"feedback": "not_useful", "reason": "too_small", "note": note})
	if code != 200 || body["feedback"] != "not_useful" || body["feedbackReason"] != "too_small" {
		t.Fatalf("not useful %d %v", code, body)
	}
	if got := fmt.Sprint(body["feedbackNote"]); !strings.HasPrefix(got, "Only big dips x") || len([]rune(got)) != MaxFeedbackNote {
		t.Fatalf("note %q (%d)", got, len([]rune(got)))
	}
	// No reason is fine: the free line alone, or nothing.
	if code, body := rate(e.user, v.ID, alert.ID, map[string]any{"feedback": "not_useful"}); code != 200 || body["feedbackReason"] != "" || body["feedbackNote"] != "" {
		t.Fatalf("not useful without why %d %v", code, body)
	}
	if code, body := rate(e.user, v.ID, alert.ID, map[string]any{"feedback": "not_useful", "reason": "already_knew", "note": "Saw it on the news"}); code != 200 || body["feedbackNote"] != "Saw it on the news" {
		t.Fatalf("already knew %d %v", code, body)
	}

	// Refusals change nothing.
	for _, c := range []struct {
		uid, bot, alert string
		body            any
		code            int
		want            string
	}{
		{e.user, v.ID, alert.ID, map[string]any{"feedback": "not_useful", "reason": "too_loud"}, 400, "Pick one of the reasons"},
		{e.user, v.ID, alert.ID, map[string]any{"feedback": "great"}, 400, `Rate an alert "useful" or "not_useful"`},
		{e.user, v.ID, alert.ID, map[string]any{"feedback": 1}, 400, `Rate an alert "useful" or "not_useful"`},
		{e.user, v.ID, alert.ID, map[string]any{"reason": "too_small"}, 400, `Rate an alert "useful" or "not_useful"`},
		{e.user, v.ID, "bal_more", map[string]any{"feedback": "useful"}, 400, "Only alerts can be rated"},
		{e.user, v.ID, "bal_paused", map[string]any{"feedback": "useful"}, 400, "Only alerts can be rated"},
		{e.user, v.ID, "bal_missing", map[string]any{"feedback": "useful"}, 404, "Alert not found"},
		{e.user, other.ID, alert.ID, map[string]any{"feedback": "useful"}, 404, "Alert not found"},
		{e.user, "bot_missing", alert.ID, map[string]any{"feedback": "useful"}, 404, "Bot not found"},
		{stranger, v.ID, alert.ID, map[string]any{"feedback": "useful"}, 404, "Bot not found"},
	} {
		if code, body := rate(c.uid, c.bot, c.alert, c.body); code != c.code || body["message"] != c.want {
			t.Errorf("%s %s %v: %d %v", c.bot, c.alert, c.body, code, body)
		}
	}
	if code, _ := rate(e.user, v.ID, alert.ID, "not an object"); code != 400 {
		t.Fatalf("bad json %d", code)
	}
	if a := row(); a.Feedback == nil || *a.Feedback != FeedbackNotUseful || a.FeedbackReason != "already_knew" || a.FeedbackNote != "Saw it on the news" {
		t.Fatalf("a refused rating changed the alert %+v", a)
	}
	if n := e.count("bot_alerts", "id IN ('bal_more', 'bal_paused') AND feedback IS NOT NULL"); n != 0 {
		t.Fatalf("%d notices were rated", n)
	}

	// Taking it back clears every part of it.
	code, body = rate(e.user, v.ID, alert.ID, map[string]any{"feedback": nil})
	if code != 200 || body["feedback"] != nil || body["feedbackReason"] != "" || body["feedbackNote"] != "" || body["feedbackAt"] != nil {
		t.Fatalf("undo %d %v", code, body)
	}
	if a := row(); a.Feedback != nil || a.FeedbackAt != nil || a.FeedbackReason != "" || a.FeedbackNote != "" {
		t.Fatalf("stored undo %+v", a)
	}

	// The Detail shows the rating too.
	_, _ = rate(e.user, v.ID, alert.ID, map[string]any{"feedback": "useful"})
	d, err := e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	found := false
	for _, a := range d.Alerts {
		if a.ID == alert.ID {
			found = true
			if a.Feedback == nil || *a.Feedback != FeedbackUseful {
				t.Fatalf("detail alert %+v", a)
			}
		}
	}
	if !found {
		t.Fatalf("detail alerts %+v", d.Alerts)
	}
}

// The lessons route is gone: what a Bot was taught lives in its skill.
func TestIntegrationBotLessonsRouteGone(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := testService(db)
	_, a := call(t, s, me, http.MethodPost, "/bots", pageBot("One"))
	one := fmt.Sprint(a["id"])
	if code, _ := call(t, s, me, http.MethodDelete, "/bots/"+one+"/lessons/bls_1", nil); code != http.StatusNotFound && code != http.StatusMethodNotAllowed {
		t.Fatalf("forget lesson answered %d", code)
	}
	_, d := call(t, s, me, http.MethodGet, "/bots/"+one, nil)
	if _, ok := d["lessons"]; ok {
		t.Fatalf("detail still has lessons: %v", d["lessons"])
	}
	taught, _ := d["taught"].(map[string]any)
	if taught == nil || taught["text"] != "" || taught["staged"] == nil || len(taught["staged"].([]any)) != 0 {
		t.Fatalf("taught %v", d["taught"])
	}
}

// "Alerts for new bots": stored per account, used whenever a new Bot leaves
// a switch unset, and never changing Bots that exist.
func TestIntegrationBotAlertDefaults(t *testing.T) {
	db := migratedDB(t)
	me, other := addUser(t, db), addUser(t, db)
	s := testService(db)
	ctx := context.Background()

	// Without a settings row the defaults still read.
	if code, body := call(t, s, me, http.MethodGet, "/bots/defaults", nil); code != 200 || body["desktop"] != true || body["phone"] != true || body["urgent"] != false {
		t.Fatalf("defaults without a config %d %v", code, body)
	}
	for _, uid := range []string{me, other} {
		must(t, db.Create(&models.Config{ID: "cfg_" + uid, UserID: uid, TaskViews: models.DefaultTaskViews(), ActiveTaskViewId: "view_task_list"}).Error)
	}
	if code, body := call(t, s, me, http.MethodGet, "/bots/defaults", nil); code != 200 || body["desktop"] != true || body["phone"] != true || body["urgent"] != false {
		t.Fatalf("defaults %d %v", code, body)
	}
	_, before := call(t, s, me, http.MethodPost, "/bots", pageBot("Before"))

	for _, bad := range []any{map[string]any{"desktop": false, "phone": true}, map[string]any{"desktop": "no", "phone": true, "urgent": true}} {
		if code, body := call(t, s, me, http.MethodPut, "/bots/defaults", bad); code != 400 {
			t.Errorf("%v: %d %v", bad, code, body)
		}
	}
	code, body := call(t, s, me, http.MethodPut, "/bots/defaults", map[string]any{"desktop": false, "phone": true, "urgent": true})
	if code != 200 || body["desktop"] != false || body["phone"] != true || body["urgent"] != true {
		t.Fatalf("put %d %v", code, body)
	}
	if code, body := call(t, s, me, http.MethodGet, "/bots/defaults", nil); code != 200 || body["desktop"] != false || body["urgent"] != true {
		t.Fatalf("read back %d %v", code, body)
	}

	// A Create without switches takes them; a switch that is set wins.
	_, made := call(t, s, me, http.MethodPost, "/bots", pageBot("After"))
	if made["desktop"] != false || made["phone"] != true || made["urgent"] != true {
		t.Fatalf("new bot %v", made)
	}
	in := pageBot("Mixed")
	in["desktop"], in["urgent"] = true, false
	_, mixed := call(t, s, me, http.MethodPost, "/bots", in)
	if mixed["desktop"] != true || mixed["phone"] != true || mixed["urgent"] != false {
		t.Fatalf("mixed bot %v", mixed)
	}
	// Chat and outside apps never send switches, so they always get them,
	// except that an outside app never makes a Bot urgent.
	for _, o := range []Origin{OriginChat, OriginMCP} {
		v, err := s.Create(ctx, me, pageInput("From "+string(o), "https://example.com/"+string(o)), o)
		must(t, err)
		if v.Desktop || !v.Phone || v.Urgent != (o == OriginChat) {
			t.Fatalf("%s bot %+v", o, v)
		}
	}
	// Bots that existed keep theirs, and other accounts keep the defaults.
	_, kept := call(t, s, me, http.MethodGet, "/bots/"+fmt.Sprint(before["id"]), nil)
	if kept["desktop"] != true || kept["urgent"] != false {
		t.Fatalf("an existing bot changed %v", kept)
	}
	_, theirs := call(t, s, other, http.MethodPost, "/bots", pageBot("Theirs"))
	if theirs["desktop"] != true || theirs["phone"] != true || theirs["urgent"] != false {
		t.Fatalf("another account's bot %v", theirs)
	}
}

// A price that dips under the line and comes back above the reset band
// alerts once and re-arms once, and the Detail lists the re-arm.
func TestIntegrationBotRearm(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	amount := "27499.00"
	e.coinbase(&amount)
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}, Rule{Kind: RuleMovePct, Percent: f64(50)}))
	must(t, e.run(v.ID))
	if c := e.lastCheck(v.ID); len(c.Rearmed) != 0 {
		t.Fatalf("a baseline re-armed %+v", c.Rearmed)
	}
	for _, step := range []struct {
		amount  string
		rearmed int
	}{
		{"24999.00", 0}, // under the line: the alert
		{"25050.00", 0}, // back above it, inside the reset band
		{"25200.00", 1}, // past the band: armed again, no alert
		{"25400.00", 0}, // still armed
	} {
		amount = step.amount
		e.again(v.ID)
		if c := e.lastCheck(v.ID); len(c.Rearmed) != step.rearmed {
			t.Fatalf("%s: rearmed %+v", step.amount, c.Rearmed)
		}
	}
	if n := e.count("bot_alerts", "bot_id = ? AND kind = 'alert'", v.ID); n != 1 {
		t.Fatalf("%d alerts", n)
	}
	if n := e.count("bot_checks", "bot_id = ? AND rearmed <> '[]'::jsonb", v.ID); n != 1 {
		t.Fatalf("%d checks re-armed", n)
	}
	d, err := e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	w := v.Watches[0]
	if len(d.Rearms) != 1 {
		t.Fatalf("detail rearms %+v", d.Rearms)
	}
	r := d.Rearms[0]
	if r.WatchID != w.ID || r.RuleID != w.Rules[0].ID || r.Value != 25200 || r.Currency != "USD" || r.At.IsZero() {
		t.Fatalf("rearm %+v", r)
	}
	// The REST Detail always has the list, empty or not.
	_, body := call(t, e.s, e.user, http.MethodGet, "/bots/"+v.ID, nil)
	if rearms, ok := body["rearms"].([]any); !ok || len(rearms) != 1 {
		t.Fatalf("rest rearms %v", body["rearms"])
	}
	fresh := e.create(btcBot("Fresh"))
	_, body = call(t, e.s, e.user, http.MethodGet, "/bots/"+fresh.ID, nil)
	if rearms, ok := body["rearms"].([]any); !ok || len(rearms) != 0 {
		t.Fatalf("fresh bot rearms %v", body["rearms"])
	}
}

// A note, or Not useful, queues one feedback review of the alert (Q2); a
// plain Useful queues none, and a re-rate while one waits adds none.
func TestIntegrationBotFeedbackQueuesReview(t *testing.T) {
	e := newEngine(t)
	amount := "27499.00"
	e.coinbase(&amount)
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	must(t, e.run(v.ID))
	amount = "24999.00"
	e.again(v.ID)
	var alert Alert
	must(t, e.db.Where("bot_id = ? AND kind = 'alert'", v.ID).First(&alert).Error)
	path := "/bots/" + v.ID + "/alerts/" + alert.ID + "/feedback"
	reviews := func() int64 {
		t.Helper()
		return e.count("jobs", "kind = ? AND dedupe_key = ?", models.JobBotReview, "bot_review:"+alert.ID)
	}

	if code, body := call(t, e.s, e.user, http.MethodPost, path, map[string]any{"feedback": "useful"}); code != 200 || body["lesson"] != nil {
		t.Fatalf("useful %d %v", code, body)
	}
	if n := reviews(); n != 0 {
		t.Fatalf("a plain Useful queued %d reviews", n)
	}
	if code, _ := call(t, e.s, e.user, http.MethodPost, path, map[string]any{"feedback": "not_useful", "reason": "too_small"}); code != 200 {
		t.Fatalf("not useful %d", code)
	}
	if n := reviews(); n != 1 {
		t.Fatalf("Not useful queued %d reviews", n)
	}
	call(t, e.s, e.user, http.MethodPost, path, map[string]any{"feedback": "useful", "note": "Only big dips"})
	if n := reviews(); n != 1 {
		t.Fatalf("a re-rate while one waits queued %d reviews", n)
	}
	var job models.Job
	must(t, e.db.Where("kind = ? AND dedupe_key = ?", models.JobBotReview, "bot_review:"+alert.ID).First(&job).Error)
	if job.UserID != e.user || job.Payload.String("botId") != v.ID || job.Payload.String("alertId") != alert.ID {
		t.Fatalf("job %+v", job)
	}

	// The job runs the review on the rating as it is now: the note is the
	// focus, the Bot gets its skill slug, and the Check's run messages go.
	must(t, e.db.Model(&Check{}).Where("id = ?", *alert.CheckID).
		Update("run", &RunRecord{Messages: []json.RawMessage{json.RawMessage(`{"role":"user","content":"tick"}`)}}).Error)
	r := &fakeReviewer{}
	e.s.SetReviewer(r)
	must(t, e.s.HandleReview(context.Background(), &job))
	if len(r.reviews) != 1 {
		t.Fatalf("reviews %+v", r.reviews)
	}
	in := r.reviews[0]
	if in.BotID != v.ID || in.SkillSlug != "btc-dip" || in.Focus != "Only big dips" || in.Feedback != FeedbackUseful ||
		in.CheckID != *alert.CheckID || len(in.Messages) != 1 || in.BotName != "BTC dip" {
		t.Fatalf("review %+v", in)
	}
	// Taken back since: nothing to review.
	call(t, e.s, e.user, http.MethodPost, path, map[string]any{"feedback": nil})
	must(t, e.s.HandleReview(context.Background(), &job))
	if len(r.reviews) != 1 {
		t.Fatalf("a taken-back rating was reviewed: %+v", r.reviews)
	}
	// The Detail never shows a run's messages.
	d, err := e.s.Get(context.Background(), e.user, v.ID)
	must(t, err)
	for _, c := range d.Checks {
		if c.Run != nil && c.Run.Messages != nil {
			t.Fatalf("check %s shows its messages", c.ID)
		}
	}
}

// fakeReviewer records reviews and skill deletes.
type fakeReviewer struct {
	mu      sync.Mutex
	reviews []ReviewInput
	forgot  []string
}

func (f *fakeReviewer) Review(_ context.Context, _ string, in ReviewInput) (ReviewResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reviews = append(f.reviews, in)
	return ReviewResult{PendingIDs: []string{"p1"}}, nil
}

func (f *fakeReviewer) Forget(_ context.Context, _, slug string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.forgot = append(f.forgot, slug)
	return nil
}

// Three Not useful alerts in a row make a rules-only Bot suggest a better
// rule; Apply makes the change, Dismiss holds it off until three newer
// ratings, and an edit or a restore drops it.
func TestIntegrationBotSuggestion(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	v := e.create(btcBot("BTC moves", Rule{Kind: RuleMovePct, Percent: f64(5)}, Rule{Kind: RuleAbove, Threshold: f64(90000)}))
	w := v.Watches[0]
	day := e.now.Truncate(24 * time.Hour)
	var ids []string
	for i, pct := range []float64{-5.5, 6, 5.2} {
		a := Alert{ID: fmt.Sprintf("bal_%d", i), BotID: v.ID, UserID: e.user, Kind: alertKindAlert, LocalDay: day,
			Title: "BTC moves: down 5.5%", Figures: jsonMap[string, any]{"rule": RuleMovePct, "watchId": w.ID, "changePct": pct},
			CreatedAt: e.now.Add(time.Duration(i-3) * time.Hour)}
		must(t, e.db.Create(&a).Error)
		ids = append(ids, a.ID)
	}
	// An older alert and a held one never count.
	must(t, e.db.Create(&Alert{ID: "bal_old", BotID: v.ID, UserID: e.user, Kind: alertKindAlert, LocalDay: day, Title: "BTC moves: up 9%",
		Figures: jsonMap[string, any]{"rule": RuleMovePct, "watchId": w.ID}, CreatedAt: e.now.Add(-5 * time.Hour)}).Error)
	must(t, e.db.Create(&Alert{ID: "bal_held", BotID: v.ID, UserID: e.user, Kind: alertKindAlert, Held: heldSnoozed, LocalDay: day, Title: "BTC moves: up 9%",
		Figures: jsonMap[string, any]{"rule": RuleMovePct, "watchId": w.ID}, CreatedAt: e.now.Add(-time.Minute)}).Error)
	rate := func(alertID, reason string) {
		t.Helper()
		if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+v.ID+"/alerts/"+alertID+"/feedback",
			map[string]any{"feedback": "not_useful", "reason": reason}); code != 200 {
			t.Fatalf("rate %s: %d %v", alertID, code, body)
		}
	}
	suggestion := func() map[string]any {
		t.Helper()
		_, body := call(t, e.s, e.user, http.MethodGet, "/bots/"+v.ID, nil)
		sg, _ := body["suggestion"].(map[string]any)
		return sg
	}

	// Two in a row, with an unrated one between them, are not enough.
	rate(ids[0], "too_small")
	rate(ids[2], "too_small")
	if sg := suggestion(); sg != nil {
		t.Fatalf("suggested after two %v", sg)
	}
	rate("bal_old", "too_small")
	if sg := suggestion(); sg != nil {
		t.Fatalf("an older alert filled the row %v", sg)
	}
	// The third makes it: above the biggest move seen (6%).
	rate(ids[1], "")
	sg := suggestion()
	if sg == nil || sg["line"] != "Only tell me about moves over 8%?" || sg["button"] != "Raise to 8%" || sg["reason"] != "too_small" ||
		sg["watchId"] != w.ID || sg["ruleId"] != w.Rules[0].ID || !strings.HasPrefix(fmt.Sprint(sg["id"]), "bsg_") {
		t.Fatalf("suggestion %v", sg)
	}
	list, err := e.s.List(ctx, e.user)
	must(t, err)
	if list.Bots[0].Suggestion == nil || list.Bots[0].Suggestion.ID != sg["id"] {
		t.Fatalf("board suggestion %+v", list.Bots[0].Suggestion)
	}
	// A wrong id is out of date, and clears the suggestion.
	if code, _ := call(t, e.s, e.user, http.MethodPost, "/bots/"+v.ID+"/suggestion", map[string]any{"id": "bsg_wrong"}); code != http.StatusConflict {
		t.Fatalf("wrong id %d", code)
	}
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+v.ID+"/suggestion", map[string]any{"id": sg["id"]}); code != http.StatusConflict || body["message"] != "This suggestion is out of date" {
		t.Fatalf("apply after a wrong id %d %v", code, body)
	}
	if suggestion() != nil {
		t.Fatal("a stale suggestion was kept")
	}

	// Rating again brings it back; Dismiss holds it off until three newer.
	rate(ids[2], "too_small")
	sg = suggestion()
	if sg == nil {
		t.Fatal("no suggestion after a re-rate")
	}
	if code, _ := call(t, e.s, e.user, http.MethodDelete, "/bots/"+v.ID+"/suggestion", nil); code != http.StatusNoContent {
		t.Fatalf("dismiss %d", code)
	}
	if b := e.bot(v.ID); b.Suggestion != nil || b.SuggestionDismissedAt == nil {
		t.Fatalf("dismissed %+v", b)
	}
	for _, id := range ids {
		rate(id, "too_small")
	}
	if sg := suggestion(); sg != nil {
		t.Fatalf("back before three newer ratings %v", sg)
	}
	e.now = e.now.Add(time.Minute)
	rate(ids[0], "too_small")
	rate(ids[1], "too_small")
	if sg := suggestion(); sg != nil {
		t.Fatalf("back after two newer ratings %v", sg)
	}
	rate(ids[2], "too_small")
	sg = suggestion()
	if sg == nil {
		t.Fatal("no suggestion after three newer ratings")
	}

	// Apply changes the rule, which records a quiet baseline, and the other
	// rule stays as it was.
	code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+v.ID+"/suggestion", map[string]any{"id": sg["id"]})
	if code != 200 || body["suggestion"] != nil {
		t.Fatalf("apply %d %v", code, body)
	}
	row := watchRow(t, e.db, w.ID)
	if len(row.Rules) != 2 || row.Rules[0].ID != w.Rules[0].ID || row.Rules[0].Percent == nil || *row.Rules[0].Percent != 8 ||
		row.Rules[1].ID != w.Rules[1].ID || row.Rules[1].Kind != RuleAbove || !row.BaselinePending || row.ConfigVersion != 2 {
		t.Fatalf("applied watch %+v", row)
	}
	if b := e.bot(v.ID); b.Suggestion != nil || b.SuggestionDismissedAt == nil || !b.SuggestionDismissedAt.Equal(e.now) {
		t.Fatalf("after apply %+v", b)
	}
	if code, _ := call(t, e.s, e.user, http.MethodPost, "/bots/"+v.ID+"/suggestion", map[string]any{"id": sg["id"]}); code != http.StatusConflict {
		t.Fatalf("apply twice %d", code)
	}

	// An edit that leaves the rules, interval and judging alone keeps a
	// suggestion; one that changes the interval drops it.
	e.now = e.now.Add(time.Minute)
	for _, id := range ids {
		rate(id, "too_small")
	}
	if sg := suggestion(); sg == nil || sg["line"] != "Only tell me about moves over 10%?" {
		t.Fatalf("next suggestion %v", sg)
	}
	if code, body := call(t, e.s, e.user, http.MethodPatch, "/bots/"+v.ID, map[string]any{"name": "BTC big moves"}); code != 200 || body["suggestion"] == nil {
		t.Fatalf("rename %d %v", code, body["suggestion"])
	}
	if code, body := call(t, e.s, e.user, http.MethodPatch, "/bots/"+v.ID, map[string]any{"intervalMinutes": 30}); code != 200 || body["suggestion"] != nil {
		t.Fatalf("interval edit %d %v", code, body["suggestion"])
	}

	// A restore drops it.
	rate(ids[2], "too_small")
	if suggestion() == nil {
		t.Fatal("no suggestion before the restore")
	}
	must(t, e.s.VetRestore(e.db, e.user, false))
	if b := e.bot(v.ID); b.Suggestion != nil {
		t.Fatalf("restored suggestion %+v", b.Suggestion)
	}

	// Another account cannot apply or dismiss it.
	stranger := addUser(t, e.db)
	if code, _ := call(t, e.s, stranger, http.MethodDelete, "/bots/"+v.ID+"/suggestion", nil); code != 404 {
		t.Fatalf("stranger dismiss %d", code)
	}
	if code, _ := call(t, e.s, stranger, http.MethodPost, "/bots/"+v.ID+"/suggestion", map[string]any{"id": "bsg_x"}); code != 404 {
		t.Fatalf("stranger apply %d", code)
	}
}

// With an AI provider, a feed whose new items are not wanted suggests AI
// judging; without one it suggests nothing, and a copy of the service
// (WithDB) keeps knowing.
func TestIntegrationBotSuggestionAI(t *testing.T) {
	e := newEngine(t)
	ready := false
	e.s.SetJudge(&fakeJudge{ready: &ready})
	v := e.create(Input{Name: "News", Watches: []WatchInput{{Kind: WatchFeed, URL: "https://news.example.com/rss"}}})
	w := v.Watches[0]
	day := e.now.Truncate(24 * time.Hour)
	var ids []string
	for i := range 3 {
		a := Alert{ID: fmt.Sprintf("bal_%d", i), BotID: v.ID, UserID: e.user, Kind: alertKindAlert, LocalDay: day, Title: "News: 1 new item",
			Figures: jsonMap[string, any]{"rule": RuleNewItem, "watchId": w.ID, "items": 1}, CreatedAt: e.now.Add(time.Duration(i-3) * time.Hour)}
		must(t, e.db.Create(&a).Error)
		ids = append(ids, a.ID)
	}
	for _, id := range ids {
		if _, err := e.s.RateAlert(context.Background(), e.user, v.ID, id, Rating{Feedback: ptr(FeedbackNotUseful), Reason: "not_wanted"}); err != nil {
			t.Fatal(err)
		}
	}
	if b := e.bot(v.ID); b.Suggestion != nil {
		t.Fatalf("suggested AI without a provider %+v", b.Suggestion)
	}
	ready = true
	copied := e.s.WithDB(e.db, nil)
	if _, err := copied.RateAlert(context.Background(), e.user, v.ID, ids[2], Rating{Feedback: ptr(FeedbackNotUseful), Reason: "not_wanted"}); err != nil {
		t.Fatal(err)
	}
	if b := e.bot(v.ID); b.Suggestion == nil || b.Suggestion.JudgeMode != JudgeAI || b.Suggestion.Button != "Turn on AI judging" || b.Suggestion.Rule != nil {
		t.Fatalf("AI suggestion %+v", b.Suggestion)
	}
}

// fakeTeacher is the learning feature for a Bot page.
type fakeTeacher struct {
	mu        sync.Mutex
	taught    learning.BotTaught
	asked     []string
	discarded []string
}

func (f *fakeTeacher) BotTaught(_ context.Context, _, botID, slug string) (learning.BotTaught, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.asked = append(f.asked, botID+"/"+slug)
	return f.taught, nil
}

func (f *fakeTeacher) DiscardBot(_ context.Context, _, botID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.discarded = append(f.discarded, botID)
	return nil
}

// The Bot page's "What this bot was taught": the seed before the skill is
// made, then the skill's text and the staged changes; Delete discards them
// and deletes the skill.
func TestIntegrationBotTaught(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := testService(db)
	_, a := call(t, s, me, http.MethodPost, "/bots", pageBot("Deals"))
	id := fmt.Sprint(a["id"])
	must(t, db.Model(&Bot{}).Where("id = ?", id).Update("taught_seed", "Only big deals").Error)

	// No learning feature: the seed.
	_, d := call(t, s, me, http.MethodGet, "/bots/"+id, nil)
	if taught := d["taught"].(map[string]any); taught["text"] != "Only big deals" || len(taught["staged"].([]any)) != 0 {
		t.Fatalf("seed only %v", taught)
	}
	slug, err := EnsureSkillSlug(db, me, id)
	must(t, err)
	tt := &fakeTeacher{taught: learning.BotTaught{Found: true, Text: "Only big deals\nNot refurbished",
		Staged: []learning.Event{{ID: "lev_1", PendingID: "pend-1", BotID: id, Status: learning.StatusStaged, Kind: learning.KindSkill}}}}
	r := &fakeReviewer{}
	s.SetTeacher(tt)
	s.SetReviewer(r)
	_, d = call(t, s, me, http.MethodGet, "/bots/"+id, nil)
	taught := d["taught"].(map[string]any)
	staged := taught["staged"].([]any)
	if taught["text"] != "Only big deals\nNot refurbished" || len(staged) != 1 || staged[0].(map[string]any)["pendingId"] != "pend-1" || d["skillSlug"] != slug {
		t.Fatalf("taught %v (slug %v)", taught, d["skillSlug"])
	}
	if len(tt.asked) != 1 || tt.asked[0] != id+"/"+slug {
		t.Fatalf("asked %v", tt.asked)
	}
	// A skill not made yet: still the seed.
	tt.taught.Found, tt.taught.Text = false, ""
	if _, d = call(t, s, me, http.MethodGet, "/bots/"+id, nil); d["taught"].(map[string]any)["text"] != "Only big deals" {
		t.Fatalf("not found %v", d["taught"])
	}

	if code, _ := call(t, s, me, http.MethodDelete, "/bots/"+id, nil); code != http.StatusNoContent {
		t.Fatalf("delete %d", code)
	}
	s.Wait()
	if len(tt.discarded) != 1 || tt.discarded[0] != id || len(r.forgot) != 1 || r.forgot[0] != slug {
		t.Fatalf("discarded %v, forgot %v", tt.discarded, r.forgot)
	}
}

// A delete in a transaction that rolls back (a chat rehearsal) keeps the
// skill.
func TestIntegrationBotDeleteRolledBackKeepsSkill(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := testService(db)
	_, a := call(t, s, me, http.MethodPost, "/bots", pageBot("Kept"))
	id := fmt.Sprint(a["id"])
	slug, err := EnsureSkillSlug(db, me, id)
	must(t, err)
	r := &fakeReviewer{}
	s.SetReviewer(r)
	oldPoll, oldWait := forgetPoll, forgetWait
	forgetPoll, forgetWait = 10*time.Millisecond, 100*time.Millisecond
	t.Cleanup(func() { forgetPoll, forgetWait = oldPoll, oldWait })
	tx := db.Begin()
	must(t, s.WithDB(tx, nil).Delete(context.Background(), me, id))
	tx.Rollback()
	s.Wait()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.forgot) != 0 {
		t.Fatalf("a rolled-back delete forgot %v (slug %s)", r.forgot, slug)
	}
}
