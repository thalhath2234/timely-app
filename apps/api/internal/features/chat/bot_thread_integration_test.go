package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/features/bots"
)

// ---------------------------------------------------------------- stubs

// threadModel is the stub model a Bot thread's turn asks: a script of replies,
// one per call, recording the tools it was offered.
type stubThreadModel struct {
	mu      sync.Mutex
	script  []WireMessage
	calls   int
	offered [][]string
	wires   [][]WireMessage
}

func (m *stubThreadModel) Complete(_ context.Context, wire []WireMessage, tools []any, _ bool) (WireMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	names := []string{}
	for _, def := range tools {
		names = append(names, def.(map[string]any)["function"].(map[string]any)["name"].(string))
	}
	m.offered = append(m.offered, names)
	m.wires = append(m.wires, wire)
	if m.calls >= len(m.script) {
		return WireMessage{Role: "assistant", Content: "Done."}, nil
	}
	m.calls++
	return m.script[m.calls-1], nil
}

func threadCall(name string, args any) WireMessage {
	var tc ToolCall
	tc.ID, tc.Type = id("call_"), "function"
	tc.Function.Name, tc.Function.Arguments = name, string(raw(args))
	return WireMessage{Role: "assistant", ToolCalls: []ToolCall{tc}}
}

func threadSay(text string) WireMessage { return WireMessage{Role: "assistant", Content: text} }

// fakeThreadBots is one agent Bot in memory, with the real widening rule.
type fakeThreadBots struct {
	mu          sync.Mutex
	prompt      string
	permission  string
	sites       []string
	memory      bool
	changes     int
	creates     []bots.Input
	history     bots.History
	historyCall int
	create      func(in bots.Input) (bots.View, error)
}

func newFakeBot() *fakeThreadBots {
	return &fakeThreadBots{prompt: "alert under 90000", permission: bots.PermissionAuto, sites: []string{"amazon.in"}}
}

func (f *fakeThreadBots) Get(_ context.Context, _, _ string) (bots.Detail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return bots.Detail{View: bots.View{ID: "bot_1", Name: "Pixel watch", Engine: bots.EngineAgent, Prompt: f.prompt, Permission: f.permission,
		Tools: bots.AgentTools{BrowserSites: f.sites, UseMemory: f.memory}}}, nil
}

func (f *fakeThreadBots) Change(_ context.Context, _, _ string, in bots.ChangeInput, tapped bool) (bots.ChangeResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	before := bots.Reach{Permission: f.permission, BrowserSites: f.sites, UseMemory: f.memory}
	after := before
	res := bots.ChangeResult{Before: in.From, After: in.To}
	if in.Prompt != nil {
		oldPrompt := f.prompt
		res.Inverse.Prompt = &oldPrompt
	}
	if in.Permission != nil {
		after.Permission = *in.Permission
		old := f.permission
		res.Inverse.Permission = &old
		res.Before, res.After = "permission "+old, "permission "+*in.Permission
	}
	if in.Tools != nil && in.Tools.BrowserSites != nil {
		after.BrowserSites = *in.Tools.BrowserSites
		old := append([]string{}, f.sites...)
		res.Inverse.Tools = &bots.ToolsInput{BrowserSites: &old}
		res.Before, res.After = "browser sites "+strings.Join(f.sites, " "), "browser sites "+strings.Join(*in.Tools.BrowserSites, " ")
	}
	if reason := bots.WidenReason(before, after); reason != "" && !tapped {
		res.Pending, res.Reason = true, reason
		return res, nil
	}
	if in.Prompt != nil {
		f.prompt = *in.Prompt
	}
	f.permission, f.sites = after.Permission, after.BrowserSites
	f.changes++
	res.Applied = true
	return res, nil
}

func (f *fakeThreadBots) History(_ context.Context, _, _ string, _ bots.HistoryQuery) (bots.History, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.historyCall++
	return f.history, nil
}

func (f *fakeThreadBots) Create(_ context.Context, _ string, in bots.Input, _ bots.Origin) (bots.View, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creates = append(f.creates, in)
	if f.create != nil {
		return f.create(in)
	}
	return bots.View{ID: "bot_new", Name: in.Name}, nil
}

// threadWorld is a chat Service on an isolated schema with a stub model and a
// fake Bot.
type threadWorld struct {
	t     *testing.T
	s     *Service
	model *stubThreadModel
	bot   *fakeThreadBots
	cid   string
}

