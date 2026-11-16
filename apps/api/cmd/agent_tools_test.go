package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/bots"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/provider"
	"timely-api/internal/features/suggest"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

func TestIntegrationListFocusSessions(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})
	read := call("create_task", map[string]any{"name": "Read", "workspaceId": ws["id"]})["task"].(map[string]any)["id"].(string)
	write := call("create_task", map[string]any{"name": "Write", "workspaceId": ws["id"]})["task"].(map[string]any)["id"].(string)
	at := func(day string, hour int) time.Time {
		d, _ := time.Parse("2006-01-02", day)
		return d.Add(time.Duration(hour) * time.Hour)
	}
	for _, s := range []models.FocusSession{
		{UserID: uid, TaskID: &read, TaskName: "Read", StartedAt: at("2026-10-05", 9), EndedAt: at("2026-10-05", 10), Minutes: 60},
		{UserID: uid, TaskID: &write, TaskName: "Write", StartedAt: at("2026-10-06", 23), EndedAt: at("2026-10-06", 23).Add(45 * time.Minute), Minutes: 45},
		{UserID: uid, TaskID: &read, TaskName: "Read", StartedAt: at("2026-10-07", 9), EndedAt: at("2026-10-07", 9).Add(30 * time.Minute), Minutes: 30},
	} {
		if err := db.Create(&s).Error; err != nil {
			t.Fatal(err)
		}
	}
	week := call("list_focus_sessions", map[string]any{"from": "2026-10-05", "to": "2026-10-06", "timezone": "UTC"})
	if sessions := week["sessions"].([]any); len(sessions) != 2 || week["minutes"] != float64(105) {
		t.Fatalf("both days are included and the 7th is not: %v", week)
	}
	one := call("list_focus_sessions", map[string]any{"from": "2026-10-01", "to": "2026-10-31", "taskId": read, "timezone": "UTC"})
	if sessions := one["sessions"].([]any); len(sessions) != 2 || one["minutes"] != float64(90) {
		t.Fatalf("taskId keeps only that task's sessions: %v", one)
	}
}

func TestIntegrationDocHistoryDailyNotesAndBacklinks(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})

	first := call("open_daily_note", map[string]any{"date": "2026-10-19"})
	again := call("open_daily_note", map[string]any{"date": "2026-10-19"})
	if first["created"] != true || again["created"] != false || again["id"] != first["id"] || first["title"] != "2026-10-19" {
		t.Fatalf("one daily note per day: %v then %v", first, again)
	}

	plan := call("create_doc", map[string]any{"title": "Plan", "markdown": "First draft", "workspaceId": ws["id"]})
	call("update_doc", map[string]any{"docId": plan["id"], "markdown": "Second draft"})
	versions := call("list_doc_versions", map[string]any{"docId": plan["id"]})["versions"].([]any)
	var older string
	for _, v := range versions {
		if v.(map[string]any)["current"] != true {
			older = v.(map[string]any)["id"].(string)
		}
	}
	if len(versions) < 2 || older == "" {
		t.Fatalf("the first draft is kept as an older version: %v", versions)
	}
	restored := call("restore_doc_version", map[string]any{"docId": plan["id"], "versionId": older})
	if !strings.Contains(restored["markdown"].(string), "First draft") {
		t.Fatalf("restore puts the first draft back: %v", restored["markdown"])
	}
	if doc := call("get_doc", map[string]any{"docId": plan["id"]}); !strings.Contains(doc["markdown"].(string), "First draft") {
		t.Fatalf("the restored draft is what the doc reads: %v", doc["markdown"])
	}

	notes := call("create_doc", map[string]any{"title": "Notes", "markdown": "Follow the [[Plan]] closely", "workspaceId": ws["id"]})
	links := call("get_doc_backlinks", map[string]any{"docId": plan["id"]})["backlinks"].([]any)
	if len(links) != 1 || links[0].(map[string]any)["id"] != notes["id"] {
		t.Fatalf("Notes links to Plan: %v", links)
	}
	if none := call("get_doc_backlinks", map[string]any{"docId": notes["id"]})["backlinks"].([]any); len(none) != 0 {
		t.Fatalf("nothing links to Notes: %v", none)
	}
}

