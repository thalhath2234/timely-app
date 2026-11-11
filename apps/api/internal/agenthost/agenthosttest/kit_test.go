package agenthosttest

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/agenthost"
)

func TestMain(m *testing.M) { Main(m) }

type rig struct {
	t     *testing.T
	kit   *Kit
	sup   *agenthost.Supervisor
	msgs  chan agenthost.Message
	exits chan agenthost.ExitInfo

	mu      sync.Mutex
	onCall  func(w *agenthost.Worker, m agenthost.Message) bool // false: leave the request unanswered
	answers []map[string]any
}

func newRig(t *testing.T, tweak func(*agenthost.Config)) *rig {
	t.Helper()
	r := &rig{t: t, kit: New(t), msgs: make(chan agenthost.Message, 512), exits: make(chan agenthost.ExitInfo, 8)}
	cfg := r.kit.Config()
	cfg.OnExit = func(e agenthost.ExitInfo) { r.exits <- e }
	cfg.Handler = func(w *agenthost.Worker, m agenthost.Message) {
		r.msgs <- m
		r.mu.Lock()
		on := r.onCall
		r.mu.Unlock()
		if on != nil && !on(w, m) {
			return
		}
		switch m.Type {
		case agenthost.TypeToolCall:
			var call struct {
				Name string `json:"name"`
			}
			_ = m.Decode(&call)
			_ = w.Reply(m, agenthost.TypeToolResult, map[string]any{"result": "result of " + call.Name, "outside": false, "end_turn": false})
		case agenthost.TypeGateAsk:
			_ = w.Reply(m, agenthost.TypeGateVerdict, map[string]any{"verdict": "block", "message": "That isn't available in Timely yet"})
		}
	}
	if tweak != nil {
		tweak(&cfg)
	}
	r.sup = agenthost.New(cfg)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := r.sup.Shutdown(ctx); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})
	return r
}

func (r *rig) worker() *agenthost.Worker {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	w, err := r.sup.Ensure(ctx, "acct-1")
	if err != nil {
		r.t.Fatalf("Ensure: %v", err)
	}
	return w
}

func startFields(run, conv, message string) map[string]any {
	return map[string]any{
		"run": run, "conversation_id": conv, "session_key": "timely:acct-1:" + conv, "user_message": message,
		"system_text": "Timely block", "system_hash": "h",
		"model":    map[string]any{"provider": "custom", "model": "stub", "base_url": "http://127.0.0.1:9/v1", "api_key": "sk-stand-in", "api_mode": "chat_completions"},
		"toolsets": []string{"timely", "todo", "skills"}, "flags": map[string]any{"learning_writes": false},
		"budgets": map[string]any{}, "tainted_sources": []any{}, "permission": "supervised",
	}
}

// until collects the run's messages up to and including the first of type
// end.
func (r *rig) until(run, end string) []agenthost.Message {
	r.t.Helper()
	var got []agenthost.Message
	deadline := time.After(10 * time.Second)
	for {
		select {
		case m := <-r.msgs:
			if m.Run != run {
				continue
			}
			got = append(got, m)
			if m.Type == end {
				return got
			}
		case <-deadline:
			r.t.Fatalf("no %s for %s; got %d messages", end, run, len(got))
			return nil
		}
	}
}

type done struct {
	ID          string `json:"id"`
	Final       string `json:"final_response"`
	Completed   bool   `json:"completed"`
	Interrupted bool   `json:"interrupted"`
}

func decodeDone(t *testing.T, m agenthost.Message) done {
	t.Helper()
	var d done
	if err := m.Decode(&d); err != nil {
		t.Fatal(err)
	}
	return d
}

func deltas(msgs []agenthost.Message) string {
	var b strings.Builder
	for _, m := range msgs {
		var ev struct {
			Kind    string `json:"kind"`
			Payload struct {
				Text string `json:"text"`
			} `json:"payload"`
		}
		if m.Type == "event" && m.Decode(&ev) == nil && ev.Kind == "delta" {
			b.WriteString(ev.Payload.Text)
		}
	}
	return b.String()
}

