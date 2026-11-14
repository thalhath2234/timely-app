package chat

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
)

// Phase 5 through the real Python worker (apps/agent) on the model shim
// (apps/api/scripts/agentqa/ollama_shim.py over the stub model, 127.0.0.1
// only, never a live provider), Go and PostgreSQL: host cards for the
// terminal, their Run once, Deny and Allow for this chat, Stop (during the
// live wait and right after Run once), a card left past the live wait that
// parks and frees the worker and a Run once that runs the command exactly
// once in a continuation, an MCP Ask me first tool on a local fake server,
// and two accounts of which only the host-allowed one gets host tools. The
// fake-worker tests in engine_host_integration_test.go pin Go's half; these
// prove the worker really sends what they replay. Skipped unless
// TIMELY_AGENT_TEST_RUNTIME names the runtime and CHAT_TEST_ENV the test
// database:
//
//	TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration
//
// Safety (work packages decision 20): host tools act on the machine they run
// on, so every worker here sees a throwaway "real" home and working folder
// under $HOME/.cache/p5-sandbox (refused anywhere else) and starts under the
// exec trap (apps/agent/tests/exec_trap.py), which records every process the
// worker starts and swaps a destructive command line for an echo. The
// commands are harmless (echo, shell arithmetic); the one destructive line
// (rm -rf in the Deny case) is never approved and the trap would stop it
// anyway. The MCP server is the local fake_mcp_echo.py. Never ~/.hermes, the
// real home or the real browser profile.
//
// Every suite here ends with the exit audit of phase 5 (decision 16):
// hostRunViolations over agent_host_events (every host call that ran has an
// approved or allowed event before it, once) and a lane watch that found no
// host_approval row claimed or leased (no lane held during a wait).

// ---------------------------------------------------------------- the exit audit

// hostRunViolations is the exit check over a chat's (or a whole test
// database's) host events, oldest first: every call that ran, whatever its
// status except "blocked" (which never started), has an approved or allowed
// event before it, and each such event covers one run only. A continuation
// run has a new call id, so its allowed event ("continuation of an approved
// parked card") names the original tool and arguments instead, and matches
// by those. An empty result is zero unapproved host executions.
func hostRunViolations(evs []AgentHostEvent) []string {
	used := map[int]bool{}
	var out []string
	for i, e := range evs {
		if e.Kind != eventRan {
			continue
		}
		var detail struct {
			Status string `json:"status"`
		}
		_ = json.Unmarshal(e.Detail, &detail)
		if detail.Status == "blocked" {
			continue
		}
		covered := -1
		for j := 0; j < i; j++ {
			p := evs[j]
			if used[j] || p.ConversationID != e.ConversationID || (p.Kind != eventApproved && p.Kind != eventAllowed) {
				continue
			}
			byCall := e.ToolCallID != "" && p.ToolCallID == e.ToolCallID
			byContinuation := p.Kind == eventAllowed && strings.HasPrefix(p.Reason, "continuation") && p.Tool == e.Tool && p.ArgsHash != "" && p.ArgsHash == e.ArgsHash
			if byCall || byContinuation {
				covered = j
				break
			}
		}
		if covered < 0 {
			out = append(out, fmt.Sprintf("%s call %s (%s, status %q) ran with no approved or allowed event before it: %v", e.ConversationID, e.ToolCallID, e.Tool, detail.Status, eventKinds(evs)))
			continue
		}
		used[covered] = true
	}
	return out
}

// hostLaneViolation says why a row breaks "no lane is held during a host
// wait" (decision 1), or "": a host_approval row never holds a lease, and a
// row that is running never still carries a card (the claim never takes a
// card's row).
func hostLaneViolation(c Conversation) string {
	switch {
	case c.Status == statusHostApproval && (c.Lease != "" || c.LeaseUntil != nil):
		return fmt.Sprintf("chat %s waits on a host card and holds lease %q until %v", c.ID, c.Lease, c.LeaseUntil)
	case c.Status == statusHostApproval && !c.HostRequest.pending():
		return fmt.Sprintf("chat %s is host_approval with no card", c.ID)
	case c.Status != statusHostApproval && c.HostRequest.pending():
		return fmt.Sprintf("chat %s is %s but still carries card %s", c.ID, c.Status, c.HostRequest.RequestID)
	}
	return ""
}

// watchHostLanes samples every chat row while a test runs and fails the
// test, when it ends, if any sample broke hostLaneViolation. It returns how
// many samples saw a card waiting (a watch that never saw one proves
// nothing).
func (h *engineHarness) watchHostLanes() func() int {
	h.t.Helper()
	var mu sync.Mutex
	var found []string
	waiting := 0
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(15 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tick.C:
			}
			var rows []Conversation
			if err := h.db.Select("id", "status", "lease", "lease_until", "host_request").Find(&rows).Error; err != nil {
				continue
			}
			mu.Lock()
			for _, c := range rows {
				if c.Status == statusHostApproval {
					waiting++
				}
				if v := hostLaneViolation(c); v != "" && !slices.Contains(found, v) {
					found = append(found, v)
				}
			}
			mu.Unlock()
		}
	}()
	var once sync.Once
	finish := func() int {
		once.Do(func() { close(stop); <-done })
		mu.Lock()
		defer mu.Unlock()
		for _, v := range found {
			h.t.Errorf("lane watch: %s", v)
		}
		return waiting
	}
	h.t.Cleanup(func() { finish() })
	return finish
}

