package bots

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// bareAgent saves an agent Bot with no Reads (it runs on its schedule, every
// every minutes, whether or not anything changed).
func (e *engine) bareAgent(name string, every int, tools AgentTools) Bot {
	e.t.Helper()
	at := e.now
	b := Bot{
		ID: "bot_" + uuid.NewString(), UserID: e.user, Name: name, Origin: OriginApp, Status: StatusActive, JudgeMode: JudgeRules,
		IntervalSeconds: every * 60, NextCheckAt: &at, Kind: KindWatch, Health: "new", Engine: EngineAgent, Prompt: "Find news about " + name,
		Gate: GateAlways, Permission: PermissionAuto, Schedule: jsonMap[string, any]{"everyMinutes": every}, NotifyDesktop: true, NotifyPhone: true,
		Skills: jsonList[string]{}, Egress: jsonList[string]{}, Tools: tools,
	}
	must(e.t, e.db.Create(&b).Error)
	return b
}

func (e *engine) checksOf(botID string) []Check {
	e.t.Helper()
	var rows []Check
	must(e.t, e.db.Where("bot_id = ?", botID).Order("started_at, created_at").Find(&rows).Error)
	return rows
}

func reportOf(title string) AgentResult {
	return AgentResult{Response: title, Reports: []Report{{Title: title, Body: "Details of " + title, URL: "https://example.com/" + title}}}
}

// An unreachable model re-runs the tick after 5, 15, then 30 minutes with no
// strike; a rate limit holds the next check, also with no strike; a timeout,
// a crash or a [CRON_FAILURE] answer is a strike, and the fifth pauses the Bot
// with one alert.
func TestIntegrationAgentFailureLadder(t *testing.T) {
	e := newEngine(t)
	class := ClassUnreachable
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return AgentResult{ErrorClass: class}, nil })
	e.s.SetAgent(agent)
	b := e.bareAgent("Ladder", 15, AgentTools{})

	for i, want := range []time.Duration{5 * time.Minute, 15 * time.Minute, 30 * time.Minute, 30 * time.Minute} {
		must(t, e.run(b.ID))
		got, c := e.bot(b.ID), e.lastCheck(b.ID)
		if c.Outcome != outOffline || c.ErrorKind != ClassUnreachable || got.Strikes != 0 || got.Status != StatusActive || got.NextCheckAt == nil || !got.NextCheckAt.Equal(e.now.Add(want)) {
			t.Fatalf("unreachable %d: %+v, next %v want %v", i+1, c, got.NextCheckAt, e.now.Add(want))
		}
		if got.Health != "offline" || c.Run == nil || c.Run.ErrorClass != ClassUnreachable {
			t.Fatalf("unreachable %d health %q run %+v", i+1, got.Health, c.Run)
		}
		e.due(b.ID)
	}
	// The worker not running is the same: no result at all.
	agent.script = func(RunInput) (AgentResult, error) { return AgentResult{}, errors.New("worker is down") }
	must(t, e.run(b.ID))
	if c := e.lastCheck(b.ID); c.Outcome != outOffline || c.ErrorKind != ClassUnreachable || e.bot(b.ID).Strikes != 0 {
		t.Fatalf("worker down: %+v", c)
	}
	e.due(b.ID)

	// A rate limit holds the next check, with no strike.
	class = ClassRateLimited
	agent.script = func(RunInput) (AgentResult, error) { return AgentResult{ErrorClass: class}, nil }
	must(t, e.run(b.ID))
	got, c := e.bot(b.ID), e.lastCheck(b.ID)
	if c.Outcome != outRateLimited || got.Strikes != 0 || got.NextCheckAt == nil || got.NextCheckAt.Before(e.now.Add(rateHold)) || got.Health != "rate_limited" {
		t.Fatalf("rate limited: %+v, bot %+v", c, got)
	}
	e.due(b.ID)

	// Timeouts are strikes; the fifth pauses the Bot with one alert.
	class = ClassTimeout
	for i := 1; i <= MaxStrikes; i++ {
		must(t, e.run(b.ID))
		got, c := e.bot(b.ID), e.lastCheck(b.ID)
		if c.Outcome != outFailed || c.ErrorKind != ClassTimeout || got.Strikes != i {
			t.Fatalf("strike %d: %+v, bot strikes %d", i, c, got.Strikes)
		}
		if i < MaxStrikes {
			if got.Status != StatusActive || got.NextCheckAt == nil {
				t.Fatalf("strike %d paused the Bot early: %+v", i, got)
			}
			e.due(b.ID)
		}
	}
	got = e.bot(b.ID)
	if got.Status != StatusPaused || got.PauseReason == nil || *got.PauseReason != PauseStrikes || got.NextCheckAt != nil {
		t.Fatalf("after five strikes: %+v", got)
	}
	if n := e.count("bot_alerts", "bot_id = ? AND kind = 'paused'", b.ID); n != 1 || len(e.notifications()) != 1 {
		t.Fatalf("%d paused alerts, %d notifications", n, len(e.notifications()))
	}
	for _, c := range e.checksOf(b.ID) {
		if c.Outcome == outFailed && c.Error == "" && c.Run == nil {
			t.Fatalf("a failed check kept nothing: %+v", c)
		}
	}
}

