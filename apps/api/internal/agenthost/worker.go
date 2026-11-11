package agenthost

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	// ErrWorkerExited fails requests and sends to a worker that has gone.
	ErrWorkerExited = errors.New("agent worker exited")
	// ErrWorkerStopping refuses new work on a worker that is shutting down.
	ErrWorkerStopping = errors.New("agent worker is stopping")
	// ErrLineTooLong refuses a message whose line would pass MaxLineBytes; the
	// worker would reject it without naming its run.
	ErrLineTooLong = errors.New("agent message is longer than the protocol line limit")
	// ErrRunLive refuses a run.start or bot.run for a run that is already live.
	ErrRunLive = errors.New("agent run is already live")
	// ErrUseSend refuses Request for run.start and bot.run: the worker echoes
	// the start's id on run.done, so a Request would take the run's end away
	// from Config.Handler. Send them.
	ErrUseSend = errors.New("agenthost: run.start and bot.run go through Send, not Request")
)

// startIDPrefix marks the ids Go gives the run.start and bot.run it sends
// without Request: a refusal answering that id ends the run (route).
const startIDPrefix = "start-"

// maxQueued caps messages waiting for the handler; a worker that floods Go
// past it is treated as broken.
const maxQueued = 10000

// stderrTailLines is how many stderr lines ExitInfo and StartError keep.
const stderrTailLines = 20

// ReplyError is an "error" reply to one of Go's requests.
type ReplyError struct {
	Type    string // the request type
	Code    string // the worker's error code (PROTOCOL.md "Errors")
	Message string
}

func (e *ReplyError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("agent worker refused %s (%s): %s", e.Type, e.Code, e.Message)
	}
	return fmt.Sprintf("agent worker refused %s: %s", e.Type, e.Message)
}

// ExitInfo describes a worker that has exited.
type ExitInfo struct {
	Account string
	PID     int
	// Reason is why the worker stopped: "shutdown", "idle", "evicted",
	// "removed", the health or protocol failure that killed it, or
	// "exited unexpectedly".
	Reason string
	// Crashed is true when the worker was not asked to stop (an unexpected
	// exit, a failed handshake or self-test, a missed heartbeat or a
	// protocol violation). Crashes count toward the restart policy.
	Crashed  bool
	ExitCode int
	Err      error
	// LiveRuns are the runs that had not finished; the caller fails them.
	LiveRuns []string
	Stderr   []string
}

// Worker is one running agent worker for one account. Its methods are safe
// for concurrent use.
type Worker struct {
	sup     *Supervisor
	account string
	dir     string
	home    string
	cmd     *exec.Cmd
	group   *procGroup
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	stderr  *logTail
	slot    bool

	writes   chan *writeReq // to writeLoop, the only goroutine that writes stdin
	nextID   atomic.Uint64
	lastSeen atomic.Int64
	pinging  atomic.Bool

	mu       sync.Mutex
	pending  map[string]chan Message
	runs     map[string]string // live run -> the id of the run.start or bot.run that began it
	holds    int
	busy     Busy
	lastUsed time.Time
	ready    *Ready
	// catalogVersion is the Timely tool catalog version sent in hello.
	catalogVersion string
	stopping       bool
	exited         bool
	lastErr        string
	reason         string
	crashed        bool
	exit           ExitInfo

	queue      *msgQueue
	dispatched chan struct{}
	done       chan struct{}
}

// Account is the account this worker serves.
func (w *Worker) Account() string { return w.account }

// Home is the worker's HERMES_HOME.
func (w *Worker) Home() string { return w.home }

// PID is the worker's process id.
func (w *Worker) PID() int { return w.cmd.Process.Pid }

// Ready is the worker's answer to hello (zero before the handshake).
func (w *Worker) Ready() Ready {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.ready == nil {
		return Ready{}
	}
	return *w.ready
}

// CatalogVersion is the Timely tool catalog version the worker was started
// with (hello.catalog_version; empty before the handshake).
func (w *Worker) CatalogVersion() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.catalogVersion
}

// Done closes when the worker has exited and its exit has been processed
// (slot freed, crash recorded, Config.OnExit returned).
func (w *Worker) Done() <-chan struct{} { return w.done }

// Exit describes how the worker ended; valid after Done closes.
func (w *Worker) Exit() ExitInfo {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.exit
}