func TestHelloGetsAPassingReadyAndTheToolCatalog(t *testing.T) {
	r := newRig(t, func(c *agenthost.Config) {
		c.TimelyTools = func(context.Context) (string, json.RawMessage, error) {
			return "cat-1", json.RawMessage(`[{"name":"list_tasks","description":"d","parameters":{},"outside":false}]`), nil
		}
	})
	w := r.worker()
	ready := w.Ready()
	if !ready.SelfTest.OK || ready.HermesTag != "fake" || ready.PID != w.PID() {
		t.Fatalf("ready = %+v (pid %d)", ready, w.PID())
	}
	found := false
	for _, name := range ready.Tools {
		found = found || name == "list_tasks"
	}
	if !found {
		t.Errorf("ready.tools %v lacks the Timely tool", ready.Tools)
	}
	hello := r.kit.WaitReceived("hello", 1, time.Second)[0]
	var body struct {
		CatalogVersion string `json:"catalog_version"`
		TimelyTools    struct {
			CatalogVersion string `json:"catalog_version"`
		} `json:"timely_tools"`
	}
	if err := hello.Decode(&body); err != nil || body.CatalogVersion != "cat-1" || body.TimelyTools.CatalogVersion != "cat-1" || hello.Account != "acct-1" {
		t.Fatalf("hello = %s", hello.Raw)
	}
}

func TestFailSelfTestRefusesTheWorker(t *testing.T) {
	r := newRig(t, nil)
	r.kit.FailSelfTest("timely_gate missing")
	_, err := r.sup.Ensure(context.Background(), "acct-1")
	if !errors.Is(err, agenthost.ErrSelfTestFailed) || !strings.Contains(err.Error(), "timely_gate missing") {
		t.Fatalf("Ensure = %v", err)
	}
}

func TestReplaySubstitutesRunIDsAndEndsWithRunDone(t *testing.T) {
	r := newRig(t, nil)
	// A recorded fixture: its own run id, ids and account, replaced on replay.
	r.kit.Fixture("recorded", []byte(`
# recorded from the worker
{"type":"event","account":"rec-acct","run":"rec-run","kind":"tool.started","payload":{"tool_call_id":"c1","tool":"list_tasks","args":{}}}
{"type":"tool.call","account":"rec-acct","id":"w-old","run":"rec-run","session_key":"timely:rec:conv","tool_call_id":"c1","name":"list_tasks","args":{},"tainted_sources":[],"batch_size":1,"sibling_tools":[]}
{"type":"event","run":"rec-run","kind":"tool.completed","payload":{"tool_call_id":"c1","tool":"list_tasks","result":"{{last_result}}"}}
{"fake":"reply","text":"Here are your tasks for {{conversation_id}}.","chunk":7}
{"type":"heartbeat","busy":{"runs":1}}
{"type":"run.done","id":"start-old","run":"rec-run","final_response":"Here are your tasks for {{conversation_id}}.","completed":true,"interrupted":false}
`)).Default("recorded")
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("run-7", "conv-7", "what is due?")); err != nil {
		t.Fatal(err)
	}
	msgs := r.until("run-7", agenthost.TypeRunDone)
	var call, completed agenthost.Message
	for _, m := range msgs {
		if m.Account != "acct-1" {
			t.Errorf("%s stamped with account %q", m.Type, m.Account)
		}
		switch {
		case m.Type == agenthost.TypeToolCall:
			call = m
		case m.Type == "event" && strings.Contains(string(m.Raw), "tool.completed"):
			completed = m
		}
	}
	var callBody struct {
		SessionKey string `json:"session_key"`
	}
	_ = call.Decode(&callBody)
	if !strings.HasPrefix(call.ID, "w-run-7-") || callBody.SessionKey != "timely:acct-1:conv-7" {
		t.Errorf("tool.call = %s", call.Raw)
	}
	if !strings.Contains(string(completed.Raw), `"result":"result of list_tasks"`) {
		t.Errorf("tool.completed did not wait for the tool.result: %s", completed.Raw)
	}
	if got := deltas(msgs); got != "Here are your tasks for conv-7." {
		t.Errorf("deltas %q", got)
	}
	d := decodeDone(t, msgs[len(msgs)-1])
	if !strings.HasPrefix(d.ID, "start-") || !d.Completed || d.Final != "Here are your tasks for conv-7." {
		t.Errorf("run.done = %+v", d)
	}
	for _, m := range msgs {
		if m.Type == "heartbeat" {
			t.Error("a recorded heartbeat was replayed")
		}
	}
	if live := w.LiveRuns(); len(live) != 0 {
		t.Errorf("live runs after run.done: %v", live)
	}
	results := r.kit.ReceivedOf(agenthost.TypeToolResult)
	if len(results) != 1 || results[0].ID != call.ID {
		t.Errorf("tool.result lines %v", results)
	}
}

