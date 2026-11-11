package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/realtime"
	"timely-api/internal/utils"
)

// WorkerEngine is the agent engine (ADR 0026, plan 3.4 and 5.4): chat turns
// run in the account's Hermes worker, which agenthost supervises. Go keeps
// the record (agent_conversations) and every decision about Timely data: the
// worker's model reads Timely through tool.call (toolCall, the code classic
// uses) and changes it only by recording one propose_changes, which this
// engine holds or applies after run.done with the same checkpoint classic
// uses (finishTurn, ADR 0007, Q-2.4).
//
// One follower goroutine per live run takes that run's worker messages in
// order (the supervisor's Handler hands them over one at a time per worker,
// Handle routes them by run): it streams reply deltas to /chats/watch at
// once, writes the run's activity at most once a second, answers tool calls,
// renews the lease, and ends the turn. A fenced checkpoint that fails (Stop,
// Delete, a lease another lane took) sends run.stop. There is no turn or time
// cap of Timely's own (Q-2.3): Stop ends a run.
type WorkerEngine struct {
	s    *Service
	opts WorkerEngineOptions
	sup  *agenthost.Supervisor

	mu      sync.Mutex
	runs    map[string]*agentRun // live runs this process follows, by run id
	chats   map[string]*agentRun // the same, by conversation id
	seeded  map[string]bool      // conversations a worker finished a turn of since this process started
	forget  map[string]map[string]bool
	started map[*agenthost.Worker]int64
	closing bool
	wg      sync.WaitGroup

	// activityWrites counts activity checkpoints (tests check the throttle).
	activityWrites atomic.Int64
}

// WorkerEngineOptions are what the engine needs from outside package chat.
type WorkerEngineOptions struct {
	// Model is run.start's model object for the provider and model a run
	// fixed at claim, with the account's own key (provider.AgentModel). It
	// goes on the worker's stdin and nowhere else.
	Model func(ctx context.Context, uid, provider, model string) (any, error)
	// Unsupported reports a Model error meaning the provider cannot drive
	// the agent engine yet (provider.ErrAgentEngineUnsupported: Claude Code,
	// Codex); the run then fails with "Use classic for this chat".
	Unsupported func(error) bool
	// HostAllowed reports the account the host allows on its computer
	// (agenthost.HostAccounts), whose Timely block drops the scope line
	// (Q-2.1).
	HostAllowed func(uid string) bool
	// ActivityEvery is the activity throttle (1 s, plan 5.4); RenewEvery how
	// often a live run's lease is renewed (20 s; the lease lasts 3 minutes).
	ActivityEvery time.Duration
	RenewEvery    time.Duration
	Logf          func(format string, args ...any)
}

// NewWorkerEngine makes the engine for s. Wire its Handle and WorkerExited
// into the supervisor's Config, then Attach the supervisor.
func NewWorkerEngine(s *Service, opts WorkerEngineOptions) *WorkerEngine {
	if opts.ActivityEvery <= 0 {
		opts.ActivityEvery = time.Second
	}
	if opts.RenewEvery <= 0 {
		opts.RenewEvery = 20 * time.Second
	}
	if opts.Logf == nil {
		opts.Logf = log.Printf
	}
	if opts.HostAllowed == nil {
		opts.HostAllowed = func(string) bool { return false }
	}
	if opts.Unsupported == nil {
		opts.Unsupported = func(error) bool { return false }
	}
	return &WorkerEngine{s: s, opts: opts, runs: map[string]*agentRun{}, chats: map[string]*agentRun{},
		seeded: map[string]bool{}, forget: map[string]map[string]bool{}, started: map[*agenthost.Worker]int64{}}
}

// Attach gives the engine its supervisor (built with Handle and
// WorkerExited in its Config).
func (e *WorkerEngine) Attach(sup *agenthost.Supervisor) { e.sup = sup }

