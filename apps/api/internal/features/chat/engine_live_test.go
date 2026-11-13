package chat

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"timely-api/internal/features/agent"
)

// The recorded worker fixtures (make agent-record-fixtures OUT=
// apps/api/internal/features/chat/testdata/agent: the real worker on the stub
// model) replayed through the follower's live state, without a database.
// engine_integration_test.go replays the same files through the whole engine
// and checks the stored row.

const fixtureDir = "testdata/agent"

// fixtureLines reads one recorded scenario.
func fixtureLines(t *testing.T, name string) []map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixtureDir, name+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var out []map[string]json.RawMessage
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		if len(bytes.TrimSpace(sc.Bytes())) == 0 {
			continue
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		out = append(out, m)
	}
	return out
}

func field[T any](t *testing.T, m map[string]json.RawMessage, key string) T {
	t.Helper()
	var v T
	if raw, ok := m[key]; ok {
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", key, err)
		}
	}
	return v
}

// replayLive plays a fixture's worker lines through a liveRun the way the
// follower does, and returns what the follower would act on.
type liveReplay struct {
	live      *liveRun
	deltas    []liveDelta
	toolCalls []string
	batches   []int
	gateAsks  []string
	taint     []TaintSource
	done      runDone
	changes   int
}

func replayLive(t *testing.T, name string) liveReplay {
	t.Helper()
	r := liveReplay{live: newLiveRun("run-" + name)}
	at := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	for _, m := range fixtureLines(t, name) {
		switch field[string](t, m, "type") {
		case "event":
			var ev workerEvent
			raw, _ := json.Marshal(m)
			if err := json.Unmarshal(raw, &ev); err != nil {
				t.Fatal(err)
			}
			changed, delta := r.live.event(ev, at)
			if changed {
				r.changes++
			}
			if delta != nil {
				r.deltas = append(r.deltas, *delta)
			}
		case "tool.call":
			r.toolCalls = append(r.toolCalls, field[string](t, m, "name"))
			r.batches = append(r.batches, field[int](t, m, "batch_size"))
		case "gate.ask":
			r.gateAsks = append(r.gateAsks, field[string](t, m, "tool"))
		case "taint":
			r.taint = append(r.taint, field[[]TaintSource](t, m, "sources")...)
		case "run.done":
			raw, _ := json.Marshal(m)
			if err := json.Unmarshal(raw, &r.done); err != nil {
				t.Fatal(err)
			}
		}
	}
	return r
}

