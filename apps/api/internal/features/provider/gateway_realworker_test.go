package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/chat"
)

// The gateway end to end (phase 4): the real Python worker (apps/agent)
// calls the loopback gateway as Hermes' custom OpenAI endpoint, the gateway
// runs the Claude Code or Codex Completer, and the CLI is a /bin/sh fake
// (testdata/fakecli, selected with CLAUDE_BIN and CODEX_BIN) that answers
// from a script and records what it was given. The test plays Go for the
// worker's tool.call. No model and no database are involved. Skipped unless
// TIMELY_AGENT_TEST_RUNTIME names the runtime ("dev": apps/agent above this
// package):
//
//	TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration
//
// The agent folder goes under $HOME/.cache/timely-agent-test, never ~/.hermes.

// fakeCLIs points CLAUDE_BIN and CODEX_BIN at the fake CLIs and gives them a
// script folder (FAKECLI_DIR).
type fakeCLIs struct {
	t   *testing.T
	dir string
}

func useFakeCLIs(t *testing.T) *fakeCLIs {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake CLIs are /bin/sh scripts, which Windows cannot run")
	}
	bins, err := filepath.Abs(filepath.Join("testdata", "fakecli"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLAUDE_BIN", filepath.Join(bins, "claude"))
	t.Setenv("CODEX_BIN", filepath.Join(bins, "codex"))
	f := &fakeCLIs{t: t, dir: t.TempDir()}
	t.Setenv("FAKECLI_DIR", f.dir)
	return f
}

// script replaces the rules: rule k answers with replies[k-1] when the
// call's input contains matches[k-1] ("" always matches); the highest
// matching rule wins. Recorded calls are cleared.
func (f *fakeCLIs) script(cli string, rules ...fakeRule) {
	f.t.Helper()
	entries, _ := os.ReadDir(f.dir)
	for _, e := range entries {
		_ = os.RemoveAll(filepath.Join(f.dir, e.Name()))
	}
	rulesDir := filepath.Join(f.dir, "rules")
	if err := os.MkdirAll(rulesDir, 0o700); err != nil {
		f.t.Fatal(err)
	}
	for i, r := range rules {
		k := strconv.Itoa(i + 1)
		if err := os.WriteFile(filepath.Join(rulesDir, k+".match"), []byte(r.match), 0o600); err != nil {
			f.t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(rulesDir, k+".out"), []byte(cliOutput(cli, r.reply)), 0o600); err != nil {
			f.t.Fatal(err)
		}
	}
}

type fakeRule struct {
	match string
	reply cliReply
}

// cliReply is Timely's CLI response protocol (cli.go responseSchema).
type cliReply struct {
	Content   string        `json:"content"`
	ToolCalls []cliToolCall `json:"toolCalls"`
}

type cliToolCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

func cliCall(name string, args any) cliToolCall {
	raw, _ := json.Marshal(args)
	return cliToolCall{Name: name, Arguments: string(raw)}
}

// cliOutput is what the real CLI prints for reply: Claude Code's
// stream-json result event, Codex's --json agent message.
func cliOutput(cli string, reply cliReply) string {
	if reply.ToolCalls == nil {
		reply.ToolCalls = []cliToolCall{}
	}
	obj, _ := json.Marshal(reply)
	text, _ := json.Marshal(string(obj))
	if cli == ClaudeCLI {
		return `{"type":"system","subtype":"init"}` + "\n" +
			`{"type":"result","subtype":"success","is_error":false,"result":` + string(text) + `,"structured_output":` + string(obj) + "}\n"
	}
	return `{"type":"thread.started"}` + "\n" + `{"type":"item.completed","item":{"type":"agent_message","text":` + string(text) + "}}\n"
}

// calls is how many times the fake CLI ran since the last script.
func (f *fakeCLIs) calls() int {
	raw, _ := os.ReadFile(filepath.Join(f.dir, "count"))
	n, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	return n
}

func (f *fakeCLIs) stdin(n int) string {
	raw, _ := os.ReadFile(filepath.Join(f.dir, strconv.Itoa(n)+".stdin"))
	return string(raw)
}

func (f *fakeCLIs) args(n int) []string {
	raw, _ := os.ReadFile(filepath.Join(f.dir, strconv.Itoa(n)+".args"))
	return strings.Split(strings.TrimSuffix(string(raw), "\x00"), "\x00")
}

// seenRequest is one chat completions request the gateway received.
type seenRequest struct {
	stream, sensitive bool
}

// gatewayRig is the gateway, a Service that issues its grants with the
// CLIs connected, and the real worker.
type gatewayRig struct {
	t    *testing.T
	s    *Service
	g    *Gateway
	w    *agenthost.Worker
	msgs chan agenthost.Message

	mu   sync.Mutex
	seen []seenRequest
	runs int
}

// gatewayRigTools are the Timely tools the worker registers: two reads and
// propose_changes, enough for every case.
var gatewayRigTools = `[
 {"name":"list_tasks","description":"List the person's tasks.","parameters":{"type":"object","properties":{"status":{"type":"string"}}},"outside":false},
 {"name":"get_task","description":"Read one task.","parameters":{"type":"object","properties":{"taskId":{"type":"string"}},"required":["taskId"]},"outside":false},
 {"name":"propose_changes","description":"Propose changes for the person to approve.","parameters":{"type":"object","properties":{"summary":{"type":"string"},"steps":{"type":"array","items":{"type":"object"}}},"required":["summary","steps"]},"outside":false}
]`

const rigAccount = "gateway-account"

func newGatewayRig(t *testing.T) *gatewayRig {
	t.Helper()
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
	r := &gatewayRig{t: t, msgs: make(chan agenthost.Message, 512)}
	s := agentTestService(t)
	s.claude = &Tool{Name: "claude", EnvVar: "CLAUDE_BIN"}
	s.codex = &Tool{Name: "codex", EnvVar: "CODEX_BIN"}
	s.localCLI = true
	connected := time.Now()
	// Service.Completer without the database: the account has both CLIs
	// connected, and build makes the same checks and Completers.
	completer := func(_ context.Context, uid, provider, model string) (chat.Completer, error) {
		return s.build(Settings{UserID: uid, ClaudeConnectedAt: &connected, CodexConnectedAt: &connected}, provider, model)
	}
	g, err := newGateway(completer, r.watch)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close(context.Background()) })
	s.gateway = g
	r.s, r.g = s, g

	// The worker may log after the test ends; those lines are dropped.
	var logMu sync.Mutex
	logOpen := true
	t.Cleanup(func() { logMu.Lock(); logOpen = false; logMu.Unlock() })
	logf := func(format string, args ...any) {
		logMu.Lock()
		defer logMu.Unlock()
		if logOpen {
			t.Logf(format, args...)
		}
	}
	sup := agenthost.New(agenthost.Config{
		Root:          gatewayRigRoot(t),
		Runtime:       rt,
		RenderAccount: true,
		HelloTimeout:  60 * time.Second, // a cold first import is slower than the 20 s default
		TimelyTools: func(context.Context) (string, json.RawMessage, error) {
			return "gateway-rig-1", json.RawMessage(gatewayRigTools), nil
		},
		Account: func(context.Context, string) (agenthost.AccountSpec, error) {
			return agenthost.AccountSpec{Settings: json.RawMessage(`{"toolsets":["timely","todo","skills"],"learning":{"memory":false,"user_profile":false},"curator":false,"timezone":"UTC"}`)}, nil
		},
		Logf:    logf,
		Handler: func(_ *agenthost.Worker, m agenthost.Message) { r.msgs <- m },
	})
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = sup.Shutdown(ctx)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	w, err := sup.Ensure(ctx, rigAccount)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if ready := w.Ready(); !ready.SelfTest.OK {
		t.Fatalf("self-test failed: %+v", ready.SelfTest)
	}
	r.w = w
	return r
}