// Every failing class is a strike, whichever way the run reports it.
func TestIntegrationAgentFailureClassesStrike(t *testing.T) {
	e := newEngine(t)
	cases := map[string]AgentResult{
		ClassTimeout:     {ErrorClass: ClassTimeout},
		ClassCrash:       {ErrorClass: ClassCrash},
		ClassCronFailure: {Response: "[CRON_FAILURE] could not open the page\nmore"},
	}
	for class, res := range cases {
		agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return res, nil })
		e.s.SetAgent(agent)
		b := e.bareAgent("Fails "+class, 15, AgentTools{})
		must(t, e.run(b.ID))
		got, c := e.bot(b.ID), e.lastCheck(b.ID)
		if c.Outcome != outFailed || c.ErrorKind != class || got.Strikes != 1 || got.Health != class || e.count("bot_alerts", "bot_id = ?", b.ID) != 0 {
			t.Fatalf("%s: %+v, bot %+v", class, c, got)
		}
	}
}

// With no AI provider, or during an outage that says so, the Bot records what
// it reads and sends no alert: there is no rules fallback (Q-B3).
func TestIntegrationAgentNoAIRecordsReadings(t *testing.T) {
	e := newEngine(t)
	amount := "27499.00"
	e.coinbase(&amount)
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	_, err := e.s.Convert(context.Background(), e.user, v.ID)
	must(t, err)

	// No agent wired at all.
	must(t, e.run(v.ID))
	c := e.lastCheck(v.ID)
	w := watchRow(t, e.db, v.Watches[0].ID)
	if c.Outcome != outNoAI || c.SkipReason != SkipNoAI || c.Run != nil || w.LastReading == nil || *w.LastReading.Price != 27499 {
		t.Fatalf("no agent: %+v, reading %+v", c, w.LastReading)
	}
	if b := e.bot(v.ID); b.Health != healthNeedsAI || b.Strikes != 0 {
		t.Fatalf("bot %+v", b)
	}

	// An Agent that says there is no provider.
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return AgentResult{}, ErrNoAI })
	e.s.SetAgent(agent)
	amount = "24000.00" // below the rule that would have fired
	e.again(v.ID)
	c = e.lastCheck(v.ID)
	w = watchRow(t, e.db, v.Watches[0].ID)
	if c.Outcome != outNoAI || c.SkipReason != SkipNoAI || *w.LastReading.Price != 24000 || len(e.notifications()) != 0 || e.count("bot_alerts", "bot_id = ?", v.ID) != 0 {
		t.Fatalf("no provider: %+v", c)
	}
	if e.count("bot_ai_calls", "bot_id = ?", v.ID) != 0 {
		t.Fatal("a tick that never asked the model took a slot of the log")
	}
}

