// Package agenthosttest is a scriptable fake agent worker for tests: it speaks
// worker protocol 1 (apps/agent/PROTOCOL.md) without Python, so a package's
// tests can run a real agenthost.Supervisor, with every check it makes, against
// recorded or hand-written worker behaviour.
//
// # How it plugs in: re-exec of the test binary
//
// The supervisor spawns Kit.Runtime(): the test binary itself with a marker
// argument. The test package's TestMain must hand that process to the fake
// before running any test:
//
//	func TestMain(m *testing.M) { agenthosttest.Main(m) }
//
// (or call RunIfWorker first in a TestMain of its own). Re-exec was chosen over
// an in-process transport so the supervisor under test is the shipped one:
// the same spawn, environment built from scratch, process group or Job Object,
// pid containment check, heartbeats and shutdown. The cost is that the fake
// lives in another process, so the kit talks to it through two files in its
// folder: script.json (fixtures and routing, re-read at every run.start, so a
// test may change it at any time) and received.jsonl (every line the fake was
// sent, which Kit.Received reads back).
//
// # Fixtures
//
// A fixture is JSONL, one object per line ("#" lines and blank lines are
// skipped). It is replayed once per run.start the kit routes to it (ForConversation,
// ForMessage, then Default). A line is either a worker message or a directive.
//
// A worker message is sent as written, after these substitutions: "account" is
// the worker's account; "run" (on event, tool.call, gate.ask, taint and
// run.done, or wherever the line has one) is the current run id; run.done's
// "id" is the run.start's id; tool.call and gate.ask get a fresh "w-" id and
// tool.call gets the run's session_key. String values may also use the
// placeholders {{run}}, {{conversation_id}}, {{session_key}}, {{user_message}},
// {{account}} and {{last_result}} (the last tool.result's result: a string
// result as is, anything else as compact JSON). So a fixture recorded from the
// real worker (make agent-record-fixtures) replays with Go's own run ids.
//
// After a tool.call the fake waits for its tool.result, and after a gate.ask
// for its gate.verdict, as the real worker does; "_nowait": true on the line
// sends it without waiting. If the fixture sends no run.done, the fake ends
// the run with one (completed, final_response = the delta text sent). A
// run.stop at any point (also while waiting) ends the run at once with
// run.done {interrupted: true}.
//
// Directives have a "fake" key instead of "type":
//
//	{"fake": "reply", "text": "...", "chunk": 8}   deltas of text (chunk characters each; default all at once)
//	{"fake": "sleep", "ms": 50}
//	{"fake": "hang"}                               wait for run.stop (or shutdown)
//	{"fake": "wait", "for": "approval.answer"}     wait for an approval.answer for this run, ack it ok
//	{"fake": "crash", "code": 7}                   exit the worker process at once, mid-run
//	{"fake": "refuse", "code": "busy", "message": "..."}   first line only: answer the run.start with an error
//
// # Learning (phase 3)
//
// A fixture line may be any worker message, so a run can report what it
// learned with {"type": "learning", "event": {...}}. Outside runs, Emit queues
// lines the fake sends as soon as it is ready (it polls outbox.jsonl), and
// LearningReply scripts the answer to Go's learning.* and settings.update
// requests: {"type": "learning.result", "id", "ok": true, "data"}, then any
// lines to emit after it (the real worker reports a person's own memory edit
// as a learning event, for example). Replies are per request type, or per
// account and type (LearningReplyFor, tried first); LearningError answers
// with an error instead. An unscripted settings.update is answered ok with
// {"config_sha256": "fake"}; an unscripted learning.* request with the error
// code "unsupported". An emitted line with an "_account" key is sent with
// that account instead of the worker's own (a broken worker, for tests of
// the supervisor's account check).
//
// The fake also answers hello with a passing ready (FailSelfTest makes it
// fail; WebBackends and SkillsUpstream fill its phase 3 fields), ping with pong, sends heartbeats, acks run.steer (recorded),
// approval.answer and session.delete (busy while the conversation has a live
// run), refuses a second live run in one conversation or a fourth in the
// account (busy) and a live run id (duplicate_run), and on shutdown or stdin
// EOF interrupts its live runs and exits 0. It does not apply tool.result's
// end_turn itself: a fixture recorded from the real worker shows what the
// worker did.
package agenthosttest

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/agenthost"
)