// gatewayRigRoot is the agent folder, under $HOME/.cache/timely-agent-test
// (removed afterwards), never ~/.hermes.
func gatewayRigRoot(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, ".cache", "timely-agent-test")
		if os.MkdirAll(dir, 0o700) == nil {
			if made, err := os.MkdirTemp(dir, "gateway-"); err == nil {
				t.Cleanup(func() { _ = os.RemoveAll(made) })
				base = made
			}
		}
	}
	return filepath.Join(base, "agent")
}

// watch records each chat completions request: whether it streamed and
// whether its secret is a Sensitive grant.
func (r *gatewayRig) watch(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasSuffix(req.URL.Path, "/chat/completions") {
			body, _ := io.ReadAll(req.Body)
			req.Body = io.NopCloser(bytes.NewReader(body))
			var in struct {
				Stream bool `json:"stream"`
			}
			_ = json.Unmarshal(body, &in)
			who, _ := r.g.caller(req)
			r.mu.Lock()
			r.seen = append(r.seen, seenRequest{stream: in.Stream, sensitive: who.sensitive})
			r.mu.Unlock()
		}
		next.ServeHTTP(w, req)
	})
}

func (r *gatewayRig) requests() []seenRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]seenRequest(nil), r.seen...)
}

// rigCall is one tool.call the worker sent.
type rigCall struct {
	Name     string          `json:"name"`
	Args     json.RawMessage `json:"args"`
	Batch    int             `json:"batch_size"`
	Siblings []string        `json:"sibling_tools"`
}