func TestMissingRunDoneIsAddedAndRoutingPicksTheFixture(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Fixture("a", []byte(`{"fake":"reply","text":"from a"}`)).
		Fixture("b", []byte(`{"fake":"reply","text":"from b"}`)).
		Fixture("c", []byte(`{"fake":"reply","text":"from c"}`)).
		Default("a").ForMessage("weather", "b").ForConversation("conv-c", "c")
	w := r.worker()
	for _, tc := range []struct{ run, conv, msg, want string }{
		{"r1", "conv-1", "hello", "from a"},
		{"r2", "conv-2", "the weather today", "from b"},
		{"r3", "conv-c", "the weather today", "from c"},
	} {
		if err := w.Send(agenthost.TypeRunStart, startFields(tc.run, tc.conv, tc.msg)); err != nil {
			t.Fatal(err)
		}
		msgs := r.until(tc.run, agenthost.TypeRunDone)
		if d := decodeDone(t, msgs[len(msgs)-1]); !d.Completed || d.Interrupted || d.Final != tc.want {
			t.Errorf("%s: run.done = %+v, want %q", tc.run, d, tc.want)
		}
	}
	// The script is re-read at every run.start.
	r.kit.Default("b")
	if err := w.Send(agenthost.TypeRunStart, startFields("r4", "conv-4", "hello")); err != nil {
		t.Fatal(err)
	}
	msgs := r.until("r4", agenthost.TypeRunDone)
	if d := decodeDone(t, msgs[len(msgs)-1]); d.Final != "from b" {
		t.Errorf("after a script change: %+v", d)
	}
}

func TestGateAskWaitsForTheVerdict(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Default("gate").Fixture("gate", []byte(`
{"type":"gate.ask","tool_call_id":"c1","tool":"web_search","args":{"query":"x"},"tainted_sources":[],"run_kind":"chat"}
{"fake":"reply","text":"blocked as asked"}
`))
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("g1", "conv-g", "search")); err != nil {
		t.Fatal(err)
	}
	msgs := r.until("g1", agenthost.TypeRunDone)
	if msgs[0].Type != agenthost.TypeGateAsk || deltas(msgs) != "blocked as asked" {
		t.Fatalf("messages %v", msgs)
	}
	verdicts := r.kit.ReceivedOf(agenthost.TypeGateVerdict)
	if len(verdicts) != 1 || verdicts[0].ID != msgs[0].ID || !strings.Contains(string(verdicts[0].Raw), "isn't available in Timely yet") {
		t.Fatalf("verdicts %v", verdicts)
	}
}

func TestRunStopEndsTheRunWhileItWaits(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Fixture("hang", []byte(`{"fake":"reply","text":"thinking"}
{"fake":"hang"}`)).ForConversation("conv-h", "hang")
	r.kit.Fixture("tool", []byte(`{"type":"tool.call","tool_call_id":"c1","name":"slow_tool","args":{}}`)).ForConversation("conv-t", "tool")
	r.mu.Lock()
	r.onCall = func(_ *agenthost.Worker, m agenthost.Message) bool { return m.Type != agenthost.TypeToolCall } // never answers
	r.mu.Unlock()
	w := r.worker()
	for _, tc := range []struct{ run, conv, firstType string }{{"h1", "conv-h", "event"}, {"t1", "conv-t", agenthost.TypeToolCall}} {
		if err := w.Send(agenthost.TypeRunStart, startFields(tc.run, tc.conv, "go")); err != nil {
			t.Fatal(err)
		}
		first := r.until(tc.run, tc.firstType)
		if err := w.Send(agenthost.TypeRunStop, map[string]any{"run": tc.run, "reason": "user"}); err != nil {
			t.Fatal(err)
		}
		msgs := r.until(tc.run, agenthost.TypeRunDone)
		d := decodeDone(t, msgs[len(msgs)-1])
		if !d.Interrupted || d.Completed || !strings.HasPrefix(d.ID, "start-") {
			t.Errorf("%s: run.done = %+v", tc.run, d)
		}
		if tc.run == "h1" && d.Final != deltas(first) {
			t.Errorf("interrupted final %q, deltas %q", d.Final, deltas(first))
		}
	}
	if live := w.LiveRuns(); len(live) != 0 {
		t.Errorf("live runs: %v", live)
	}
	// A stop for no live run gets unknown_run (Go only logs it).
	if err := w.Send(agenthost.TypeRunStop, map[string]any{"run": "nope", "reason": "user"}); err != nil {
		t.Fatal(err)
	}
}

