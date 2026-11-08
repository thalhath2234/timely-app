package bots

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"
	"timely-api/internal/utils"
)

func strp(s string) *string { return &s }

func boolp(v bool) *bool { return &v }

// briefInput is a brief over sources (ids or names).
func briefInput(name string, sources ...string) Input {
	return Input{Name: name, Kind: KindBrief, Sources: &sources}
}

// runBrief moves the clock past the brief's next run and runs it.
func (e *engine) runBrief(id string) Check {
	e.t.Helper()
	b := e.bot(id)
	if b.NextCheckAt != nil && b.NextCheckAt.After(e.now) {
		e.now = b.NextCheckAt.Add(time.Second)
	}
	must(e.t, e.run(id))
	return e.lastCheck(id)
}

// note writes a typed note for a Bot at a time.
func (e *engine) note(botID, kind, title, why string, at time.Time) string {
	e.t.Helper()
	f := Finding{ID: utils.PrefixedUUID("bfd"), BotID: botID, UserID: e.user, Kind: kind, Title: title, Why: why,
		Urgency: "normal", OutsideData: true, CreatedAt: at}
	must(e.t, e.db.Create(&f).Error)
	return f.ID
}

// A brief is a Bot with no watches that sums up 1 to 8 watch Bots; the
// save refuses what a brief cannot have, and a watch Bot's brief settings.
func TestIntegrationBotBriefSave(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	prices := e.create(pageInput("Prices", "https://prices.example/"))
	quiet := e.create(pageInput("Quiet", "https://quiet.example/"))

	in := briefInput("Morning", prices.ID, "deals")
	in.Description = "What my bots found overnight"
	v := e.create(in)
	if v.Kind != KindBrief || len(v.Watches) != 0 || v.BriefTime != DefaultBriefTime || v.BriefAI || v.IntervalMinutes != 24*60 ||
		v.JudgeMode != JudgeRules || !slices.Equal(v.Sources, []string{prices.ID, deals.ID}) {
		t.Fatalf("brief %+v", v)
	}
	b := e.bot(v.ID)
	next := time.Date(2026, 11, 7, 8, 0, 0, 0, time.UTC) // botNow is 6 Nov 09:30 UTC
	if b.NextCheckAt == nil || b.NextCheckAt.Before(next) || b.NextCheckAt.After(next.Add(briefSpread)) || b.BriefCursorAt == nil || !b.BriefCursorAt.Equal(e.now) {
		t.Fatalf("brief schedule next %v, cursor %v", b.NextCheckAt, b.BriefCursorAt)
	}
	d, err := e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	if !slices.Equal(d.Sources, []string{prices.ID, deals.ID}) || len(d.Links) != 2 || d.Links[0].Kind != LinkBrief || d.Links[0].FromBotID != prices.ID {
		t.Fatalf("detail sources %v, links %+v", d.Sources, d.Links)
	}
	list, err := e.s.List(ctx, e.user)
	must(t, err)
	for _, got := range list.Bots {
		switch {
		case got.ID == v.ID && (got.Kind != KindBrief || !slices.Equal(got.Sources, []string{prices.ID, deals.ID})):
			t.Fatalf("board brief %+v", got)
		case got.ID != v.ID && (got.Kind != KindWatch || got.Sources == nil || len(got.Sources) != 0):
			t.Fatalf("board watch bot %+v", got)
		}
	}

	refused := func(want string, in Input, o Origin) {
		t.Helper()
		_, err := e.s.Create(ctx, e.user, in, o)
		var bad *InputError
		if !errors.As(err, &bad) || !strings.Contains(bad.Message, want) {
			t.Fatalf("want %q, got %v", want, err)
		}
	}
	withWatch := briefInput("W", deals.ID)
	withWatch.Watches = []WatchInput{{Kind: WatchPage, URL: "https://x.example/"}}
	refused("has no watches", withWatch, OriginApp)
	refused("Pick 1 to 8 bots", briefInput("Nine", "1", "2", "3", "4", "5", "6", "7", "8", "9"), OriginApp)
	refused("Pick 1 to 8 bots", briefInput("None"), OriginApp)
	refused("sums up bots that watch something", briefInput("Of a brief", v.ID), OriginApp)
	refused("in the list twice", briefInput("Twice", deals.ID, "Deals"), OriginApp)
	refused("no bot called", briefInput("Ghost", "Nobody"), OriginApp)
	ai := briefInput("AI", deals.ID)
	ai.JudgeMode = JudgeAI
	refused("Write it with AI instead", ai, OriginApp)
	late := briefInput("Late", deals.ID)
	late.BriefTime = strp("8pm")
	refused("a time like 08:00", late, OriginApp)
	passing := briefInput("Passing", deals.ID)
	passing.PassesTo = &[]LinkInput{{BotID: quiet.ID}}
	refused("cannot pass items on", passing, OriginApp)
	watch := pageInput("Watch with sources", "https://w.example/")
	watch.Sources = &[]string{deals.ID}
	refused("Only a brief bot", watch, OriginApp)
	watch = pageInput("Watch with a time", "https://w.example/")
	watch.BriefTime = strp("07:00")
	refused("Only a brief bot", watch, OriginApp)
	watch = pageInput("New and brief only", "https://w.example/")
	watch.BriefOnly = boolp(true)
	refused("Add this bot to a brief first", watch, OriginApp)
	// An outside app sets up no brief, nor a watch Bot's brief settings.
	refused("set up in Timely", briefInput("From MCP", deals.ID), OriginMCP)
	mcpWatch := pageInput("MCP brief only", "https://w.example/")
	mcpWatch.BriefOnly = boolp(false)
	refused("set up in Timely", mcpWatch, OriginMCP)
	if _, err := e.s.Update(ctx, e.user, deals.ID, Patch{BriefOnly: boolp(true)}, OriginMCP); !errors.Is(err, errMCPSetup) {
		t.Fatalf("MCP brief only: %v", err)
	}
	if _, err := e.s.Update(ctx, e.user, v.ID, Patch{Sources: &[]string{deals.ID}}, OriginMCP); !errors.Is(err, errMCPSetup) {
		t.Fatalf("MCP sources: %v", err)
	}
	// Nothing can pass items to a brief.
	if _, err := e.s.Update(ctx, e.user, quiet.ID, Patch{PassesTo: &[]LinkInput{{BotID: v.ID}}}, OriginApp); err == nil || !strings.Contains(err.Error(), "watches something") {
		t.Fatalf("pass to a brief: %v", err)
	}
	if _, err := e.s.Update(ctx, e.user, v.ID, Patch{Kind: strp(KindWatch)}, OriginApp); err == nil || !strings.Contains(err.Error(), "kind cannot change") {
		t.Fatalf("kind change: %v", err)
	}
	if _, err := e.s.Update(ctx, e.user, v.ID, Patch{Watches: &[]WatchInput{{Kind: WatchPage, URL: "https://x.example/"}}}, OriginApp); !errors.Is(err, errBriefWatches) {
		t.Fatalf("watches on a brief: %v", err)
	}
	if _, err := e.s.Update(ctx, e.user, quiet.ID, Patch{BriefOnly: boolp(true)}, OriginApp); !errors.Is(err, errNotInBrief) {
		t.Fatalf("brief only out of a brief: %v", err)
	}

	// Only in the brief, then out of the brief: the switch goes off.
	if got, err := e.s.Update(ctx, e.user, deals.ID, Patch{BriefOnly: boolp(true)}, OriginApp); err != nil || !got.BriefOnly {
		t.Fatalf("brief only: %+v, %v", got, err)
	}
	got, err := e.s.Update(ctx, e.user, v.ID, Patch{Sources: &[]string{prices.ID, quiet.ID}, BriefTime: strp("18:30"), BriefAI: boolp(true)}, OriginApp)
	must(t, err)
	if !slices.Equal(got.Sources, []string{prices.ID, quiet.ID}) || got.BriefTime != "18:30" || !got.BriefAI || e.bot(deals.ID).BriefOnly {
		t.Fatalf("edited brief %+v; deals brief only %v", got, e.bot(deals.ID).BriefOnly)
	}
	if at := e.bot(v.ID).NextCheckAt; at == nil || at.Before(time.Date(2026, 11, 6, 18, 30, 0, 0, time.UTC)) || at.After(time.Date(2026, 11, 6, 18, 32, 0, 0, time.UTC)) {
		t.Fatalf("a new time moves the next run: %v", at)
	}
	// An outside app cannot rename what an AI brief's writer reads.
	if _, err := e.s.Update(ctx, e.user, v.ID, Patch{Description: strp("Anything")}, OriginMCP); !errors.Is(err, errMCPJudged) {
		t.Fatalf("MCP description of an AI brief: %v", err)
	}
	// Pause and resume: back at its time, not now.
	_, err = e.s.Pause(ctx, e.user, v.ID, PausePerson)
	must(t, err)
	_, err = e.s.Resume(ctx, e.user, v.ID, OriginApp)
	must(t, err)
	if at := e.bot(v.ID).NextCheckAt; at == nil || at.Before(time.Date(2026, 11, 6, 18, 30, 0, 0, time.UTC)) {
		t.Fatalf("a resumed brief is due %v", at)
	}
	// Deleting a brief frees its sources.
	_, err = e.s.Update(ctx, e.user, quiet.ID, Patch{BriefOnly: boolp(true)}, OriginApp)
	must(t, err)
	must(t, e.s.Delete(ctx, e.user, v.ID))
	if e.bot(quiet.ID).BriefOnly || e.count("bot_links", "user_id = ?", e.user) != 0 {
		t.Fatal("a deleted brief left a link or a source on Only in the brief")
	}
}

