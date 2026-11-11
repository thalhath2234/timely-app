package agenthosttest

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// maxLiveRuns is the real worker's per-account limit (PROTOCOL.md "busy").
const maxLiveRuns = 3

// fake is the worker process side: it reads Go's lines from stdin and
// writes protocol lines to stdout.
type fake struct {
	scriptPath string
	received   *os.File

	outMu sync.Mutex
	out   *json.Encoder

	mu       sync.Mutex
	account  string
	ready    bool
	stopping bool
	runs     map[string]*fakeRun // live runs by run id
	pending  map[string]*fakeRun // worker request id -> the run waiting for its answer
	nextReq  int
	runsDone sync.WaitGroup
	quit     chan struct{}
	exit     chan int // the exit code once a shutdown has finished
}

// fakeRun is one live run being replayed.
type fakeRun struct {
	id, startID, conversation, sessionKey, userMessage string

	stop      chan struct{} // closed by run.stop
	stopOnce  sync.Once
	replies   chan map[string]any // tool.result / gate.verdict for this run's requests
	approvals chan string         // approval.answer ids while waiting for one
	waitingOK bool                // guarded by fake.mu: waiting for an approval.answer

	text       strings.Builder
	lastResult string
	sentDone   bool
}

func runFake(scriptPath string) int {
	f := &fake{
		scriptPath: scriptPath,
		out:        json.NewEncoder(os.Stdout),
		runs:       map[string]*fakeRun{},
		pending:    map[string]*fakeRun{},
		quit:       make(chan struct{}),
		exit:       make(chan int, 1),
	}
	var err error
	f.received, err = os.OpenFile(filepath.Join(filepath.Dir(scriptPath), "received.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fake worker:", err)
		return 2
	}
	defer f.received.Close()
	fmt.Fprintln(os.Stderr, "fake worker: started")

	lines := make(chan []byte)
	go func() {
		defer close(lines)
		in := bufio.NewScanner(os.Stdin)
		in.Buffer(make([]byte, 1<<20), 64<<20)
		for in.Scan() {
			lines <- append([]byte(nil), in.Bytes()...)
		}
	}()
	for {
		select {
		case code := <-f.exit:
			return code
		case line, ok := <-lines:
			if !ok {
				// stdin closed: the lifeline. Interrupt live runs and exit.
				f.interruptAll()
				return 0
			}
			if len(strings.TrimSpace(string(line))) == 0 {
				continue
			}
			_, _ = f.received.Write(append(line, '\n'))
			var m map[string]any
			if err := json.Unmarshal(line, &m); err != nil {
				f.send(map[string]any{"type": "error", "code": "bad_json", "message": err.Error()})
				continue
			}
			f.handle(m)
		}
	}
}

func str(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// send writes one line, stamped with the worker's account.
func (f *fake) send(m map[string]any) {
	f.mu.Lock()
	account := f.account
	f.mu.Unlock()
	if account != "" {
		m["account"] = account
	}
	f.outMu.Lock()
	defer f.outMu.Unlock()
	_ = f.out.Encode(m)
}

func (f *fake) fail(id, run, code, message string) {
	m := map[string]any{"type": "error", "code": code, "message": message}
	if id != "" {
		m["id"] = id
	}
	if run != "" {
		m["run"] = run
	}
	f.send(m)
}

func (f *fake) script() script {
	var s script
	raw, err := os.ReadFile(f.scriptPath)
	if err == nil {
		err = json.Unmarshal(raw, &s)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "fake worker: reading the script:", err)
	}
	return s
}

func (f *fake) busy() map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return map[string]any{"runs": len(f.runs), "learning": false, "children": 0}
}

