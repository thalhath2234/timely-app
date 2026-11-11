package chat

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/agenthost/agenthosttest"
	"timely-api/internal/features/agent"
	"timely-api/internal/realtime"
)

// The agent engine end to end without Python: a real agenthost.Supervisor
// runs the scriptable fake worker (agenthosttest), the chat lanes claim rows
// from an isolated PostgreSQL schema, and each test scripts what the worker
// sends. make test-chat-integration runs them.

// engineCatalog is undoCatalog (tasks as testItem rows) with what the agent
// engine needs on top: names, schemas and authority, so the tools are real
// Read and Write tools, and ask_bot, a read whose result carries third-party
// text.
func engineCatalog(tx *gorm.DB) agent.Catalog {
	c := undoCatalog(tx)
	c["ask_bot"] = agent.Tool{Call: func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]any{"answer": "The price is 42.", "outsideData": "Read from third-party pages.", "bot": map[string]string{"id": "bot_1"}}, nil
	}}
	for name, tool := range c {
		tool.Name, tool.Description = name, name
		tool.Parameters = &jsonschema.Schema{Type: "object"}
		tool.Authority, _ = agent.AuthorityOf(name)
		c[name] = tool
	}
	return c
}

// testModel is run.start's model in these tests: nothing ever calls it.
func testModel(context.Context, string, string, string) (any, error) {
	return map[string]any{"provider": "custom", "model": "stub-model", "base_url": "http://127.0.0.1:9/v1", "api_key": "sk-test", "api_mode": "chat_completions"}, nil
}

// guardedLog logs through the test until it has ended.
type guardedLog struct {
	mu   sync.Mutex
	t    *testing.T
	done bool
}

func newGuardedLog(t *testing.T) *guardedLog {
	l := &guardedLog{t: t}
	t.Cleanup(func() { l.mu.Lock(); l.done = true; l.mu.Unlock() })
	return l
}

func (l *guardedLog) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.done {
		l.t.Logf(format, args...)
	}
}

type engineHarness struct {
	t   *testing.T
	db  *gorm.DB
	s   *Service
	e   *WorkerEngine
	kit *agenthosttest.Kit
	hub *realtime.Hub
}

// newEngineHarness starts two chat lanes and the agent engine on the fake
// worker. Fixtures are routed per conversation (fixture).
func newEngineHarness(t *testing.T) *engineHarness {
	t.Helper()
	kit := agenthosttest.New(t)
	h := newEngineHarnessWith(t, kit.Config(), testModel)
	h.kit = kit
	return h
}

// newEngineHarnessWith runs the engine on the supervisor cfg describes (the
// fake worker, or the real one in engine_realworker_test.go).
func newEngineHarnessWith(t *testing.T, cfg agenthost.Config, model func(context.Context, string, string, string) (any, error)) *engineHarness {
	t.Helper()
	db := integrationDB(t)
	s := New(db, engineCatalog, nil)
	hub := realtime.NewHub()
	s.SetLive(hub)
	logs := newGuardedLog(t)
	e := NewWorkerEngine(s, WorkerEngineOptions{Model: model, Logf: logs.logf})
	if cfg.Logf == nil {
		cfg.Logf = logs.logf
	}
	cfg.Handler, cfg.OnExit = e.Handle, e.WorkerExited
	cfg.TimelyTools = func(context.Context) (string, json.RawMessage, error) {
		version, specs := AgentToolSpecs(engineCatalog(db))
		raw, err := json.Marshal(specs)
		return version, raw, err
	}
	sup := agenthost.New(cfg)
	e.Attach(sup)
	s.SetAgentEngine(e)
	ctx, cancel := context.WithCancel(context.Background())
	var lanes sync.WaitGroup
	for i := 0; i < 2; i++ {
		lanes.Add(1)
		go func() { defer lanes.Done(); s.work(ctx) }()
	}
	t.Cleanup(func() {
		cancel()
		lanes.Wait()
		stop, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		_ = e.Shutdown(stop)
		hub.Close()
	})
	return &engineHarness{t: t, db: db, s: s, e: e, hub: hub}
}