// Messages to the model and the person.
const (
	// proposalRecorded answers a recorded propose_changes (plan 3.4 step 8).
	proposalRecorded = "Proposal recorded; reply to the person in one sentence."
	// gateBlocked is phase 2's verdict for every tool outside the worker's
	// local allow list and the timely toolset (PROTOCOL.md section 9.7).
	gateBlocked = "That isn't available in Timely yet"
	// toolTimedOut is a Timely tool that did not answer in time.
	toolTimedOut = "Timely did not answer in time. Try a narrower request, or answer without this tool"
	// proposalTwice answers a second proposal in one turn; the worker's gate
	// blocks it after end_turn, so this is a second line.
	proposalTwice = "A proposal is already recorded for this turn. Reply to the person in one sentence."
	engineBusy    = "The new engine is still busy with another reply in this chat. Try again in a moment."
	emptyAnswer   = "AI returned an empty answer; try again"
)

// How long a Timely tool may take before the worker gets an error result.
// The worker waits 180 s for a tool.call (a tool, not a hook); the slow reads
// fetch pages.
const (
	toolBudget     = 25 * time.Second
	slowToolBudget = 170 * time.Second
	// stopWait is how long a run that was sent run.stop may take to end
	// before the follower lets it go.
	stopWait = 30 * time.Second
)

var slowTools = map[string]bool{"preview_bot": true, "ask_bot": true}

// agentRun is one live run this process follows.
type agentRun struct {
	id, uid, cid string
	instance     string
	worker       *agenthost.Worker
	// ctx carries the run's zone and client for its tools (newToolRun); it
	// ends with the run.
	ctx    context.Context
	cancel context.CancelFunc
	tools  *toolRun
	live   *liveRun
	queue  runQueue
	// pending is the turn's recorded proposal, applied or held at run.done.
	pending *pendingProposal

	mu       sync.Mutex
	lease    string
	stopSent time.Time
	// draft is the reply streamed so far, for Stop (Draft) on another
	// goroutine; the follower owns live.
	draft atomic.Pointer[string]

	// Owned by the follower goroutine.
	conv      Conversation
	dirty     bool
	lastFlush time.Time
	taint     []TaintSource
}

// runItem is one thing a follower handles: a worker message, or the end of
// its worker ("lost") or of waiting for a stopped run ("abandon").
type runItem struct {
	msg agenthost.Message
	end string
}

// runQueue never blocks the supervisor's dispatcher.
type runQueue struct {
	mu     sync.Mutex
	items  []runItem
	signal chan struct{}
}

func (q *runQueue) push(it runItem) {
	q.mu.Lock()
	q.items = append(q.items, it)
	q.mu.Unlock()
	select {
	case q.signal <- struct{}{}:
	default:
	}
}

func (q *runQueue) pop() (runItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return runItem{}, false
	}
	it := q.items[0]
	q.items = q.items[1:]
	return it, true
}

// Available implements AgentEngine.
func (e *WorkerEngine) Available(ctx context.Context, uid string, c *Conversation) error {
	if e.sup == nil {
		return errNoEngine
	}
	if err := e.sup.Available(); err != nil {
		return err
	}
	if c == nil {
		return nil
	}
	if c.Sensitive {
		return errors.New("Sensitive chats use the classic engine")
	}
	if c.Phase != "plan" {
		return errors.New("Photos and receipts use the classic engine")
	}
	if c.Provider != "" && e.opts.Model != nil {
		if _, err := e.opts.Model(ctx, uid, c.Provider, c.Model); err != nil && e.opts.Unsupported(err) {
			return err
		}
	}
	return nil
}

// unavailable is a failure that offers "Use classic for this chat".
func unavailable(c *Conversation, reason string) error {
	return UseClassic(fmt.Sprintf(tr(c.Language, txtAgentUnavailable), strings.TrimRight(reason, ".")))
}