// handle answers one message from Go.
func (f *fake) handle(m map[string]any) {
	typ, id := str(m, "type"), str(m, "id")
	f.mu.Lock()
	if f.account == "" && typ == "hello" {
		f.account = str(m, "account")
	}
	account, ready, stopping := f.account, f.ready, f.stopping
	f.mu.Unlock()
	if account != "" && str(m, "account") != account {
		f.fail(id, "", "wrong_account", "this worker serves another account")
		return
	}
	if !ready && typ != "hello" && typ != "ping" {
		f.fail(id, str(m, "run"), "not_ready", "send hello first")
		return
	}
	switch typ {
	case "hello":
		f.hello(m)
	case "ping":
		f.send(map[string]any{"type": "pong", "id": id, "busy": f.busy()})
	case "run.start":
		if stopping {
			f.fail(id, str(m, "run"), "not_ready", "the worker is shutting down")
			return
		}
		f.runStart(m)
	case "run.stop":
		run := str(m, "run")
		if r := f.live(run); r != nil {
			r.stopOnce.Do(func() { close(r.stop) })
		} else {
			f.fail(id, run, "unknown_run", "no live run "+run)
		}
	case "run.steer":
		run := str(m, "run")
		if f.live(run) != nil {
			f.send(map[string]any{"type": "ack", "id": id, "ok": true})
		} else {
			f.fail(id, run, "unknown_run", "no live run "+run)
		}
	case "approval.answer":
		f.approvalAnswer(m)
	case "tool.result", "gate.verdict":
		f.mu.Lock()
		r := f.pending[id]
		delete(f.pending, id)
		f.mu.Unlock()
		if r == nil {
			fmt.Fprintln(os.Stderr, "fake worker: an answer to no pending request:", id)
			return
		}
		r.replies <- m
	case "session.delete":
		conv := str(m, "conversation_id")
		f.mu.Lock()
		busy := false
		for _, r := range f.runs {
			busy = busy || r.conversation == conv
		}
		f.mu.Unlock()
		if busy {
			f.fail(id, "", "busy", "the conversation has a live run")
		} else {
			f.send(map[string]any{"type": "ack", "id": id, "ok": true})
		}
	case "shutdown":
		// Keep reading through the grace (a live run may still need
		// tool.result), then interrupt what is left and exit 0.
		grace, _ := m["grace"].(float64)
		f.mu.Lock()
		already := f.stopping
		f.stopping = true
		f.mu.Unlock()
		if already {
			return
		}
		go func() {
			done := make(chan struct{})
			go func() { f.runsDone.Wait(); close(done) }()
			select {
			case <-done:
			case <-time.After(time.Duration(grace * float64(time.Second))):
				f.interruptAll()
			}
			f.exit <- 0
		}()
	case "bot.run":
		f.fail(id, str(m, "run"), "unsupported", "bot.run is a later phase")
	default:
		if strings.HasPrefix(typ, "learning.") {
			f.fail(id, "", "unsupported", typ+" is a later phase")
		} else {
			f.fail(id, "", "unknown_type", "unknown type "+typ)
		}
	}
}

func (f *fake) live(run string) *fakeRun {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs[run]
}

func (f *fake) hello(m map[string]any) {
	id := str(m, "id")
	f.mu.Lock()
	again := f.ready
	f.mu.Unlock()
	if again {
		f.fail(id, "", "bad_message", "second hello")
		return
	}
	s := f.script()
	tools := []string{"todo", "skills_list", "skill_view", "skill_manage"}
	if tt, ok := m["timely_tools"].(map[string]any); ok {
		list, _ := tt["tools"].([]any)
		for _, spec := range list {
			if spec, ok := spec.(map[string]any); ok && str(spec, "name") != "" {
				tools = append(tools, str(spec, "name"))
			}
		}
	}
	selfTest := map[string]any{"ok": true, "failures": []string{}, "checks": []any{map[string]any{"name": "plugins", "ok": true}}}
	if s.SelfTestFail != "" {
		selfTest = map[string]any{"ok": false, "failures": []string{"plugins: " + s.SelfTestFail},
			"checks": []any{map[string]any{"name": "plugins", "ok": false, "detail": s.SelfTestFail}}}
	}
	f.send(map[string]any{
		"type": "ready", "id": id, "protocol": 1, "hermes_tag": "fake",
		"tools": tools, "plugins_loaded": []string{"timely_gate", "timely_tools", "timely_learning", "timely_bot"},
		"self_test": selfTest, "config_sha256": m["settings_hash"], "catalog_version": m["catalog_version"],
		"skills_sync": map[string]any{}, "boot_ms": 0, "pid": os.Getpid(),
	})
	f.mu.Lock()
	f.ready = s.SelfTestFail == ""
	f.mu.Unlock()
	if s.SelfTestFail != "" {
		return
	}
	every := time.Duration(s.HeartbeatMS) * time.Millisecond
	if every <= 0 {
		every = time.Second
	}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-f.quit:
				return
			case <-t.C:
				f.send(map[string]any{"type": "heartbeat", "busy": f.busy()})
			}
		}
	}()
}