// Request sends a request and waits for the reply with the same id. An
// "error" reply returns a *ReplyError. run.start and bot.run are refused
// with ErrUseSend.
func (w *Worker) Request(ctx context.Context, typ string, fields any) (Message, error) {
	if typ == TypeRunStart || typ == TypeBotRun {
		return Message{}, ErrUseSend
	}
	id := fmt.Sprintf("%s%d", goIDPrefix, w.nextID.Add(1))
	reply := make(chan Message, 1)
	w.mu.Lock()
	if w.exited {
		w.mu.Unlock()
		return Message{}, ErrWorkerExited
	}
	w.pending[id] = reply
	w.mu.Unlock()
	forget := func() {
		w.mu.Lock()
		if w.pending != nil {
			delete(w.pending, id)
		}
		w.mu.Unlock()
	}
	if err := w.writeCtx(ctx, typ, id, fields); err != nil {
		forget()
		return Message{}, err
	}
	select {
	case m, ok := <-reply:
		if !ok {
			return Message{}, ErrWorkerExited
		}
		if m.Type == TypeError {
			var body errorFields
			_ = m.Decode(&body)
			return m, &ReplyError{Type: typ, Code: body.Code, Message: body.Message}
		}
		return m, nil
	case <-ctx.Done():
		forget()
		return Message{}, ctx.Err()
	}
}

// Send sends a message that expects no reply with an id (run.start, run.stop,
// session.delete, ...). A run.start or bot.run with a "run" field marks that
// run live until run.done or bot.done arrives, or until the worker refuses
// that start. It gets an id of its own, so the refusal can be told apart from
// an error about another message that names the same run.
func (w *Worker) Send(typ string, fields any) error {
	id := ""
	if typ == TypeRunStart || typ == TypeBotRun {
		id = fmt.Sprintf("%s%d", startIDPrefix, w.nextID.Add(1))
	}
	return w.write(typ, id, fields)
}

// Reply answers a worker request (tool.result, gate.verdict) with its id.
func (w *Worker) Reply(req Message, typ string, fields any) error {
	if req.ID == "" {
		return fmt.Errorf("agenthost: %s is not a request", req.Type)
	}
	return w.write(typ, req.ID, fields)
}

// Hold keeps the worker from being reaped or evicted until release is called
// (for example while a host approval waits). release is idempotent.
func (w *Worker) Hold() (release func()) {
	w.mu.Lock()
	w.holds++
	w.lastUsed = time.Now()
	w.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			w.mu.Lock()
			w.holds--
			w.lastUsed = time.Now()
			w.mu.Unlock()
		})
	}
}

// Busy reports live runs, holds, or work the worker itself reports
// (learning passes, tracked children).
func (w *Worker) Busy() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.busyLocked()
}

func (w *Worker) busyLocked() bool {
	return len(w.runs) > 0 || w.holds > 0 || w.busy.any()
}

// LiveRuns lists the runs started and not yet done.
func (w *Worker) LiveRuns() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.liveRunsLocked()
}

func (w *Worker) liveRunsLocked() []string {
	out := make([]string, 0, len(w.runs))
	for run := range w.runs {
		out = append(out, run)
	}
	return out
}

func (w *Worker) lastError() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.lastErr
}

func (w *Worker) hasExited() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.exited
}

// idleSince returns when the worker last did anything, and false while it is
// busy, not yet ready, or stopping.
func (w *Worker) idleSince() (time.Time, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.ready == nil || w.stopping || w.busyLocked() {
		return time.Time{}, false
	}
	return w.lastUsed, true
}

// write sends one message, bounded by Config.WriteTimeout (Send, Reply and the
// supervisor's own pings and shutdown).
func (w *Worker) write(typ, id string, fields any) error {
	ctx, cancel := context.WithTimeout(context.Background(), w.sup.cfg.WriteTimeout)
	defer cancel()
	return w.writeCtx(ctx, typ, id, fields)
}

// writeReq is one line for writeLoop. state moves from writeQueued to
// writeStarted (writeLoop took it) or writeAbandoned (the caller gave up first,
// so it is never written).
type writeReq struct {
	line  []byte
	run   string
	state atomic.Int32
	done  chan error
}

const (
	writeQueued int32 = iota
	writeStarted
	writeAbandoned
)