// Start implements AgentEngine: it builds the turn (plan 3.4 steps 3-5),
// records the run on the row, and sends run.start.
func (e *WorkerEngine) Start(ctx context.Context, c *Conversation) error {
	if e.sup == nil || e.opts.Model == nil {
		return unavailable(c, errNoEngine.Error())
	}
	model, err := e.opts.Model(ctx, c.UserID, c.Provider, c.Model)
	if err != nil {
		if e.opts.Unsupported(err) {
			return unavailable(c, err.Error())
		}
		return NeedsSettings(err.Error())
	}
	// Jev's similar-chat pointer and language run before the turn, as on
	// classic (plan 5.6); its tool narrowing does not: toolsets are fixed
	// per conversation.
	language := ""
	if len(latestTags(c)) == 0 {
		if tri, ok := e.s.triage(ctx, c); ok {
			if tri.similar != nil {
				return e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error {
					if tri.language != "" {
						row.Language = tri.language
					}
					m := message("assistant", tri.similar.Title)
					m.Kind, m.Chat = "similar", tri.similar
					row.Messages = append(row.Messages, m)
					row.Status = "choose"
					row.Transcript = []WireMessage{}
					return notify(tx, row, tr(row.Language, txtPushChoose))
				})
			}
			language = tri.language
		}
	}
	ensureCtx, cancelEnsure := context.WithTimeout(ctx, 2*time.Minute)
	w, err := e.sup.Ensure(ensureCtx, c.UserID)
	cancelEnsure()
	if err != nil {
		e.opts.Logf("agent engine: no worker for a run: %v", err)
		return unavailable(c, workerReason(err))
	}
	e.sendForgets(w, c.UserID, c.ID)

	runCtx, cancel := context.WithCancel(context.Background())
	toolCtx, tools := e.s.newToolRun(runCtx, c)
	if language != "" {
		c.Language = language
	}
	block := timelyBlock(c, tools, e.opts.HostAllowed(c.UserID))
	input := e.s.turnInput(ctx, c)
	r := &agentRun{id: id("run_"), uid: c.UserID, cid: c.ID, instance: e.instance(w), worker: w,
		ctx: toolCtx, cancel: cancel, tools: tools, live: nil}
	r.live = newLiveRun(r.id)
	r.queue.signal = make(chan struct{}, 1)
	// The row names the run before the worker hears of it, so Stop and
	// Delete always reach it.
	if err := e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error {
		if language != "" {
			row.Language = language
		}
		row.AgentRunID, row.AgentInstance = r.id, r.instance
		row.Activity = ChatActivity{Run: r.id}
		row.RunReads = RunReads{Run: r.id}
		return nil
	}); err != nil {
		cancel()
		return err
	}
	r.conv, r.lease = *c, c.Lease
	tools.load(c, r.id)
	if !e.follow(r) {
		cancel()
		e.clearRun(ctx, c)
		return unavailable(c, agenthost.ErrClosed.Error())
	}
	fields := map[string]any{
		"run":             r.id,
		"conversation_id": c.ID,
		"session_key":     sessionKey(c.UserID, c.ID),
		"user_message":    input,
		"system_text":     block,
		"system_hash":     blockHash(block),
		"model":           model,
		"toolsets":        chatToolsets,
		"flags": map[string]any{"sensitive": false, "answer_only": tools.answerOnly, "web": false,
			"rich_ui": c.RichUI, "from_bot": false, "learning_writes": false},
		// No Timely cap (Q-2.3): Hermes' own turn limit applies.
		"budgets":         map[string]any{},
		"permission":      c.Permission,
		"tainted_sources": c.TaintedSources,
	}
	e.mu.Lock()
	seeded := e.seeded[c.ID]
	e.mu.Unlock()
	if !seeded {
		// state.db may lack the session (a restore, a new machine): the
		// worker keeps a seed only when it has no messages for it.
		if seed := historySeed(c.Messages); len(seed) > 0 {
			fields["history"] = seed
		}
	}
	if err := w.Send(agenthost.TypeRunStart, fields); err != nil {
		r.queue.push(runItem{end: "abandon"})
		e.clearRun(ctx, c)
		return unavailable(c, workerReason(err))
	}
	return nil
}

// clearRun takes a run that never started off the row.
func (e *WorkerEngine) clearRun(ctx context.Context, c *Conversation) {
	_ = e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error {
		row.AgentRunID, row.AgentInstance = "", ""
		row.Activity = ChatActivity{}
		row.RunReads = RunReads{}
		return nil
	})
}

