package chat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/bots"
)

// Agent Bots on the agent engine (phase 6, PROTOCOL.md section 13, plan 7.3
// to 7.5). BotAgent implements bots.Agent: one tick is one bot.run in the
// account's worker, which Go follows until its bot.done. Go answers the
// tick's tool calls (the Bot's notepad scoped to that Bot, its reports, the
// timely web backend) and every gate.ask through the bot gate
// (botHostDecision, bot_policy.go) and the browser lease (a chat holding the
// browser wins). Nobody can approve during a tick: a step that needs approval
// is answered "approve", which parks it in the worker, and Go writes it as a
// parked host card on the Bot's thread (Needs you) while the tick goes on.
// Run once on that card starts a continuation: a bot.run whose pre_approved
// call runs exactly once, fenced on the thread row's lease so nothing runs
// after Stop or Delete; Deny closes it.

const (
	// botRunPrefix starts the run id of a tick ("brun_<check id>") and of a
	// continuation ("brun_<check id>~<request id>"): a parked card's Run names
	// the Check it came from, and marks the card as a Bot's.
	botRunPrefix = "brun_"
	botContSep   = "~"
	// botDeadline is a tick's wall clock when RunInput names none;
	// botMaxDeadline is the most the worker takes (deadline_s 900).
	botDeadline    = 5 * time.Minute
	botMaxDeadline = 15 * time.Minute
	// botReportsMax is the worker's cap of bot_report calls per tick.
	botReportsMax = 5
	// botArgsMax caps the arguments a parked card keeps for its continuation.
	botArgsMax = 64 << 10
)

// botGrace is how long past its deadline Go waits for the worker's own end of
// a tick (its watchdog ends one at the deadline, or after 120 s of
// inactivity) before it stops the tick itself; botStopWait how long a stopped
// tick may take to send its bot.done. Vars so a test can shrink them.
var (
	botGrace    = 30 * time.Second
	botStopWait = 10 * time.Second
)

// errBotFenced is a continuation whose thread row is no longer its own
// (stopped, deleted, answered again): its bot.run is never sent.
var errBotFenced = errors.New("the bot thread no longer runs this step")

// BotNotes is a Bot's notepad (bots.NotesStore), scoped to one person and
// one Bot on every call.
type BotNotes interface {
	Get(ctx context.Context, userID, botID, key string) (string, bool, error)
	Set(ctx context.Context, userID, botID, key, value string) error
	Delete(ctx context.Context, userID, botID, key string) error
	Map(ctx context.Context, userID, botID string) (map[string]string, error)
}

// BotAgent runs agent Bot ticks on the WorkerEngine (bots.Agent).
type BotAgent struct {
	e     *WorkerEngine
	notes BotNotes
	lease *BrowserLease
	// SaveContinuation keeps what a Run once continuation found on the Check
	// whose card it ran: its reports become that Check's alerts, notified and
	// posted into the Bot thread (bots.Service.SaveContinuation, wired in
	// cmd). nil keeps only the Bot thread's "Reported" line.
	SaveContinuation func(ctx context.Context, userID, botID, checkID string, res bots.AgentResult) error

	mu sync.Mutex
	// live are the ticks in flight by the check id the worker knows them by,
	// so a retried job (the same Check) joins the run it started.
	live map[string]*botTick
}

var _ bots.Agent = (*BotAgent)(nil)

// NewBotAgent makes the Bot runner on engine. notes is the Bots' notepad
// (*bots.NotesStore); lease is the browser lease the engine's chat runs
// take too (nil: the engine's own).
func NewBotAgent(engine *WorkerEngine, notes BotNotes, lease *BrowserLease) *BotAgent {
	if lease == nil {
		lease = engine.lease
	} else {
		engine.lease = lease
	}
	a := &BotAgent{e: engine, notes: notes, lease: lease, live: map[string]*botTick{}}
	engine.mu.Lock()
	engine.botAgent = a
	engine.mu.Unlock()
	return a
}

// BrowserBusy implements bots.Agent: the account's browser is held (a chat
// run, or another Bot's Check), so a Check that needs it is skipped.
func (a *BotAgent) BrowserBusy(userID string) bool { return a.lease.Busy(userID) }

// StopBot stops the live ticks of one Bot (it was paused or deleted): each
// gets run.stop, so nothing more of it runs.
func (a *BotAgent) StopBot(userID, botID string) {
	a.e.mu.Lock()
	var ticks []*botTick
	for _, t := range a.e.bots {
		if t.uid == userID && t.botID == botID {
			ticks = append(ticks, t)
		}
	}
	a.e.mu.Unlock()
	for _, t := range ticks {
		a.e.stopTick(t, "bot stopped")
	}
}

// botTick is one bot.run this process follows: a tick or a continuation.
type botTick struct {
	id, uid, botID string
	// checkID is the Check the run writes; wireCheck the check_id the worker
	// knows it by (a continuation's adds its card, so the worker never
	// replays the tick's own bot.done for it).
	checkID, wireCheck string
	worker             *agenthost.Worker
	dryRun             bool
	// thread and lease are a continuation's Bot thread row and the lease the
	// answer gave it ("" for a tick).
	thread, lease string
	ctx           context.Context
	cancel        context.CancelFunc
	tools         *toolRun
	queue         runQueue
	done          chan struct{}
	res           bots.AgentResult
	err           error

	mu sync.Mutex
	// stopped is why the run was stopped ("" before); sent is set once
	// bot.run went out. A stop asked before that is sent right after it, so
	// the worker always hears of it before the run can call anything.
	stopped string
	sent    bool

	// Owned by the run loop.
	gate        BotRunCtx
	tainted     bool
	browserBusy bool
	// fetchable are the hosts a gate.ask allowed web_extract to read in this
	// tick (any host after a Full Access lift); searches the web_search calls
	// it allowed and Go has not run yet, and searchClean whether the latest
	// was allowed before the tick read outside content.
	fetchable   map[string]bool
	fetchAny    bool
	searches    int
	searchClean bool
	reports     int
	parked      int
}

// wait is the result of a tick another Run started.
func (t *botTick) wait(ctx context.Context) (bots.AgentResult, error) {
	select {
	case <-t.done:
		return t.res, t.err
	case <-ctx.Done():
		return bots.AgentResult{}, ctx.Err()
	}
}

