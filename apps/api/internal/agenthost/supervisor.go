package agenthost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	// ErrClosed means the supervisor is shutting down.
	ErrClosed = errors.New("agent supervisor is shut down")
	// ErrAccountRemoved means the account was deleted; no worker starts for it.
	ErrAccountRemoved = errors.New("account removed")
	// ErrCrashLoop means the account's worker crashed too often recently.
	ErrCrashLoop = errors.New("agent worker keeps crashing")
	// ErrHelloTimeout means the worker did not answer hello in time.
	ErrHelloTimeout = errors.New("agent worker did not answer hello in time")
	// ErrSelfTestFailed means the worker refused to serve (ready.self_test).
	ErrSelfTestFailed = errors.New("agent worker self-test failed")
	// ErrWorkerRefused means the worker answered hello with an error (wrong
	// home, config.yaml not matching settings_hash, protocol mismatch).
	ErrWorkerRefused = errors.New("agent worker refused hello")

	errNoWaiters      = errors.New("nobody is waiting for this worker any more")
	errDiedAfterReady = errors.New("agent worker exited right after ready")
)

// StartError explains why Ensure could not produce a worker; the UI shows it
// as "The agent could not start" with Detail.
type StartError struct {
	Account string
	Err     error
	Detail  string
	Stderr  []string
}

func (e *StartError) Error() string {
	if e.Detail == "" {
		return e.Err.Error()
	}
	return e.Err.Error() + ": " + e.Detail
}

func (e *StartError) Unwrap() error { return e.Err }

// AccountSpec is what the supervisor needs from the rest of Timely to start
// one account's worker.
type AccountSpec struct {
	// Settings is the account settings JSON config_render turns into
	// <home>/config.yaml (plan 6.3). Its hash goes in hello.
	Settings json.RawMessage
	// ToolKeys are the account's tool keys under their Hermes names
	// (EXA_API_KEY, ...). Names that could change Timely's or Hermes'
	// behaviour are refused (see Denied).
	ToolKeys map[string]string
}

// RestartPolicy limits restarts after crashes. Workers are started on
// demand, so a restart happens on the next Ensure: after a crash it waits
// BaseBackoff, doubling per further crash up to MaxBackoff; after
// MaxCrashes crashes within Window, Ensure fails with ErrCrashLoop until
// Window has passed since the last crash.
type RestartPolicy struct {
	MaxCrashes  int
	Window      time.Duration
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
}

// Config configures a Supervisor. Zero values take the defaults noted.
type Config struct {
	// Root is the agent data folder (Layout); made absolute by New.
	Root string
	// Runtime starts a worker. Empty Program: Ensure fails with
	// ErrNoRuntime (and RuntimeErr's detail).
	Runtime    Runtime
	RuntimeErr error
	Env        EnvConfig

	MaxWorkers        int           // 3 (TIMELY_AGENT_MAX_WORKERS)
	IdleTimeout       time.Duration // 15 min (TIMELY_AGENT_IDLE_MINUTES)
	HelloTimeout      time.Duration // 20 s
	HeartbeatInterval time.Duration // 10 s: ping a worker quiet this long
	HeartbeatTimeout  time.Duration // 30 s: kill a worker quiet this long
	ShutdownGrace     time.Duration // 5 s after shutdown before SIGTERM / job kill
	KillWait          time.Duration // 2 s between SIGTERM and SIGKILL
	ReapInterval      time.Duration // how often idle workers are checked: min(IdleTimeout/4, 1 min)
	EvictGrace        time.Duration // 30 s: an idle worker used more recently is never evicted for a queued account
	Restart           RestartPolicy // 3 crashes in 10 min; backoff 1 s .. 30 s

	CatalogVersion string

	// RenderAccount runs the runtime's prepare step once and its
	// render-account step before every spawn, and sends render-account's
	// config_sha256 as hello.settings_hash. The real worker needs it (it
	// refuses a hello whose hash does not match config.yaml). Off: the hash
	// is the sha256 of AccountSpec.Settings and nothing is rendered.
	RenderAccount bool

	// Account supplies settings and tool keys at spawn. Nil: none.
	Account func(ctx context.Context, account string) (AccountSpec, error)
	// Handler receives every worker message the supervisor does not consume
	// itself, in arrival order, one at a time per worker.
	Handler func(w *Worker, m Message)
	// OnExit is called once per worker exit, after its pending requests
	// have failed and before Worker.Done closes (so it must not wait on
	// Done). ExitInfo.LiveRuns lists the runs to fail.
	OnExit func(ExitInfo)
	Logf   func(format string, args ...any)
}

