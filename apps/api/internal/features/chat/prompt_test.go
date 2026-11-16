package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/features/agent"

	"gorm.io/gorm"
)

func TestOlderChangeRecordsShrinkInThePrompt(t *testing.T) {
	doc := strings.Repeat("A long paragraph of the doc. ", 200)
	steps := []Step{
		{Tool: "update_doc", Summary: "Rewrite the plan", Status: "done",
			Arguments: raw(map[string]any{"docId": "doc_1", "markdown": doc}),
			Result:    raw(map[string]any{"doc": map[string]any{"id": "doc_1", "title": "Plan", "content": doc}}),
			Before:    raw(map[string]any{"id": "doc_1", "title": "Plan", "content": doc})},
		{Tool: "update_task", Summary: "Rename Call mum", Status: "done",
			Arguments: raw(map[string]any{"taskId": "tsk_1", "name": "Call mum"}),
			Result:    raw(map[string]any{"task": map[string]any{"id": "tsk_1", "name": "Call mum"}})},
	}
	if latest := promptSteps(steps, true); string(raw(latest)) != string(raw(steps)) {
		t.Fatal("the latest proposal's records stay whole: the person may adjust or undo it")
	}
	older := promptSteps(steps, false)
	for _, field := range []json.RawMessage{older[0].Arguments, older[0].Result, older[0].Before} {
		text := string(field)
		if len(field) > recordFieldMax || strings.Contains(text, "long paragraph") || !strings.Contains(text, "doc_1") || !strings.Contains(text, "left out") {
			t.Errorf("a large field shrinks to its ids and names: %s", text)
		}
	}
	if !strings.Contains(string(older[0].Result), `"doc.title":"Plan"`) || older[0].Summary != "Rewrite the plan" || older[0].Status != "done" {
		t.Errorf("tool, summary, status and names stay: %+v", older[0])
	}
	if string(raw(older[1])) != string(raw(steps[1])) {
		t.Errorf("a small record stays whole: %s", raw(older[1]))
	}
	if !strings.Contains(string(steps[0].Before), "long paragraph") {
		t.Error("the stored record itself is untouched")
	}
}

func TestCacheTailMarksACopy(t *testing.T) {
	messages := []WireMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi"}}
	sent := CacheTail(messages)
	if !sent[1].Cache || sent[0].Cache || messages[1].Cache {
		t.Fatalf("sent %+v, kept %+v", sent, messages)
	}
	if CacheTail(nil) != nil {
		t.Fatal("nothing to mark")
	}
}

// A turn's input carries the clock and the current get_context result, read
// up front, so the model answers without spending a call on get_context.
func TestIntegrationTurnInputReadsContextUpFront(t *testing.T) {
	db := integrationDB(t)
	model := &scripted{responses: []WireMessage{{Role: "assistant", Content: "You have two projects."}}}
	contextReads := 0
	s := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{
			"get_context": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				contextReads++
				return map[string]any{"projects": []string{"Home", "Work"}}, nil
			}},
		}
	}, model)
	c := planFixture(t, db)
	c.Messages = []Message{message("user", "Hello"), message("assistant", "Hi!"), message("user", "How many projects do I have?")}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := playTurn(context.Background(), s, &c); err != nil {
		t.Fatal(err)
	}
	if len(model.seen) != 1 || contextReads != 1 || c.Messages[len(c.Messages)-1].Content != "You have two projects." {
		t.Fatalf("one call answers with the context read up front: %d calls, %d reads, %+v", len(model.seen), contextReads, c.Messages)
	}
	input := model.seen[0][0].Content
	asked, clock, current := strings.Index(input, "How many projects do I have?"), strings.Index(input, "Current UTC time"), strings.Index(input, "Current get_context result")
	if asked < 0 || clock <= asked || current <= clock || strings.Contains(input, "Hello") || !strings.Contains(input[current:], "Work") {
		t.Fatalf("the turn's input is the new message, then the clock and the context: %q", input)
	}
}