// workerReason is a sentence for a worker that could not start or take the
// run.
func workerReason(err error) string {
	var unavailable *agenthost.UnavailableError
	if errors.As(err, &unavailable) {
		return unavailable.Reason
	}
	var start *agenthost.StartError
	if errors.As(err, &start) {
		return "the agent could not start (" + start.Error() + ")"
	}
	return err.Error()
}

// instance names a worker process as agent_instance records it.
func (e *WorkerEngine) instance(w *agenthost.Worker) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	ms, ok := e.started[w]
	if !ok {
		ms = time.Now().UnixMilli()
		e.started[w] = ms
	}
	return fmt.Sprintf("%d:%d", w.PID(), ms)
}

// follow registers r and starts its follower; false while shutting down.
func (e *WorkerEngine) follow(r *agentRun) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closing {
		return false
	}
	if old := e.chats[r.cid]; old != nil {
		// A run this chat had is over for Timely (Stop, Retry): its late
		// messages go nowhere.
		delete(e.runs, old.id)
	}
	e.runs[r.id] = r
	e.chats[r.cid] = r
	e.wg.Add(1)
	go e.loop(r)
	return true
}

// Handle is the supervisor's Config.Handler: every worker message that is not
// the supervisor's own, in order, one at a time per worker.
func (e *WorkerEngine) Handle(w *agenthost.Worker, m agenthost.Message) {
	e.mu.Lock()
	r := e.runs[m.Run]
	e.mu.Unlock()
	if r != nil && r.worker == w {
		r.queue.push(runItem{msg: m})
		return
	}
	// A request for no run this process follows fails closed at once.
	switch m.Type {
	case agenthost.TypeToolCall:
		_ = w.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]string{"error": "This run has ended"}, "outside": false, "end_turn": true})
	case agenthost.TypeGateAsk:
		_ = w.Reply(m, agenthost.TypeGateVerdict, map[string]any{"verdict": "block", "message": gateBlocked})
	}
}

// WorkerExited is the supervisor's Config.OnExit: the dead worker's live
// runs fail with Try again (plan 5.4 lost-run rule).
func (e *WorkerEngine) WorkerExited(info agenthost.ExitInfo) {
	e.mu.Lock()
	var lost []*agentRun
	for _, r := range e.runs {
		if r.uid == info.Account && r.worker.PID() == info.PID {
			lost = append(lost, r)
		}
	}
	for w := range e.started {
		if w.Account() == info.Account && w.PID() == info.PID {
			delete(e.started, w)
		}
	}
	e.mu.Unlock()
	for _, r := range lost {
		r.queue.push(runItem{end: "lost"})
	}
}

// Lost implements AgentEngine: a claimed agent row whose lease expired.
func (e *WorkerEngine) Lost(ctx context.Context, c *Conversation) error {
	e.mu.Lock()
	r := e.runs[c.AgentRunID]
	e.mu.Unlock()
	if r != nil && r.cid == c.ID && r.instance == c.AgentInstance && !exited(r.worker) {
		// This process still follows the run: it keeps it under the new lease.
		r.mu.Lock()
		r.lease = c.Lease
		r.mu.Unlock()
		e.opts.Logf("agent engine: re-attached run %s after its lease expired", r.id)
		return nil
	}
	if r != nil {
		e.stopWorkerRun(r, "lost")
		r.queue.push(runItem{end: "abandon"})
	}
	e.clearRun(ctx, c)
	return errors.New(tr(c.Language, txtAgentLost))
}

func exited(w *agenthost.Worker) bool {
	select {
	case <-w.Done():
		return true
	default:
		return false
	}
}

// Stop implements AgentEngine (after Stop or Delete committed).
func (e *WorkerEngine) Stop(uid, cid, runID string) {
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	if r != nil && r.uid == uid && r.cid == cid {
		e.stopWorkerRun(r, "user")
	}
}