func positiveInt(getenv func(string) string, name string, fallback int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(getenv(name))); err == nil && n > 0 {
		return n
	}
	return fallback
}

// ConfigFromEnv is the env fallback of plan 11.2 (Settings -> Server will win
// over it once the instance settings store exists): TIMELY_AGENT_RUNTIME,
// TIMELY_AGENT_MAX_WORKERS, TIMELY_AGENT_IDLE_MINUTES, and the data folder
// from TIMELY_DATA_DIR. workDir is where the dev runtime search starts.
func ConfigFromEnv(getenv func(string) string, workDir string) Config {
	runtime, err := ResolveRuntime(strings.TrimSpace(getenv("TIMELY_AGENT_RUNTIME")), workDir)
	return Config{
		Root:          DefaultRoot(getenv),
		Runtime:       runtime,
		RuntimeErr:    err,
		Env:           envFromHost(getenv),
		MaxWorkers:    positiveInt(getenv, "TIMELY_AGENT_MAX_WORKERS", 3),
		IdleTimeout:   time.Duration(positiveInt(getenv, "TIMELY_AGENT_IDLE_MINUTES", 15)) * time.Minute,
		RenderAccount: true,
	}
}

func (c *Config) applyDefaults() {
	def := func(d *time.Duration, v time.Duration) {
		if *d <= 0 {
			*d = v
		}
	}
	if c.MaxWorkers <= 0 {
		c.MaxWorkers = 3
	}
	def(&c.IdleTimeout, 15*time.Minute)
	def(&c.HelloTimeout, 20*time.Second)
	def(&c.HeartbeatInterval, 10*time.Second)
	def(&c.HeartbeatTimeout, 30*time.Second)
	def(&c.ShutdownGrace, 5*time.Second)
	def(&c.KillWait, 2*time.Second)
	reap := c.IdleTimeout / 4
	if reap > time.Minute {
		reap = time.Minute
	}
	def(&c.ReapInterval, reap)
	def(&c.EvictGrace, 30*time.Second)
	if c.Restart.MaxCrashes <= 0 {
		c.Restart.MaxCrashes = 3
	}
	def(&c.Restart.Window, 10*time.Minute)
	def(&c.Restart.BaseBackoff, time.Second)
	def(&c.Restart.MaxBackoff, 30*time.Second)
	if c.Logf == nil {
		c.Logf = log.Printf
	}
	if c.Env.Path == "" && c.Env.RealHome == "" {
		c.Env = envFromHost(os.Getenv)
	}
}

// Supervisor owns every agent worker in this API process.
type Supervisor struct {
	cfg    Config
	layout Layout

	prepMu   sync.Mutex
	prepared bool
	seedDir  string

	slots   chan struct{}
	closing chan struct{}
	reaped  chan struct{}
	starts  sync.WaitGroup

	mu      sync.Mutex
	closed  bool
	workers map[string]*entry
	crashes map[string]*crashRecord
	removed map[string]bool
}

type entry struct {
	w        *Worker
	starting chan struct{} // closed when the start finishes
	err      error
	waiters  int
	cancel   context.CancelFunc
	spawned  bool
}

type crashRecord struct {
	count  int
	last   time.Time
	reason string
}

// New returns a running supervisor (its idle reaper is started).
func New(cfg Config) *Supervisor {
	cfg.applyDefaults()
	// Hermes and the worker's own checks need an absolute HERMES_HOME.
	if cfg.Root != "" {
		if abs, err := filepath.Abs(cfg.Root); err == nil {
			cfg.Root = abs
		}
	}
	s := &Supervisor{
		cfg:     cfg,
		layout:  Layout{Root: cfg.Root},
		slots:   make(chan struct{}, cfg.MaxWorkers),
		closing: make(chan struct{}),
		reaped:  make(chan struct{}),
		workers: map[string]*entry{},
		crashes: map[string]*crashRecord{},
		removed: map[string]bool{},
	}
	go s.reapLoop()
	return s
}