// A brief runs at its time and sends one alert: its sources' new notes,
// newest 5 a Bot plus "and N more", in source order. Nothing new sends
// nothing; notes passed on that reached no Bot come with the next one; the
// digest keeps listing the notes; rating a brief teaches it.
func TestIntegrationBotBriefRuns(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	prices := e.create(pageInput("Prices", "https://prices.example/"))
	v := e.create(briefInput("Morning", deals.ID, prices.ID))
	start := e.now

	e.note(deals.ID, "item", "Before the brief", "", start.Add(-time.Minute))
	for i := range 7 {
		e.note(deals.ID, "item", fmt.Sprintf("Deal %d", i), "New in deals.example", start.Add(time.Duration(i+1)*time.Minute))
	}
	e.note(prices.ID, "price", "below $10", "Now $9 (was $12)", start.Add(time.Hour))
	c := e.runBrief(v.ID)
	if c.Outcome != outFired || c.AlertID == nil || c.Trigger != TriggerSchedule {
		t.Fatalf("brief check %+v", c)
	}
	a := e.alertRow(c.ID)
	if a.Kind != alertKindBrief || a.Title != "Morning: 8 new from 2 bots" || a.AIState != "" || a.NotificationID == nil {
		t.Fatalf("brief alert %+v", a)
	}
	wantLines := []string{"Deals: Deal 6", "Deals: Deal 5", "Deals: Deal 4", "Deals: Deal 3", "Deals: Deal 2", "Prices: below $10 · Now $9 (was $12)", "and 2 more"}
	av := alertView(a)
	if !slices.Equal(av.Lines, wantLines) || av.Figures["items"] != float64(8) {
		t.Fatalf("brief lines %q, figures %v", av.Lines, av.Figures)
	}
	if want := strings.Join(wantLines, "\n"); a.Body != want {
		t.Fatalf("brief body %q", a.Body)
	}
	ntf := e.notifications()
	if len(ntf) != 1 || ntf[0].Title != a.Title || ntf[0].Data.String("botAlert") != alertKindBrief || *ntf[0].DedupeKey != "bot:"+v.ID+":brief:"+c.ID {
		t.Fatalf("notification %+v", ntf)
	}
	b := e.bot(v.ID)
	if !b.BriefCursorAt.Equal(c.StartedAt.Add(-briefLag)) || b.NextCheckAt == nil || b.NextCheckAt.Before(time.Date(2026, 11, 8, 8, 0, 0, 0, time.UTC)) {
		t.Fatalf("after a brief: cursor %v, next %v", b.BriefCursorAt, b.NextCheckAt)
	}
	// The board shows the brief's count; its sources' digest still lists the notes.
	got, err := e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	if got.LatestAlert == nil || got.LatestAlert.Items == nil || *got.LatestAlert.Items != 8 || got.LatestAlert.Kind != alertKindBrief {
		t.Fatalf("latest alert %+v", got.LatestAlert)
	}
	lines, _, err := e.s.DigestLines(ctx, e.user, e.now)
	must(t, err)
	if !slices.Contains(lines, "Prices: below $10") {
		t.Fatalf("digest %q", lines)
	}

	// Rating a brief writes a lesson in the template's words.
	res, err := e.s.RateAlert(ctx, e.user, v.ID, a.ID, Rating{Feedback: strp(FeedbackUseful)})
	must(t, err)
	if res.Lesson == nil || res.Lesson.Text != "Wanted: “8 new from 2 bots”" || !slices.Equal(res.Lines, wantLines) {
		t.Fatalf("brief lesson %+v", res.Lesson)
	}

	// Nothing new: no alert, the cursor still moves.
	c = e.runBrief(v.ID)
	if c.Outcome != outUnchanged || c.AlertID != nil || e.count("bot_alerts", "bot_id = ?", v.ID) != 1 {
		t.Fatalf("an empty brief %+v", c)
	}
	// A note passed on that reached no Bot comes with the next brief, even
	// though it was made before the cursor, and in the digest again.
	old := e.note(deals.ID, "item", "Folded deal", "", start.Add(-2*time.Hour))
	e.note(deals.ID, "item", "Not folded", "", start.Add(-2*time.Hour))
	must(t, e.db.Exec(`INSERT INTO bot_passes (id, user_id, link_id, from_bot_id, to_bot_id, finding_id, chain_id, depth, local_day, state, created_at, updated_at)
		VALUES ('bps_folded', ?, NULL, ?, ?, ?, 'bchk_x', 1, CURRENT_DATE, 'folded', ?, ?)`, e.user, deals.ID, prices.ID, old, e.now, e.now.Add(time.Minute)).Error)
	e.now = e.now.Add(2 * time.Minute)
	must(t, e.db.Exec(`UPDATE bot_findings SET digested_at = NULL WHERE id = ?`, old).Error)
	lines, _, err = e.s.DigestLines(ctx, e.user, e.now)
	must(t, err)
	if !slices.Contains(lines, "Deals: Folded deal") || slices.Contains(lines, "Deals: Not folded") {
		t.Fatalf("digest with a folded pass %q", lines)
	}
	c = e.runBrief(v.ID)
	if c.Outcome != outFired || !slices.Equal(alertView(e.alertRow(c.ID)).Lines, []string{"Deals: Folded deal"}) {
		t.Fatalf("folded pass in the brief: %+v", c)
	}

	// A note a link handed to another Bot (queued, told of, held quiet or
	// already taken) is that Bot's to tell: neither the brief nor the
	// digest lists it again.
	for i, state := range []string{passPending, passAlerted, passQuiet, passRepeat} {
		id := e.note(deals.ID, "item", "Passed deal "+state, "", e.now.Add(time.Duration(i+1)*time.Second))
		must(t, e.db.Exec(`INSERT INTO bot_passes (id, user_id, link_id, from_bot_id, to_bot_id, finding_id, chain_id, depth, local_day, state, created_at, updated_at)
			VALUES (?, ?, NULL, ?, ?, ?, 'bchk_y', 1, CURRENT_DATE, ?, ?, ?)`, "bps_"+state, e.user, deals.ID, prices.ID, id, state, e.now, e.now).Error)
	}
	e.note(deals.ID, "item", "Kept deal", "", e.now.Add(5*time.Second))
	e.now = e.now.Add(time.Minute)
	lines, _, err = e.s.DigestLines(ctx, e.user, e.now)
	must(t, err)
	for _, l := range lines {
		if strings.Contains(l, "Passed deal") {
			t.Fatalf("digest lists a passed note: %q", lines)
		}
	}
	c = e.runBrief(v.ID)
	if c.Outcome != outFired || !slices.Equal(alertView(e.alertRow(c.ID)).Lines, []string{"Deals: Kept deal"}) {
		t.Fatalf("passed notes in the brief: %q", alertView(e.alertRow(c.ID)).Lines)
	}

	// Run now works on a brief, and a tag reads the next brief's notes
	// without a check.
	e.note(prices.ID, "price", "below $9", "Now $8", e.now.Add(time.Minute))
	e.now = e.now.Add(10 * time.Minute)
	ans, err := e.s.Ask(ctx, e.user, v.ID)
	must(t, err)
	if ans.Fresh != FreshRecent || len(ans.Findings) != 1 || ans.Findings[0].Title != "below $9" || e.waitingChecks(v.ID) != 0 {
		t.Fatalf("ask a brief %+v", ans)
	}
	run, err := e.s.RunNow(ctx, e.user, v.ID, OriginApp)
	must(t, err)
	must(t, e.s.HandleCheck(ctx, e.job(v.ID, TriggerRunNow)))
	if c := e.lastCheck(v.ID); c.Trigger != TriggerRunNow || c.Outcome != outFired || run.JobID == "" {
		t.Fatalf("run now on a brief %+v", c)
	}
}