// exitAudit runs the audit over every host event in the test database.
func (h *engineHarness) exitAudit() {
	h.t.Helper()
	var evs []AgentHostEvent
	if err := h.db.Order("created_at, id").Find(&evs).Error; err != nil {
		h.t.Fatal(err)
	}
	for _, v := range hostRunViolations(evs) {
		h.t.Errorf("exit audit: %s", v)
	}
}

// The audit itself fails when it should: an unapproved run, a run covered by
// a card that was only denied, an approval used twice, a continuation that
// matches the wrong arguments, and a card row that holds a lease.
func TestExitAuditFlagsWhatItMustFlag(t *testing.T) {
	at := time.Now()
	ev := func(kind, cid, call, tool, hash, reason, status string) AgentHostEvent {
		d, _ := json.Marshal(map[string]any{"status": status})
		at = at.Add(time.Millisecond)
		return AgentHostEvent{ConversationID: cid, ToolCallID: call, Tool: tool, ArgsHash: hash, Kind: kind, Reason: reason, Detail: d, CreatedAt: at}
	}
	cases := []struct {
		name string
		evs  []AgentHostEvent
		bad  int
	}{
		{"approved then ran", []AgentHostEvent{ev(eventRequested, "c1", "k1", "terminal", "h1", "", ""), ev(eventApproved, "c1", "k1", "terminal", "h1", "", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok")}, 0},
		{"allowed then ran", []AgentHostEvent{ev(eventAllowed, "c1", "k1", "terminal", "h1", "Auto", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok")}, 0},
		{"ran with no approval", []AgentHostEvent{ev(eventRequested, "c1", "k1", "terminal", "h1", "", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok")}, 1},
		{"denied then ran", []AgentHostEvent{ev(eventDenied, "c1", "k1", "terminal", "h1", "", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok")}, 1},
		{"denied, blocked ran report", []AgentHostEvent{ev(eventDenied, "c1", "k1", "terminal", "h1", "", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "blocked")}, 0},
		{"one approval, two runs", []AgentHostEvent{ev(eventApproved, "c1", "k1", "terminal", "h1", "", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok"), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok")}, 1},
		{"approval of another chat", []AgentHostEvent{ev(eventApproved, "c2", "k1", "terminal", "h1", "", ""), ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok")}, 1},
		{"approved after the run", []AgentHostEvent{ev(eventRan, "c1", "k1", "terminal", "h1", "", "ok"), ev(eventApproved, "c1", "k1", "terminal", "h1", "", "")}, 1},
		{"continuation by tool and arguments", []AgentHostEvent{ev(eventApproved, "c1", "k1", "terminal", "h1", "", ""), ev(eventAllowed, "c1", "k1", "terminal", "h1", "continuation of an approved parked card", ""), ev(eventRan, "c1", "k2", "terminal", "h1", "", "ok")}, 0},
		{"continuation with other arguments", []AgentHostEvent{ev(eventAllowed, "c1", "k1", "terminal", "h1", "continuation of an approved parked card", ""), ev(eventRan, "c1", "k2", "terminal", "h2", "", "ok")}, 1},
		{"a grant's reason is not a continuation", []AgentHostEvent{ev(eventAllowed, "c1", "k1", "terminal", "h1", "Allowed for this chat: echo", ""), ev(eventRan, "c1", "k2", "terminal", "h1", "", "ok")}, 1},
	}
	for _, c := range cases {
		if got := hostRunViolations(c.evs); len(got) != c.bad {
			t.Errorf("%s: %d violations %v, want %d", c.name, len(got), got, c.bad)
		}
	}
	lease := time.Now()
	card := HostRequest{RequestID: "r1"}
	for name, row := range map[string]Conversation{
		"leased card":      {ID: "c", Status: statusHostApproval, Lease: "lease_x", HostRequest: card},
		"leased until":     {ID: "c", Status: statusHostApproval, LeaseUntil: &lease, HostRequest: card},
		"card without row": {ID: "c", Status: statusHostApproval},
		"running a card":   {ID: "c", Status: "running", HostRequest: card},
		"queued a card":    {ID: "c", Status: "queued", HostRequest: card},
	} {
		if hostLaneViolation(row) == "" {
			t.Errorf("%s: no violation", name)
		}
	}
	for name, row := range map[string]Conversation{
		"a waiting card": {ID: "c", Status: statusHostApproval, HostRequest: card},
		"a running chat": {ID: "c", Status: "running", Lease: "lease_x", LeaseUntil: &lease},
		"an idle chat":   {ID: "c", Status: "idle"},
	} {
		if v := hostLaneViolation(row); v != "" {
			t.Errorf("%s: %s", name, v)
		}
	}
}

// ---------------------------------------------------------------- the sandbox and the trap

// p5Sandbox is the throwaway "real" home and working folder of one test, and
// the exec trap's log.
type p5Sandbox struct {
	root, home, work, trapLog string
}

func newP5Sandbox(t *testing.T) p5Sandbox {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell commands")
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	base := agenthost.SandboxRoot(userHome)
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(base, "gotest-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if strings.HasPrefix(root, base+string(filepath.Separator)) {
			_ = os.RemoveAll(root)
		}
	})
	sb := p5Sandbox{root: root, home: filepath.Join(root, "home"), work: filepath.Join(root, "work"), trapLog: filepath.Join(root, "exec-trap.jsonl")}
	for _, dir := range []string{sb.home, sb.work} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for _, dotfile := range []string{".gitconfig", ".bashrc", ".profile"} {
		if err := os.WriteFile(filepath.Join(sb.home, dotfile), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// The same refusal the API applies to TIMELY_AGENT_REAL_HOME: a real home
	// outside the sandbox is never used.
	env := map[string]string{agenthost.RealHomeEnv: sb.home, "DB_SCHEMA": "p5test"}
	if dir, ok, err := agenthost.TestRealHome(func(k string) string { return env[k] }, userHome); err != nil || !ok {
		t.Fatalf("the sandbox home %s is not an accepted test real home: %v", sb.home, err)
	} else if resolved, _ := filepath.EvalSymlinks(sb.home); dir != resolved && dir != sb.home {
		t.Fatalf("test real home %s, want %s", dir, sb.home)
	}
	return sb
}

// trapRecord is one line of the exec trap's log: a process the worker started.
type trapRecord struct {
	Cmd     string `json:"cmd"`
	Cwd     string `json:"cwd"`
	Home    string `json:"home"`
	Trapped bool   `json:"trapped"`
}

func (s p5Sandbox) records() []trapRecord {
	f, err := os.Open(s.trapLog)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []trapRecord
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var r trapRecord
		if json.Unmarshal(sc.Bytes(), &r) == nil {
			out = append(out, r)
		}
	}
	return out
}

// ran are the shell commands that really started (not trapped) and hold
// marker; Hermes' own helpers (its checkpoint's git calls) are not counted.
func (s p5Sandbox) ran(marker string) []trapRecord {
	var out []trapRecord
	for _, r := range s.records() {
		first, _, _ := strings.Cut(r.Cmd, " ")
		if strings.Contains(r.Cmd, marker) && !r.Trapped && slices.Contains([]string{"bash", "sh", "zsh", "dash"}, filepath.Base(first)) {
			out = append(out, r)
		}
	}
	return out
}

// mentions are the trap's records that hold marker at all (a trapped
// destructive line included): none for a command that never reached a spawn.
func (s p5Sandbox) mentions(marker string) int {
	n := 0
	for _, r := range s.records() {
		if strings.Contains(r.Cmd, marker) {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------- the world

// fakeMCPRules is the account's MCP servers as agentmcp would answer, over a
// map a test edits.
type fakeMCPRules struct {
	mu    sync.Mutex
	modes map[string]string
}

func (f *fakeMCPRules) set(server, mode string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.modes[server] = mode
}

func (f *fakeMCPRules) Mode(_ context.Context, _, server string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if m, ok := f.modes[server]; ok {
		return m
	}
	return mcpOff
}

func (f *fakeMCPRules) Classify(context.Context, string, string, string, MCPAnnotations) agent.HostAction {
	return agent.HostAction{Kind: agent.HostSend}
}

func (f *fakeMCPRules) ApproveStdio(context.Context, string, string, string) error { return nil }

func (f *fakeMCPRules) Servers(context.Context, string) map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]string{}
	for k, v := range f.modes {
		out[k] = v
	}
	return out
}

type hostOpts struct {
	liveWait time.Duration // run.start.host_live_wait_s (default: far longer than a test)
	parkFor  time.Duration // how long a parked card waits (default: far longer than a test)
	idle     time.Duration // the worker's idle timeout (default 15 minutes)
	// slowFence makes the worker's dispatch fence wait this long before it
	// checks whether the run was stopped (probe_boot --slow-fence), so a Stop
	// can land between Run once and the tool starting.
	slowFence time.Duration
	// mcpMode, when set, adds the local fake MCP server in that mode.
	mcpMode string
}

// hostWorld is the engine on the real worker with user-a host-allowed (its
// real home and working folder in the sandbox, every command under the exec
// trap) and user-b not.
type hostWorld struct {
	*engineHarness
	rec   *modelRecorder
	sb    p5Sandbox
	mcp   *fakeMCPRules
	lanes func() int
	liveS int
}

// agentTests is the runtime's apps/agent/tests folder ("" when rt is not a
// dev runtime).
func agentTests(rt agenthost.Runtime) string {
	for _, arg := range rt.Args {
		if strings.HasSuffix(arg, "boot.py") {
			return filepath.Join(filepath.Dir(filepath.Dir(arg)), "tests")
		}
	}
	return ""
}

// startShim runs the agentqa model shim (stub_openai.py with the host
// shorthands) on 127.0.0.1 with the runtime's own interpreter and returns its
// base URL.
func startShim(t *testing.T, rt agenthost.Runtime) string {
	t.Helper()
	tests := agentTests(rt)
	shim, err := filepath.Abs(filepath.Join("..", "..", "..", "scripts", "agentqa", "ollama_shim.py"))
	if err != nil || tests == "" {
		t.Skipf("cannot find the model shim for runtime %v", rt.Args)
	}
	if _, err := os.Stat(shim); err != nil {
		t.Skipf("no model shim at %s", shim)
	}
	cmd := exec.Command(rt.Program, "-I", shim, "0", tests)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line, err := bufio.NewReader(out).ReadString('\n')
	if err != nil {
		t.Fatalf("model shim: %v", err)
	}
	return "http://127.0.0.1:" + strings.TrimSpace(line) + "/v1"
}

// trapRuntime is rt started through tests/contract/probe_boot.py with the
// exec trap installed (and any other probe flags).
func trapRuntime(t *testing.T, rt agenthost.Runtime, log string, flags ...string) agenthost.Runtime {
	t.Helper()
	probe := filepath.Join(agentTests(rt), "contract", "probe_boot.py")
	if _, err := os.Stat(probe); err != nil {
		t.Skipf("no probe_boot.py next to runtime %v", rt.Args)
	}
	args := append([]string{"-I", probe, "--exec-trap", log}, flags...)
	return agenthost.Runtime{Program: rt.Program, Args: args}
}

// mcpEntryHash is config_render.mcp_entry_hash: sha256 of the entry's
// canonical JSON (sorted keys, no spaces).
func mcpEntryHash(entry map[string]any) string {
	raw, _ := json.Marshal(entry)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func newHostWorld(t *testing.T, o hostOpts) *hostWorld {
	t.Helper()
	rt := realRuntime(t)
	sb := newP5Sandbox(t)
	rec := recordModel(t, startShim(t, rt))
	var flags []string
	if o.slowFence > 0 {
		flags = append(flags, "--slow-fence", fmt.Sprint(o.slowFence.Seconds()))
	}
	if o.liveWait <= 0 {
		o.liveWait = 10 * time.Minute
	}
	if o.parkFor <= 0 {
		o.parkFor = time.Hour
	}
	w := &hostWorld{rec: rec, sb: sb, liveS: int(o.liveWait / time.Second)}
	hostSet := func(extra map[string]any) json.RawMessage {
		s := map[string]any{
			"toolsets": []string{"timely", "todo", "skills", "terminal", "file", "code_execution", "browser-use", "browser-cdp"},
			"learning": map[string]bool{"memory": false, "user_profile": false}, "curator": false, "timezone": "UTC",
			"host_allowed": true, "terminal_home_mode": "real", "working_dir": sb.work, "checkpoints": true,
			// The sandbox profile is not a real browser profile; the browser is
			// proven by the worker's own suite and the live checks.
			"browser":            map[string]bool{"use_real_profile": false},
			"approval_timeout_s": w.liveS,
		}
		for k, v := range extra {
			s[k] = v
		}
		raw, _ := json.Marshal(s)
		return raw
	}
	var mcpSettings map[string]any
	if o.mcpMode != "" {
		entry := map[string]any{"command": rt.Program, "args": []string{"-I", filepath.Join(agentTests(rt), "contract", "fake_mcp_echo.py")}}
		mcpSettings = map[string]any{"mcp_servers": map[string]any{"fake": entry}, "approved_mcp_hashes": []string{mcpEntryHash(entry)},
			"mcp_modes": map[string]string{"fake": o.mcpMode}}
		w.mcp = &fakeMCPRules{modes: map[string]string{"fake": o.mcpMode}}
	}
	cfg := agenthost.Config{
		Root:          realWorkerRoot(t),
		Runtime:       trapRuntime(t, rt, sb.trapLog, flags...),
		RenderAccount: true,
		HelloTimeout:  90 * time.Second,
		Env:           agenthost.EnvConfig{Path: os.Getenv("PATH"), RealHome: sb.home},
		IdleTimeout:   o.idle,
		Account: func(_ context.Context, uid string) (agenthost.AccountSpec, error) {
			if uid != "user-a" {
				// A chat-only account: no host settings, as Go renders for an
				// account that is not host-allowed.
				return agenthost.AccountSpec{Settings: json.RawMessage(`{"toolsets":["timely","todo","skills"],"learning":{"memory":false,"user_profile":false},"curator":false,"timezone":"UTC","host_allowed":false}`)}, nil
			}
			return agenthost.AccountSpec{Settings: hostSet(mcpSettings)}, nil
		},
	}
	if o.idle > 0 {
		cfg.ReapInterval = 250 * time.Millisecond
	}
	h := newEngineHarnessWith(t, cfg, stubModelAt(rec), func(e *WorkerEngineOptions) {
		e.HostAllowed = func(_ context.Context, uid string) bool { return uid == "user-a" }
		e.HostWorkingDir = func(context.Context, string) string { return sb.work }
		e.LiveWait = o.liveWait
		e.ParkFor = func(context.Context, string) time.Duration { return o.parkFor }
		e.HostSweepEvery = 200 * time.Millisecond
		e.RenewEvery = 50 * time.Millisecond
		if w.mcp != nil {
			e.MCP = w.mcp
		}
	})
	w.engineHarness = h
	w.lanes = h.watchHostLanes()
	t.Cleanup(h.exitAudit)
	return w
}

// hostChat queues a Supervised (unless said) agent-engine chat of uid.
func (w *hostWorld) hostChat(uid, text, permission string) Conversation {
	w.t.Helper()
	c := Conversation{ID: id("chat_"), UserID: uid, Title: "Agent", Status: "queued", Phase: "plan", Engine: engineAgent,
		Permission: permission, Provider: "openrouter", Model: "stub-model", Client: "web", Context: []ContextChip{},
		Messages: []Message{message("user", text)}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if err := w.db.Create(&c).Error; err != nil {
		w.t.Fatal(err)
	}
	return c
}

// until waits for the chat (two minutes: a cold worker starts in it). A chat
// that failed ends the wait at once.
func (w *hostWorld) until(cid, what string, ok func(Conversation) bool) Conversation {
	w.t.Helper()
	deadline := time.Now().Add(90 * time.Second)
	for {
		var c Conversation
		if err := w.db.First(&c, "id = ?", cid).Error; err != nil {
			w.t.Fatal(err)
		}
		if ok(c) {
			return c
		}
		if c.Status == "failed" || time.Now().After(deadline) {
			card, _ := json.Marshal(c.HostRequest)
			w.t.Fatalf("chat never %s: status %s error %q host card %s", what, c.Status, c.Error, card)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func (w *hostWorld) card(cid, phase string) Conversation {
	w.t.Helper()
	c := w.until(cid, "waited on a "+phase+" host card", func(c Conversation) bool {
		return c.Status == statusHostApproval && c.HostRequest.Phase == phase
	})
	// Long enough for the lane watch (every 15 ms) to sample the card a few times.
	time.Sleep(100 * time.Millisecond)
	return c
}

// answer posts the card's answer as a signed-in web browser.
func (w *hostWorld) answer(c Conversation, choice string) {
	w.t.Helper()
	code, body := w.answerCard(c.ID, c.HostRequest.RequestID, choice, `{"kind":"web","name":"test browser"}`)
	if code != 200 {
		w.t.Fatalf("answer %s: %d %s", choice, code, body)
	}
}

// modelRan is what the model's last request for tag saw as tool results.
func (w *hostWorld) toolSeen(tag string) string {
	calls := w.rec.with(tag)
	if len(calls) == 0 {
		return ""
	}
	return strings.Join(calls[len(calls)-1].toolTexts(), "\n")
}

// offered are the tools the chat's first model request offered (nil when the
// model was never asked).
func (w *hostWorld) offered(tag string) []string {
	calls := w.rec.with(tag)
	if len(calls) == 0 {
		return nil
	}
	return calls[0].toolNames()
}

// toolNames are the tools one model request offered.
func (c modelCall) toolNames() []string {
	var body struct {
		Tools []struct {
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(c.Body, &body)
	var out []string
	for _, t := range body.Tools {
		out = append(out, t.Function.Name)
	}
	return out
}

// executed are the host.ran events of calls that started (any status but
// "blocked"), with their status.
func executed(evs []AgentHostEvent) []string {
	var out []string
	for _, e := range eventsOf(evs, eventRan) {
		var d struct {
			Status string `json:"status"`
		}
		_ = json.Unmarshal(e.Detail, &d)
		if d.Status != "blocked" {
			out = append(out, d.Status)
		}
	}
	return out
}

func eventsOf(evs []AgentHostEvent, kind string) []AgentHostEvent {
	var out []AgentHostEvent
	for _, e := range evs {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

// ---------------------------------------------------------------- the tests

// Supervised terminal cards through the real worker: the card reaches the
// row with the command and the working folder and no lease (the run waits
// live, the model is not asked again); Run once runs the command exactly
// once as the sandbox's home user in the working folder, and its output
// reaches the reply; Deny leaves the command unrun and the model reads the
// refusal and goes on.
func TestIntegrationAgentEngineRealWorkerHostRunOnceAndDeny(t *testing.T) {
	w := newHostWorld(t, hostOpts{})

	// 1. Run once.
	const sum = "printf p5-%s-%s one two" // its output (p5-one-two) differs from its text
	tag := "tag-host-once"
	c := w.hostChat("user-a", stubScript(tag, stubCalls("terminal", obj{"command": sum})), "supervised")
	c = w.card(c.ID, hostLive)
	hr := c.HostRequest
	if hr.Run == "" || hr.Run != c.AgentRunID || hr.Tool != "terminal" || len(hr.ArgsHash) != 64 || hr.Card == nil || hr.Card.Kind != cardTerminal ||
		hr.Card.Command != sum || !hr.Card.Grantable || hr.AskedAt == nil || hr.LiveUntil == nil || hr.LiveUntil.Sub(*hr.AskedAt) != w.e.opts.LiveWait {
		t.Fatalf("card %+v", hr)
	}
	if c.Lease != "" || c.LeaseUntil != nil {
		t.Fatalf("a waiting card's row holds a lease: %q %v", c.Lease, c.LeaseUntil)
	}
	time.Sleep(700 * time.Millisecond) // a lease renewal or a claim would show now
	if n := len(w.rec.with(tag)); n != 1 {
		t.Fatalf("%d model requests while the card waits, want 1", n)
	}
	if n := len(w.sb.ran(sum)); n != 0 {
		t.Fatalf("the command ran %d times before the answer", n)
	}
	w.answer(c, "once")
	c = w.until(c.ID, "replied", statusIs("idle"))
	if reply := lastMessage(c).Content; !strings.Contains(reply, "p5-one-two") {
		t.Fatalf("reply %q does not hold the command's output", reply)
	}
	if ran := w.sb.ran(sum); len(ran) != 1 || ran[0].Home != w.sb.home || ran[0].Cwd != w.sb.work {
		t.Fatalf("ran %+v, want once as the sandbox home in the working folder %s", ran, w.sb.work)
	}
	if closed := closedHost(c); len(closed) != 1 || closed[0].Outcome != hostRan || closed[0].Device == nil || closed[0].Device.Kind != "web" {
		t.Fatalf("closed cards %+v", closed)
	}
	evs := w.hostEvents(c.ID)
	if kinds := eventKinds(evs); !slices.Equal(kinds, []string{eventRequested, eventApproved, eventRan}) {
		t.Fatalf("events %v", kinds)
	}
	if code, _ := w.answerCard(c.ID, hr.RequestID, "once", ""); code != 409 {
		t.Fatalf("a second answer: %d, want 409", code)
	}

	// 2. Deny: the destructive line is never approved. (Were it ever to
	// reach a spawn, the exec trap would swap it for an echo.)
	victim := filepath.Join(w.sb.work, "p5-victim")
	rm := "rm -rf " + victim
	tag = "tag-host-deny"
	c = w.hostChat("user-a", stubScript(tag, stubCalls("terminal", obj{"command": rm}), obj{"text": "unused"}), "supervised")
	c = w.card(c.ID, hostLive)
	if c.HostRequest.Card.Command != rm {
		t.Fatalf("card %+v", c.HostRequest.Card)
	}
	w.answer(c, "deny")
	c = w.until(c.ID, "went on after the refusal", statusIs("idle"))
	if seen := strings.ToLower(w.toolSeen(tag)); !strings.Contains(seen, "denied") && !strings.Contains(seen, "blocked") {
		t.Fatalf("the model read %q after a Deny, want Hermes' refusal", seen)
	}
	if n := w.sb.mentions("p5-victim"); n != 0 {
		t.Fatalf("a denied command reached a process spawn %d times", n)
	}
	if closed := closedHost(c); len(closed) != 1 || closed[0].Outcome != hostDenied {
		t.Fatalf("closed cards %+v", closed)
	}
	if kinds := eventKinds(w.hostEvents(c.ID)); slices.Contains(kinds, eventApproved) || !slices.Contains(kinds, eventDenied) {
		t.Fatalf("events %v", kinds)
	}
	if waiting := w.lanes(); waiting == 0 {
		t.Fatal("the lane watch never saw a card waiting")
	}
}

// No host tool after Stop, through the real worker: Stop during the live
// wait denies the request (the command never starts, the model is not asked
// again, a late answer is stale), and Stop right after Run once but before
// the tool starts blocks it too (the worker's dispatch fence, made slow so
// the Stop lands inside it).
func TestIntegrationAgentEngineRealWorkerHostStop(t *testing.T) {
	w := newHostWorld(t, hostOpts{slowFence: 4 * time.Second})

	// 1. Stop during the live wait.
	tag := "tag-host-stop-wait"
	c := w.hostChat("user-a", stubScript(tag, stubCalls("terminal", obj{"command": "echo p5-stopped-wait"}), obj{"text": "never"}), "supervised")
	c = w.card(c.ID, hostLive)
	request := c.HostRequest.RequestID
	if code, body := w.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	w.runGone(c.ID)
	c = w.until(c.ID, "stopped", statusIs("stopped"))
	if closed := closedHost(c); c.HostRequest.pending() || len(closed) != 1 || closed[0].Outcome != hostStopped {
		t.Fatalf("after Stop: card %+v, closed %+v", c.HostRequest, closed)
	}
	if code, _ := w.answerCard(c.ID, request, "once", ""); code != 409 {
		t.Fatalf("an answer after Stop: %d, want 409", code)
	}
	time.Sleep(time.Second)
	if n := w.sb.mentions("p5-stopped-wait"); n != 0 {
		t.Fatalf("the command reached a process spawn %d times after Stop", n)
	}
	if n := len(w.rec.with(tag)); n != 1 {
		t.Fatalf("%d model requests for the stopped run, want 1", n)
	}

	// 2. Stop right after Run once: the answer reached the worker, the
	// fence is still counting, the Stop lands first.
	tag = "tag-host-stop-after-once"
	c = w.hostChat("user-a", stubScript(tag, stubCalls("terminal", obj{"command": "echo p5-stopped-after"}), obj{"text": "never"}), "supervised")
	c = w.card(c.ID, hostLive)
	w.answer(c, "once")
	if code, body := w.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop after Run once: %d %s", code, body)
	}
	w.runGone(c.ID)
	c = w.until(c.ID, "stopped", statusIs("stopped"))
	time.Sleep(5 * time.Second) // past the fence
	if n := w.sb.mentions("p5-stopped-after"); n != 0 {
		t.Fatalf("an approved command started %d times after Stop", n)
	}
	// What the worker reports for the call it did not start is its own
	// matter (it says "ok" today for a call the fence stopped); that nothing
	// started is the trap's word above.
	t.Logf("host.ran statuses after Stop right after Run once: %v (the trap saw no process)", executed(w.hostEvents(c.ID)))
	if waiting := w.lanes(); waiting == 0 {
		t.Fatal("the lane watch never saw a card waiting")
	}
}

// A card left past the live wait parks and frees the worker (short test
// timers stand in for the plan's 10 and 15 minutes): the run ends
// approval_parked, the row names no run and holds no lease, the idle worker
// is reaped; Run once then queues a continuation turn in a new worker that
// runs exactly the approved command, once, and clears the continuation.
func TestIntegrationAgentEngineRealWorkerHostParkAndContinue(t *testing.T) {
	w := newHostWorld(t, hostOpts{liveWait: 2 * time.Second, parkFor: 5 * time.Minute, idle: 4 * time.Second})
	const command = "printf p5-parked-%s now" // prints p5-parked-now
	const marker = command
	tag := "tag-host-park"
	c := w.hostChat("user-a", stubScript(tag, stubCalls("terminal", obj{"command": command})), "supervised")
	c = w.card(c.ID, hostLive)
	first := c.HostRequest
	c = w.card(c.ID, hostParked)
	if c.AgentRunID != "" || c.AgentInstance != "" || c.Lease != "" || c.LeaseUntil != nil || c.HostRequest.RequestID != first.RequestID ||
		c.HostRequest.ExpiresAt == nil || c.HostRequest.ExpiresAt.Before(time.Now()) {
		t.Fatalf("parked row: run %q lease %q card %+v", c.AgentRunID, c.Lease, c.HostRequest)
	}
	if code, _ := w.post("/chats/"+c.ID+"/approve", fmt.Sprintf(`{"revision":%d}`, c.Revision)); code != 409 {
		t.Fatalf("Approve on a parked card: %d, want 409", code)
	}
	// The slot is freed: the worker holds no run now, and once idle it is reaped.
	if wk, ok := w.e.sup.Worker("user-a"); ok && len(wk.LiveRuns()) != 0 {
		t.Fatalf("the worker still holds runs %v after parking", wk.LiveRuns())
	}
	deadline := time.Now().Add(60 * time.Second)
	for {
		if _, ok := w.e.sup.Worker("user-a"); !ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the idle worker was never reaped after the card parked")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if n := len(w.sb.ran(marker)); n != 0 {
		t.Fatalf("the command ran %d times while parked", n)
	}
	if n := len(w.rec.with(tag)); n != 1 {
		t.Fatalf("%d model requests before the answer, want 1", n)
	}
	// Run once on the parked card.
	w.answer(c, "once")
	c = w.until(c.ID, "replied after the continuation", func(c Conversation) bool {
		return c.Status == "idle" && !c.HostRequest.pending() && !c.Continuation.pending() && strings.Contains(lastMessage(c).Content, "p5-parked-now")
	})
	time.Sleep(2 * time.Second) // a second run would show now
	if ran := w.sb.ran(marker); len(ran) != 1 || ran[0].Home != w.sb.home {
		t.Fatalf("ran %+v, want exactly once", ran)
	}
	evs := w.hostEvents(c.ID)
	kinds := eventKinds(evs)
	for _, want := range []string{eventRequested, eventParked, eventApproved, eventAllowed, eventRan} {
		if !slices.Contains(kinds, want) {
			t.Fatalf("events %v lack %s", kinds, want)
		}
	}
	if ran := executed(evs); len(ran) != 1 || ran[0] != "ok" {
		t.Fatalf("events %v: executed %v, want one ok", kinds, ran)
	}
	if allowed := eventsOf(evs, eventAllowed); len(allowed) != 1 || !strings.HasPrefix(allowed[0].Reason, "continuation") || allowed[0].ArgsHash != first.ArgsHash {
		t.Fatalf("the continuation's allowed event %+v", allowed)
	}
	if c.AgentRunID != "" || c.Continuation.pending() {
		t.Fatalf("the finished chat still names run %q or a continuation %+v", c.AgentRunID, c.Continuation)
	}
	if waiting := w.lanes(); waiting == 0 {
		t.Fatal("the lane watch never saw a card waiting")
	}
}

// Allow for this chat: after it, a later call of the same kind (a file read
// in the same folder) in that chat runs with no card and is logged allowed
// for the chat; a read in another folder asks again, and so does another
// chat. (A terminal command's own output is outside content, which makes the
// next command a critical-list item that a grant never covers; that is
// pinned in the fake-worker suite and is an open item in the plan.)
func TestIntegrationAgentEngineRealWorkerHostAllowForThisChat(t *testing.T) {
	w := newHostWorld(t, hostOpts{})
	for path, text := range map[string]string{
		filepath.Join(w.sb.work, "a.txt"): "p5-file-a", filepath.Join(w.sb.work, "b.txt"): "p5-file-b", filepath.Join(w.sb.root, "c.txt"): "p5-file-c"} {
		if err := os.WriteFile(path, []byte(text+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	read := func(name string) obj { return stubCalls("read_file", obj{"path": name}) }
	tag := "tag-host-grant"
	c := w.hostChat("user-a", stubScript(tag, read(filepath.Join(w.sb.work, "a.txt")), read(filepath.Join(w.sb.work, "b.txt")),
		read(filepath.Join(w.sb.root, "c.txt")), obj{"text": "All three read."}), "supervised")
	c = w.card(c.ID, hostLive)
	if hr := c.HostRequest; hr.Card.Kind != cardFile || hr.Card.Path != filepath.Join(w.sb.work, "a.txt") || !hr.Card.Grantable || hr.Grant == nil {
		t.Fatalf("first card %+v grant %+v", hr.Card, hr.Grant)
	}
	w.answer(c, "chat")
	// b.txt is in the granted folder, so it is allowed; c.txt is not, so it asks.
	c = w.until(c.ID, "asked about the other folder", func(c Conversation) bool {
		return c.Status == statusHostApproval && c.HostRequest.Card != nil && strings.HasSuffix(c.HostRequest.Card.Path, "c.txt")
	})
	if len(c.HostGrants) != 1 {
		t.Fatalf("grants %+v", c.HostGrants)
	}
	if seen := w.toolSeen(tag); !strings.Contains(seen, "p5-file-b") {
		t.Fatalf("the second read did not run under the grant: the model read %q", seen)
	}
	w.answer(c, "once")
	c = w.until(c.ID, "finished", statusIs("idle"))
	if lastMessage(c).Content != "All three read." || !strings.Contains(w.toolSeen(tag), "p5-file-c") {
		t.Fatalf("reply %q, the model read %q", lastMessage(c).Content, w.toolSeen(tag))
	}
	var requested, allowed int
	for _, e := range w.hostEvents(c.ID) {
		switch e.Kind {
		case eventRequested:
			requested++
		case eventAllowed:
			allowed++
			if !strings.HasPrefix(e.Reason, "Allowed for this chat") {
				t.Fatalf("allowed because %q", e.Reason)
			}
		}
	}
	if requested != 2 || allowed != 1 {
		t.Fatalf("%d cards and %d grant-allowed calls, want 2 and 1", requested, allowed)
	}
	// Another chat has no grant: its read of the same file asks.
	other := w.hostChat("user-a", stubScript("tag-host-grant-other", read(filepath.Join(w.sb.work, "b.txt")), obj{"text": "x"}), "supervised")
	other = w.card(other.ID, hostLive)
	if len(other.HostGrants) != 0 {
		t.Fatalf("a grant leaked into another chat: %+v", other.HostGrants)
	}
	w.answer(other, "deny")
	w.until(other.ID, "idle", statusIs("idle"))
	if waiting := w.lanes(); waiting == 0 {
		t.Fatal("the lane watch never saw a card waiting")
	}
}

// An MCP server set to Ask me first shows a card before its tool runs on the
// local fake server; Run once runs it and the result reaches the model (as
// untrusted data, taint included); Deny never starts it; a server set to
// Off is not offered to the model at all.
func TestIntegrationAgentEngineRealWorkerHostMCPAskFirst(t *testing.T) {
	w := newHostWorld(t, hostOpts{mcpMode: mcpAsk})
	call := obj{"text": "hello-fake"}

	tag := "tag-mcp-once"
	c := w.hostChat("user-a", stubScript(tag, stubCalls("mcp__fake__echo", call), obj{"text": "unused"}), "supervised")
	c = w.card(c.ID, hostLive)
	hr := c.HostRequest
	if hr.Card == nil || hr.Card.Kind != cardMCP || hr.Card.Server != "fake" || hr.Tool != "mcp__fake__echo" || !strings.Contains(hr.Card.Reason, "Ask me first") {
		t.Fatalf("card %+v", hr)
	}
	if strings.Contains(w.toolSeen(tag), "echo: hello-fake") {
		t.Fatal("the tool answered before the card was answered")
	}
	w.answer(c, "once")
	c = w.until(c.ID, "replied", statusIs("idle"))
	if seen := w.toolSeen(tag); !strings.Contains(seen, "echo: hello-fake") {
		t.Fatalf("the model read %q, want the fake server's answer", seen)
	}
	if len(c.TaintedSources) == 0 {
		t.Fatal("an MCP result did not taint the chat")
	}

	tag = "tag-mcp-deny"
	c = w.hostChat("user-a", stubScript(tag, stubCalls("mcp__fake__echo", obj{"text": "never-fake"}), obj{"text": "unused"}), "supervised")
	c = w.card(c.ID, hostLive)
	w.answer(c, "deny")
	w.until(c.ID, "went on after the refusal", statusIs("idle"))
	if seen := w.toolSeen(tag); strings.Contains(seen, "never-fake") {
		t.Fatalf("a denied MCP tool answered: %q", seen)
	}

	// Off: the server is not offered, so its tool cannot be called.
	w.mcp.set("fake", mcpOff)
	tag = "tag-mcp-off"
	c = w.hostChat("user-a", stubScript(tag, stubCalls("mcp__fake__echo", obj{"text": "off-fake"}), obj{"text": "unused"}), "supervised")
	c = w.until(c.ID, "finished with the server Off", statusIs("idle"))
	if offered := w.offered(tag); len(offered) == 0 || slices.Contains(offered, "mcp__fake__echo") {
		t.Fatalf("an Off server was offered to the model: %v", offered)
	}
	if seen := w.toolSeen(tag); strings.Contains(seen, "echo: off-fake") {
		t.Fatalf("an Off server's tool ran: %q", seen)
	}
	if waiting := w.lanes(); waiting == 0 {
		t.Fatal("the lane watch never saw a card waiting")
	}
}

// Two accounts, one host-allowed: only user-a is offered the host tools and
// gets a card; user-b's call of the same tool cannot run, shows no card and
// reaches no process.
func TestIntegrationAgentEngineRealWorkerHostOnlyForHostAllowedAccounts(t *testing.T) {
	w := newHostWorld(t, hostOpts{})
	wantTools := []string{"terminal", "read_file", "write_file", "patch", "execute_code"}

	tagA := "tag-two-a"
	a := w.hostChat("user-a", stubScript(tagA, stubCalls("terminal", obj{"command": "echo p5-two-a"}), obj{"text": "unused"}), "supervised")
	a = w.card(a.ID, hostLive)
	offeredA := w.offered(tagA)
	for _, tool := range wantTools {
		if !slices.Contains(offeredA, tool) {
			t.Errorf("the host-allowed account was not offered %s: %v", tool, offeredA)
		}
	}
	w.answer(a, "once")
	w.until(a.ID, "idle", statusIs("idle"))
	if n := len(w.sb.ran("p5-two-a")); n != 1 {
		t.Fatalf("user-a's command ran %d times, want 1", n)
	}

	tagB := "tag-two-b"
	b := w.hostChat("user-b", stubScript(tagB, stubCalls("terminal", obj{"command": "echo p5-two-b"}), obj{"text": "unused"}), "supervised")
	b = w.until(b.ID, "finished", func(c Conversation) bool { return c.Status == "idle" || c.Status == statusHostApproval })
	if b.Status == statusHostApproval || b.HostRequest.pending() {
		t.Fatalf("a chat-only account got a host card: %+v", b.HostRequest)
	}
	offeredB := w.offered(tagB)
	for _, tool := range append(wantTools, "browser_exec", "process") {
		if slices.Contains(offeredB, tool) {
			t.Errorf("the chat-only account was offered %s", tool)
		}
	}
	if n := w.sb.mentions("p5-two-b"); n != 0 {
		t.Fatalf("a chat-only account's command reached a process spawn %d times", n)
	}
	if kinds := eventKinds(w.hostEvents(b.ID)); slices.Contains(kinds, eventRan) || slices.Contains(kinds, eventApproved) {
		t.Fatalf("chat-only account events %v", kinds)
	}
	// Its worker was rendered without the host settings.
	if wk, ok := w.e.sup.Worker("user-b"); !ok || wk == nil {
		t.Fatal("no worker for the chat-only account")
	}
	if waiting := w.lanes(); waiting == 0 {
		t.Fatal("the lane watch never saw a card waiting")
	}
}