// rigRun is what one run sent Go.
type rigRun struct {
	calls  []rigCall
	deltas string
	done   struct {
		Final       string `json:"final_response"`
		Completed   bool   `json:"completed"`
		Interrupted bool   `json:"interrupted"`
		ExitReason  string `json:"turn_exit_reason"`
		Error       string `json:"error"`
	}
}

// run sends one run.start on the model AgentModelFor gives provider, answers
// each tool.call with results[name] (end_turn after propose_changes, as Go
// does), and returns at run.done.
func (r *gatewayRig) run(provider, model string, opts AgentRunOptions, message string, results map[string]any) rigRun {
	t := r.t
	t.Helper()
	m, err := r.s.AgentModelFor(context.Background(), rigAccount, provider, model, opts)
	if err != nil {
		t.Fatalf("AgentModelFor: %v", err)
	}
	if m.Provider != "custom" || m.BaseURL != r.g.BaseURL() {
		t.Fatalf("not the gateway: %v", m)
	}
	r.runs++
	run := fmt.Sprintf("run-%d", r.runs)
	conv := fmt.Sprintf("conv-%d", r.runs)
	err = r.w.Send(agenthost.TypeRunStart, map[string]any{
		"run": run, "conversation_id": conv, "session_key": "timely:" + rigAccount + ":" + conv,
		"user_message": message, "model": m, "toolsets": []string{"timely"},
		"flags": map[string]any{"sensitive": opts.Sensitive, "answer_only": false, "web": false, "rich_ui": false,
			"from_bot": false, "learning_writes": false, "search_history": false},
		"budgets": map[string]any{"max_iterations": 8}, "permission": "supervised", "tainted_sources": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	var out rigRun
	deadline := time.After(2 * time.Minute)
	for {
		select {
		case msg := <-r.msgs:
			if msg.Run != run {
				continue
			}
			switch msg.Type {
			case agenthost.TypeToolCall:
				var c rigCall
				if err := msg.Decode(&c); err != nil {
					t.Fatal(err)
				}
				out.calls = append(out.calls, c)
				result, ok := results[c.Name]
				if !ok {
					result = map[string]string{"error": "not in this test"}
				}
				if err := r.w.Reply(msg, agenthost.TypeToolResult, map[string]any{"result": result, "outside": false, "end_turn": c.Name == "propose_changes"}); err != nil {
					t.Fatal(err)
				}
			case agenthost.TypeGateAsk:
				_ = r.w.Reply(msg, agenthost.TypeGateVerdict, map[string]any{"verdict": "block", "message": "not in this test"})
			case "event":
				var ev struct {
					Kind    string `json:"kind"`
					Payload struct {
						Text string `json:"text"`
					} `json:"payload"`
				}
				if msg.Decode(&ev) == nil && ev.Kind == "delta" {
					out.deltas += ev.Payload.Text
				}
			case agenthost.TypeRunDone:
				if err := msg.Decode(&out.done); err != nil {
					t.Fatal(err)
				}
				return out
			case agenthost.TypeError:
				t.Fatalf("run refused: %s", msg.Raw)
			}
		case <-deadline:
			t.Fatalf("no run.done for %s", run)
		}
	}
}

// gatewayRigModels is the model each CLI's chats use.
var gatewayRigModels = map[string]string{ClaudeCLI: "sonnet", CodexCLI: "gpt-5.5"}

func jsonEqual(t *testing.T, got json.RawMessage, want any) bool {
	t.Helper()
	var a, b any
	wantRaw, _ := json.Marshal(want)
	return json.Unmarshal(got, &a) == nil && json.Unmarshal(wantRaw, &b) == nil && reflect.DeepEqual(a, b)
}

// A Timely read the CLI asks for reaches Go as the worker's tool.call with
// the CLI's arguments, and Go's result is in the transcript of the CLI's
// next call, which then answers; a plain answer ends the run with that text,
// through a streamed request (Hermes' default).
func TestIntegrationGatewayRealWorkerReadAndAnswer(t *testing.T) {
	cli := useFakeCLIs(t)
	r := newGatewayRig(t)
	for _, provider := range []string{ClaudeCLI, CodexCLI} {
		t.Run(provider, func(t *testing.T) {
			r.t = t
			// 1. A read, then the answer that needs its result.
			cli.script(provider,
				fakeRule{"", cliReply{ToolCalls: []cliToolCall{cliCall("list_tasks", map[string]string{"status": "open"})}}},
				fakeRule{"WATER-PLANTS-4417", cliReply{Content: "You have one open task: water the plants."}})
			out := r.run(provider, gatewayRigModels[provider], AgentRunOptions{}, "What is open?",
				map[string]any{"list_tasks": map[string]any{"tasks": []any{map[string]string{"id": "tsk_1", "title": "WATER-PLANTS-4417"}}}})
			if len(out.calls) != 1 || out.calls[0].Name != "list_tasks" || out.calls[0].Batch != 1 || !jsonEqual(t, out.calls[0].Args, map[string]string{"status": "open"}) {
				t.Fatalf("tool.calls %+v", out.calls)
			}
			if out.done.Final != "You have one open task: water the plants." || !out.done.Completed || out.done.Error != "" {
				t.Fatalf("run.done %+v", out.done)
			}
			n := cli.calls()
			if n < 2 {
				t.Fatalf("the CLI ran %d times", n)
			}
			if in := cli.stdin(n); !strings.Contains(in, "[tool result") || !strings.Contains(in, "WATER-PLANTS-4417") {
				t.Fatalf("the CLI's last transcript lacks the result:\n%s", in)
			}
			if in := cli.stdin(1); strings.Contains(in, "WATER-PLANTS-4417") {
				t.Fatal("the first call already had the result")
			}

			// 2. A plain answer: streamed, delivered as deltas, and run.done
			// carries it.
			before := len(r.requests())
			cli.script(provider, fakeRule{"", cliReply{Content: "Plain answer FROM-FAKE-CLI."}})
			out = r.run(provider, gatewayRigModels[provider], AgentRunOptions{}, "Say something.", nil)
			if out.done.Final != "Plain answer FROM-FAKE-CLI." || !out.done.Completed || out.done.Interrupted || len(out.calls) != 0 {
				t.Fatalf("run.done %+v calls %+v", out.done, out.calls)
			}
			if strings.TrimSpace(out.deltas) != out.done.Final {
				t.Errorf("deltas %q, final %q", out.deltas, out.done.Final)
			}
			seen := r.requests()[before:]
			if len(seen) == 0 || !seen[0].stream {
				t.Errorf("Hermes' request was not streamed: %+v", seen)
			}
			for _, s := range seen {
				if s.sensitive {
					t.Error("an ordinary run used a Sensitive grant")
				}
			}
		})
	}
}

// Two calls in one CLI reply reach Go with batch_size 2 (each naming the
// other as a sibling), and propose_changes alone reaches Go with batch_size
// 1 and its arguments whole; after end_turn the CLI writes one closing
// sentence.
func TestIntegrationGatewayRealWorkerBatchesAndProposals(t *testing.T) {
	cli := useFakeCLIs(t)
	r := newGatewayRig(t)
	proposal := map[string]any{"summary": "Add Buy milk", "steps": []any{map[string]any{"tool": "create_task", "args": map[string]string{"title": "Buy milk"}}}}
	for _, provider := range []string{ClaudeCLI, CodexCLI} {
		t.Run(provider, func(t *testing.T) {
			r.t = t
			cli.script(provider,
				fakeRule{"", cliReply{ToolCalls: []cliToolCall{cliCall("list_tasks", map[string]string{"status": "open"}), cliCall("get_task", map[string]string{"taskId": "tsk_1"})}}},
				fakeRule{"BATCH-TASK-RESULT", cliReply{Content: "Both reads are done."}})
			out := r.run(provider, gatewayRigModels[provider], AgentRunOptions{}, "Read twice.", map[string]any{
				"list_tasks": map[string]any{"tasks": []any{}},
				"get_task":   map[string]string{"id": "tsk_1", "title": "BATCH-TASK-RESULT"},
			})
			names := []string{}
			for _, c := range out.calls {
				names = append(names, c.Name)
				if c.Batch != 2 || len(c.Siblings) != 1 {
					t.Errorf("%s: batch_size %d, siblings %v", c.Name, c.Batch, c.Siblings)
				}
			}
			sort.Strings(names)
			if !reflect.DeepEqual(names, []string{"get_task", "list_tasks"}) || out.done.Final != "Both reads are done." {
				t.Fatalf("calls %v, run.done %+v", names, out.done)
			}

			cli.script(provider,
				fakeRule{"", cliReply{ToolCalls: []cliToolCall{cliCall("propose_changes", proposal)}}},
				fakeRule{"HELD-FOR-REVIEW-88", cliReply{Content: "I drafted adding Buy milk."}})
			out = r.run(provider, gatewayRigModels[provider], AgentRunOptions{}, "Add Buy milk.",
				map[string]any{"propose_changes": map[string]string{"status": "HELD-FOR-REVIEW-88"}})
			if len(out.calls) != 1 || out.calls[0].Name != "propose_changes" || out.calls[0].Batch != 1 || !jsonEqual(t, out.calls[0].Args, proposal) {
				t.Fatalf("tool.calls %+v", out.calls)
			}
			if out.done.Final != "I drafted adding Buy milk." || out.done.Error != "" {
				t.Fatalf("run.done %+v", out.done)
			}
		})
	}
}

// A Sensitive run's model calls use the gateway's Sensitive grant, and the
// fake CLI is started with exactly the arguments the classic engine gives a
// Sensitive chat's call (no web search; only file paths differ).
func TestIntegrationGatewayRealWorkerSensitive(t *testing.T) {
	cli := useFakeCLIs(t)
	r := newGatewayRig(t)
	for _, provider := range []string{ClaudeCLI, CodexCLI} {
		t.Run(provider, func(t *testing.T) {
			r.t = t
			model := gatewayRigModels[provider]
			cli.script(provider, fakeRule{"", cliReply{Content: "A private answer."}})
			before := len(r.requests())
			out := r.run(provider, model, AgentRunOptions{Sensitive: true}, "Something private.", nil)
			if out.done.Final != "A private answer." || out.done.Error != "" {
				t.Fatalf("run.done %+v", out.done)
			}
			seen := r.requests()[before:]
			if len(seen) == 0 {
				t.Fatal("the gateway saw no request")
			}
			for _, s := range seen {
				if !s.sensitive {
					t.Errorf("a Sensitive run's request used an ordinary grant: %+v", seen)
				}
			}
			viaGateway := normalizeCLIArgs(cli.args(cli.calls()))

			// What classic passes for a Sensitive chat: Sensitive messages,
			// the chat's tools, no web search.
			completer, err := r.s.build(Settings{UserID: rigAccount, ClaudeConnectedAt: &time.Time{}, CodexConnectedAt: &time.Time{}}, provider, model)
			if err != nil {
				t.Fatal(err)
			}
			tools := []any{map[string]any{"type": "function", "function": map[string]any{"name": "list_tasks", "parameters": map[string]any{"type": "object"}}}}
			if _, err := completer.Complete(context.Background(), []chat.WireMessage{
				{Role: "system", Content: "rules", Sensitive: true}, {Role: "user", Content: "Something private.", Sensitive: true},
			}, tools, false); err != nil {
				t.Fatal(err)
			}
			classic := normalizeCLIArgs(cli.args(cli.calls()))
			if !reflect.DeepEqual(viaGateway, classic) {
				t.Fatalf("Sensitive arguments differ:\n gateway %q\n classic %q", viaGateway, classic)
			}
			for _, a := range viaGateway {
				if strings.Contains(a, "WebSearch") || strings.Contains(a, `web_search="live"`) {
					t.Fatalf("a Sensitive call could search the web: %q", viaGateway)
				}
			}
		})
	}
}

// normalizeCLIArgs replaces the per-call file paths (the system prompt file,
// Codex's work folder and schema) so two calls' arguments compare.
func normalizeCLIArgs(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		if filepath.IsAbs(a) {
			a = "<path>"
		}
		out[i] = a
	}
	return out
}