// Write it with AI: one call a run, counted against the brief; the alert
// takes the AI's title and body and keeps the template's words for the
// lesson. Any failure sends the template, unchecked, and nothing asks again.
func TestIntegrationBotBriefAI(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{brief: BriefText{Title: "Morning: Two deals worth a look", Body: "Deal 0 is the best\n\nDeal 1 is fine"}}
	e.s.SetJudge(fj)
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	in := briefInput("Morning", deals.ID)
	in.BriefAI = boolp(true)
	in.Description = "Only the best deals"
	v := e.create(in)
	e.note(deals.ID, "item", "Deal 0", "", e.now.Add(time.Minute))
	e.note(deals.ID, "item", "Deal 1", "", e.now.Add(2*time.Minute))
	c := e.runBrief(v.ID)
	a := e.alertRow(c.ID)
	if a.Title != "Morning: Two deals worth a look" || a.Body != "Deal 0 is the best\nDeal 1 is fine" || a.AIState != aiJudged ||
		a.Figures["what"] != "2 new from 1 bot" || len(alertView(a).Lines) != 2 {
		t.Fatalf("AI brief %+v", a)
	}
	if len(fj.briefs) != 1 || fj.briefs[0].Brief != "Morning" || fj.briefs[0].Description != "Only the best deals" ||
		len(fj.briefs[0].Groups) != 1 || !slices.Equal(fj.briefs[0].Groups[0].Lines, []string{"Deal 1", "Deal 0"}) {
		t.Fatalf("AI brief input %+v", fj.briefs)
	}
	if e.count("bot_ai_calls", "bot_id = ? AND purpose = ? AND chain_id = '' AND ok", v.ID, purposeBrief) != 1 {
		t.Fatal("the AI brief was not counted")
	}

	// The writer fails: the template goes out, unchecked, with no re-ask.
	fj.briefErr = errors.New("provider down")
	e.note(deals.ID, "item", "Deal 2", "", e.now.Add(time.Minute))
	c = e.runBrief(v.ID)
	a = e.alertRow(c.ID)
	if a.Title != "Morning: 1 new from 1 bot" || a.Body != "Deals: Deal 2" || a.AIState != aiUnchecked || a.AIWhy != noteBriefLater || a.AIInput != nil {
		t.Fatalf("fallback brief %+v", a)
	}
	if e.count("jobs", "kind = 'bot_judge'") != 0 {
		t.Fatal("a brief queued a re-judge")
	}
	// No AI at all: the template, saying why.
	e.s.SetJudge(nil)
	e.note(deals.ID, "item", "Deal 3", "", e.now.Add(time.Minute))
	c = e.runBrief(v.ID)
	if a := e.alertRow(c.ID); a.AIState != aiUnchecked || a.AIWhy != noteNoProvider || a.Body != "Deals: Deal 3" {
		t.Fatalf("brief with no AI %+v", a)
	}
}

