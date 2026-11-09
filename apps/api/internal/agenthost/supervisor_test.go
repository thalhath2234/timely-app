package agenthost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// testRoot is a fresh agent data folder under $HOME/.cache/timely-agent-test,
// never under ~/.hermes.
func testRoot(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, ".cache", "timely-agent-test")
		if os.MkdirAll(dir, 0o700) == nil {
			if made, err := os.MkdirTemp(dir, "agenthost-"); err == nil {
				t.Cleanup(func() { _ = os.RemoveAll(made) })
				base = made
			}
		}
	}
	return filepath.Join(base, "agent")
}

// testLog drops lines once the test has finished, so a worker exiting late
// cannot log into a completed test.
type testLog struct {
	mu    sync.Mutex
	t     *testing.T
	done  bool
	lines []string
}

func newTestLog(t *testing.T) *testLog {
	l := &testLog{t: t}
	t.Cleanup(func() { l.mu.Lock(); l.done = true; l.mu.Unlock() })
	return l
}

func (l *testLog) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	line := fmt.Sprintf(format, args...)
	l.lines = append(l.lines, line)
	if !l.done {
		l.t.Log(line)
	}
}

func (l *testLog) contains(s string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, line := range l.lines {
		if strings.Contains(line, s) {
			return true
		}
	}
	return false
}

type harness struct {
	t     *testing.T
	sup   *Supervisor
	log   *testLog
	exits chan ExitInfo
	msgs  chan Message
}

// newHarness starts a supervisor running the fake worker in mode; tweak
// adjusts the config first.
func newHarness(t *testing.T, mode string, tweak func(*Config)) *harness {
	t.Helper()
	h := &harness{t: t, log: newTestLog(t), exits: make(chan ExitInfo, 64), msgs: make(chan Message, 256)}
	cfg := Config{
		Root:              testRoot(t),
		Runtime:           fakeRuntime(t, mode),
		HelloTimeout:      5 * time.Second,
		HeartbeatInterval: time.Second,
		HeartbeatTimeout:  10 * time.Second,
		ShutdownGrace:     2 * time.Second,
		KillWait:          time.Second,
		Restart:           RestartPolicy{BaseBackoff: 20 * time.Millisecond, MaxBackoff: 100 * time.Millisecond},
		Logf:              h.log.logf,
		OnExit:            func(e ExitInfo) { h.exits <- e },
		Handler: func(w *Worker, m Message) {
			if m.Type == "tool.call" {
				_ = w.Reply(m, "tool.result", map[string]any{"result": "context for " + m.Run})
			}
			h.msgs <- m
		},
	}
	if tweak != nil {
		tweak(&cfg)
	}
	h.sup = New(cfg)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := h.sup.Shutdown(ctx); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})
	return h
}

func (h *harness) ensure(account string) *Worker {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	w, err := h.sup.Ensure(ctx, account)
	if err != nil {
		h.t.Fatalf("Ensure(%s): %v", account, err)
	}
	return w
}

func (h *harness) ensureErr(account string) error {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	w, err := h.sup.Ensure(ctx, account)
	if err == nil {
		h.t.Fatalf("Ensure(%s) gave pid %d, want an error", account, w.PID())
	}
	return err
}

func (h *harness) exit(within time.Duration) ExitInfo {
	h.t.Helper()
	select {
	case e := <-h.exits:
		return e
	case <-time.After(within):
		h.t.Fatalf("no worker exit within %s", within)
		return ExitInfo{}
	}
}

func (h *harness) message(typ string) Message {
	h.t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-h.msgs:
			if m.Type == typ {
				return m
			}
		case <-deadline:
			h.t.Fatalf("no %s message", typ)
			return Message{}
		}
	}
}