func newThreadWorld(t *testing.T, script ...WireMessage) *threadWorld {
	t.Helper()
	db := integrationDB(t)
	if err := db.AutoMigrate(&bots.Bot{}, &bots.Watch{}, &bots.Alert{}); err != nil {
		t.Fatal(err)
	}
	model := &stubThreadModel{script: script}
	s := New(db, engineCatalog, model)
	fake := newFakeBot()
	s.SetBotThreads(fake)
	b := testBot("bot_1")
	b.Prompt = "alert under 90000"
	createBot(t, s, b)
	cid, err := s.botThread(context.Background(), "user-a", "bot_1")
	if err != nil {
		t.Fatal(err)
	}
	return &threadWorld{t: t, s: s, model: model, bot: fake, cid: cid}
}

// say sends the person's message through the route and waits for the turn.
func (w *threadWorld) say(cid, text string) Conversation {
	w.t.Helper()
	code, body := serve(w.t, w.s, "POST", "/chats/"+cid+"/messages", fmt.Sprintf(`{"content":%q,"requestId":%q}`, text, id("req_")))
	if code != http.StatusOK {
		w.t.Fatalf("send %d %s", code, body)
	}
	return w.settle(cid)
}

func (w *threadWorld) settle(cid string) Conversation {
	w.t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if _, running := w.s.threadRuns.Load(cid); !running {
			var row Conversation
			if err := w.s.db.First(&row, "id = ?", cid).Error; err != nil {
				w.t.Fatal(err)
			}
			return row
		}
	}
	w.t.Fatal("the turn did not finish")
	return Conversation{}
}

func (w *threadWorld) view(id string) ThreadView {
	w.t.Helper()
	code, body := serve(w.t, w.s, "GET", "/chat/bot-threads/"+id, "")
	if code != 200 {
		w.t.Fatalf("get thread %d %s", code, body)
	}
	var v ThreadView
	if err := json.Unmarshal(body, &v); err != nil {
		w.t.Fatal(err)
	}
	return v
}

func itemsOf(v ThreadView, kind string) []ThreadItem {
	var out []ThreadItem
	for _, it := range v.Items {
		if it.Kind == kind {
			out = append(out, it)
		}
	}
	return out
}

// ---------------------------------------------------------------- tests

// "Only alert under 85000" changes the Bot at once, the thread says
// "Changed: X -> Y" and Undo puts it back; undoing twice changes nothing more.
func TestIntegrationBotThreadChangesAtOnceAndUndoes(t *testing.T) {
	w := newThreadWorld(t,
		threadCall("get_bot", map[string]any{}),
		threadCall("change_bot", map[string]any{"patch": map[string]any{"prompt": "alert under 85000"}, "from": "alert under 90000", "to": "85000"}),
		threadSay("Done."))
	w.say(w.cid, "only alert under 85000")
	if w.bot.prompt != "alert under 85000" || w.bot.changes != 1 {
		t.Fatalf("the Bot was not changed at once: %q, %d changes", w.bot.prompt, w.bot.changes)
	}
	v := w.view("bot_1")
	changes := itemsOf(v, "change")
	if len(changes) != 1 || changes[0].Before != "alert under 90000" || changes[0].After != "85000" || changes[0].UndoToken == "" {
		t.Fatalf("change items %+v", changes)
	}
	var line string
	for _, m := range v.Thread.Messages {
		if m.Kind == msgBotChange {
			line = m.Content
		}
	}
	if line != "Changed: alert under 90000 -> 85000" {
		t.Fatalf("reply line %q", line)
	}
	if v.Summary.NeedsYou || v.Summary.PendingChanges != 0 {
		t.Fatalf("an applied change needs nobody: %+v", v.Summary)
	}
	// Undo through the route.
	code, body := serve(t, w.s, "POST", "/chat/bot-threads/"+w.cid+"/undo", fmt.Sprintf(`{"undoToken":%q}`, changes[0].UndoToken))
	if code != 200 || w.bot.prompt != "alert under 90000" {
		t.Fatalf("undo %d %s, prompt %q", code, body, w.bot.prompt)
	}
	n := w.bot.changes
	if code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+w.cid+"/undo", fmt.Sprintf(`{"undoToken":%q}`, changes[0].UndoToken)); code != 200 || w.bot.changes != n {
		t.Fatalf("a second undo must change nothing: %d, %d changes", code, w.bot.changes)
	}
	if done := itemsOf(w.view("bot_1"), "change"); len(done) != 1 || !done[0].Undone {
		t.Fatalf("the change must read as undone: %+v", done)
	}
	if code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+w.cid+"/undo", `{"undoToken":"chg_nope"}`); code != 404 {
		t.Fatalf("an unknown token gave %d", code)
	}
	// The model was offered exactly the thread's toolset.
	for _, names := range w.model.offered {
		if strings.Join(names, ",") != strings.Join(BotThreadToolNames(false), ",") {
			t.Fatalf("offered %v", names)
		}
	}
}