// runStartProblem mirrors the real worker's checks (worker.py
// run_start_problem and on_run_start), so the fake refuses what it refuses.
func runStartProblem(m map[string]any) string {
	if str(m, "run") == "" || str(m, "conversation_id") == "" {
		return "run.start needs run and conversation_id"
	}
	toolsets, ok := m["toolsets"].([]any)
	if !ok {
		return "run.start needs an explicit toolsets list"
	}
	for _, t := range toolsets {
		if _, ok := t.(string); !ok {
			return "toolsets must be a list of strings"
		}
	}
	for field, want := range map[string]string{
		"tainted_sources": "list", "history": "list", "pre_approved": "dict", "budgets": "dict",
		"flags": "dict", "model": "dict", "session_key": "str", "user_message": "str", "system_text": "str",
	} {
		v, present := m[field]
		if !present || v == nil {
			continue
		}
		var good bool
		switch want {
		case "list":
			_, good = v.([]any)
		case "dict":
			_, good = v.(map[string]any)
		case "str":
			_, good = v.(string)
		}
		if !good {
			return fmt.Sprintf("%s must be a %s", field, want)
		}
	}
	return ""
}

func (f *fake) runStart(m map[string]any) {
	id, run, conv := str(m, "id"), str(m, "run"), str(m, "conversation_id")
	if problem := runStartProblem(m); problem != "" {
		f.fail(id, run, "bad_message", problem)
		return
	}
	s := f.script()
	lines := s.fixtureFor(conv, str(m, "user_message"))
	if len(lines) > 0 {
		var first map[string]any
		if json.Unmarshal(lines[0], &first) == nil && str(first, "fake") == "refuse" {
			code := str(first, "code")
			if code == "" {
				code = "refused"
			}
			f.fail(id, run, code, str(first, "message"))
			return
		}
	}
	f.mu.Lock()
	if _, live := f.runs[run]; live {
		f.mu.Unlock()
		f.fail(id, run, "duplicate_run", "run is already running")
		return
	}
	for _, r := range f.runs {
		if r.conversation == conv {
			f.mu.Unlock()
			f.fail(id, run, "busy", "this conversation already has a live run")
			return
		}
	}
	if len(f.runs) >= maxLiveRuns {
		f.mu.Unlock()
		f.fail(id, run, "busy", "the account already has 3 live runs")
		return
	}
	r := &fakeRun{
		id: run, startID: id, conversation: conv, sessionKey: str(m, "session_key"), userMessage: str(m, "user_message"),
		stop: make(chan struct{}), replies: make(chan map[string]any, 1), approvals: make(chan string, 1),
	}
	f.runs[run] = r
	f.runsDone.Add(1)
	f.mu.Unlock()
	go f.replay(r, lines)
}

