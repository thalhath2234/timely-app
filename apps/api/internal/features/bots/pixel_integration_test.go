package bots

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"timely-api/internal/features/bots/extract"
)

// scriptedAgent scripts the Agent: run answers every tick, once per check id (a
// retry of the same check, which the real worker dedupes by its idempotency
// key, gets the first answer back). It counts the runs the script made and
// every call it was asked for.
type scriptedAgent struct {
	mu     sync.Mutex
	script func(in RunInput) (AgentResult, error)
	cached map[string]agentAnswer
	runs   []RunInput // one per distinct check id
	asked  int        // every Run call, retries included
	busy   bool
}

type agentAnswer struct {
	res AgentResult
	err error
}

func newScriptedAgent(script func(in RunInput) (AgentResult, error)) *scriptedAgent {
	return &scriptedAgent{script: script, cached: map[string]agentAnswer{}}
}

func (f *scriptedAgent) Run(_ context.Context, _ string, in RunInput) (AgentResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.asked++
	if a, ok := f.cached[in.CheckID]; ok {
		return a.res, a.err
	}
	f.runs = append(f.runs, in)
	res, err := f.script(in)
	f.cached[in.CheckID] = agentAnswer{res, err}
	return res, err
}

func (f *scriptedAgent) BrowserBusy(string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.busy
}

func (f *scriptedAgent) runCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.runs)
}

// scriptedThreads records the alerts posted into Bot threads.
type scriptedThreads struct {
	mu    sync.Mutex
	posts []string
}

func (f *scriptedThreads) PostAlert(_ context.Context, _, _, alertID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.posts = append(f.posts, alertID)
	return nil
}

func (f *scriptedThreads) got() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.posts...)
}

// quiet is a run that found nothing: [SILENT].
func quiet() (AgentResult, error) {
	return AgentResult{Response: "[SILENT]", Silent: true, Usage: Usage{InputTokens: 100, OutputTokens: 3, Calls: 1}}, nil
}

