package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"maps"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/decide"
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

	mu     sync.Mutex
	runs   map[string]*agentRun // live runs this process follows, by run id
	chats  map[string]*agentRun // the same, by conversation id
	seeded map[string]bool      // conversations a worker finished a turn of since this process started
	// unsettled are conversations whose last agent run ended without its
	// turn saved (failed, stopped, lost): the worker's session may hold a
	// turn the chat doesn't, so the next run reseeds it.
	unsettled map[string]bool
	// forgetting are the deleted chats whose session.delete is in flight
	// (the waiting ones are rows of agent_session_forgets).
	forgetting map[string]bool
	// endedAsks keeps how each question's wait closed after its run ended
	// (endedAskKeepFor), so an answer whose ack was lost while the run used
	// it and finished is still settled (Closed).
	endedAsks map[string]endedAsk
	started   map[*agenthost.Worker]int64
	closing   bool
	wg        sync.WaitGroup

	// activityWrites counts activity checkpoints (tests check the throttle).
	activityWrites atomic.Int64
}

// endedAskKeepFor is how long Closed remembers a finished run's waits: past
// Answer's own limit and the person's request, short of a leak.
const endedAskKeepFor = time.Minute

// endedAsk is how one question's wait closed, for a run that has ended.
type endedAsk struct {
	outcome string
	at      time.Time
}

func endedAskKey(runID, requestID string) string { return runID + "\x00" + requestID }

// WorkerEngineOptions are what the engine needs from outside package chat.
type WorkerEngineOptions struct {
	// Model is run.start's model object for the provider and model a run
	// fixed at claim, with the account's own key (provider.AgentModelFor).
	// It goes on the worker's stdin and nowhere else. A Sensitive run asks
	// for the loopback gateway's Sensitive grant (ZDR, phase 4 decision 11).
	Model func(ctx context.Context, uid, provider, model string, opts RunModelOptions) (any, error)
	// Unsupported reports a Model error meaning the provider cannot drive
	// the agent engine (provider.ErrAgentEngineUnsupported: Claude Code or
	// Codex without the loopback gateway); the run then fails with "Use
	// classic for this chat".
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
	// Learning reads the account's learning switches (learning.Service.Prefs,
	// plan 9b.2); nil, or an error, leaves learning off for the run.
	Learning func(ctx context.Context, uid string) (LearningPrefs, error)
	// Fetch reads pages for the timely web backend's web_extract; nil is
	// NetguardFetcher. FixtureFetcher serves test pages.
	Fetch PageFetcher
	// ClarifyTimeout is how long a question card waits for the person
	// (run.start.clarify_timeout_s; 10 minutes, phase 4 decision 3).
	ClarifyTimeout time.Duration
}

// RunModelOptions say what kind of run a model is for.
type RunModelOptions struct {
	// Sensitive: a no-persist run of a Sensitive chat, whose model calls go
	// through the gateway's Sensitive grant (provider.AgentRunOptions).
	Sensitive bool
}

