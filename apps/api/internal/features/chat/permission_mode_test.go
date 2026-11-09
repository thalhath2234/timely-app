package chat

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/agent"
)

// autoFixture is planFixture in an Auto chat.
func autoFixture(t *testing.T, db *gorm.DB) Conversation {
	t.Helper()
	c := planFixture(t, db)
	c.Permission = string(agent.Auto)
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	return c
}

// serve calls one chat route as user-a.
func serve(t *testing.T, s *Service, method, path, body string) (int, []byte) {
	t.Helper()
	e := echo.New()
	g := e.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", "user-a"); return next(c) }
	})
	s.Routes(g)
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	e.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.Bytes()
}

func step(tool string, args any) Step {
	return Step{Tool: tool, Summary: tool, Arguments: raw(args), Status: "pending"}
}

// Each reason a proposal waits for Approve, and the plain create Auto and
// Full Access apply at once.
func TestHoldReasons(t *testing.T) {
	create := step("create_task", map[string]any{"name": "Buy milk"})
	in := func(mode string, edit func(*Conversation)) *Conversation {
		c := &Conversation{Permission: mode}
		if edit != nil {
			edit(c)
		}
		return c
	}
	bulk := []Step{}
	for i := 0; i < 11; i++ {
		bulk = append(bulk, step("complete_task", map[string]any{"taskId": "tsk_" + string(rune('a'+i))}))
	}
	recurring := step("update_task", map[string]any{"taskId": "tsk_1", "name": "Read"})
	recurring.Before = raw(map[string]any{"task": map[string]any{"id": "tsk_1", "recurrence": map[string]string{"rrule": "FREQ=WEEKLY"}}})
	for _, tc := range []struct {
		name  string
		row   *Conversation
		steps []Step
		notes []string
		want  string
	}{
		{"auto applies a create", in("auto", nil), []Step{create}, nil, ""},
		{"full access applies like auto", in("full", nil), []Step{create}, nil, ""},
		{"supervised holds everything", in("supervised", nil), []Step{create}, nil, heldSupervised},
		{"an unknown mode holds everything", in("", nil), []Step{create}, nil, heldSupervised},
		{"sensitive", in("auto", func(c *Conversation) { c.Sensitive = true }), []Step{create}, nil, heldSensitive},
		{"force review", in("auto", func(c *Conversation) { c.ForceReview = true }), []Step{create}, nil, heldReview},
		{"tainted chat", in("auto", func(c *Conversation) { c.TaintedSources = TaintSources{{Kind: "timely", Tool: "ask_bot"}} }), []Step{create}, nil, heldTainted},
		{"jev notes", in("auto", nil), []Step{create}, []string{"You may not have asked for this change:"}, heldNotes},
		{"recurring series", in("auto", nil), []Step{recurring}, nil, heldRecurring},
		{"critical: deleting", in("auto", nil), []Step{step("delete_checklist_item", map[string]any{"taskId": "tsk_1", "itemId": "itm_1"})}, nil, heldCritical},
		{"critical: overwriting a doc", in("auto", nil), []Step{step("update_doc", map[string]any{"docId": "doc_1", "markdown": "new"})}, nil, heldCritical},
		{"critical: bulk over ten items", in("auto", nil), bulk, nil, heldCritical},
		{"critical: creating a bot", in("auto", nil), []Step{step("create_bot", map[string]any{"name": "Kettle"})}, nil, heldCritical},
		{"critical: changing a bot", in("full", nil), []Step{step("update_bot", map[string]any{"bot": "bot_1", "name": "Kettle"})}, nil, heldCritical},
		{"tool floor", in("auto", nil), []Step{step("create_sheet", map[string]any{"title": "Budget", "templateId": "tpl_1"})}, nil, heldAuthority},
		{"no undo", in("auto", nil), []Step{step("add_task_comment", map[string]any{"taskId": "tsk_1", "body": "Note"})}, nil, heldNoUndo},
	} {
		if got := holdReason(tc.row, tc.steps, tc.notes); got != tc.want {
			t.Errorf("%s: held %q, want %q", tc.name, got, tc.want)
		}
		wantStatus := "queued"
		if tc.want != "" {
			wantStatus = "approval"
		}
		if got := proposalStatus(tc.row, tc.steps, true, tc.notes); got != wantStatus {
			t.Errorf("%s: status %s, want %s", tc.name, got, wantStatus)
		}
	}
}

// The model's direct flag decides nothing: Auto applies a plain create it
// did not mark direct, and Supervised holds one it did.
func TestDirectFlagDecidesNothing(t *testing.T) {
	create := []Step{step("create_task", map[string]any{"name": "Buy milk"})}
	if proposalStatus(&Conversation{Permission: "auto"}, create, false, nil) != "queued" {
		t.Error("Auto should apply an undoable create without direct")
	}
	if proposalStatus(&Conversation{Permission: "supervised"}, create, true, nil) != "approval" {
		t.Error("Supervised should hold a direct create")
	}
}

func proposeCreate(direct bool) WireMessage {
	return call("propose_changes", map[string]any{"summary": "Create Buy milk", "direct": direct, "language": "en", "reply": "", "remaining": "",
		"steps": []any{map[string]any{"tool": "create_task", "summary": "Create Buy milk", "arguments": map[string]any{"name": "Buy milk"}}}})
}