// The Pixel case on the agent engine: a converted "below ₹90,000" shop watch.
// An out of stock page at ₹109,999 wakes the agent once (the first tick), which
// stays silent; the page at ₹89,999 in stock moves price and availability, so
// the agent wakes and its report becomes exactly one alert, notified and
// posted into the Bot thread; the same reading again is "unchanged" at the
// gate, with no Agent call and no second alert.
func TestIntegrationPixelAgentBot(t *testing.T) {
	e := newEngine(t)
	u := "https://www.flipkart.com/google-pixel-10-pro/p/itm1"
	amount, avail := "109999", "http://schema.org/OutOfStock"
	e.net.set(u, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "text/html; charset=utf-8", string(flipkartPage(t, amount, avail))), nil
	})
	agent := newScriptedAgent(func(in RunInput) (AgentResult, error) {
		for _, r := range in.Readings {
			if r.Price != nil && *r.Price < 90000 && r.Availability == extract.AvailInStock {
				return AgentResult{
					Response: "Pixel 10 Pro is now ₹89,999 and in stock.",
					Reports:  []Report{{Title: "Pixel 10 Pro is ₹89,999 and in stock", Body: "Below your ₹90,000 line.", URL: u, Price: r.Price, Urgency: UrgencyHigh}},
					Usage:    Usage{InputTokens: 900, OutputTokens: 40, Calls: 2},
					Trace:    []ToolTrace{{Tool: "bot_report", Summary: "reported", Outcome: "ok"}},
				}, nil
			}
		}
		return quiet()
	})
	threads := &scriptedThreads{}
	e.s.SetAgent(agent)
	e.s.SetThreadPoster(threads)

	v := e.create(Input{Name: "Pixel 10 Pro under ₹90,000", Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadProductPrice,
		Rules: []Rule{{Kind: RuleBelow, Threshold: f64(90000)}}}}})
	b := e.bot(v.ID)
	ws, err := loadWatches(e.db, v.ID, false)
	must(t, err)
	wantPrompt, _, _ := ConvertPrompt(b, ws)
	conv, err := e.s.Convert(context.Background(), e.user, v.ID)
	must(t, err)
	if conv.Engine != EngineAgent || conv.Prompt != wantPrompt || conv.Gate != GateChanged || conv.Schedule["everyMinutes"] != float64(360) {
		t.Fatalf("converted %+v, want prompt %q", conv, wantPrompt)
	}

	// Out of stock at ₹109,999: the first tick wakes the agent, which is silent.
	must(t, e.run(v.ID))
	c := e.lastCheck(v.ID)
	if c.Outcome != outSilent || c.AlertID != nil || c.Run == nil || !c.Run.Silent || c.Run.Usage.InputTokens != 100 || agent.runCount() != 1 {
		t.Fatalf("first tick %+v, %d runs", c, agent.runCount())
	}
	if n := len(e.notifications()); n != 0 || e.count("bot_alerts", "bot_id = ?", v.ID) != 0 {
		t.Fatalf("a silent tick alerted: %d notifications", n)
	}
	first := agent.runs[0]
	if first.CheckID != c.ID || first.Bot.ID != v.ID || len(first.Diff) != 1 || first.Prompt == "" || first.Permission != PermissionAuto || first.UseMemory {
		t.Fatalf("run input %+v", first)
	}
	if w := watchRow(t, e.db, v.Watches[0].ID); w.LastReading == nil || w.LastReading.Availability != extract.AvailOutOfStock {
		t.Fatalf("the silent tick did not record the reading: %+v", w.LastReading)
	}

	// In stock at ₹89,999: price and availability moved, one alert.
	amount, avail = "89999", "http://schema.org/InStock"
	e.again(v.ID)
	c = e.lastCheck(v.ID)
	if c.Outcome != outAlerted || c.AlertID == nil || agent.runCount() != 2 || c.GateSkipped {
		t.Fatalf("restock tick %+v, %d runs", c, agent.runCount())
	}
	diff := agent.runs[1].Diff
	if len(diff) != 2 || diff[0].Kind != DiffPrice || diff[1].Kind != DiffAvailability {
		t.Fatalf("gate diff %+v", diff)
	}
	ntfs := e.notifications()
	if len(ntfs) != 1 || ntfs[0].Title != "Pixel 10 Pro under ₹90,000: Pixel 10 Pro is ₹89,999 and in stock" || ntfs[0].Data.String("botAlert") != "alert" {
		t.Fatalf("notifications %+v", ntfs)
	}
	var alerts []Alert
	must(t, e.db.Where("bot_id = ?", v.ID).Find(&alerts).Error)
	if len(alerts) != 1 || alerts[0].ID != *c.AlertID || alerts[0].Held != "" || alerts[0].Fingerprint == "" || alerts[0].ProposalState != "" || alerts[0].Urgency != UrgencyHigh {
		t.Fatalf("alerts %+v", alerts)
	}
	if got := threads.got(); len(got) != 1 || got[0] != alerts[0].ID {
		t.Fatalf("posted into the thread: %v", got)
	}
	if n := e.count("bot_findings", "bot_id = ? AND kind = 'price' AND alerted AND outside_data AND price = ?", v.ID, 89999); n != 1 {
		t.Fatalf("%d findings", n)
	}

	// The same reading again: the gate sees nothing move.
	e.again(v.ID)
	c = e.lastCheck(v.ID)
	if c.Outcome != outUnchanged || !c.GateSkipped || c.SkipReason != SkipUnchanged || c.Run != nil || c.AlertID != nil {
		t.Fatalf("replayed tick %+v", c)
	}
	if agent.runCount() != 2 || e.count("bot_alerts", "bot_id = ?", v.ID) != 1 || len(threads.got()) != 1 || len(e.notifications()) != 1 {
		t.Fatalf("the replay asked the agent or alerted: %d runs, %d alerts", agent.runCount(), e.count("bot_alerts", "bot_id = ?", v.ID))
	}
	if b := e.bot(v.ID); b.Strikes != 0 || b.Health != healthWorking || !b.NextCheckAt.After(e.now) {
		t.Fatalf("bot after the ticks %+v", b)
	}
	// What a client reads: the agent fields and the strip.
	d, err := e.s.Get(context.Background(), e.user, v.ID)
	must(t, err)
	if d.Engine != EngineAgent || d.Prompt != wantPrompt || d.Strip != "nfn" || len(d.Checks) != 3 {
		t.Fatalf("detail %q %q %+v", d.Engine, d.Strip, d.Checks)
	}
	if got := d.Checks[0]; got.Outcome != outUnchanged || !got.GateSkipped || got.SkipReason != SkipUnchanged {
		t.Fatalf("newest check %+v", got)
	}
	if got := d.Checks[1]; got.Outcome != outAlerted || got.Run == nil || got.Run.Usage.Calls != 2 || len(got.Run.Trace) != 1 {
		t.Fatalf("alert check %+v", got)
	}
}
