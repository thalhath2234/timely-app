package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"timely-api/internal/features/agent"
	"timely-api/internal/features/decide"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

// fakeJev answers each question by its id ("area__2", the second order of a
// Twice question, gets the same answer as "area" unless listed itself).
// Unlisted ids get no answer.
func fakeJev(t *testing.T, answers map[string]any) (*decide.Service, *[]string) {
	t.Helper()
	var mu sync.Mutex
	asked := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.Unmarshal(body, &req)
		out := map[string]any{}
		mu.Lock()
		for id := range req.Questions {
			asked = append(asked, id)
			if a, ok := answers[id]; ok {
				out[id] = a
			} else if a, ok := answers[strings.TrimSuffix(id, "__2")]; ok {
				out[id] = a
			}
		}
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"answers": out})
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	keys := func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-test-key"}, nil
	}
	return decide.New(nil, keys, client), &asked
}

func choice(name string, confidence float64) map[string]any {
	return map[string]any{"type": "choice", "choice": name, "confidence": confidence}
}
func yesNo(p float64) map[string]any { return map[string]any{"type": "noul", "noul": p} }

// toolsModel plays back responses and records the tools offered each call.
type toolsModel struct {
	scripted
	tools [][]string
}

func (m *toolsModel) Complete(ctx context.Context, messages []WireMessage, tools []any, search bool) (WireMessage, error) {
	names := []string{}
	for _, spec := range tools {
		fn, _ := spec.(map[string]any)["function"].(map[string]any)
		name, _ := fn["name"].(string)
		names = append(names, name)
	}
	m.mu.Lock()
	m.tools = append(m.tools, names)
	m.mu.Unlock()
	return m.scripted.Complete(ctx, messages, tools, search)
}

func readCatalog(*gorm.DB) agent.Catalog {
	read := func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]string{"ok": "yes"}, nil
	}
	return agent.Catalog{"get_context": {Call: read}, "get_calendar": {Call: read}, "get_doc": {Call: read}, "list_docs": {Call: read}}
}

func has(list []string, name string) bool {
	for _, x := range list {
		if x == name {
			return true
		}
	}
	return false
}

func TestIntegrationTriageNarrowsToolsAndHints(t *testing.T) {
	db := integrationDB(t)
	jev, _ := fakeJev(t, map[string]any{
		"area": choice("calendar", 0.95), "change": yesNo(0.03), "web": yesNo(0.1), "unclear": yesNo(0.1),
		"scope": choice("none", 0.9), "language": choice("es", 0.92),
	})
	model := &toolsModel{scripted: scripted{responses: []WireMessage{
		call("get_context", map[string]any{}),
		call("get_doc", map[string]string{"docId": "doc_1"}),
		{Role: "assistant", Content: "Mañana tienes dos eventos."},
	}}}
	s := New(db, readCatalog, model)
	s.SetDecisions(jev)
	c := planFixture(t, db)
	c.Messages = []Message{message("user", "¿Qué tengo en el calendario mañana?")}
	db.Save(&c)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if !has(model.tools[0], "get_calendar") || !has(model.tools[0], "get_context") || has(model.tools[0], "get_doc") {
		t.Fatalf("first call should offer calendar tools only: %v", model.tools[0])
	}
	if !has(model.tools[2], "get_doc") {
		t.Fatalf("calling a left-out tool must offer everything again: %v", model.tools[2])
	}
	if model.seen[1][len(model.seen[1])-1].Role != "tool" || strings.Contains(model.seen[2][len(model.seen[2])-1].Content, "error") {
		t.Fatalf("the left-out tool must still run: %+v", model.seen[2][len(model.seen[2])-1])
	}
	prompt := ""
	for _, m := range model.seen[0] {
		prompt += m.Content + "\n"
	}
	if !strings.Contains(prompt, "reads as a question") || !strings.Contains(prompt, "also work when called by name: get_doc, list_docs") {
		t.Fatalf("hints missing from the prompt: %s", prompt[len(prompt)-600:])
	}
	if c.Language != "es" || c.Status != "idle" {
		t.Fatalf("language %q status %q", c.Language, c.Status)
	}
}

func TestIntegrationTriageOffOrUnsureChangesNothing(t *testing.T) {
	db := integrationDB(t)
	for name, jev := range map[string]Decider{
		"no keys": decide.New(nil, func(context.Context, string) (decide.Keys, error) { return decide.Keys{Enabled: true}, nil }, decide.NewClient(nil)),
		"unsure": func() Decider {
			d, _ := fakeJev(t, map[string]any{"area": choice("calendar", 0.5), "change": yesNo(0.4)})
			return d
		}(),
	} {
		model := &toolsModel{scripted: scripted{responses: []WireMessage{{Role: "assistant", Content: "Hi."}}}}
		s := New(db, readCatalog, model)
		s.SetDecisions(jev)
		c := planFixture(t, db)
		if err := s.plan(context.Background(), &c); err != nil {
			t.Fatal(err)
		}
		if len(model.tools[0]) != 5 { // four read tools and propose_changes
			t.Fatalf("%s: every tool must be offered: %v", name, model.tools[0])
		}
		for _, m := range model.seen[0] {
			if strings.Contains(m.Content, "classifier") || strings.Contains(m.Content, "called by name") {
				t.Fatalf("%s: no hint expected, got %q", name, m.Content)
			}
		}
	}
}