// Every recorded scenario: the streamed chunks rebuild the reply exactly (at
// the offsets the apps' applyDelta expects), each tool the model ran has
// one activity line that ends done or failed, and the run.done says what
// the turn ended with.
func TestRecordedFixturesThroughTheFollower(t *testing.T) {
	type want struct {
		tools     []string // activity lines, in order (labels)
		failed    []string // of those, the ones that end failed
		toolCalls []string // tool.call names Go answers
		batches   []int
		gate      []string
		taint     []TaintSource
		reason    string
		final     string // prefix of the reply
		stopped   bool
	}
	cases := map[string]want{
		"plain_reply_deltas":                {reason: "text_response(finish_reason=stop)", final: "abcdefghijklmnopqrstuvwxyz abc"},
		"read_tool_then_reply":              {tools: []string{"Get task"}, toolCalls: []string{"get_task"}, batches: []int{1}, reason: "text_response(finish_reason=stop)", final: "Done after tool: "},
		"propose_then_closing_sentence":     {tools: []string{"Preparing changes"}, toolCalls: []string{"propose_changes"}, batches: []int{1}, reason: "text_response(finish_reason=stop)", final: "I drafted adding Buy milk"},
		"propose_then_tool_call_ends_turn":  {tools: []string{"Preparing changes"}, toolCalls: []string{"propose_changes"}, batches: []int{1}, reason: "end_turn", final: "Drafted it."},
		"outside_read_then_direct_proposal": {tools: []string{"Ask bot", "Preparing changes"}, toolCalls: []string{"ask_bot", "propose_changes"}, batches: []int{1, 1}, taint: []TaintSource{{Kind: "timely", Tool: "ask_bot"}}, reason: "text_response(finish_reason=stop)", final: "I drafted the change."},
		// The gate blocked propose_changes next to a read before it started:
		// no line, no tool.call; the read's call carries batch 2.
		"propose_in_a_batch_is_blocked": {tools: []string{"Get context"}, toolCalls: []string{"get_context"}, batches: []int{2}, reason: "text_response(finish_reason=stop)", final: "Let me read first"},
		"stop_mid_stream":               {reason: "interrupted_during_api_call", stopped: true},
		"steer_mid_run":                 {tools: []string{"Get task"}, toolCalls: []string{"get_task"}, batches: []int{1}, reason: "text_response(finish_reason=stop)", final: "Done after tool: "},
		"blocked_non_timely_tool":       {gate: []string{"session_search"}, reason: "text_response(finish_reason=stop)", final: "Done after tool: {\"error\": \"That isn't available in Timely yet\"}"},
		"unoffered_tool":                {reason: "text_response(finish_reason=stop)", final: "Done after tool: "},
	}
	files, _ := filepath.Glob(filepath.Join(fixtureDir, "*.jsonl"))
	if len(files) != len(cases) {
		t.Fatalf("%d recorded fixtures, %d expected: re-record with make agent-record-fixtures and update this test", len(files), len(cases))
	}
	for name, w := range cases {
		t.Run(name, func(t *testing.T) {
			got := replayLive(t, name)
			// The draft is exactly the chunks, each at the offset before it.
			var b strings.Builder
			for _, d := range got.deltas {
				if d.Offset != utf8.RuneCountInString(b.String()) {
					t.Fatalf("chunk at offset %d, draft had %d characters", d.Offset, utf8.RuneCountInString(b.String()))
				}
				b.WriteString(d.Text)
			}
			activity := got.live.activity()
			if activity.Draft != b.String() || activity.Run != "run-"+name {
				t.Fatalf("draft %q, chunks %q", activity.Draft, b.String())
			}
			if !w.stopped && strings.TrimSpace(activity.Draft) != strings.TrimSpace(got.done.Final) {
				t.Errorf("the streamed draft does not end as the reply:\n%q\n%q", activity.Draft, got.done.Final)
			}
			if !strings.HasPrefix(got.done.Final, w.final) {
				t.Errorf("final %q, want prefix %q", got.done.Final, w.final)
			}
			var labels, failed []string
			for _, line := range activity.Lines {
				if line.Kind != "tool" {
					continue
				}
				labels = append(labels, line.Label)
				if line.State == "running" {
					t.Errorf("line %s still running after the run", line.Label)
				}
				if line.State == "failed" {
					failed = append(failed, line.Label)
				}
			}
			if strings.Join(labels, ",") != strings.Join(w.tools, ",") || strings.Join(failed, ",") != strings.Join(w.failed, ",") {
				t.Errorf("tool lines %v (failed %v), want %v (failed %v)", labels, failed, w.tools, w.failed)
			}
			if strings.Join(got.toolCalls, ",") != strings.Join(w.toolCalls, ",") || len(got.batches) != len(w.batches) {
				t.Errorf("tool calls %v batches %v, want %v %v", got.toolCalls, got.batches, w.toolCalls, w.batches)
			}
			for i := range w.batches {
				if got.batches[i] != w.batches[i] {
					t.Errorf("batch sizes %v, want %v", got.batches, w.batches)
				}
			}
			if strings.Join(got.gateAsks, ",") != strings.Join(w.gate, ",") {
				t.Errorf("gate asks %v, want %v", got.gateAsks, w.gate)
			}
			row := &Conversation{}
			mergeTaint(row, got.taint)
			mergeTaint(row, got.done.Tainted)
			if len(row.TaintedSources) != len(w.taint) || (len(w.taint) > 0 && row.TaintedSources[0] != w.taint[0]) {
				t.Errorf("tainted_sources %v, want %v", row.TaintedSources, w.taint)
			}
			if got.done.Reason != w.reason || got.done.Interrupted != w.stopped {
				t.Errorf("run.done %s interrupted=%v", got.done.Reason, got.done.Interrupted)
			}
			if w.reason == "end_turn" && (got.done.Interrupted || !got.done.Completed) {
				t.Error("an end_turn after a proposal is a finished turn, not a Stop")
			}
		})
	}
}