func (f *fake) approvalAnswer(m map[string]any) {
	id, run := str(m, "id"), str(m, "run")
	if str(m, "request_id") == "" {
		f.fail(id, run, "bad_message", "approval.answer needs request_id")
		return
	}
	f.mu.Lock()
	r := f.runs[run]
	waiting := r != nil && r.waitingOK
	if waiting {
		// Queued under f.mu, so the wait directive sees it the moment
		// waitingOK drops. waitingOK is only set while approvals is empty.
		r.waitingOK = false
		r.approvals <- id
	}
	f.mu.Unlock()
	switch {
	case r == nil:
		f.fail(id, run, "unknown_run", "no live run "+run)
	case waiting:
		f.send(map[string]any{"type": "ack", "id": id, "ok": true})
	default:
		f.send(map[string]any{"type": "ack", "id": id, "ok": false})
	}
}

// interruptAll stops every live run (shutdown, stdin closed) and waits for
// their run.done lines.
func (f *fake) interruptAll() {
	f.mu.Lock()
	select {
	case <-f.quit:
	default:
		close(f.quit)
	}
	f.mu.Unlock()
	done := make(chan struct{})
	go func() { f.runsDone.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
}

// replay plays a fixture for one run and ends it with exactly one run.done.
func (f *fake) replay(r *fakeRun, lines []json.RawMessage) {
	defer f.runsDone.Done()
	defer f.forget(r)
	interrupted := false
	for _, raw := range lines {
		if f.stopped(r) {
			interrupted = true
			break
		}
		if !f.step(r, raw) {
			interrupted = true
			break
		}
		if r.sentDone {
			return
		}
	}
	f.forget(r)
	if interrupted {
		f.send(map[string]any{"type": "run.done", "id": r.startID, "run": r.id, "final_response": r.text.String(),
			"completed": false, "interrupted": true, "turn_exit_reason": "interrupted", "tokens": zeroTokens(),
			"estimated_cost_usd": nil, "turn_id": "", "tainted_sources": []any{}})
		return
	}
	f.send(map[string]any{"type": "run.done", "id": r.startID, "run": r.id, "final_response": r.text.String(),
		"completed": true, "interrupted": false, "turn_exit_reason": "text_response", "tokens": zeroTokens(),
		"estimated_cost_usd": nil, "turn_id": "", "tainted_sources": []any{}})
}

// arm makes the run accept one approval.answer, unless one is already
// queued for the next wait.
func (f *fake) arm(r *fakeRun) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(r.approvals) == 0 {
		r.waitingOK = true
	}
}

// forget drops a run from the live table. It runs before the run's run.done
// is sent, so a session.delete or run.start that follows run.done never sees
// the finished run as live.
func (f *fake) forget(r *fakeRun) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.runs[r.id] == r {
		delete(f.runs, r.id)
	}
	for id, p := range f.pending {
		if p == r {
			delete(f.pending, id)
		}
	}
}

func zeroTokens() map[string]int {
	return map[string]int{"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0,
		"reasoning_tokens": 0, "total_tokens": 0}
}

func (f *fake) stopped(r *fakeRun) bool {
	select {
	case <-r.stop:
		return true
	case <-f.quit:
		return true
	default:
		return false
	}
}

// wait blocks for d, or until the run is stopped (false).
func (f *fake) wait(r *fakeRun, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-r.stop:
		return false
	case <-f.quit:
		return false
	}
}