// writeCtx hands the line to writeLoop and waits for the write, the worker's
// exit or ctx, whichever comes first. A worker that stops reading its stdin
// (a hung import, a wedged read loop) would otherwise block a pipe write
// forever: past HelloTimeout, past Shutdown, holding the worker's start.
func (w *Worker) writeCtx(ctx context.Context, typ, id string, fields any) error {
	line, err := encode(typ, id, w.account, fields)
	if err != nil {
		return err
	}
	// The worker refuses a longer line with an error that names neither id
	// nor run, so a run.start that big would stay live forever.
	if len(line)-1 > MaxLineBytes {
		return fmt.Errorf("%w: %s is %d bytes, the limit is %d", ErrLineTooLong, typ, len(line)-1, MaxLineBytes)
	}
	run := ""
	if typ == TypeRunStart || typ == TypeBotRun {
		run = runField(fields)
	}
	w.mu.Lock()
	switch {
	case w.exited:
		w.mu.Unlock()
		return ErrWorkerExited
	case w.stopping && !allowedWhileStopping[typ]:
		w.mu.Unlock()
		return ErrWorkerStopping
	}
	if run != "" {
		if _, live := w.runs[run]; live {
			w.mu.Unlock()
			return fmt.Errorf("%w: %s", ErrRunLive, run)
		}
		w.runs[run] = id
	}
	w.lastUsed = time.Now()
	w.mu.Unlock()

	req := &writeReq{line: line, run: run, done: make(chan error, 1)}
	abandon := func(err error) error {
		if req.state.CompareAndSwap(writeQueued, writeAbandoned) {
			if run != "" {
				w.endRun(run) // never written: the run never started
			}
			return err
		}
		if run == "" {
			// Being written: the caller gets its own deadline. writeLoop's
			// WriteTimeout still bounds the write (it fails the worker).
			return err
		}
		// A line that starts a run is being written: its caller's clock
		// began while the line waited behind an earlier write, but
		// writeLoop's own WriteTimeout clock began only when it took this
		// one. Wait for the write itself, so an error always means the run
		// never went live: either it was not written, or the worker failed
		// (writeLoop's timer fails it), taking the run with it
		// (ExitInfo.LiveRuns).
		select {
		case werr := <-req.done:
			return werr
		case <-w.done:
			return ErrWorkerExited
		}
	}
	select {
	case w.writes <- req:
	case <-ctx.Done():
		return abandon(ctx.Err())
	case <-w.done:
		return abandon(ErrWorkerExited)
	}
	select {
	case err := <-req.done:
		return err
	case <-ctx.Done():
		return abandon(ctx.Err())
	case <-w.done:
		return abandon(ErrWorkerExited)
	}
}

// writeLoop is the only goroutine that writes the worker's stdin, one line at
// a time in the order callers handed them over. A write that has not finished
// after Config.WriteTimeout means the worker stopped reading: it is failed,
// which kills its process group and so unblocks the write.
func (w *Worker) writeLoop() {
	var broken error
	for {
		var req *writeReq
		select {
		case req = <-w.writes:
		case <-w.done:
			return
		}
		if !req.state.CompareAndSwap(writeQueued, writeStarted) {
			continue // abandoned before its turn
		}
		if broken != nil {
			if req.run != "" {
				w.endRun(req.run)
			}
			req.done <- broken
			continue
		}
		timer := time.AfterFunc(w.sup.cfg.WriteTimeout, func() {
			w.fail(fmt.Sprintf("%v: the worker has not read a %d-byte message for %s",
				ErrProtocol, len(req.line), w.sup.cfg.WriteTimeout))
		})
		_, err := w.stdin.Write(req.line)
		timer.Stop()
		if err != nil {
			broken = fmt.Errorf("%w: %v", ErrWorkerExited, err)
			if req.run != "" {
				w.endRun(req.run)
			}
			req.done <- broken
			continue
		}
		req.done <- nil
	}
}

