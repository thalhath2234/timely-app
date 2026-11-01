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

func TestTriageHintPointsAtWebSearchWhenItIsOn(t *testing.T) {
	if hint := (triage{web: true}).hint(true); !strings.Contains(hint, "web search is on") || !strings.Contains(hint, "web_search") {
		t.Fatalf("hint = %q", hint)
	}
	if hint := (triage{web: true}).hint(false); !strings.Contains(hint, "web search is off") {
		t.Fatalf("hint = %q", hint)
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

// Each message used to resend a system prompt with the clock in it (so it
// never cached) and spend a whole call on get_context first.
func TestIntegrationPromptKeepsAStablePrefixAndReadsContextUpFront(t *testing.T) {
	db := integrationDB(t)
	model := &scripted{responses: []WireMessage{
		{Role: "assistant", Content: "You have two projects."},
		call("get_doc", map[string]string{"docId": "doc_1"}),
		{Role: "assistant", Content: "It is the plan."},
	}}
	contextReads := 0
	s := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{
			"get_context": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				contextReads++
				return map[string]any{"projects": []string{"Home", "Work"}}, nil
			}},
			"get_doc": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				return map[string]string{"id": "doc_1", "title": "Plan"}, nil
			}},
		}
	}, model)
	c := planFixture(t, db)
	c.WebSearch = true
	c.Messages = []Message{message("user", "Hello"), message("assistant", "Hi!"), message("user", "How many projects do I have?")}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if len(model.seen) != 1 || contextReads != 1 || c.Messages[len(c.Messages)-1].Content != "You have two projects." {
		t.Fatalf("one call answers with the context read up front: %d calls, %d reads, %+v", len(model.seen), contextReads, c.Messages)
	}
	first := model.seen[0]
	system := first[0]
	if !system.Cache || strings.Contains(system.Content, "Current UTC time") || !strings.Contains(system.Content, "Web search is on in this chat") {
		t.Fatalf("the system prompt is cached, holds no clock, and puts web lookups in scope: cache=%v", system.Cache)
	}
	marked := []string{}
	stored, clock, current := -1, -1, -1
	for i, m := range first {
		if m.Cache {
			marked = append(marked, m.Content[:min(len(m.Content), 20)])
		}
		switch {
		case m.Content == "How many projects do I have?":
			stored = i
		case strings.Contains(m.Content, "Current UTC time"):
			clock = i
		case strings.Contains(m.Content, "Current get_context result") && strings.Contains(m.Content, "Work"):
			current = i
		}
	}
	if stored < 0 || !first[stored].Cache || clock <= stored || current <= stored {
		t.Fatalf("the stored conversation ends the cached prefix, the clock and context follow: stored %d clock %d context %d", stored, clock, current)
	}
	if len(marked) != 3 || !first[len(first)-1].Cache {
		t.Fatalf("marks on the system prompt, the stored conversation and the tail: %q", marked)
	}

	// The next message starts with the same system prompt, and within its
	// run only the newest message carries the tail mark.
	c.Messages = append(c.Messages, message("user", "What is doc 1?"))
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if len(model.seen) != 3 || model.seen[1][0].Content != system.Content || model.seen[2][0].Content != system.Content {
		t.Fatalf("the system prompt is byte-identical on every call: %d calls", len(model.seen))
	}
	turn := model.seen[2]
	if last := turn[len(turn)-1]; last.Role != "tool" || !last.Cache || turn[len(turn)-2].Cache {
		t.Fatalf("the newest tool result is the tail mark: %+v", turn[len(turn)-2:])
	}
}
