package chat

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/agenthost/agenthosttest"
	"timely-api/internal/features/bots"
	"timely-api/internal/models"
)

// Bot ticks on the agent engine (engine_bot.go) against a fake worker that
// speaks bot.run: the shared fake (agenthosttest) refuses bot.run, so these
// tests re-execute the test binary as their own small fake (botFakeMarker,
// started from init before TestMain). Its script.json maps a prompt word to a
// list of steps; it records every line Go sent (received.jsonl) and every
// call it really ran (ran.jsonl), so a test can prove a call did not run.

const botFakeMarker = "chat-bot-fake-worker"

func init() {
	if len(os.Args) >= 3 && os.Args[1] == botFakeMarker {
		os.Exit(runBotFake(os.Args[2]))
	}
}

// ---------------------------------------------------------------- the fake worker

type botFakeScript struct {
	// Fixtures are steps by name; Matches pick one by a word of the prompt.
	Fixtures map[string][]map[string]any `json:"fixtures"`
	Matches  map[string]string           `json:"matches"`
}

type botFake struct {
	dir      string
	outMu    sync.Mutex
	out      *json.Encoder
	received *os.File

	mu      sync.Mutex
	account string
	runs    map[string]*botFakeRun
	pending map[string]chan map[string]any
	next    int
}

type botFakeRun struct {
	id, startID, botID, checkID string
	prompt                      string
	pre                         map[string]any
	stop                        chan struct{}
	once                        sync.Once
	trace, parked               []map[string]any
}

func runBotFake(scriptPath string) int {
	f := &botFake{dir: filepath.Dir(scriptPath), out: json.NewEncoder(os.Stdout), runs: map[string]*botFakeRun{}, pending: map[string]chan map[string]any{}}
	var err error
	f.received, err = os.OpenFile(filepath.Join(f.dir, "received.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return 2
	}
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 64<<20)
	for in.Scan() {
		line := append([]byte(nil), in.Bytes()...)
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		_, _ = f.received.Write(append(line, '\n'))
		var m map[string]any
		if json.Unmarshal(line, &m) != nil {
			continue
		}
		if f.handle(m) {
			return 0
		}
	}
	return 0
}

func (f *botFake) send(m map[string]any) {
	f.mu.Lock()
	m["account"] = f.account
	f.mu.Unlock()
	f.outMu.Lock()
	defer f.outMu.Unlock()
	_ = f.out.Encode(m)
}

func (f *botFake) script() botFakeScript {
	var s botFakeScript
	raw, _ := os.ReadFile(filepath.Join(f.dir, "script.json"))
	_ = json.Unmarshal(raw, &s)
	return s
}

// handle answers one line; true means exit.
func (f *botFake) handle(m map[string]any) bool {
	typ, id := str(m, "type"), str(m, "id")
	switch typ {
	case "hello":
		f.mu.Lock()
		f.account = str(m, "account")
		f.mu.Unlock()
		f.send(map[string]any{"type": "ready", "id": id, "protocol": 1, "hermes_tag": "fake", "tools": []string{"bot_note_get"},
			"plugins_loaded": []string{"timely_gate", "timely_tools", "timely_learning", "timely_bot"},
			"self_test":      map[string]any{"ok": true, "failures": []string{}, "checks": []any{map[string]any{"name": "plugins", "ok": true}}},
			"config_sha256":  m["settings_hash"], "catalog_version": m["catalog_version"], "skills_sync": map[string]any{}, "boot_ms": 0,
			"pid": os.Getpid(), "web_backends": []string{}})
		go func() {
			for range time.Tick(time.Second) {
				f.mu.Lock()
				n := len(f.runs)
				f.mu.Unlock()
				f.send(map[string]any{"type": "heartbeat", "busy": map[string]any{"runs": n, "learning": false, "children": 0}})
			}
		}()
	case "ping":
		f.send(map[string]any{"type": "pong", "id": id, "busy": map[string]any{"runs": 0, "learning": false, "children": 0}})
	case "bot.run":
		f.botRun(m)
	case "run.stop":
		f.mu.Lock()
		r := f.runs[str(m, "run")]
		f.mu.Unlock()
		if r != nil {
			r.once.Do(func() { close(r.stop) })
		}
	case "tool.result", "gate.verdict":
		f.mu.Lock()
		ch := f.pending[id]
		delete(f.pending, id)
		f.mu.Unlock()
		if ch != nil {
			ch <- m
		}
	case "shutdown":
		f.mu.Lock()
		for _, r := range f.runs {
			r.once.Do(func() { close(r.stop) })
		}
		f.mu.Unlock()
		time.Sleep(200 * time.Millisecond)
		return true
	case "session.delete":
		f.send(map[string]any{"type": "ack", "id": id, "ok": true})
	}
	return false
}

func (f *botFake) botRun(m map[string]any) {
	id, run := str(m, "id"), str(m, "run_id")
	r := &botFakeRun{id: run, startID: id, botID: str(m, "bot_id"), checkID: str(m, "check_id"), prompt: str(m, "prompt"), stop: make(chan struct{})}
	if pre, ok := m["pre_approved"].(map[string]any); ok {
		r.pre = pre
	}
	f.mu.Lock()
	if f.runs[run] != nil {
		f.mu.Unlock()
		f.send(map[string]any{"type": "error", "id": id, "run": run, "run_id": run, "code": "duplicate_run", "message": "live"})
		return
	}
	f.runs[run] = r
	f.mu.Unlock()
	s := f.script()
	var steps []map[string]any
	for word, name := range s.Matches {
		if strings.Contains(r.prompt, word) {
			steps = s.Fixtures[name]
		}
	}
	go f.play(r, steps)
}

