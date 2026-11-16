package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/agenthost/agenthosttest"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/bots"
	"timely-api/internal/features/bots/botstest"
	"timely-api/internal/features/chat"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
	"timely-api/internal/utils"
)

// botChatModel plays back one response per model call, across runs, and
// keeps what each call was sent and offered.
type botChatModel struct {
	mu        sync.Mutex
	responses []chat.WireMessage
	seen      [][]chat.WireMessage
	tools     [][]string
}

func (m *botChatModel) Complete(_ context.Context, messages []chat.WireMessage, tools []any, _ bool) (chat.WireMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	names := []string{}
	for _, spec := range tools {
		fn, _ := spec.(map[string]any)["function"].(map[string]any)
		name, _ := fn["name"].(string)
		names = append(names, name)
	}
	m.seen = append(m.seen, append([]chat.WireMessage{}, messages...))
	m.tools = append(m.tools, names)
	if len(m.responses) == 0 {
		return chat.WireMessage{Role: "assistant", Content: "The script ran out."}, nil
	}
	next := m.responses[0]
	m.responses = m.responses[1:]
	return next, nil
}

// script queues responses and returns the index of the first call they answer.
func (m *botChatModel) script(responses ...chat.WireMessage) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.responses = append(m.responses, responses...)
	return len(m.seen)
}

func (m *botChatModel) calls(from int) ([][]chat.WireMessage, [][]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.seen[from:], m.tools[from:]
}

func toolCall(name string, args any) chat.WireMessage {
	raw, _ := json.Marshal(args)
	var tc chat.ToolCall
	tc.ID, tc.Type = "call_"+uuid.NewString()[:8], "function"
	tc.Function.Name, tc.Function.Arguments = name, string(raw)
	return chat.WireMessage{Role: "assistant", ToolCalls: []chat.ToolCall{tc}}
}

func proposeSteps(summary string, steps ...map[string]any) chat.WireMessage {
	list := []any{}
	for _, s := range steps {
		list = append(list, s)
	}
	return toolCall("propose_changes", map[string]any{"summary": summary, "direct": false, "language": "en", "reply": "", "remaining": "", "steps": list})
}

// botChat is the chat service on the real chat and rehearsal catalogs, with
// Bots on a fake network, serving its routes as uid. Chat turns run on the
// agent engine with the fake worker (agenthosttest), which replays the
// fixture script routes to each message.
type botChat struct {
	t        *testing.T
	db       *gorm.DB
	uid      string
	svc      *bots.Service
	kit      *agenthosttest.Kit
	e        *echo.Echo
	fixtures int
}

// fakeTool is a tool.call line of a fake worker fixture.
func fakeTool(name string, args any) map[string]any {
	return map[string]any{"type": "tool.call", "tool_call_id": "call_" + uuid.NewString()[:8], "name": name, "args": args,
		"batch_size": 1, "sibling_tools": []string{}, "tainted_sources": []any{}}
}

// fakePropose is a propose_changes tool.call with steps.
func fakePropose(summary string, steps ...map[string]any) map[string]any {
	list := []any{}
	for _, s := range steps {
		list = append(list, s)
	}
	return fakeTool("propose_changes", map[string]any{"summary": summary, "direct": false, "language": "en", "reply": "", "remaining": "", "steps": list})
}

// fakeReply is the run's streamed reply.
func fakeReply(text string) map[string]any {
	return map[string]any{"fake": "reply", "text": text, "chunk": 0}
}

// script routes the run of the next message containing text to a fixture of
// lines, and returns how many tool results the worker had received so far.
func (b *botChat) script(text string, lines ...map[string]any) int {
	b.t.Helper()
	var sb strings.Builder
	for _, l := range lines {
		raw, err := json.Marshal(l)
		if err != nil {
			b.t.Fatal(err)
		}
		sb.Write(raw)
		sb.WriteString("\n")
	}
	b.fixtures++
	name := fmt.Sprintf("f%d", b.fixtures)
	b.kit.Fixture(name, []byte(sb.String())).ForMessage(text, name)
	return len(b.kit.ReceivedOf("tool.result"))
}