// step plays one fixture line; false means the run was stopped.
func (f *fake) step(r *fakeRun, raw json.RawMessage) bool {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return true
	}
	obj, _ = f.substitute(r, obj).(map[string]any)
	if directive := str(obj, "fake"); directive != "" {
		return f.directive(r, directive, obj)
	}
	typ := str(obj, "type")
	switch typ {
	case "ready", "pong", "ack", "heartbeat":
		// Answers to another session's requests in a recording: never replayed.
		return true
	}
	_, hasRun := obj["run"]
	switch typ {
	case "event", "tool.call", "gate.ask", "taint", "run.done":
		hasRun = true
	}
	if hasRun {
		obj["run"] = r.id
	}
	nowait, _ := obj["_nowait"].(bool)
	delete(obj, "_nowait")
	switch typ {
	case "event":
		switch str(obj, "kind") {
		case "delta":
			if p, ok := obj["payload"].(map[string]any); ok {
				r.text.WriteString(str(p, "text"))
			}
		case "approval.request":
			// Like Hermes, the approval is pending before Go hears of it, so
			// an answer that beats the fixture's wait line is still taken.
			f.arm(r)
		}
		f.send(obj)
		return true
	case "run.done":
		obj["id"] = r.startID
		f.forget(r)
		f.send(obj)
		r.sentDone = true
		return true
	case "tool.call", "gate.ask":
		f.mu.Lock()
		f.nextReq++
		reqID := fmt.Sprintf("w-%s-%d", r.id, f.nextReq)
		if !nowait {
			f.pending[reqID] = r
		}
		f.mu.Unlock()
		obj["id"] = reqID
		if typ == "tool.call" {
			obj["session_key"] = r.sessionKey
		}
		f.send(obj)
		if nowait {
			return true
		}
		select {
		case reply := <-r.replies:
			if typ == "tool.call" {
				r.lastResult = resultText(reply["result"])
			}
			return true
		case <-r.stop:
			return false
		case <-f.quit:
			return false
		}
	default:
		f.send(obj)
		return true
	}
}

func resultText(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	raw, _ := json.Marshal(v)
	return string(raw)
}

func (f *fake) directive(r *fakeRun, directive string, obj map[string]any) bool {
	switch directive {
	case "reply":
		text := str(obj, "text")
		chunk := 0
		if n, ok := obj["chunk"].(float64); ok {
			chunk = int(n)
		}
		if chunk <= 0 {
			chunk = len(text)
		}
		for len(text) > 0 {
			if f.stopped(r) {
				return false
			}
			n := min(chunk, len(text))
			r.text.WriteString(text[:n])
			f.send(map[string]any{"type": "event", "run": r.id, "kind": "delta", "payload": map[string]any{"text": text[:n]}})
			text = text[n:]
		}
		return true
	case "sleep":
		ms, _ := obj["ms"].(float64)
		return f.wait(r, time.Duration(ms)*time.Millisecond)
	case "hang":
		select {
		case <-r.stop:
		case <-f.quit:
		}
		return false
	case "wait":
		if str(obj, "for") != "approval.answer" {
			fmt.Fprintln(os.Stderr, "fake worker: unknown wait", str(obj, "for"))
			return true
		}
		f.arm(r)
		select {
		case <-r.approvals:
			return true
		case <-r.stop:
			return false
		case <-f.quit:
			return false
		}
	case "crash":
		code, _ := obj["code"].(float64)
		if code == 0 {
			code = 7
		}
		fmt.Fprintln(os.Stderr, "fake worker: crashing mid-run as the fixture asks")
		os.Exit(int(code))
	case "refuse":
		return true // only meaningful as the first line, handled at run.start
	default:
		fmt.Fprintln(os.Stderr, "fake worker: unknown directive", directive)
	}
	return true
}

// substitute fills the placeholders in every string value (send stamps the
// account).
func (f *fake) substitute(r *fakeRun, v any) any {
	switch v := v.(type) {
	case map[string]any:
		for k, x := range v {
			v[k] = f.substitute(r, x)
		}
		return v
	case []any:
		for i, x := range v {
			v[i] = f.substitute(r, x)
		}
		return v
	case string:
		if !strings.Contains(v, "{{") {
			return v
		}
		f.mu.Lock()
		account := f.account
		f.mu.Unlock()
		return strings.NewReplacer(
			"{{run}}", r.id, "{{conversation_id}}", r.conversation, "{{session_key}}", r.sessionKey,
			"{{user_message}}", r.userMessage, "{{account}}", account, "{{last_result}}", r.lastResult,
		).Replace(v)
	}
	return v
}