// Only in the brief: a source's check alerts nothing itself while it is in
// a brief that is on (its notes wait for the brief), and alerts as usual
// once the brief is paused or it leaves the brief.
func TestIntegrationBotBriefOnly(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	amount := "100.00"
	e.coinbase(&amount)
	src := e.create(btcBot("BTC", Rule{Kind: RuleMovePct, Percent: f64(1), Direction: DirAny}))
	must(t, e.run(src.ID)) // baseline
	other := e.create(pageInput("Other", "https://other.example/"))
	brief := e.create(briefInput("Morning", src.ID, other.ID))
	_, err := e.s.Update(ctx, e.user, src.ID, Patch{BriefOnly: boolp(true)}, OriginApp)
	must(t, err)

	amount = "103.00"
	e.again(src.ID)
	c := e.lastCheck(src.ID)
	if c.Outcome != outPassed || c.AlertID != nil || len(c.Fired) != 1 || e.count("bot_alerts", "bot_id = ?", src.ID) != 0 {
		t.Fatalf("a brief-only check %+v", c)
	}
	if e.count("bot_findings", "bot_id = ? AND NOT alerted", src.ID) != 1 {
		t.Fatal("the note was not kept for the brief")
	}
	if c := e.runBrief(brief.ID); c.Outcome != outFired {
		t.Fatalf("the brief did not list it: %+v", c)
	}

	// The brief paused: the source speaks for itself.
	_, err = e.s.Pause(ctx, e.user, brief.ID, PausePerson)
	must(t, err)
	amount = "106.00"
	e.again(src.ID)
	if c := e.lastCheck(src.ID); c.Outcome != outFired || c.AlertID == nil {
		t.Fatalf("a source of a paused brief %+v", c)
	}

	// Resumed, the brief lists nothing from its pause: the source spoke
	// for itself then.
	_, err = e.s.Resume(ctx, e.user, brief.ID, OriginApp)
	must(t, err)
	if b := e.bot(brief.ID); b.BriefCursorAt == nil || !b.BriefCursorAt.Equal(e.now) {
		t.Fatalf("a resumed brief's cursor %v", b.BriefCursorAt)
	}
	if c := e.runBrief(brief.ID); c.Outcome != outUnchanged {
		t.Fatalf("a resumed brief listed notes from its pause: %+v", c)
	}

	// Out of the brief: the switch goes off.
	_, err = e.s.Update(ctx, e.user, brief.ID, Patch{Sources: &[]string{other.ID}}, OriginApp)
	must(t, err)
	if e.bot(src.ID).BriefOnly {
		t.Fatal("brief only stayed on out of the brief")
	}
	amount = "110.00"
	e.again(src.ID)
	if c := e.lastCheck(src.ID); c.Outcome != outFired || c.AlertID == nil {
		t.Fatalf("a source out of the brief %+v", c)
	}
}