// botSpec is one bot.run to send.
type botSpec struct {
	botID, checkID, wireCheck, runID string
	fields                           map[string]any
	gate                             BotRunCtx
	model                            bots.ModelChoice
	deadline                         time.Time
	dryRun                           bool
	// A continuation's thread row, its lease, the fence checked right before
	// bot.run goes out, and the lease renewal while it runs.
	thread, lease string
	fence         func() bool
	renew         func() bool
}

// Run implements bots.Agent: one tick of an agent Bot. It blocks until the
// worker's bot.done, the deadline (the worker's own, 5 minutes by default,
// plus a grace) or ctx. A tick of a Check that already runs here joins it.
func (a *BotAgent) Run(ctx context.Context, userID string, in bots.RunInput) (bots.AgentResult, error) {
	if in.CheckID == "" || in.Bot.ID == "" {
		return bots.AgentResult{}, errors.New("a bot run needs its Bot and its Check")
	}
	spec, err := a.spec(ctx, userID, in)
	if err != nil {
		return bots.AgentResult{}, err
	}
	return a.run(ctx, userID, spec)
}

// spec builds a tick's bot.run from what the tick handed over.
func (a *BotAgent) spec(ctx context.Context, uid string, in bots.RunInput) (botSpec, error) {
	b := in.Bot
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		prompt = strings.TrimSpace(b.Prompt)
	}
	if prompt == "" {
		return botSpec{}, errors.New("the bot has no prompt")
	}
	permission := in.Permission
	if permission == "" {
		permission = b.Permission
	}
	if permission == "" {
		permission = bots.PermissionAuto
	}
	sites := nonNilStrings(in.Tools.BrowserSites)
	egress := nonNilStrings(in.Tools.Egress)
	readHosts, addrs := a.reads(ctx, uid, b.ID)
	deadline := in.Deadline
	if deadline.IsZero() {
		deadline = time.Now().Add(botDeadline)
	}
	seconds := int(time.Until(deadline).Round(time.Second) / time.Second)
	seconds = max(1, min(seconds, int(botMaxDeadline/time.Second)))
	lessons := in.Lessons
	if lessons == nil {
		lessons = []string{}
	}
	skills := in.Skills
	if skills == nil {
		skills = []string{}
	}
	fields := map[string]any{
		"bot_id":     b.ID,
		"prompt":     prompt,
		"lessons":    lessons,
		"data":       botData(in, addrs),
		"skills":     skills,
		"name":       b.Name,
		"now":        time.Now().UTC().Format(time.RFC3339),
		"dry_run":    in.DryRun,
		"tools":      map[string]any{"browser_sites": sites, "egress": egress, "read_hosts": readHosts, "mcp": []string{}},
		"use_memory": in.UseMemory,
		// The worker's egress rule follows this; Full Access needs a step-up
		// record for the Bot, which bots do not have yet, so it runs as Auto.
		"permission": string(agent.BotMode(permission, false)),
		"deadline_s": seconds,
	}
	if zone := strings.TrimSpace(b.Timezone); zone != "" {
		if _, err := time.LoadLocation(zone); err == nil && zone != "Local" {
			fields["timezone"] = zone
		}
	}
	return botSpec{botID: b.ID, checkID: in.CheckID, wireCheck: in.CheckID, runID: botRunPrefix + in.CheckID,
		fields: fields, model: in.Model, deadline: deadline, dryRun: in.DryRun,
		gate: BotRunCtx{BotID: b.ID, Permission: permission, BrowserSites: sites, Egress: egress, ReadHosts: readHosts}}, nil
}

func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// readAddr is where one of the Bot's Reads reads: its page, or for a price
// Read with no page its price source and symbol.
type readAddr struct {
	url, source, symbol string
}