// staleJev calls every stale task blocked.
func staleJev(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		answers := map[string]any{}
		for id := range req.Questions {
			answers[id] = map[string]any{"type": "choice", "choice": "blocked", "confidence": 0.95}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": answers, "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestIntegrationSuggestionTools(t *testing.T) {
	db, uid := agentToolsDB(t)
	defer func(old *suggest.Service) { todaySuggestions = old }(todaySuggestions)
	ws := agentToolCaller(t, db, uid)("create_workspace", map[string]any{"name": "Personal"})["id"].(string)
	old := time.Now().AddDate(0, 0, -40).Format("2006-01-02")
	stale := "tsk_renew_passport"
	if err := db.Create(&models.Task{ID: stale, Name: "Renew passport", UserID: &uid, WorkspaceID: &ws, Kind: models.KindTask}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.Task{}).Where("id = ?", stale).UpdateColumns(map[string]any{"created_at": old, "updated_at": old}).Error; err != nil {
		t.Fatal(err)
	}

	todaySuggestions = nil
	for _, name := range []string{"list_stale_work", "get_today_suggestions"} {
		if _, err := chatCatalog(db, nil, nil, nil)[name].Call(context.Background(), uid, json.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "not available") {
			t.Fatalf("%s without the service: %v", name, err)
		}
	}

	client := decide.NewClient(nil)
	client.TypeSafeURL = staleJev(t).URL
	keys := decide.Keys{TypeSafe: "ts-test-key-123"}
	todaySuggestions = suggest.New(db, decide.New(db, func(context.Context, string) (decide.Keys, error) { return keys, nil }, client), nil)
	call := agentToolCaller(t, db, uid)
	for _, name := range []string{"list_stale_work", "get_today_suggestions"} {
		if out := call(name, map[string]any{}); out["available"] == true {
			t.Fatalf("%s with smart suggestions off: %v", name, out)
		}
	}

	keys.Enabled = true
	work := call("list_stale_work", map[string]any{})
	tasks := work["tasks"].([]any)
	if work["available"] != true || len(tasks) != 1 {
		t.Fatalf("one stale task: %v", work)
	}
	if got := tasks[0].(map[string]any); got["id"] != stale || got["verdict"] != "blocked" || got["idleDays"].(float64) < 39 {
		t.Fatalf("stale task with its idle days and verdict: %v", got)
	}
}

func TestIntegrationTriageAndDeleteNotifications(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})
	due := time.Now().AddDate(0, 0, -3).Format("2006-01-02")
	taskID := call("create_task", map[string]any{"name": "File taxes", "workspaceId": ws["id"], "deadline": due, "priorityLevel": "High"})["task"].(map[string]any)["id"].(string)
	entity := "task"
	for _, id := range []string{"ntf_overdue", "ntf_other"} {
		n := models.Notification{ID: id, UserID: uid, Category: models.NotifyOverdue, Title: "File taxes is overdue", EntityType: &entity, EntityID: &taskID, Data: models.JobPayload{"taskId": taskID}, CreatedAt: time.Now()}
		if err := db.Create(&n).Error; err != nil {
			t.Fatal(err)
		}
	}

	if out := call("triage_notification", map[string]any{"notificationId": "ntf_overdue", "action": "lower"}); !strings.Contains(out["message"].(string), "Medium") {
		t.Fatalf("lower takes High to Medium: %v", out)
	}
	if got := call("get_task", map[string]any{"taskId": taskID})["task"].(map[string]any)["priorityLevel"]; got != "Medium" {
		t.Fatalf("the task's priority after triage: %v", got)
	}
	for _, n := range call("list_notifications", map[string]any{"unread": true})["items"].([]any) {
		if n.(map[string]any)["id"] == "ntf_overdue" {
			t.Fatal("a triaged notification is read")
		}
	}
	if _, err := chatCatalog(db, nil, nil, nil)["triage_notification"].Call(context.Background(), uid, json.RawMessage(`{"notificationId":"ntf_overdue","action":"shrug"}`)); err == nil {
		t.Fatal("an unknown step was accepted")
	}

	call("delete_notification", map[string]any{"notificationId": "ntf_overdue"})
	left := call("list_notifications", map[string]any{})["items"].([]any)
	if len(left) != 1 || left[0].(map[string]any)["id"] != "ntf_other" {
		t.Fatalf("only the other notification is left: %v", left)
	}
	if _, err := chatCatalog(db, nil, nil, nil)["delete_notification"].Call(context.Background(), uid, json.RawMessage(`{"notificationId":"ntf_overdue"}`)); err == nil {
		t.Fatal("deleting it twice succeeded")
	}
}