// Draft is the reply a live run of this process has streamed so far ("" when
// it follows no such run).
func (e *WorkerEngine) Draft(uid, cid, runID string) string {
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	if r == nil || r.uid != uid || r.cid != cid {
		return ""
	}
	if p := r.draft.Load(); p != nil {
		return *p
	}
	return ""
}

// stopWorkerRun sends run.stop once.
func (e *WorkerEngine) stopWorkerRun(r *agentRun, reason string) {
	r.mu.Lock()
	if !r.stopSent.IsZero() {
		r.mu.Unlock()
		return
	}
	r.stopSent = time.Now()
	r.mu.Unlock()
	if err := r.worker.Send(agenthost.TypeRunStop, map[string]any{"run": r.id, "reason": reason}); err != nil {
		e.opts.Logf("agent engine: run.stop %s: %v", r.id, err)
	}
}

// errNotFollowing is a steer for a run this process does not follow.
var errNotFollowing = errors.New("the run is not live here")

// Steer implements AgentEngine.
func (e *WorkerEngine) Steer(ctx context.Context, uid, cid, runID, text string) error {
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	if r == nil || r.uid != uid || r.cid != cid {
		return errNotFollowing
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	reply, err := r.worker.Request(ctx, agenthost.TypeRunSteer, map[string]any{"run": runID, "text": text})
	if err != nil {
		return err
	}
	var ack struct {
		OK bool `json:"ok"`
	}
	if err := reply.Decode(&ack); err != nil || !ack.OK {
		return errNotFollowing
	}
	return nil
}

// Forget implements AgentEngine (after Delete): session.delete in the
// account's worker, once the chat's run is over. With no worker running it
// waits for the account's next run in this process.
func (e *WorkerEngine) Forget(uid, cid string) {
	e.mu.Lock()
	delete(e.seeded, cid)
	if e.forget[uid] == nil {
		e.forget[uid] = map[string]bool{}
	}
	e.forget[uid][cid] = true
	_, live := e.chats[cid]
	e.mu.Unlock()
	if live || e.sup == nil {
		return // the follower sends it when the run ends
	}
	if w, ok := e.sup.Worker(uid); ok {
		e.sendForgets(w, uid, "")
	}
}

// sendForgets sends the account's waiting session.deletes, except for keep.
func (e *WorkerEngine) sendForgets(w *agenthost.Worker, uid, keep string) {
	e.mu.Lock()
	var cids []string
	for cid := range e.forget[uid] {
		if cid != keep && e.chats[cid] == nil {
			cids = append(cids, cid)
			delete(e.forget[uid], cid)
		}
	}
	e.mu.Unlock()
	for _, cid := range cids {
		go func(cid string) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if _, err := w.Request(ctx, "session.delete", map[string]any{"conversation_id": cid}); err != nil {
				e.opts.Logf("agent engine: session.delete: %v", err)
			}
		}(cid)
	}
}

// Shutdown stops the supervisor (the API is stopping): runs it interrupts
// fail with Try again before the database closes.
func (e *WorkerEngine) Shutdown(ctx context.Context) error {
	e.mu.Lock()
	e.closing = true
	e.mu.Unlock()
	var err error
	if e.sup != nil {
		err = e.sup.Shutdown(ctx)
	}
	done := make(chan struct{})
	go func() { e.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
	return err
}

func (e *WorkerEngine) isClosing() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.closing
}

// loop is a run's follower.
func (e *WorkerEngine) loop(r *agentRun) {
	defer e.wg.Done()
	renew := time.NewTicker(e.opts.RenewEvery)
	defer renew.Stop()
	var flushTimer *time.Timer
	var flushC <-chan time.Time
	defer func() {
		if flushTimer != nil {
			flushTimer.Stop()
		}
	}()
	for {
		select {
		case <-r.queue.signal:
			for {
				it, ok := r.queue.pop()
				if !ok {
					break
				}
				if e.step(r, it) {
					e.end(r)
					return
				}
			}
			if r.dirty && flushC == nil {
				if wait := e.opts.ActivityEvery - time.Since(r.lastFlush); wait <= 0 {
					e.flush(r)
				} else {
					flushTimer = time.NewTimer(wait)
					flushC = flushTimer.C
				}
			}
		case <-flushC:
			flushC = nil
			if r.dirty {
				e.flush(r)
			}
		case <-renew.C:
			r.mu.Lock()
			sent := r.stopSent
			r.mu.Unlock()
			if !sent.IsZero() && time.Since(sent) > stopWait {
				// The worker never ended the stopped run: let it go.
				e.end(r)
				return
			}
			e.renew(r)
		}
	}
}