// lines is a JSONL fixture of objects.
func lines(objs ...any) []byte {
	var b strings.Builder
	for _, o := range objs {
		b.Write(raw(o))
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

type obj = map[string]any

func toolStarted(callID, tool string) obj {
	return obj{"type": "event", "kind": "tool.started", "payload": obj{"tool_call_id": callID, "tool": tool, "args": obj{}}}
}

func toolCompleted(callID, tool string) obj {
	return obj{"type": "event", "kind": "tool.completed", "payload": obj{"tool_call_id": callID, "tool": tool, "result": "{{last_result}}"}}
}

func toolCallLine(callID, tool string, args any, batch int, tainted ...TaintSource) obj {
	if tainted == nil {
		tainted = []TaintSource{}
	}
	return obj{"type": "tool.call", "tool_call_id": callID, "name": tool, "args": args, "batch_size": batch, "sibling_tools": []string{}, "tainted_sources": tainted}
}

func reply(text string, chunk int) obj { return obj{"fake": "reply", "text": text, "chunk": chunk} }

func pause(ms int) obj { return obj{"fake": "sleep", "ms": ms} }

// buyMilk is a propose_changes that creates one task, direct as asked.
func buyMilk(direct bool) obj {
	return obj{"summary": "Create Buy milk", "direct": direct, "language": "en", "reply": "", "remaining": "",
		"steps": []obj{{"tool": "create_task", "summary": "Create Buy milk", "arguments": obj{"name": "Buy milk"}}}}
}

// chat queues a chat on the agent engine whose run.start replays fixture.
func (h *engineHarness) chat(text, permission, fixture string, jsonl []byte) Conversation {
	h.t.Helper()
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Agent", Status: "queued", Phase: "plan", Engine: engineAgent,
		Permission: permission, Provider: "openrouter", Model: "stub-model", Client: "web", Context: []ContextChip{},
		Messages: []Message{message("user", text)}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if h.kit != nil {
		if jsonl != nil {
			h.kit.Fixture(fixture, jsonl)
		}
		h.kit.ForConversation(c.ID, fixture)
	}
	if err := h.db.Create(&c).Error; err != nil {
		h.t.Fatal(err)
	}
	return c
}

// wait polls the chat until ok, and fails the test after 20 s.
func (h *engineHarness) wait(cid, what string, ok func(Conversation) bool) Conversation {
	h.t.Helper()
	var c Conversation
	deadline := time.Now().Add(20 * time.Second)
	for {
		if err := h.db.First(&c, "id = ?", cid).Error; err != nil {
			h.t.Fatal(err)
		}
		if ok(c) {
			return c
		}
		if time.Now().After(deadline) {
			h.t.Fatalf("chat never %s: status %s error %q activity %+v", what, c.Status, c.Error, c.Activity)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func statusIs(status string) func(Conversation) bool {
	return func(c Conversation) bool { return c.Status == status }
}

func ended(c Conversation) bool { return c.Status != "queued" && c.Status != "running" }

func lastMessage(c Conversation) Message { return c.Messages[len(c.Messages)-1] }

// toolResults are the tool.result lines Go sent the fake.
func (h *engineHarness) toolResults() []struct {
	Result  json.RawMessage `json:"result"`
	Outside bool            `json:"outside"`
	EndTurn bool            `json:"end_turn"`
} {
	var out []struct {
		Result  json.RawMessage `json:"result"`
		Outside bool            `json:"outside"`
		EndTurn bool            `json:"end_turn"`
	}
	for _, r := range h.kit.ReceivedOf("tool.result") {
		var body struct {
			Result  json.RawMessage `json:"result"`
			Outside bool            `json:"outside"`
			EndTurn bool            `json:"end_turn"`
		}
		_ = r.Decode(&body)
		out = append(out, body)
	}
	return out
}

func (h *engineHarness) post(path, body string) (int, []byte) {
	h.t.Helper()
	return serve(h.t, h.s, "POST", path, body)
}

// A plain reply streams to a /chats/watch subscriber as delta events at
// the offsets the apps' applyDelta expects, then lands as the chat's reply;
// run.start carries the phase 2 run settings.
func TestIntegrationAgentEngineStreamsAReply(t *testing.T) {
	h := newEngineHarness(t)
	router := echo.New()
	g := router.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", "user-a"); return next(c) }
	})
	h.s.Routes(g)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/chats/watch", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	events := make(chan realtime.Event, 256)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if data, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
				var ev realtime.Event
				if json.Unmarshal([]byte(data), &ev) == nil {
					events <- ev
				}
			}
		}
	}()
	if ev := <-events; ev.Type != "hello" {
		t.Fatalf("first event %+v", ev)
	}

	// Chunks paced as the worker coalesces them (one per 50 ms at most): the
	// Hub skips a subscriber that falls 8 events behind, and the apps refetch
	// on a gap.
	const text = "Hello from the new engine — streamed in small pieces, ☕ included."
	paced := []any{}
	for chunk := []rune(text); len(chunk) > 0; {
		n := min(6, len(chunk))
		paced = append(paced, obj{"type": "event", "kind": "delta", "payload": obj{"text": string(chunk[:n])}}, pause(55))
		chunk = chunk[n:]
	}
	c := h.chat("Say hello", "supervised", "hello", lines(paced...))
	var draft []rune
	run := ""
	deadline := time.After(20 * time.Second)
	for string(draft) != text {
		select {
		case ev := <-events:
			if ev.Type != "delta" {
				continue
			}
			var d liveDelta
			body, _ := json.Marshal(ev.Document)
			if err := json.Unmarshal(body, &d); err != nil || ev.ID != c.ID || ev.Kind != "chat" {
				t.Fatalf("delta event %+v", ev)
			}
			if run == "" {
				run = d.Run
			}
			if d.Run != run || d.Offset != len(draft) {
				t.Fatalf("chunk at offset %d of run %s, draft has %d characters of run %s", d.Offset, d.Run, len(draft), run)
			}
			draft = append(draft, []rune(d.Text)...)
		case <-deadline:
			t.Fatalf("streamed %q, want %q", string(draft), text)
		}
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if m := lastMessage(c); m.Role != "assistant" || m.Content != text {
		t.Fatalf("reply %+v", m)
	}
	if c.RunEngine != engineAgent || c.AgentRunID != "" || c.AgentInstance != "" || c.Activity.Run != "" || c.RunReads.Run != "" {
		t.Fatalf("the run's live state stayed: %+v", c)
	}
	starts := h.kit.ReceivedOf("run.start")
	if len(starts) != 1 {
		t.Fatalf("%d run.starts", len(starts))
	}
	var start struct {
		Run         string          `json:"run"`
		SessionKey  string          `json:"session_key"`
		UserMessage string          `json:"user_message"`
		SystemText  string          `json:"system_text"`
		SystemHash  string          `json:"system_hash"`
		Permission  string          `json:"permission"`
		Toolsets    []string        `json:"toolsets"`
		Flags       map[string]bool `json:"flags"`
		Budgets     map[string]any  `json:"budgets"`
		Tainted     []TaintSource   `json:"tainted_sources"`
		History     json.RawMessage `json:"history"`
		Model       json.RawMessage `json:"model"`
	}
	if err := starts[0].Decode(&start); err != nil {
		t.Fatal(err)
	}
	if start.Run != run || start.SessionKey != "timely:user-a:"+c.ID || !strings.HasPrefix(start.UserMessage, "Say hello\n\nSystem notice") {
		t.Errorf("run.start run %s key %s message %q", start.Run, start.SessionKey, start.UserMessage)
	}
	if start.SystemHash != blockHash(start.SystemText) || !strings.HasPrefix(start.SystemText, instruction) {
		t.Error("system_text is the Timely block with its hash")
	}
	if strings.Join(start.Toolsets, ",") != "timely,todo,skills" || start.Permission != "supervised" || len(start.Budgets) != 0 {
		t.Errorf("toolsets %v permission %s budgets %v", start.Toolsets, start.Permission, start.Budgets)
	}
	if start.Flags["learning_writes"] || start.Flags["web"] || start.Flags["sensitive"] || start.Flags["from_bot"] || start.Flags["answer_only"] {
		t.Errorf("flags %v", start.Flags)
	}
	if start.History != nil || start.Tainted == nil || len(start.Tainted) != 0 {
		t.Errorf("a first, untainted turn: history %s, tainted_sources %v", start.History, start.Tainted)
	}
	if !strings.Contains(string(start.Model), `"api_key":"sk-test"`) {
		t.Error("run.start without the run's model")
	}
}

// A Timely read goes worker -> tool.call -> toolCall -> tool.result and back
// into the reply; meanwhile the row shows the run's activity and draft.
func TestIntegrationAgentEngineReadToolRoundTrip(t *testing.T) {
	h := newEngineHarness(t)
	if err := h.db.Create(&testItem{ID: "tsk_read", Value: "Water the plants"}).Error; err != nil {
		t.Fatal(err)
	}
	c := h.chat("What is tsk_read?", "supervised", "read", lines(
		toolStarted("call_1", "get_task"),
		toolCallLine("call_1", "get_task", obj{"taskId": "tsk_read"}, 1),
		toolCompleted("call_1", "get_task"),
		reply("Looking", 0),
		pause(2500),
		reply(" done: {{last_result}}", 0),
	))
	mid := h.wait(c.ID, "showed its activity", func(c Conversation) bool {
		return c.Activity.Draft == "Looking" && len(c.Activity.Lines) == 1
	})
	if line := mid.Activity.Lines[0]; line.ID != "call_1" || line.Label != "Get task" || line.State != "done" || line.Kind != "tool" {
		t.Errorf("activity line %+v", line)
	}
	if mid.Activity.Run == "" || mid.Activity.Run != mid.AgentRunID || mid.RunReads.Run != mid.AgentRunID || len(mid.RunReads.Reads) == 0 {
		t.Errorf("the live run's state: activity run %q, agent run %q, run_reads %+v", mid.Activity.Run, mid.AgentRunID, mid.RunReads)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if got := lastMessage(c).Content; !strings.Contains(got, "Water the plants") || !strings.HasPrefix(got, "Looking done") {
		t.Fatalf("reply %q", got)
	}
	results := h.toolResults()
	if len(results) != 1 || results[0].Outside || results[0].EndTurn || !strings.Contains(string(results[0].Result), "Water the plants") {
		t.Fatalf("tool.result %+v", results)
	}
}

// proposalFixture records one Buy milk proposal and a closing sentence.
func proposalFixture(direct bool, before ...obj) []byte {
	objs := []any{}
	for _, o := range before {
		objs = append(objs, o)
	}
	objs = append(objs,
		toolStarted("call_p", "propose_changes"),
		toolCallLine("call_p", "propose_changes", buyMilk(direct), 1),
		toolCompleted("call_p", "propose_changes"),
		reply("I drafted adding Buy milk.", 0),
	)
	return lines(objs...)
}

// Supervised: the recorded proposal ends the turn (end_turn) and waits for
// Approve with the closing sentence after it; Approve applies it.
func TestIntegrationAgentEngineSupervisedProposalWaitsForApprove(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Add Buy milk", "supervised", "propose", proposalFixture(true))
	c = h.wait(c.ID, "held the proposal", statusIs("approval"))
	if results := h.toolResults(); len(results) != 1 || !results[0].EndTurn || !strings.Contains(string(results[0].Result), proposalRecorded) {
		t.Fatalf("tool.result %+v", results)
	}
	n := len(c.Messages)
	if c.Phase != "apply" || len(c.Plan) != 1 || c.Plan[0].Tool != "create_task" || !c.Messages[n-2].Proposal || c.Messages[n-2].AutoApplied ||
		c.Messages[n-1].Content != "I drafted adding Buy milk." {
		t.Fatalf("held proposal: phase %s plan %+v messages %+v", c.Phase, c.Plan, c.Messages)
	}
	if items(h.db) != 0 {
		t.Fatal("a held proposal wrote data")
	}
	if code, body := h.post("/chats/"+c.ID+"/approve", fmt.Sprintf(`{"revision":%d}`, c.Revision)); code != 200 {
		t.Fatalf("approve: %d %s", code, body)
	}
	h.wait(c.ID, "applied", statusIs("idle"))
	if items(h.db) != 1 {
		t.Fatalf("%d items after Approve", items(h.db))
	}
}

// Auto: the same proposal applies at once, marked autoApplied, and Undo
// reverts it.
func TestIntegrationAgentEngineAutoAppliesAndUndoReverts(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Add Buy milk", "auto", "propose", proposalFixture(false))
	c = h.wait(c.ID, "applied", func(c Conversation) bool { return c.Status == "idle" && c.Phase == "apply" })
	proposal := latestProposal(c.Messages)
	if items(h.db) != 1 || proposal == nil || !proposal.AutoApplied || c.Plan[0].Status != "done" {
		t.Fatalf("Auto did not apply at once: %d items, %+v", items(h.db), proposal)
	}
	code, body := h.post("/chats/"+c.ID+"/undo", fmt.Sprintf(`{"revision":%d,"messageId":%q}`, c.Revision, proposal.ID))
	if code != 200 {
		t.Fatalf("undo: %d %s", code, body)
	}
	c = h.wait(c.ID, "undone", func(c Conversation) bool {
		return c.Status == "idle" && len(c.Plan) == 1 && c.Plan[0].Undo && c.Plan[0].Status == "done"
	})
	if items(h.db) != 0 || latestProposal(c.Messages).UndoneAt == nil {
		t.Fatalf("Undo left %d items", items(h.db))
	}
}

// An outside Timely read (ask_bot) before a direct=true proposal: even in
// Auto the proposal waits for Approve, the chat keeps the source in
// tainted_sources, and Approve then applies it.
func TestIntegrationAgentEngineOutsideReadHoldsADirectProposal(t *testing.T) {
	h := newEngineHarness(t)
	askBot := TaintSource{Kind: "timely", Tool: "ask_bot"}
	c := h.chat("What does the price bot say? Then add Buy milk", "auto", "outside", lines(
		toolStarted("call_1", "ask_bot"),
		toolCallLine("call_1", "ask_bot", obj{"bot": "bot_1", "question": "What is the price?"}, 1),
		obj{"type": "taint", "sources": []TaintSource{askBot}},
		toolCompleted("call_1", "ask_bot"),
		toolCallLine("call_p", "propose_changes", buyMilk(true), 1, askBot),
		reply("I drafted the change.", 0),
	))
	c = h.wait(c.ID, "held the proposal", statusIs("approval"))
	if len(c.TaintedSources) != 1 || c.TaintedSources[0] != askBot {
		t.Fatalf("tainted_sources %+v", c.TaintedSources)
	}
	if results := h.toolResults(); len(results) != 2 || !results[0].Outside || !results[1].EndTurn {
		t.Fatalf("tool.results %+v", results)
	}
	if items(h.db) != 0 {
		t.Fatal("the tainted proposal applied")
	}
	if code, body := h.post("/chats/"+c.ID+"/approve", fmt.Sprintf(`{"revision":%d}`, c.Revision)); code != 200 {
		t.Fatalf("approve: %d %s", code, body)
	}
	h.wait(c.ID, "applied", statusIs("idle"))
	if items(h.db) != 1 {
		t.Fatalf("%d items after Approve", items(h.db))
	}
}

// Stop while the run is live, after it recorded a proposal (in Auto, which
// would apply it): the run ends, the worker is told, and no step applies.
func TestIntegrationAgentEngineStopMidRunAppliesNothing(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Add Buy milk", "auto", "stop", lines(
		toolCallLine("call_p", "propose_changes", buyMilk(true), 1),
		reply("Drafting", 0),
		obj{"fake": "hang"},
	))
	h.kit.WaitReceived("tool.result", 1, 20*time.Second)
	c = h.wait(c.ID, "streamed", func(c Conversation) bool { return c.Activity.Draft == "Drafting" })
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	stops := h.kit.WaitReceived("run.stop", 1, 10*time.Second)
	if stops[0].Run != c.AgentRunID {
		t.Errorf("run.stop for %s, live run %s", stops[0].Run, c.AgentRunID)
	}
	time.Sleep(1500 * time.Millisecond) // lanes keep claiming meanwhile
	c = h.wait(c.ID, "stopped", statusIs("stopped"))
	notices := 0
	for _, m := range c.Messages {
		if m.Content == tr("", txtStopped) {
			notices++
		}
	}
	if len(c.Plan) != 0 || items(h.db) != 0 || notices != 1 || c.AgentRunID != "" {
		t.Fatalf("after Stop: plan %+v, %d items, %d stopped notices, run %q", c.Plan, items(h.db), notices, c.AgentRunID)
	}
	// What it streamed before Stop stays as the reply, ahead of the notice.
	if n := len(c.Messages); n < 2 || c.Messages[n-2].Content != "Drafting" || c.Messages[n-2].Kind != "" {
		t.Fatalf("streamed text not kept on Stop: %+v", c.Messages)
	}
}

