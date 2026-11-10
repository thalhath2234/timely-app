package agenthost

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// stubModel is a tiny OpenAI-compatible chat completions server on
// 127.0.0.1 (apps/agent/tests/stub_openai.py in Go): it answers every
// request with "Stub reply: <last user message>", streamed or not. No live
// provider is ever called.
type stubModel struct {
	srv  *httptest.Server
	mu   sync.Mutex
	hits int
}

func newStubModel(t *testing.T) *stubModel {
	t.Helper()
	s := &stubModel{}
	s.srv = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *stubModel) baseURL() string { return s.srv.URL + "/v1" }

func (s *stubModel) requests() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits
}

func (s *stubModel) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && strings.HasSuffix(strings.TrimRight(r.URL.Path, "/"), "/models") {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"stub-model","object":"model","context_length":128000}]}`)
		return
	}
	if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/chat/completions") {
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	s.hits++
	s.mu.Unlock()
	var body struct {
		Stream   bool `json:"stream"`
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	last := ""
	for _, m := range body.Messages {
		if m.Role != "user" {
			continue
		}
		var text string
		if json.Unmarshal(m.Content, &text) != nil {
			var parts []struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(m.Content, &parts)
			var b strings.Builder
			for _, p := range parts {
				b.WriteString(p.Text)
			}
			text = b.String()
		}
		last = text
	}
	reply := "Stub reply: " + last
	usage := map[string]int{"prompt_tokens": 1234, "completion_tokens": 56, "total_tokens": 1290}
	base := map[string]any{"id": "c1", "created": time.Now().Unix(), "model": "stub-model"}
	if !body.Stream {
		out := map[string]any{"object": "chat.completion", "usage": usage, "choices": []any{map[string]any{
			"index": 0, "finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": reply}}}}
		for k, v := range base {
			out[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, _ := w.(http.Flusher)
	event := func(choices []any, extra map[string]any) {
		chunk := map[string]any{"object": "chat.completion.chunk", "choices": choices}
		for k, v := range base {
			chunk[k] = v
		}
		for k, v := range extra {
			chunk[k] = v
		}
		data, _ := json.Marshal(chunk)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
	}
	half := len(reply) / 2
	event([]any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant", "content": reply[:half]}, "finish_reason": nil}}, nil)
	event([]any{map[string]any{"index": 0, "delta": map[string]any{"content": reply[half:]}, "finish_reason": nil}}, nil)
	event([]any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}, nil)
	event([]any{}, map[string]any{"usage": usage})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// TestIntegrationRealWorker runs the real Python worker
// (apps/agent/timely_agent/boot.py) end to end, as plan phase 1 asks: prepare
// -> render-account -> spawn -> hello -> ready (self-test passes) -> run.start
// against a stub model -> events -> run.done -> shutdown, on Linux and
// Windows. It is skipped unless TIMELY_AGENT_TEST_RUNTIME names the runtime,
// in any form TIMELY_AGENT_RUNTIME accepts ("dev" means the dev default:
// apps/agent found above this package). The agent home goes under
// $HOME/.cache/timely-agent-test, never ~/.hermes. The only model is the
// stub on 127.0.0.1.
//
//	make agent-go-integration
//	TIMELY_AGENT_TEST_RUNTIME=dev go test ./internal/agenthost -run TestIntegrationRealWorker -count=1 -v
func TestIntegrationRealWorker(t *testing.T) {
	value := strings.TrimSpace(os.Getenv("TIMELY_AGENT_TEST_RUNTIME"))
	if value == "" {
		t.Skip("set TIMELY_AGENT_TEST_RUNTIME to run the real agent worker")
	}
	if value == "dev" {
		value = ""
	}
	wd, _ := os.Getwd()
	rt, err := ResolveRuntime(value, wd)
	if err != nil {
		t.Fatal(err)
	}
	stub := newStubModel(t)
	log := newTestLog(t)
	exits := make(chan ExitInfo, 4)
	msgs := make(chan Message, 256)
	sup := New(Config{
		Root:          testRoot(t),
		Runtime:       rt,
		RenderAccount: true,
		HelloTimeout:  60 * time.Second, // a cold first import is slower than the 20 s default
		Logf:          log.logf,
		OnExit:        func(e ExitInfo) { exits <- e },
		Handler:       func(_ *Worker, m Message) { msgs <- m },
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	const account = "integration-account"
	w, err := sup.Ensure(ctx, account)
	if err != nil {
		_ = sup.Shutdown(ctx)
		t.Fatalf("Ensure: %v", err)
	}
	ready := w.Ready()
	t.Logf("ready: hermes %s, %d tools, plugins %v", ready.HermesTag, len(ready.Tools), ready.PluginsLoaded)
	if !ready.SelfTest.OK || ready.HermesTag == "" {
		t.Errorf("ready = %+v", ready)
	}
	for _, p := range ready.PluginsLoaded {
		if strings.HasPrefix(p, "platforms/") {
			t.Errorf("messaging platform plugin %s is loaded", p)
		}
	}
	home := w.Home()
	if !strings.HasPrefix(home, sup.Layout().Accounts()+string(filepath.Separator)) {
		t.Errorf("home %s outside the test root", home)
	}

	const run = "run-1"
	err = w.Send(TypeRunStart, map[string]any{
		"run":             run,
		"conversation_id": "conv-1",
		"session_key":     "timely:" + account + ":conv-1",
		"user_message":    "hello from Go",
		"model": map[string]any{"provider": "custom", "model": "stub-model", "base_url": stub.baseURL(),
			"api_key": "sk-stub", "api_mode": "chat_completions"},
		"toolsets":        []string{},
		"flags":           map[string]any{},
		"budgets":         map[string]any{"max_iterations": 4},
		"tainted_sources": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if live := w.LiveRuns(); len(live) != 1 || live[0] != run {
		t.Errorf("live runs after run.start = %v", live)
	}
	var deltas strings.Builder
	var done struct {
		Final       string         `json:"final_response"`
		Completed   bool           `json:"completed"`
		Interrupted bool           `json:"interrupted"`
		Error       string         `json:"error"`
		Tokens      map[string]int `json:"tokens"`
	}
wait:
	for {
		select {
		case m := <-msgs:
			if m.Run != run {
				continue
			}
			switch m.Type {
			case "event":
				var ev struct {
					Kind    string `json:"kind"`
					Payload struct {
						Text string `json:"text"`
					} `json:"payload"`
				}
				_ = m.Decode(&ev)
				if ev.Kind == "delta" {
					deltas.WriteString(ev.Payload.Text)
				}
			case TypeRunDone:
				if err := m.Decode(&done); err != nil {
					t.Fatal(err)
				}
				break wait
			case TypeError:
				t.Fatalf("run refused: %s", m.Raw)
			}
		case <-ctx.Done():
			t.Fatalf("no run.done: %v", ctx.Err())
		}
	}
	if done.Final != "Stub reply: hello from Go" || !done.Completed || done.Interrupted || done.Error != "" {
		t.Errorf("run.done = %+v", done)
	}
	if deltas.String() != done.Final {
		t.Errorf("deltas %q, final %q", deltas.String(), done.Final)
	}
	if done.Tokens["input_tokens"] <= 0 || done.Tokens["output_tokens"] <= 0 {
		t.Errorf("tokens = %v", done.Tokens)
	}
	if stub.requests() == 0 {
		t.Error("the stub model was never called")
	}
	if live := w.LiveRuns(); len(live) != 0 {
		t.Errorf("live runs after run.done = %v", live)
	}

	if err := sup.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case exit := <-exits:
		if exit.Crashed || exit.Reason != "shutdown" || exit.ExitCode != 0 {
			t.Errorf("exit %+v", exit)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("no exit after shutdown")
	}
	waitGone(t, w.PID())
}