func TestSteerIsAckedAndRecorded(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Default("hang").Fixture("hang", []byte(`{"fake":"hang"}`))
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("s1", "conv-s", "go")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reply, err := w.Request(ctx, agenthost.TypeRunSteer, map[string]any{"run": "s1", "text": "also add milk"})
	if err != nil || reply.Type != "ack" || !strings.Contains(string(reply.Raw), `"ok":true`) {
		t.Fatalf("steer = %s, %v", reply.Raw, err)
	}
	steers := r.kit.ReceivedOf(agenthost.TypeRunSteer)
	var body struct {
		Text string `json:"text"`
	}
	if len(steers) != 1 || steers[0].Run != "s1" || steers[0].Decode(&body) != nil || body.Text != "also add milk" {
		t.Fatalf("recorded steers %v", steers)
	}
	_, err = w.Request(ctx, agenthost.TypeRunSteer, map[string]any{"run": "gone", "text": "x"})
	var re *agenthost.ReplyError
	if !errors.As(err, &re) || re.Code != "unknown_run" {
		t.Fatalf("steer of no run = %v", err)
	}
	if live := w.LiveRuns(); len(live) != 1 {
		t.Errorf("an unknown_run answer ended a run: %v", live)
	}
}

func TestSessionDeleteIsBusyWhileTheConversationRuns(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Default("hang").Fixture("hang", []byte(`{"fake":"hang"}`))
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("d1", "conv-d", "go")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r.kit.WaitReceived(agenthost.TypeRunStart, 1, time.Second)
	_, err := w.Request(ctx, "session.delete", map[string]any{"conversation_id": "conv-d"})
	var re *agenthost.ReplyError
	if !errors.As(err, &re) || re.Code != "busy" {
		t.Fatalf("delete during a run = %v", err)
	}
	if err := w.Send(agenthost.TypeRunStop, map[string]any{"run": "d1", "reason": "delete"}); err != nil {
		t.Fatal(err)
	}
	r.until("d1", agenthost.TypeRunDone)
	reply, err := w.Request(ctx, "session.delete", map[string]any{"conversation_id": "conv-d"})
	if err != nil || reply.Type != "ack" {
		t.Fatalf("delete = %s, %v", reply.Raw, err)
	}
	if got := r.kit.ReceivedOf("session.delete"); len(got) != 2 {
		t.Errorf("recorded deletes %d", len(got))
	}
}

