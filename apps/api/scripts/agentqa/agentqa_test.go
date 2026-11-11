package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestScenariosFile(t *testing.T) {
	list, err := LoadScenarios("scenarios.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 84 {
		t.Fatalf("got %d scenarios, want 84", len(list))
	}
	per := map[string]int{}
	stubs := 0
	for _, s := range list {
		per[s.Category]++
		// Every template must expand once setup has answered.
		vars := Vars{Workspace: "ws_1", Zone: time.UTC, Now: time.Now(), Saved: map[string]any{}}
		for _, r := range s.Setup {
			if r.As != "" {
				vars.Saved[r.As] = map[string]any{"task": map[string]any{"id": "id_" + r.As}}
			}
			if _, err := vars.ExpandAny(r.Body); err != nil {
				t.Errorf("%s setup: %v", s.ID, err)
			}
		}
		for _, r := range s.Between {
			if _, err := vars.Expand(r.Path); err != nil {
				t.Errorf("%s between: %v", s.ID, err)
			}
		}
		if _, err := vars.Expand(s.Message); err != nil {
			t.Errorf("%s message: %v", s.ID, err)
		}
		if s.Stub != "" {
			stubs++
			d, err := vars.Expand(s.Stub)
			if err != nil {
				t.Errorf("%s stub: %v", s.ID, err)
			}
			if rest, ok := strings.CutPrefix(d, "CALL propose_changes "); ok && !json.Valid([]byte(rest)) {
				t.Errorf("%s stub: proposal is not JSON: %s", s.ID, rest)
			}
		}
	}
	for _, c := range Categories {
		if per[c] != 7 {
			t.Errorf("category %s has %d scenarios, want 7", c, per[c])
		}
	}
	if stubs < 5 {
		t.Errorf("%d scenarios have stub directives, want at least 5 for the smoke run", stubs)
	}
}

func TestExpandDatesInTheScenarioZone(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	// 20:00 UTC on 9 Nov is 05:00 on 10 Nov in Tokyo.
	vars := Vars{Zone: tokyo, Now: time.Date(2026, 11, 9, 20, 0, 0, 0, time.UTC)}
	got, err := vars.Expand("{{today+0}} {{today+1T09:30}} {{timezone}}")
	if err != nil {
		t.Fatal(err)
	}
	if want := "2026-11-10 2026-11-11T09:30:00+09:00 Asia/Tokyo"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if _, err := vars.Expand("{{t9.id}}"); err == nil {
		t.Fatal("an unknown alias must fail")
	}
}

func TestPick(t *testing.T) {
	list := []Scenario{{ID: "tasks-01", Category: "tasks"}, {ID: "docs-01", Category: "docs"}, {ID: "docs-02", Category: "docs"}}
	got, err := Pick(list, "tasks-01, docs")
	if err != nil || len(got) != 3 {
		t.Fatalf("got %d, %v", len(got), err)
	}
	if _, err := Pick(list, "nope"); err == nil {
		t.Fatal("an unknown id must fail")
	}
}

func TestScore(t *testing.T) {
	prop := &Proposal{Steps: []PlanStep{{Tool: "create_task"}}}
	cases := []struct {
		name string
		exp  Expect
		r    Result
		pass bool
	}{
		{"proposal with the tool", Expect{Outcome: "proposal", Tools: []string{"create_task"}}, Result{Status: "approval", Proposal: prop}, true},
		{"proposal missing the tool", Expect{Outcome: "proposal", Tools: []string{"delete_task"}}, Result{Status: "approval", Proposal: prop}, false},
		{"reply expected, proposal made", Expect{Outcome: "reply"}, Result{Status: "approval", Proposal: prop, Replies: []string{"ok"}}, false},
		{"reply with a word", Expect{Outcome: "reply", ReplyAny: []string{"Garden"}}, Result{Status: "idle", Replies: []string{"You have one task: plan the garden."}}, true},
		{"reply without the word", Expect{Outcome: "reply", ReplyAny: []string{"bot"}}, Result{Status: "idle", Replies: []string{"Nothing."}}, false},
		{"failed run", Expect{Outcome: "any"}, Result{Status: "failed", Error: "boom"}, false},
		{"replanned as expected", Expect{Outcome: "proposal", AfterApprove: "replanned"}, Result{Status: "approval", Proposal: prop, Approved: true, AfterApprove: "replanned"}, true},
		{"applied when a replan was expected", Expect{Outcome: "proposal", AfterApprove: "replanned"}, Result{Status: "idle", Proposal: prop, Approved: true, AfterApprove: "applied"}, false},
		{"harness error", Expect{Outcome: "any"}, Result{HarnessError: "setup"}, false},
	}
	for _, c := range cases {
		r := c.r
		Score(Scenario{Expect: c.exp}, &r)
		if r.Pass != c.pass {
			t.Errorf("%s: pass = %v (%v), want %v", c.name, r.Pass, r.Why, c.pass)
		}
	}
}