// Stop before the throttled activity checkpoint writes a fresh outside
// read: the chat still keeps the taint, because the worker's session holds
// the outside text and the next proposal must be held.
func TestIntegrationAgentEngineStopKeepsUnflushedTaint(t *testing.T) {
	h := newEngineHarness(t)
	h.e.opts.ActivityEvery = time.Minute // the read's taint is never flushed by the throttle
	askBot := TaintSource{Kind: "timely", Tool: "ask_bot"}
	c := h.chat("What does the price bot say?", "auto", "stop-taint", lines(
		reply("Reading", 0),
		toolStarted("call_1", "ask_bot"),
		toolCallLine("call_1", "ask_bot", obj{"bot": "bot_1", "question": "What is the price?"}, 1),
		obj{"type": "taint", "sources": []TaintSource{askBot}},
		obj{"fake": "hang"},
	))
	h.kit.WaitReceived("tool.result", 1, 20*time.Second)
	c = h.wait(c.ID, "streamed", func(c Conversation) bool { return c.Activity.Draft == "Reading" })
	time.Sleep(200 * time.Millisecond) // the taint line reaches the follower
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	h.kit.WaitReceived("run.stop", 1, 10*time.Second)
	c = h.wait(c.ID, "kept the taint", func(c Conversation) bool { return len(c.TaintedSources) > 0 })
	if c.Status != "stopped" || len(c.TaintedSources) != 1 || c.TaintedSources[0] != askBot {
		t.Fatalf("after Stop: status %s, tainted_sources %+v", c.Status, c.TaintedSources)
	}
}