func TestRefusalsEndTheRunStart(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Fixture("hang", []byte(`{"fake":"hang"}`)).Default("hang").
		Fixture("refuse", []byte(`{"fake":"refuse","code":"refused","message":"self-test failed"}`)).ForConversation("conv-r", "refuse")
	w := r.worker()

	expectError := func(run, code string) {
		t.Helper()
		msgs := r.until(run, agenthost.TypeError)
		var body struct {
			Code string `json:"code"`
		}
		_ = msgs[len(msgs)-1].Decode(&body)
		if body.Code != code {
			t.Errorf("%s: error %s, want %s", run, msgs[len(msgs)-1].Raw, code)
		}
	}
	if err := w.Send(agenthost.TypeRunStart, startFields("r1", "conv-r", "go")); err != nil {
		t.Fatal(err)
	}
	expectError("r1", "refused")

	bad := startFields("r2", "conv-2", "go")
	delete(bad, "toolsets")
	if err := w.Send(agenthost.TypeRunStart, bad); err != nil {
		t.Fatal(err)
	}
	expectError("r2", "bad_message")

	if err := w.Send(agenthost.TypeRunStart, startFields("r3", "conv-3", "go")); err != nil {
		t.Fatal(err)
	}
	r.kit.WaitReceived(agenthost.TypeRunStart, 3, time.Second)
	if err := w.Send(agenthost.TypeRunStart, startFields("r4", "conv-3", "go")); err != nil {
		t.Fatal(err)
	}
	expectError("r4", "busy")
	for _, run := range []string{"r5", "r6"} {
		if err := w.Send(agenthost.TypeRunStart, startFields(run, "conv-"+run, "go")); err != nil {
			t.Fatal(err)
		}
	}
	r.kit.WaitReceived(agenthost.TypeRunStart, 6, time.Second)
	if err := w.Send(agenthost.TypeRunStart, startFields("r7", "conv-r7", "go")); err != nil {
		t.Fatal(err)
	}
	expectError("r7", "busy") // a fourth live run in the account
	time.Sleep(50 * time.Millisecond)
	live := w.LiveRuns()
	if len(live) != 3 {
		t.Errorf("live runs %v, want r3, r5, r6", live)
	}
}

func TestApprovalWaitIsAcked(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Default("approve").Fixture("approve", []byte(`
{"type":"event","kind":"approval.request","payload":{"request_id":"req-1","description":"run ls"}}
{"fake":"wait","for":"approval.answer"}
{"fake":"reply","text":"done"}
`))
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("a1", "conv-a", "go")); err != nil {
		t.Fatal(err)
	}
	r.until("a1", "event")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reply, err := w.Request(ctx, agenthost.TypeApprovalAnswer, map[string]any{"run": "a1", "request_id": "req-1", "choice": "once"})
	if err != nil || !strings.Contains(string(reply.Raw), `"ok":true`) {
		t.Fatalf("approval = %s, %v", reply.Raw, err)
	}
	msgs := r.until("a1", agenthost.TypeRunDone)
	if d := decodeDone(t, msgs[len(msgs)-1]); d.Final != "done" || !d.Completed {
		t.Errorf("run.done = %+v", d)
	}
}

func TestCrashMidRunReportsTheLiveRun(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Default("crash").Fixture("crash", []byte(`{"fake":"reply","text":"partial"}
{"fake":"crash","code":9}`))
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("c1", "conv-c", "go")); err != nil {
		t.Fatal(err)
	}
	select {
	case exit := <-r.exits:
		if !exit.Crashed || exit.ExitCode != 9 || len(exit.LiveRuns) != 1 || exit.LiveRuns[0] != "c1" {
			t.Fatalf("exit = %+v", exit)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the worker did not crash")
	}
}

func TestShutdownInterruptsLiveRunsAndExitsCleanly(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Default("hang").Fixture("hang", []byte(`{"fake":"hang"}`))
	w := r.worker()
	if err := w.Send(agenthost.TypeRunStart, startFields("x1", "conv-x", "go")); err != nil {
		t.Fatal(err)
	}
	r.kit.WaitReceived(agenthost.TypeRunStart, 1, time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := r.sup.Stop(ctx, "acct-1", "test"); err != nil {
		t.Fatal(err)
	}
	msgs := r.until("x1", agenthost.TypeRunDone)
	if d := decodeDone(t, msgs[len(msgs)-1]); !d.Interrupted {
		t.Errorf("run.done = %+v", d)
	}
	exit := <-r.exits
	if exit.Crashed || exit.ExitCode != 0 || exit.Reason != "test" {
		t.Errorf("exit = %+v", exit)
	}
	_ = w
}

func TestParseFixtureRejectsAmbiguousLines(t *testing.T) {
	for _, bad := range []string{`{"type":"event","fake":"sleep"}`, `{"kind":"delta"}`, `{"type":`} {
		if _, err := ParseFixture([]byte(bad)); err == nil {
			t.Errorf("ParseFixture(%s) passed", bad)
		}
	}
	lines, err := ParseFixture([]byte("# c\n\n{\"fake\":\"sleep\",\"ms\":1}\n"))
	if err != nil || len(lines) != 1 {
		t.Errorf("lines %v, %v", lines, err)
	}
}