// refusesStart reports whether error m refuses the run.start or bot.run that
// began the live run it names.
func (w *Worker) refusesStart(m Message) bool {
	if m.Run == "" || m.ID == "" {
		return false
	}
	var body errorFields
	if m.Decode(&body) == nil && body.Code == "duplicate_run" {
		return false
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	id, live := w.runs[m.Run]
	return live && id == m.ID
}

func (w *Worker) endRun(run string) {
	w.mu.Lock()
	delete(w.runs, run)
	w.lastUsed = time.Now()
	w.mu.Unlock()
}

func (w *Worker) logf(format string, args ...any) {
	w.sup.logf("agent %s: "+format, append([]any{w.dir}, args...)...)
}

// readLoop reads the worker's stdout until it closes, then processes the
// exit. It is the only reader, so routing needs no lock against finish.
func (w *Worker) readLoop() {
	r := bufio.NewReaderSize(w.stdout, 64<<10)
	for {
		line, err := readLine(r, MaxLineBytes)
		if err != nil {
			if errors.Is(err, errLineTooLong) {
				w.fail(fmt.Sprintf("%v: line over %d bytes", ErrProtocol, MaxLineBytes))
				_, _ = io.Copy(io.Discard, r)
			}
			break
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		w.lastSeen.Store(time.Now().UnixNano())
		m, err := parseLine(line, w.account)
		if err != nil {
			w.fail(err.Error())
			_, _ = io.Copy(io.Discard, r)
			break
		}
		w.route(m)
	}
	w.finish()
}

func (w *Worker) route(m Message) {
	switch m.Type {
	case TypePong, TypeHeartbeat:
		if busy, ok := parseBusy(m); ok {
			w.mu.Lock()
			w.busy = busy
			w.mu.Unlock()
		}
		w.pinging.Store(false)
		return
	case TypeLog:
		var body logFields
		_ = m.Decode(&body)
		w.logf("[%s] %s", trimForLog(body.Level, 16), trimForLog(body.Text, 4000))
		return
	}
	if (m.Type == TypeRunDone || m.Type == TypeBotDone) && m.Run != "" {
		w.endRun(m.Run)
	}
	// A refused run.start or bot.run (busy, refused, bad_message, ...) ends that run: the
	// worker never sends its run.done (PROTOCOL.md section 4). Only the error answering the
	// start's own id counts. An error about run.stop, run.steer or approval.answer names the
	// run too, but the run goes on, and duplicate_run means the first start is still live.
	runErr := m.Type == TypeError && m.Account != "" && w.refusesStart(m)
	if runErr {
		w.endRun(m.Run)
	}
	if m.Type == TypeError {
		var body errorFields
		_ = m.Decode(&body)
		w.mu.Lock()
		w.lastErr = trimForLog(body.Message, 1000)
		w.mu.Unlock()
		if m.Account == "" || !strings.HasPrefix(m.ID, goIDPrefix) {
			if !strings.HasPrefix(m.ID, pingIDPrefix) {
				w.logf("worker error %s: %s", trimForLog(body.Code, 40), trimForLog(body.Message, 4000))
			}
		}
	}
	if strings.HasPrefix(m.ID, goIDPrefix) {
		w.mu.Lock()
		reply := w.pending[m.ID]
		delete(w.pending, m.ID)
		w.mu.Unlock()
		if reply != nil {
			reply <- m
		} else if !strings.HasPrefix(m.ID, pingIDPrefix) {
			w.logf("dropped a late %s reply", trimForLog(m.Type, 40))
		}
		return
	}
	if m.Type == TypeError && !runErr {
		return
	}
	if !w.queue.push(m) {
		w.fail(fmt.Sprintf("%v: more than %d messages waiting", ErrProtocol, maxQueued))
	}
}

// dispatchLoop hands worker messages to the handler one at a time, in order,
// so a slow handler never stalls the reader (and so never looks like a
// missed heartbeat).
func (w *Worker) dispatchLoop() {
	defer close(w.dispatched)
	for {
		m, ok := w.queue.pop()
		if !ok {
			return
		}
		w.handle(m)
	}
}

func (w *Worker) handle(m Message) {
	defer func() {
		if r := recover(); r != nil {
			w.logf("handler panicked on %s: %v", m.Type, r)
		}
	}()
	if h := w.sup.cfg.Handler; h != nil {
		h(w, m)
		return
	}
	failClosed(w, m)
}

// failClosed answers a worker request nothing in Go handles yet, at once and
// closed, rather than let the worker's hook time out.
func failClosed(w *Worker, m Message) {
	switch m.Type {
	case TypeGateAsk:
		_ = w.Reply(m, TypeGateVerdict, map[string]any{"verdict": "block", "message": "Timely cannot approve tools yet."})
	case TypeToolCall:
		_ = w.Reply(m, TypeToolResult, map[string]any{"result": "Error: Timely cannot run this tool yet.", "outside": false})
	}
}

// fail kills a worker that broke the protocol or stopped answering. It
// counts as a crash.
func (w *Worker) fail(reason string) {
	w.logf("stopping: %s", reason)
	w.stop(reason, false, true)
}

// claim marks the worker used now, unless it is stopping or gone. Ensure
// claims under the same lock stopIfIdle checks, so a worker handed out is
// never reaped in the same instant.
func (w *Worker) claim() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stopping || w.exited {
		return false
	}
	w.lastUsed = time.Now()
	return true
}

// stopIfIdle stops a ready worker that has done nothing for idleFor, checked
// and marked in one step.
func (w *Worker) stopIfIdle(reason string, idleFor time.Duration) bool {
	w.mu.Lock()
	if w.ready == nil || w.stopping || w.exited || w.busyLocked() || time.Since(w.lastUsed) < idleFor {
		w.mu.Unlock()
		return false
	}
	w.stopping, w.reason = true, reason
	w.mu.Unlock()
	go w.stopSequence(true)
	return true
}

// stop begins stopping the worker. graceful sends shutdown and waits
// ShutdownGrace first; otherwise the group is killed at once.
func (w *Worker) stop(reason string, graceful, crash bool) {
	w.mu.Lock()
	if w.stopping || w.exited {
		w.mu.Unlock()
		return
	}
	w.stopping, w.reason, w.crashed = true, reason, crash
	w.mu.Unlock()
	go w.stopSequence(graceful)
}

func (w *Worker) stopSequence(graceful bool) {
	cfg := w.sup.cfg
	if graceful {
		// stdin stays open through the grace: a live run may still need Go
		// (tool.result, gate.verdict) to finish its turn, and the worker exits
		// on its own once its runs are done (PROTOCOL.md shutdown).
		go func() {
			_ = w.write(TypeShutdown, "", map[string]int{"grace": shutdownGraceSeconds(cfg.ShutdownGrace)})
		}()
		if w.waitDone(cfg.ShutdownGrace) {
			return
		}
		// The lifeline, for a worker that missed the shutdown message.
		go func() { _ = w.stdin.Close() }()
		if canTerminate {
			_ = w.group.terminate()
			if w.waitDone(cfg.KillWait) {
				return
			}
		}
	}
	// Kill first: on Windows, closing a pipe that a blocked write still uses
	// waits for that write, which only the kill ends.
	if err := w.group.kill(); err != nil {
		w.logf("kill: %v", err)
	}
	go func() { _ = w.stdin.Close() }()
	if w.waitDone(cfg.KillWait) {
		return
	}
	// Something else holds the protocol pipe open; stop reading it so the
	// exit is processed.
	_ = w.stdout.Close()
}

// workerInterruptWait is how long the worker spends after its shutdown grace
// interrupting the runs still live and waiting for them (worker.py: 2 s), plus
// a margin for its exit.
const workerInterruptWait = 3 * time.Second

// shutdownGraceSeconds is the shutdown message's grace: the time the worker
// may wait for live runs before interrupting them. It leaves
// workerInterruptWait of ShutdownGrace for the interrupt, so a worker that
// follows the protocol has exited before Go escalates to SIGTERM.
func shutdownGraceSeconds(total time.Duration) int {
	if total <= workerInterruptWait {
		return 0
	}
	return int((total - workerInterruptWait) / time.Second)
}

func (w *Worker) waitDone(d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-w.done:
		return true
	case <-t.C:
		return false
	}
}