// A new signed-in site waits for one tap: the Bot is unchanged until it, then
// the site is granted. A second tap is a no-op.
func TestIntegrationBotThreadWideningWaitsForOneTap(t *testing.T) {
	w := newThreadWorld(t,
		threadCall("change_bot", map[string]any{"patch": map[string]any{"tools": map[string]any{"browserSites": []string{"amazon.in", "flipkart.com"}}}}),
		threadSay("Tap to allow it."))
	w.say(w.cid, "also check flipkart.com in my browser")
	if len(w.bot.sites) != 1 || w.bot.changes != 0 {
		t.Fatalf("the Bot changed before the tap: %v", w.bot.sites)
	}
	v := w.view("bot_1")
	pending := itemsOf(v, "pending_change")
	if len(pending) != 1 || pending[0].Reason != bots.WidenBrowserSite || pending[0].State != "pending" {
		t.Fatalf("pending items %+v", pending)
	}
	if v.Summary.PendingChanges != 1 || !v.Summary.NeedsYou || len(itemsOf(v, "change")) != 0 {
		t.Fatalf("summary %+v", v.Summary)
	}
	tap := func(action string) int {
		code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+w.cid+"/pending/"+pending[0].ID, fmt.Sprintf(`{"action":%q}`, action))
		return code
	}
	if code := tap("approve"); code != 200 {
		t.Fatalf("tap %d", code)
	}
	if len(w.bot.sites) != 2 || w.bot.changes != 1 {
		t.Fatalf("the site was not granted: %v", w.bot.sites)
	}
	if code := tap("approve"); code != 200 || w.bot.changes != 1 {
		t.Fatalf("a second tap must be a no-op: %d, %d changes", code, w.bot.changes)
	}
	after := w.view("bot_1")
	if after.Summary.PendingChanges != 0 || after.Summary.NeedsYou || len(itemsOf(after, "change")) != 1 {
		t.Fatalf("after the tap: %+v", after.Summary)
	}
	// A discarded change leaves the Bot as it is.
	w.model.script, w.model.calls = []WireMessage{threadCall("change_bot", map[string]any{"patch": map[string]any{"permission": "full"}}), threadSay("ok")}, 0
	w.say(w.cid, "go full access")
	pend := itemsOf(w.view("bot_1"), "pending_change")
	var open ThreadItem
	for _, p := range pend {
		if p.State == "pending" {
			open = p
		}
	}
	if open.Reason != bots.WidenPermission || w.bot.permission != bots.PermissionAuto {
		t.Fatalf("permission change %+v, mode %s", open, w.bot.permission)
	}
	if code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+w.cid+"/pending/"+open.ID, `{"action":"discard"}`); code != 200 || w.bot.permission != bots.PermissionAuto {
		t.Fatalf("discard %d, mode %s", code, w.bot.permission)
	}
}