// end forgets a finished run and sends what waited for it.
func (e *WorkerEngine) end(r *agentRun) {
	r.cancel()
	e.mu.Lock()
	if e.runs[r.id] == r {
		delete(e.runs, r.id)
	}
	if e.chats[r.cid] == r {
		delete(e.chats, r.cid)
	}
	e.mu.Unlock()
	if !exited(r.worker) {
		e.sendForgets(r.worker, r.uid, "")
	}
}

// save is a fenced checkpoint under the run's current lease. When the fence
// fails (Stop, Delete, a lease another lane took) the worker is told to stop.
func (e *WorkerEngine) save(r *agentRun, fn func(*gorm.DB, *Conversation) error) error {
	r.mu.Lock()
	r.conv.Lease = r.lease
	r.mu.Unlock()
	err := e.s.checkpoint(context.Background(), &r.conv, fn)
	if err != nil && fenced(err) {
		e.stopWorkerRun(r, "fenced")
	}
	return err
}

// saveTaint is save for a write that carries taint. A fenced save (Stop,
// Delete, a lease another lane took) still adds the taint: the worker's
// session holds the outside text whatever happens to the run, and
// tainted_sources only grows.
func (e *WorkerEngine) saveTaint(r *agentRun, taint []TaintSource, fn func(*gorm.DB, *Conversation) error) error {
	err := e.save(r, fn)
	if err != nil && fenced(err) && len(taint) > 0 {
		if kerr := e.s.keepTaint(context.Background(), r.uid, r.cid, taint); kerr != nil && !fenced(kerr) {
			e.opts.Logf("agent engine: keeping run %s taint: %v", r.id, kerr)
		}
	}
	return err
}

// fenced reports a checkpoint refused because the row is no longer this
// run's: stopped, deleted or claimed again.
func fenced(err error) bool {
	var notFound *echo.HTTPError
	return errors.Is(err, context.Canceled) || (errors.As(err, &notFound) && notFound.Code == 404)
}

// flush writes the run's activity, tool state and new taint: the throttled
// activity checkpoint.
func (e *WorkerEngine) flush(r *agentRun) {
	r.dirty = false
	r.lastFlush = time.Now()
	taint := r.taint
	r.taint = nil
	activity := r.live.activity()
	e.activityWrites.Add(1)
	err := e.saveTaint(r, taint, func(tx *gorm.DB, row *Conversation) error {
		row.Activity = activity
		r.tools.save(row, r.id)
		mergeTaint(row, taint)
		return nil
	})
	if err != nil && !fenced(err) {
		e.opts.Logf("agent engine: activity checkpoint: %v", err)
		r.taint = append(taint, r.taint...)
		r.dirty = true
	}
}

// renew keeps the lease while the worker runs the turn. A lease this run no
// longer holds stops it, unless the row still names it (a re-claim this
// process may adopt with Lost).
func (e *WorkerEngine) renew(r *agentRun) {
	r.mu.Lock()
	lease := r.lease
	r.mu.Unlock()
	if e.s.renewLease(context.Background(), r.uid, r.cid, lease) {
		return
	}
	var rows []Conversation
	if err := e.s.db.Select("id", "status", "agent_run_id").Where("id = ? AND user_id = ?", r.cid, r.uid).Limit(1).Find(&rows).Error; err != nil {
		return
	}
	if len(rows) == 0 || rows[0].Status != "running" || rows[0].AgentRunID != r.id {
		e.stopWorkerRun(r, "lease lost")
	}
}