func TestIntegrationAddLiveBlock(t *testing.T) {
	db, uid := agentToolsDB(t)
	var asked []string
	liveBlockWriter = func(_ context.Context, _ string, words, current, today string) (string, error) {
		if _, err := time.Parse("2006-01-02", today); err != nil {
			t.Fatalf("today is a date: %q", today)
		}
		asked = append(asked, words+" | "+current)
		if current != "" {
			return strings.Replace(current, `[list]`, `[list, chart]`, 1) + "\nchart = BarChart(\"Done per day\", done.labels, done.values)\ndone = @Data({source: \"tasks\", state: \"done\", by: \"day\"})", nil
		}
		return "root = Panel(\"Open work\", [list])\nopen = @Data({source: \"tasks\", limit: 5})\nlist = List(@Each(open.rows, \"t\", TaskRow(t.id, t.title, t.day, t.note)), \"Nothing open\")", nil
	}
	t.Cleanup(func() { liveBlockWriter = nil })
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})
	plan := call("create_doc", map[string]any{"title": "Plan", "markdown": "# Plan\n\nIntro.", "workspaceId": ws["id"]})

	call("add_live_block", map[string]any{"docId": plan["id"], "words": "my open work"})
	got := call("get_doc", map[string]any{"docId": plan["id"]})["markdown"].(string)
	if !strings.Contains(got, "Intro.\n\n```openui-lang\nroot = Panel(\"Open work\", [list])") || !strings.HasSuffix(strings.TrimSpace(got), "```") {
		t.Fatalf("the block is appended as an openui-lang fence:\n%s", got)
	}

	call("add_live_block", map[string]any{"docId": plan["id"], "words": "add a chart by day", "block": 1})
	got = call("get_doc", map[string]any{"docId": plan["id"]})["markdown"].(string)
	if strings.Count(got, "```openui-lang") != 1 || !strings.Contains(got, "[list, chart]") || !strings.Contains(got, "BarChart(") {
		t.Fatalf("block 1 is changed in place, not added again:\n%s", got)
	}
	if len(asked) != 2 || !strings.HasPrefix(asked[1], "add a chart by day | root = Panel(\"Open work\"") {
		t.Fatalf("the change is asked with the block's current program: %q", asked)
	}

	raw, _ := json.Marshal(map[string]any{"docId": plan["id"], "words": "x", "block": 2})
	if _, err := chatCatalog(db, nil, nil, nil)["add_live_block"].Call(context.Background(), uid, raw); err == nil || !strings.Contains(err.Error(), "from 1 to 1") {
		t.Fatalf("a block the doc doesn't have is refused: %v", err)
	}
}

// modelMustNotRun stands in for a chat run's model and fails on any call.
type modelMustNotRun struct{ t *testing.T }

func (m modelMustNotRun) Complete(context.Context, []chat.WireMessage, []any, bool) (chat.WireMessage, error) {
	m.t.Fatal("the rehearsal called the run's model")
	return chat.WireMessage{}, nil
}