// A restored brief keeps its sources and is not paused for having no
// watches; its first run after the restore lists nothing the file brought
// back. Over MCP it comes back written from its template, and a brief with
// no Bots left to sum up is paused.
func TestIntegrationBotBriefRestore(t *testing.T) {
	e := newEngine(t)
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	in := briefInput("Morning", deals.ID)
	in.BriefAI = boolp(true)
	v := e.create(in)
	lonely := e.create(briefInput("Lonely", deals.ID))
	must(t, e.db.Exec(`DELETE FROM bot_links WHERE to_bot_id = ?`, lonely.ID).Error)
	e.note(deals.ID, "item", "From the file", "", e.now.Add(time.Minute))

	e.now = e.now.Add(time.Hour)
	must(t, e.s.VetRestore(e.db, e.user, false))
	e.s.AfterRestore(e.user)
	b := e.bot(v.ID)
	if b.Status != StatusActive || !b.BriefAI || !b.BriefCursorAt.Equal(e.now) || b.NextCheckAt == nil || b.NextCheckAt.Before(time.Date(2026, 11, 7, 8, 0, 0, 0, time.UTC)) {
		t.Fatalf("restored brief %+v", b)
	}
	if l := e.bot(lonely.ID); l.Status != StatusPaused || !strings.Contains(l.HealthDetail, "no bots to sum up") {
		t.Fatalf("a brief with no sources %+v", l)
	}
	if c := e.runBrief(v.ID); c.Outcome != outUnchanged {
		t.Fatalf("the first brief after a restore listed old notes: %+v", c)
	}

	must(t, e.s.VetRestore(e.db, e.user, true))
	if b := e.bot(v.ID); b.BriefAI || b.Status != StatusPaused || e.count("bot_links", "user_id = ?", e.user) != 0 {
		t.Fatalf("MCP restore left %+v", b)
	}
}