func TestIntegrationSimilarChatWaitsForAChoice(t *testing.T) {
	db := integrationDB(t)
	jev, _ := fakeJev(t, map[string]any{"similar": choice("Plan the Lisbon trip", 0.9)})
	model := &scripted{}
	s := New(db, readCatalog, model)
	s.SetDecisions(jev)
	e := echo.New()
	g := e.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", "user-a"); return next(c) }
	})
	s.Routes(g)
	post := func(path, body string) (int, Conversation) {
		t.Helper()
		r := httptest.NewRequest("POST", path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		e.ServeHTTP(w, r)
		var row Conversation
		_ = json.Unmarshal(w.Body.Bytes(), &row)
		return w.Code, row
	}
	newChat := func() (Conversation, Conversation) {
		earlier := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Plan the Lisbon trip", Status: "idle", Phase: "plan", Context: []ContextChip{}, Messages: []Message{message("user", "Plan the Lisbon trip")}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
		db.Create(&earlier)
		c := planFixture(t, db)
		c.Messages = []Message{message("user", "Help me plan the Lisbon trip")}
		db.Save(&c)
		model.responses = nil
		if err := s.plan(context.Background(), &c); err != nil {
			t.Fatal(err)
		}
		return earlier, c
	}

	// The run stops at the pointer and the model is never called.
	earlier, c := newChat()
	last := c.Messages[len(c.Messages)-1]
	if c.Status != "choose" || last.Kind != "similar" || last.Chat == nil || last.Chat.ID != earlier.ID || len(model.seen) != 0 {
		t.Fatalf("the run must wait at the pointer: %s %+v (model calls %d)", c.Status, last, len(model.seen))
	}

	// Answer here: the run continues in this chat, without the pointer.
	code, row := post("/chats/"+c.ID+"/similar", `{"action":"stay"}`)
	if code != 200 || row.Status != "queued" || row.Messages[len(row.Messages)-1].Choice != "stay" {
		t.Fatalf("stay: %d %s %+v", code, row.Status, row.Messages)
	}
	if code, _ := post("/chats/"+c.ID+"/similar", `{"action":"stay"}`); code != 409 {
		t.Fatalf("a second choice must be refused: %d", code)
	}
	db.First(&row, "id = ?", c.ID) // the JSON leaves out the owner and lease
	row.Status, row.Lease = "running", "test-lease"
	db.Save(&row)
	model.responses = []WireMessage{{Role: "assistant", Content: "Sure."}}
	if err := s.plan(context.Background(), &row); err != nil || row.Status != "idle" {
		t.Fatalf("the run did not continue: %v %s", err, row.Status)
	}
	for _, m := range model.seen[0] {
		if strings.Contains(m.Content, "Plan the Lisbon trip") && m.Role != "user" {
			t.Fatal("the pointer must not reach the model")
		}
	}

	// Continue there: the message moves to the earlier chat and this one goes.
	earlier, c = newChat()
	code, moved := post("/chats/"+c.ID+"/similar", `{"action":"move"}`)
	if code != 200 || moved.ID != earlier.ID || moved.Status != "queued" ||
		moved.Messages[len(moved.Messages)-1].Content != "Help me plan the Lisbon trip" {
		t.Fatalf("move: %d %+v", code, moved)
	}
	var count int64
	db.Model(&Conversation{}).Where("id = ?", c.ID).Count(&count)
	if count != 0 {
		t.Fatal("the new chat must be removed after moving")
	}
}

