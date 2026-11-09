package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"gorm.io/gorm"
	"timely-api/internal/features/agent"
)

// undoCatalog keeps tasks as testItem rows: create_task adds one, get_task
// reads it and delete_task (MCP-only, reached only through an undo plan)
// removes it.
func undoCatalog(tx *gorm.DB) agent.Catalog {
	read := func(_ context.Context, _ string, args json.RawMessage) (any, error) {
		var in struct {
			TaskID string `json:"taskId"`
		}
		_ = json.Unmarshal(args, &in)
		var item testItem
		if err := tx.First(&item, "id = ?", in.TaskID).Error; err != nil {
			return nil, fmt.Errorf("task not found")
		}
		return map[string]any{"task": map[string]string{"id": item.ID, "name": item.Value}}, nil
	}
	return agent.Catalog{
		"create_task": {Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			var in struct {
				Name string `json:"name"`
			}
			_ = json.Unmarshal(args, &in)
			item := testItem{ID: id("tsk_"), Value: in.Name}
			if err := tx.Create(&item).Error; err != nil {
				return nil, err
			}
			return map[string]any{"task": map[string]string{"id": item.ID, "name": item.Value}}, nil
		}},
		"get_task": {Call: read},
		"delete_task": {Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			var in struct {
				TaskID string `json:"taskId"`
			}
			_ = json.Unmarshal(args, &in)
			return map[string]bool{"deleted": true}, tx.Delete(&testItem{}, "id = ?", in.TaskID).Error
		}},
	}
}

// claimed puts a queued row back in a lane's hands, as work's claim does.
func claimed(t *testing.T, db *gorm.DB, c *Conversation) {
	t.Helper()
	if err := db.Model(&Conversation{}).Where("id = ?", c.ID).Updates(map[string]any{"status": "running", "lease": "test-lease"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(c, "id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
}

func items(db *gorm.DB) int64 {
	var n int64
	db.Model(&testItem{}).Count(&n)
	return n
}

// Auto applies a create; Undo queues its inverse through the normal apply,
// which removes it; a second Undo is refused.
func TestIntegrationUndoAnAutoAppliedCreate(t *testing.T) {
	db := integrationDB(t)
	s := New(db, undoCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	c := autoFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil || c.Status != "queued" {
		t.Fatalf("Auto did not apply at once: %s %v", c.Status, err)
	}
	claimed(t, db, &c)
	if err := s.apply(context.Background(), &c); err != nil || c.Status != "idle" || items(db) != 1 {
		t.Fatalf("apply: %s, %d items, %v", c.Status, items(db), err)
	}
	proposal := latestProposal(c.Messages)
	if !proposal.AutoApplied || len(proposal.UndoReads) != 1 {
		t.Fatalf("the applied proposal keeps what its undo reads: %+v", proposal)
	}

	if code, body := serve(t, s, "POST", "/chats/"+c.ID+"/undo", `{"messageId":"missing"}`); code != 404 {
		t.Fatalf("undo of an unknown message: %d %s", code, body)
	}
	code, body := serve(t, s, "POST", "/chats/"+c.ID+"/undo", fmt.Sprintf(`{"revision":%d,"messageId":%q}`, c.Revision, proposal.ID))
	if code != 200 {
		t.Fatalf("undo: %d %s", code, body)
	}
	db.First(&c, "id = ?", c.ID)
	if c.Status != "queued" || c.Phase != "apply" || len(c.Plan) != 1 || c.Plan[0].Tool != "delete_task" || !c.Plan[0].Undo {
		t.Fatalf("undo plan: %s/%s %+v", c.Status, c.Phase, c.Plan)
	}
	undone := latestProposal(c.Messages)
	if undone.UndoneAt == nil || undone.UndoMessageID == "" || !strings.Contains(string(body), `"undoneAt"`) {
		t.Fatalf("the proposal is not marked undone: %+v", undone)
	}
	claimed(t, db, &c)
	if err := s.apply(context.Background(), &c); err != nil || c.Status != "idle" || items(db) != 0 {
		t.Fatalf("undo apply: %s, %d items, %v", c.Status, items(db), err)
	}
	if code, body := serve(t, s, "POST", "/chats/"+c.ID+"/undo", fmt.Sprintf(`{"messageId":%q}`, proposal.ID)); code != 409 || !strings.Contains(string(body), "already undone") {
		t.Fatalf("a second undo: %d %s", code, body)
	}
}

// Undo is refused once what it would change was edited after it applied,
// and a held (Supervised) proposal has no Undo at all.
func TestIntegrationUndoRefusals(t *testing.T) {
	db := integrationDB(t)
	s := New(db, undoCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	c := autoFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	claimed(t, db, &c)
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	db.Model(&testItem{}).Where("1 = 1").Update("value", "Buy oat milk")
	proposal := latestProposal(c.Messages)
	if code, body := serve(t, s, "POST", "/chats/"+c.ID+"/undo", fmt.Sprintf(`{"messageId":%q}`, proposal.ID)); code != 409 || !strings.Contains(string(body), "changed after it was applied") {
		t.Fatalf("undo after an edit: %d %s", code, body)
	}
	if items(db) != 1 {
		t.Fatal("a refused undo removed the task")
	}

	s = New(db, undoCatalog, &scripted{responses: []WireMessage{proposeCreate(true)}})
	held := planFixture(t, db)
	if err := s.plan(context.Background(), &held); err != nil || held.Status != "approval" {
		t.Fatalf("Supervised: %s %v", held.Status, err)
	}
	db.Model(&Conversation{}).Where("id = ?", held.ID).Update("status", "idle")
	if code, _ := serve(t, s, "POST", "/chats/"+held.ID+"/undo", fmt.Sprintf(`{"messageId":%q}`, latestProposal(held.Messages).ID)); code != 404 {
		t.Fatalf("undo of a held proposal: %d", code)
	}
}

// A proposal step can never claim to be an undo step: the delete tools an
// inverse needs stay out of the model's reach.
func TestProposalStepsAreNeverUndoSteps(t *testing.T) {
	catalog := agent.Catalog{"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }}}
	p, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", raw(map[string]any{"summary": "x", "direct": true,
		"steps": []any{map[string]any{"tool": "create_task", "summary": "x", "arguments": map[string]any{"name": "x"}, "undo": true}}}), nil)
	if err != nil || p.Steps[0].Undo {
		t.Fatalf("a proposed step kept undo: %+v %v", p.Steps, err)
	}
	if _, _, err := (&Service{}).prepareProposal(context.Background(), agent.Catalog{"delete_task": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }}}, "user",
		raw(map[string]any{"summary": "x", "direct": true, "steps": []any{map[string]any{"tool": "delete_task", "summary": "x", "arguments": map[string]any{"taskId": "t"}, "undo": true}}}), nil); err == nil {
		t.Fatal("a proposal reached an MCP-only delete")
	}
}