// reads are the hosts of the Bot's Reads (its Watches' pages), bot hosts the
// tick may fetch, and each Read's address by watch id.
func (a *BotAgent) reads(ctx context.Context, uid, botID string) ([]string, map[string]readAddr) {
	out, addrs := []string{}, map[string]readAddr{}
	if a.e.s == nil || a.e.s.db == nil {
		return out, addrs
	}
	var ws []bots.Watch
	if err := a.e.s.db.WithContext(ctx).Select("id", "url", "source", "symbol").Where("bot_id = ? AND user_id = ?", botID, uid).
		Find(&ws).Error; err != nil {
		a.e.opts.Logf("agent engine: bot %s reads: %v", botID, err)
		return out, addrs
	}
	seen := map[string]bool{}
	for _, w := range ws {
		addrs[w.ID] = readAddr{url: w.URL, source: w.Source, symbol: w.Symbol}
		if h := agent.BotHost(w.URL); h != "" && !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out, addrs
}

// botData is bot.run's data: the notes, readings, diff, passed notes, last
// alert and knowledge the tick read (each absent when empty). Each reading
// carries the url of its Read (PROTOCOL.md 13.1), or a price Read's source and
// ticker when it has no page; addrs are the Reads by watch id.
func botData(in bots.RunInput, addrs map[string]readAddr) map[string]any {
	data := map[string]any{}
	if len(in.Notes) > 0 {
		data["notes"] = in.Notes
	}
	if len(in.Readings) > 0 {
		var list []map[string]any
		for watch, r := range in.Readings {
			item := map[string]any{"watch_id": watch, "kind": r.Kind}
			switch addr := addrs[watch]; {
			case addr.url != "":
				item["url"] = addr.url
			case addr.symbol != "":
				// "symbol" is the reading's currency below, so the ticker has its own key.
				item["source"], item["ticker"] = addr.source, addr.symbol
			}
			if r.Title != "" {
				item["title"] = r.Title
			}
			if r.Text != "" {
				item["text"] = clip(r.Text, 4000)
			}
			if r.Price != nil {
				item["price"] = *r.Price
			}
			if r.Currency != "" {
				item["symbol"] = r.Currency
			}
			if r.Availability != "" {
				item["availability"] = r.Availability
			}
			list = append(list, item)
		}
		data["readings"] = list
	}
	if len(in.Diff) > 0 {
		var lines []string
		for _, d := range in.Diff {
			lines = append(lines, fmt.Sprintf("%s %s: %s -> %s", d.WatchID, d.Kind, d.Before, d.After))
		}
		data["diff"] = strings.Join(lines, "\n")
	}
	if len(in.Passed) > 0 {
		var passed []map[string]any
		for _, f := range in.Passed {
			item := map[string]any{"title": f.Title, "why": f.Why}
			if f.URL != "" {
				item["url"] = f.URL
			}
			if f.Price != nil {
				item["price"] = *f.Price
			}
			passed = append(passed, item)
		}
		data["passed"] = passed
	}
	if in.LastAlert != nil {
		data["last_alert"] = map[string]any{"title": in.LastAlert.Title, "body": clip(in.LastAlert.Body, 2000),
			"url": in.LastAlert.URL, "sent_at": in.LastAlert.CreatedAt.UTC().Format(time.RFC3339)}
	}
	if in.Knowledge != "" {
		data["knowledge"] = clip(in.Knowledge, 20000)
	}
	return data
}

// model is bot.run's model: the Bot's provider and model, else the account's
// default. No provider, or one that cannot run, is bots.ErrNoAI (Q-B3).
func (a *BotAgent) model(ctx context.Context, uid string, choice bots.ModelChoice) (any, bots.ModelChoice, error) {
	if choice.Provider == "" {
		if a.e.s == nil || a.e.s.completers == nil {
			return nil, choice, fmt.Errorf("%w: no AI provider is set up", bots.ErrNoAI)
		}
		p, m, err := a.e.s.completers.Resolve(ctx, uid)
		if err != nil || p == "" {
			return nil, choice, fmt.Errorf("%w: %v", bots.ErrNoAI, err)
		}
		choice = bots.ModelChoice{Provider: p, Model: m}
	}
	if a.e.opts.Model == nil {
		return nil, choice, errNoEngine
	}
	m, err := a.e.opts.Model(ctx, uid, choice.Provider, choice.Model, RunModelOptions{})
	if err != nil {
		return nil, choice, fmt.Errorf("%w: %v", bots.ErrNoAI, err)
	}
	return m, choice, nil
}

// run sends one bot.run and follows it to its end.
func (a *BotAgent) run(ctx context.Context, uid string, spec botSpec) (bots.AgentResult, error) {
	e := a.e
	if e.sup == nil {
		return bots.AgentResult{}, errNoEngine
	}
	a.mu.Lock()
	if t := a.live[spec.wireCheck]; t != nil {
		a.mu.Unlock()
		return t.wait(ctx)
	}
	a.mu.Unlock()
	model, choice, err := a.model(ctx, uid, spec.model)
	if err != nil {
		return bots.AgentResult{}, err
	}
	ensureCtx, cancelEnsure := context.WithTimeout(ctx, 2*time.Minute)
	w, err := e.sup.Ensure(ensureCtx, uid)
	cancelEnsure()
	if err != nil {
		return bots.AgentResult{Model: choice}, fmt.Errorf("no agent worker: %s", workerReason(err))
	}
	// The gateway's grant lasts as long as its worker: resolve again for this one.
	if again, _, err := a.model(ctx, uid, choice); err == nil {
		model = again
	}

	runCtx, cancel := context.WithCancel(context.Background())
	t := &botTick{id: spec.runID, uid: uid, botID: spec.botID, checkID: spec.checkID, wireCheck: spec.wireCheck, worker: w,
		dryRun: spec.dryRun, thread: spec.thread, lease: spec.lease, cancel: cancel, done: make(chan struct{}),
		gate: spec.gate, fetchable: map[string]bool{}}
	t.ctx = e.s.withRunCompleter(runCtx, &Conversation{UserID: uid, Provider: choice.Provider, Model: choice.Model})
	t.tools = &toolRun{web: webRun{on: true, fetch: e.opts.Fetch}, agentRun: t.id}
	t.queue.signal = make(chan struct{}, 1)
	if err := a.register(t); err != nil {
		cancel()
		if errors.Is(err, errBotJoined) {
			return a.joined(ctx, spec.wireCheck)
		}
		return bots.AgentResult{Model: choice}, err
	}
	defer a.forget(t)

	if spec.fence != nil && (!spec.fence() || t.stopReason() != "") {
		t.err = errBotFenced
		return bots.AgentResult{Model: choice}, errBotFenced
	}
	fields := make(map[string]any, len(spec.fields)+4)
	for k, v := range spec.fields {
		fields[k] = v
	}
	fields["run_id"], fields["check_id"], fields["model"] = t.id, t.wireCheck, model
	if err := w.Send(agenthost.TypeBotRun, fields); err != nil {
		t.err = err
		return bots.AgentResult{Model: choice}, err
	}
	t.mu.Lock()
	t.sent = true
	why := t.stopped
	t.mu.Unlock()
	if why != "" {
		// A Stop that came while bot.run was being sent: it follows it on the
		// same pipe, before any call of the run can be made.
		e.sendStop(t, why)
	}
	res, err := a.follow(ctx, t, spec)
	res.Model = choice
	t.res, t.err = res, err
	return res, err
}

// errBotJoined: another Run registered the same Check first.
var errBotJoined = errors.New("the check already runs")

func (a *BotAgent) register(t *botTick) error {
	a.mu.Lock()
	if a.live[t.wireCheck] != nil {
		a.mu.Unlock()
		return errBotJoined
	}
	a.live[t.wireCheck] = t
	a.mu.Unlock()
	e := a.e
	e.mu.Lock()
	defer e.mu.Unlock()
	switch {
	case e.closing:
		a.unregister(t)
		return agenthost.ErrClosed
	case e.bots[t.id] != nil:
		a.unregister(t)
		return fmt.Errorf("%w: %s", agenthost.ErrRunLive, t.id)
	}
	e.bots[t.id] = t
	return nil
}

func (a *BotAgent) unregister(t *botTick) {
	a.mu.Lock()
	if a.live[t.wireCheck] == t {
		delete(a.live, t.wireCheck)
	}
	a.mu.Unlock()
}

func (a *BotAgent) joined(ctx context.Context, wireCheck string) (bots.AgentResult, error) {
	a.mu.Lock()
	t := a.live[wireCheck]
	a.mu.Unlock()
	if t == nil {
		return bots.AgentResult{}, errBotJoined
	}
	return t.wait(ctx)
}

// forget ends a tick: it leaves the engine, lets the browser go, and wakes
// every Run that joined it.
func (a *BotAgent) forget(t *botTick) {
	t.cancel()
	a.lease.Release(t.uid, BotHolder(t.wireCheck))
	a.e.mu.Lock()
	if a.e.bots[t.id] == t {
		delete(a.e.bots, t.id)
	}
	a.e.mu.Unlock()
	a.unregister(t)
	close(t.done)
}

// stopBotRun sends run.stop to the continuation runID of the Bot thread cid
// (Stop or Delete on the thread); false when runID is no bot run here.
func (e *WorkerEngine) stopBotRun(uid, cid, runID string) bool {
	if runID == "" {
		return false
	}
	e.mu.Lock()
	t := e.bots[runID]
	e.mu.Unlock()
	if t == nil {
		return false
	}
	if t.uid == uid && t.thread != "" && t.thread == cid {
		e.stopTick(t, "user")
	}
	return true
}

// stopTick sends run.stop once; before bot.run went out, run sends it right
// after.
func (e *WorkerEngine) stopTick(t *botTick, why string) {
	t.mu.Lock()
	if t.stopped != "" {
		t.mu.Unlock()
		return
	}
	t.stopped = why
	sent := t.sent
	t.mu.Unlock()
	if !sent {
		return
	}
	e.sendStop(t, why)
}

func (e *WorkerEngine) sendStop(t *botTick, why string) {
	if err := t.worker.Send(agenthost.TypeRunStop, map[string]any{"run": t.id, "reason": why}); err != nil {
		e.opts.Logf("agent engine: run.stop %s: %v", t.id, err)
	}
}

func (t *botTick) stopReason() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stopped
}