// A Check that needs the browser while a chat holds it is skipped and
// recorded as browser busy, without asking the agent; if a chat takes it
// during the tick, the agent says so and the Check is recorded the same way.
// Either way the next check is scheduled as usual and there is no strike.
func TestIntegrationAgentBrowserBusy(t *testing.T) {
	e := newEngine(t)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return quiet() })
	e.s.SetAgent(agent)
	b := e.bareAgent("Signed in", 15, AgentTools{BrowserSites: []string{"flipkart.com"}})

	agent.busy = true
	must(t, e.run(b.ID))
	c, got := e.lastCheck(b.ID), e.bot(b.ID)
	if c.Outcome != outSkipped || c.SkipReason != SkipBrowserBusy || c.Run != nil || agent.asked != 0 {
		t.Fatalf("held by a chat: %+v, %d asks", c, agent.asked)
	}
	if got.Strikes != 0 || got.Health != healthWorking || got.NextCheckAt == nil || got.NextCheckAt.Before(e.now.Add(14*time.Minute)) || got.NextCheckAt.After(e.now.Add(18*time.Minute)) {
		t.Fatalf("bot %+v", got)
	}

	agent.busy = false
	agent.script = func(RunInput) (AgentResult, error) { return AgentResult{ErrorClass: ClassBrowserBusy}, nil }
	e.again(b.ID)
	c, got = e.lastCheck(b.ID), e.bot(b.ID)
	if c.Outcome != outSkipped || c.SkipReason != SkipBrowserBusy || c.Run == nil || c.Run.ErrorClass != ClassBrowserBusy || agent.asked != 1 {
		t.Fatalf("taken mid-tick: %+v", c)
	}
	if got.Strikes != 0 || got.NextCheckAt == nil || got.NextCheckAt.After(e.now.Add(18*time.Minute)) {
		t.Fatalf("bot %+v", got)
	}
	// The run was handed the Bot's reach.
	agent.script = func(in RunInput) (AgentResult, error) {
		if len(in.Tools.BrowserSites) != 1 || in.Tools.BrowserSites[0] != "flipkart.com" {
			return AgentResult{ErrorClass: ClassCrash}, nil
		}
		return quiet()
	}
	e.again(b.ID)
	if c := e.lastCheck(b.ID); c.Outcome != outSilent {
		t.Fatalf("after the chat let go: %+v", c)
	}
}

// A report with a proposal keeps it on the alert as a pending Review card;
// nothing is applied (Q-B5).
func TestIntegrationAgentProposalStaysPending(t *testing.T) {
	e := newEngine(t)
	proposal := json.RawMessage(`{"tool":"create_task","args":{"title":"Buy the Pixel"}}`)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) {
		return AgentResult{Reports: []Report{{Title: "Pixel in stock", Body: "At ₹89,999", Proposal: proposal}}}, nil
	})
	e.s.SetAgent(agent)
	b := e.bareAgent("Pixel", 15, AgentTools{})
	must(t, e.run(b.ID))
	var a Alert
	must(t, e.db.Where("bot_id = ?", b.ID).First(&a).Error)
	var got, want map[string]any
	must(t, json.Unmarshal(a.Proposal, &got))
	must(t, json.Unmarshal(proposal, &want))
	if a.ProposalState != ProposalPending || got["tool"] != want["tool"] || a.Held != "" {
		t.Fatalf("alert %+v", a)
	}
	if n := e.count("tasks", "user_id = ?", e.user); n != 0 {
		t.Fatalf("a proposal applied: %d tasks", n)
	}
	// A proposal that is not an object is dropped, the alert still goes out.
	agent.script = func(RunInput) (AgentResult, error) {
		return AgentResult{Reports: []Report{{Title: "Second", Body: "b", Proposal: json.RawMessage(`"drop table"`)}}}, nil
	}
	e.again(b.ID)
	var second Alert
	must(t, e.db.Where("bot_id = ? AND title LIKE '%Second'", b.ID).First(&second).Error)
	if second.ProposalState != "" || len(second.Proposal) != 0 {
		t.Fatalf("a bad proposal was kept: %+v", second)
	}
}