// "Why did you alert yesterday?" is answered from the Bot's own history, and
// the turn can never call a Timely write, web or host tool: what the model
// asks for beyond the thread's tools is refused, and the toolset it was
// offered holds only the thread's four.
func TestIntegrationBotThreadAnswersFromHistoryAndNothingElse(t *testing.T) {
	w := newThreadWorld(t,
		threadCall("bot_history", map[string]any{"kind": "alerts"}),
		threadCall("create_task", map[string]any{"name": "Buy it"}),
		threadCall("web_search", map[string]any{"query": "pixel price"}),
		threadCall("terminal", map[string]any{"command": "ls"}),
		threadSay("It alerted because the price fell."))
	w.bot.history = bots.History{Bot: "Pixel watch", Alerts: []bots.HistoryAlert{{ID: "balert_1", Title: "Pixel at 84999", Body: "Under your line"}}}
	row := w.say(w.cid, "why did you alert yesterday?")
	if w.bot.historyCall != 1 || w.bot.changes != 0 {
		t.Fatalf("history calls %d, changes %d", w.bot.historyCall, w.bot.changes)
	}
	allowed := map[string]bool{}
	for _, n := range BotThreadToolNames(false) {
		allowed[n] = true
	}
	for _, names := range w.model.offered {
		for _, n := range names {
			if !allowed[n] || isWriteTool(n) || webTools[n] {
				t.Fatalf("the model was offered %s", n)
			}
		}
	}
	// The refused calls came back as errors, not results.
	last := w.model.wires[len(w.model.wires)-1]
	refused := 0
	for _, m := range last {
		if m.Role == "tool" && strings.Contains(m.Content, "only changes its bot") {
			refused++
		}
	}
	if refused != 3 {
		t.Fatalf("%d refusals, want 3", refused)
	}
	// The history reached the model as outside data.
	seen := false
	for _, m := range last {
		if m.Role == "tool" && strings.Contains(m.Content, "outsideData") && strings.Contains(m.Content, "Pixel at 84999") {
			seen = true
		}
	}
	if !seen {
		t.Fatal("the answer was not read from bot_history")
	}
	answers := itemsOf(w.view("bot_1"), "answer")
	if len(answers) != 1 || !strings.Contains(answers[0].Text, "price fell") || row.Error != "" {
		t.Fatalf("answers %+v, error %q", answers, row.Error)
	}
	// No Timely write happened: nothing was created and no proposal exists.
	var tasks int64
	w.s.db.Model(&testItem{}).Count(&tasks)
	if tasks != 0 || len(row.Plan) != 0 {
		t.Fatalf("a write happened: %d tasks, plan %+v", tasks, row.Plan)
	}
}

// Undo that would give the Bot back reach (a removed signed-in site) runs only
// on the person's tap: the model's undo_bot_change is refused and changes
// nothing.
func TestIntegrationBotThreadModelUndoNeverWidens(t *testing.T) {
	w := newThreadWorld(t,
		threadCall("change_bot", map[string]any{"patch": map[string]any{"tools": map[string]any{"browserSites": []string{}}}}),
		threadSay("Removed."))
	w.say(w.cid, "stop reading amazon.in")
	if len(w.bot.sites) != 0 || w.bot.changes != 1 {
		t.Fatalf("a narrowing change applies at once: %v", w.bot.sites)
	}
	changes := itemsOf(w.view("bot_1"), "change")
	if len(changes) != 1 {
		t.Fatalf("changes %+v", changes)
	}
	ctx := context.Background()
	if _, err := w.s.undoThreadChange(ctx, "user-a", w.cid, changes[0].UndoToken, false); err == nil || len(w.bot.sites) != 0 {
		t.Fatalf("the model's undo widened the Bot: %v, sites %v", err, w.bot.sites)
	}
	if done := itemsOf(w.view("bot_1"), "change"); done[0].Undone {
		t.Fatal("a refused undo reads as undone")
	}
	if _, err := w.s.UndoThreadChange(ctx, "user-a", w.cid, changes[0].UndoToken); err != nil || len(w.bot.sites) != 1 {
		t.Fatalf("the person's undo: %v, sites %v", err, w.bot.sites)
	}
}