// finish runs once stdout has closed: it ends the process group, reaps the
// worker, fails pending requests and tells the supervisor.
func (w *Worker) finish() {
	// Closing the protocol pipe is one of the last things a worker does;
	// give it a moment to finish exiting before the group is killed. The
	// leader is not reaped yet, so its group id is still ours to signal.
	w.group.awaitExit(w.cmd.Process.Pid, w.sup.cfg.KillWait)
	_ = w.group.kill()
	// From here the group id may be reused once Wait reaps the leader, so
	// stopSequence's own timers must not signal it any more.
	w.group.markReaped()
	waitErr := w.cmd.Wait()
	w.group.release()
	_ = w.stdin.Close()

	w.queue.close()
	select {
	case <-w.dispatched:
	case <-time.After(5 * time.Second):
		w.logf("handler still busy after exit")
	}

	w.mu.Lock()
	w.exited = true
	if !w.stopping {
		w.stopping, w.crashed, w.reason = true, true, "exited unexpectedly"
	}
	code := -1
	if w.cmd.ProcessState != nil {
		code = w.cmd.ProcessState.ExitCode()
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		waitErr = nil // the exit code says it
	}
	w.exit = ExitInfo{
		Account:  w.account,
		PID:      w.cmd.Process.Pid,
		Reason:   w.reason,
		Crashed:  w.crashed,
		ExitCode: code,
		Err:      waitErr,
		LiveRuns: w.liveRunsLocked(),
		Stderr:   w.stderr.Tail(),
	}
	w.runs = map[string]string{}
	pending := w.pending
	w.pending = nil
	w.mu.Unlock()
	for _, reply := range pending {
		close(reply)
	}
	w.sup.workerExited(w)
	close(w.done)
}