// LearningPrefs are the account's learning switches a run reads.
type LearningPrefs struct {
	// Learning is "Learn from my chats" (default on, Q-3.1); SearchHistory
	// "Search my past chats" (default on, Q-3.5).
	Learning, SearchHistory bool
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
	if opts.Fetch == nil {
		opts.Fetch = NetguardFetcher()
	}
	if opts.ClarifyTimeout <= 0 {
		opts.ClarifyTimeout = defaultClarifyTimeout
	}
	return &WorkerEngine{s: s, opts: opts, runs: map[string]*agentRun{}, chats: map[string]*agentRun{},
		seeded: map[string]bool{}, unsettled: map[string]bool{}, forgetting: map[string]bool{}, started: map[*agenthost.Worker]int64{}}
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
	// engineBusyAccount is the worker's cap on live runs per account: chats
	// waiting on a question card keep theirs for up to the card's time limit.
	engineBusyAccount = "The new engine is busy with other chats, which may be waiting for your answer. Answer or stop one of them, then try again."
	// childProposal answers a sub-task's propose_changes (phase 4).
	childProposal = "Only the main assistant proposes changes. Return what you found instead."
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

var slowTools = map[string]bool{"preview_bot": true, "ask_bot": true, "web_search": true, "web_extract": true}

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
	// noPersist is a Sensitive chat's no-persist run (phase 4 decision 9).
	noPersist bool

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
	// asking is a question card (clarify.request) the next flush writes.
	asking *ChatQuestion
	// closing are card closes (clarify.closed) whose save failed; the next
	// flush tries them again.
	closing []cardClose

	// Guarded by mu. closedAsks is how each question's wait ended in the
	// worker (clarify.closed, by request id); sentAnswers is what Answer
	// last sent for it. Together they settle an answer whose ack was lost:
	// the worker either took it (closed "submitted") or did not.
	closedAsks  map[string]string
	sentAnswers map[string]map[string]any
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
	if c.Sensitive && !e.s.sensitiveNoPersist {
		return errors.New("Sensitive chats use the classic engine")
	}
	if c.Phase != "plan" || holdsPhotos(c) {
		return errors.New("Photos and receipts use the classic engine")
	}
	if c.Provider != "" && e.opts.Model != nil {
		if _, err := e.opts.Model(ctx, uid, c.Provider, c.Model, RunModelOptions{Sensitive: c.Sensitive}); err != nil && e.opts.Unsupported(err) {
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
	// A Sensitive chat reaches Start only as a no-persist run (runEngine,
	// the test-only switch): nothing of it is stored in the worker's home,
	// and its tools keep its searches and titles away from Jev, as classic.
	noPersist := c.Sensitive
	if noPersist {
		ctx = decide.WithSensitive(ctx)
	}
	model, err := e.opts.Model(ctx, c.UserID, c.Provider, c.Model, RunModelOptions{Sensitive: c.Sensitive})
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
	if noPersist {
		runCtx = decide.WithSensitive(runCtx)
	}
	toolCtx, tools := e.s.newToolRun(runCtx, c)
	if language != "" {
		c.Language = language
	}
	setup := e.runSetup(ctx, c, tools, noPersist)
	if tools.web.on {
		// The timely web backend searches with the chat's own provider
		// (Q-3.8), as classic's web_search does.
		toolCtx = e.s.withRunCompleter(toolCtx, c)
	}
	block := timelyBlock(c, tools, e.opts.HostAllowed(c.UserID))
	if !noPersist {
		block += askHint
	}
	input := e.s.turnInput(ctx, c)
	r := &agentRun{id: id("run_"), uid: c.UserID, cid: c.ID, instance: e.instance(w), worker: w,
		ctx: toolCtx, cancel: cancel, tools: tools, live: nil, noPersist: noPersist}
	r.live = newLiveRun(r.id)
	r.queue.signal = make(chan struct{}, 1)
	// The row names the run before the worker hears of it, so Stop and
	// Delete always reach it. A restore's reseed is taken here: this run's
	// run.start carries it.
	restored := false
	if err := e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error {
		if language != "" {
			row.Language = language
		}
		row.AgentRunID, row.AgentInstance = r.id, r.instance
		restored, row.AgentReseed = row.AgentReseed, false
		row.Activity = ChatActivity{Run: r.id}
		row.RunReads = RunReads{Run: r.id}
		return nil
	}); err != nil {
		cancel()
		return err
	}
	r.conv, r.lease = *c, c.Lease
	tools.load(c, r.id)
	// The checkpoint read the row under the lock configure takes too: a
	// "Don't learn from this chat" saved while triage or a cold worker held
	// Start up reaches this run.start.
	e.narrowLearning(ctx, c, &setup, tools)
	if !e.follow(r) {
		if restored {
			e.unsettle(c.ID)
		}
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
		"toolsets":        setup.toolsets,
		"flags": map[string]any{"sensitive": c.Sensitive, "answer_only": tools.answerOnly, "web": tools.web.on,
			"rich_ui": c.RichUI, "from_bot": false, "learning_writes": setup.learningWrites, "search_history": setup.searchHistory,
			"no_persist": noPersist},
		// How long a question card waits (phase 4 decision 3).
		"clarify_timeout_s": int(e.opts.ClarifyTimeout / time.Second),
		// No Timely cap (Q-2.3): Hermes' own turn limit applies.
		"budgets":               map[string]any{},
		"permission":            c.Permission,
		"tainted_sources":       c.TaintedSources,
		"tainted_conversations": setup.taintedConversations,
		"search_exclude":        setup.searchExclude,
		"search_allow":          setup.searchAllow,
	}
	e.mu.Lock()
	seeded, unsettled := e.seeded[c.ID], e.unsettled[c.ID]
	delete(e.unsettled, c.ID)
	e.mu.Unlock()
	// state.db may lack the session (a new machine): the worker keeps a seed
	// only when it has no messages for it. After classic turns, a run whose
	// turn was not saved, or a restore (whose state.db holds the backup's
	// transcript, not the turns since), the seed replaces what it has.
	seed := historySeed(c.Messages)
	if noPersist {
		// The worker keeps nothing of a no-persist run: the whole
		// conversation goes with every turn (phase 4 decision 9).
		if seed == nil {
			seed = []map[string]string{}
		}
		fields["history"] = seed
	} else if reseed := unsettled || restored || classicSinceAgent(c.Messages); reseed {
		if seed == nil {
			seed = []map[string]string{}
		}
		fields["history"], fields["reseed"] = seed, true
	} else if !seeded && len(seed) > 0 {
		fields["history"] = seed
	}
	if err := w.Send(agenthost.TypeRunStart, fields); err != nil {
		if restored {
			e.unsettle(c.ID) // the next run reseeds instead
		}
		r.queue.push(runItem{end: "abandon"})
		e.clearRun(ctx, c)
		return unavailable(c, workerReason(err))
	}
	// A switch turned off between the checkpoint and the send: its own
	// learning.stop may have reached the worker before this run.start did,
	// so stop again now that the worker knows the run.
	if setup.learningWrites && e.s.stopLearning != nil {
		switch learning, search := e.learnsNow(ctx, c.UserID, c.ID, nil); {
		case !learning:
			go e.s.stopLearning(c.UserID, c.ID, false)
		case setup.searchHistory && !search:
			go e.s.stopLearning(c.UserID, c.ID, true)
		}
	}
	return nil
}

// clearRun takes a run that never started off the row.
func (e *WorkerEngine) clearRun(ctx context.Context, c *Conversation) {
	_ = e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error {
		closeQuestion(row, nil, outcomeStopped)
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

// errNotFollowing is a steer for a run this process does not follow, and
// the worker's refusal of a clarify.answer (the card no longer waits there).
var errNotFollowing = errors.New("the run is not live here")

// errRunElsewhere is an answer for a run this process does not follow (it
// ended, or another API process on the same tables runs it): no worker was
// asked, so the card may still wait.
var errRunElsewhere = errors.New("the run is not followed by this process")

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

// Answer implements AgentEngine: clarify.answer to the run that asked. The
// worker acks ok: false when that card no longer waits (timed out, stopped).
func (e *WorkerEngine) Answer(ctx context.Context, uid, cid, runID, requestID string, answers map[string]any, outcome string) error {
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	if r == nil || r.uid != uid || r.cid != cid {
		return errRunElsewhere
	}
	if answers == nil {
		answers = map[string]any{}
	}
	r.mu.Lock()
	prev, hadPrev := r.sentAnswers[requestID]
	if r.sentAnswers == nil {
		r.sentAnswers = map[string]map[string]any{}
	}
	r.sentAnswers[requestID] = answers
	r.mu.Unlock()
	refused := func() {
		r.mu.Lock()
		if hadPrev {
			r.sentAnswers[requestID] = prev
		} else {
			delete(r.sentAnswers, requestID)
		}
		r.mu.Unlock()
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	reply, err := r.worker.Request(ctx, agenthost.TypeClarifyAnswer, map[string]any{"run": runID, "request_id": requestID, "answers": answers, "outcome": outcome})
	if err != nil {
		var refusal *agenthost.ReplyError
		if errors.As(err, &refusal) {
			refused()
		}
		return err
	}
	var ack struct {
		OK bool `json:"ok"`
	}
	if err := reply.Decode(&ack); err != nil || !ack.OK {
		refused()
		return errNotFollowing
	}
	return nil
}

// Closed implements questionCloser: how the wait for requestID ended in the
// worker, once its clarify.closed was handled ("" before).
func (e *WorkerEngine) Closed(runID, requestID string) string {
	e.mu.Lock()
	r := e.runs[runID]
	ended := e.endedAsks[endedAskKey(runID, requestID)]
	e.mu.Unlock()
	if r == nil {
		return ended.outcome
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closedAsks[requestID]
}

// ask keeps a clarify.request's card for the next flush, which runs at once:
// the card is written in the follower's fenced save under the run's lease,
// with the activity and taint the run has so far, and one push.
func (e *WorkerEngine) ask(r *agentRun, ev workerEvent) {
	q, ok := askedQuestion(r.id, ev, time.Now(), e.opts.ClarifyTimeout)
	if !ok {
		e.opts.Logf("agent engine: run %s sent a clarify.request without a question", r.id)
		return
	}
	r.asking = &q
	e.flush(r)
}

// closeAsked handles clarify.closed: the wait ended in the worker (timed
// out, cancelled, or the answer Go already recorded). A card still on the
// row moves into the thread with that outcome; a card the answer or Stop
// already cleared leaves nothing to do.
func (e *WorkerEngine) closeAsked(r *agentRun, ev workerEvent) {
	requestID := ev.Payload.RequestID
	if r.asking != nil && r.asking.RequestID == requestID {
		// Closed before its card was written: the person never saw it.
		r.asking = nil
	}
	outcome := ev.Payload.Outcome
	switch outcome {
	case outcomeSubmitted, outcomeCancelled, outcomeTimedOut, outcomeUndelivered:
	default:
		outcome = outcomeCancelled
	}
	r.mu.Lock()
	stopped := !r.stopSent.IsZero()
	if requestID != "" {
		if r.closedAsks == nil {
			r.closedAsks = map[string]string{}
		}
		r.closedAsks[requestID] = outcome
	}
	sent := r.sentAnswers[requestID]
	if ev.Payload.Answers != nil {
		// The worker names the answers the run used. Two answers can race
		// (the first one's delivery lagged past Answer's limit and the card
		// came back), and only the worker knows which one it took.
		sent = ev.Payload.Answers
	}
	r.mu.Unlock()
	if outcome == outcomeCancelled && (stopped || e.isClosing()) {
		// The worker ends a wait the same way for a Stop and for the API's
		// shutdown as for a Skip; the person did not skip this one.
		outcome = outcomeStopped
	}
	e.closeCard(r, cardClose{requestID: requestID, outcome: outcome, answers: sent})
}

// cardClose is a card's close waiting to be saved: the worker's outcome and,
// for a submitted one, the answer it took.
type cardClose struct {
	requestID string
	outcome   string
	answers   map[string]any
}

// closeCard moves the card for c.requestID from the row into the thread. A
// save the database refuses (a blip) is kept in r.closing and tried again by
// the next flush: while the worker runs on, nothing else would close the
// card, and it would stay "Needs your answer" for a run that no longer waits.
func (e *WorkerEngine) closeCard(r *agentRun, c cardClose) {
	err := e.save(r, func(tx *gorm.DB, row *Conversation) error {
		if c.requestID != "" && row.Question.RequestID != c.requestID && c.outcome == outcomeSubmitted {
			// The card is gone: an answer already closed it. The worker names
			// the answer it took; the thread shows that one.
			if !keepWorkersAnswer(row, c) {
				return errUnchanged
			}
			return nil
		}
		if c.requestID == "" || row.Question.RequestID != c.requestID {
			return errUnchanged
		}
		// A card put back after an answer whose ack was lost still shows,
		// and the worker did take that answer: it closes with it.
		var answers map[string]any
		if c.outcome == outcomeSubmitted {
			answers = c.answers
		}
		closeQuestion(row, answers, c.outcome)
		return nil
	})
	if err != nil && !fenced(err) && !errors.Is(err, errUnchanged) {
		e.opts.Logf("agent engine: closing run %s's question: %v", r.id, err)
		r.closing = append(r.closing, c)
	}
}

// keepWorkersAnswer makes the thread's message for c.requestID show the
// answers the worker took (outcome submitted), when it shows others: the
// person answered twice, the first answer reached the worker after the second
// committed, so the second is undelivered (or still submitted, if its
// refusal is not handled yet) although the run used the first. false when
// there is nothing to change.
func keepWorkersAnswer(row *Conversation, c cardClose) bool {
	if c.answers == nil {
		return false
	}
	i := slices.IndexFunc(row.Messages, func(m Message) bool {
		return m.Kind == "question" && m.Question != nil && m.Question.RequestID == c.requestID
	})
	if i < 0 {
		return false
	}
	q := row.Messages[i].Question
	if q.Outcome == outcomeSubmitted && reflect.DeepEqual(jsonRoundTrip(q.Answers), jsonRoundTrip(c.answers)) {
		return false
	}
	q.Outcome, q.Answers = outcomeSubmitted, c.answers
	row.Messages[i].Content = questionText(q.Questions, q.Answers, outcomeSubmitted)
	return true
}

// jsonRoundTrip normalizes an answers map to what the row stores, so a
// []string from Go and a []any from the worker compare equal.
func jsonRoundTrip(v map[string]any) any {
	b, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

// retryCloses saves the card closes that failed before.
func (e *WorkerEngine) retryCloses(r *agentRun) {
	pending := r.closing
	r.closing = nil
	for _, c := range pending {
		e.closeCard(r, c)
	}
}

// unsaved is whether the follower holds something a save refused or has not
// written yet: activity, a card, or a card's close.
func (r *agentRun) unsaved() bool {
	return r.dirty || r.asking != nil || len(r.closing) > 0
}

// errUnchanged rolls back a follower save that has nothing to write.
var errUnchanged = errors.New("nothing to save")

// Forget implements AgentEngine (after Delete): session.delete in the
// account's worker, once the chat's run is over. The request waits in
// agent_session_forgets until it is done. With no worker running (an idle
// account, or one back on Classic) agent-forget does it on the home at once
// (review round 8): the desktop folder backup copies the home raw, so the
// chat must not wait there for the account's next agent run.
func (e *WorkerEngine) Forget(uid, cid string) {
	e.mu.Lock()
	delete(e.seeded, cid)
	delete(e.unsettled, cid)
	_, live := e.chats[cid]
	e.mu.Unlock()
	row := AgentSessionForget{UserID: uid, ConversationID: cid, CreatedAt: time.Now().UTC()}
	if err := e.s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		e.opts.Logf("agent engine: keeping a session delete: %v", err)
	}
	if live || e.sup == nil {
		return // the follower sends it when the run ends
	}
	if w, ok := e.sup.Worker(uid); ok {
		e.sendForgets(w, uid, "")
		return
	}
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		e.forgetIdle(ctx, uid)
	}()
}

// forgetIdle delivers uid's waiting session deletes: to its worker when one
// runs, else with agent-forget on the home. A row goes once it is done; a
// failure leaves it for the next try (the next Forget, run, API start or
// shutdown).
func (e *WorkerEngine) forgetIdle(ctx context.Context, uid string) {
	if e.sup == nil {
		return
	}
	if w, ok := e.sup.Worker(uid); ok {
		e.sendForgets(w, uid, "")
		return
	}
	var rows []AgentSessionForget
	if err := e.s.db.WithContext(ctx).Where("user_id = ?", uid).Find(&rows).Error; err != nil {
		e.opts.Logf("agent engine: session deletes: %v", err)
		return
	}
	e.mu.Lock()
	var cids []string
	for _, row := range rows {
		cid := row.ConversationID
		if e.chats[cid] == nil && !e.forgetting[cid] {
			cids = append(cids, cid)
			e.forgetting[cid] = true
		}
	}
	e.mu.Unlock()
	if len(cids) == 0 {
		return
	}
	defer func() {
		e.mu.Lock()
		for _, cid := range cids {
			delete(e.forgetting, cid)
		}
		e.mu.Unlock()
	}()
	if _, err := e.sup.ForgetSessions(ctx, uid, cids); err != nil {
		e.opts.Logf("agent engine: agent-forget: %v", err)
		return
	}
	if err := e.s.db.WithContext(ctx).Where("user_id = ? AND conversation_id IN ?", uid, cids).Delete(&AgentSessionForget{}).Error; err != nil {
		e.opts.Logf("agent engine: session delete done: %v", err)
	}
}

// DrainForgets delivers every account's waiting session deletes (API start,
// and Shutdown once the workers stopped), so a desktop "Back up now" or the
// pre-upgrade copy, which stop the API first, never finds a deleted chat in
// a home.
func (e *WorkerEngine) DrainForgets(ctx context.Context) {
	if e.sup == nil {
		return
	}
	var uids []string
	if err := e.s.db.WithContext(ctx).Model(&AgentSessionForget{}).Distinct("user_id").Pluck("user_id", &uids).Error; err != nil {
		e.opts.Logf("agent engine: session deletes: %v", err)
		return
	}
	for _, uid := range uids {
		if ctx.Err() != nil {
			return
		}
		e.forgetIdle(ctx, uid)
	}
}

// sendForgets sends the account's waiting session.deletes, except for keep
// and chats with a live run; each row goes once the worker answers.
func (e *WorkerEngine) sendForgets(w *agenthost.Worker, uid, keep string) {
	var rows []AgentSessionForget
	if err := e.s.db.Where("user_id = ?", uid).Find(&rows).Error; err != nil {
		e.opts.Logf("agent engine: session deletes: %v", err)
		return
	}
	e.mu.Lock()
	var cids []string
	for _, row := range rows {
		cid := row.ConversationID
		if cid != keep && e.chats[cid] == nil && !e.forgetting[cid] {
			cids = append(cids, cid)
			e.forgetting[cid] = true
		}
	}
	e.mu.Unlock()
	for _, cid := range cids {
		go func(cid string) {
			defer func() {
				e.mu.Lock()
				delete(e.forgetting, cid)
				e.mu.Unlock()
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			// An ack, ok or not (no such session), settles it; an error
			// (busy, a worker gone) leaves the row for the next try.
			if _, err := w.Request(ctx, "session.delete", map[string]any{"conversation_id": cid}); err != nil {
				e.opts.Logf("agent engine: session.delete: %v", err)
				return
			}
			if err := e.s.db.Where("user_id = ? AND conversation_id = ?", uid, cid).Delete(&AgentSessionForget{}).Error; err != nil {
				e.opts.Logf("agent engine: session delete done: %v", err)
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
	if err == nil {
		// The workers are gone: what still waits goes through agent-forget.
		e.DrainForgets(ctx)
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
	// arm flushes what is unsaved at the activity throttle: now when the
	// last flush is old enough (and then once more if that one failed), else
	// by the timer.
	arm := func() {
		if !r.unsaved() || flushC != nil {
			return
		}
		wait := e.opts.ActivityEvery - time.Since(r.lastFlush)
		if wait <= 0 {
			e.flush(r)
			if !r.unsaved() {
				return
			}
			wait = e.opts.ActivityEvery
		}
		flushTimer = time.NewTimer(wait)
		flushC = flushTimer.C
	}
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
			arm()
		case <-flushC:
			flushC = nil
			if r.unsaved() {
				e.flush(r)
			}
			// A flush the database refused leaves its work behind, and the
			// worker may send nothing more (it waits on a card): try again
			// by the clock, not by the next message.
			arm()
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
	r.mu.Lock()
	closed := maps.Clone(r.closedAsks)
	r.mu.Unlock()
	e.mu.Lock()
	// The waits' outcomes outlive the run, before it leaves e.runs, so Closed
	// finds them either way.
	now := time.Now()
	for k, v := range e.endedAsks {
		if now.Sub(v.at) > endedAskKeepFor {
			delete(e.endedAsks, k)
		}
	}
	for requestID, outcome := range closed {
		if e.endedAsks == nil {
			e.endedAsks = map[string]endedAsk{}
		}
		e.endedAsks[endedAskKey(r.id, requestID)] = endedAsk{outcome: outcome, at: now}
	}
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
	e.retryCloses(r)
	r.dirty = false
	r.lastFlush = time.Now()
	taint := r.taint
	r.taint = nil
	asking := r.asking
	activity := r.live.activity()
	e.activityWrites.Add(1)
	err := e.saveTaint(r, taint, func(tx *gorm.DB, row *Conversation) error {
		row.Activity = activity
		r.tools.save(row, r.id)
		mergeTaint(row, taint)
		if asking != nil && row.Question.RequestID != asking.RequestID {
			// The question card (Ask): one push per question.
			row.Question = *asking
			return notify(tx, row, tr(row.Language, txtPushQuestion))
		}
		return nil
	})
	if err == nil || fenced(err) {
		if r.asking == asking {
			r.asking = nil
		}
	} else {
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
	e.s.live.Publish(r.uid, WatchKey, realtime.Event{Type: "delta", Kind: "chat", ID: r.cid, Document: d})
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
		if line, ok := outputRisk(r.id, ev); ok {
			e.opts.Logf("%s", line)
		}
		switch ev.Kind {
		case "clarify.request":
			e.ask(r, ev)
		case "clarify.closed":
			e.closeAsked(r, ev)
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
		if m.Decode(&body) != nil {
			return false
		}
		if len(body.Sources) > 0 {
			r.taint = append(r.taint, body.Sources...)
			r.dirty = true
		}
	case agenthost.TypeToolCall:
		e.toolCall(r, m)
	case agenthost.TypeGateAsk:
		e.gate(r, m)
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
		if body.Code == "busy" && strings.Contains(body.Message, "the account already has") {
			e.refused(r, engineBusyAccount, ActionRetry)
		} else if body.Code == "busy" {
			e.refused(r, engineBusy, ActionRetry)
		} else {
			e.refused(r, fmt.Sprintf(tr(r.conv.Language, txtAgentUnavailable), strings.TrimRight(body.Message, ".")), ActionUseClassic)
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
		// Subagent is the sub-task's session id when a child of the run
		// made the call (delegate_task, phase 4).
		Subagent string `json:"subagent"`
	}
	if err := m.Decode(&call); err != nil {
		_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]string{"error": "Unreadable tool call"}, "outside": false, "end_turn": false})
		return
	}
	r.noteTaint(call.Tainted)
	if call.Batch < 1 {
		call.Batch = 1
	}
	args := call.Args
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	c := r.conv
	if call.Name == "propose_changes" && call.Subagent != "" {
		// Children read, never propose (decision 6); the worker's gate
		// blocks this first.
		_ = r.worker.Reply(m, agenthost.TypeToolResult, map[string]any{"result": map[string]string{"error": childProposal}, "outside": false, "end_turn": false})
		return
	}
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
	// A page or search the timely web backend read is the chat's taint
	// whatever the worker reports.
	r.noteTaint(r.tools.web.takeTaint())
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
	// A turn Hermes could not finish carries its own advice as the final
	// response ("start a clean session with /new", "run `hermes doctor`"):
	// that is never the reply. The turn fails with the error, or, with a
	// recorded proposal, finishes on the proposal alone.
	// (A partial turn, such as one that ran out of iterations, reports its
	// own closing text as the error too: that text stays the reply.)
	failedTurn := !d.Completed && !d.Interrupted && d.Error != "" && strings.TrimSpace(d.Error) != final
	if failedTurn {
		final = ""
	}
	switch {
	case d.Interrupted && !endTurn && e.isClosing():
		e.fail(r, tr(r.conv.Language, txtAgentLost), ActionRetry)
	case d.Interrupted && !endTurn:
		e.stopped(r)
	case r.pending == nil && final == "" && d.Error != "":
		text, action := failedTurnText(d.Error)
		e.fail(r, text, action)
	case r.pending == nil && final == "":
		e.fail(r, emptyAnswer, ActionRetry)
	default:
		if len(r.taint) > 0 {
			// The proposal decision reads the chat's tainted_sources: a
			// flush that did not commit must not let it decide without them.
			e.flush(r)
			if len(r.taint) > 0 {
				e.fail(r, runFailedUnsaved, ActionRetry)
				return
			}
		}
		r.mu.Lock()
		r.conv.Lease = r.lease
		r.mu.Unlock()
		err := e.s.finishTurn(context.Background(), &r.conv, final, r.pending, r.tools)
		if err != nil {
			e.unsettle(r.cid) // a Stop or Delete got there first, or the save failed
		}
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

// transportPrefix is the "HTTP 424: " Hermes puts in front of a gateway
// error's message (its status code); it is not for the person.
var transportPrefix = regexp.MustCompile(`^HTTP \d{3}:\s*`)

// failedTurnText words a failed turn's error for the person. The gateway
// passes a provider's own message on (Timely's wording for a CLI that is not
// connected or a key that is refused, which names Settings), so an error that
// names Settings sends the person there; any other offers Try again.
func failedTurnText(err string) (string, string) {
	text := strings.TrimSpace(transportPrefix.ReplaceAllString(strings.TrimSpace(err), ""))
	if strings.Contains(text, "Settings") {
		return text, ActionSettings
	}
	return text, ActionRetry
}

// stopped ends a run the worker interrupted while Timely still had it
// running (a Stop the row already shows fails the fence: nothing to add).
func (e *WorkerEngine) stopped(r *agentRun) {
	e.unsettle(r.cid)
	e.keepRunTaint(r)
	taint := r.taint
	_ = e.saveTaint(r, taint, func(tx *gorm.DB, row *Conversation) error {
		mergeTaint(row, taint)
		endRun(row, r.tools)
		row.Status = "stopped"
		row.Messages = append(row.Messages, notice(tr(row.Language, txtStopped)))
		markStopped(row, len(row.Messages)-1, r.id)
		return nil
	})
}

// keepRunTaint saves a run's taint, the worker's reports and Go's own
// outside reads, ahead of the fenced save that ends it: a fence or a failed
// write there must not lose it, since the worker's session keeps the text.
func (e *WorkerEngine) keepRunTaint(r *agentRun) {
	taint := append(append([]TaintSource{}, r.taint...), r.tools.bots.taint()...)
	if len(taint) == 0 {
		return
	}
	if err := e.s.keepTaint(context.Background(), r.uid, r.cid, taint); err != nil && !fenced(err) {
		e.opts.Logf("agent engine: keeping run %s taint: %v", r.id, err)
	}
}

// unsettle marks a chat whose last agent run's turn was not saved.
func (e *WorkerEngine) unsettle(cid string) {
	e.mu.Lock()
	e.unsettled[cid] = true
	e.mu.Unlock()
}

// fail ends a run with an error the person can act on. A run the worker
// ran (not one it refused) leaves a "This reply failed" notice that carries
// the run, as Stop's notice does: what the run learned before it failed (its
// chip or Keep / Discard card) stays under it, not under a later reply.
func (e *WorkerEngine) fail(r *agentRun, text, action string) {
	e.failWith(r, text, action, true)
}

// refused ends a run the worker never started (busy, unavailable): it
// learned nothing, so no notice marks it.
func (e *WorkerEngine) refused(r *agentRun, text, action string) {
	e.failWith(r, text, action, false)
}

func (e *WorkerEngine) failWith(r *agentRun, text, action string, ran bool) {
	e.unsettle(r.cid)
	e.keepRunTaint(r)
	taint := r.taint
	msg := utils.StorableText(text, maxRunErrorBytes)
	_ = e.saveTaint(r, taint, func(tx *gorm.DB, row *Conversation) error {
		mergeTaint(row, taint)
		endRun(row, r.tools)
		row.Status = "failed"
		row.Error = msg
		row.ErrorAction = action
		if ran {
			row.Messages = append(row.Messages, notice(tr(row.Language, txtRunFailed)))
			markStopped(row, len(row.Messages)-1, r.id)
		}
		return notify(tx, row, tr(row.Language, txtPushAttention))
	})
}