func waitGone(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !processExited(pid) {
		if time.Now().After(deadline) {
			t.Fatalf("process %d is still running", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

type readyEcho struct {
	Hello struct {
		Type           string   `json:"type"`
		Account        string   `json:"account"`
		Protocol       int      `json:"protocol"`
		Home           string   `json:"home"`
		SettingsHash   string   `json:"settings_hash"`
		Settings       any      `json:"settings"`
		CatalogVersion string   `json:"catalog_version"`
		TimelySkills   string   `json:"timely_skills_dir"`
		ManagedSHA256  string   `json:"managed_sha256"`
		DefaultOff     []string `json:"skills_default_off"`
	} `json:"hello"`
	Env   []string `json:"env"`
	Cwd   string   `json:"cwd"`
	Child int      `json:"child"`
}

func TestHandshakeSendsHelloAndBuildsTheEnvironmentFromScratch(t *testing.T) {
	// Secrets and Hermes switches in the API's own environment.
	t.Setenv("JWT_SECRET", "jwt-secret-value")
	t.Setenv("DB_PASSWORD", "db-password-value")
	t.Setenv("TIMELY_BACKUP_KEY", "backup-key-value")
	t.Setenv("HERMES_YOLO", "1")
	t.Setenv("HERMES_LANGUAGE", "fr")
	t.Setenv("HERMES_BUNDLED_LOCALES", "/elsewhere")
	t.Setenv("OPENAI_API_KEY", "not-for-workers")

	h := newHarness(t, "ok", func(c *Config) {
		c.CatalogVersion = "cat-1"
		c.Env = EnvConfig{Path: os.Getenv("PATH"), Lang: "C.UTF-8", TZ: "Asia/Tokyo", RealHome: "/real/home"}
		c.Account = func(ctx context.Context, account string) (AccountSpec, error) {
			return AccountSpec{
				Settings: json.RawMessage(`{"timezone":"Asia/Tokyo"}`),
				ToolKeys: map[string]string{"EXA_API_KEY": "exa-key"},
			}, nil
		}
	})
	w := h.ensure("acct-1")
	ready := w.Ready()
	if !ready.SelfTest.OK || ready.HermesTag != "v0.23.0" || len(ready.Tools) != 2 {
		t.Fatalf("ready = %+v", ready)
	}

	// Ready() keeps only the typed fields; ask the fake for its echo of
	// hello, its environment and working directory with a second hello.
	echo := fetchReadyEcho(t, h, "acct-1")
	layout := h.sup.Layout()
	if echo.Hello.Account != "acct-1" || echo.Hello.Protocol != ProtocolVersion ||
		echo.Hello.Home != layout.Home("acct-1") || echo.Hello.CatalogVersion != "cat-1" {
		t.Fatalf("hello = %+v", echo.Hello)
	}
	if echo.Hello.SettingsHash != settingsHash(json.RawMessage(`{"timezone":"Asia/Tokyo"}`)) {
		t.Fatalf("settings hash %q", echo.Hello.SettingsHash)
	}
	if want, _ := filepath.EvalSymlinks(layout.Workspace("acct-1")); !samePath(echo.Cwd, want) {
		t.Fatalf("cwd %q, want %q", echo.Cwd, want)
	}

	env := map[string]string{}
	for _, kv := range echo.Env {
		name, value, _ := strings.Cut(kv, "=")
		env[name] = value
	}
	wantSet := map[string]string{
		"HERMES_HOME":             layout.Home("acct-1"),
		"HOME":                    layout.ProfileHome("acct-1"),
		"HERMES_REAL_HOME":        "/real/home",
		"TMPDIR":                  layout.Temp("acct-1"),
		"HERMES_RUNTIME_DIR":      layout.Runtime(),
		"HERMES_GATEWAY_LOCK_DIR": layout.Locks(),
		"XDG_STATE_HOME":          layout.State(),
		"HERMES_MANAGED_DIR":      layout.Managed(),
		"TERMINAL_CWD":            layout.Workspace("acct-1"),
		"PYTHONNOUSERSITE":        "1",
		"LANG":                    "C.UTF-8",
		"TZ":                      "Asia/Tokyo",
		"EXA_API_KEY":             "exa-key",
	}
	for name, want := range wantSet {
		if env[name] != want {
			t.Errorf("%s = %q, want %q", name, env[name], want)
		}
	}
	for _, name := range []string{"JWT_SECRET", "DB_PASSWORD", "TIMELY_BACKUP_KEY", "HERMES_YOLO",
		"HERMES_LANGUAGE", "HERMES_BUNDLED_LOCALES", "OPENAI_API_KEY", "PYTHONDONTWRITEBYTECODE"} {
		if _, ok := env[name]; ok {
			t.Errorf("%s reached the worker", name)
		}
	}
	allowed := map[string]bool{"PATH": true, "HERMES_BUNDLED_SKILLS": true, "HERMES_OPTIONAL_SKILLS": true}
	for name := range wantSet {
		allowed[name] = true
	}
	if runtime.GOOS == "windows" {
		for _, name := range append(windowsBaseNames, "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP") {
			allowed[name] = true
		}
	}
	for name := range env {
		if !allowed[name] {
			t.Errorf("unexpected variable %s in the worker environment", name)
		}
	}
	for _, dir := range []string{layout.ProfileHome("acct-1"), layout.Workspace("acct-1"), layout.Temp("acct-1"), layout.Managed()} {
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			t.Errorf("%s not created: %v", dir, err)
		}
	}
}

func samePath(a, b string) bool {
	ra, _ := filepath.EvalSymlinks(a)
	return filepath.Clean(ra) == filepath.Clean(b) || strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// fetchReadyEcho sends the live worker a second hello and decodes the fake's
// echo (the supervisor's own first hello, its environment, cwd and child
// pid).
func fetchReadyEcho(t *testing.T, h *harness, account string) readyEcho {
	t.Helper()
	w, ok := h.sup.Worker(account)
	if !ok {
		t.Fatal("no worker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// The fake answers a second hello like the first; the supervisor's
	// envelope checks still apply to it.
	reply, err := w.Request(ctx, TypeHello, helloFields{
		Protocol: ProtocolVersion, Home: w.Home(),
		SettingsHash:   settingsHash(json.RawMessage(`{"timezone":"Asia/Tokyo"}`)),
		CatalogVersion: h.sup.cfg.CatalogVersion,
	})
	if err != nil {
		t.Fatal(err)
	}
	var out readyEcho
	if err := reply.Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestEnsureSharesOneWorkerPerAccount(t *testing.T) {
	h := newHarness(t, "ok", nil)
	var wg sync.WaitGroup
	pids := make([]int, 8)
	for i := range pids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			pids[i] = h.ensure("acct-1").PID()
		}(i)
	}
	wg.Wait()
	for _, pid := range pids {
		if pid != pids[0] {
			t.Fatalf("pids %v: more than one worker for one account", pids)
		}
	}
	if other := h.ensure("acct-2"); other.PID() == pids[0] {
		t.Fatal("two accounts share a worker")
	}
}

func TestRequestReplyAndErrorReply(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reply, err := w.Request(ctx, "echo", map[string]any{"payload": "ping-pong"})
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Payload string `json:"payload"`
	}
	if err := reply.Decode(&body); err != nil || body.Payload != "ping-pong" || reply.Type != "echo.reply" {
		t.Fatalf("reply %s %+v %v", reply.Type, body, err)
	}
	_, err = w.Request(ctx, "fail-me", nil)
	var re *ReplyError
	if !errors.As(err, &re) || re.Message != "nope" {
		t.Fatalf("err = %v, want ReplyError nope", err)
	}
	if err := w.Send("echo", map[string]any{"account": "someone-else"}); err == nil {
		t.Fatal("sent a message naming another account")
	}
	if err := w.Send("log-me", nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !h.log.contains("hello from the worker") {
		if time.Now().After(deadline) {
			t.Fatal("worker log line not written to the API log")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRefusedRunStartEndsTheRun(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	if err := w.Send(TypeRunStart, map[string]any{"run": "refuse-1", "conversation_id": "c1"}); err != nil {
		t.Fatal(err)
	}
	got := h.message(TypeError)
	var body struct {
		Code string `json:"code"`
	}
	_ = got.Decode(&body)
	if got.Run != "refuse-1" || body.Code != "busy" {
		t.Fatalf("handler got %s", got.Raw)
	}
	if live := w.LiveRuns(); len(live) != 0 {
		t.Fatalf("refused run still live: %v", live)
	}
}

// Errors that name a live run without refusing its start leave the run live:
// a duplicate start, or a bad approval.answer, run.steer or run.stop.
func TestRunScopedErrorsThatDoNotRefuseTheStartKeepTheRunLive(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	if err := w.Send(TypeRunStart, map[string]any{"run": "hang-1", "conversation_id": "c1"}); err != nil {
		t.Fatal(err)
	}
	h.message("event")
	if err := w.Send(TypeRunStart, map[string]any{"run": "hang-1", "conversation_id": "c1"}); !errors.Is(err, ErrRunLive) {
		t.Fatalf("second start of a live run: err = %v, want ErrRunLive", err)
	}
	if err := w.Send("approval.answer", map[string]any{"run": "hang-1", "request_id": "x", "choice": "always"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !h.log.contains("choice must be once or deny") {
		if time.Now().After(deadline) {
			t.Fatal("the approval.answer error never arrived")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if live := w.LiveRuns(); len(live) != 1 || live[0] != "hang-1" {
		t.Fatalf("live runs after an approval.answer error = %v, want [hang-1]", live)
	}
	if err := w.Send("run.stop", map[string]any{"run": "hang-1", "reason": "test"}); err != nil {
		t.Fatal(err)
	}
	h.message(TypeRunDone)
	deadline = time.Now().Add(2 * time.Second)
	for len(w.LiveRuns()) > 0 {
		if time.Now().After(deadline) {
			t.Fatalf("run still live after run.done: %v", w.LiveRuns())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A duplicate_run error answering a start's own id still leaves the first
// run live: the worker only says that when the run is already running.
func TestDuplicateRunErrorKeepsTheRunLive(t *testing.T) {
	w := &Worker{runs: map[string]string{"r1": "start-1"}}
	dup := Message{Type: TypeError, ID: "start-1", Account: "a", Run: "r1",
		Raw: json.RawMessage(`{"type":"error","id":"start-1","account":"a","run":"r1","code":"duplicate_run"}`)}
	if w.refusesStart(dup) {
		t.Fatal("duplicate_run counted as a refused start")
	}
	busy := dup
	busy.Raw = json.RawMessage(`{"type":"error","id":"start-1","account":"a","run":"r1","code":"busy"}`)
	if !w.refusesStart(busy) {
		t.Fatal("busy answering the start's id did not end the run")
	}
	other := busy
	other.ID = "go-7"
	if w.refusesStart(other) {
		t.Fatal("an error answering another message ended the run")
	}
}

// A run.start over the line limit is refused in Go before the run is marked
// live: the worker would reject it with an error that names no run.
func TestOversizedRunStartIsRefusedBeforeItGoesLive(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	big := strings.Repeat("x", MaxLineBytes)
	err := w.Send(TypeRunStart, map[string]any{"run": "big-1", "conversation_id": "c1", "user_message": big})
	if !errors.Is(err, ErrLineTooLong) {
		t.Fatalf("err = %v, want ErrLineTooLong", err)
	}
	if live := w.LiveRuns(); len(live) != 0 || w.Busy() {
		t.Fatalf("oversized run went live: %v busy=%v", live, w.Busy())
	}
	if err := w.Send(TypeRunStart, map[string]any{"run": "r2", "conversation_id": "c2", "user_message": strings.Repeat("y", 1<<20)}); err != nil {
		t.Fatalf("a 1 MiB run.start: %v", err)
	}
	h.message(TypeRunDone)
}

func TestShutdownGraceLeavesTimeToInterrupt(t *testing.T) {
	for total, want := range map[time.Duration]int{5 * time.Second: 2, 3 * time.Second: 0, time.Second: 0, 10 * time.Second: 7} {
		if got := shutdownGraceSeconds(total); got != want {
			t.Errorf("shutdownGraceSeconds(%v) = %d, want %d", total, got, want)
		}
	}
}

func TestRunTrackingHandlerAndToolCall(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	if err := w.Send(TypeRunStart, map[string]any{"run": "r1", "conversation_id": "c1"}); err != nil {
		t.Fatal(err)
	}
	if got := h.message("event"); got.Run != "r1" {
		t.Fatalf("event run %q", got.Run)
	}
	if got := h.message("tool.call"); got.ID != "w-r1" {
		t.Fatalf("tool.call id %q", got.ID)
	}
	done := h.message(TypeRunDone)
	var body struct {
		Final string `json:"final_response"`
	}
	_ = done.Decode(&body)
	if body.Final != "context for r1" {
		t.Fatalf("run.done %s", done.Raw)
	}
	deadline := time.Now().Add(time.Second)
	for w.Busy() {
		if time.Now().After(deadline) {
			t.Fatalf("still busy after run.done: %v", w.LiveRuns())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHelloTimeoutKillsTheWorker(t *testing.T) {
	h := newHarness(t, "silent", func(c *Config) { c.HelloTimeout = 300 * time.Millisecond })
	err := h.ensureErr("acct-1")
	if !errors.Is(err, ErrHelloTimeout) {
		t.Fatalf("err = %v, want ErrHelloTimeout", err)
	}
	exit := h.exit(5 * time.Second)
	if !exit.Crashed {
		t.Fatalf("exit %+v: a hello timeout counts as a crash", exit)
	}
	waitGone(t, exit.PID)
}

func TestSelfTestFailureRefusesTheWorker(t *testing.T) {
	h := newHarness(t, "badselftest", nil)
	err := h.ensureErr("acct-1")
	if !errors.Is(err, ErrSelfTestFailed) || !strings.Contains(err.Error(), "timely_gate: plugin not loaded") ||
		strings.Contains(err.Error(), "plugins") {
		t.Fatalf("err = %v", err)
	}
	waitGone(t, h.exit(5*time.Second).PID)
}

func TestProtocolMismatchRefusesTheWorker(t *testing.T) {
	h := newHarness(t, "oldprotocol", nil)
	if err := h.ensureErr("acct-1"); !errors.Is(err, ErrProtocol) || !strings.Contains(err.Error(), "protocol 99") {
		t.Fatalf("err = %v", err)
	}
}

func TestMessageForAnotherAccountKillsTheWorker(t *testing.T) {
	t.Run("at ready", func(t *testing.T) {
		h := newHarness(t, "wrongaccount", nil)
		err := h.ensureErr("acct-1")
		if !errors.Is(err, ErrWorkerExited) || !strings.Contains(err.Error(), "another account") {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("mid-stream", func(t *testing.T) {
		h := newHarness(t, "rogue", nil)
		w := h.ensure("acct-1")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := w.Request(ctx, "echo", map[string]any{"payload": "x"}); !errors.Is(err, ErrWorkerExited) {
			t.Fatalf("err = %v, want ErrWorkerExited", err)
		}
		exit := h.exit(5 * time.Second)
		if !exit.Crashed || !strings.Contains(exit.Reason, "another account") {
			t.Fatalf("exit %+v", exit)
		}
		waitGone(t, exit.PID)
	})
}

func TestGarbageOnStdoutRefusesTheWorker(t *testing.T) {
	h := newHarness(t, "garbage", nil)
	err := h.ensureErr("acct-1")
	if !errors.Is(err, ErrWorkerExited) || !strings.Contains(err.Error(), "not a JSON object") {
		t.Fatalf("err = %v", err)
	}
}

func TestCrashBeforeReadyReportsExitCodeAndStderr(t *testing.T) {
	h := newHarness(t, "crash-on-start", nil)
	err := h.ensureErr("acct-1")
	var se *StartError
	if !errors.As(err, &se) || !errors.Is(err, ErrWorkerExited) || !strings.Contains(err.Error(), "code 3") {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(strings.Join(se.Stderr, "\n"), "boom: cannot import hermes") {
		t.Fatalf("stderr tail %q", se.Stderr)
	}
}

func TestCrashesBackOffThenStopRestarting(t *testing.T) {
	h := newHarness(t, "crash-after-ready", func(c *Config) {
		c.Restart = RestartPolicy{MaxCrashes: 3, Window: time.Minute, BaseBackoff: 100 * time.Millisecond, MaxBackoff: time.Second}
	})
	start := time.Now()
	var crashes int
	var loopErr error
	for attempt := 0; attempt < 10 && loopErr == nil; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		w, err := h.sup.Ensure(ctx, "acct-1")
		cancel()
		if err != nil {
			loopErr = err
			break
		}
		<-w.Done()
		if !w.Exit().Crashed || w.Exit().ExitCode != 4 {
			t.Fatalf("exit %+v", w.Exit())
		}
	}
	for len(h.exits) > 0 {
		<-h.exits
		crashes++
	}
	if !errors.Is(loopErr, ErrCrashLoop) {
		t.Fatalf("err = %v, want ErrCrashLoop", loopErr)
	}
	if crashes != 3 {
		t.Fatalf("%d crashes before the loop guard, want 3", crashes)
	}
	// Backoff after crash 1 (100 ms) and crash 2 (200 ms).
	if elapsed := time.Since(start); elapsed < 300*time.Millisecond {
		t.Fatalf("restarts took %s, want at least the 300 ms backoff", elapsed)
	}
	if !strings.Contains(loopErr.Error(), "exited unexpectedly") {
		t.Fatalf("crash loop error %q does not name the last crash", loopErr)
	}
}

func TestMissedHeartbeatKillsTheWorker(t *testing.T) {
	h := newHarness(t, "deaf", func(c *Config) {
		c.HeartbeatInterval = 50 * time.Millisecond
		c.HeartbeatTimeout = 300 * time.Millisecond
	})
	w := h.ensure("acct-1")
	exit := h.exit(5 * time.Second)
	if !exit.Crashed || !strings.Contains(exit.Reason, "no heartbeat") {
		t.Fatalf("exit %+v", exit)
	}
	waitGone(t, w.PID())
}

func TestPongsKeepAQuietWorkerAlive(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.HeartbeatInterval = 30 * time.Millisecond
		c.HeartbeatTimeout = 200 * time.Millisecond
	})
	w := h.ensure("acct-1")
	time.Sleep(600 * time.Millisecond)
	select {
	case <-w.Done():
		t.Fatalf("worker that answers pings was killed: %+v", w.Exit())
	default:
	}
}

func TestIdleReapWaitsForRunsHoldsAndReportedWork(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.IdleTimeout = 200 * time.Millisecond
		c.ReapInterval = 20 * time.Millisecond
	})
	w := h.ensure("acct-1")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	release := w.Hold()
	if _, err := w.Request(ctx, "set-busy", map[string]any{"busy": map[string]any{"learning": true}}); err != nil {
		t.Fatal(err)
	}
	release()
	time.Sleep(500 * time.Millisecond)
	select {
	case <-w.Done():
		t.Fatal("reaped while the worker reported a learning pass")
	default:
	}
	if _, err := w.Request(ctx, "set-busy", map[string]any{"busy": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	exit := h.exit(5 * time.Second)
	if exit.Crashed || exit.Reason != "idle" || exit.ExitCode != 0 {
		t.Fatalf("exit %+v", exit)
	}
	if _, ok := h.sup.Worker("acct-1"); ok {
		t.Fatal("reaped worker still listed")
	}
	if again := h.ensure("acct-1"); again.PID() == w.PID() {
		t.Fatal("Ensure returned the reaped worker")
	}
}

func TestHoldBlocksReap(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.IdleTimeout = 100 * time.Millisecond
		c.ReapInterval = 20 * time.Millisecond
	})
	w := h.ensure("acct-1")
	release := w.Hold()
	time.Sleep(400 * time.Millisecond)
	select {
	case <-w.Done():
		t.Fatal("reaped while held")
	default:
	}
	release()
	if exit := h.exit(5 * time.Second); exit.Reason != "idle" {
		t.Fatalf("exit %+v", exit)
	}
}

func TestMaxWorkersEvictsIdleAndQueuesBehindBusy(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.MaxWorkers = 1
		c.EvictGrace = time.Millisecond
	})
	a := h.ensure("acct-a")
	time.Sleep(10 * time.Millisecond)
	b := h.ensure("acct-b")
	if exit := h.exit(5 * time.Second); exit.Account != "acct-a" || exit.Reason != "evicted" || exit.Crashed {
		t.Fatalf("exit %+v", exit)
	}
	<-a.Done()

	release := b.Hold()
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	if _, err := h.sup.Ensure(ctx, "acct-c"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want to wait for a slot", err)
	}
	time.Sleep(300 * time.Millisecond)
	if _, ok := h.sup.Worker("acct-c"); ok {
		t.Fatal("a worker started for a caller that gave up while queued")
	}
	select {
	case <-b.Done():
		t.Fatal("a held worker was evicted")
	default:
	}
}

func TestShutdownStopsWorkersAndTheirChildren(t *testing.T) {
	h := newHarness(t, "spawn-child", nil)
	var children []int
	var workers []*Worker
	for _, account := range []string{"acct-1", "acct-2"} {
		w := h.ensure(account)
		workers = append(workers, w)
		echo := fetchReadyEcho(t, h, account)
		if echo.Child == 0 {
			t.Fatal("fake worker reported no child")
		}
		children = append(children, echo.Child)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.sup.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	for _, w := range workers {
		if exit := w.Exit(); exit.Reason != "shutdown" || exit.Crashed {
			t.Fatalf("exit %+v", exit)
		}
		waitGone(t, w.PID())
	}
	for _, pid := range children {
		waitGone(t, pid)
	}
	if _, err := h.sup.Ensure(ctx, "acct-1"); !errors.Is(err, ErrClosed) {
		t.Fatalf("Ensure after shutdown: %v", err)
	}
}

// TestGracefulStopLetsARunFinishWithGo: during the shutdown grace a run may
// still need Go (tool.call, gate.ask), so Go keeps the pipe open and answers;
// it used to refuse every write but shutdown and close stdin at once, so the
// run sat out the grace and ended interrupted.
func TestGracefulStopLetsARunFinishWithGo(t *testing.T) {
	h := newHarness(t, "graceful", func(c *Config) {
		c.ShutdownGrace = 8 * time.Second
	})
	w := h.ensure("acct-1")
	if err := w.Send(TypeRunStart, map[string]any{"run": "hang-1", "conversation_id": "c1"}); err != nil {
		t.Fatal(err)
	}
	h.message("event")
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := h.sup.Stop(ctx, "acct-1", "shutdown"); err != nil {
		t.Fatal(err)
	}
	done := h.message(TypeRunDone)
	if done.Run != "hang-1" || !strings.Contains(string(done.Raw), "context for hang-1") {
		t.Fatalf("run.done %s", done.Raw)
	}
	if took := time.Since(start); took > 4*time.Second {
		t.Fatalf("stop took %s: the run waited out the grace", took)
	}
	if exit := w.Exit(); exit.Crashed || len(exit.LiveRuns) != 0 {
		t.Fatalf("exit %+v", exit)
	}
	// new work is still refused while the worker stops
	if err := w.Send(TypeRunStart, map[string]any{"run": "late", "conversation_id": "c2"}); err == nil {
		t.Fatal("run.start accepted after stop")
	}
}

func TestStubbornWorkerIsKilled(t *testing.T) {
	h := newHarness(t, "stubborn", func(c *Config) {
		c.ShutdownGrace = 200 * time.Millisecond
		c.KillWait = 200 * time.Millisecond
	})
	w := h.ensure("acct-1")
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.sup.Stop(ctx, "acct-1", "shutdown"); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Fatalf("stop took %s", took)
	}
	if exit := w.Exit(); exit.Crashed {
		t.Fatalf("exit %+v", exit)
	}
	waitGone(t, w.PID())
}

func TestRemoveAccountStopsTheWorkerAndDeletesTheHome(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	home := w.Home()
	if err := os.WriteFile(filepath.Join(home, "state.db"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.sup.RemoveAccount(ctx, "acct-1"); err != nil {
		t.Fatal(err)
	}
	if exit := w.Exit(); exit.Reason != "removed" {
		t.Fatalf("exit %+v", exit)
	}
	if _, err := os.Stat(home); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("home still there: %v", err)
	}
	if left, _ := os.ReadDir(h.sup.Layout().Trash()); len(left) != 0 {
		t.Fatalf("trash not emptied: %v", left)
	}
	if err := h.ensureErr("acct-1"); !errors.Is(err, ErrAccountRemoved) {
		t.Fatalf("err = %v", err)
	}
}

func TestNoRuntimeFailsEnsure(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.Runtime = Runtime{}
		c.RuntimeErr = fmt.Errorf("%w: no apps/agent/.venv", ErrNoRuntime)
	})
	if err := h.ensureErr("acct-1"); !errors.Is(err, ErrNoRuntime) || !strings.Contains(err.Error(), ".venv") {
		t.Fatalf("err = %v", err)
	}
}

func TestDefaultHandlerFailsWorkerRequestsClosed(t *testing.T) {
	// With no handler, Go answers tool.call with an error result and gate.ask
	// with a block verdict (failClosed). The fake reports both answers back
	// as events; a probe handler hands requests to failClosed and records
	// the events.
	var mu sync.Mutex
	var seen []string
	h := newHarness(t, "ok", func(c *Config) {
		c.Handler = func(w *Worker, m Message) {
			if m.ID != "" {
				failClosed(w, m)
				return
			}
			mu.Lock()
			seen = append(seen, string(m.Raw))
			mu.Unlock()
		}
	})
	w := h.ensure("acct-1")
	if err := w.Send(TypeRunStart, map[string]any{"run": "r1"}); err != nil {
		t.Fatal(err)
	}
	if err := w.Send("ask-gate", map[string]any{"run": "r1"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		all := strings.Join(seen, "\n")
		mu.Unlock()
		if strings.Contains(all, "cannot run this tool") && strings.Contains(all, `"verdict":"block"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no fail-closed replies seen: %s", all)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if live := w.LiveRuns(); len(live) != 1 {
		t.Fatalf("live runs %v", live)
	}
}

func TestExitReportsLiveRuns(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) { c.Handler = func(*Worker, Message) {} })
	w := h.ensure("acct-1")
	if err := w.Send(TypeRunStart, map[string]any{"run": "r9"}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.sup.Stop(ctx, "acct-1", "shutdown"); err != nil {
		t.Fatal(err)
	}
	if exit := h.exit(5 * time.Second); len(exit.LiveRuns) != 1 || exit.LiveRuns[0] != "r9" {
		t.Fatalf("exit %+v", exit)
	}
	if err := w.Send("echo", nil); !errors.Is(err, ErrWorkerExited) {
		t.Fatalf("send after exit: %v", err)
	}
}

func TestRefusedHelloAndRefusedEnvironment(t *testing.T) {
	t.Run("hello", func(t *testing.T) {
		h := newHarness(t, "refuse-hello", nil)
		err := h.ensureErr("acct-1")
		if !errors.Is(err, ErrWorkerRefused) || !strings.Contains(err.Error(), "config_mismatch") {
			t.Fatalf("err = %v", err)
		}
		waitGone(t, h.exit(5*time.Second).PID)
	})
	t.Run("environment", func(t *testing.T) {
		h := newHarness(t, "env-refused", nil)
		err := h.ensureErr("acct-1")
		if !errors.Is(err, ErrWorkerExited) || !strings.Contains(err.Error(), "code 5") ||
			!strings.Contains(err.Error(), "worker environment refused") {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestRenderAccountHashGoesInHello(t *testing.T) {
	t.Setenv("JWT_SECRET", "jwt-secret-value")
	settings := json.RawMessage(`{"timezone":"UTC"}`)
	h := newHarness(t, "ok", func(c *Config) {
		c.RenderAccount = true
		c.Account = func(context.Context, string) (AccountSpec, error) { return AccountSpec{Settings: settings}, nil }
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	res, err := h.sup.Prepare(ctx, map[string]any{"browser_executable": ""})
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(h.sup.Layout().Root, "seed", "skills"); res.SeedSkillsDir != want {
		t.Fatalf("seed %q, want %q", res.SeedSkillsDir, want)
	}
	h.ensure("acct-1")
	echo := fetchReadyEcho(t, h, "acct-1")
	sum := sha256.Sum256(settings)
	if want := "cfg-" + hex.EncodeToString(sum[:8]); echo.Hello.SettingsHash != want {
		t.Fatalf("hello settings_hash %q, want render-account's %q", echo.Hello.SettingsHash, want)
	}
	if echo.Hello.ManagedSHA256 == "" || echo.Hello.ManagedSHA256 != res.ManagedSHA256 ||
		echo.Hello.TimelySkills != res.TimelySkillsDir {
		t.Fatalf("hello lacks prepare's answer: managed %q skills %q, prepare %+v",
			echo.Hello.ManagedSHA256, echo.Hello.TimelySkills, res)
	}
	// The default-off skills come from prepare's answer in memory, never from
	// runtime/prepared.json (the fake render-account fails without them).
	if strings.Join(echo.Hello.DefaultOff, ",") != "imessage" {
		t.Fatalf("hello skills_default_off %q, want prepare's [imessage]", echo.Hello.DefaultOff)
	}
	env := strings.Join(echo.Env, "\n")
	if !strings.Contains(env, "HERMES_BUNDLED_SKILLS="+res.SeedSkillsDir) {
		t.Fatalf("seed tree not passed to the worker: %s", env)
	}
	if strings.Contains(env, "jwt-secret-value") {
		t.Fatal("secret reached the worker")
	}
}

// The managed overlay wins over every account's config, so an edit to
// managed/config.yaml after prepare (from an approved command in any account)
// must stop every later spawn, not only fail the worker's own canary.
func TestEditedManagedConfigStopsTheStart(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) { c.RenderAccount = true })
	h.ensure("acct-1")
	managed := filepath.Join(h.sup.Layout().Managed(), "config.yaml")
	data, err := os.ReadFile(managed)
	if err != nil {
		t.Fatal(err)
	}
	edited := string(bytes.TrimRight(data, "\n}")) + `, "command_allowlist": ["plugin_rule:timely:call_1"]}` + "\n"
	if err := os.WriteFile(managed, []byte(edited), 0o644); err != nil {
		t.Fatal(err)
	}
	err = h.ensureErr("acct-2")
	if !errors.Is(err, ErrManagedChanged) {
		t.Fatalf("err = %v, want ErrManagedChanged", err)
	}
	if err := os.WriteFile(managed, data, 0o644); err != nil {
		t.Fatal(err)
	}
	h.ensure("acct-2") // the file prepare wrote is accepted again
}

func TestRenderAccountFailureStopsTheStart(t *testing.T) {
	h := newHarness(t, "render-fails", func(c *Config) { c.RenderAccount = true })
	err := h.ensureErr("acct-1")
	if !errors.Is(err, ErrHelperFailed) || !strings.Contains(err.Error(), "bad settings") {
		t.Fatalf("err = %v", err)
	}
	select {
	case e := <-h.exits:
		t.Fatalf("a worker was spawned: %+v", e)
	default:
	}
}

func TestRootIsMadeAbsolute(t *testing.T) {
	h := newHarness(t, "ok", nil)
	if !filepath.IsAbs(h.sup.Layout().Root) {
		t.Fatalf("root %q", h.sup.Layout().Root)
	}
	sup := New(Config{Root: filepath.Join("data", "agent"), Logf: func(string, ...any) {}})
	defer func() { _ = sup.Shutdown(context.Background()) }()
	if !filepath.IsAbs(sup.Layout().Root) {
		t.Fatalf("relative root kept: %q", sup.Layout().Root)
	}
}

// bigSettings is account settings larger than any pipe buffer (64 KiB on
// Linux, less on Windows), so writing the hello blocks until the worker reads.
func bigSettings() json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"soul": %q}`, strings.Repeat("s", 256<<10)))
}

func TestHelloTimeoutBoundsAHelloTheWorkerNeverReads(t *testing.T) {
	h := newHarness(t, "noread", func(c *Config) {
		c.HelloTimeout = 500 * time.Millisecond
		c.Account = func(context.Context, string) (AccountSpec, error) {
			return AccountSpec{Settings: bigSettings()}, nil
		}
	})
	start := time.Now()
	err := h.ensureErr("acct-1")
	if !errors.Is(err, ErrHelloTimeout) {
		t.Fatalf("err = %v after %s, want ErrHelloTimeout", err, time.Since(start))
	}
	if took := time.Since(start); took > 4*time.Second {
		t.Fatalf("Ensure took %s; the hello write was not bounded by HelloTimeout", took)
	}
	exit := h.exit(5 * time.Second)
	if !exit.Crashed {
		t.Fatalf("exit %+v: a hello timeout counts as a crash", exit)
	}
	waitGone(t, exit.PID)
	if _, ok := h.sup.Worker("acct-1"); ok {
		t.Fatal("the stuck worker is still listed")
	}
	// the entry is free again: the next start is a new attempt, not a hang on the old one
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if _, err := h.sup.Ensure(ctx, "acct-1"); !errors.Is(err, ErrHelloTimeout) {
		t.Fatalf("second Ensure: %v, want ErrHelloTimeout", err)
	}
}

func TestWriteToAWorkerThatStoppedReadingIsBounded(t *testing.T) {
	h := newHarness(t, "stopreading", func(c *Config) { c.WriteTimeout = time.Second })
	w := h.ensure("acct-1")
	big := map[string]any{"payload": strings.Repeat("p", 256<<10)}

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := w.Request(ctx, "echo", big); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Request: %v, want the caller's deadline", err)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Fatalf("Request took %s past its 300ms context", took)
	}
	sendDone := make(chan error, 1)
	go func() { sendDone <- w.Send("echo", big) }()
	select {
	case err := <-sendDone:
		if err == nil {
			t.Fatal("Send to a worker that reads nothing succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Send blocked past WriteTimeout")
	}
	exit := h.exit(5 * time.Second)
	if !exit.Crashed || !strings.Contains(exit.Reason, "has not read") {
		t.Fatalf("exit %+v: want a crash for a worker that stopped reading", exit)
	}
	waitGone(t, exit.PID)
}

// A run.start that waited in the queue behind a slow write must not report
// the caller's deadline once its own write is under way: the line reaches a
// healthy worker and the run goes live, so Send's error would be a lie.
func TestSendRunStartNeverFailsAfterItsLineWasWritten(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) { c.WriteTimeout = time.Second })
	w := h.ensure("acct-1")
	pad := strings.Repeat("p", 1<<20) // far past the pipe buffer: the write waits for the reader
	if err := w.Send("stutter", map[string]any{"sleep": 0.6}); err != nil {
		t.Fatal(err)
	}
	go func() { _ = w.Send("stutter", map[string]any{"sleep": 0.6, "pad": pad}) }()
	time.Sleep(50 * time.Millisecond) // the padded stutter is writeLoop's
	start := time.Now()
	err := w.Send(TypeRunStart, map[string]any{"run": "run-B", "conversation_id": "c", "pad": pad})
	took := time.Since(start)
	done := h.message("run.done")
	if done.Run != "run-B" {
		t.Fatalf("run.done for %q", done.Run)
	}
	if err != nil {
		t.Fatalf("Send(run.start) after %s: %v, but run-B went live and finished on a healthy worker", took, err)
	}
	if w.hasExited() {
		t.Fatal("worker exited")
	}
}

func TestReadyPIDOutsideTheProcessGroupIsRefused(t *testing.T) {
	h := newHarness(t, "foreignpid", nil)
	err := h.ensureErr("acct-1")
	if !errors.Is(err, ErrProtocol) || !strings.Contains(err.Error(), "outside its process group") {
		t.Fatalf("err = %v", err)
	}
	waitGone(t, h.exit(5*time.Second).PID)
}

// A worker whose containment cannot be confirmed (the pid check fails, or
// ready names no pid) could survive every stop, so it is refused like one
// outside its group, never accepted with a log line.
func TestReadyPIDThatCannotBeCheckedIsRefused(t *testing.T) {
	for _, mode := range []string{"deadpid", "nopid"} {
		t.Run(mode, func(t *testing.T) {
			h := newHarness(t, mode, nil)
			err := h.ensureErr("acct-1")
			if !errors.Is(err, ErrProtocol) || !strings.Contains(err.Error(), "cannot confirm") {
				t.Fatalf("err = %v", err)
			}
			waitGone(t, h.exit(5*time.Second).PID)
		})
	}
}