// A new Bot starts as its thread: the draft shows its whole setup and one
// Create makes the Bot and links the thread. Drafts and Bot threads stay out of
// the chat list.
func TestIntegrationBotThreadDraftCreatesTheBotOnce(t *testing.T) {
	w := newThreadWorld(t, threadCall("create_bot_draft", map[string]any{"setup": map[string]any{
		"name": "Phone price", "prompt": "Tell me when the Pixel is under 85000", "schedule": "every 6h",
		"watches": []any{map[string]any{"kind": "page", "url": "https://shop.example/pixel", "read": "product_price"}},
	}}), threadSay("Read it over and tap Create."))
	w.bot.create = func(in bots.Input) (bots.View, error) {
		createBot(t, w.s, func() bots.Bot { b := testBot("bot_new"); b.Name = in.Name; return b }())
		return bots.View{ID: "bot_new", Name: in.Name}, nil
	}
	code, body := serve(t, w.s, "POST", "/chat/bot-threads", `{"content":"watch the Pixel price for me"}`)
	if code != 201 {
		t.Fatalf("new draft %d %s", code, body)
	}
	var draft ThreadView
	if err := json.Unmarshal(body, &draft); err != nil {
		t.Fatal(err)
	}
	if !draft.Summary.Draft || draft.Summary.BotID != "" {
		t.Fatalf("draft summary %+v", draft.Summary)
	}
	row := w.settle(draft.Thread.ID)
	if row.Error != "" {
		t.Fatalf("turn error %q", row.Error)
	}
	v := w.view(draft.Thread.ID)
	setups := itemsOf(v, "draft_setup")
	if len(setups) != 1 || setups[0].Name != "Phone price" {
		t.Fatalf("draft items %+v", setups)
	}
	var fields map[string]any
	if err := json.Unmarshal(setups[0].Fields, &fields); err != nil || fields["engine"] != "agent" || fields["permission"] != "auto" || fields["gate"] != "changed" || fields["prompt"] == "" {
		t.Fatalf("the whole setup is shown: %v (%v)", fields, err)
	}
	if len(w.bot.creates) != 0 {
		t.Fatal("the draft created the Bot before Create")
	}
	if names := w.model.offered[0]; len(names) != 1 || names[0] != "create_bot_draft" {
		t.Fatalf("a draft thread offers only create_bot_draft: %v", names)
	}
	// Neither the draft nor any Bot thread is a chat.
	_, list := serve(t, w.s, "GET", "/chats", "")
	if strings.Contains(string(list), draft.Thread.ID) || strings.Contains(string(list), w.cid) {
		t.Fatalf("the chat list shows a Bot thread or draft: %s", list)
	}
	_, threads := serve(t, w.s, "GET", "/chat/bot-threads", "")
	if !strings.Contains(string(threads), draft.Thread.ID) || !strings.Contains(string(threads), w.cid) {
		t.Fatalf("the Bot thread list is missing one: %s", threads)
	}
	// One Create.
	code, body = serve(t, w.s, "POST", "/chat/bot-threads/"+draft.Thread.ID+"/create", `{}`)
	if code != 201 || len(w.bot.creates) != 1 {
		t.Fatalf("create %d %s, %d creates", code, body, len(w.bot.creates))
	}
	made := w.bot.creates[0]
	if made.Name != "Phone price" || made.Prompt == nil || len(made.Watches) != 1 || len(made.Schedule) == 0 {
		t.Fatalf("created %+v", made)
	}
	var linked Conversation
	if err := w.s.db.First(&linked, "id = ?", draft.Thread.ID).Error; err != nil {
		t.Fatal(err)
	}
	if linked.Kind != KindBotThread || linked.BotID == nil || *linked.BotID != "bot_new" || isDraft(&linked) {
		t.Fatalf("the draft thread was not linked: kind %s", linked.Kind)
	}
	var linkedIDs []*string
	w.s.db.Model(&bots.Bot{}).Where("id = ?", "bot_new").Pluck("thread_id", &linkedIDs)
	if len(linkedIDs) != 1 || linkedIDs[0] == nil || *linkedIDs[0] != draft.Thread.ID {
		t.Fatalf("the Bot does not name its thread: %v", linkedIDs)
	}
	if code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+draft.Thread.ID+"/create", `{}`); code != 201 || len(w.bot.creates) != 1 {
		t.Fatalf("a second Create made another Bot: %d creates", len(w.bot.creates))
	}
}

// A setup the Bot would refuse never reaches the person's screen.
func TestIntegrationBotThreadDraftRefusesABadSetup(t *testing.T) {
	w := newThreadWorld(t, threadCall("create_bot_draft", map[string]any{"setup": map[string]any{"name": "No schedule", "prompt": "x"}}), threadSay("Sorry."))
	code, body := serve(t, w.s, "POST", "/chat/bot-threads", `{"content":"make one"}`)
	if code != 201 {
		t.Fatalf("%d %s", code, body)
	}
	var draft ThreadView
	_ = json.Unmarshal(body, &draft)
	w.settle(draft.Thread.ID)
	if got := itemsOf(w.view(draft.Thread.ID), "draft_setup"); len(got) != 0 {
		t.Fatalf("a bad setup was shown: %+v", got)
	}
	if code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+draft.Thread.ID+"/create", `{}`); code != 409 || len(w.bot.creates) != 0 {
		t.Fatalf("Create with no setup gave %d", code)
	}
}