// follow handles the tick's worker messages until bot.done, the worker's
// exit, the deadline or ctx.
func (a *BotAgent) follow(ctx context.Context, t *botTick, spec botSpec) (bots.AgentResult, error) {
	e := a.e
	deadline := time.NewTimer(time.Until(spec.deadline) + botGrace)
	defer deadline.Stop()
	var renew <-chan time.Time
	if spec.renew != nil {
		tk := time.NewTicker(e.opts.RenewEvery)
		defer tk.Stop()
		renew = tk.C
	}
	var gaveUp <-chan time.Time
	cancelled := ctx.Done()
	var ctxErr error
	timedOut := false
	for {
		select {
		case <-t.queue.signal:
			for {
				it, ok := t.queue.pop()
				if !ok {
					break
				}
				if res, err, over := a.step(t, it, timedOut); over {
					if ctxErr != nil {
						return res, ctxErr
					}
					return res, err
				}
			}
		case <-deadline.C:
			timedOut = true
			e.stopTick(t, "deadline")
			gaveUp = time.After(botStopWait)
		case <-cancelled:
			cancelled = nil
			ctxErr = ctx.Err()
			e.stopTick(t, "cancelled")
			gaveUp = time.After(botStopWait)
		case <-renew:
			if !spec.renew() {
				// Stop or Delete took the thread row: the step stops.
				e.stopTick(t, "fenced")
			}
		case <-gaveUp:
			if ctxErr != nil {
				return bots.AgentResult{}, ctxErr
			}
			return bots.AgentResult{ErrorClass: bots.ClassTimeout, Trace: []bots.ToolTrace{}}, nil
		}
	}
}

// step handles one item; over is true when the tick has ended.
func (a *BotAgent) step(t *botTick, it runItem, timedOut bool) (res bots.AgentResult, err error, over bool) {
	if it.end == "lost" {
		return bots.AgentResult{ErrorClass: bots.ClassCrash, Trace: []bots.ToolTrace{}}, nil, true
	}
	m := it.msg
	switch m.Type {
	case agenthost.TypeToolCall:
		a.toolCall(t, m)
	case agenthost.TypeGateAsk:
		a.gateAsk(t, m)
	case "event":
		var ev workerEvent
		if m.Decode(&ev) == nil {
			if line, ok := outputRisk(t.id, ev); ok {
				a.e.opts.Logf("%s", line)
			}
		}
	case agenthost.TypeBotDone:
		var d botDone
		if err := m.Decode(&d); err != nil {
			return bots.AgentResult{ErrorClass: bots.ClassCrash, Trace: []bots.ToolTrace{}}, nil, true
		}
		return d.result(t, timedOut), nil, true
	case agenthost.TypeError:
		// The worker refused the bot.run (agenthost hands over only that).
		var body struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = m.Decode(&body)
		return bots.AgentResult{}, fmt.Errorf("the agent worker refused the bot run (%s): %s", body.Code, body.Message), true
	}
	return bots.AgentResult{}, nil, false
}

// botDone is bot.done's body (PROTOCOL.md 13.2).
type botDone struct {
	Response string `json:"response"`
	Silent   bool   `json:"silent"`
	Reports  []struct {
		Title    string          `json:"title"`
		Body     string          `json:"body"`
		URL      string          `json:"url"`
		Price    *float64        `json:"price"`
		Symbol   string          `json:"symbol"`
		Urgency  string          `json:"urgency"`
		Proposal json.RawMessage `json:"proposal"`
	} `json:"reports"`
	// Usage is the worker's run_bot.usage_of. On the Claude Code CLI provider
	// (and Codex) the tokens are 0: the loopback gateway (provider/gateway.go)
	// answers every model call with usage 0, as its Completer's reply carries no
	// counts, so nothing on either side knows them.
	Usage struct {
		Input      int `json:"input_tokens"`
		Output     int `json:"output_tokens"`
		Iterations int `json:"iterations"`
	} `json:"usage"`
	Trace []struct {
		Name string `json:"name"`
		OK   bool   `json:"ok"`
		MS   int64  `json:"ms"`
		Host string `json:"host"`
		Note string `json:"note"`
	} `json:"trace"`
	ErrorClass string `json:"error_class"`
	Error      string `json:"error"`
	// RetryAfterSeconds is the provider's Retry-After on a rate_limited tick
	// (PROTOCOL.md 13.2); absent or not positive means it said nothing.
	RetryAfterSeconds float64 `json:"retry_after_seconds"`
	Replayed          bool    `json:"replayed"`
}