// The same alert within 7 days is held as a duplicate: no notification, no
// post into the thread; a changed price is another alert, and a week later
// the first comes round again.
func TestIntegrationAgentDuplicateAlertHeld(t *testing.T) {
	e := newEngine(t)
	price := 89999.0
	title := "Pixel 10 Pro is under 90k"
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) {
		return AgentResult{Reports: []Report{{Title: title, Body: "b", URL: "https://example.com/p", Price: &price}}}, nil
	})
	threads := &scriptedThreads{}
	e.s.SetAgent(agent)
	e.s.SetThreadPoster(threads)
	b := e.bareAgent("Pixel", 15, AgentTools{})

	must(t, e.run(b.ID))
	if c := e.lastCheck(b.ID); c.Outcome != outAlerted || len(e.notifications()) != 1 {
		t.Fatalf("first: %+v", c)
	}
	e.again(b.ID)
	c := e.lastCheck(b.ID)
	if c.Outcome != outDuplicate || c.SkipReason != SkipDuplicate || c.AlertID != nil || len(e.notifications()) != 1 || len(threads.got()) != 1 {
		t.Fatalf("repeat: %+v, %d notifications", c, len(e.notifications()))
	}
	if n := e.count("bot_alerts", "bot_id = ? AND held = 'duplicate'", b.ID); n != 1 || e.count("bot_alerts", "bot_id = ?", b.ID) != 2 {
		t.Fatalf("%d duplicates", n)
	}
	// Spacing and case do not make it another alert; a new price does.
	title = "  pixel 10 PRO is   under 90k "
	e.again(b.ID)
	if c := e.lastCheck(b.ID); c.Outcome != outDuplicate {
		t.Fatalf("normalised title: %+v", c)
	}
	price = 84999
	e.again(b.ID)
	if c := e.lastCheck(b.ID); c.Outcome != outAlerted || len(e.notifications()) != 2 {
		t.Fatalf("new price: %+v", c)
	}
	// Past the 7 days the first comes round again.
	price, title = 89999, "Pixel 10 Pro is under 90k"
	e.now = e.now.Add(8 * 24 * time.Hour)
	must(t, e.run(b.ID))
	if c := e.lastCheck(b.ID); c.Outcome != outAlerted {
		t.Fatalf("after 8 days: %+v", c)
	}
}

// Agent Bots are never refused by the 20 a Bot and 200 an account daily
// caps; rules Bots' judge calls still are. The chain cap of 6 holds for both.
func TestIntegrationAgentRunsHaveNoDailyCaps(t *testing.T) {
	e := newEngine(t)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return quiet() })
	e.s.SetAgent(agent)
	b := e.bareAgent("Busy", 15, AgentTools{})
	day, err := localDay(e.db, e.user, e.now)
	must(t, err)
	for range AIPerAccount {
		must(t, e.db.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, chain_id, local_day, purpose, created_at)
			VALUES (?, ?, ?, ?, CAST(? AS date), 'run', ?)`, "bai_cap_"+uuid.NewString(), e.user, b.ID, "chain_cap_"+uuid.NewString(), day, e.now).Error)
	}
	must(t, e.run(b.ID))
	if c := e.lastCheck(b.ID); c.Outcome != outSilent || agent.runCount() != 1 {
		t.Fatalf("the daily caps refused an agent run: %+v", c)
	}
	ctx := context.Background()
	// Run rows don't count toward the daily caps: a judge call still gets
	// through after a full account's worth of runs.
	if _, err := e.s.reserveAI(ctx, b, "fresh", purposeJudge, e.now); err != nil {
		t.Fatalf("run rows used up the judge's daily caps: %v", err)
	}
	// Judge rows do count: past the per-Bot cap the next judge call is refused.
	for range AIPerBot {
		must(t, e.db.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, chain_id, local_day, purpose, created_at)
			VALUES (?, ?, ?, ?, CAST(? AS date), 'judge', ?)`, "bai_cap_"+uuid.NewString(), e.user, b.ID, "chain_cap_"+uuid.NewString(), day, e.now).Error)
	}
	if _, err := e.s.reserveAI(ctx, b, "fresh", purposeJudge, e.now); !errors.Is(err, errAICap) {
		t.Fatalf("a judge call past the daily caps: %v", err)
	}
	if _, err := e.s.reserveAI(ctx, b, "fresh", purposeRun, e.now); err != nil {
		t.Fatalf("a run past the daily caps: %v", err)
	}
	// The chain cap holds for a run: the 7th call of one chain is refused.
	other := e.bareAgent("Chained", 15, AgentTools{})
	for range ChainAI {
		if _, err := e.s.reserveAI(ctx, other, "chain_one", purposeRun, e.now); err != nil {
			t.Fatalf("within the chain cap: %v", err)
		}
	}
	if _, err := e.s.reserveAI(ctx, other, "chain_one", purposeRun, e.now); !errors.Is(err, errAICap) {
		t.Fatalf("past the chain cap: %v", err)
	}
	if _, err := e.s.reserveAI(ctx, other, "chain_two", purposeRun, e.now); err != nil {
		t.Fatalf("another chain: %v", err)
	}
}