func createCatalog(*gorm.DB) agent.Catalog {
	return agent.Catalog{
		"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"task": map[string]string{"id": "tsk_1"}}, nil
		}},
		"ask_bot": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"outsideData": "Read from third-party pages.", "bot": map[string]string{"id": "bot_1"}}, nil
		}},
	}
}

// On classic, a Supervised chat holds a direct single create for Approve
// and an Auto chat applies it at once, marked autoApplied.
func TestIntegrationSupervisedHoldsAndAutoApplies(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	held := planFixture(t, db)
	if held.Permission != "supervised" {
		t.Fatalf("a new chat row is %q, want supervised", held.Permission)
	}
	if err := s.plan(context.Background(), &held); err != nil || held.Status != "approval" {
		t.Fatalf("Supervised: %s %v", held.Status, err)
	}
	if latestProposal(held.Messages).AutoApplied {
		t.Fatal("a held proposal is not autoApplied")
	}
	s = New(db, createCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	applied := autoFixture(t, db)
	if err := s.plan(context.Background(), &applied); err != nil || applied.Status != "queued" || applied.Phase != "apply" {
		t.Fatalf("Auto: %s/%s %v", applied.Status, applied.Phase, err)
	}
	if !latestProposal(applied.Messages).AutoApplied {
		t.Fatal("an applied proposal must be marked autoApplied")
	}
}

// Switching to a looser mode never approves a card already waiting; a
// stricter mode holds the next proposal.
func TestIntegrationPermissionSwitches(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	c := planFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil || c.Status != "approval" {
		t.Fatalf("Supervised: %s %v", c.Status, err)
	}
	code, body := serve(t, s, "PATCH", "/chats/"+c.ID, `{"permission":"full"}`)
	if code != 200 {
		t.Fatalf("PATCH permission: %d %s", code, body)
	}
	db.First(&c, "id = ?", c.ID)
	if c.Status != "approval" || c.Permission != "full" || c.Plan[0].Status != "pending" {
		t.Fatalf("a looser mode approved a waiting card: %s %s %s", c.Status, c.Permission, c.Plan[0].Status)
	}
	if code, _ := serve(t, s, "PATCH", "/chats/"+c.ID, `{"permission":"reckless"}`); code != 400 {
		t.Fatalf("an unknown mode: %d", code)
	}

	auto := autoFixture(t, db)
	if code, body := serve(t, s, "PATCH", "/chats/"+auto.ID, `{"permission":"supervised"}`); code != 200 {
		t.Fatalf("PATCH stricter: %d %s", code, body)
	}
	s = New(db, createCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	db.First(&auto, "id = ?", auto.ID)
	auto.Status, auto.Lease = "running", "test-lease"
	db.Save(&auto)
	if err := s.plan(context.Background(), &auto); err != nil || auto.Status != "approval" {
		t.Fatalf("a stricter mode must hold the next proposal: %s %v", auto.Status, err)
	}
}

// A classic run that read a bot's page text taints the chat: that proposal
// and every later one in it are held, even in Auto.
func TestIntegrationOutsideReadTaintsTheChat(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, &scripted{responses: []WireMessage{call("ask_bot", map[string]string{"bot": "bot_1"}), proposeCreate(true)}})
	c := autoFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil || c.Status != "approval" {
		t.Fatalf("after an outside read: %s %v", c.Status, err)
	}
	if len(c.TaintedSources) != 1 || c.TaintedSources[0] != (TaintSource{Kind: "timely", Tool: "ask_bot"}) {
		t.Fatalf("tainted_sources %+v", c.TaintedSources)
	}
	// The next run reads nothing outside, but the chat stays tainted.
	db.Model(&Conversation{}).Where("id = ?", c.ID).Updates(map[string]any{"status": "running", "lease": "test-lease", "force_review": false, "phase": "plan"})
	db.First(&c, "id = ?", c.ID)
	s = New(db, createCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	if err := s.plan(context.Background(), &c); err != nil || c.Status != "approval" || len(c.TaintedSources) != 1 {
		t.Fatalf("a tainted chat applied a change: %s %+v %v", c.Status, c.TaintedSources, err)
	}
	var stored string
	db.Raw("SELECT tainted_sources::text FROM agent_conversations WHERE id = ?", c.ID).Scan(&stored)
	if !strings.Contains(stored, `"ask_bot"`) {
		t.Fatalf("stored tainted_sources %s", stored)
	}
}

// The chat's engine waits for the current run; an empty one follows the
// account again.
func TestIntegrationChatEngineSwitch(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, nil)
	c := planFixture(t, db) // running
	if code, _ := serve(t, s, "PATCH", "/chats/"+c.ID, `{"engine":"agent"}`); code != 409 {
		t.Fatalf("engine changed mid-run: %d", code)
	}
	db.Model(&Conversation{}).Where("id = ?", c.ID).Update("status", "idle")
	if code, body := serve(t, s, "PATCH", "/chats/"+c.ID, `{"engine":"agent"}`); code != 200 || !strings.Contains(string(body), `"engine":"agent"`) {
		t.Fatalf("PATCH engine: %d %s", code, body)
	}
	if code, _ := serve(t, s, "PATCH", "/chats/"+c.ID, `{"engine":"turbo"}`); code != 400 {
		t.Fatalf("an unknown engine: %d", code)
	}
	if code, body := serve(t, s, "PATCH", "/chats/"+c.ID, `{"engine":""}`); code != 200 || !strings.Contains(string(body), `"engine":""`) {
		t.Fatalf("back to the account: %d %s", code, body)
	}
}
