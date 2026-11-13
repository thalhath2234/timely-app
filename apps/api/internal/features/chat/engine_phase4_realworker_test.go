package chat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/agenthost"
)

// Phase 4 through the real Python worker (apps/agent) on the stub model
// (apps/agent/tests/stub_openai.py, 127.0.0.1 only, never a live provider),
// Go and PostgreSQL: question cards the run waits on (Q-4.3), a sub-task's
// outside read holding the parent's proposal, and a Sensitive chat's
// no-persist run (Q-4.2, the test-only switch). The fake-worker tests in
// engine_question_integration_test.go pin Go's half; these prove the worker
// really sends what they replay. Skipped unless TIMELY_AGENT_TEST_RUNTIME
// names the runtime ("dev": apps/agent above this package) and CHAT_TEST_ENV
// names the test database:
//
//	TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration
//
// Agent folders go under $HOME/.cache/timely-agent-test, never ~/.hermes.

// realRuntime is the runtime TIMELY_AGENT_TEST_RUNTIME names, or a skip.
func realRuntime(t *testing.T) agenthost.Runtime {
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
	return rt
}

// modelCall is one request the worker made to the model endpoint.
type modelCall struct {
	Path string
	Auth string
	Body []byte
}

// modelRecorder sits between the worker and the stub model and keeps every
// request, so a test can read what the model was sent and with which key.
type modelRecorder struct {
	mu    sync.Mutex
	calls []modelCall
	url   string // the base URL the worker is given (…/v1)
}

func recordModel(t *testing.T, stub string) *modelRecorder {
	t.Helper()
	target, err := url.Parse(strings.TrimSuffix(stub, "/v1"))
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1 // streamed replies pass through as they come
	r := &modelRecorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		r.mu.Lock()
		r.calls = append(r.calls, modelCall{Path: req.URL.Path, Auth: req.Header.Get("Authorization"), Body: body})
		r.mu.Unlock()
		proxy.ServeHTTP(w, req)
	}))
	t.Cleanup(srv.Close)
	r.url = srv.URL + "/v1"
	return r
}

// completions are the chat completion requests so far.
func (r *modelRecorder) completions() []modelCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []modelCall
	for _, c := range r.calls {
		if strings.HasSuffix(c.Path, "/chat/completions") {
			out = append(out, c)
		}
	}
	return out
}

// with are the completion requests whose body contains marker.
func (r *modelRecorder) with(marker string) []modelCall {
	var out []modelCall
	for _, c := range r.completions() {
		if bytes.Contains(c.Body, []byte(marker)) {
			out = append(out, c)
		}
	}
	return out
}