func passJob(e *engine, passID, botID string) *models.Job {
	return &models.Job{ID: utils.NewJobID(), UserID: e.user, Kind: models.JobBotPass, Attempts: 1, MaxAttempts: 2,
		Payload: models.JobPayload{"passId": passID, "botId": botID}}
}

func (e *engine) pendingPass(toBotID string) Pass {
	e.t.Helper()
	var p Pass
	must(e.t, e.db.Where("to_bot_id = ? AND state = ?", toBotID, passPending).Order("created_at DESC").First(&p).Error)
	return p
}

// A note one agent Bot passes starts an agent tick of the receiving Bot with
// the note as data. The receiver's schedule, readings and strikes are left
// alone; a failed or capped tick folds or fails the pass, never a strike; Pause
// all folds it without asking the agent.
func TestIntegrationAgentPassTickOfReceivingBot(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	agent := newScriptedAgent(func(in RunInput) (AgentResult, error) {
		switch in.Bot.Name {
		case "Sender":
			return reportOf("deal-" + in.CheckID), nil
		}
		return AgentResult{Reports: []Report{{Title: "Worth a look: " + in.Passed[0].Title, Body: "Passed on", URL: in.Passed[0].URL}}}, nil
	})
	threads := &scriptedThreads{}
	e.s.SetAgent(agent)
	e.s.SetThreadPoster(threads)
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	from := e.bareAgent("Sender", 15, AgentTools{})
	to := e.bareAgent("Receiver", 60, AgentTools{})
	must(t, e.db.Create(&Link{ID: "blk_pass", UserID: e.user, Kind: LinkPass, FromBotID: from.ID, ToBotID: to.ID, Filter: jsonList[string]{}, Enabled: true}).Error)
	before := e.bot(to.ID)

	// The sender's report is taken by the link: it alerts nothing itself.
	must(t, e.run(from.ID))
	c := e.lastCheck(from.ID)
	if c.Outcome != outPassed || c.AlertID != nil || e.count("bot_alerts", "bot_id = ?", from.ID) != 0 || len(e.notifications()) != 0 {
		t.Fatalf("sender %+v", c)
	}
	pass := e.pendingPass(to.ID)
	if pass.FromBotID != from.ID || pass.FindingID == nil || pass.ChainID != c.ID || pass.Depth != 1 || e.count("jobs", "kind = ? AND status = 'pending'", models.JobBotPass) != 1 {
		t.Fatalf("pass %+v", pass)
	}

	// The receiver ticks with the note.
	must(t, e.s.HandlePass(ctx, passJob(e, pass.ID, to.ID)))
	last := agent.runs[len(agent.runs)-1]
	if last.Bot.ID != to.ID || len(last.Passed) != 1 || last.Passed[0].ID != *pass.FindingID || len(last.Diff) != 0 || last.CheckID == "" {
		t.Fatalf("receiver input %+v", last)
	}
	rc := e.lastCheck(to.ID)
	if rc.Trigger != TriggerPass || rc.Outcome != outAlerted || rc.AlertID == nil || rc.Run == nil {
		t.Fatalf("receiver check %+v", rc)
	}
	var alert Alert
	must(t, e.db.Where("id = ?", *rc.AlertID).First(&alert).Error)
	if len(alert.Via) != 1 || alert.Via[0].BotID != from.ID || alert.Via[0].Name != "Sender" || alert.Held != "" {
		t.Fatalf("receiver alert %+v", alert)
	}
	if after := e.bot(to.ID); after.Strikes != 0 || !after.NextCheckAt.Equal(*before.NextCheckAt) || after.LastCheckAt != nil || after.CheckingJobID != nil {
		t.Fatalf("the pass touched the receiver's schedule: %+v", after)
	}
	if got := threads.got(); len(got) != 1 || got[0] != alert.ID {
		t.Fatalf("posted %v", got)
	}
	if e.count("bot_passes", "id = ? AND state = 'alerted' AND check_id = ?", pass.ID, rc.ID) != 1 {
		t.Fatal("the pass did not end alerted")
	}

	// A model that cannot be reached fails the pass, with no strike.
	e.due(from.ID)
	must(t, e.run(from.ID))
	second := e.pendingPass(to.ID)
	agent.script = func(in RunInput) (AgentResult, error) { return AgentResult{ErrorClass: ClassUnreachable}, nil }
	must(t, e.s.HandlePass(ctx, passJob(e, second.ID, to.ID)))
	if e.count("bot_passes", "id = ? AND state = 'failed'", second.ID) != 1 || e.bot(to.ID).Strikes != 0 {
		t.Fatal("an unreachable model struck the receiver or left the pass pending")
	}

	// The chain cap: a chain that already made 6 calls folds the next pass.
	agent.script = func(in RunInput) (AgentResult, error) { return reportOf("deal-" + in.CheckID), nil }
	e.due(from.ID)
	must(t, e.run(from.ID))
	third := e.pendingPass(to.ID)
	for range ChainAI - 1 { // the sender's own run already took one
		_, err := e.s.reserveAI(ctx, to, third.ChainID, purposeRun, e.now)
		must(t, err)
	}
	asked := agent.asked
	must(t, e.s.HandlePass(ctx, passJob(e, third.ID, to.ID)))
	if agent.asked != asked || e.count("bot_passes", "id = ? AND state = 'folded'", third.ID) != 1 {
		t.Fatalf("the chain cap did not hold: %d asks", agent.asked-asked)
	}

	// Pause all folds a pass without asking the agent, and stops a tick.
	e.due(from.ID)
	must(t, e.run(from.ID))
	fourth := e.pendingPass(to.ID)
	_, err := e.s.SetAllPaused(ctx, e.user, true)
	must(t, err)
	asked = agent.asked
	must(t, e.s.HandlePass(ctx, passJob(e, fourth.ID, to.ID)))
	e.due(to.ID)
	must(t, e.run(to.ID))
	if agent.asked != asked || e.count("bot_passes", "id = ? AND state = 'folded'", fourth.ID) != 1 {
		t.Fatalf("Pause all let the agent run: %d asks", agent.asked-asked)
	}
}

