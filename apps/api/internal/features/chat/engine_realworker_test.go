package chat

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"timely-api/internal/agenthost"
)

// TestIntegrationAgentEngineRealWorker runs chat turns through the engine
// with the real Python worker (apps/agent) on the stub model
// (apps/agent/tests/stub_openai.py, 127.0.0.1 only, never a live provider):
// it proves the recorded fixtures the other engine tests replay match what
// the worker really does. It is skipped unless TIMELY_AGENT_TEST_RUNTIME names
// the runtime ("dev": apps/agent above this package) and CHAT_TEST_ENV names
// the test database:
//
//	TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration
//
// The agent folder goes under $HOME/.cache/timely-agent-test, never ~/.hermes.
func TestIntegrationAgentEngineRealWorker(t *testing.T) {
	value := strings.TrimSpace(os.Getenv("TIMELY_AGENT_TEST_RUNTIME"))
	if value == "" {
		t.Skip("set TIMELY_AGENT_TEST_RUNTIME to run the real agent worker")
	}
	if value == "dev" {
		value = ""
	}
	wd, _ := os.Getwd()
	rt, err := agenthost.ResolveRuntime(value, wd)
	if err != nil {
		t.Fatal(err)
	}
	stub := startStubModel(t, rt)
	model := func(context.Context, string, string, string, RunModelOptions) (any, error) {
		return map[string]any{"provider": "custom", "model": "stub-model", "base_url": stub, "api_key": "sk-stub", "api_mode": "chat_completions"}, nil
	}
	cfg := agenthost.Config{
		Root:          realWorkerRoot(t),
		Runtime:       rt,
		RenderAccount: true,
		HelloTimeout:  60 * time.Second, // a cold first import is slower than the 20 s default
		Account: func(context.Context, string) (agenthost.AccountSpec, error) {
			return agenthost.AccountSpec{Settings: json.RawMessage(`{"toolsets":["timely","todo","skills"],"learning":{"memory":false,"user_profile":false},"curator":false,"timezone":"UTC"}`)}, nil
		},
	}
	h := newEngineHarnessWith(t, cfg, model)
	if err := h.db.Create(&testItem{ID: "tsk_real", Value: "Water the plants"}).Error; err != nil {
		t.Fatal(err)
	}
	deltas, cancel := h.hub.Subscribe("user-a", WatchKey)
	t.Cleanup(cancel)

	// 1. Streamed reply: the deltas the worker coalesced reach the watch
	// stream and rebuild the stored reply.
	c := h.chat("STREAM 300 3 2", "supervised", "", nil)
	c = h.waitLong(c.ID, "replied", statusIs("idle"))
	reply := lastMessage(c).Content
	var draft []rune
	for len(draft) < len([]rune(reply)) {
		select {
		case ev := <-deltas:
			if ev.Type != "delta" || ev.ID != c.ID {
				continue
			}
			d := ev.Document.(*liveDelta)
			if d.Offset != len(draft) {
				t.Fatalf("chunk at offset %d, draft %d", d.Offset, len(draft))
			}
			draft = append(draft, []rune(d.Text)...)
		case <-time.After(5 * time.Second):
			t.Fatalf("streamed %d of %d characters", len(draft), len([]rune(reply)))
		}
	}
	if len(reply) != 300 || strings.TrimSpace(string(draft)) != reply {
		t.Fatalf("reply %q, streamed %q", reply, string(draft))
	}

	// 2. A Timely read, then a proposal alone, then the closing sentence:
	// Supervised holds it, Approve applies it.
	script := `SCRIPT [{"calls": [["get_task", {"taskId": "tsk_real"}]]}, {"calls": [["propose_changes", ` +
		string(raw(buyMilk(true))) + `]]}, {"text": "I drafted adding Buy milk.", "stream": [4, 10]}]`
	c = h.chat(script, "supervised", "", nil)
	c = h.waitLong(c.ID, "held the proposal", statusIs("approval"))
	n := len(c.Messages)
	if len(c.Plan) != 1 || c.Plan[0].Tool != "create_task" || !c.Messages[n-2].Proposal || c.Messages[n-1].Content != "I drafted adding Buy milk." {
		t.Fatalf("held proposal: plan %+v messages %+v", c.Plan, c.Messages[max(0, n-3):])
	}
	if items(h.db) != 1 {
		t.Fatal("the proposal wrote data before Approve")
	}
	if code, body := h.post("/chats/"+c.ID+"/approve", fmt.Sprintf(`{"revision":%d}`, c.Revision)); code != 200 {
		t.Fatalf("approve: %d %s", code, body)
	}
	h.waitLong(c.ID, "applied", statusIs("idle"))
	if items(h.db) != 2 {
		t.Fatalf("%d items after Approve", items(h.db))
	}

	// 3. propose_changes next to another call: the worker's gate refuses it
	// before Go sees it, and nothing changes.
	batch := `SCRIPT [{"calls": [["propose_changes", ` + string(raw(buyMilk(true))) + `], ["get_task", {"taskId": "tsk_real"}]]}, {"text": "Let me read first."}]`
	c = h.chat(batch, "auto", "", nil)
	c = h.waitLong(c.ID, "replied", statusIs("idle"))
	if len(c.Plan) != 0 || items(h.db) != 2 || lastMessage(c).Content != "Let me read first." {
		t.Fatalf("batched proposal: plan %+v, %d items, reply %q", c.Plan, items(h.db), lastMessage(c).Content)
	}

	// 4. Stop mid-stream ends the run.
	c = h.chat("STREAM 6000 2 5", "supervised", "", nil)
	h.waitLong(c.ID, "streamed", func(c Conversation) bool { return c.Activity.Draft != "" })
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	deadline := time.Now().Add(20 * time.Second)
	for {
		h.e.mu.Lock()
		live := h.e.chats[c.ID] != nil
		h.e.mu.Unlock()
		if !live {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the worker never ended the stopped run")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if c = h.waitLong(c.ID, "stopped", statusIs("stopped")); c.AgentRunID != "" {
		t.Fatalf("stopped run left %q", c.AgentRunID)
	}

	// 5. Review round 8: a chat deleted while the account has no worker
	// (reaped after its idle minutes, or back on Classic) leaves the home at
	// once through agent-forget, not at the account's next agent run: the
	// desktop folder backup copies state.db raw.
	const word = "zqxjvwombatlentil"
	gone := h.chat("remember "+word+" for me", "supervised", "", nil)
	h.waitLong(gone.ID, "replied", statusIs("idle"))
	home := h.e.sup.Layout().Home("user-a")
	holds := func() bool {
		parts, _ := filepath.Glob(filepath.Join(home, "state.db*"))
		for _, part := range parts {
			if b, err := os.ReadFile(part); err == nil && strings.Contains(strings.ToLower(string(b)), word) {
				return true
			}
		}
		return false
	}
	if !holds() {
		t.Fatal("the probe does not see the chat in state.db")
	}
	stopCtx, stopDone := context.WithTimeout(context.Background(), 30*time.Second)
	defer stopDone()
	if err := h.e.sup.Stop(stopCtx, "user-a", "idle"); err != nil {
		t.Fatal(err)
	}
	if _, up := h.e.sup.Worker("user-a"); up {
		t.Fatal("the worker is still up")
	}
	h.e.Forget("user-a", gone.ID)
	deadline = time.Now().Add(60 * time.Second)
	for {
		var waiting int64
		h.db.Model(&AgentSessionForget{}).Where("user_id = ?", "user-a").Count(&waiting)
		if waiting == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the delete waited for a worker")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if holds() {
		t.Fatal("the deleted chat's words stayed in state.db with no worker running")
	}
	if _, up := h.e.sup.Worker("user-a"); up {
		t.Fatal("agent-forget started a worker")
	}
}

// waitLong is wait with room for a cold worker start; a run that ended
// another way fails at once.
func (h *engineHarness) waitLong(cid, what string, ok func(Conversation) bool) Conversation {
	h.t.Helper()
	deadline := time.Now().Add(2 * time.Minute)
	for {
		var c Conversation
		if err := h.db.First(&c, "id = ?", cid).Error; err != nil {
			h.t.Fatal(err)
		}
		if ok(c) {
			return c
		}
		if (ended(c) && c.Status != "stopped") || time.Now().After(deadline) {
			h.t.Fatalf("chat never %s: %s %q", what, c.Status, c.Error)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// startStubModel runs apps/agent/tests/stub_openai.py on 127.0.0.1 with the
// runtime's own interpreter and returns its base URL.
func startStubModel(t *testing.T, rt agenthost.Runtime) string {
	t.Helper()
	python := rt.Program
	script := ""
	for _, arg := range rt.Args {
		if strings.HasSuffix(arg, "boot.py") {
			script = filepath.Join(filepath.Dir(filepath.Dir(arg)), "tests", "stub_openai.py")
		}
	}
	if script == "" {
		t.Skipf("cannot find stub_openai.py next to runtime %v", rt.Args)
	}
	cmd := exec.Command(python, "-I", script, "0")
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
		t.Fatalf("stub model: %v", err)
	}
	return "http://127.0.0.1:" + strings.TrimSpace(line) + "/v1"
}

// realWorkerRoot is a fresh agent folder under $HOME/.cache/timely-agent-test.
func realWorkerRoot(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, ".cache", "timely-agent-test")
		if os.MkdirAll(dir, 0o700) == nil {
			if made, err := os.MkdirTemp(dir, "chat-engine-"); err == nil {
				t.Cleanup(func() { _ = os.RemoveAll(made) })
				base = made
			}
		}
	}
	return filepath.Join(base, "agent")
}