// Layout is the agent data folder this supervisor uses.
func (s *Supervisor) Layout() Layout { return s.layout }

func (s *Supervisor) logf(format string, args ...any) { s.cfg.Logf(format, args...) }

// Worker returns the account's live, ready worker without starting one.
func (s *Supervisor) Worker(account string) (*Worker, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.workers[account]
	if e == nil || e.w == nil {
		return nil, false
	}
	return e.w, true
}

// Ensure returns the account's ready worker, starting one if needed. Calls
// for the same account share one start. A start keeps going if the caller
// gives up after the worker was spawned, so the next caller finds it ready;
// a start still queued for a slot is dropped when every caller has gone.
func (s *Supervisor) Ensure(ctx context.Context, account string) (*Worker, error) {
	if account == "" {
		return nil, errors.New("agenthost: no account")
	}
	for {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return nil, ErrClosed
		}
		if s.removed[account] {
			s.mu.Unlock()
			return nil, ErrAccountRemoved
		}
		e := s.workers[account]
		if e == nil {
			var backoff time.Duration
			var err error
			backoff, err = s.restartGateLocked(account)
			if err != nil {
				s.mu.Unlock()
				return nil, err
			}
			startCtx, cancel := context.WithCancel(context.Background())
			e = &entry{starting: make(chan struct{}), cancel: cancel}
			s.workers[account] = e
			s.starts.Add(1)
			go s.start(startCtx, account, e, backoff)
		}
		if e.w != nil {
			w := e.w
			if w.claim() {
				s.mu.Unlock()
				return w, nil
			}
			// Stopping (idle, evicted) or just gone: wait for its exit,
			// which drops the entry, then start a fresh one.
			if w.hasExited() {
				delete(s.workers, account)
			}
			s.mu.Unlock()
			select {
			case <-w.Done():
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		e.waiters++
		s.mu.Unlock()

		select {
		case <-e.starting:
			s.mu.Lock()
			e.waiters--
			w, err := e.w, e.err
			s.mu.Unlock()
			if err != nil {
				if errors.Is(err, errNoWaiters) || errors.Is(err, errDiedAfterReady) {
					continue // the crash is recorded; the restart policy decides
				}
				return nil, err
			}
			if w != nil {
				if !w.claim() {
					continue // stopping or died right after starting; the loop decides
				}
				return w, nil
			}
		case <-ctx.Done():
			s.mu.Lock()
			e.waiters--
			if e.waiters == 0 && !e.spawned {
				e.cancel()
			}
			s.mu.Unlock()
			return nil, ctx.Err()
		}
	}
}

// restartGateLocked applies the restart policy: the backoff to wait before
// spawning, or ErrCrashLoop.
func (s *Supervisor) restartGateLocked(account string) (time.Duration, error) {
	rec := s.crashes[account]
	if rec == nil {
		return 0, nil
	}
	since := time.Since(rec.last)
	if since > s.cfg.Restart.Window {
		delete(s.crashes, account)
		return 0, nil
	}
	if rec.count >= s.cfg.Restart.MaxCrashes {
		return 0, &StartError{Account: account, Err: ErrCrashLoop,
			Detail: fmt.Sprintf("%d crashes in %s, last: %s", rec.count, s.cfg.Restart.Window, rec.reason)}
	}
	backoff := s.cfg.Restart.BaseBackoff << (rec.count - 1)
	if backoff > s.cfg.Restart.MaxBackoff || backoff <= 0 {
		backoff = s.cfg.Restart.MaxBackoff
	}
	if wait := backoff - since; wait > 0 {
		return wait, nil
	}
	return 0, nil
}

func (s *Supervisor) recordCrash(account, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := s.crashes[account]
	if rec == nil || time.Since(rec.last) > s.cfg.Restart.Window {
		rec = &crashRecord{}
		s.crashes[account] = rec
	}
	rec.count++
	rec.last = time.Now()
	rec.reason = reason
}

// start runs one start for an entry: backoff, slot, spawn, handshake.
func (s *Supervisor) start(ctx context.Context, account string, e *entry, backoff time.Duration) {
	defer s.starts.Done()
	w, err := s.startWorker(ctx, account, e, backoff)
	s.mu.Lock()
	if err == nil && s.closed {
		err = ErrClosed
	}
	if err == nil && w.hasExited() {
		// It died between ready and now; workerExited has already run and
		// found no entry, so it must not be listed.
		err = errDiedAfterReady
		w = nil
	}
	if err != nil {
		if s.workers[account] == e {
			delete(s.workers, account)
		}
		e.err = err
	} else {
		e.w = w
	}
	close(e.starting)
	s.mu.Unlock()
	e.cancel()
	if err != nil && w != nil {
		// Shut down while the handshake ran: Shutdown waits for starts, so
		// this worker must be gone before the start counts as finished.
		w.stop("shutdown", true, false)
		<-w.Done()
	}
}

func (s *Supervisor) startWorker(ctx context.Context, account string, e *entry, backoff time.Duration) (*Worker, error) {
	if backoff > 0 {
		t := time.NewTimer(backoff)
		defer t.Stop()
		select {
		case <-t.C:
		case <-ctx.Done():
			return nil, errNoWaiters
		case <-s.closing:
			return nil, ErrClosed
		}
	}
	if s.cfg.Runtime.Program == "" {
		return nil, &StartError{Account: account, Err: ErrNoRuntime, Detail: errDetail(s.cfg.RuntimeErr)}
	}
	if err := s.acquireSlot(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if ctx.Err() != nil {
		s.mu.Unlock()
		<-s.slots
		return nil, errNoWaiters
	}
	e.spawned = true
	s.mu.Unlock()

	var spec AccountSpec
	if s.cfg.Account != nil {
		specCtx, cancel := context.WithTimeout(context.Background(), s.cfg.HelloTimeout)
		var err error
		spec, err = s.cfg.Account(specCtx, account)
		cancel()
		if err != nil {
			<-s.slots
			return nil, &StartError{Account: account, Err: err, Detail: "reading account settings"}
		}
	}
	if err := s.layout.prepare(account); err != nil {
		<-s.slots
		return nil, &StartError{Account: account, Err: err}
	}
	hash := settingsHash(spec.Settings)
	if s.cfg.RenderAccount {
		renderCtx, cancel := s.untilClosing()
		var err error
		hash, err = s.renderAccount(renderCtx, account, spec.Settings)
		cancel()
		if err != nil {
			<-s.slots
			s.recordCrash(account, err.Error())
			return nil, &StartError{Account: account, Err: err, Detail: "preparing the account's agent config"}
		}
	}
	w, err := s.spawn(account, spec)
	if err != nil {
		<-s.slots
		s.recordCrash(account, err.Error())
		return nil, &StartError{Account: account, Err: err, Detail: "spawning the worker"}
	}
	if err := s.handshake(w, spec, hash); err != nil {
		w.fail(err.Error())
		<-w.Done()
		var se *StartError
		if errors.As(err, &se) {
			se.Stderr = w.Exit().Stderr
			return nil, se
		}
		return nil, &StartError{Account: account, Err: err, Stderr: w.Exit().Stderr}
	}
	return w, nil
}

// untilClosing is a context that ends when Shutdown starts, so a slow
// prepare or render-account step does not hold Shutdown up.
func (s *Supervisor) untilClosing() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		select {
		case <-s.closing:
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}

// acquireSlot takes one of MaxWorkers slots, evicting the least recently
// used idle worker when all are taken.
func (s *Supervisor) acquireSlot(ctx context.Context) error {
	for {
		select {
		case s.slots <- struct{}{}:
			return nil
		default:
		}
		s.evictIdle()
		t := time.NewTimer(250 * time.Millisecond)
		select {
		case s.slots <- struct{}{}:
			t.Stop()
			return nil
		case <-ctx.Done():
			t.Stop()
			return errNoWaiters
		case <-s.closing:
			t.Stop()
			return ErrClosed
		case <-t.C:
		}
	}
}

func (s *Supervisor) evictIdle() {
	s.mu.Lock()
	var victim *Worker
	var oldest time.Time
	for _, e := range s.workers {
		if e.w == nil {
			continue
		}
		since, idle := e.w.idleSince()
		if !idle || time.Since(since) < s.cfg.EvictGrace {
			continue
		}
		if victim == nil || since.Before(oldest) {
			victim, oldest = e.w, since
		}
	}
	s.mu.Unlock()
	if victim != nil && victim.stopIfIdle("evicted", s.cfg.EvictGrace) {
		victim.logf("stopping: idle, and another account is waiting for a slot")
	}
}

func (s *Supervisor) spawn(account string, spec AccountSpec) (*Worker, error) {
	env, err := BuildEnv(s.layout, account, s.hostConfig(), spec.ToolKeys)
	if err != nil {
		return nil, err
	}
	dir := AccountDirName(account)
	w := &Worker{
		sup:        s,
		account:    account,
		dir:        dir,
		home:       s.layout.Home(account),
		slot:       true,
		pending:    map[string]chan Message{},
		runs:       map[string]string{},
		lastUsed:   time.Now(),
		queue:      newMsgQueue(),
		dispatched: make(chan struct{}),
		done:       make(chan struct{}),
	}
	w.stderr = &logTail{logf: func(format string, args ...any) {
		s.logf("agent %s stderr: "+format, append([]any{dir}, args...)...)
	}}
	cmd := exec.Command(s.cfg.Runtime.Program, s.cfg.Runtime.command("worker")...)
	cmd.Env = env
	cmd.Dir = s.layout.Workspace(account)
	cmd.Stderr = w.stderr
	// Terminal children may keep stderr open after the worker exits; Wait
	// stops copying it after this long.
	cmd.WaitDelay = 2 * time.Second
	configureCmd(cmd)
	if w.stdin, err = cmd.StdinPipe(); err != nil {
		return nil, err
	}
	if w.stdout, err = cmd.StdoutPipe(); err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	w.cmd = cmd
	group, err := startGroup(cmd)
	if err != nil {
		w.logf("process group: %v (stops will end the worker alone)", err)
	}
	w.group = group
	w.lastSeen.Store(time.Now().UnixNano())
	go w.readLoop()
	go w.dispatchLoop()
	w.logf("started pid %d", cmd.Process.Pid)
	return w, nil
}

func settingsHash(settings json.RawMessage) string {
	sum := sha256.Sum256(settings)
	return hex.EncodeToString(sum[:])
}

func (s *Supervisor) handshake(w *Worker, spec AccountSpec, hash string) error {
	ctx, cancel := context.WithTimeout(context.Background(), s.cfg.HelloTimeout)
	defer cancel()
	reply, err := w.Request(ctx, TypeHello, helloFields{
		Protocol:       ProtocolVersion,
		Home:           w.home,
		SettingsHash:   hash,
		Settings:       spec.Settings,
		CatalogVersion: s.cfg.CatalogVersion,
	})
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return &StartError{Account: w.account, Err: ErrHelloTimeout, Detail: s.cfg.HelloTimeout.String()}
	case errors.Is(err, ErrWorkerExited):
		<-w.Done()
		exit := w.Exit()
		detail := exit.Reason
		if exit.Reason == "exited unexpectedly" {
			detail = fmt.Sprintf("exited with code %d before ready", exit.ExitCode)
		}
		if last := w.lastError(); last != "" {
			detail += " (" + last + ")"
		}
		return &StartError{Account: w.account, Err: ErrWorkerExited, Detail: detail}
	case err != nil:
		return &StartError{Account: w.account, Err: ErrWorkerRefused, Detail: err.Error()}
	}
	if reply.Type != TypeReady {
		return &StartError{Account: w.account, Err: ErrProtocol, Detail: "answered hello with " + reply.Type}
	}
	var ready Ready
	if err := reply.Decode(&ready); err != nil {
		return &StartError{Account: w.account, Err: ErrProtocol, Detail: "unreadable ready: " + err.Error()}
	}
	if ready.Protocol != 0 && ready.Protocol != ProtocolVersion {
		return &StartError{Account: w.account, Err: ErrProtocol,
			Detail: fmt.Sprintf("worker speaks protocol %d, Timely %d", ready.Protocol, ProtocolVersion)}
	}
	if !ready.SelfTest.OK {
		return &StartError{Account: w.account, Err: ErrSelfTestFailed, Detail: ready.SelfTest.failures()}
	}
	w.mu.Lock()
	w.ready = &ready
	w.lastUsed = time.Now()
	w.mu.Unlock()
	go w.healthLoop()
	w.logf("ready (hermes %s, %d tools)", trimForLog(ready.HermesTag, 40), len(ready.Tools))
	return nil
}

// workerExited is called once from each worker's finish.
func (s *Supervisor) workerExited(w *Worker) {
	exit := w.Exit()
	s.mu.Lock()
	if e := s.workers[w.account]; e != nil && e.w == w {
		delete(s.workers, w.account)
	}
	s.mu.Unlock()
	if w.slot {
		<-s.slots
	}
	if exit.Crashed {
		s.recordCrash(w.account, exit.Reason)
	}
	w.logf("exited (code %d, %s)", exit.ExitCode, exit.Reason)
	if s.cfg.OnExit != nil {
		s.cfg.OnExit(exit)
	}
}

func (s *Supervisor) reapLoop() {
	defer close(s.reaped)
	t := time.NewTicker(s.cfg.ReapInterval)
	defer t.Stop()
	for {
		select {
		case <-s.closing:
			return
		case <-t.C:
		}
		s.reapIdle()
	}
}

// reapIdle stops workers idle for IdleTimeout. A worker with a live run, a
// hold or work it reports itself (learning, children) is never idle.
func (s *Supervisor) reapIdle() {
	s.mu.Lock()
	var workers []*Worker
	for _, e := range s.workers {
		if e.w != nil {
			workers = append(workers, e.w)
		}
	}
	s.mu.Unlock()
	for _, w := range workers {
		if w.stopIfIdle("idle", s.cfg.IdleTimeout) {
			w.logf("stopping: idle for %s", s.cfg.IdleTimeout)
		}
	}
}

// Stop stops the account's worker if one runs, and waits for it to exit.
func (s *Supervisor) Stop(ctx context.Context, account, reason string) error {
	w, ok := s.Worker(account)
	if !ok {
		return nil
	}
	w.stop(reason, true, false)
	select {
	case <-w.Done():
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Shutdown stops every worker (shutdown message, then the escalation in the
// package doc) and waits for them, or until ctx ends.
func (s *Supervisor) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		close(s.closing)
	}
	s.mu.Unlock()
	<-s.reaped

	starts := make(chan struct{})
	go func() { s.starts.Wait(); close(starts) }()
	select {
	case <-starts:
	case <-ctx.Done():
		return ctx.Err()
	}

	s.mu.Lock()
	var all []*Worker
	for _, e := range s.workers {
		if e.w != nil {
			all = append(all, e.w)
		}
	}
	s.mu.Unlock()
	for _, w := range all {
		w.stop("shutdown", true, false)
	}
	for _, w := range all {
		select {
		case <-w.Done():
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// RemoveAccount is the account-deletion hook (plan 6.6): refuse new spawns,
// stop the worker and its children, move the home to .trash and delete it,
// retrying because Windows keeps files of just-exited processes locked for a
// moment.
func (s *Supervisor) RemoveAccount(ctx context.Context, account string) error {
	if account == "" {
		return nil
	}
	s.mu.Lock()
	s.removed[account] = true
	delete(s.crashes, account)
	e := s.workers[account]
	s.mu.Unlock()
	if e != nil {
		select {
		case <-e.starting:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := s.Stop(ctx, account, "removed"); err != nil {
		return err
	}
	home := s.layout.Home(account)
	if _, err := os.Stat(home); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err := os.MkdirAll(s.layout.Trash(), 0o700); err != nil {
		return err
	}
	trashed := filepath.Join(s.layout.Trash(), fmt.Sprintf("%s-%d", AccountDirName(account), time.Now().UnixNano()))
	if err := retry(ctx, func() error { return os.Rename(home, trashed) }); err != nil {
		return fmt.Errorf("agenthost: move %s to trash: %w", home, err)
	}
	if err := retry(ctx, func() error { return os.RemoveAll(trashed) }); err != nil {
		return fmt.Errorf("agenthost: delete %s: %w", trashed, err)
	}
	return nil
}

func retry(ctx context.Context, fn func() error) error {
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		if err = fn(); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 200 * time.Millisecond):
		}
	}
	return err
}