// result is the AgentResult of a bot.done.
func (d botDone) result(t *botTick, timedOut bool) bots.AgentResult {
	res := bots.AgentResult{Response: d.Response, Reports: []bots.Report{}, Trace: []bots.ToolTrace{},
		Usage: bots.Usage{InputTokens: d.Usage.Input, OutputTokens: d.Usage.Output, Calls: d.Usage.Iterations}}
	for _, r := range d.Reports {
		urgency := "normal"
		if r.Urgency == "urgent" || r.Urgency == "high" {
			urgency = "high"
		}
		var proposal json.RawMessage
		if len(r.Proposal) > 0 && string(r.Proposal) != "null" {
			proposal = r.Proposal
		}
		res.Reports = append(res.Reports, bots.Report{Title: r.Title, Body: r.Body, URL: r.URL, Price: r.Price, Symbol: r.Symbol,
			Urgency: urgency, Proposal: proposal})
	}
	for _, tr := range d.Trace {
		outcome := "ok"
		switch {
		case tr.OK:
		case strings.HasPrefix(tr.Note, "Parked:"):
			outcome = "parked"
		case strings.HasPrefix(tr.Note, "Blocked:") || strings.Contains(tr.Note, hostBrowserBusy):
			outcome = "refused"
		default:
			outcome = "error"
		}
		res.Trace = append(res.Trace, bots.ToolTrace{Tool: clip(tr.Name, 100), Summary: clip(tr.Note, 200), Outcome: outcome,
			Host: clip(tr.Host, 200), MS: tr.MS})
	}
	res.Silent = d.Silent && len(res.Reports) == 0
	res.ErrorClass = botClass(d.ErrorClass, timedOut)
	if res.ErrorClass == bots.ClassRateLimited && d.RetryAfterSeconds > 0 {
		// Go clamps the hold (bots.rateHoldFor); this only converts the unit,
		// and caps it so a huge number cannot overflow the Duration.
		res.RetryAfter = time.Duration(min(d.RetryAfterSeconds, maxRetryAfterSeconds) * float64(time.Second))
	}
	if t.browserBusy && res.ErrorClass == "" {
		// A chat had the browser: the Check records "browser busy".
		res.ErrorClass = bots.ClassBrowserBusy
	}
	return res
}

// maxRetryAfterSeconds bounds a worker's retry_after_seconds before it becomes
// a Duration (a week; bots clamps the hold to a day).
const maxRetryAfterSeconds = 7 * 24 * 3600

// botClass maps bot.done's error_class to the tick's (bots.Class*).
func botClass(class string, timedOut bool) string {
	switch class {
	case "":
		return ""
	case "prompt_blocked":
		return bots.ClassInjection
	case "agent_failure":
		return bots.ClassCronFailure
	case "unreachable":
		return bots.ClassUnreachable
	case "rate_limited":
		return bots.ClassRateLimited
	case "deadline", "inactive":
		return bots.ClassTimeout
	case "stopped":
		if timedOut {
			return bots.ClassTimeout
		}
		// Stopped by Go for another reason (the Bot paused, Delete): no
		// strike, it runs again on its schedule.
		return bots.ClassUnreachable
	}
	return bots.ClassCrash
}

// toolCall answers one of the tick's tool.calls: the Bot's notepad (this
// Bot only), its reports, and the timely web backend.
func (a *BotAgent) toolCall(t *botTick, m agenthost.Message) {
	var call struct {
		Name    string          `json:"name"`
		Args    json.RawMessage `json:"args"`
		Tainted []TaintSource   `json:"tainted_sources"`
	}
	if err := m.Decode(&call); err != nil {
		_ = t.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]string{"error": "Unreadable tool call"}, "outside": false, "end_turn": false})
		return
	}
	if len(call.Tainted) > 0 {
		t.tainted = true
	}
	args := call.Args
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	result, outside := a.botTool(t, call.Name, args)
	_ = t.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": result, "outside": outside, "end_turn": false})
}

func (a *BotAgent) botTool(t *botTick, name string, args json.RawMessage) (any, bool) {
	refuse := func(msg string) (any, bool) { return map[string]string{"error": msg}, false }
	budget := toolBudget
	if slowTools[name] {
		budget = slowToolBudget
	}
	ctx, cancel := context.WithTimeout(t.ctx, budget)
	defer cancel()
	var note struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	switch name {
	case "bot_note_get", "bot_note_set", "bot_note_delete":
		if a.notes == nil {
			return refuse("The notepad is not available")
		}
		_ = json.Unmarshal(args, &note)
		note.Key = strings.TrimSpace(note.Key)
	}
	switch name {
	case "bot_note_get":
		// The notes are what the Bot kept from pages it read: outside text.
		if note.Key == "" {
			notes, err := a.notes.Map(ctx, t.uid, t.botID)
			if err != nil {
				return refuse("The notepad could not be read")
			}
			if notes == nil {
				notes = map[string]string{}
			}
			return map[string]any{"notes": notes}, true
		}
		value, ok, err := a.notes.Get(ctx, t.uid, t.botID, note.Key)
		if err != nil {
			return refuse("The notepad could not be read")
		}
		if !ok {
			return map[string]any{"key": note.Key, "value": nil}, false
		}
		return map[string]any{"key": note.Key, "value": value}, true
	case "bot_note_set":
		if t.dryRun {
			return map[string]any{"ok": true, "key": note.Key, "dry_run": true}, false
		}
		if err := a.notes.Set(ctx, t.uid, t.botID, note.Key, note.Value); err != nil {
			return refuse(noteError(err))
		}
		return map[string]any{"ok": true, "key": note.Key}, false
	case "bot_note_delete":
		if t.dryRun {
			return map[string]any{"ok": true, "key": note.Key, "dry_run": true}, false
		}
		err := a.notes.Delete(ctx, t.uid, t.botID, note.Key)
		if errors.Is(err, bots.ErrNoNote) {
			return map[string]any{"ok": true, "key": note.Key, "deleted": false}, false
		}
		if err != nil {
			return refuse(noteError(err))
		}
		return map[string]any{"ok": true, "key": note.Key, "deleted": true}, false
	case "bot_report":
		// The reports reach the Check through bot.done; Go keeps the cap.
		if t.reports >= botReportsMax {
			return refuse(fmt.Sprintf("A run reports at most %d findings; fold the rest into one", botReportsMax))
		}
		t.reports++
		return map[string]any{"ok": true, "recorded": true}, false
	case "web_search":
		if t.searches == 0 {
			return refuse("Timely did not allow this search for the bot")
		}
		t.searches--
		clean := t.searchClean && !t.tainted
		result, outside, err := a.e.s.webSearch(ctx, t.tools, args)
		if err != nil {
			return refuse(err.Error())
		}
		if clean {
			// Hosts a search returned before the tick read outside content
			// count as bot hosts (plan 7.5).
			if out, ok := result.(map[string]any); ok {
				if results, ok := out["results"].([]webResult); ok {
					for _, r := range results {
						if h := agent.BotHost(r.URL); h != "" {
							t.gate.SearchHosts = append(t.gate.SearchHosts, h)
						}
					}
				}
			}
		}
		t.tainted = t.tainted || outside
		return result, outside
	case "web_extract":
		var in struct {
			URLs []string `json:"urls"`
			URL  string   `json:"url"`
		}
		_ = json.Unmarshal(args, &in)
		for _, u := range append(in.URLs, in.URL) {
			if strings.TrimSpace(u) == "" {
				continue
			}
			if !t.fetchAny && !t.fetchable[agent.BotHost(u)] {
				return refuse("This bot may only read the sites it watches, the sites you granted its browser and its egress list")
			}
		}
		result, outside, err := a.e.s.webExtract(ctx, t.tools, args)
		if err != nil {
			return refuse(err.Error())
		}
		t.tainted = t.tainted || outside
		return result, outside
	}
	// Timely's read tools are not offered to bots yet (tools.timely false).
	return refuse(agent.BotBlockUnknown)
}