// A tick whose job is retried is the same Check: the Agent is handed the same
// idempotency key (the check id), and one alert comes out of the two attempts.
func TestIntegrationAgentRetryIsIdempotent(t *testing.T) {
	e := newEngine(t)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return reportOf("once"), nil })
	e.s.SetAgent(agent)
	b := e.bareAgent("Retry", 15, AgentTools{})
	job := e.job(b.ID, TriggerSchedule)
	fail := true
	e.s.beforeCommit = func(*gorm.DB) error {
		if fail {
			return errors.New("the database hiccuped")
		}
		return nil
	}
	if err := e.s.HandleCheck(context.Background(), job); err == nil {
		t.Fatal("the failed save did not ask for a retry")
	}
	if e.count("bot_checks", "bot_id = ?", b.ID) != 0 || e.count("bot_alerts", "bot_id = ?", b.ID) != 0 {
		t.Fatal("a failed save left rows")
	}
	fail = false
	job.Attempts = 2
	must(t, e.s.HandleCheck(context.Background(), job))
	if agent.asked != 2 || agent.runCount() != 1 || agent.runs[0].CheckID != agentCheckID(job) {
		t.Fatalf("%d asks, %d runs", agent.asked, agent.runCount())
	}
	if e.count("bot_checks", "bot_id = ?", b.ID) != 1 || e.count("bot_alerts", "bot_id = ?", b.ID) != 1 || len(e.notifications()) != 1 {
		t.Fatal("the retry doubled the check or the alert")
	}
	// The job again, once saved, changes nothing.
	job.Attempts = 3
	must(t, e.s.HandleCheck(context.Background(), job))
	if e.count("bot_checks", "bot_id = ?", b.ID) != 1 || agent.asked != 2 {
		t.Fatal("a finished tick ran again")
	}
}

// Pause all stops agent ticks before they are claimed.
func TestIntegrationAgentPauseAll(t *testing.T) {
	e := newEngine(t)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return quiet() })
	e.s.SetAgent(agent)
	b := e.bareAgent("Paused", 15, AgentTools{})
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	_, err := e.s.SetAllPaused(context.Background(), e.user, true)
	must(t, err)
	must(t, e.run(b.ID))
	if agent.asked != 0 || e.count("bot_checks", "bot_id = ?", b.ID) != 0 {
		t.Fatal("a tick ran while all bots were paused")
	}
}