// A note passed to a Bot that is "Only in the brief" waits for the brief:
// no judge call and no alert of B's own, and B's note is in the next brief.
func TestIntegrationBotBriefOnlyPass(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	fj.set(Verdict{Alert: true, Title: "Buy now", Why: "Low", Urgency: UrgencyHigh}, nil)
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
	brief := e.create(briefInput("Morning", b.ID))
	_, err := e.s.Update(ctx, e.user, b.ID, Patch{BriefOnly: boolp(true)}, OriginApp)
	must(t, err)

	amount = "51000"
	e.again(a.ID)
	ran := e.passJobs()
	if len(ran) != 1 {
		t.Fatalf("passes run %v", ran)
	}
	c := e.passCheck(ran[0])
	if c.Outcome != outPassed || c.AlertID != nil || len(c.Fired) != 1 || len(fj.calls()) != 0 ||
		e.count("bot_alerts", "bot_id = ?", b.ID) != 0 || len(e.notifications()) != 0 {
		t.Fatalf("a brief-only pass check %+v, judge calls %d", c, len(fj.calls()))
	}
	if p := e.pass(ran[0]); p.State != passQuiet {
		t.Fatalf("pass %s", p.State)
	}
	var note Finding
	must(t, e.db.Where("check_id = ?", c.ID).First(&note).Error)
	if note.Alerted {
		t.Fatalf("B's note %+v", note)
	}
	bc := e.runBrief(brief.ID)
	if bc.Outcome != outFired || !slices.Equal(alertView(e.alertRow(bc.ID)).Lines, []string{"BTC check: " + noteWords(note)}) {
		t.Fatalf("the brief did not list B's note: %+v", bc)
	}
}