// A proposal is rehearsed in a rolled-back transaction and then applied; only
// the apply asks the AI for the live block's program.
func TestIntegrationProposedLiveBlockIsWrittenOnce(t *testing.T) {
	db, uid := agentToolsDB(t)
	var asked []string
	liveBlockWriter = func(_ context.Context, _ string, words, current, _ string) (string, error) {
		asked = append(asked, words)
		return "root = Panel(\"Open work\", [list])\nlist = List([])", nil
	}
	var rehearse provider.Service
	liveBlockRehearsal = rehearse.RehearseLiveBlock
	t.Cleanup(func() { liveBlockWriter, liveBlockRehearsal = nil, nil })
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})
	plan := call("create_doc", map[string]any{"title": "Plan", "markdown": "# Plan\n\nIntro.", "workspaceId": ws["id"]})
	args, _ := json.Marshal(map[string]any{"docId": plan["id"], "words": "my open work"})
	// The run's own model is on the context, as in a chat run.
	ctx := chat.WithCompleter(context.Background(), modelMustNotRun{t})

	rollback := errors.New("rehearsal rolled back")
	err := db.Transaction(func(tx *gorm.DB) error {
		out, err := rehearsalCatalog(tx, nil, nil)["add_live_block"].Call(ctx, uid, args)
		if err != nil {
			return err
		}
		if raw, _ := json.Marshal(out); !strings.Contains(string(raw), "Plan") {
			t.Fatalf("the rehearsal answers with the doc for later steps: %s", raw)
		}
		return rollback
	})
	if err != rollback {
		t.Fatalf("rehearsal: %v", err)
	}
	if len(asked) != 0 {
		t.Fatalf("the rehearsal asked the AI for the block: %q", asked)
	}
	if got := call("get_doc", map[string]any{"docId": plan["id"]})["markdown"].(string); strings.Contains(got, "openui-lang") {
		t.Fatalf("the rehearsal's block was rolled back:\n%s", got)
	}

	if _, err := chatCatalog(db, nil, nil, nil)["add_live_block"].Call(ctx, uid, args); err != nil {
		t.Fatal(err)
	}
	got := call("get_doc", map[string]any{"docId": plan["id"]})["markdown"].(string)
	if len(asked) != 1 || !strings.Contains(got, "Panel(\"Open work\"") || strings.Contains(got, "Live block") {
		t.Fatalf("the apply writes the block once, with the AI's program: %q\n%s", asked, got)
	}
}

// threadStack is the chat service with Bot threads on the real Bots service,
// serving its routes as uid, and a stub model it asks.
type threadStack struct {
	t     *testing.T
	db    *gorm.DB
	uid   string
	svc   *bots.Service
	cs    *chat.Service
	model *botChatModel
	e     *echo.Echo
}

func newThreadStack(t *testing.T) *threadStack {
	t.Helper()
	db, uid := agentToolsDB(t)
	svc := bots.New(db, jobs.NewQueue(db))
	model := &botChatModel{}
	cs := chat.New(db, func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, nil, nil, svc) }, model)
	wireBotThreads(db, cs, svc, nil)
	if svc.Slots() != bots.AgentCheckSlots {
		t.Fatalf("agent ticks run %d at once, want %d", svc.Slots(), bots.AgentCheckSlots)
	}
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", uid); return next(c) }
	})
	cs.Routes(e.Group(""))
	t.Cleanup(cs.Wait)
	return &threadStack{t: t, db: db, uid: uid, svc: svc, cs: cs, model: model, e: e}
}