func TestIntegrationReviewNotesForceReview(t *testing.T) {
	db := integrationDB(t)
	// Without notes the same proposal applies directly.
	plain := &scripted{responses: []WireMessage{call("propose_changes", map[string]any{
		"summary": "Create Buy a microphone", "direct": true, "language": "en", "reply": "", "remaining": "",
		"steps": []any{map[string]any{"tool": "create_task", "summary": "Create Buy a microphone", "arguments": map[string]any{"name": "Buy a microphone"}}},
	})}}
	quiet, _ := fakeJev(t, map[string]any{"asked1": yesNo(0.98), "missing": yesNo(0.03)})
	base := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }}}
	}, plain)
	base.SetDecisions(quiet)
	first := planFixture(t, db)
	if err := base.plan(context.Background(), &first); err != nil || first.Status != "queued" {
		t.Fatalf("a requested direct change should apply: %s %v", first.Status, err)
	}
	// One direct create would apply without review; the notes make it reviewed.
	jev, _ := fakeJev(t, map[string]any{"asked1": yesNo(0.02), "missing": yesNo(0.95)})
	model := &scripted{responses: []WireMessage{call("propose_changes", map[string]any{
		"summary": "Create Buy a microphone", "direct": true, "language": "en", "reply": "", "remaining": "",
		"steps": []any{
			map[string]any{"tool": "create_task", "summary": "Create Buy a microphone", "arguments": map[string]any{"name": "Buy a microphone"}},
		},
	})}}
	s := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"task": map[string]string{"id": "tsk_1"}}, nil
		}}}
	}, model)
	s.SetDecisions(jev)
	c := planFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	var summary Message
	for _, m := range c.Messages {
		if m.Proposal {
			summary = m
		}
	}
	if c.Status != "approval" || len(summary.Notes) != 2 ||
		!strings.Contains(summary.Notes[0], "Buy a microphone") || summary.Notes[1] != tr("en", txtNoteMissing) {
		t.Fatalf("notes %q status %s", summary.Notes, c.Status)
	}
}

func TestIntegrationSensitiveChatsAreNeverSent(t *testing.T) {
	db := integrationDB(t)
	jev, asked := fakeJev(t, map[string]any{"area": choice("calendar", 0.95)})
	model := &toolsModel{scripted: scripted{responses: []WireMessage{{Role: "assistant", Content: "Ok."}}}}
	s := New(db, readCatalog, model)
	s.SetDecisions(jev)
	c := planFixture(t, db)
	c.Sensitive = true
	db.Save(&c)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if len(*asked) != 0 {
		t.Fatalf("a sensitive chat was sent to Jev: %v", *asked)
	}
}

func TestReviewNotesSkipMissingForBatches(t *testing.T) {
	jev, asked := fakeJev(t, map[string]any{"asked1": yesNo(0.97), "missing": yesNo(0.97)})
	s := &Service{decisions: jev}
	c := &Conversation{UserID: "user-a", Messages: []Message{message("user", "Create 40 reading tasks")}}
	step := Step{Tool: "create_task", Summary: "Create Read chapter 1"}
	if notes := s.reviewNotes(context.Background(), c, proposal{Steps: []Step{step}, Remaining: "chapters 31-40"}); len(notes) != 0 {
		t.Fatalf("a first batch must not be called incomplete: %q", notes)
	}
	next := notice("continuing")
	next.Continue = "chapters 31-40"
	c.Messages = append(c.Messages, next)
	if notes := s.reviewNotes(context.Background(), c, proposal{Steps: []Step{step}}); len(notes) != 0 {
		t.Fatalf("a later batch must not be called incomplete: %q", notes)
	}
	for _, id := range *asked {
		if id == "missing" {
			t.Fatal("missing was asked for a batch")
		}
	}
	c.Messages = c.Messages[:1]
	if notes := s.reviewNotes(context.Background(), c, proposal{Steps: []Step{step}}); len(notes) != 1 {
		t.Fatalf("a whole request is checked for missing parts: %q", notes)
	}
}

// Near-duplicate earlier chats: the two option orders pick different ones,
// but Jev is sure there is a match, so the first pick is kept.
func TestTriageKeepsFirstPickWhenSureThereIsAMatch(t *testing.T) {
	db := integrationDB(t)
	jev, _ := fakeJev(t, map[string]any{
		"similar":    choice("Plan the Porto weekend", 0.7),
		"similar__2": choice("Porto weekend food list", 0.7),
		"hasSimilar": yesNo(0.97),
	})
	s := New(db, readCatalog, &scripted{})
	s.SetDecisions(jev)
	for _, title := range []string{"Plan the Porto weekend", "Porto weekend food list"} {
		db.Create(&Conversation{ID: id("chat_"), UserID: "user-a", Title: title, Status: "idle", Phase: "plan", Context: []ContextChip{}, Messages: []Message{message("user", title)}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}})
	}
	c := planFixture(t, db)
	c.Messages = []Message{message("user", "Help me plan my Porto weekend")}
	tri, ok := s.triage(context.Background(), &c)
	if !ok || tri.similar == nil || tri.similar.Title != "Plan the Porto weekend" {
		t.Fatalf("expected the first pick, got %+v (ok %v)", tri.similar, ok)
	}
}

func TestTriageHintMeetingIntent(t *testing.T) {
	for meeting, want := range map[string]string{
		"prepare": "time blocked before it to prepare",
		"add":     "the event itself added",
		"remind":  "a reminder shortly before it",
	} {
		if hint := (triage{meeting: meeting}).hint(true); !strings.Contains(hint, want) {
			t.Errorf("%s: %q", meeting, hint)
		}
	}
	if hint := (triage{}).hint(true); hint != "" {
		t.Errorf("no triage, no hint: %q", hint)
	}
}