// publish sends a streamed chunk to the person's /chats/watch streams.
func (e *WorkerEngine) publish(r *agentRun, d *liveDelta) {
	if e.s.live == nil {
		return
	}
	e.s.live.Publish(r.uid, watchKey, realtime.Event{Type: "delta", Kind: "chat", ID: r.cid, Document: d})
}

// step handles one item; true when the run is over.
func (e *WorkerEngine) step(r *agentRun, it runItem) bool {
	switch it.end {
	case "lost":
		e.fail(r, tr(r.conv.Language, txtAgentLost), ActionRetry)
		return true
	case "abandon":
		return true
	}
	m := it.msg
	switch m.Type {
	case "event":
		var ev workerEvent
		if m.Decode(&ev) != nil {
			return false
		}
		changed, delta := r.live.event(ev, time.Now().UTC())
		if delta != nil {
			text := r.live.draft.String()
			r.draft.Store(&text)
			e.publish(r, delta)
		}
		r.dirty = r.dirty || changed
	case "taint":
		var body struct {
			Sources []TaintSource `json:"sources"`
		}
		if m.Decode(&body) == nil && len(body.Sources) > 0 {
			r.taint = append(r.taint, body.Sources...)
			r.dirty = true
		}
	case agenthost.TypeToolCall:
		e.toolCall(r, m)
	case agenthost.TypeGateAsk:
		_ = r.worker.Reply(m, agenthost.TypeGateVerdict, map[string]any{"verdict": "block", "message": gateBlocked})
	case agenthost.TypeRunDone:
		e.done(r, m)
		return true
	case agenthost.TypeError:
		// The worker refused the run.start (agenthost hands over only that).
		var body struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = m.Decode(&body)
		if body.Code == "busy" {
			e.fail(r, engineBusy, ActionRetry)
		} else {
			e.fail(r, fmt.Sprintf(tr(r.conv.Language, txtAgentUnavailable), strings.TrimRight(body.Message, ".")), ActionUseClassic)
		}
		return true
	}
	return false
}

// toolCall answers one tool.call: a Timely read through toolCall, or the
// turn's propose_changes, which is checked and kept until run.done and ends
// the turn (end_turn, Q-2.4).
func (e *WorkerEngine) toolCall(r *agentRun, m agenthost.Message) {
	var call struct {
		Name     string          `json:"name"`
		Args     json.RawMessage `json:"args"`
		Batch    int             `json:"batch_size"`
		Siblings []string        `json:"sibling_tools"`
		Tainted  []TaintSource   `json:"tainted_sources"`
	}
	if err := m.Decode(&call); err != nil {
		_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]string{"error": "Unreadable tool call"}, "outside": false, "end_turn": false})
		return
	}
	if len(call.Tainted) > 0 {
		r.taint = append(r.taint, call.Tainted...)
		r.dirty = true
	}
	if call.Batch < 1 {
		call.Batch = 1
	}
	args := call.Args
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	c := r.conv
	if call.Name == "propose_changes" && !r.tools.answerOnly {
		if r.pending != nil {
			_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]string{"error": proposalTwice}, "outside": false, "end_turn": true})
			return
		}
		ctx, cancel := context.WithTimeout(r.ctx, slowToolBudget)
		pending, refusal := e.s.prepareAgentProposal(ctx, &c, r.tools, args, call.Batch)
		cancel()
		if pending == nil {
			_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": refusal, "outside": false, "end_turn": false})
			return
		}
		r.pending = pending
		_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]any{"recorded": true, "message": proposalRecorded}, "outside": false, "end_turn": true})
		return
	}
	budget := toolBudget
	if slowTools[call.Name] {
		budget = slowToolBudget
	}
	ctx, cancel := context.WithTimeout(r.ctx, budget)
	result, outside, err := e.s.toolCall(ctx, &c, r.tools, call.Name, args, call.Batch, call.Siblings)
	cancel()
	if err != nil {
		result, outside = raw(map[string]string{"error": toolTimedOut}), false
	}
	r.dirty = true // run_reads changed
	_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": result, "outside": outside, "end_turn": false})
}