func (s *threadStack) do(method, path string, body any) (int, []byte) {
	s.t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.e.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func (s *threadStack) view(id string) chat.ThreadView {
	s.t.Helper()
	code, body := s.do("GET", "/chat/bot-threads/"+id, nil)
	var view chat.ThreadView
	if code != 200 || json.Unmarshal(body, &view) != nil {
		s.t.Fatalf("thread %d %s", code, body)
	}
	return view
}

// say sends a message to a thread and waits for its turn to end.
func (s *threadStack) say(cid, text string) {
	s.t.Helper()
	if code, body := s.do("POST", "/chats/"+cid+"/messages", map[string]any{"content": text, "requestId": uuid.NewString()}); code != 200 {
		s.t.Fatalf("send %d %s", code, body)
	}
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(25 * time.Millisecond) {
		if len(s.view(cid).Thread.Activity.Lines) == 0 {
			return
		}
	}
	s.t.Fatal("the turn did not finish")
}

func threadLines(v chat.ThreadView, kind string) []chat.ThreadItem {
	var out []chat.ThreadItem
	for _, it := range v.Items {
		if it.Kind == kind {
			out = append(out, it)
		}
	}
	return out
}

// On the real Bots service: "only alert under 85000" changes the Bot at once
// with "Changed: X -> Y" and a working Undo, "also check <site> in my browser"
// waits for one tap, a history question reads and writes nothing, and a new
// Bot is drafted, shown whole and made by one Create.
func TestIntegrationBotThreadOnTheRealBots(t *testing.T) {
	s := newThreadStack(t)
	ctx := context.Background()
	prompt, every := "Alert me when the Pixel is under 90000", json.RawMessage(`"every 6h"`)
	made, err := s.svc.Create(ctx, s.uid, bots.Input{Name: "Pixel", AgentInput: bots.AgentInput{Prompt: &prompt, Schedule: every}}, bots.OriginChat)
	if err != nil {
		t.Fatal(err)
	}
	thread := s.view(made.ID)
	cid := thread.Thread.ID
	if thread.Thread.Kind != chat.KindBotThread || thread.Thread.BotID == nil || *thread.Thread.BotID != made.ID {
		t.Fatalf("thread %+v", thread.Thread.Kind)
	}
	promptNow := func() string {
		d, err := s.svc.Get(ctx, s.uid, made.ID)
		if err != nil {
			t.Fatal(err)
		}
		return d.Prompt
	}

	// 1. Changed at once, with Undo.
	s.model.script(
		toolCall("change_bot", map[string]any{"patch": map[string]any{"prompt": "Alert me when the Pixel is under 85000"}, "from": "alert under 90000", "to": "85000"}),
		chat.WireMessage{Role: "assistant", Content: "Done."})
	s.say(cid, "only alert under 85000")
	if promptNow() != "Alert me when the Pixel is under 85000" {
		t.Fatalf("prompt %q", promptNow())
	}
	v := s.view(cid)
	changes := threadLines(v, "change")
	if len(changes) != 1 || changes[0].Before != "alert under 90000" || changes[0].After != "85000" {
		t.Fatalf("changes %+v", changes)
	}
	var reply string
	for _, m := range v.Thread.Messages {
		if m.Kind == "bot_change" {
			reply = m.Content
		}
	}
	if reply != "Changed: alert under 90000 -> 85000" {
		t.Fatalf("reply %q", reply)
	}
	if code, body := s.do("POST", "/chat/bot-threads/"+cid+"/undo", map[string]any{"undoToken": changes[0].UndoToken}); code != 200 || promptNow() != prompt {
		t.Fatalf("undo %d %s, prompt %q", code, body, promptNow())
	}
	// Without the model's own words, the line shows the words that moved.
	s.model.script(
		toolCall("change_bot", map[string]any{"patch": map[string]any{"prompt": "Alert me when the Pixel is under 80000"}}),
		chat.WireMessage{Role: "assistant", Content: "Done."})
	s.say(cid, "make it 80000")
	if got := threadLines(s.view(cid), "change"); len(got) != 2 || got[1].Before != `prompt "...Pixel is under 90000"` || got[1].After != `prompt "...Pixel is under 80000"` {
		t.Fatalf("changes %+v", got)
	}

	// 2. A new signed-in site waits for one tap.
	s.model.script(
		toolCall("change_bot", map[string]any{"patch": map[string]any{"tools": map[string]any{"browserSites": []string{"flipkart.com"}}}}),
		chat.WireMessage{Role: "assistant", Content: "Tap to allow it."})
	s.say(cid, "also check flipkart.com in my browser")
	sites := func() []string {
		d, _ := s.svc.Get(ctx, s.uid, made.ID)
		return d.Tools.BrowserSites
	}
	pending := threadLines(s.view(cid), "pending_change")
	if len(pending) != 1 || pending[0].Reason != bots.WidenBrowserSite || len(sites()) != 0 {
		t.Fatalf("pending %+v, sites %v", pending, sites())
	}
	if code, body := s.do("POST", "/chat/bot-threads/"+cid+"/pending/"+pending[0].ID, map[string]any{"action": "approve"}); code != 200 {
		t.Fatalf("tap %d %s", code, body)
	}
	if got := sites(); len(got) != 1 || got[0] != "flipkart.com" {
		t.Fatalf("the site was not granted: %v", got)
	}

	// 3. A history question reads and writes nothing; every call the model
	// makes beyond the thread's tools is refused.
	from := s.model.script(
		toolCall("bot_history", map[string]any{"kind": "all"}),
		toolCall("create_task", map[string]any{"name": "x"}),
		chat.WireMessage{Role: "assistant", Content: "It has not alerted yet."})
	s.say(cid, "why did you alert yesterday?")
	_, offered := s.model.calls(from)
	for _, names := range offered {
		if strings.Join(names, ",") != strings.Join(chat.BotThreadToolNames(false), ",") {
			t.Fatalf("offered %v", names)
		}
	}
	var n int64
	s.db.Raw("SELECT count(*) FROM tasks WHERE user_id = ?", s.uid).Scan(&n)
	if n != 0 {
		t.Fatalf("a write happened: %d tasks", n)
	}

	// 4. A new Bot is drafted, shown whole, and made by one Create.
	code, body := s.do("POST", "/chat/bot-threads", map[string]any{})
	var draft chat.ThreadView
	if code != 201 || json.Unmarshal(body, &draft) != nil {
		t.Fatalf("draft %d %s", code, body)
	}
	s.model.script(
		toolCall("create_bot_draft", map[string]any{"setup": map[string]any{
			"name": "Pixel price", "prompt": "Tell me when the Pixel is under 85000", "schedule": "every 6h",
			"watches": []any{map[string]any{"kind": "page", "url": "https://shop.example/pixel", "read": "product_price"}},
		}}),
		chat.WireMessage{Role: "assistant", Content: "Read it over and tap Create."})
	s.say(draft.Thread.ID, "make it check every 6 hours")
	if got := threadLines(s.view(draft.Thread.ID), "draft_setup"); len(got) != 1 {
		t.Fatalf("the draft shows no setup: %+v", got)
	}
	code, body = s.do("POST", "/chat/bot-threads/"+draft.Thread.ID+"/create", map[string]any{})
	var created struct {
		BotID string `json:"botId"`
	}
	if code != 201 || json.Unmarshal(body, &created) != nil || created.BotID == "" {
		t.Fatalf("create %d %s", code, body)
	}
	d, err := s.svc.Get(ctx, s.uid, created.BotID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Engine != bots.EngineAgent || d.Permission != bots.PermissionAuto || d.Gate != bots.GateChanged || d.ThreadID != draft.Thread.ID || len(d.Watches) != 1 {
		t.Fatalf("the new Bot: engine %s permission %s gate %s thread %s reads %d", d.Engine, d.Permission, d.Gate, d.ThreadID, len(d.Watches))
	}
	if code, _ := s.do("POST", "/chat/bot-threads/"+draft.Thread.ID+"/create", map[string]any{}); code != 201 {
		t.Fatalf("a second Create gave %d", code)
	}
	if list, err := s.svc.List(ctx, s.uid); err != nil || len(list.Bots) != 2 {
		t.Fatalf("a second Create must not make a third Bot: %v", err)
	}
}
