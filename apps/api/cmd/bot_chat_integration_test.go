package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
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
// Bots on a fake network, serving its routes as uid.
type botChat struct {
	t     *testing.T
	db    *gorm.DB
	uid   string
	svc   *bots.Service
	model *botChatModel
	e     *echo.Echo
}

func newBotChat(t *testing.T, replies map[string]botstest.Response) (*botChat, *realtime.Hub) {
	t.Helper()
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	db, uid := agentToolsDB(t)
	svc := bots.New(db, jobs.NewQueue(db))
	svc.SetFetcher(botstest.Net(replies))
	hub := realtime.NewHub()
	svc.SetLive(hub)
	model := &botChatModel{}
	cs := chat.New(db, func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, nil, nil, svc) }, model)
	cs.SetRehearsal(func(tx *gorm.DB) agent.Catalog { return rehearsalCatalog(tx, nil, svc) })
	cs.SetBotNames(chatBotNames(svc))
	ctx, cancel := context.WithCancel(context.Background())
	relayDone := make(chan struct{})
	go func() { defer close(relayDone); svc.Relay(ctx) }()
	cs.Run(ctx)
	t.Cleanup(func() { cancel(); cs.Wait(); <-relayDone; hub.Close() })
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", uid)
			return next(c)
		}
	})
	cs.Routes(e.Group(""))
	return &botChat{t: t, db: db, uid: uid, svc: svc, model: model, e: e}, hub
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
	first := b.model.script(
		toolCall("preview_bot", map[string]any{"watches": []any{feed}}),
		proposeSteps("Make a bot for the news feed", map[string]any{"tool": "create_bot", "summary": "Watch the news feed",
			"arguments": map[string]any{"name": "News feed", "description": "Tell me when the blog posts something new", "watches": []any{feed}, "intervalMinutes": 0}}),
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
	seen, _ := b.model.calls(first)
	if len(seen) != 2 || !strings.Contains(toolResults(seen[1])[0], "outsideData") {
		t.Fatalf("the model's preview: %d calls", len(seen))
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
	next := b.model.script(
		toolCall("get_bot", map[string]any{"bot": made.ID}),
		proposeSteps("Check every 6 hours", map[string]any{"tool": "update_bot", "summary": "Check every 6 hours",
			"arguments": map[string]any{"bot": made.ID, "intervalMinutes": 360}}),
	)
	c = b.post("/chats/"+c.ID+"/messages", map[string]any{"content": "Make it check every 6 hours"})
	c = b.settle(c.ID)
	if c.Status != "approval" || len(c.Plan) != 1 || c.Plan[0].Tool != "update_bot" || len(c.Plan[0].Before) == 0 || c.Plan[0].Preview != nil {
		t.Fatalf("update proposal: %s %+v", c.Status, c.Plan)
	}
	seen, _ = b.model.calls(next)
	for i, call := range seen {
		if text := prompt(call); strings.Contains(text, "Planted headline 7f3e") || strings.Contains(text, `"preview"`) {
			t.Errorf("call %d resends the stored preview", i)
		}
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
	tagged := b.model.script(
		toolCall("ask_bot", map[string]any{"bot": made.ID}),
		proposeSteps("Pause it", map[string]any{"tool": "update_bot", "summary": "Rename", "arguments": map[string]any{"bot": made.ID, "name": "Renamed"}}),
		chat.WireMessage{Role: "assistant", Content: "One new post today."},
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
	seen, offered := b.model.calls(tagged)
	if len(seen) != 3 {
		t.Fatalf("%d calls in the tagged run", len(seen))
	}
	for i, tools := range offered {
		if hasName(tools, "propose_changes") || hasName(tools, "web_search") || !hasName(tools, "ask_bot") {
			t.Errorf("tagged call %d offers %v", i, tools)
		}
	}
	if results := toolResults(seen[2]); len(results) != 2 || !strings.Contains(results[1], "A tagged bot only answers") {
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
	normal := b.model.script(chat.WireMessage{Role: "assistant", Content: "You're welcome."})
	c = b.post("/chats/"+c.ID+"/messages", map[string]any{"content": "Thanks"})
	c = b.settle(c.ID)
	seen, offered = b.model.calls(normal)
	if len(offered) != 1 || !hasName(offered[0], "propose_changes") {
		t.Fatalf("a follow-up without a tag offers %v", offered)
	}
	if text := prompt(seen[0]); strings.Contains(text, "Planted headline 7f3e") || strings.Contains(text, "tagged these bots") {
		t.Errorf("the follow-up's prompt resends page text or the tag notice")
	}
	if last := c.Messages[len(c.Messages)-1]; len(last.BotAnswers) != 0 || c.Status != "idle" {
		t.Errorf("follow-up reply %+v", last)
	}
}