// A message typed while the run is live reaches the worker as run.steer.
func TestIntegrationAgentEngineSteerReachesTheWorker(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Plan my week", "supervised", "steer", lines(reply("Working", 0), pause(2500), reply(" on it", 0)))
	c = h.wait(c.ID, "started", func(c Conversation) bool { return c.Activity.Draft == "Working" })
	if code, body := h.post("/chats/"+c.ID+"/steer", `{"text":"also add eggs"}`); code != 200 {
		t.Fatalf("steer: %d %s", code, body)
	}
	steers := h.kit.WaitReceived("run.steer", 1, 10*time.Second)
	var body struct {
		Text string `json:"text"`
	}
	_ = steers[0].Decode(&body)
	if body.Text != "also add eggs" || steers[0].Run != c.AgentRunID {
		t.Fatalf("run.steer %s", steers[0].Raw)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	steered := false
	for _, m := range c.Messages {
		steered = steered || (m.Kind == "steer" && m.Content == "also add eggs")
	}
	if !steered || lastMessage(c).Content != "Working on it" {
		t.Fatalf("messages %+v", c.Messages)
	}
	if code, _ := h.post("/chats/"+c.ID+"/steer", `{"text":"too late"}`); code != 409 {
		t.Fatalf("steer after the run: %d", code)
	}
}

// A worker that dies mid-run fails the run with Try again.
func TestIntegrationAgentEngineWorkerCrashOffersTryAgain(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Plan my week", "supervised", "crash", lines(reply("Partial", 0), pause(300), obj{"fake": "crash", "code": 7}))
	c = h.wait(c.ID, "failed", statusIs("failed"))
	if c.Error != tr("", txtAgentLost) || c.ErrorAction != ActionRetry || c.AgentRunID != "" || c.Activity.Run != "" {
		t.Fatalf("after the crash: %q %q run %q", c.Error, c.ErrorAction, c.AgentRunID)
	}
}

// A burst of 200 worker events writes the activity at most once a second.
func TestIntegrationAgentEngineActivityThrottle(t *testing.T) {
	h := newEngineHarness(t)
	burst := []any{}
	for i := 0; len(burst) < 200; i++ {
		callID := fmt.Sprintf("call_%d", i)
		burst = append(burst, toolStarted(callID, "list_tasks"), toolCompleted(callID, "list_tasks"),
			obj{"type": "event", "kind": "delta", "payload": obj{"text": "x"}})
	}
	burst = append(burst[:200], pause(2500), reply("Done", 0))
	before := h.e.activityWrites.Load()
	start := time.Now()
	c := h.chat("Summarise", "supervised", "burst", lines(burst...))
	c = h.wait(c.ID, "replied", statusIs("idle"))
	elapsed := time.Since(start)
	writes := h.e.activityWrites.Load() - before
	if writes < 1 || writes > int64(elapsed/time.Second)+1 {
		t.Fatalf("%d activity checkpoints in %s", writes, elapsed)
	}
	if !strings.HasSuffix(lastMessage(c).Content, "Done") {
		t.Fatalf("reply %q", lastMessage(c).Content)
	}
}

// Timely data changes only through a proposal: a reply-only run and a run
// whose write attempts are refused (a write tool called directly, a
// proposal next to another call) leave every row as it was.
func TestIntegrationAgentEngineNoDataWithoutAProposal(t *testing.T) {
	h := newEngineHarness(t)
	if err := h.db.Create(&testItem{ID: "tsk_keep", Value: "Keep me"}).Error; err != nil {
		t.Fatal(err)
	}
	quiet := h.chat("Hello", "auto", "quiet", lines(reply("Hi there.", 0)))
	h.wait(quiet.ID, "replied", statusIs("idle"))
	refused := h.chat("Add Sneaky", "auto", "refused", lines(
		toolCallLine("call_1", "create_task", obj{"name": "Sneaky"}, 1),
		toolCallLine("call_2", "propose_changes", buyMilk(true), 2),
		reply("I could not change anything.", 0),
	))
	c := h.wait(refused.ID, "replied", statusIs("idle"))
	if items(h.db) != 1 || len(c.Plan) != 0 || c.Phase != "plan" {
		t.Fatalf("%d items, plan %+v", items(h.db), c.Plan)
	}
	results := h.toolResults()
	if len(results) != 2 || !strings.Contains(string(results[0].Result), "never called directly") ||
		!strings.Contains(string(results[1].Result), proposeAlone) || results[1].EndTurn {
		t.Fatalf("refusals %+v", results)
	}
}

// Every recorded worker fixture (the real worker on the stub model) replayed
// through the whole engine ends in the row it should.
func TestIntegrationAgentEngineRecordedFixtures(t *testing.T) {
	h := newEngineHarness(t)
	type want struct {
		status string
		reply  string // prefix of the last message
		held   bool   // a proposal waits for Approve
		taint  bool
	}
	cases := map[string]want{
		"plain_reply_deltas":                {status: "idle", reply: "abcdefghijklmnopqrstuvwxyz"},
		"read_tool_then_reply":              {status: "idle", reply: "Done after tool: "},
		"propose_then_closing_sentence":     {status: "approval", reply: "I drafted adding Buy milk for you to approve.", held: true},
		"propose_then_tool_call_ends_turn":  {status: "approval", reply: "Drafted it.", held: true},
		"outside_read_then_direct_proposal": {status: "approval", reply: "I drafted the change.", held: true, taint: true},
		"propose_in_a_batch_is_blocked":     {status: "idle", reply: "Let me read first and propose after."},
		"stop_mid_stream":                   {status: "stopped", reply: tr("", txtStopped)},
		"steer_mid_run":                     {status: "idle", reply: "Done after tool: "},
		"blocked_non_timely_tool":           {status: "idle", reply: "Done after tool: {\"error\": \"That isn't available in Timely yet\"}"},
		"unoffered_tool":                    {status: "idle", reply: "Done after tool: Tool 'terminal' does not exist"},
	}
	for name, w := range cases {
		h.kit.FixtureFile(name, filepath.Join(fixtureDir, name+".jsonl"))
		c := h.chat("Recorded "+name, "supervised", name, nil)
		c = h.wait(c.ID, "ended", ended)
		if c.Status != w.status || !strings.HasPrefix(lastMessage(c).Content, w.reply) {
			t.Errorf("%s: %s, last message %q (error %q)", name, c.Status, lastMessage(c).Content, c.Error)
			continue
		}
		if w.held != (len(c.Plan) == 1 && c.Plan[0].Tool == "create_task") {
			t.Errorf("%s: plan %+v", name, c.Plan)
		}
		if w.taint != (len(c.TaintedSources) == 1 && c.TaintedSources[0] == TaintSource{Kind: "timely", Tool: "ask_bot"}) {
			t.Errorf("%s: tainted_sources %+v", name, c.TaintedSources)
		}
		if c.AgentRunID != "" || c.Activity.Run != "" || c.RunEngine != engineAgent {
			t.Errorf("%s: live state left: run %q activity %+v engine %q", name, c.AgentRunID, c.Activity, c.RunEngine)
		}
	}
	// Go answered the recorded gate.ask with phase 2's block.
	verdicts := h.kit.ReceivedOf("gate.verdict")
	if len(verdicts) != 1 || !strings.Contains(string(verdicts[0].Raw), `"verdict":"block"`) || !strings.Contains(string(verdicts[0].Raw), gateBlocked) {
		t.Fatalf("gate verdicts %v", verdicts)
	}
	if items(h.db) != 0 {
		t.Fatal("a recorded run wrote data")
	}
}

// A claimed agent row whose run no process follows (the API restarted)
// fails with Try again, and its live state is cleared.
func TestIntegrationAgentEngineLostRunOffersTryAgain(t *testing.T) {
	h := newEngineHarness(t)
	past := time.Now().UTC().Add(-time.Minute)
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Agent", Status: "running", Phase: "plan", Engine: engineAgent, RunEngine: engineAgent,
		Permission: "supervised", Lease: "old-lease", LeaseUntil: &past, AgentRunID: "run_gone", AgentInstance: "1:1",
		Activity: ChatActivity{Run: "run_gone", Draft: "Half"}, Context: []ContextChip{}, Messages: []Message{message("user", "Hi")},
		Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if err := h.db.Create(&c).Error; err != nil {
		t.Fatal(err)
	}
	c = h.wait(c.ID, "failed", statusIs("failed"))
	if c.Error != tr("", txtAgentLost) || c.ErrorAction != ActionRetry || c.AgentRunID != "" || c.Activity.Run != "" {
		t.Fatalf("lost run: %q %q run %q activity %+v", c.Error, c.ErrorAction, c.AgentRunID, c.Activity)
	}
}

// Without a runtime the engine is unavailable: a chat set to it fails with
// "Use classic for this chat" and the reason (never a silent switch), and
// Settings says why.
func TestIntegrationAgentEngineUnavailableOffersClassic(t *testing.T) {
	db := integrationDB(t)
	s := New(db, engineCatalog, nil)
	e := NewWorkerEngine(s, WorkerEngineOptions{Model: testModel, Logf: newGuardedLog(t).logf})
	sup := agenthost.New(agenthost.Config{Root: filepath.Join(t.TempDir(), "agent"), Logf: newGuardedLog(t).logf})
	t.Cleanup(func() { _ = sup.Shutdown(context.Background()) })
	e.Attach(sup)
	s.SetAgentEngine(e)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); s.work(ctx) }()
	t.Cleanup(func() { cancel(); <-done })
	h := &engineHarness{t: t, db: db, s: s, e: e}
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Agent", Status: "queued", Phase: "plan", Engine: engineAgent, Permission: "supervised",
		Context: []ContextChip{}, Messages: []Message{message("user", "Hi")}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if err := db.Create(&c).Error; err != nil {
		t.Fatal(err)
	}
	c = h.wait(c.ID, "failed", statusIs("failed"))
	if c.ErrorAction != ActionUseClassic || !strings.Contains(c.Error, "runtime is not installed") {
		t.Fatalf("failure %q %q", c.Error, c.ErrorAction)
	}
	code, body := serve(t, s, "GET", "/agent/chat-settings", "")
	if code != 200 || !strings.Contains(string(body), `"engineAvailable":false`) || !strings.Contains(string(body), "runtime is not installed") {
		t.Fatalf("settings: %d %s", code, body)
	}
}