// POST /bots/:id/convert switches only that Bot, with ConvertPrompt's text;
// GET shows it first and stores nothing.
func TestIntegrationBotConvertOneAtATime(t *testing.T) {
	e := newEngine(t)
	amount := "27499.00"
	e.coinbase(&amount)
	a := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	b := e.create(pageInput("Other", "https://example.com/other"))
	wsA, err := loadWatches(e.db, a.ID, false)
	must(t, err)
	wantPrompt, _, _ := ConvertPrompt(e.bot(a.ID), wsA)

	code, body := call(t, e.s, e.user, http.MethodGet, "/bots/"+a.ID+"/convert", nil)
	if code != http.StatusOK || body["prompt"] != wantPrompt || body["engine"] != EngineRules || body["gate"] != GateChanged {
		t.Fatalf("preview %d %v", code, body)
	}
	if e.bot(a.ID).Engine != EngineRules || e.bot(a.ID).Prompt != "" {
		t.Fatal("the preview stored the conversion")
	}

	code, body = call(t, e.s, e.user, http.MethodPost, "/bots/"+a.ID+"/convert", nil)
	if code != http.StatusOK || body["engine"] != EngineAgent || body["prompt"] != wantPrompt {
		t.Fatalf("convert %d %v", code, body)
	}
	got := e.bot(a.ID)
	if got.Engine != EngineAgent || got.Prompt != wantPrompt || got.Gate != GateChanged || got.Schedule["everyMinutes"] != float64(15) ||
		got.IntervalSeconds < 300 || got.IntervalSeconds > 604800 || got.Permission != PermissionAuto || got.UseMemory {
		t.Fatalf("converted %+v", got)
	}
	if other := e.bot(b.ID); other.Engine != EngineRules || other.Prompt != "" {
		t.Fatalf("another Bot was switched: %+v", other)
	}
	if code, _ := call(t, e.s, e.user, http.MethodPost, "/bots/"+a.ID+"/convert", nil); code != http.StatusBadRequest {
		t.Fatalf("a second approval: %d", code)
	}
	if code, _ := call(t, e.s, e.user, http.MethodGet, "/bots/bot_nobody/convert", nil); code != http.StatusNotFound {
		t.Fatalf("an unknown Bot: %d", code)
	}
	// There is no bulk route.
	if code, _ := call(t, e.s, e.user, http.MethodPost, "/bots/convert", nil); code == http.StatusOK {
		t.Fatal("a bulk convert route answered")
	}
	// Its watches and history stay.
	if n := e.count("bot_watches", "bot_id = ?", a.ID); n != 1 {
		t.Fatalf("%d watches", n)
	}
}

// GET /bots/:id/notes and DELETE /bots/:id/notes/:key.
func TestIntegrationBotNotesEndpoints(t *testing.T) {
	e := newEngine(t)
	b := e.bareAgent("Notes", 15, AgentTools{})
	mine := NewNotesStore(e.db)
	must(t, mine.Set(context.Background(), e.user, b.ID, "last price", "89999"))
	must(t, mine.Set(context.Background(), e.user, b.ID, "seen", "a,b"))

	code, body := call(t, e.s, e.user, http.MethodGet, "/bots/"+b.ID+"/notes", nil)
	items, _ := body["items"].([]any)
	if code != http.StatusOK || len(items) != 2 {
		t.Fatalf("list %d %v", code, body)
	}
	if first, _ := items[0].(map[string]any); first["key"] != "last price" || first["value"] != "89999" {
		t.Fatalf("first note %v", items[0])
	}
	if code, _ := call(t, e.s, e.user, http.MethodDelete, "/bots/"+b.ID+"/notes/last%20price", nil); code != http.StatusNoContent {
		t.Fatalf("delete %d", code)
	}
	if code, _ := call(t, e.s, e.user, http.MethodDelete, "/bots/"+b.ID+"/notes/last%20price", nil); code != http.StatusNotFound {
		t.Fatalf("delete again %d", code)
	}
	if _, ok, _ := mine.Get(context.Background(), e.user, b.ID, "seen"); !ok {
		t.Fatal("deleting one note took another")
	}
	// Another person's Bot is not found.
	stranger := addUser(t, e.db)
	if code, _ := call(t, e.s, stranger, http.MethodGet, "/bots/"+b.ID+"/notes", nil); code != http.StatusNotFound {
		t.Fatalf("a stranger read the notes: %d", code)
	}
	if code, _ := call(t, e.s, stranger, http.MethodDelete, "/bots/"+b.ID+"/notes/seen", nil); code != http.StatusNotFound {
		t.Fatalf("a stranger deleted a note: %d", code)
	}
	code, body = call(t, e.s, e.user, http.MethodGet, "/bots/"+e.bareAgent("Empty", 15, AgentTools{}).ID+"/notes", nil)
	if items, _ := body["items"].([]any); code != http.StatusOK || items == nil || len(items) != 0 {
		t.Fatalf("an empty notepad: %d %v", code, body)
	}
}