func (f *botFake) ask(r *botFakeRun, m map[string]any) (map[string]any, bool) {
	f.mu.Lock()
	f.next++
	req := fmt.Sprintf("w-%s-%d", r.id, f.next)
	ch := make(chan map[string]any, 1)
	f.pending[req] = ch
	f.mu.Unlock()
	m["id"], m["run"] = req, r.id
	f.send(m)
	select {
	case reply := <-ch:
		return reply, true
	case <-r.stop:
		return nil, false
	}
}

func fakeArgsHash(args any) string {
	raw, _ := json.Marshal(args)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (f *botFake) ran(r *botFakeRun, tool, hash string, pre bool) {
	file, err := os.OpenFile(filepath.Join(f.dir, "ran.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	line, _ := json.Marshal(map[string]any{"run": r.id, "check": r.checkID, "tool": tool, "args_hash": hash, "pre": pre})
	_, _ = file.Write(append(line, '\n'))
}

func (f *botFake) play(r *botFakeRun, steps []map[string]any) {
	done := map[string]any{"response": "", "silent": true, "reports": []any{}, "usage": map[string]any{"input_tokens": 3, "output_tokens": 2, "iterations": 1},
		"error_class": "", "hosts": []any{}, "tainted_sources": []any{}, "dry_run": false}
	stopped := false
	for _, step := range steps {
		select {
		case <-r.stop:
			stopped = true
		default:
		}
		if stopped {
			break
		}
		if !f.step(r, step, done) {
			stopped = true
			break
		}
	}
	if stopped {
		done["error_class"], done["silent"] = "stopped", false
	}
	done["trace"], done["parked"] = r.trace, r.parked
	if done["trace"] == nil {
		done["trace"] = []any{}
	}
	if done["parked"] == nil {
		done["parked"] = []any{}
	}
	f.mu.Lock()
	delete(f.runs, r.id)
	f.mu.Unlock()
	done["type"], done["id"], done["run_id"] = "bot.done", r.startID, r.id
	f.send(done)
}

// step plays one step; false means the run was stopped.
func (f *botFake) step(r *botFakeRun, step map[string]any, done map[string]any) bool {
	switch str(step, "fake") {
	case "sleep":
		ms, _ := step["ms"].(float64)
		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
			return true
		case <-r.stop:
			return false
		}
	case "hang":
		<-r.stop
		return false
	case "until":
		// Wait for the test to create a file in the kit folder.
		for {
			if _, err := os.Stat(filepath.Join(f.dir, str(step, "file"))); err == nil {
				return true
			}
			select {
			case <-time.After(10 * time.Millisecond):
			case <-r.stop:
				return false
			}
		}
	case "done":
		for k, v := range step {
			if k != "fake" {
				done[k] = v
			}
		}
		return true
	case "call":
		tool := str(step, "tool")
		args, _ := step["args"].(map[string]any)
		if args == nil {
			args = map[string]any{}
		}
		hash := fakeArgsHash(args)
		if r.pre != nil && str(r.pre, "tool") == tool && str(r.pre, "args_hash") == hash {
			r.pre = nil // once
			f.ran(r, tool, hash, true)
			r.trace = append(r.trace, map[string]any{"name": tool, "ok": true, "ms": 1})
			return true
		}
		bot := map[string]any{"bot_id": r.botID, "check_id": r.checkID, "tainted": step["tainted"] == true, "permission": "auto", "dry_run": false}
		if step["park"] == true {
			bot["park"] = true
		}
		call := str(step, "call_id")
		if call == "" {
			call = "call_" + tool
		}
		reply, ok := f.ask(r, map[string]any{"type": "gate.ask", "tool_call_id": call, "tool": tool, "args": args, "args_hash": hash,
			"tainted_sources": []any{}, "run_kind": "bot", "bot": bot})
		if !ok {
			return false
		}
		switch str(reply, "verdict") {
		case "allow":
			f.ran(r, tool, hash, false)
			r.trace = append(r.trace, map[string]any{"name": tool, "ok": true, "ms": 1})
		case "approve":
			r.parked = append(r.parked, map[string]any{"tool": tool, "args_hash": hash, "tool_call_id": call, "args": args, "message": "Parked"})
			r.trace = append(r.trace, map[string]any{"name": tool, "ok": false, "ms": 0, "note": "Parked: this step needs the person's approval."})
		default:
			r.trace = append(r.trace, map[string]any{"name": tool, "ok": false, "ms": 0, "note": "Blocked: " + str(reply, "message")})
		}
		return true
	}
	if str(step, "type") == "tool.call" {
		msg := map[string]any{}
		for k, v := range step {
			msg[k] = v
		}
		msg["tainted_sources"] = []any{}
		msg["batch_size"], msg["sibling_tools"] = 1, []any{}
		msg["bot"] = map[string]any{"bot_id": r.botID, "check_id": r.checkID, "dry_run": false}
		reply, ok := f.ask(r, msg)
		if !ok {
			return false
		}
		r.trace = append(r.trace, map[string]any{"name": str(step, "name"), "ok": !strings.Contains(resultOf(reply), `"error"`), "ms": 1})
		return true
	}
	return true
}

func str(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

func resultOf(reply map[string]any) string {
	raw, _ := json.Marshal(reply["result"])
	return string(raw)
}

// ---------------------------------------------------------------- the test side

// botKit is one fake bot worker setup.
type botKit struct {
	t   *testing.T
	dir string
	s   botFakeScript
}

func newBotKit(t *testing.T) *botKit {
	k := &botKit{t: t, dir: t.TempDir(), s: botFakeScript{Fixtures: map[string][]map[string]any{}, Matches: map[string]string{}}}
	k.save()
	return k
}

func (k *botKit) fixture(word string, steps ...map[string]any) {
	k.s.Fixtures[word], k.s.Matches[word] = steps, word
	k.save()
}

func (k *botKit) save() {
	raw, _ := json.Marshal(k.s)
	tmp := filepath.Join(k.dir, "script.tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		k.t.Fatal(err)
	}
	if err := os.Rename(tmp, filepath.Join(k.dir, "script.json")); err != nil {
		k.t.Fatal(err)
	}
}

func (k *botKit) touch(name string) {
	if err := os.WriteFile(filepath.Join(k.dir, name), nil, 0o600); err != nil {
		k.t.Fatal(err)
	}
}

func (k *botKit) lines(name string) []map[string]any {
	raw, _ := os.ReadFile(filepath.Join(k.dir, name))
	var out []map[string]any
	for _, line := range strings.Split(string(raw), "\n") {
		var m map[string]any
		if json.Unmarshal([]byte(line), &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

func (k *botKit) received(typ string) []map[string]any {
	var out []map[string]any
	for _, m := range k.lines("received.jsonl") {
		if str(m, "type") == typ {
			out = append(out, m)
		}
	}
	return out
}

func (k *botKit) ran() []map[string]any { return k.lines("ran.jsonl") }

func (k *botKit) config() agenthost.Config {
	exe, err := os.Executable()
	if err != nil {
		k.t.Fatal(err)
	}
	cfg := agenthosttest.New(k.t).Config()
	cfg.Root = filepath.Join(k.dir, "agent")
	cfg.Runtime = agenthost.Runtime{Program: exe, Args: []string{botFakeMarker, filepath.Join(k.dir, "script.json")}}
	return cfg
}

// fakeNotes is a notepad that records who asked.
type fakeNotes struct {
	mu    sync.Mutex
	notes map[string]map[string]string // "uid/bot" -> key -> value
	calls []string
}

func (n *fakeNotes) key(uid, bot string) string { return uid + "/" + bot }

func (n *fakeNotes) Get(_ context.Context, uid, bot, key string) (string, bool, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.calls = append(n.calls, "get "+n.key(uid, bot)+" "+key)
	v, ok := n.notes[n.key(uid, bot)][key]
	return v, ok, nil
}

func (n *fakeNotes) Set(_ context.Context, uid, bot, key, value string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.calls = append(n.calls, "set "+n.key(uid, bot)+" "+key)
	if n.notes[n.key(uid, bot)] == nil {
		n.notes[n.key(uid, bot)] = map[string]string{}
	}
	n.notes[n.key(uid, bot)][key] = value
	return nil
}

func (n *fakeNotes) Delete(_ context.Context, uid, bot, key string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.calls = append(n.calls, "delete "+n.key(uid, bot)+" "+key)
	if _, ok := n.notes[n.key(uid, bot)][key]; !ok {
		return bots.ErrNoNote
	}
	delete(n.notes[n.key(uid, bot)], key)
	return nil
}

func (n *fakeNotes) Map(_ context.Context, uid, bot string) (map[string]string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.calls = append(n.calls, "map "+n.key(uid, bot))
	out := map[string]string{}
	for k, v := range n.notes[n.key(uid, bot)] {
		out[k] = v
	}
	return out, nil
}

// botWorld is the engine on the fake bot worker, with no database (Service
// on a nil DB): enough for notes, reports, the browser lease and the classes.
type botWorld struct {
	t     *testing.T
	kit   *botKit
	e     *WorkerEngine
	a     *BotAgent
	notes *fakeNotes
	log   *guardedLog
}

func newBotWorld(t *testing.T, s *Service, opts ...func(*WorkerEngineOptions)) *botWorld {
	t.Helper()
	kit := newBotKit(t)
	return newBotWorldWith(t, s, kit, kit.config(), nil, opts...)
}

// newBotWorldWith runs the engine on cfg's supervisor (the fake bot worker,
// or the real one) with notes as the notepad (nil: a fake that records).
func newBotWorldWith(t *testing.T, s *Service, kit *botKit, cfg agenthost.Config, notes BotNotes, opts ...func(*WorkerEngineOptions)) *botWorld {
	t.Helper()
	logs := newGuardedLog(t)
	o := WorkerEngineOptions{Model: testModel, Logf: logs.logf, HostSweepEvery: time.Hour, RenewEvery: 50 * time.Millisecond}
	for _, fn := range opts {
		fn(&o)
	}
	if s == nil {
		s = New(nil, engineCatalog, nil)
	}
	e := NewWorkerEngine(s, o)
	if cfg.Logf == nil {
		cfg.Logf = logs.logf
	}
	cfg.Handler, cfg.OnExit = e.Handle, e.WorkerExited
	sup := agenthost.New(cfg)
	e.Attach(sup)
	s.SetAgentEngine(e)
	fake := &fakeNotes{notes: map[string]map[string]string{}}
	if notes == nil {
		notes = fake
	}
	a := NewBotAgent(e, notes, nil)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if s.db == nil {
			// No database: the engine's own Shutdown drains session deletes.
			e.stopSweep()
			_ = sup.Shutdown(ctx)
			return
		}
		_ = e.Shutdown(ctx)
	})
	return &botWorld{t: t, kit: kit, e: e, a: a, notes: fake, log: logs}
}

func testBot(id string) bots.Bot {
	return bots.Bot{ID: id, Name: "Pixel watch", Prompt: "Watch the Pixel", Engine: bots.EngineAgent, Status: bots.StatusActive,
		Permission: bots.PermissionAuto, ModelProvider: "openrouter", Model: "stub-model", Timezone: "UTC",
		Tools: bots.AgentTools{BrowserSites: []string{"amazon.in"}}}
}

func tickInput(b bots.Bot, check, prompt string) bots.RunInput {
	return bots.RunInput{Bot: b, Prompt: prompt, CheckID: check, Permission: b.Permission, Tools: b.Tools,
		Model: bots.ModelChoice{Provider: b.ModelProvider, Model: b.Model}, Deadline: time.Now().Add(time.Minute)}
}

func runTick(t *testing.T, a *BotAgent, uid string, in bots.RunInput) bots.AgentResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := a.Run(ctx, uid, in)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return res
}

// The tick's notepad calls reach the store scoped to the Bot the tick runs
// (whatever the worker says), its reports come back in the result with the
// worker's usage and trace, and bot.run carries the tick.
func TestBotAgentNotesAndReports(t *testing.T) {
	w := newBotWorld(t, nil)
	w.notes.notes["user-a/bot_pixel"] = map[string]string{"last_price": "109999"}
	report := map[string]any{"title": "Pixel in stock", "body": "₹89,999", "url": "https://amazon.in/pixel", "price": 89999, "symbol": "INR", "urgency": "urgent"}
	w.kit.fixture("NOTES",
		map[string]any{"type": "tool.call", "name": "bot_note_get", "args": map[string]any{"key": "last_price"}},
		map[string]any{"type": "tool.call", "name": "bot_note_set", "args": map[string]any{"key": "last_price", "value": "89999"}},
		map[string]any{"type": "tool.call", "name": "bot_note_get", "args": map[string]any{}},
		map[string]any{"type": "tool.call", "name": "bot_note_delete", "args": map[string]any{"key": "gone"}},
		map[string]any{"type": "tool.call", "name": "bot_report", "args": report},
		map[string]any{"fake": "done", "response": "Pixel is in stock.", "silent": false, "reports": []any{report}},
	)
	res := runTick(t, w.a, "user-a", tickInput(testBot("bot_pixel"), "bchk_notes", "NOTES please"))
	if res.ErrorClass != "" || res.Silent || len(res.Reports) != 1 || res.Reports[0].Urgency != "high" || res.Reports[0].Title != "Pixel in stock" {
		t.Fatalf("result %+v", res)
	}
	if res.Usage.InputTokens != 3 || res.Usage.Calls != 1 || len(res.Trace) != 5 {
		t.Fatalf("usage %+v trace %+v", res.Usage, res.Trace)
	}
	want := []string{"get user-a/bot_pixel last_price", "set user-a/bot_pixel last_price", "map user-a/bot_pixel", "delete user-a/bot_pixel gone"}
	if strings.Join(w.notes.calls, "|") != strings.Join(want, "|") {
		t.Fatalf("notepad calls %v", w.notes.calls)
	}
	if w.notes.notes["user-a/bot_pixel"]["last_price"] != "89999" {
		t.Fatal("the note was not saved for that bot")
	}
	runs := w.kit.received("bot.run")
	if len(runs) != 1 || str(runs[0], "check_id") != "bchk_notes" || str(runs[0], "run_id") != "brun_bchk_notes" || str(runs[0], "permission") != "auto" {
		t.Fatalf("bot.run %+v", runs)
	}
	if _, ok := runs[0]["model"].(map[string]any); !ok {
		t.Fatal("bot.run has no model")
	}
	results := w.kit.received("tool.result")
	if len(results) != 5 || !strings.Contains(string(raw(results[0]["result"])), "109999") || results[0]["outside"] != true {
		t.Fatalf("tool results %+v", results)
	}
}

// A sixth report in one tick is refused.
func TestBotAgentCapsReports(t *testing.T) {
	w := newBotWorld(t, nil)
	var steps []map[string]any
	for i := 0; i < 6; i++ {
		steps = append(steps, map[string]any{"type": "tool.call", "name": "bot_report", "args": map[string]any{"title": fmt.Sprint(i), "body": "x"}})
	}
	w.kit.fixture("CAPS", steps...)
	runTick(t, w.a, "user-a", tickInput(testBot("bot_caps"), "bchk_caps", "CAPS"))
	results := w.kit.received("tool.result")
	if len(results) != 6 || !strings.Contains(string(raw(results[5]["result"])), "at most 5") || strings.Contains(string(raw(results[4]["result"])), "error") {
		t.Fatalf("results %+v", results)
	}
}

// Q-B2: a chat holding the browser wins. A tick's browser read is refused
// "browser busy" and never runs, and the tick ends browser_busy; the Check
// can tell before it starts (BrowserBusy).
func TestBotAgentBrowserBusyWhileAChatHoldsIt(t *testing.T) {
	w := newBotWorld(t, nil)
	w.a.lease.AcquireChat("user-a", "run_chat")
	if !w.a.BrowserBusy("user-a") || w.a.BrowserBusy("user-b") {
		t.Fatal("BrowserBusy does not follow the lease")
	}
	w.kit.fixture("BUSY", map[string]any{"fake": "call", "tool": "bot_browser_read", "args": map[string]any{"url": "https://amazon.in/dp/pixel"}},
		map[string]any{"fake": "done", "response": "[SILENT]", "silent": true})
	res := runTick(t, w.a, "user-a", tickInput(testBot("bot_busy"), "bchk_busy", "BUSY"))
	if res.ErrorClass != bots.ClassBrowserBusy {
		t.Fatalf("class %q, want browser_busy", res.ErrorClass)
	}
	if len(w.kit.ran()) != 0 {
		t.Fatalf("the browser ran: %+v", w.kit.ran())
	}
	verdicts := w.kit.received("gate.verdict")
	if len(verdicts) != 1 || str(verdicts[0], "verdict") != "block" || str(verdicts[0], "message") != "browser busy" {
		t.Fatalf("verdicts %+v", verdicts)
	}
	if len(res.Trace) != 1 || res.Trace[0].Outcome != "refused" {
		t.Fatalf("trace %+v", res.Trace)
	}
}

// A chat that takes the browser during a tick wins: the tick's first read
// ran, its next browser call is refused "browser busy", and the lease the
// tick held is let go when it ends.
func TestBotAgentChatPreemptsTheBrowserMidTick(t *testing.T) {
	w := newBotWorld(t, nil)
	read := map[string]any{"fake": "call", "tool": "bot_browser_read", "args": map[string]any{"url": "https://amazon.in/dp/pixel"}}
	again := map[string]any{"fake": "call", "tool": "bot_browser_read", "args": map[string]any{"url": "https://amazon.in/dp/pixel-2"}}
	w.kit.fixture("PREEMPT", read, map[string]any{"fake": "until", "file": "chat-took-it"}, again, map[string]any{"fake": "done", "silent": true})
	done := make(chan bots.AgentResult, 1)
	go func() { done <- runTick(t, w.a, "user-a", tickInput(testBot("bot_pre"), "bchk_pre", "PREEMPT")) }()
	deadline := time.Now().Add(15 * time.Second)
	for len(w.kit.ran()) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the first read never ran")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h := w.a.lease.Holder("user-a"); h != BotHolder("bchk_pre") {
		t.Fatalf("holder %+v during the tick", h)
	}
	if took := w.a.lease.AcquireChat("user-a", "run_chat"); took != BotHolder("bchk_pre") {
		t.Fatalf("the chat preempted %+v", took)
	}
	w.kit.touch("chat-took-it")
	res := <-done
	if res.ErrorClass != bots.ClassBrowserBusy || len(w.kit.ran()) != 1 {
		t.Fatalf("class %q, ran %+v", res.ErrorClass, w.kit.ran())
	}
	w.a.lease.Release("user-a", ChatHolder("run_chat"))
	if w.a.BrowserBusy("user-a") || w.a.lease.Preempted("user-a", "bchk_pre") {
		t.Fatal("the tick left the lease held")
	}
}

// A retried job is the same Check: a second Run while the first runs joins
// it, and the worker gets one bot.run.
func TestBotAgentDedupesByCheck(t *testing.T) {
	w := newBotWorld(t, nil)
	w.kit.fixture("DEDUPE", map[string]any{"fake": "sleep", "ms": 300}, map[string]any{"fake": "done", "response": "ok", "silent": false})
	in := tickInput(testBot("bot_dup"), "bchk_dup", "DEDUPE")
	var wg sync.WaitGroup
	results := make([]bots.AgentResult, 2)
	for i := range results {
		wg.Add(1)
		go func() { defer wg.Done(); results[i] = runTick(t, w.a, "user-a", in) }()
		time.Sleep(50 * time.Millisecond)
	}
	wg.Wait()
	if len(w.kit.received("bot.run")) != 1 || results[0].Response != "ok" || results[1].Response != "ok" {
		t.Fatalf("bot.runs %d, results %+v", len(w.kit.received("bot.run")), results)
	}
}

// No provider means bots.ErrNoAI (Q-B3), and no bot.run is sent.
func TestBotAgentNoProviderIsErrNoAI(t *testing.T) {
	w := newBotWorld(t, nil, func(o *WorkerEngineOptions) {
		o.Model = func(context.Context, string, string, string, RunModelOptions) (any, error) {
			return nil, errors.New("OpenRouter is not connected")
		}
	})
	_, err := w.a.Run(context.Background(), "user-a", tickInput(testBot("bot_noai"), "bchk_noai", "x"))
	if !errors.Is(err, bots.ErrNoAI) {
		t.Fatalf("err %v", err)
	}
	b := testBot("bot_noai")
	b.ModelProvider = ""
	in := tickInput(b, "bchk_noai2", "x")
	in.Model = bots.ModelChoice{}
	if _, err := w.a.Run(context.Background(), "user-a", in); !errors.Is(err, bots.ErrNoAI) {
		t.Fatalf("no default provider: %v", err)
	}
	if len(w.kit.received("bot.run")) != 0 {
		t.Fatal("a bot.run went out")
	}
}

// The deadline stops a stuck tick (timeout), and a cancelled ctx stops one
// and returns its error.
func TestBotAgentDeadlineAndCancel(t *testing.T) {
	grace, wait := botGrace, botStopWait
	botGrace, botStopWait = 100*time.Millisecond, 2*time.Second
	t.Cleanup(func() { botGrace, botStopWait = grace, wait })
	w := newBotWorld(t, nil)
	w.kit.fixture("STUCK", map[string]any{"fake": "hang"})
	in := tickInput(testBot("bot_stuck"), "bchk_stuck", "STUCK")
	in.Deadline = time.Now().Add(300 * time.Millisecond)
	res := runTick(t, w.a, "user-a", in)
	if res.ErrorClass != bots.ClassTimeout {
		t.Fatalf("class %q", res.ErrorClass)
	}
	stops := w.kit.received("run.stop")
	if len(stops) != 1 || str(stops[0], "run") != "brun_bchk_stuck" || str(stops[0], "reason") != "deadline" {
		t.Fatalf("stops %+v", stops)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := w.a.Run(ctx, "user-a", tickInput(testBot("bot_stuck"), "bchk_stuck2", "STUCK")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancelled run: %v", err)
	}
}

// bot.done's error classes map to the tick's.
func TestBotClassMapping(t *testing.T) {
	for in, want := range map[string]string{"": "", "prompt_blocked": bots.ClassInjection, "agent_failure": bots.ClassCronFailure,
		"unreachable": bots.ClassUnreachable, "rate_limited": bots.ClassRateLimited, "deadline": bots.ClassTimeout,
		"inactive": bots.ClassTimeout, "stopped": bots.ClassUnreachable, "error": bots.ClassCrash} {
		if got := botClass(in, false); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
	if botClass("stopped", true) != bots.ClassTimeout {
		t.Error("a stop at the deadline is a timeout")
	}
	if botCheckOf("brun_bchk_1~bcard_2") != "bchk_1" || botCheckOf("brun_bchk_1") != "bchk_1" {
		t.Error("botCheckOf")
	}
	if got := argsHashOf(json.RawMessage(`{"url":"https://a.in/<x>","b":"₹"}`)); got != fakeArgsHash(map[string]any{"b": "₹", "url": "https://a.in/<x>"}) && got == "" {
		t.Error("argsHashOf")
	}
}

// ---------------------------------------------------------------- with the database

// botDBWorld is botWorld on an isolated PostgreSQL schema with the bots table,
// so steps park on the Bot thread.
func newBotDBWorld(t *testing.T) (*botWorld, *Service) {
	t.Helper()
	db := integrationDB(t)
	if err := db.AutoMigrate(&bots.Bot{}, &bots.Watch{}); err != nil {
		t.Fatal(err)
	}
	s := New(db, engineCatalog, nil)
	w := newBotWorld(t, s)
	return w, s
}

func createBot(t *testing.T, s *Service, b bots.Bot) {
	t.Helper()
	b.UserID = "user-a"
	if err := s.db.Create(&b).Error; err != nil {
		t.Fatal(err)
	}
}

func botThreadOf(t *testing.T, s *Service, botID string) Conversation {
	t.Helper()
	var rows []Conversation
	if err := s.db.Where("user_id = ? AND kind = ? AND bot_id = ?", "user-a", KindBotThread, botID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("%d bot threads", len(rows))
	}
	return rows[0]
}

func waitThread(t *testing.T, s *Service, cid, what string, ok func(Conversation) bool) Conversation {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		var c Conversation
		if err := s.db.First(&c, "id = ?", cid).Error; err != nil {
			t.Fatal(err)
		}
		if ok(c) {
			return c
		}
		if time.Now().After(deadline) {
			t.Fatalf("thread never %s: %s %+v", what, c.Status, c.HostRequest)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func lastHost(c Conversation) *ClosedHost {
	for i := len(c.Messages) - 1; i >= 0; i-- {
		if c.Messages[i].Kind == "host" && c.Messages[i].Host != nil {
			return c.Messages[i].Host
		}
	}
	return nil
}

func answerCard(t *testing.T, s *Service, cid, requestID, choice string) (int, string) {
	t.Helper()
	code, body := serve(t, s, "POST", "/chats/"+cid+"/host-approval", fmt.Sprintf(`{"requestId":%q,"choice":%q,"device":{"kind":"web"}}`, requestID, choice))
	return code, string(body)
}

var parkRead = map[string]any{"fake": "call", "tool": "bot_browser_read", "args": map[string]any{"url": "https://flipkart.com/pixel"}}

// A step the Bot's mode holds parks as one card on its Bot thread (made on
// the way, and named on the Bot), the tick goes on and returns its result; the
// same step again is not asked twice. Deny closes the card and runs nothing.
func TestIntegrationBotAgentParksAStepAndDenyClosesIt(t *testing.T) {
	w, s := newBotDBWorld(t)
	createBot(t, s, testBot("bot_park"))
	w.kit.fixture("PARK", parkRead, parkRead, map[string]any{"fake": "call", "tool": "browser_exec", "park": true, "args": map[string]any{"code": "print(1)"}},
		map[string]any{"fake": "done", "response": "It waits for you.", "silent": false})
	res := runTick(t, w.a, "user-a", tickInput(testBot("bot_park"), "bchk_park", "PARK"))
	if res.ErrorClass != "" || res.Response != "It waits for you." || len(res.Trace) != 3 || res.Trace[0].Outcome != "parked" {
		t.Fatalf("result %+v", res)
	}
	thread := botThreadOf(t, s, "bot_park")
	h := thread.HostRequest
	if thread.Status != statusHostApproval || h.Phase != hostParked || h.Tool != "bot_browser_read" || h.Run != "brun_bchk_park" || h.ExpiresAt == nil ||
		h.Card == nil || h.Card.URL != "https://flipkart.com/pixel" {
		t.Fatalf("thread %s card %+v", thread.Status, h)
	}
	if !isBotCard(thread, h) || botCheckOf(h.Run) != "bchk_park" {
		t.Fatal("the card does not name its Check")
	}
	var b bots.Bot
	if err := s.db.First(&b, "id = ?", "bot_park").Error; err != nil || b.ThreadID == nil || *b.ThreadID != thread.ID {
		t.Fatalf("the Bot does not name its thread: %v %v", b.ThreadID, err)
	}
	// browser_exec found the thread waiting: not asked, and said so.
	if n := len(thread.Messages); n != 1 || !strings.Contains(thread.Messages[0].Content, "Not asked") {
		t.Fatalf("messages %+v", thread.Messages)
	}
	var pushes int64
	s.db.Model(&models.Notification{}).Where("entity_id = ?", thread.ID).Count(&pushes)
	if pushes != 1 {
		t.Fatalf("%d pushes", pushes)
	}
	if args, _ := s.botCardArgs(context.Background(), "user-a", thread.ID, h.RequestID); string(args) != `{"url":"https://flipkart.com/pixel"}` {
		t.Fatalf("kept args %s", args)
	}

	if code, body := answerCard(t, s, thread.ID, h.RequestID, hostChat); code != 409 {
		t.Fatalf("allow for this chat on a bot card: %d %s", code, body)
	}
	if code, body := answerCard(t, s, thread.ID, h.RequestID, hostDeny); code != 200 {
		t.Fatalf("deny: %d %s", code, body)
	}
	thread = waitThread(t, s, thread.ID, "denied", statusIs("idle"))
	if c := lastHost(thread); c == nil || c.Outcome != hostDenied || thread.HostRequest.pending() {
		t.Fatalf("closed %+v", c)
	}
	if code, _ := answerCard(t, s, thread.ID, h.RequestID, hostOnce); code != 409 {
		t.Fatal("a second answer was taken")
	}
	time.Sleep(200 * time.Millisecond)
	if len(w.kit.received("bot.run")) != 1 || len(w.kit.ran()) != 0 {
		t.Fatalf("something ran after Deny: %+v", w.kit.ran())
	}
}

// Run once runs exactly that call once, in a continuation bot.run whose
// pre_approved is the card's call, and saves what it found on the same
// Check; a second answer (a retry) runs nothing more.
func TestIntegrationBotAgentRunOnceRunsTheCallOnce(t *testing.T) {
	w, s := newBotDBWorld(t)
	createBot(t, s, testBot("bot_once"))
	var saved []string
	var mu sync.Mutex
	w.a.SaveContinuation = func(_ context.Context, uid, botID, checkID string, res bots.AgentResult) error {
		mu.Lock()
		defer mu.Unlock()
		saved = append(saved, uid+" "+botID+" "+checkID+" "+fmt.Sprint(len(res.Reports)))
		return nil
	}
	w.kit.fixture("ONCE", parkRead, map[string]any{"fake": "done", "silent": true})
	runTick(t, w.a, "user-a", tickInput(testBot("bot_once"), "bchk_once", "ONCE"))
	thread := botThreadOf(t, s, "bot_once")
	h := thread.HostRequest
	report := map[string]any{"title": "Pixel signed-in price", "body": "₹88,000"}
	w.kit.fixture("person approved", parkRead, parkRead, map[string]any{"fake": "done", "silent": false, "reports": []any{report}})

	if code, body := answerCard(t, s, thread.ID, h.RequestID, hostOnce); code != 200 {
		t.Fatalf("run once: %d %s", code, body)
	}
	if code, _ := answerCard(t, s, thread.ID, h.RequestID, hostOnce); code != 409 {
		t.Fatal("a second Run once was taken")
	}
	thread = waitThread(t, s, thread.ID, "finished the step", func(c Conversation) bool { return c.Status == "idle" && c.AgentRunID == "" })
	if c := lastHost(thread); c == nil || c.Outcome != hostRan {
		t.Fatalf("card %+v", c)
	}
	if last := lastMessage(thread); !strings.Contains(last.Content, "Reported: Pixel signed-in price") {
		t.Fatalf("reply %+v", last)
	}
	runs := w.kit.received("bot.run")
	if len(runs) != 2 {
		t.Fatalf("%d bot.runs", len(runs))
	}
	cont := runs[1]
	pre, _ := cont["pre_approved"].(map[string]any)
	if str(cont, "check_id") != "bchk_once~"+h.RequestID || str(cont, "run_id") != botContinuationRun(h) || str(pre, "tool") != "bot_browser_read" || str(pre, "args_hash") != h.ArgsHash {
		t.Fatalf("continuation %+v", cont)
	}
	if !strings.Contains(str(cont, "prompt"), `{"url":"https://flipkart.com/pixel"}`) {
		t.Fatalf("prompt %q", str(cont, "prompt"))
	}
	ran := w.kit.ran()
	if len(ran) != 1 || ran[0]["pre"] != true || str(ran[0], "args_hash") != h.ArgsHash {
		t.Fatalf("ran %+v", ran)
	}
	// The script's second read of the same page asked again: a new card
	// (the approval was used up), not a second run.
	if thread.HostRequest.pending() {
		t.Fatalf("the continuation's second ask took the row while it ran: %+v", thread.HostRequest)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(saved) != 1 || saved[0] != "user-a bot_once bchk_once 1" {
		t.Fatalf("saved %v", saved)
	}
}

// Nothing runs after Stop: Stop while the continuation waits ends it before
// its call (run.stop), and a continuation whose row a Stop took first is never
// sent. A deleted Bot's card runs nothing.
func TestIntegrationBotAgentNothingRunsAfterStopOrDelete(t *testing.T) {
	w, s := newBotDBWorld(t)
	createBot(t, s, testBot("bot_stop"))
	w.kit.fixture("STOPME", parkRead, map[string]any{"fake": "done", "silent": true})
	runTick(t, w.a, "user-a", tickInput(testBot("bot_stop"), "bchk_stop", "STOPME"))
	thread := botThreadOf(t, s, "bot_stop")
	h := thread.HostRequest
	w.kit.fixture("person approved", map[string]any{"fake": "until", "file": "never"}, parkRead)
	if code, body := answerCard(t, s, thread.ID, h.RequestID, hostOnce); code != 200 {
		t.Fatalf("run once: %d %s", code, body)
	}
	deadline := time.Now().Add(15 * time.Second)
	for len(w.kit.received("bot.run")) < 2 {
		if time.Now().After(deadline) {
			t.Fatal("no continuation")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if code, body := serve(t, s, "POST", "/chats/"+thread.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	thread = waitThread(t, s, thread.ID, "settled", func(c Conversation) bool { h := lastHost(c); return h != nil && h.Outcome == hostNotRun })
	if thread.Status != "stopped" || len(w.kit.ran()) != 0 {
		t.Fatalf("status %s ran %+v", thread.Status, w.kit.ran())
	}
	if stops := w.kit.received("run.stop"); len(stops) != 1 || str(stops[0], "run") != botContinuationRun(h) {
		t.Fatalf("stops %+v", stops)
	}

	// A Stop that commits after Run once but before the continuation's
	// bot.run goes out: the fence keeps it in. (Run once committed the row
	// running under its lease; the Stop cleared both.)
	w.kit.fixture("AGAIN", parkRead, map[string]any{"fake": "done", "silent": true})
	runTick(t, w.a, "user-a", tickInput(testBot("bot_stop"), "bchk_stop2", "AGAIN"))
	thread = botThreadOf(t, s, "bot_stop")
	h2 := thread.HostRequest
	if !h2.pending() {
		t.Fatalf("no second card: %s", thread.Status)
	}
	clear := func(status string) {
		if err := s.db.Model(&Conversation{}).Where("id = ?", thread.ID).Select("status", "agent_run_id", "lease", "host_request").
			Updates(&Conversation{Status: status, HostRequest: HostRequest{}}).Error; err != nil {
			t.Fatal(err)
		}
	}
	clear("stopped")
	n := len(w.kit.received("bot.run"))
	w.a.continueCard(context.Background(), "user-a", thread.ID, h2, "lease_lost")
	if len(w.kit.received("bot.run")) != n || len(w.kit.ran()) != 0 {
		t.Fatal("a fenced continuation was sent")
	}

	// The Bot is deleted while its card waits: Run once runs nothing.
	w.kit.fixture("GONE", parkRead, map[string]any{"fake": "done", "silent": true})
	runTick(t, w.a, "user-a", tickInput(testBot("bot_stop"), "bchk_stop3", "GONE"))
	thread = botThreadOf(t, s, "bot_stop")
	h3 := thread.HostRequest
	if err := s.db.Delete(&bots.Bot{}, "id = ?", "bot_stop").Error; err != nil {
		t.Fatal(err)
	}
	n = len(w.kit.received("bot.run"))
	if code, body := answerCard(t, s, thread.ID, h3.RequestID, hostOnce); code != 200 {
		t.Fatalf("run once: %d %s", code, body)
	}
	thread = waitThread(t, s, thread.ID, "not run", func(c Conversation) bool { return c.Status == "idle" })
	if c := lastHost(thread); len(w.kit.received("bot.run")) != n || c == nil || c.Outcome != hostNotRun {
		t.Fatalf("a deleted bot's step: runs %d card %+v", len(w.kit.received("bot.run"))-n, c)
	}
}

// A dry run ("Try it now") parks nothing.
func TestIntegrationBotAgentDryRunParksNothing(t *testing.T) {
	w, s := newBotDBWorld(t)
	createBot(t, s, testBot("bot_dry"))
	w.kit.fixture("DRY", parkRead, map[string]any{"fake": "done", "silent": true})
	in := tickInput(testBot("bot_dry"), "bchk_dry", "DRY")
	in.DryRun = true
	res := runTick(t, w.a, "user-a", in)
	var n int64
	s.db.Model(&Conversation{}).Where("kind = ?", KindBotThread).Count(&n)
	if n != 0 || len(res.Trace) != 1 || res.Trace[0].Outcome != "parked" {
		t.Fatalf("threads %d trace %+v", n, res.Trace)
	}
}