// noteError is a notepad refusal the model can act on.
func noteError(err error) string {
	var input *bots.InputError
	switch {
	case errors.As(err, &input):
		return input.Message
	case errors.Is(err, gorm.ErrRecordNotFound):
		return "This bot is gone"
	}
	return "The notepad could not be saved"
}

// gateAsk answers a tick's gate.ask: the bot gate decides from the Bot's
// mode, its sites and the tick's taint; an allowed browser call takes the
// browser lease or is refused "browser busy"; a step that needs approval is
// answered "approve" and parked as a card on the Bot thread (not in a dry
// run), and the tick goes on.
func (a *BotAgent) gateAsk(t *botTick, m agenthost.Message) {
	var ask gateAsk
	_ = m.Decode(&ask)
	var wire struct {
		Bot struct {
			Tainted bool `json:"tainted"`
		} `json:"bot"`
	}
	_ = m.Decode(&wire)
	if wire.Bot.Tainted || len(ask.Tainted) > 0 {
		t.tainted = true
	}
	ask.RunKind = "bot"
	b := t.gate
	b.Tainted = t.tainted
	d, ok := decideHost(t.ctx, ask, hostState{uid: t.uid, tainted: t.tainted, bot: &b})
	if !ok {
		d = hostDecision{verdict: agent.BotBlock, message: agent.BotBlockUnknown, reason: agent.BotBlockUnknown}
	}
	d = gateBotBrowser(a.lease, t.uid, t.wireCheck, ask.Tool, d)
	if d.browserBusy {
		t.browserBusy = true
	}
	reply := map[string]any{"verdict": d.verdict, "message": d.message}
	switch d.verdict {
	case agent.BotAllow:
		if d.by != "" {
			reply["by"] = d.by
		}
		a.allowed(t, ask, d)
	case agent.BotApprove:
		reply["card"] = d.card.wire()
		t.parked++
		if !t.dryRun {
			a.park(t, ask, d.card)
		}
	}
	_ = t.worker.Reply(m, agenthost.TypeGateVerdict, reply)
}

// allowed remembers what an allow lets the timely web backend do next.
func (a *BotAgent) allowed(t *botTick, ask gateAsk, d hostDecision) {
	switch ask.Tool {
	case "web_search":
		t.searches++
		t.searchClean = !t.tainted
	case "web_extract":
		if d.by == "full" {
			t.fetchAny = true
		}
		var args map[string]any
		_ = json.Unmarshal(ask.Args, &args)
		for _, u := range botURLs(ask.Tool, args) {
			if h := agent.BotHost(u); h != "" {
				t.fetchable[h] = true
			}
		}
	}
}

// park writes the parked card of an approve verdict on the Bot thread. A
// card that cannot be written is logged: the worker has parked the step
// either way, so it never runs without the person.
func (a *BotAgent) park(t *botTick, ask gateAsk, card HostCard) {
	args := ask.Args
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	hash := ask.ArgsHash
	if hash == "" {
		hash = argsHashOf(args)
	}
	if len(args) > botArgsMax {
		// Too big to run again exactly: the card shows it, Run once cannot.
		args = nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	in := botCardIn{uid: t.uid, botID: t.botID, checkID: t.checkID, run: t.id, tool: clip(ask.Tool, 200), toolCallID: clip(ask.ToolCallID, 200),
		argsHash: clip(hash, 100), args: args, card: card, wait: a.e.parkFor(ctx, t.uid)}
	if err := a.e.s.parkBotCard(ctx, in); err != nil && !errors.Is(err, errUnchanged) {
		a.e.opts.Logf("agent engine: parking bot %s's step %s: %v", t.botID, ask.Tool, err)
	}
}

// argsHashOf is policy.args_hash: sha256 of the arguments' canonical JSON
// (keys sorted, no spaces, non-ASCII kept as UTF-8).
func argsHashOf(args json.RawMessage) string {
	var v any
	if json.Unmarshal(args, &v) != nil {
		return ""
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if enc.Encode(v) != nil {
		return ""
	}
	sum := sha256.Sum256(bytes.TrimRight(buf.Bytes(), "\n"))
	return hex.EncodeToString(sum[:])
}

// botCardIn is one parked step of a Bot.
type botCardIn struct {
	uid, botID, checkID, run, tool, toolCallID, argsHash string
	args                                                 json.RawMessage
	card                                                 HostCard
	wait                                                 time.Duration
}

// isBotCard reports whether row's card h is a Bot's parked step.
func isBotCard(row Conversation, h HostRequest) bool {
	return row.Kind == KindBotThread && strings.HasPrefix(h.Run, botRunPrefix)
}

// botCheckOf is the Check a bot run id names.
func botCheckOf(run string) string {
	check, _, _ := strings.Cut(strings.TrimPrefix(run, botRunPrefix), botContSep)
	return check
}

// botContinuationRun is the run id of the continuation of card h.
func botContinuationRun(h HostRequest) string {
	return botRunPrefix + botCheckOf(h.Run) + botContSep + h.RequestID
}

// threadFree is a Bot thread status a card may take over: nothing runs or
// waits on it.
func threadFree(status string) bool {
	switch status {
	case "", "idle", "stopped", "failed":
		return true
	}
	return false
}

// parkBotCard writes a Bot's step as a parked host card on its Bot thread
// (made when the Bot has none), in one transaction, with its requested event
// (which keeps the arguments the continuation runs) and one push. The same
// step already waiting is not asked twice; while the thread runs or waits on
// something else the step is not asked, and the thread says so.
func (s *Service) parkBotCard(ctx context.Context, in botCardIn) error {
	cid, err := s.botThread(ctx, in.uid, in.botID)
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), in.uid, cid, &row); err != nil {
			return err
		}
		h := row.HostRequest
		if row.Status == statusHostApproval && h.pending() && h.Tool == in.tool && h.ArgsHash == in.argsHash {
			return errUnchanged // the same step already waits
		}
		now := time.Now().UTC()
		card := in.card
		requestID := id("bcard_")
		detail := map[string]any{"bot_id": in.botID, "check_id": in.checkID}
		if in.args != nil {
			detail["args"] = in.args
		}
		if !threadFree(row.Status) || h.pending() {
			ev := hostEvent(in.uid, cid, in.run, in.toolCallID, requestID, in.tool, in.argsHash, eventDenied, "", "not asked: the bot thread was busy", nil, detail)
			if err := tx.Create(&ev).Error; err != nil {
				return err
			}
			row.Messages = append(row.Messages, notice(fmt.Sprintf("Not asked: %s. Something else waits here; the bot can ask again on a later run.", card.subject())))
			row.Revision++
			return tx.Save(&row).Error
		}
		expires := now.Add(in.wait)
		row.Status = statusHostApproval
		row.HostRequest = HostRequest{RequestID: requestID, Run: in.run, Phase: hostParked, Tool: in.tool, ToolCallID: in.toolCallID,
			ArgsHash: in.argsHash, Card: &card, AskedAt: &now, ExpiresAt: &expires}
		ev := hostEvent(in.uid, cid, in.run, in.toolCallID, requestID, in.tool, in.argsHash, eventRequested, "", card.Reason, nil, detail)
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		row.Revision++
		if err := notify(tx, &row, tr(row.Language, txtPushHost)); err != nil {
			return err
		}
		return tx.Save(&row).Error
	})
}