// POST /bots/:id/try and /bots/try run one dry tick: the agent is asked with
// DryRun set, the would-send text comes back, and nothing is saved.
func TestIntegrationBotTryIsADryTick(t *testing.T) {
	e := newEngine(t)
	amount := "27499.00"
	e.coinbase(&amount)
	agent := newScriptedAgent(func(in RunInput) (AgentResult, error) {
		if !in.DryRun {
			return AgentResult{ErrorClass: ClassCrash}, nil
		}
		if in.Bot.Name == "Quiet" {
			return quiet()
		}
		return AgentResult{Reports: []Report{{Title: "Would tell", Body: "A body"}}, Trace: []ToolTrace{{Tool: "web_extract", Outcome: "ok"}}, Usage: Usage{Calls: 1}}, nil
	})
	e.s.SetAgent(agent)
	b := e.bareAgent("Sample", 15, AgentTools{})
	must(t, NewNotesStore(e.db).Set(context.Background(), e.user, b.ID, "k", "v"))
	saved := func() []int64 {
		return []int64{
			e.count("bot_checks", "user_id = ?", e.user), e.count("bot_alerts", "user_id = ?", e.user), e.count("bot_findings", "user_id = ?", e.user),
			e.count("bot_ai_calls", "user_id = ?", e.user), e.count("bots", "user_id = ?", e.user), e.count("bot_notes", "user_id = ?", e.user),
			e.count("jobs", "user_id = ?", e.user),
		}
	}
	before := saved()

	code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+b.ID+"/try", nil)
	if code != http.StatusOK || body["text"] != "Would tell\nA body" || body["silent"] != false || body["error"] != "" {
		t.Fatalf("try %d %v", code, body)
	}
	if trace, _ := body["trace"].([]any); len(trace) != 1 {
		t.Fatalf("trace %v", body["trace"])
	}
	if in := agent.runs[0]; !in.DryRun || in.Notes["k"] != "v" || in.CheckID == "" {
		t.Fatalf("input %+v", in)
	}

	// A draft: nothing but the request is saved, the Reads are read once.
	code, body = call(t, e.s, e.user, http.MethodPost, "/bots/try", map[string]any{
		"name": "Quiet", "prompt": "Tell me when BTC falls", "schedule": "every 1h",
		"watches": []map[string]any{{"kind": "price", "source": "coinbase", "symbol": "BTC"}},
	})
	if code != http.StatusOK || body["text"] != "[SILENT]" || body["silent"] != true {
		t.Fatalf("draft try %d %v", code, body)
	}
	if in := agent.runs[1]; !in.DryRun || len(in.Readings) != 1 || len(in.Diff) != 1 || in.Bot.Prompt != "Tell me when BTC falls" {
		t.Fatalf("draft input %+v", in)
	}
	// A draft with nothing to do is refused, and a failed run says how.
	if code, _ := call(t, e.s, e.user, http.MethodPost, "/bots/try", map[string]any{"name": "Empty"}); code != http.StatusBadRequest {
		t.Fatalf("an empty draft: %d", code)
	}
	agent.script = func(RunInput) (AgentResult, error) { return AgentResult{ErrorClass: ClassTimeout}, nil }
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+b.ID+"/try", nil); code != http.StatusOK || body["error"] != ClassTimeout {
		t.Fatalf("a failed run %d %v", code, body)
	}
	after := saved()
	for i := range before {
		if before[i] != after[i] {
			t.Fatalf("a dry tick saved something: %v -> %v", before, after)
		}
	}
	// With no agent it says what is missing.
	e.s.SetAgent(nil)
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/"+b.ID+"/try", nil); code != http.StatusOK || body["error"] != classNoAI {
		t.Fatalf("no agent %d %v", code, body)
	}
}
