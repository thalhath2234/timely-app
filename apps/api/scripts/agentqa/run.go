package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"
)

// Config is one parity run's settings.
type Config struct {
	API        string
	Provider   string
	Model      string
	Key        string // TIMELY_PARITY_KEY; never logged or written
	Permission string
	Stub       bool
	// StubPhrases, when set, is the stub shim's phrase table ({message:
	// directive}): the directive goes there and the chat shows only the
	// person's words. Otherwise the directive is appended to the message,
	// which works on classic but not on the agent engine, whose turn input
	// adds Timely's notices after the person's words.
	StubPhrases string
	Timeout     time.Duration
	Poll        time.Duration
	DB          *sql.DB // optional: reads classic's transcript for the trace
	Logf        func(format string, args ...any)
}

// client is the signed-in account the run uses.
type client struct {
	base  string
	token string
	http  *http.Client
}

// apiError is a non-2xx answer.
type apiError struct {
	Method, Path string
	Code         int
	Body         string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("%s %s: %d %s", e.Method, e.Path, e.Code, strings.TrimSpace(e.Body))
}

func (c *client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "timely-agentqa")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode/100 != 2 {
		return &apiError{Method: method, Path: path, Code: resp.StatusCode, Body: string(raw)}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// conversation is the part of GET /chats/:id the harness reads.
type conversation struct {
	ID          string      `json:"id"`
	Status      string      `json:"status"`
	Phase       string      `json:"phase"`
	Error       string      `json:"error"`
	ErrorAction string      `json:"errorAction"`
	Revision    int         `json:"revision"`
	RunEngine   string      `json:"runEngine"`
	Messages    []message   `json:"messages"`
	Plan        []planEntry `json:"plan"`
	Activity    struct {
		Lines []struct {
			ID    string `json:"id"`
			Kind  string `json:"kind"`
			Label string `json:"label"`
		} `json:"lines"`
	} `json:"activity"`
}

type planEntry struct {
	Tool    string `json:"tool"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
	Error   string `json:"error"`
}

type message struct {
	ID          string `json:"id"`
	Role        string `json:"role"`
	Kind        string `json:"kind"`
	Content     string `json:"content"`
	Proposal    bool   `json:"proposal"`
	AutoApplied bool   `json:"autoApplied"`
	Steps       []struct {
		Tool    string `json:"tool"`
		Summary string `json:"summary"`
		Status  string `json:"status"`
	} `json:"steps"`
}

func busy(status string) bool { return status == "queued" || status == "running" }

// Signup registers a disposable account, gives it a workspace, connects the
// provider and picks the engine. It returns the account email and why the
// engine is unavailable ("" when it can run).
func Signup(ctx context.Context, cfg Config, engine string) (*client, string, string, error) {
	c := &client{base: strings.TrimRight(cfg.API, "/"), http: &http.Client{Timeout: 60 * time.Second}}
	email := fmt.Sprintf("agentqa+%s-%d@example.invalid", engine, time.Now().UnixNano())
	var session struct {
		Token string `json:"token"`
	}
	if err := c.do(ctx, "POST", "/register", map[string]string{"name": "Agent QA", "email": email, "password": randomPassword()}, &session); err != nil {
		return nil, "", "", fmt.Errorf("sign up: %w", err)
	}
	if session.Token == "" {
		return nil, "", "", errors.New("sign up: no token in the answer")
	}
	c.token = session.Token
	if _, err := c.workspace(ctx); err != nil {
		return nil, "", "", err
	}
	keyBody := map[string]string{"key": cfg.Key}
	if cfg.Provider == "ollama" {
		// Ollama needs no key; the server's OLLAMA_BASE_URL is the address.
		keyBody = map[string]string{"key": "", "baseUrl": ""}
	}
	if hostCLI(cfg.Provider) {
		// Claude Code and Codex use the API host's own signed-in CLI: the
		// model is recorded first, then Connect tests it.
		if err := c.do(ctx, "PATCH", "/agent/providers", map[string]any{cfg.Provider + "Model": cfg.Model}, nil); err != nil {
			return nil, "", "", fmt.Errorf("%s model: %w", cfg.Provider, err)
		}
		if err := c.do(ctx, "POST", "/agent/providers/"+cfg.Provider+"/connect", nil, nil); err != nil {
			return nil, "", "", fmt.Errorf("connect provider %s: %w", cfg.Provider, err)
		}
		if err := c.do(ctx, "PATCH", "/agent/providers", map[string]any{"defaultProvider": cfg.Provider}, nil); err != nil {
			return nil, "", "", fmt.Errorf("default provider: %w", err)
		}
	} else {
		if err := c.do(ctx, "POST", "/agent/providers/"+cfg.Provider+"/key", keyBody, nil); err != nil {
			// The answer may quote the request; never print the key.
			return nil, "", "", fmt.Errorf("connect provider %s: %s", cfg.Provider, scrub(err.Error(), cfg.Key))
		}
		if err := c.do(ctx, "PATCH", "/agent/providers", map[string]any{"defaultProvider": cfg.Provider, "models": map[string]string{cfg.Provider: cfg.Model}}, nil); err != nil {
			return nil, "", "", fmt.Errorf("default provider: %s", scrub(err.Error(), cfg.Key))
		}
	}
	var settings struct {
		Engine          string `json:"engine"`
		EngineAvailable bool   `json:"engineAvailable"`
		EngineReason    string `json:"engineReason"`
	}
	if err := c.do(ctx, "PATCH", "/agent/chat-settings", map[string]any{"engine": engine, "chatPermission": cfg.Permission}, &settings); err != nil {
		return nil, "", "", fmt.Errorf("choose engine %s: %w", engine, err)
	}
	if settings.Engine != engine {
		return nil, "", "", fmt.Errorf("choose engine %s: settings say %q", engine, settings.Engine)
	}
	unavailable := ""
	if engine == "agent" && !settings.EngineAvailable {
		unavailable = settings.EngineReason
		if unavailable == "" {
			unavailable = "the agent engine is not available"
		}
	}
	return c, email, unavailable, nil
}

// RunEngine runs the scenarios on one engine, each in a fresh account of its
// own: sign-up, workspace, provider connection and engine choice per
// scenario. A shared account let one scenario's setup show up in the next
// one's data ("two Groceries sheets"), so both engines asked which one was
// meant. A sign-up that fails on the first scenario stops the run (the
// harness or the API is broken); a later one fails only that scenario.
func RunEngine(ctx context.Context, cfg Config, engine string, picked []Scenario) (EngineRun, error) {
	run := EngineRun{Engine: engine, API: cfg.API, Provider: cfg.Provider, Model: cfg.Model, Permission: cfg.Permission,
		Stub: cfg.Stub, Started: time.Now().UTC()}
	logf := cfg.Logf
	if logf == nil {
		logf = func(string, ...any) {}
	}
	logf("%s: %d scenarios, one fresh account each", engine, len(picked))
	for i, s := range picked {
		c, email, unavailable, err := Signup(ctx, cfg, engine)
		var r Result
		switch {
		case err != nil && i == 0:
			return run, err
		case err != nil:
			r = Result{ID: s.ID, Category: s.Category, Message: s.Message, Engine: engine, HarnessError: err.Error()}
			Score(s, &r)
		default:
			if unavailable != "" && run.Unavailable == "" {
				run.Unavailable = unavailable
				logf("%s: the engine is unavailable (%s); its runs will fail with Use classic", engine, unavailable)
			}
			r = RunScenario(ctx, cfg, c, engine, s)
		}
		r.Account = email
		run.Accounts++
		run.Results = append(run.Results, r)
		mark := "PASS"
		if !r.Pass {
			mark = "FAIL"
		}
		logf("%s %-14s %s %s (%.1f s, %s)", engine, s.ID, mark, outcome(r), r.Seconds, email)
		if ctx.Err() != nil {
			break
		}
	}
	run.Seconds = time.Since(run.Started).Seconds()
	return run, nil
}

// hostCLI reports a provider that is the API host's own CLI login.
func hostCLI(provider string) bool { return provider == "claude" || provider == "codex" }

func randomPassword() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "qa-" + hex.EncodeToString(b)
}

// scrub removes the key from text that may echo a request.
func scrub(text, key string) string {
	if key == "" || len(key) < 4 {
		return text
	}
	return strings.ReplaceAll(text, key, "[key]")
}

// workspace is the account's first workspace, made when there is none.
func (c *client) workspace(ctx context.Context) (string, error) {
	var list []map[string]any
	if err := c.do(ctx, "GET", "/workspaces", nil, &list); err != nil {
		return "", fmt.Errorf("workspaces: %w", err)
	}
	for _, w := range list {
		if id, ok := w["id"].(string); ok && id != "" {
			return id, nil
		}
	}
	var created map[string]any
	if err := c.do(ctx, "POST", "/workspaces", map[string]any{"name": "Home"}, &created); err != nil {
		return "", fmt.Errorf("create workspace: %w", err)
	}
	if id, ok := firstID(created); ok {
		return id, nil
	}
	return "", errors.New("create workspace: no id in the answer")
}

// RunScenario runs one scenario in a new chat.
func RunScenario(ctx context.Context, cfg Config, c *client, engine string, s Scenario) Result {
	start := time.Now()
	r := Result{ID: s.ID, Category: s.Category, Message: s.Message, Engine: engine}
	harness := func(err error) Result {
		r.HarnessError = err.Error()
		Score(s, &r)
		r.Seconds = time.Since(start).Seconds()
		return r
	}
	zone := time.UTC
	if s.Timezone != "" {
		zone, _ = time.LoadLocation(s.Timezone)
	}
	ws, err := c.workspace(ctx)
	if err != nil {
		return harness(err)
	}
	vars := Vars{Workspace: ws, Zone: zone, Now: time.Now(), Saved: map[string]any{}}
	for _, req := range s.Setup {
		if err := c.request(ctx, vars, req); err != nil {
			return harness(fmt.Errorf("setup: %w", err))
		}
	}
	text, err := vars.Expand(s.Message)
	if err != nil {
		return harness(err)
	}
	r.Message = text
	if cfg.Stub && s.Stub != "" {
		directive, err := vars.Expand(s.Stub)
		if err != nil {
			return harness(err)
		}
		if cfg.StubPhrases != "" {
			if err := addPhrase(cfg.StubPhrases, text, directive); err != nil {
				return harness(fmt.Errorf("stub phrases: %w", err))
			}
		} else {
			text += "\n\n" + directive
		}
	}
	var created conversation
	body := map[string]any{"content": text, "timezone": zone.String(), "client": "web", "permission": cfg.Permission}
	if err := c.do(ctx, "POST", "/chats", body, &created); err != nil {
		return harness(fmt.Errorf("send: %w", err))
	}
	r.ChatID = created.ID
	trace := &tracer{seen: map[string]bool{}}
	conv, err := c.wait(ctx, cfg, created.ID, trace)
	if err != nil {
		return harness(err)
	}
	r.TurnEngine = conv.RunEngine
	r.Proposal = latestProposal(conv)
	if r.Proposal != nil && conv.Status == "approval" && s.Approve {
		for _, req := range s.Between {
			if err := c.request(ctx, vars, req); err != nil {
				return harness(fmt.Errorf("between: %w", err))
			}
		}
		before := len(conv.Messages)
		if err := c.do(ctx, "POST", "/chats/"+created.ID+"/approve", map[string]any{"revision": conv.Revision}, nil); err != nil {
			return harness(fmt.Errorf("approve: %w", err))
		}
		r.Approved = true
		if conv, err = c.wait(ctx, cfg, created.ID, trace); err != nil {
			return harness(err)
		}
		r.AfterApprove = afterApprove(conv, before)
	}
	r.Status, r.Error, r.Action, r.RunEngine = conv.Status, conv.Error, conv.ErrorAction, conv.RunEngine
	for _, m := range conv.Messages {
		switch {
		case m.Role == "assistant" && !m.Proposal && m.Kind == "" && strings.TrimSpace(m.Content) != "":
			r.Replies = append(r.Replies, m.Content)
		case m.Kind == "notice":
			r.Notices = append(r.Notices, m.Content)
		}
	}
	for _, p := range conv.Plan {
		r.Plan = append(r.Plan, PlanStep{Tool: p.Tool, Summary: p.Summary, Status: p.Status, Error: p.Error})
	}
	r.Trace = trace.calls
	r.Seconds = time.Since(start).Seconds()
	Score(s, &r)
	return r
}

// request runs one setup call and keeps its answer under req.As.
func (c *client) request(ctx context.Context, vars Vars, req Request) error {
	path, err := vars.Expand(req.Path)
	if err != nil {
		return err
	}
	var body any
	if req.Body != nil {
		if body, err = vars.ExpandAny(req.Body); err != nil {
			return err
		}
	}
	var out any
	if err := c.do(ctx, req.Method, path, body, &out); err != nil {
		return err
	}
	if req.As != "" {
		vars.Saved[req.As] = out
	}
	return nil
}

// tracer collects the tool calls seen while a run is live.
type tracer struct {
	seen  map[string]bool
	calls []string
}

func (t *tracer) add(key, name string) {
	if key == "" || t.seen[key] {
		return
	}
	t.seen[key] = true
	t.calls = append(t.calls, name)
}

// wait polls the chat until its run ends, collecting the trace.
func (c *client) wait(ctx context.Context, cfg Config, id string, trace *tracer) (conversation, error) {
	deadline := time.Now().Add(cfg.Timeout)
	for {
		var conv conversation
		if err := c.do(ctx, "GET", "/chats/"+id, nil, &conv); err != nil {
			return conv, err
		}
		for _, line := range conv.Activity.Lines {
			if line.Kind == "tool" {
				trace.add("agent:"+line.ID, line.Label)
			}
		}
		if cfg.DB != nil && conv.RunEngine != "agent" {
			readTranscript(ctx, cfg.DB, id, trace)
		}
		if !busy(conv.Status) {
			return conv, nil
		}
		if time.Now().After(deadline) {
			_ = c.do(ctx, "POST", "/chats/"+id+"/stop", nil, nil)
			return conv, fmt.Errorf("still %s after %s (stopped)", conv.Status, cfg.Timeout)
		}
		select {
		case <-ctx.Done():
			return conv, ctx.Err()
		case <-time.After(cfg.Poll):
		}
	}
}

// readTranscript adds classic's tool calls from the transcript column, which
// the API does not expose and clears when the run ends (plan 5.4).
func readTranscript(ctx context.Context, db *sql.DB, id string, trace *tracer) {
	var raw []byte
	if err := db.QueryRowContext(ctx, "SELECT transcript FROM agent_conversations WHERE id = $1", id).Scan(&raw); err != nil {
		return
	}
	var wire []struct {
		ToolCalls []struct {
			ID       string `json:"id"`
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
		} `json:"tool_calls"`
	}
	if json.Unmarshal(raw, &wire) != nil {
		return
	}
	for _, m := range wire {
		for _, call := range m.ToolCalls {
			trace.add("classic:"+call.ID, call.Function.Name)
		}
	}
}

// latestProposal is the last proposal recorded in the chat. Its steps are
// the chat's plan (the proposal message carries only the summary).
func latestProposal(conv conversation) *Proposal {
	for i := len(conv.Messages) - 1; i >= 0; i-- {
		m := conv.Messages[i]
		if !m.Proposal {
			continue
		}
		p := &Proposal{Summary: m.Content, AutoApplied: m.AutoApplied, Held: !m.AutoApplied}
		for _, s := range m.Steps {
			p.Steps = append(p.Steps, PlanStep{Tool: s.Tool, Summary: s.Summary, Status: s.Status})
		}
		if len(p.Steps) == 0 {
			for _, s := range conv.Plan {
				p.Steps = append(p.Steps, PlanStep{Tool: s.Tool, Summary: s.Summary, Status: s.Status, Error: s.Error})
			}
		}
		return p
	}
	return nil
}

// addPhrase records message -> directive in the stub shim's phrase table.
func addPhrase(path, message, directive string) error {
	table := map[string]string{}
	if raw, err := os.ReadFile(path); err == nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, &table); err != nil {
			return err
		}
	}
	table[message] = directive
	raw, err := json.Marshal(table)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// afterApprove says how an approved proposal ended: every step done
// (applied), the data changed and the plan was made again (replanned, the
// archive and txtDataChanged notice), or failed.
func afterApprove(conv conversation, before int) string {
	later := conv.Messages
	if before <= len(later) {
		later = later[before:]
	}
	if slices.ContainsFunc(later, func(m message) bool { return m.Kind == "archive" }) {
		return "replanned"
	}
	if conv.Status == "failed" {
		return "failed"
	}
	if len(conv.Plan) > 0 && !slices.ContainsFunc(conv.Plan, func(p planEntry) bool {
		return p.Status != "done" && p.Status != "discarded"
	}) {
		return "applied"
	}
	return conv.Status
}