// A posted alert reaches the Bot thread once, with "Do this in chat" and its
// Review card; the thread says why it needs the person, as counts.
func TestIntegrationBotThreadPostsAlertsAndCountsWhatWaits(t *testing.T) {
	w := newThreadWorld(t)
	a := bots.Alert{ID: "balert_1", BotID: "bot_1", UserID: "user-a", Kind: "alert", Title: "Pixel at 84999", Body: "Under your line", URL: "https://shop.example/p",
		ProposalState: bots.ProposalPending, Proposal: json.RawMessage(`{"tool":"create_task","args":{"name":"Buy the Pixel"}}`), CreatedAt: time.Now().UTC()}
	if err := w.s.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := w.s.PostAlert(context.Background(), "user-a", "bot_1", "balert_1"); err != nil {
			t.Fatal(err)
		}
	}
	v := w.view("bot_1")
	alerts := itemsOf(v, "alert")
	if len(alerts) != 1 || alerts[0].AlertID != "balert_1" || alerts[0].Title != "Pixel at 84999" || alerts[0].Review == nil || alerts[0].Review.State != bots.ProposalPending {
		t.Fatalf("alert items %+v", alerts)
	}
	if v.Summary.ReviewCards != 1 || !v.Summary.NeedsYou || v.Summary.ParkedSteps != 0 || v.Summary.PendingChanges != 0 {
		t.Fatalf("summary %+v", v.Summary)
	}
	if !v.Thread.Unread {
		t.Fatal("a posted alert leaves the thread unread")
	}
	// The same counts on the list the inbox reads.
	_, list := serve(t, w.s, "GET", "/chat/bot-threads", "")
	var out struct {
		Threads []ThreadSummary `json:"threads"`
	}
	_ = json.Unmarshal(list, &out)
	if len(out.Threads) != 1 || out.Threads[0].Kind != KindBotThread || out.Threads[0].ReviewCards != 1 || !out.Threads[0].NeedsYou || out.Threads[0].BotID != "bot_1" {
		t.Fatalf("list %+v", out.Threads)
	}
	// The thread is made when the Bot has none.
	b := testBot("bot_2")
	createBot(t, w.s, b)
	w.s.db.Create(&bots.Alert{ID: "balert_2", BotID: "bot_2", UserID: "user-a", Kind: "alert", Title: "Second", CreatedAt: time.Now().UTC()})
	if err := w.s.PostAlert(context.Background(), "user-a", "bot_2", "balert_2"); err != nil {
		t.Fatal(err)
	}
	if got := itemsOf(w.view("bot_2"), "alert"); len(got) != 1 {
		t.Fatalf("the new thread has %d alerts", len(got))
	}
}

// A deleted Bot thread is made again on the next open, and the Bot's
// thread_id (no foreign key) moves to the new one.
func TestIntegrationBotThreadMadeAgainAfterDelete(t *testing.T) {
	w := newThreadWorld(t)
	threadID := func() string {
		var ids []*string
		w.s.db.Model(&bots.Bot{}).Where("id = ?", "bot_1").Pluck("thread_id", &ids)
		if len(ids) != 1 || ids[0] == nil {
			return ""
		}
		return *ids[0]
	}
	if threadID() != w.cid {
		t.Fatalf("the Bot names %q, its thread is %q", threadID(), w.cid)
	}
	if code, body := serve(t, w.s, "DELETE", "/chats/"+w.cid, ""); code != 204 {
		t.Fatalf("delete %d %s", code, body)
	}
	again := w.view("bot_1").Thread.ID
	if again == "" || again == w.cid || threadID() != again {
		t.Fatalf("thread %q, the Bot names %q", again, threadID())
	}
	if code, _ := serve(t, w.s, "GET", "/chat/bot-threads/bot_missing", ""); code != 404 {
		t.Fatalf("an unknown Bot gave %d", code)
	}
}

// Without an AI provider the turn says so and changes nothing.
func TestIntegrationBotThreadWithoutAProvider(t *testing.T) {
	db := integrationDB(t)
	if err := db.AutoMigrate(&bots.Bot{}, &bots.Watch{}, &bots.Alert{}); err != nil {
		t.Fatal(err)
	}
	s := New(db, engineCatalog, nil)
	fake := newFakeBot()
	s.SetBotThreads(fake)
	createBot(t, s, testBot("bot_1"))
	cid, _ := s.botThread(context.Background(), "user-a", "bot_1")
	w := &threadWorld{t: t, s: s, bot: fake, cid: cid}
	row := w.say(cid, "only alert under 85000")
	if row.Error != NotChosenMessage || fake.changes != 0 {
		t.Fatalf("error %q, %d changes", row.Error, fake.changes)
	}
	// Two messages at once: the second waits for the first.
	s.threadRuns.Store(cid, true)
	if code, _ := serve(t, s, "POST", "/chats/"+cid+"/messages", `{"content":"again"}`); code != 409 {
		t.Fatalf("a message during a turn gave %d", code)
	}
	s.threadRuns.Delete(cid)
}