// runDone is run.done's body (PROTOCOL.md section 5).
type runDone struct {
	Final       string         `json:"final_response"`
	Completed   bool           `json:"completed"`
	Interrupted bool           `json:"interrupted"`
	Reason      string         `json:"turn_exit_reason"`
	Error       string         `json:"error"`
	Tokens      map[string]int `json:"tokens"`
	Cost        *float64       `json:"estimated_cost_usd"`
	Tainted     []TaintSource  `json:"tainted_sources"`
	Seeded      bool           `json:"history_seeded"`
	// PendingSteer is what the person sent while the last reply streamed,
	// which no tool batch took in (Hermes' pending_steer).
	PendingSteer string `json:"pending_steer"`
}

// done ends the turn: the reply, or the recorded proposal held or applied
// (finishTurn, end-turn-then-apply, Q-2.4); a Stop's notice; or a failure.
func (e *WorkerEngine) done(r *agentRun, m agenthost.Message) {
	var d runDone
	_ = m.Decode(&d)
	if d.Completed || d.Seeded {
		// The worker's state.db holds the session now.
		e.mu.Lock()
		e.seeded[r.cid] = true
		e.mu.Unlock()
	}
	cost := "unknown"
	if d.Cost != nil {
		cost = fmt.Sprintf("$%.4f", *d.Cost)
	}
	e.opts.Logf("agent engine: run %s ended (%s): %d input, %d output tokens, cost %s", r.id, d.Reason, d.Tokens["input_tokens"], d.Tokens["output_tokens"], cost)
	r.taint = append(r.taint, d.Tainted...)
	final := strings.TrimSpace(d.Final)
	endTurn := d.Reason == "end_turn"
	switch {
	case d.Interrupted && !endTurn && e.isClosing():
		e.fail(r, tr(r.conv.Language, txtAgentLost), ActionRetry)
	case d.Interrupted && !endTurn:
		e.stopped(r)
	case r.pending == nil && final == "" && d.Error != "":
		e.fail(r, d.Error, ActionRetry)
	case r.pending == nil && final == "":
		e.fail(r, emptyAnswer, ActionRetry)
	default:
		if len(r.taint) > 0 {
			// The proposal decision reads the chat's tainted_sources.
			e.flush(r)
		}
		r.mu.Lock()
		r.conv.Lease = r.lease
		r.mu.Unlock()
		err := e.s.finishTurn(context.Background(), &r.conv, final, r.pending, r.tools)
		if err != nil && !fenced(err) {
			e.opts.Logf("agent engine: finishing run %s: %v", r.id, err)
			e.fail(r, runFailedUnsaved, ActionRetry)
		}
		if err == nil && strings.TrimSpace(d.PendingSteer) != "" {
			if err := e.s.leftoverSteer(context.Background(), r.uid, r.cid, d.PendingSteer); err != nil && !fenced(err) {
				e.opts.Logf("agent engine: run %s leftover steer: %v", r.id, err)
			}
		}
	}
}

// stopped ends a run the worker interrupted while Timely still had it
// running (a Stop the row already shows fails the fence: nothing to add).
func (e *WorkerEngine) stopped(r *agentRun) {
	taint := r.taint
	_ = e.saveTaint(r, taint, func(tx *gorm.DB, row *Conversation) error {
		mergeTaint(row, taint)
		endRun(row, r.tools)
		row.Status = "stopped"
		row.Messages = append(row.Messages, notice(tr(row.Language, txtStopped)))
		return nil
	})
}

// fail ends a run with an error the person can act on.
func (e *WorkerEngine) fail(r *agentRun, text, action string) {
	taint := r.taint
	msg := utils.StorableText(text, maxRunErrorBytes)
	_ = e.saveTaint(r, taint, func(tx *gorm.DB, row *Conversation) error {
		mergeTaint(row, taint)
		endRun(row, r.tools)
		row.Status = "failed"
		row.Error = msg
		row.ErrorAction = action
		return notify(tx, row, tr(row.Language, txtPushAttention))
	})
}