// results are the tool results the worker received from index from on.
func (b *botChat) results(from int) []string {
	b.t.Helper()
	out := []string{}
	for _, r := range b.kit.ReceivedOf("tool.result")[from:] {
		var body struct {
			Result json.RawMessage `json:"result"`
		}
		if err := r.Decode(&body); err != nil {
			b.t.Fatal(err)
		}
		out = append(out, string(body.Result))
	}
	return out
}

// lastInput is the user_message of the latest run.start.
func (b *botChat) lastInput() string {
	b.t.Helper()
	starts := b.kit.ReceivedOf("run.start")
	if len(starts) == 0 {
		b.t.Fatal("no run.start")
	}
	var body struct {
		UserMessage string `json:"user_message"`
	}
	if err := starts[len(starts)-1].Decode(&body); err != nil {
		b.t.Fatal(err)
	}
	return body.UserMessage
}

func newBotChat(t *testing.T, replies map[string]botstest.Response) (*botChat, *realtime.Hub) {
	t.Helper()
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	db, uid := agentToolsDB(t)
	svc := bots.New(db, jobs.NewQueue(db))
	svc.SetFetcher(botstest.Net(replies))
	hub := realtime.NewHub()
	svc.SetLive(hub)
	catalog := func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, nil, nil, svc) }
	cs := chat.New(db, catalog, nil)
	cs.SetRehearsal(func(tx *gorm.DB) agent.Catalog { return rehearsalCatalog(tx, nil, svc) })
	cs.SetBotNames(chatBotNames(svc))
	kit := agenthosttest.New(t)
	engine := chat.NewWorkerEngine(cs, chat.WorkerEngineOptions{
		Model: func(context.Context, string, string, string, chat.RunModelOptions) (any, error) {
			return map[string]any{"provider": "custom", "model": "stub-model", "base_url": "http://127.0.0.1:9/v1", "api_key": "test", "api_mode": "chat_completions"}, nil
		},
		Logf: t.Logf,
	})
	cfg := kit.Config()
	cfg.Handler, cfg.OnExit = engine.Handle, engine.WorkerExited
	cfg.TimelyTools = func(context.Context) (string, json.RawMessage, error) {
		version, specs := chat.AgentToolSpecs(catalog(db))
		raw, err := json.Marshal(specs)
		return version, raw, err
	}
	sup := agenthost.New(cfg)
	engine.Attach(sup)
	cs.SetAgentEngine(engine)
	ctx, cancel := context.WithCancel(context.Background())
	relayDone := make(chan struct{})
	go func() { defer close(relayDone); svc.Relay(ctx) }()
	cs.Run(ctx)
	t.Cleanup(func() {
		cancel()
		cs.Wait()
		<-relayDone
		stop, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		_ = engine.Shutdown(stop)
		hub.Close()
	})
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", uid)
			return next(c)
		}
	})
	cs.Routes(e.Group(""))
	return &botChat{t: t, db: db, uid: uid, svc: svc, kit: kit, e: e}, hub
}

func (b *botChat) post(path string, body any) chat.Conversation {
	b.t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	b.e.ServeHTTP(rec, req)
	if rec.Code != 200 && rec.Code != 201 {
		b.t.Fatalf("POST %s: %d %s", path, rec.Code, rec.Body.String())
	}
	var c chat.Conversation
	if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil {
		b.t.Fatal(err)
	}
	return c
}

// settle waits for the run to stop working and returns the conversation.
func (b *botChat) settle(id string) chat.Conversation {
	b.t.Helper()
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		req := httptest.NewRequest("GET", "/chats/"+id, nil)
		rec := httptest.NewRecorder()
		b.e.ServeHTTP(rec, req)
		var c chat.Conversation
		if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil {
			b.t.Fatal(err)
		}
		if c.Status != "queued" && c.Status != "running" {
			if c.Status == "failed" {
				b.t.Fatalf("run failed: %s", c.Error)
			}
			return c
		}
	}
	b.t.Fatal("the run never finished")
	return chat.Conversation{}
}