// errBotGone: the Bot no longer exists (deleted), so nothing of it parks.
var errBotGone = errors.New("the bot is gone")

// botThread is the Bot's thread (a conversation of kind bot_thread), made
// when the Bot has none.
func (s *Service) botThread(ctx context.Context, uid, botID string) (string, error) {
	find := func() (string, error) {
		var ids []string
		err := s.db.WithContext(ctx).Model(&Conversation{}).Where("user_id = ? AND kind = ? AND bot_id = ?", uid, KindBotThread, botID).
			Order("created_at").Limit(1).Pluck("id", &ids).Error
		if err != nil || len(ids) == 0 {
			return "", err
		}
		return ids[0], nil
	}
	if cid, err := find(); err != nil || cid != "" {
		return cid, err
	}
	var b []bots.Bot
	if err := s.db.WithContext(ctx).Select("id", "name").Where("id = ? AND user_id = ?", botID, uid).Limit(1).Find(&b).Error; err != nil {
		return "", err
	}
	if len(b) == 0 {
		return "", errBotGone
	}
	title := strings.TrimSpace(b[0].Name)
	if title == "" {
		title = "Bot"
	}
	bid := botID
	row := Conversation{ID: id("chat_"), UserID: uid, Title: clip(title, 200), Status: "idle", Phase: "plan", Kind: KindBotThread, BotID: &bid,
		Permission: string(agent.Supervised), Context: []ContextChip{}, Messages: []Message{}, Plan: []Step{}, Snapshots: []Snapshot{},
		Transcript: []WireMessage{}, HostGrants: HostGrants{}}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if res.Error != nil || res.RowsAffected == 0 {
			return res.Error // another writer made it first
		}
		return tx.Model(&bots.Bot{}).Where("id = ? AND user_id = ? AND (thread_id IS NULL OR thread_id = '')", botID, uid).
			Update("thread_id", row.ID).Error
	})
	if err != nil {
		return "", err
	}
	return find()
}

// ContinueBot runs the approved call of the parked Bot card h (Run once,
// answerBotCard), which left the thread cid running under lease. It returns
// at once; the continuation runs on its own.
func (e *WorkerEngine) ContinueBot(uid, cid string, h HostRequest, lease string) {
	e.mu.Lock()
	a := e.botAgent
	e.mu.Unlock()
	if a == nil {
		e.s.finishBotCard(context.Background(), uid, cid, h, botContinuationRun(h), lease, false, "The bots engine isn't running here, so this step did not run.")
		return
	}
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		a.continueCard(context.Background(), uid, cid, h, lease)
	}()
}