// marker is os.Args[1] of a test binary started as the fake worker.
const marker = "agenthosttest-fake-worker"

// Main runs the fake worker when the test binary was started as one, and the
// package's tests otherwise. Call it from TestMain.
func Main(m *testing.M) {
	if code, ok := RunIfWorker(); ok {
		os.Exit(code)
	}
	os.Exit(m.Run())
}

// RunIfWorker runs the fake worker and reports its exit code when this
// process was started as one (os.Args from Kit.Runtime); ok is false
// otherwise, and nothing happens.
func RunIfWorker() (code int, ok bool) {
	if len(os.Args) < 3 || os.Args[1] != marker {
		return 0, false
	}
	return runFake(os.Args[2]), true
}

// script is script.json: what the fake replays, read at every run.start.
type script struct {
	Fixtures      map[string][]json.RawMessage `json:"fixtures"`
	Default       string                       `json:"default,omitempty"`
	Conversations map[string]string            `json:"conversations,omitempty"`
	Matches       []match                      `json:"matches,omitempty"`
	SelfTestFail  string                       `json:"self_test_fail,omitempty"`
	HeartbeatMS   int                          `json:"heartbeat_ms,omitempty"`
	// Learning scripts the answers to learning.* and settings.update, by
	// "<type>" or "<account>|<type>".
	Learning       map[string]learningReply `json:"learning,omitempty"`
	WebBackends    []string                 `json:"web_backends,omitempty"`
	SkillsUpstream int                      `json:"skills_upstream,omitempty"`
}

// learningReply is one scripted answer to a learning.* or settings.update
// request.
type learningReply struct {
	Data    json.RawMessage   `json:"data,omitempty"`
	Code    string            `json:"code,omitempty"` // non-empty: answer with this error
	Message string            `json:"message,omitempty"`
	Emit    []json.RawMessage `json:"emit,omitempty"`
}

func (s script) learningFor(account, typ string) (learningReply, bool) {
	if r, ok := s.Learning[account+"|"+typ]; ok {
		return r, true
	}
	r, ok := s.Learning[typ]
	return r, ok
}

type match struct {
	Contains string `json:"contains"`
	Fixture  string `json:"fixture"`
}

// Kit holds one fake worker setup: its folder, script and received log.
type Kit struct {
	t   testing.TB
	dir string

	mu     sync.Mutex
	script script
	ended  bool
}

// New makes a kit in a fresh temporary folder (never under ~/.hermes). With
// no fixture routed, every run.start replays an empty fixture: a run.done
// with an empty reply.
func New(t testing.TB) *Kit {
	t.Helper()
	k := &Kit{t: t, dir: t.TempDir(), script: script{Fixtures: map[string][]json.RawMessage{}, Conversations: map[string]string{},
		Learning: map[string]learningReply{}}}
	t.Cleanup(func() { k.mu.Lock(); k.ended = true; k.mu.Unlock() })
	k.save()
	return k
}

// logf logs through the test until it has ended: a worker that exits after
// its test must not log into it.
func (k *Kit) logf(format string, args ...any) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.ended {
		k.t.Logf(format, args...)
	}
}

// Dir is the kit's folder (script.json, received.jsonl, agent/).
func (k *Kit) Dir() string { return k.dir }

// Runtime starts this test binary as the fake worker.
func (k *Kit) Runtime() agenthost.Runtime {
	exe, err := os.Executable()
	if err != nil {
		k.t.Fatal(err)
	}
	return agenthost.Runtime{Program: exe, Args: []string{marker, filepath.Join(k.dir, "script.json")}}
}