// Chunks are counted in characters, not bytes, and a chunk the apps missed
// shows as a gap in the offsets.
func TestLiveDeltaOffsetsCountCharacters(t *testing.T) {
	l := newLiveRun("r")
	at := time.Now()
	for _, text := range []string{"Café ", "☕️ ", "done"} {
		var ev workerEvent
		ev.Kind, ev.Payload.Text = "delta", text
		_, d := l.event(ev, at)
		if d == nil {
			t.Fatal("no delta")
		}
	}
	var ev workerEvent
	ev.Kind, ev.Payload.Text = "delta", "!"
	_, d := l.event(ev, at)
	if want := utf8.RuneCountInString("Café ☕️ done"); d.Offset != want {
		t.Fatalf("offset %d, want %d", d.Offset, want)
	}
}

// Reasoning shows as one Thinking line that closes when the reply or a
// tool starts; status notes and a failed tool show too; only the newest
// lines are kept.
func TestLiveActivityLines(t *testing.T) {
	l := newLiveRun("r")
	at := time.Now()
	ev := func(kind string, set func(*workerEvent)) bool {
		var e workerEvent
		e.Kind = kind
		if set != nil {
			set(&e)
		}
		changed, _ := l.event(e, at)
		return changed
	}
	if !ev("reasoning", nil) || ev("reasoning", nil) {
		t.Fatal("reasoning opens one Thinking line")
	}
	ev("tool.started", func(e *workerEvent) { e.Payload.ToolCallID, e.Payload.Tool = "c1", "list_tasks" })
	ev("tool.completed", func(e *workerEvent) {
		e.Payload.ToolCallID, e.Payload.Result = "c1", json.RawMessage(`"{\"error\": \"Unknown tool\"}"`)
	})
	ev("status", func(e *workerEvent) { e.Payload.Message = "Compressing the conversation" })
	lines := l.activity().Lines
	if len(lines) != 3 || lines[0].Label != "Thinking" || lines[0].State != "done" ||
		lines[1].Label != "List tasks" || lines[1].State != "failed" || lines[2].Kind != "status" {
		t.Fatalf("lines %+v", lines)
	}
	for i := 0; i < 100; i++ {
		ev("status", func(e *workerEvent) { e.Payload.Message = "note" })
	}
	if n := len(l.activity().Lines); n != maxActivityLines {
		t.Fatalf("%d lines kept", n)
	}
}

// Hermes' advisory threat scan reaches Go as a tool.output_risk event (the
// worker forwards Hermes' tool_progress_callback, and scans Timely's own
// outside results): Go logs a finding and leaves the activity as it is.
func TestOutputRiskIsLoggedNotShown(t *testing.T) {
	var ev workerEvent
	if err := json.Unmarshal([]byte(`{"kind":"tool.output_risk","payload":{"tool_call_id":"c1","tool":"web_extract","risk":"high","findings":["prompt_injection","exfil_curl"]}}`), &ev); err != nil {
		t.Fatal(err)
	}
	line, ok := outputRisk("run-1", ev)
	if !ok || !strings.Contains(line, "web_extract result c1") || !strings.Contains(line, "prompt_injection, exfil_curl") || !strings.Contains(line, "run-1") {
		t.Fatalf("logged %q (%v)", line, ok)
	}
	if changed, delta := newLiveRun("r").event(ev, time.Now()); changed || delta != nil {
		t.Fatal("a scan finding changed the activity lines")
	}
	ev.Payload.Risk = "low"
	if _, ok := outputRisk("run-1", ev); ok {
		t.Fatal("a low-risk scan was logged")
	}
	ev.Kind, ev.Payload.Risk = "status", "high"
	if _, ok := outputRisk("run-1", ev); ok {
		t.Fatal("another event was logged as a scan finding")
	}
}