func (b *botChat) count(table, where string, args ...any) int64 {
	b.t.Helper()
	var n int64
	if err := b.db.Table(table).Where(where, args...).Count(&n).Error; err != nil {
		b.t.Fatal(err)
	}
	return n
}

// check runs one scheduled check of a Bot, as a worker lane would.
func (b *botChat) check(botID string) {
	b.t.Helper()
	job := &models.Job{ID: utils.NewJobID(), UserID: b.uid, Kind: models.JobBotCheck, Attempts: 1, MaxAttempts: 2,
		Payload: models.JobPayload{"botId": botID, "trigger": bots.TriggerSchedule}}
	if err := b.svc.HandleCheck(context.Background(), job); err != nil {
		b.t.Fatal(err)
	}
}

func prompt(messages []chat.WireMessage) string {
	var sb strings.Builder
	for _, m := range messages {
		sb.WriteString(m.Content)
		sb.WriteString("\n")
	}
	return sb.String()
}

func toolResults(messages []chat.WireMessage) []string {
	out := []string{}
	for _, m := range messages {
		if m.Role == "tool" {
			out = append(out, m.Content)
		}
	}
	return out
}

func hasName(list []string, name string) bool {
	for _, x := range list {
		if x == name {
			return true
		}
	}
	return false
}

// listening makes sure the relay passes bot changes on before the test
// counts them: it touches a Bot until one arrives, then drains the rest.
func listening(t *testing.T, db *gorm.DB, events <-chan realtime.Event, botID string) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); ; {
		select {
		case <-events:
			for quiet := false; !quiet; {
				select {
				case <-events:
				case <-time.After(300 * time.Millisecond):
					quiet = true
				}
			}
			return
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatal("the bots relay never heard a change")
		}
		if err := db.Exec("UPDATE bots SET health_detail = ? WHERE id = ?", uuid.NewString(), botID).Error; err != nil {
			t.Fatal(err)
		}
	}
}

const chatFeedURL = "https://news.bot-chat.example/feed.xml"