// continueCard is the continuation of card h: a bot.run of the Bot whose
// pre_approved call is exactly the card's (tool and arguments hash), run
// once. Its bot.run goes out only while the thread row still runs under the
// answer's lease, and the lease is renewed while it runs, so a Stop or
// Delete ends it. A browser call takes the browser lease first and does not
// run while a chat holds it. Its reports are saved as alerts on the card's
// Check through SaveContinuation, when it is set.
func (a *BotAgent) continueCard(ctx context.Context, uid, cid string, h HostRequest, lease string) {
	s := a.e.s
	runID := botContinuationRun(h)
	checkID := botCheckOf(h.Run)
	finish := func(ran bool, reply string) { s.finishBotCard(ctx, uid, cid, h, runID, lease, ran, reply) }
	var row Conversation
	if err := s.find(s.db.WithContext(ctx), uid, cid, &row); err != nil || row.BotID == nil {
		return // the thread is gone (Delete): nothing runs
	}
	var found []bots.Bot
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", *row.BotID, uid).Limit(1).Find(&found).Error; err != nil || len(found) == 0 {
		finish(false, "The bot is gone, so this step did not run.")
		return
	}
	b := found[0]
	if b.Engine != bots.EngineAgent || b.Status != bots.StatusActive {
		finish(false, "The bot is paused, so this step did not run.")
		return
	}
	args, err := s.botCardArgs(ctx, uid, cid, h.RequestID)
	if err != nil || args == nil {
		finish(false, "This step can't be run again exactly, so it did not run.")
		return
	}
	in := bots.RunInput{Bot: b, Prompt: continuationPrompt(b, h, args), Tools: b.Tools, Permission: b.Permission, UseMemory: b.UseMemory,
		Model: bots.ModelChoice{Provider: b.ModelProvider, Model: b.Model}, Deadline: time.Now().Add(botDeadline), CheckID: checkID}
	in.Tools.Egress = []string(b.Egress)
	spec, err := a.spec(ctx, uid, in)
	if err != nil {
		finish(false, "This step did not run: "+err.Error())
		return
	}
	spec.runID, spec.wireCheck = runID, checkID+botContSep+h.RequestID
	spec.thread, spec.lease = cid, lease
	spec.fields["pre_approved"] = map[string]any{"tool": h.Tool, "args_hash": h.ArgsHash}
	spec.fence = func() bool { return s.botRowHolds(ctx, uid, cid, runID, lease) }
	spec.renew = func() bool { return s.renewLease(ctx, uid, cid, lease) }
	// The approved call runs without a gate.ask, so a browser call takes the
	// browser lease here, as a tick's does at its gate. A chat holding it
	// wins, as it does over a tick: the step does not run and the card reads
	// Not run with "browser busy" (no strike; the next check may ask again).
	if browserClass(h.Tool) {
		if !a.lease.TryAcquireBot(uid, spec.wireCheck) {
			finish(false, continuationBusy)
			return
		}
		// forget lets it go once the run registered; this covers a run that
		// never did (no worker, a fence).
		defer a.lease.Release(uid, BotHolder(spec.wireCheck))
	}
	rctx, cancel := context.WithTimeout(ctx, botDeadline+botGrace)
	res, err := a.run(rctx, uid, spec)
	cancel()
	ran := false
	for _, tr := range res.Trace {
		if tr.Tool == h.Tool && tr.Outcome == "ok" {
			ran = true
		}
	}
	finish(ran, continuationReply(res, err))
	if err == nil && a.SaveContinuation != nil {
		if serr := a.SaveContinuation(ctx, uid, b.ID, checkID, res); serr != nil {
			a.e.opts.Logf("agent engine: saving bot %s's continuation on %s: %v", b.ID, checkID, serr)
		}
	}
}

// continuationBusy is the Bot thread's line for a browser step that did not
// run because a chat held the browser.
const continuationBusy = "Browser busy: a chat is using the browser, so this step did not run. The bot can ask again on its next check."

// continuationPrompt is what a continuation asks: exactly the approved call,
// then a report or [SILENT].
func continuationPrompt(b bots.Bot, h HostRequest, args json.RawMessage) string {
	return fmt.Sprintf("The person approved one step this bot asked for on an earlier run. Call %s once, with exactly these arguments, and nothing else first:\n%s\n\n"+
		"Then call bot_report if what it found is worth telling the person; otherwise reply [SILENT].\n\nThis bot's job, for context:\n%s",
		h.Tool, string(args), strings.TrimSpace(b.Prompt))
}

// continuationReply is the Bot thread's line for a continuation that ended.
func continuationReply(res bots.AgentResult, err error) string {
	switch {
	case errors.Is(err, errBotFenced):
		return ""
	case err != nil:
		return "This step did not finish: " + clip(err.Error(), 300)
	case res.ErrorClass != "":
		return "This step did not finish (" + res.ErrorClass + ")."
	case len(res.Reports) > 0:
		var titles []string
		for _, r := range res.Reports {
			titles = append(titles, firstNonEmpty(r.Title, clip(r.Body, 120)))
		}
		return "Reported: " + strings.Join(titles, "; ")
	case res.Silent:
		return "Done. Nothing to report."
	}
	return clip(strings.TrimSpace(res.Response), 2000)
}

// botRowHolds reports whether the thread row still runs the continuation
// runID under lease (no Stop, Delete or other answer took it).
func (s *Service) botRowHolds(ctx context.Context, uid, cid, runID, lease string) bool {
	var n int64
	err := s.db.WithContext(ctx).Model(&Conversation{}).
		Where("id = ? AND user_id = ? AND status = 'running' AND agent_run_id = ? AND lease = ?", cid, uid, runID, lease).Count(&n).Error
	return err == nil && n == 1
}

// botCardArgs are the arguments card requestID was asked with (its
// requested event), nil when none were kept.
func (s *Service) botCardArgs(ctx context.Context, uid, cid, requestID string) (json.RawMessage, error) {
	var rows []AgentHostEvent
	if err := s.db.WithContext(ctx).Where("user_id = ? AND conversation_id = ? AND request_id = ? AND kind = ?", uid, cid, requestID, eventRequested).
		Limit(1).Find(&rows).Error; err != nil || len(rows) == 0 {
		return nil, err
	}
	var detail struct {
		Args json.RawMessage `json:"args"`
	}
	if err := json.Unmarshal(rows[0].Detail, &detail); err != nil || len(detail.Args) == 0 || string(detail.Args) == "null" {
		return nil, err
	}
	// jsonb stores it spaced: the prompt shows it compact.
	var compact bytes.Buffer
	if err := json.Compact(&compact, detail.Args); err != nil {
		return nil, err
	}
	return compact.Bytes(), nil
}

// finishBotCard ends a continuation on its Bot thread: the approved card
// reads Ran or Not run (what the worker did decides, also after a Stop), and
// the row the continuation still holds under lease goes idle with reply.
func (s *Service) finishBotCard(ctx context.Context, uid, cid string, h HostRequest, runID, lease string, ran bool, reply string) {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		changed := false
		for i := range row.Messages {
			m := &row.Messages[i]
			if m.Kind == "host" && m.Host != nil && m.Host.RequestID == h.RequestID && m.Host.Outcome == hostApproved {
				settleHostCard(m, ran)
				changed = true
				if !ran {
					row.Messages = append(row.Messages, notRun(&row, h.Card, h.Tool))
				}
				break
			}
		}
		if row.Status == "running" && row.AgentRunID == runID && lease != "" && row.Lease == lease {
			row.Status = "idle"
			row.AgentRunID, row.AgentInstance = "", ""
			row.Lease, row.LeaseUntil = "", nil
			row.Activity = ChatActivity{}
			if reply = strings.TrimSpace(reply); reply != "" {
				m := message("assistant", reply)
				m.Engine, m.AgentRun = engineAgent, runID
				row.Messages = append(row.Messages, m)
			}
			changed = true
		}
		if !changed {
			return errUnchanged
		}
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil && !errors.Is(err, errUnchanged) && !errors.Is(err, gorm.ErrRecordNotFound) && !fenced(err) {
		log.Printf("agent engine: finishing a bot card's step: %v", err)
	}
}