// Config is a supervisor config for the fake: its runtime, an agent folder
// inside the kit, no render step (the fake has no boot.py), and test-sized
// timeouts. Set Handler, OnExit, TimelyTools and the rest on the result.
func (k *Kit) Config() agenthost.Config {
	return agenthost.Config{
		Root:              filepath.Join(k.dir, "agent"),
		Runtime:           k.Runtime(),
		HelloTimeout:      10 * time.Second,
		HeartbeatInterval: time.Second,
		HeartbeatTimeout:  10 * time.Second,
		ShutdownGrace:     2 * time.Second,
		KillWait:          time.Second,
		Restart:           agenthost.RestartPolicy{BaseBackoff: 20 * time.Millisecond, MaxBackoff: 100 * time.Millisecond},
		Logf:              k.logf,
	}
}

// Fixture stores a JSONL fixture under name (see the package doc).
func (k *Kit) Fixture(name string, jsonl []byte) *Kit {
	k.t.Helper()
	lines, err := ParseFixture(jsonl)
	if err != nil {
		k.t.Fatalf("fixture %s: %v", name, err)
	}
	k.mu.Lock()
	k.script.Fixtures[name] = lines
	k.mu.Unlock()
	k.save()
	return k
}

// FixtureFile stores the JSONL file at path as fixture name.
func (k *Kit) FixtureFile(name, path string) *Kit {
	k.t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		k.t.Fatal(err)
	}
	return k.Fixture(name, raw)
}

// Default replays fixture name for a run.start no other rule routes.
func (k *Kit) Default(name string) *Kit {
	k.mu.Lock()
	k.script.Default = name
	k.mu.Unlock()
	k.save()
	return k
}

// ForConversation replays fixture name for the conversation's run.starts.
func (k *Kit) ForConversation(conversationID, name string) *Kit {
	k.mu.Lock()
	k.script.Conversations[conversationID] = name
	k.mu.Unlock()
	k.save()
	return k
}

// ForMessage replays fixture name for a run.start whose user_message contains
// text (rules are tried in the order added, after ForConversation).
func (k *Kit) ForMessage(text, name string) *Kit {
	k.mu.Lock()
	k.script.Matches = append(k.script.Matches, match{Contains: text, Fixture: name})
	k.mu.Unlock()
	k.save()
	return k
}

// FailSelfTest makes the next workers answer hello with self_test.ok false
// and detail as the failure ("" passes again).
func (k *Kit) FailSelfTest(detail string) *Kit {
	k.mu.Lock()
	k.script.SelfTestFail = detail
	k.mu.Unlock()
	k.save()
	return k
}

// LearningReply answers every worker's typ requests (learning.list,
// learning.memory, settings.update, ...) with learning.result {ok: true,
// data}, then sends emit (learning messages, say) after it.
func (k *Kit) LearningReply(typ string, data any, emit ...map[string]any) *Kit {
	return k.LearningReplyFor("", typ, data, emit...)
}

// LearningReplyFor is LearningReply for one account's worker only; it wins
// over a reply for every account.
func (k *Kit) LearningReplyFor(account, typ string, data any, emit ...map[string]any) *Kit {
	k.t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		k.t.Fatal(err)
	}
	return k.setLearning(account, typ, learningReply{Data: raw, Emit: k.lines(emit)})
}

// LearningError answers typ requests with an error {code, message}, for
// account's worker ("" for every account).
func (k *Kit) LearningError(account, typ, code, message string) *Kit {
	return k.setLearning(account, typ, learningReply{Code: code, Message: message})
}

func (k *Kit) setLearning(account, typ string, r learningReply) *Kit {
	key := typ
	if account != "" {
		key = account + "|" + typ
	}
	k.mu.Lock()
	k.script.Learning[key] = r
	k.mu.Unlock()
	k.save()
	return k
}

// WebBackends and SkillsUpstream fill the next workers' ready.web_backends
// and ready.skills_upstream.
func (k *Kit) WebBackends(ids []string, skillsUpstream int) *Kit {
	k.mu.Lock()
	k.script.WebBackends, k.script.SkillsUpstream = ids, skillsUpstream
	k.mu.Unlock()
	k.save()
	return k
}