// healthLoop pings a quiet worker and kills one that stays silent.
func (w *Worker) healthLoop() {
	cfg := w.sup.cfg
	tick := cfg.HeartbeatInterval / 2
	if tick <= 0 {
		tick = time.Second
	}
	t := time.NewTicker(tick)
	defer t.Stop()
	var pings atomic.Uint64
	for {
		select {
		case <-w.done:
			return
		case <-t.C:
		}
		quiet := time.Since(time.Unix(0, w.lastSeen.Load()))
		switch {
		case quiet >= cfg.HeartbeatTimeout:
			w.fail(fmt.Sprintf("no heartbeat for %s", quiet.Round(time.Millisecond)))
			return
		case quiet >= cfg.HeartbeatInterval:
			if w.pinging.CompareAndSwap(false, true) {
				id := fmt.Sprintf("%s%d", pingIDPrefix, pings.Add(1))
				go func() { _ = w.write(TypePing, id, nil) }()
			}
		default:
			w.pinging.Store(false)
		}
	}
}

const pingIDPrefix = goIDPrefix + "ping-"

// msgQueue is an unbounded-until-maxQueued FIFO between reader and handler.
type msgQueue struct {
	mu     sync.Mutex
	items  []Message
	closed bool
	signal chan struct{}
}

func newMsgQueue() *msgQueue { return &msgQueue{signal: make(chan struct{}, 1)} }

func (q *msgQueue) push(m Message) bool {
	q.mu.Lock()
	if len(q.items) >= maxQueued {
		q.mu.Unlock()
		return false
	}
	q.items = append(q.items, m)
	q.mu.Unlock()
	q.wake()
	return true
}

func (q *msgQueue) close() {
	q.mu.Lock()
	q.closed = true
	q.mu.Unlock()
	q.wake()
}

func (q *msgQueue) wake() {
	select {
	case q.signal <- struct{}{}:
	default:
	}
}

func (q *msgQueue) pop() (Message, bool) {
	for {
		q.mu.Lock()
		if len(q.items) > 0 {
			m := q.items[0]
			q.items[0] = Message{}
			q.items = q.items[1:]
			q.mu.Unlock()
			return m, true
		}
		if q.closed {
			q.mu.Unlock()
			return Message{}, false
		}
		q.mu.Unlock()
		<-q.signal
	}
}

// logTail writes the worker's stderr to the API log line by line and keeps
// the last lines for ExitInfo.
type logTail struct {
	logf    func(string, ...any)
	mu      sync.Mutex
	partial []byte
	tail    []string
}

const maxStderrLine = 8 << 10

func (l *logTail) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.partial = append(l.partial, p...)
	for {
		i := bytes.IndexByte(l.partial, '\n')
		if i < 0 {
			if len(l.partial) > maxStderrLine {
				l.emit(l.partial)
				l.partial = l.partial[:0]
			}
			break
		}
		l.emit(l.partial[:i])
		l.partial = l.partial[i+1:]
	}
	return len(p), nil
}

func (l *logTail) emit(line []byte) {
	text := trimForLog(string(bytes.TrimRight(line, "\r")), maxStderrLine)
	if text == "" {
		return
	}
	l.logf("%s", text)
	l.tail = append(l.tail, text)
	if len(l.tail) > stderrTailLines {
		l.tail = l.tail[len(l.tail)-stderrTailLines:]
	}
}

// Tail returns the last stderr lines.
func (l *logTail) Tail() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.partial) > 0 {
		l.emit(l.partial)
		l.partial = l.partial[:0]
	}
	return append([]string(nil), l.tail...)
}