// The Timely block keeps the scope line except for the host-allowed
// account (Q-2.1), carries the write schemas, and is
// byte-identical for the same conversation (the provider's cached prefix).
func TestTimelyBlock(t *testing.T) {
	catalog := agent.Catalog{
		"create_task": {Name: "create_task", Description: "Create a task"},
		"get_task":    {Name: "get_task", Description: "Read a task"},
	}
	c := &Conversation{Client: "web", Messages: []Message{message("user", "Add Buy milk")}}
	run := &toolRun{catalog: catalog}
	block := timelyBlock(c, run, false)
	if !strings.HasPrefix(block, instruction) || !strings.Contains(block, scopeLine) {
		t.Error("the block must start with today's whole instruction")
	}
	if !strings.Contains(block, "Write tool schemas:\n") || !strings.Contains(block, `"create_task"`) || strings.Contains(block, `"get_task"`) {
		t.Errorf("write schemas: %s", block[strings.Index(block, "Write tool"):])
	}
	if strings.Contains(block, "skill_view timely") || strings.Contains(block, webSearchOn) {
		t.Error("no pointer to a timely skill that does not ship; no web search line without the web")
	}
	again := timelyBlock(&Conversation{Client: "web", Messages: append(c.Messages, message("assistant", "Done"), message("user", "And eggs"))}, run, false)
	if again != block || blockHash(again) != blockHash(block) {
		t.Error("a later message changed the block")
	}
	host := timelyBlock(c, run, true)
	if strings.Contains(host, scopeLine) || !strings.HasPrefix(host, instructionIntro+instructionRules) {
		t.Error("the host-allowed account's block drops only the scope line")
	}
	run.targets = true
	if !strings.Contains(timelyBlock(c, run, false), targetHint) {
		t.Error("resolve_target's hint joins when it is offered")
	}
}

// The history seed is the conversation before this turn: the person's words
// and the replies, notices as data, pointers and archives left out.
func TestHistorySeed(t *testing.T) {
	similar := message("assistant", "Earlier chat")
	similar.Kind = "similar"
	archive := message("assistant", "Previous changes")
	archive.Kind = "archive"
	messages := []Message{
		message("user", "Add Buy milk"), similar,
		message("assistant", "Added."), notice("Stopped. Completed changes are kept."), archive,
		message("assistant", "Anything else?"),
		message("user", "And eggs"),
	}
	seed := historySeed(messages)
	want := []string{"user:Add Buy milk", "assistant:Added.", "user:System notice (not written by the user): Stopped. Completed changes are kept.", "assistant:Anything else?"}
	if len(seed) != len(want) {
		t.Fatalf("seed %v", seed)
	}
	for i, m := range seed {
		if m["role"]+":"+m["content"] != want[i] {
			t.Errorf("seed[%d] = %v, want %s", i, m, want[i])
		}
	}
	if historySeed([]Message{message("user", "First message")}) != nil {
		t.Error("a first turn has no seed")
	}
}

func TestToolLabelsAndFailures(t *testing.T) {
	if toolLabel("get_task") != "Get task" || toolLabel("propose_changes") != "Preparing changes" || toolLabel(targetTool) != "Finding the item" || toolLabel("clarify") != "Asking you a question" || toolLabel("delegate_task") != "Handing work to sub-tasks" {
		t.Error("labels")
	}
	for raw, failed := range map[string]bool{
		`"{\"error\": \"no\"}"`: true, `{"error": "no"}`: true, `"{\"task\": {}}"`: false, `"plain text"`: false, `null`: false,
	} {
		if toolFailed(json.RawMessage(raw)) != failed {
			t.Errorf("toolFailed(%s) != %v", raw, failed)
		}
	}
}