// A brief whose last source Bot is deleted is paused, and cannot be turned
// on without bots to sum up; a brief link cannot be turned off by itself;
// a note made just before a brief starts comes with the next one.
func TestIntegrationBotBriefSourcesGone(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	v := e.create(briefInput("Morning", deals.ID))

	d, err := e.s.Get(ctx, e.user, v.ID)
	must(t, err)
	if _, err := e.s.SetLink(ctx, e.user, d.Links[0].ID, false); !errors.Is(err, errBriefLinkOff) {
		t.Fatalf("turning off a brief link: %v", err)
	}

	// A note made inside briefLag of the brief's start waits a run.
	b := e.bot(v.ID)
	e.now = b.NextCheckAt.Add(time.Second)
	e.note(deals.ID, "item", "Just in", "", e.now.Add(-briefLag/2))
	if c := e.runBrief(v.ID); c.Outcome != outUnchanged {
		t.Fatalf("a note inside the lag was listed early: %+v", c)
	}
	if c := e.runBrief(v.ID); c.Outcome != outFired || !slices.Equal(alertView(e.alertRow(c.ID)).Lines, []string{"Deals: Just in"}) {
		t.Fatalf("the note inside the lag was lost: %+v", c)
	}

	must(t, e.s.Delete(ctx, e.user, deals.ID))
	if b := e.bot(v.ID); b.Status != StatusPaused || b.NextCheckAt != nil || b.HealthDetail != briefNoSources {
		t.Fatalf("a brief with no sources left %+v", b)
	}
	if _, err := e.s.Resume(ctx, e.user, v.ID, OriginApp); !errors.Is(err, errBriefSources) {
		t.Fatalf("resuming a brief with no sources: %v", err)
	}
}