// Emit queues lines for the running fake workers to send, outside any run
// (each worker sends every queued line once, stamped with its account unless
// the line has "_account"). Lines queued before a worker is ready are sent
// once it is.
func (k *Kit) Emit(lines ...map[string]any) *Kit {
	k.t.Helper()
	var buf bytes.Buffer
	for _, raw := range k.lines(lines) {
		buf.Write(raw)
		buf.WriteByte('\n')
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	f, err := os.OpenFile(filepath.Join(k.dir, "outbox.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		k.t.Fatal(err)
	}
	_, werr := f.Write(buf.Bytes())
	if cerr := f.Close(); werr != nil || cerr != nil {
		k.t.Fatalf("emit: %v %v", werr, cerr)
	}
	return k
}

func (k *Kit) lines(objs []map[string]any) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(objs))
	for _, obj := range objs {
		raw, err := json.Marshal(obj)
		if err != nil {
			k.t.Fatal(err)
		}
		out = append(out, raw)
	}
	return out
}

// save writes script.json atomically, so the fake never reads half of it.
func (k *Kit) save() {
	k.mu.Lock()
	raw, err := json.Marshal(k.script)
	k.mu.Unlock()
	if err != nil {
		k.t.Fatal(err)
	}
	tmp, err := os.CreateTemp(k.dir, "script-*.json")
	if err != nil {
		k.t.Fatal(err)
	}
	_, werr := tmp.Write(raw)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		k.t.Fatalf("write script: %v %v", werr, cerr)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(k.dir, "script.json")); err != nil {
		k.t.Fatal(err)
	}
}

// ParseFixture splits JSONL into its objects, skipping blank and "#" lines.
func ParseFixture(jsonl []byte) ([]json.RawMessage, error) {
	var out []json.RawMessage
	sc := bufio.NewScanner(bytes.NewReader(jsonl))
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for n := 1; sc.Scan(); n++ {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(line, &obj); err != nil {
			return nil, fmt.Errorf("line %d: %v", n, err)
		}
		_, isMsg := obj["type"]
		_, isDirective := obj["fake"]
		if isMsg == isDirective {
			return nil, fmt.Errorf("line %d: needs exactly one of \"type\" and \"fake\"", n)
		}
		out = append(out, append(json.RawMessage(nil), line...))
	}
	return out, sc.Err()
}

// Received is one line the fake was sent.
type Received struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Run     string          `json:"run,omitempty"`
	Account string          `json:"account,omitempty"`
	Raw     json.RawMessage `json:"-"`
}

// Decode unmarshals the whole line into v.
func (r Received) Decode(v any) error { return json.Unmarshal(r.Raw, v) }

// Received lists every line the fake workers of this kit were sent, in
// order (hello, run.start, tool.result, run.steer, session.delete, ...).
func (k *Kit) Received() []Received {
	raw, err := os.ReadFile(filepath.Join(k.dir, "received.jsonl"))
	if err != nil {
		return nil
	}
	var out []Received
	for _, line := range bytes.Split(raw, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var r Received
		if json.Unmarshal(line, &r) != nil {
			continue // a line still being written
		}
		r.Raw = append(json.RawMessage(nil), line...)
		out = append(out, r)
	}
	return out
}

// ReceivedOf lists the received lines of type typ.
func (k *Kit) ReceivedOf(typ string) []Received {
	var out []Received
	for _, r := range k.Received() {
		if r.Type == typ {
			out = append(out, r)
		}
	}
	return out
}

// WaitReceived waits until the fake has been sent at least n lines of type
// typ, and returns them; the test fails after timeout.
func (k *Kit) WaitReceived(typ string, n int, timeout time.Duration) []Received {
	k.t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		got := k.ReceivedOf(typ)
		if len(got) >= n {
			return got
		}
		if time.Now().After(deadline) {
			k.t.Fatalf("the fake worker got %d %s lines within %s, want %d", len(got), typ, timeout, n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// fixtureFor picks the fixture for a run.start: by conversation, by message
// text, then the default. Unknown or unset names replay nothing.
func (s script) fixtureFor(conversation, message string) []json.RawMessage {
	if name, ok := s.Conversations[conversation]; ok {
		return s.Fixtures[name]
	}
	for _, m := range s.Matches {
		if m.Contains != "" && strings.Contains(message, m.Contains) {
			return s.Fixtures[m.Fixture]
		}
	}
	return s.Fixtures[s.Default]
}