// fakeAPI answers the routes the harness calls: a chat records a held
// create_task proposal, and Approve applies it. Every sign-up gets its own
// token, and the fake remembers which account made each task and chat.
type fakeAPI struct {
	mu        sync.Mutex
	engine    string
	keys      []string
	chats     map[string]map[string]any
	polls     int
	approvals int
	accounts  []string          // tokens, in sign-up order
	tasks     map[string]int    // token -> tasks it made
	chatOwner map[string]string // chat id -> token
}

func (f *fakeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	send := func(code int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(v)
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if r.URL.Path != "/register" && !slices.Contains(f.accounts, token) {
		send(401, map[string]string{"message": "unauthorized"})
		return
	}
	switch {
	case r.Method == "POST" && r.URL.Path == "/register":
		token = fmt.Sprintf("tok-%d", len(f.accounts)+1)
		f.accounts = append(f.accounts, token)
		send(201, map[string]any{"token": token})
	case r.URL.Path == "/workspaces":
		send(200, []map[string]any{{"id": "ws_1", "name": "Home"}})
	case strings.HasPrefix(r.URL.Path, "/agent/providers/"):
		f.keys = append(f.keys, body["key"].(string))
		send(200, map[string]any{"ok": true})
	case r.URL.Path == "/agent/providers":
		send(200, map[string]any{})
	case r.URL.Path == "/agent/chat-settings":
		f.engine, _ = body["engine"].(string)
		send(200, map[string]any{"engine": f.engine, "engineAvailable": true})
	case r.Method == "POST" && r.URL.Path == "/tasks":
		if f.tasks == nil {
			f.tasks = map[string]int{}
		}
		f.tasks[token]++
		send(201, map[string]any{"task": map[string]any{"id": "task_9"}})
	case r.Method == "POST" && r.URL.Path == "/chats":
		id := fmt.Sprintf("chat_%d", len(f.chats)+1)
		if f.chatOwner == nil {
			f.chatOwner = map[string]string{}
		}
		f.chatOwner[id] = token
		f.chats[id] = map[string]any{"id": id, "status": "queued", "revision": 1, "runEngine": f.engine,
			"messages": []any{map[string]any{"role": "user", "content": body["content"]}}, "plan": []any{}}
		send(201, f.chats[id])
	case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/chats/"):
		c := f.chats[strings.TrimPrefix(r.URL.Path, "/chats/")]
		f.polls++
		if c["status"] == "queued" {
			c["status"] = "running"
			c["activity"] = map[string]any{"lines": []any{map[string]any{"id": "call_1", "kind": "tool", "label": "List tasks"}}}
		} else if c["status"] == "running" {
			c["status"] = "approval"
			c["activity"] = map[string]any{}
			c["messages"] = append(c["messages"].([]any), map[string]any{"role": "assistant", "proposal": true, "content": "Add a task",
				"steps": []any{map[string]any{"tool": "create_task", "summary": "Add", "status": "pending"}}})
			c["plan"] = []any{map[string]any{"tool": "create_task", "summary": "Add", "status": "pending"}}
		}
		send(200, c)
	case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/approve"):
		f.approvals++
		c := f.chats[strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/chats/"), "/approve")]
		c["status"] = "idle"
		c["plan"] = []any{map[string]any{"tool": "create_task", "summary": "Add", "status": "done"}}
		c["messages"] = append(c["messages"].([]any), map[string]any{"role": "system", "kind": "notice", "content": "Done"})
		send(200, c)
	default:
		send(404, map[string]string{"message": "no route " + r.Method + " " + r.URL.Path})
	}
}

func TestRunAgainstAFakeAPI(t *testing.T) {
	fake := &fakeAPI{chats: map[string]map[string]any{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	const secret = "sk-test-parity-secret-0001"
	cfg := Config{API: srv.URL, Provider: "openrouter", Model: "m", Key: secret, Permission: "supervised", Timeout: 5 * time.Second, Poll: time.Millisecond}
	ctx := context.Background()
	c, email, unavailable, err := Signup(ctx, cfg, "agent")
	if err != nil || unavailable != "" || !strings.HasSuffix(email, "@example.invalid") {
		t.Fatalf("signup: %v %q %q", err, unavailable, email)
	}
	if fake.engine != "agent" || len(fake.keys) != 1 || fake.keys[0] != secret {
		t.Fatalf("settings: engine %q keys %d", fake.engine, len(fake.keys))
	}
	s := Scenario{ID: "tasks-03", Category: "tasks", Message: "Mark {{t1.id}} done", Approve: true,
		Setup:  []Request{{As: "t1", Method: "POST", Path: "/tasks", Body: map[string]any{"name": "x", "workspaceId": "{{workspace}}"}}},
		Expect: Expect{Outcome: "proposal", Tools: []string{"create_task"}, AfterApprove: "applied"}}
	r := RunScenario(ctx, cfg, c, "agent", s)
	if !r.Pass || r.Message != "Mark task_9 done" || !r.Approved || r.AfterApprove != "applied" || fake.approvals != 1 {
		t.Fatalf("result: %+v", r)
	}
	if len(r.Trace) != 1 || r.Trace[0] != "List tasks" {
		t.Fatalf("trace: %v", r.Trace)
	}
	dir := t.TempDir()
	run := EngineRun{Engine: "agent", API: srv.URL, Provider: "openrouter", Model: "m", Results: []Result{r}}
	path, err := WriteJSON(dir, run)
	if err != nil {
		t.Fatal(err)
	}
	report := Markdown([]EngineRun{{Engine: "classic", Results: []Result{{ID: "tasks-03", Category: "tasks", Status: "idle", Replies: []string{"hi"}}}}, run}, []Scenario{s})
	if err := os.WriteFile(filepath.Join(dir, "report.md"), []byte(report), 0o644); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	for name, text := range map[string]string{"json": string(raw), "report": report} {
		if strings.Contains(text, secret) {
			t.Fatalf("the key leaked into the %s", name)
		}
	}
	if !strings.Contains(report, "| tasks | 0/1 | 1/1 |") || !strings.Contains(report, "1 of 1 scenarios ended differently") {
		t.Fatalf("report:\n%s", report)
	}
}

// Every scenario runs in a fresh account of its own, so a setup that makes
// a "Groceries" task in one scenario is not in the next scenario's account.
func TestEveryScenarioGetsItsOwnAccount(t *testing.T) {
	fake := &fakeAPI{chats: map[string]map[string]any{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	cfg := Config{API: srv.URL, Provider: "openrouter", Model: "m", Key: "k-test", Permission: "supervised", Timeout: 5 * time.Second, Poll: time.Millisecond}
	setup := []Request{{As: "t1", Method: "POST", Path: "/tasks", Body: map[string]any{"name": "Groceries", "workspaceId": "{{workspace}}"}}}
	picked := []Scenario{
		{ID: "tasks-01", Category: "tasks", Message: "Add {{t1.id}}", Setup: setup, Approve: true, Expect: Expect{Outcome: "proposal"}},
		{ID: "sheets-01", Category: "sheets", Message: "Add {{t1.id}} again", Setup: setup, Approve: true, Expect: Expect{Outcome: "proposal"}},
	}
	run, err := RunEngine(context.Background(), cfg, "agent", picked)
	if err != nil {
		t.Fatal(err)
	}
	if len(fake.accounts) != 2 || run.Accounts != 2 || len(run.Results) != 2 {
		t.Fatalf("sign-ups %d, accounts %d, results %d; want one account per scenario", len(fake.accounts), run.Accounts, len(run.Results))
	}
	for _, tok := range fake.accounts {
		if fake.tasks[tok] != 1 {
			t.Fatalf("account %s made %d setup tasks, want 1 (setups piled up)", tok, fake.tasks[tok])
		}
	}
	if fake.chatOwner["chat_1"] == fake.chatOwner["chat_2"] {
		t.Fatalf("both chats ran in account %s", fake.chatOwner["chat_1"])
	}
	a, b := run.Results[0], run.Results[1]
	if a.Account == "" || a.Account == b.Account || !a.Pass || !b.Pass {
		t.Fatalf("results: %+v / %+v", a, b)
	}
	if fake.engine != "agent" || len(fake.keys) != 2 {
		t.Fatalf("engine %q, provider keys sent %d; each account connects the provider", fake.engine, len(fake.keys))
	}
}

// A sign-up that fails on the first scenario stops the run.
func TestRunEngineStopsWhenTheFirstSignupFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"registration closed"}`, http.StatusForbidden)
	}))
	defer srv.Close()
	cfg := Config{API: srv.URL, Provider: "openrouter", Model: "m", Key: "k", Permission: "supervised", Timeout: time.Second, Poll: time.Millisecond}
	if _, err := RunEngine(context.Background(), cfg, "classic", []Scenario{{ID: "tasks-01"}}); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("err = %v, want the sign-up's 403", err)
	}
}

func TestScrub(t *testing.T) {
	if got := scrub(`{"key":"sk-abc-123"} rejected`, "sk-abc-123"); strings.Contains(got, "sk-abc") {
		t.Fatalf("scrub left the key: %s", got)
	}
}

func TestProposalStepsComeFromThePlan(t *testing.T) {
	conv := conversation{Messages: []message{{Role: "assistant", Proposal: true, Content: "Add a task"}},
		Plan: []planEntry{{Tool: "create_task", Summary: "Add", Status: "pending"}}}
	p := latestProposal(conv)
	if p == nil || len(p.Steps) != 1 || p.Steps[0].Tool != "create_task" || !p.Held {
		t.Fatalf("proposal: %+v", p)
	}
}

func TestStubPhrases(t *testing.T) {
	path := filepath.Join(t.TempDir(), "phrases.json")
	if err := addPhrase(path, "Add a task", "CALL propose_changes {}"); err != nil {
		t.Fatal(err)
	}
	if err := addPhrase(path, "How many tasks?", `SCRIPT [{"text": "One."}]`); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	var table map[string]string
	if err := json.Unmarshal(raw, &table); err != nil || len(table) != 2 || table["Add a task"] != "CALL propose_changes {}" {
		t.Fatalf("table %s: %v", raw, err)
	}
}