// A bot described in chat: the model previews it and proposes it, the
// review card carries the live reading, the rehearsal leaves nothing behind,
// and approving makes an active Bot. Changing it keeps its review across a
// check. A message that tags it only answers, and the next one without a
// tag is a normal turn.
func TestIntegrationBotChatProposeApproveAndAsk(t *testing.T) {
	b, hub := newBotChat(t, map[string]botstest.Response{
		chatFeedURL: botstest.Feed(`<?xml version="1.0"?><rss version="2.0"><channel><title>Made-up news</title>` +
			`<item><guid>1</guid><title>Planted headline 7f3e</title><link>https://news.bot-chat.example/1</link></item></channel></rss>`),
	})
	ctx := context.Background()
	events, stop := hub.Subscribe(b.uid, "bots")
	defer stop()
	// An older paused Bot, made over MCP, lets the test know the relay hears.
	old, err := b.svc.Create(ctx, b.uid, bots.Input{Name: "BTC dip", Watches: []bots.WatchInput{{Kind: "price", Source: "crypto", Symbol: "BTC"}}}, bots.OriginMCP)
	if err != nil {
		t.Fatal(err)
	}
	listening(t, b.db, events, old.ID)

	// 1. Describe it: preview, then one create_bot.
	feed := map[string]any{"kind": "feed", "url": chatFeedURL}
	first := b.script("something new: "+chatFeedURL,
		fakeTool("preview_bot", map[string]any{"watches": []any{feed}}),
		fakePropose("Make a bot for the news feed", map[string]any{"tool": "create_bot", "summary": "Watch the news feed",
			"arguments": map[string]any{"name": "News feed", "description": "Tell me when the blog posts something new", "watches": []any{feed}, "intervalMinutes": 0}}),
		fakeReply("I drafted the bot."),
	)
	c := b.post("/chats", map[string]any{"content": "Tell me when the blog posts something new: " + chatFeedURL})
	c = b.settle(c.ID)
	if c.Status != "approval" || len(c.Plan) != 1 || c.Plan[0].Tool != "create_bot" {
		t.Fatalf("proposal: %s %+v", c.Status, c.Plan)
	}
	preview := string(c.Plan[0].Preview)
	if !strings.Contains(preview, `"watches"`) || !strings.Contains(preview, "Planted headline 7f3e") || strings.Contains(preview, "outsideData") || !strings.Contains(preview, `"ok":true`) {
		t.Fatalf("Step.Preview %s", preview)
	}
	var force bool
	b.db.Raw("SELECT force_review FROM agent_conversations WHERE id = ?", c.ID).Scan(&force)
	if !force {
		t.Error("a run that called preview_bot must force review")
	}
	if n := b.count("bots", "user_id = ?", b.uid); n != 1 {
		t.Errorf("%d bots before approval, want only the older one", n)
	}
	if n := b.count("jobs", "user_id = ? AND kind IN ?", b.uid, []string{models.JobBotIcon, models.JobBotCheck}); n != 0 {
		t.Errorf("%d bot jobs before approval: the rehearsal or preview left some", n)
	}
	select {
	case ev := <-events:
		t.Errorf("a bot change was sent before approval: %#v", ev)
	case <-time.After(time.Second):
	}
	if results := b.results(first); len(results) != 2 || !strings.Contains(results[0], "outsideData") {
		t.Fatalf("the model's preview: %v", results)
	}

	// 2. Approve: the Bot is on, made in chat.
	c = b.post("/chats/"+c.ID+"/approve", map[string]any{"revision": c.Revision})
	c = b.settle(c.ID)
	var made bots.Bot
	if err := b.db.Where("user_id = ? AND name = ?", b.uid, "News feed").First(&made).Error; err != nil {
		t.Fatalf("approved bot: %v (status %s)", err, c.Status)
	}
	if made.Status != bots.StatusActive || made.Origin != bots.OriginChat || made.PauseReason != nil {
		t.Fatalf("made %+v", made)
	}
	select {
	case <-events:
	case <-time.After(5 * time.Second):
		t.Error("approving sent no bot change")
	}

	// 3. Change it: get_bot, then update_bot. A check before the approval
	// leaves the review standing.
	b.script("Make it check every 6 hours",
		fakeTool("get_bot", map[string]any{"bot": made.ID}),
		fakePropose("Check every 6 hours", map[string]any{"tool": "update_bot", "summary": "Check every 6 hours",
			"arguments": map[string]any{"bot": made.ID, "intervalMinutes": 360}}),
		fakeReply("Drafted."),
	)
	c = b.post("/chats/"+c.ID+"/messages", map[string]any{"content": "Make it check every 6 hours"})
	c = b.settle(c.ID)
	if c.Status != "approval" || len(c.Plan) != 1 || c.Plan[0].Tool != "update_bot" || len(c.Plan[0].Before) == 0 || c.Plan[0].Preview != nil {
		t.Fatalf("update proposal: %s %+v", c.Status, c.Plan)
	}
	if text := b.lastInput(); strings.Contains(text, "Planted headline 7f3e") || strings.Contains(text, `"preview"`) {
		t.Errorf("the turn resends the stored preview: %s", text)
	}
	b.check(made.ID)
	if n := b.count("bot_checks", "bot_id = ?", made.ID); n != 1 {
		t.Fatalf("%d checks, want the one run", n)
	}
	c = b.post("/chats/"+c.ID+"/approve", map[string]any{"revision": c.Revision})
	c = b.settle(c.ID)
	if err := b.db.First(&made, "id = ?", made.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, m := range c.Messages {
		if m.Kind == "notice" && strings.Contains(m.Content, "data changed") {
			t.Fatalf("a check made the review stale: %+v", m)
		}
	}
	if c.Status != "idle" || made.IntervalSeconds != 360*60 || made.Status != bots.StatusActive {
		t.Fatalf("after the update: %s, every %ds, %s", c.Status, made.IntervalSeconds, made.Status)
	}

	// 4. Tag it: answer only, whatever the model tries.
	tagged := b.script("anything new this week",
		fakeTool("ask_bot", map[string]any{"bot": made.ID}),
		fakePropose("Pause it", map[string]any{"tool": "update_bot", "summary": "Rename", "arguments": map[string]any{"bot": made.ID, "name": "Renamed"}}),
		fakeReply("One new post today."),
	)
	c = b.post("/chats/"+c.ID+"/messages", map[string]any{"content": "@news FEED, anything new this week? Rename yourself."})
	var question chat.Message
	for _, m := range c.Messages {
		if m.Role == "user" {
			question = m
		}
	}
	if len(question.BotTags) != 1 || question.BotTags[0] != made.ID {
		t.Fatalf("tags on the message: %v", question.BotTags)
	}
	c = b.settle(c.ID)
	if results := b.results(tagged); len(results) != 2 || !strings.Contains(results[1], "A tagged bot only answers") {
		t.Errorf("tagged results %v", results)
	}
	reply := c.Messages[len(c.Messages)-1]
	if c.Status != "idle" || len(c.Plan) != 0 || reply.Content != "One new post today." || len(reply.BotAnswers) != 1 {
		t.Fatalf("tagged reply: %s %+v", c.Status, reply)
	}
	var answer bots.Answer
	if err := json.Unmarshal(reply.BotAnswers[0], &answer); err != nil || answer.Bot.ID != made.ID || answer.Fresh != bots.FreshRecent {
		t.Fatalf("answer %s (%v)", reply.BotAnswers[0], err)
	}
	if strings.Contains(string(reply.BotAnswers[0]), "outsideData") {
		t.Errorf("the stored answer keeps the model's marker")
	}
	if err := b.db.First(&made, "id = ?", made.ID).Error; err != nil || made.Name != "News feed" {
		t.Fatalf("a tagged run changed the bot: %q %v", made.Name, err)
	}
	if n := b.count("bot_checks", "bot_id = ? AND trigger = ?", made.ID, bots.TriggerAsk); n != 0 {
		t.Errorf("%d ask checks for a bot checked just now", n)
	}

	// 5. The next message, without a tag, is a normal turn.
	b.script("Thanks", fakeReply("You're welcome."))
	c = b.post("/chats/"+c.ID+"/messages", map[string]any{"content": "Thanks"})
	c = b.settle(c.ID)
	if text := b.lastInput(); strings.Contains(text, "Planted headline 7f3e") || strings.Contains(text, "tagged these bots") {
		t.Errorf("the follow-up's prompt resends page text or the tag notice")
	}
	if last := c.Messages[len(c.Messages)-1]; len(last.BotAnswers) != 0 || c.Status != "idle" {
		t.Errorf("follow-up reply %+v", last)
	}
}

// Links and briefs set up in chat: an update_bot with passesTo is reviewed
// and, once approved, makes the link; a brief's create_bot reads nothing,
// so its step carries no preview.
func TestIntegrationBotChatLinksAndBriefs(t *testing.T) {
	b, _ := newBotChat(t, map[string]botstest.Response{
		chatFeedURL: botstest.Feed(`<?xml version="1.0"?><rss version="2.0"><channel><title>GPU deals</title>` +
			`<item><guid>1</guid><title>2TB NVMe at a low price</title><link>https://news.bot-chat.example/1</link></item></channel></rss>`),
		"https://api.coinbase.com/v2/prices/BTC-USD/spot": botstest.JSON(`{"data":{"amount":"100.00","base":"BTC","currency":"USD"}}`),
	})
	ctx := context.Background()
	deals, err := b.svc.Create(ctx, b.uid, bots.Input{Name: "GPU deals", Watches: []bots.WatchInput{{Kind: "feed", URL: chatFeedURL}}}, bots.OriginApp)
	if err != nil {
		t.Fatal(err)
	}
	check, err := b.svc.Create(ctx, b.uid, bots.Input{Name: "Price check", Watches: []bots.WatchInput{{Kind: "price", Source: "crypto", Symbol: "BTC"}}}, bots.OriginApp)
	if err != nil {
		t.Fatal(err)
	}

	// 1. "When GPU deals finds 2TB NVMe, have Price check look first."
	b.script("have Price check look at it",
		fakeTool("get_bot", map[string]any{"bot": deals.ID}),
		fakeTool("get_bot", map[string]any{"bot": check.ID}),
		fakePropose("Pass NVMe deals to Price check", map[string]any{"tool": "update_bot", "summary": "Pass NVMe deals to Price check",
			"arguments": map[string]any{"bot": deals.ID, "passesTo": []any{map[string]any{"bot": "Price check", "filter": []any{"2TB NVMe"}}}}}),
		fakeReply("Drafted."),
	)
	c := b.post("/chats", map[string]any{"content": "When GPU deals finds something with 2TB NVMe in it, have Price check look at it before telling me"})
	c = b.settle(c.ID)
	if c.Status != "approval" || len(c.Plan) != 1 || c.Plan[0].Tool != "update_bot" || len(c.Plan[0].Before) == 0 || c.Plan[0].Preview != nil {
		t.Fatalf("link proposal: %s %+v", c.Status, c.Plan)
	}
	if !strings.Contains(string(c.Plan[0].Before), `"passesTo":[]`) {
		t.Errorf("the review's before has no empty passesTo: %s", c.Plan[0].Before)
	}
	if n := b.count("bot_links", "user_id = ?", b.uid); n != 0 {
		t.Fatalf("%d links before approval: the rehearsal left one", n)
	}
	c = b.post("/chats/"+c.ID+"/approve", map[string]any{"revision": c.Revision})
	c = b.settle(c.ID)
	var links []bots.Link
	if err := b.db.Where("user_id = ? AND kind = ?", b.uid, bots.LinkPass).Find(&links).Error; err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0].FromBotID != deals.ID || links[0].ToBotID != check.ID || len(links[0].Filter) != 1 || links[0].Filter[0] != "2TB NVMe" {
		t.Fatalf("after approval (%s): links %+v", c.Status, links)
	}

	// 2. "Make me a morning brief at 8 of both": no watches, no preview.
	b.script("Make me a morning brief", fakePropose("Make a morning brief", map[string]any{"tool": "create_bot", "summary": "Morning brief",
		"arguments": map[string]any{"name": "Morning brief", "kind": "brief", "watches": []any{}, "sources": []any{"GPU deals", "Price check"}, "briefTime": "08:00"}}),
		fakeReply("Drafted."))
	c = b.post("/chats/"+c.ID+"/messages", map[string]any{"content": "Make me a morning brief at 8 of GPU deals and Price check"})
	c = b.settle(c.ID)
	if c.Status != "approval" || len(c.Plan) != 1 || c.Plan[0].Tool != "create_bot" || c.Plan[0].Preview != nil {
		t.Fatalf("brief proposal: %s %+v", c.Status, c.Plan)
	}
	c = b.post("/chats/"+c.ID+"/approve", map[string]any{"revision": c.Revision})
	c = b.settle(c.ID)
	var brief bots.Bot
	if err := b.db.Where("user_id = ? AND name = ?", b.uid, "Morning brief").First(&brief).Error; err != nil {
		t.Fatalf("approved brief: %v (status %s)", err, c.Status)
	}
	if brief.Kind != bots.KindBrief || brief.BriefTime != "08:00" || brief.Status != bots.StatusActive {
		t.Fatalf("brief %+v", brief)
	}
	if n := b.count("bot_links", "user_id = ? AND kind = ? AND to_bot_id = ?", b.uid, bots.LinkBrief, brief.ID); n != 2 {
		t.Errorf("%d brief links, want 2", n)
	}
	if n := b.count("bot_watches", "bot_id = ?", brief.ID); n != 0 {
		t.Errorf("the brief has %d watches", n)
	}
}