// toolTexts are the tool results in a completion request.
func (c modelCall) toolTexts() []string {
	var body struct {
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(c.Body, &body)
	var out []string
	for _, m := range body.Messages {
		if m.Role != "tool" {
			continue
		}
		var s string
		if json.Unmarshal(m.Content, &s) != nil {
			s = string(m.Content)
		}
		out = append(out, s)
	}
	return out
}

// stubModelAt is run.start's model: the stub behind the recorder, with a
// grant key that names whether Go asked for the Sensitive grant (as the
// gateway's AgentModelFor does: one endpoint, a grant per kind of run).
func stubModelAt(rec *modelRecorder) func(context.Context, string, string, string, RunModelOptions) (any, error) {
	return func(_ context.Context, _, _, _ string, opts RunModelOptions) (any, error) {
		key := grantPlain
		if opts.Sensitive {
			key = grantSensitive
		}
		return map[string]any{"provider": "custom", "model": "stub-model", "base_url": rec.url, "api_key": key, "api_mode": "chat_completions"}, nil
	}
}

const (
	grantPlain     = "tgw-plain-run-grant"
	grantSensitive = "tgw-sensitive-run-grant"
)

// realHarness starts the engine on the real worker (rt) with the stub model
// behind a recorder.
func realHarness(t *testing.T, rt, stubRuntime agenthost.Runtime) (*engineHarness, *modelRecorder) {
	t.Helper()
	rec := recordModel(t, startStubModel(t, stubRuntime))
	cfg := agenthost.Config{
		Root:          realWorkerRoot(t),
		Runtime:       rt,
		RenderAccount: true,
		HelloTimeout:  60 * time.Second,
		Account: func(context.Context, string) (agenthost.AccountSpec, error) {
			return agenthost.AccountSpec{Settings: json.RawMessage(`{"toolsets":["timely","todo","skills"],"learning":{"memory":false,"user_profile":false},"curator":false,"timezone":"UTC"}`)}, nil
		},
	}
	h := newEngineHarnessWith(t, cfg, stubModelAt(rec))
	if err := h.db.Create(&testItem{ID: "tsk_real", Value: "Water the plants"}).Error; err != nil {
		t.Fatal(err)
	}
	return h, rec
}

// realChat queues an agent-engine chat of user-a with the row edited.
func (h *engineHarness) realChat(text, permission string, edit func(*Conversation)) Conversation {
	h.t.Helper()
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Agent", Status: "queued", Phase: "plan", Engine: engineAgent,
		Permission: permission, Provider: "openrouter", Model: "stub-model", Client: "web", Context: []ContextChip{},
		Messages: []Message{message("user", text)}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if edit != nil {
		edit(&c)
	}
	if err := h.db.Create(&c).Error; err != nil {
		h.t.Fatal(err)
	}
	return c
}

// stubScript is the stub's SCRIPT directive, tagged so the recorder can
// find the chat's requests.
func stubScript(tag string, steps ...obj) string {
	return "SCRIPT " + string(raw(steps)) + " " + tag
}

func stubCalls(name string, args any) obj { return obj{"calls": [][]any{{name, args}}} }

// realCard waits for a card on the row (status running) other than skip.
func (h *engineHarness) realCard(cid, skip string) Conversation {
	h.t.Helper()
	return h.waitLong(cid, "asked", func(c Conversation) bool {
		return c.Status == "running" && c.Question.RequestID != "" && c.Question.RequestID != skip
	})
}

// runGone waits until this API no longer follows a run of the chat (the
// worker's run.done reached the follower).
func (h *engineHarness) runGone(cid string) {
	h.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		h.e.mu.Lock()
		live := h.e.chats[cid] != nil
		h.e.mu.Unlock()
		if !live {
			return
		}
		if time.Now().After(deadline) {
			h.t.Fatal("the worker never ended the run")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// pickTwo is a two-question card: a single choice and an open question.
var pickTwo = obj{"questions": []obj{
	{"question": "Which day suits you?", "choices": []string{"Monday", "Tuesday"}},
	{"question": "Anything to add to the title?"},
}}

// Question cards through the real worker: the card reaches the row, the
// answer reaches the model as Hermes' clarify result and the same run goes
// on to its proposal; a short timeout closes the card and the run goes on;
// Stop and Delete during the wait end the run with no answer reaching it;
// a worker killed during the wait fails the chat with Try again.
func TestIntegrationAgentEngineRealWorkerQuestionCards(t *testing.T) {
	rt := realRuntime(t)
	h, rec := realHarness(t, rt, rt)

	// 1. Ask, answer, continue the same turn into a held proposal.
	tag := "tag-ask-answer"
	c := h.realChat(stubScript(tag,
		stubCalls("clarify", pickTwo),
		stubCalls("propose_changes", buyMilk(true)),
		obj{"text": "I drafted adding Buy milk."},
	), "supervised", nil)
	c = h.realCard(c.ID, "")
	q := c.Question
	if q.Run == "" || q.Run != c.AgentRunID || len(q.RequestID) != 32 || len(q.Questions) != 2 ||
		q.Questions[0].QID != "q0" || q.Questions[0].Question != "Which day suits you?" || !slices.Equal(q.Questions[0].Choices, []string{"Monday", "Tuesday"}) ||
		q.Questions[1].Choices != nil || q.ExpiresAt == nil || q.AskedAt == nil || q.ExpiresAt.Sub(*q.AskedAt) != 10*time.Minute {
		t.Fatalf("card %+v (run %s)", q, c.AgentRunID)
	}
	if n := len(rec.with(tag)); n != 1 {
		t.Fatalf("%d model requests before the answer, want 1 (the run waits)", n)
	}
	code, body := h.post("/chats/"+c.ID+"/answer", fmt.Sprintf(`{"requestId":%q,"answers":{"q0":"Tuesday","q1":"after lunch"}}`, q.RequestID))
	if code != 200 {
		t.Fatalf("answer: %d %s", code, body)
	}
	c = h.waitLong(c.ID, "held the proposal", statusIs("approval"))
	if len(c.Plan) != 1 || c.Plan[0].Tool != "create_task" || items(h.db) != 1 {
		t.Fatalf("plan %+v, %d items", c.Plan, items(h.db))
	}
	if p := latestProposal(c.Messages); p == nil || p.AgentRun != q.Run {
		t.Fatalf("the proposal came from another run: %+v, want %s", p, q.Run)
	}
	asked := questionMessages(c)
	if len(asked) != 1 || asked[0].Question == nil || asked[0].Question.Outcome != outcomeSubmitted || asked[0].Question.Answers["q0"] != "Tuesday" || asked[0].AgentRun != q.Run {
		t.Fatalf("question messages %+v", asked)
	}
	after := rec.with(tag)
	var result struct {
		Outcome   string `json:"outcome"`
		Responses []struct {
			UserResponse string `json:"user_response"`
		} `json:"responses"`
	}
	for _, text := range after[len(after)-1].toolTexts() {
		if strings.Contains(text, `"responses"`) {
			_ = json.Unmarshal([]byte(text), &result)
		}
	}
	if result.Outcome != outcomeSubmitted || len(result.Responses) != 2 || result.Responses[0].UserResponse != "Tuesday" || result.Responses[1].UserResponse != "after lunch" {
		t.Fatalf("the model read %+v after the answer", result)
	}
	if code, _ := h.post("/chats/"+c.ID+"/answer", fmt.Sprintf(`{"requestId":%q,"answers":{"q0":"Monday"}}`, q.RequestID)); code != 409 {
		t.Fatalf("a second answer: %d, want 409", code)
	}

	// 2. A short timeout: the card closes "timed out" and the run goes on.
	h.e.opts.ClarifyTimeout = 2 * time.Second
	tag = "tag-ask-timeout"
	multi := obj{"questions": []obj{{"question": "Which days?", "choices": []string{"Mon", "Tue", "Wed"}, "multi_select": true}}}
	c = h.realChat(stubScript(tag, stubCalls("clarify", multi), obj{"text": "I went with Monday."}), "supervised", nil)
	c = h.realCard(c.ID, "")
	if !c.Question.Questions[0].MultiSelect || c.Question.ExpiresAt.Sub(*c.Question.AskedAt) != 2*time.Second {
		t.Fatalf("multi-select card %+v", c.Question)
	}
	c = h.waitLong(c.ID, "replied", statusIs("idle"))
	h.e.opts.ClarifyTimeout = defaultClarifyTimeout
	asked = questionMessages(c)
	if len(asked) != 1 || asked[0].Question.Outcome != outcomeTimedOut || lastMessage(c).Content != "I went with Monday." || c.Question.pending() {
		t.Fatalf("after the timeout: %+v, reply %q", asked, lastMessage(c).Content)
	}

	// 3. Stop during the wait: the worker ends the run, the model is never
	// asked again, and a late answer is stale.
	tag = "tag-ask-stop"
	c = h.realChat(stubScript(tag, stubCalls("clarify", pickTwo), obj{"text": "never"}), "auto", nil)
	c = h.realCard(c.ID, "")
	request := c.Question.RequestID
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	h.runGone(c.ID)
	c = h.waitLong(c.ID, "stopped", statusIs("stopped"))
	if asked := questionMessages(c); c.Question.pending() || len(asked) != 1 || asked[0].Question.Outcome != outcomeStopped {
		t.Fatalf("after Stop: card %+v, questions %+v", c.Question, asked)
	}
	if code, _ := h.post("/chats/"+c.ID+"/answer", fmt.Sprintf(`{"requestId":%q,"answers":{"q0":"Monday"}}`, request)); code != 409 {
		t.Fatalf("an answer after Stop: %d, want 409", code)
	}
	time.Sleep(500 * time.Millisecond)
	if n := len(rec.with(tag)); n != 1 {
		t.Fatalf("%d model requests for the stopped run, want 1", n)
	}

	// 4. Delete during the wait: the run ends in the worker and an answer
	// finds no chat.
	tag = "tag-ask-delete"
	c = h.realChat(stubScript(tag, stubCalls("clarify", pickTwo), obj{"text": "never"}), "supervised", nil)
	c = h.realCard(c.ID, "")
	request = c.Question.RequestID
	if code, body := serve(t, h.s, "DELETE", "/chats/"+c.ID, ""); code != 204 {
		t.Fatalf("delete: %d %s", code, body)
	}
	h.runGone(c.ID)
	if code, _ := h.post("/chats/"+c.ID+"/answer", fmt.Sprintf(`{"requestId":%q,"answers":{"q0":"Monday"}}`, request)); code != 404 {
		t.Fatalf("an answer after Delete: %d, want 404", code)
	}
	time.Sleep(500 * time.Millisecond)
	if n := len(rec.with(tag)); n != 1 {
		t.Fatalf("%d model requests for the deleted chat's run, want 1", n)
	}

	// 5. The worker is killed during the wait: Try again; Retry asks again
	// in a new worker.
	tag = "tag-ask-kill"
	c = h.realChat(stubScript(tag, stubCalls("clarify", pickTwo), obj{"text": "Booked."}), "supervised", nil)
	c = h.realCard(c.ID, "")
	request = c.Question.RequestID
	w, ok := h.e.sup.Worker("user-a")
	if !ok {
		t.Fatal("no worker")
	}
	proc, err := os.FindProcess(w.PID())
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Kill(); err != nil {
		t.Fatal(err)
	}
	c = h.waitLong(c.ID, "failed", func(c Conversation) bool { return c.Status == "failed" })
	if asked := questionMessages(c); c.Error != tr("", txtAgentLost) || c.ErrorAction != ActionRetry || c.Question.pending() || c.AgentRunID != "" ||
		len(asked) != 1 || asked[0].Question.Outcome != outcomeStopped {
		t.Fatalf("after the kill: %q %q card %+v questions %+v", c.Error, c.ErrorAction, c.Question, asked)
	}
	if code, _ := h.post("/chats/"+c.ID+"/answer", fmt.Sprintf(`{"requestId":%q,"answers":{"q0":"Monday"}}`, request)); code != 409 {
		t.Fatalf("an answer after the kill: %d, want 409", code)
	}
	if code, body := h.post("/chats/"+c.ID+"/retry", "{}"); code != 200 {
		t.Fatalf("retry: %d %s", code, body)
	}
	c = h.realCard(c.ID, request)
	if code, body := h.post("/chats/"+c.ID+"/answer", fmt.Sprintf(`{"requestId":%q,"answers":{"q0":"Monday"}}`, c.Question.RequestID)); code != 200 {
		t.Fatalf("answer after Retry: %d %s", code, body)
	}
	if c = h.waitLong(c.ID, "replied", statusIs("idle")); lastMessage(c).Content != "Booked." {
		t.Fatalf("reply after Retry %q", lastMessage(c).Content)
	}
}

// fixtureHostsRuntime is rt started through a wrapper that answers name
// lookups of *.fixture.invalid with a public documentation address (Hermes'
// SSRF floor resolves every web_extract host before the backend runs; Go's
// FixtureFetcher then serves the page, so nothing connects to it), and is
// otherwise the real boot path (apps/agent/tests/contract/probe_boot.py).
func fixtureHostsRuntime(t *testing.T, rt agenthost.Runtime) agenthost.Runtime {
	t.Helper()
	contract := ""
	for _, arg := range rt.Args {
		if strings.HasSuffix(arg, "boot.py") {
			contract = filepath.Join(filepath.Dir(filepath.Dir(arg)), "tests", "contract")
		}
	}
	if _, err := os.Stat(filepath.Join(contract, "probe_boot.py")); err != nil {
		t.Skipf("no probe_boot.py next to runtime %v", rt.Args)
	}
	wrapper := filepath.Join(t.TempDir(), "fixture_hosts_boot.py")
	src := fmt.Sprintf(`import socket, sys
sys.path.insert(0, %q)
_orig = socket.getaddrinfo
def _fake(host, port=None, *args, **kwargs):
    if isinstance(host, str) and host.rstrip(".").endswith(".fixture.invalid"):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port or 443))]
    return _orig(host, port, *args, **kwargs)
socket.getaddrinfo = _fake
import probe_boot
sys.exit(probe_boot.main(sys.argv[1:]))
`, contract)
	if err := os.WriteFile(wrapper, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	return agenthost.Runtime{Program: rt.Program, Args: []string{"-I", wrapper}}
}

// A sub-task through the real worker: it shows as an activity line, its
// web_extract of a fixture page reaches Go under the parent's run and taints
// the chat via "subagent", so the parent's direct proposal is held in Auto.
func TestIntegrationAgentEngineRealWorkerSubtaskTaint(t *testing.T) {
	rt := realRuntime(t)
	h, rec := realHarness(t, fixtureHostsRuntime(t, rt), rt)
	h.e.opts.ActivityEvery = 50 * time.Millisecond
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "news"), 0o755); err != nil {
		t.Fatal(err)
	}
	page := "<html><head><title>Milk prices</title></head><body><p>Milk costs less this week.</p></body></html>"
	if err := os.WriteFile(filepath.Join(dir, "news", "index.html"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	h.e.opts.Fetch = FixtureFetcher(dir)
	const pageURL = "https://news.fixture.invalid/"
	kid := stubScript("kid-web",
		stubCalls("web_extract", obj{"urls": []string{pageURL}}),
		obj{"text": "The page says milk costs less.", "sleep": 1.5},
	)
	tag := "tag-subtask"
	c := h.realChat(stubScript(tag,
		stubCalls("delegate_task", obj{"tasks": []obj{{"goal": kid}}}),
		stubCalls("propose_changes", buyMilk(true)),
		obj{"text": "I drafted the change."},
	), "auto", func(c *Conversation) { c.WebSearch = true })
	h.waitLong(c.ID, "showed the sub-task", func(c Conversation) bool {
		for _, l := range c.Activity.Lines {
			if l.Kind == "subagent" && strings.HasPrefix(l.Label, "Sub-task: SCRIPT") && l.State == "running" {
				return true
			}
		}
		return false
	})
	c = h.waitLong(c.ID, "held the proposal", ended)
	var child TaintSource
	for _, s := range c.TaintedSources {
		if s.Via == "subagent" {
			child = s
		}
	}
	if c.Status != "approval" || items(h.db) != 1 || child.Kind != "web" || child.Tool != "web_extract" || child.Host != "news.fixture.invalid" || child.Child == "" {
		t.Fatalf("status %s, %d items, tainted_sources %+v", c.Status, items(h.db), c.TaintedSources)
	}
	if holdReason(&c, c.Plan, nil) != heldTainted {
		t.Fatalf("held for %q", holdReason(&c, c.Plan, nil))
	}
	// The child read the page through Go (the fixture text reached its
	// model), under its own session.
	read := false
	kids := 0
	for _, call := range rec.with("kid-web") {
		if bytes.Contains(call.Body, []byte(tag)) {
			continue // the parent's requests carry the child's goal too
		}
		kids++
		for _, text := range call.toolTexts() {
			read = read || strings.Contains(text, "Milk costs less this week.")
		}
	}
	if kids < 2 || !read {
		t.Fatalf("the child's model (%d requests of its own) never read the page", kids)
	}
}

// homeSnapshot is every path under home with its size, mode, mtime and
// sha256 (the tmp folder's own mtime aside).
func homeSnapshot(t *testing.T, home string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(home, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(home, path)
		if rel == "tmp" {
			// The worker's TMPDIR (agenthost.Layout.Temp): Python's
			// tempfile probes it once per process (a random 8-letter file
			// holding "blat", deleted at once), which moves its mtime. What
			// it holds is still compared, entry by entry.
			out[rel] = "dir"
			return nil
		}
		digest := ""
		if info.Mode().IsRegular() {
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(b)
			digest = hex.EncodeToString(sum[:])
		}
		out[rel] = fmt.Sprintf("%d %v %d %s", info.Size(), info.Mode(), info.ModTime().UnixNano(), digest)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func changedPaths(before, after map[string]string) []string {
	var out []string
	for k, v := range after {
		if before[k] != v {
			out = append(out, k)
		}
	}
	for k := range before {
		if _, ok := after[k]; !ok {
			out = append(out, k)
		}
	}
	slices.Sort(out)
	return out
}

// A Sensitive chat with the test-only no-persist switch on: two turns with
// tool calls on the real worker leave the account's agent home byte for
// byte as it was, every model call carries the Sensitive grant, and the
// second turn's model saw the first (Go sends the whole conversation). With
// the switch off the same kind of chat runs classic and never reaches the
// worker.
func TestIntegrationAgentEngineRealWorkerSensitiveNoPersist(t *testing.T) {
	rt := realRuntime(t)
	h, rec := realHarness(t, rt, rt)
	const secret = "zebrafinch-np-4471"

	// An ordinary chat first: the home has served the model endpoint (as
	// every real Sensitive turn's home has; a cold home records endpoint
	// metadata, apps/agent/tests/contract/test_c_no_persist.py).
	warm := h.realChat("hello there", "supervised", nil)
	h.waitLong(warm.ID, "replied", statusIs("idle"))
	time.Sleep(time.Second) // the worker's end-of-turn writes settle
	home := h.e.sup.Layout().Home("user-a")
	before := homeSnapshot(t, home)
	plain := len(rec.completions())
	if plain == 0 {
		t.Fatal("the warm-up chat never reached the model")
	}

	h.s.SetSensitiveNoPersist(true)
	todo := obj{"todos": []obj{{"id": "1", "content": secret + " list", "status": "in_progress"}}}
	first := stubScript("tag-np-first", stubCalls("todo_list", todo), obj{"text": "Listed."})
	c := h.realChat(first, "supervised", func(c *Conversation) { c.Sensitive = true })
	c = h.waitLong(c.ID, "replied", statusIs("idle"))
	if c.RunEngine != engineAgent {
		t.Fatalf("run engine %q with the switch on", c.RunEngine)
	}
	second := stubScript("tag-np-second", stubCalls("get_task", obj{"taskId": "tsk_real", "note": secret}))
	if code, body := h.post("/chats/"+c.ID+"/messages", fmt.Sprintf(`{"content":%q}`, second)); code != 200 {
		t.Fatalf("send: %d %s", code, body)
	}
	c = h.waitLong(c.ID, "replied again", func(c Conversation) bool { return c.Status == "idle" && len(c.Messages) >= 4 })
	if !strings.Contains(lastMessage(c).Content, "Water the plants") || c.Messages[1].Content != "Listed." {
		t.Fatalf("second reply %q", lastMessage(c).Content)
	}
	time.Sleep(time.Second)
	after := homeSnapshot(t, home)
	if diff := changedPaths(before, after); len(diff) != 0 {
		t.Fatalf("two no-persist turns changed the home: %v", diff)
	}
	_ = filepath.WalkDir(home, func(path string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			if b, err := os.ReadFile(path); err == nil && bytes.Contains(b, []byte(secret)) {
				t.Errorf("%s holds the Sensitive chat's text", path)
			}
		}
		return nil
	})
	sensitive := rec.completions()[plain:]
	if len(sensitive) < 4 {
		t.Fatalf("%d model calls for two turns with a tool each", len(sensitive))
	}
	for i, call := range sensitive {
		if call.Auth != "Bearer "+grantSensitive {
			t.Fatalf("model call %d of the Sensitive chat used %q", i, call.Auth)
		}
	}
	for _, call := range rec.completions()[:plain] {
		if call.Auth != "Bearer "+grantPlain {
			t.Fatalf("the ordinary chat used %q", call.Auth)
		}
	}
	saw := false
	for _, call := range sensitive {
		saw = saw || (bytes.Contains(call.Body, []byte("tag-np-second")) && bytes.Contains(call.Body, []byte("tag-np-first")))
	}
	if !saw {
		t.Fatal("the second turn's model never saw the first turn")
	}

	// The switch off (the default): a Sensitive chat runs classic and its
	// text never reaches the worker or the model endpoint.
	h.s.SetSensitiveNoPersist(false)
	n := len(rec.completions())
	off := h.realChat(first, "supervised", func(c *Conversation) { c.Sensitive = true })
	off = h.waitLong(off.ID, "claimed", func(c Conversation) bool { return c.RunEngine != "" })
	if off.RunEngine != engineClassic {
		t.Fatalf("run engine %q with the switch off", off.RunEngine)
	}
	if err := h.e.Available(context.Background(), "user-a", &off); err == nil || err.Error() != "Sensitive chats use the classic engine" {
		t.Fatalf("Available with the switch off: %v", err)
	}
	h.wait(off.ID, "ended", ended)
	if got := len(rec.completions()); got != n {
		t.Fatalf("%d model calls from a classic Sensitive chat through the worker's endpoint", got-n)
	}
	if diff := changedPaths(before, homeSnapshot(t, home)); len(diff) != 0 {
		t.Fatalf("the classic Sensitive chat changed the home: %v", diff)
	}
}
