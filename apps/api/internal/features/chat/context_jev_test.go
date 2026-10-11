package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func chipChat() *Conversation {
	long := func(word string) string { return strings.Repeat(word+" ", 100) }
	return &Conversation{UserID: "user-a", Messages: []Message{message("user", "Rename the selected heading to Goals")},
		Context: []ContextChip{
			{Kind: "object", Label: "Plan", Value: "docs/doc_1"},
			{Kind: "selection", Label: "Selected text", Value: long("heading")},
			{Kind: "sheet-filter", Label: "Sheet filter", Value: long("budget")},
			{Kind: "draft", Label: "Unsaved document", Value: long("draft")},
		}}
}

func TestUnneededChipsAsksOnlyAboutLongChips(t *testing.T) {
	jev, bodies := jevBy(t, func(id, _ string) any {
		switch id {
		case "chip2":
			return yesNo(0.97)
		case "chip3":
			return yesNo(0.03)
		}
		return nil
	})
	s := New(nil, nil, nil)
	s.SetDecisions(jev)
	c := chipChat()
	unneeded := s.unneededChips(context.Background(), c)
	if len(unneeded) != 1 || !unneeded[2] {
		t.Fatalf("unneeded %v", unneeded)
	}
	body := (*bodies)[0]
	// Short chips and unsaved drafts are listed but never asked about.
	if !strings.Contains(body, `"chip2"`) || !strings.Contains(body, `"chip3"`) || strings.Contains(body, `"chip1"`) || strings.Contains(body, `"chip4"`) {
		t.Fatalf("questions %s", body)
	}

	var sent []map[string]string
	if err := json.Unmarshal(raw(promptChips(c.Context, unneeded)), &sent); err != nil {
		t.Fatal(err)
	}
	if len(sent) != 4 || sent[1]["value"] != c.Context[1].Value || sent[3]["value"] != c.Context[3].Value {
		t.Fatalf("needed chips must stay whole: %v", sent)
	}
	if sent[2]["label"] != "Sheet filter" || len(sent[2]["value"]) > chipPreview+10 || !strings.Contains(sent[2]["note"], "probably not needed") {
		t.Fatalf("unneeded chip must keep its label and a preview: %v", sent[2])
	}
}

func TestUnneededChipsChangesNothingWhenUnsureOrOff(t *testing.T) {
	jev, bodies := jevBy(t, func(id, _ string) any { return yesNo(0.3) })
	s := New(nil, nil, nil)
	s.SetDecisions(jev)
	c := chipChat()
	if got := s.unneededChips(context.Background(), c); len(got) != 0 {
		t.Fatalf("an unsure no must keep the chip: %v", got)
	}
	if string(raw(promptChips(c.Context, nil))) != string(raw(c.Context)) {
		t.Fatal("with nothing unneeded the chips must be sent as before")
	}
	asked := len(*bodies)
	// One chip, a sensitive chat, or a resumed run: nothing is asked.
	one := chipChat()
	one.Context = one.Context[1:2]
	sensitive := chipChat()
	sensitive.Sensitive = true
	resumed := chipChat()
	resumed.Transcript = []WireMessage{{Role: "assistant", Content: "…"}}
	for _, c := range []*Conversation{one, sensitive, resumed} {
		if got := s.unneededChips(context.Background(), c); got != nil {
			t.Fatalf("asked for %+v", c)
		}
	}
	if len(*bodies) != asked {
		t.Fatal("Jev was asked")
	}
	if got := New(nil, nil, nil).unneededChips(context.Background(), chipChat()); got != nil {
		t.Fatal("without Jev nothing is trimmed")
	}
}

// TestIntegrationUnneededChipIsShortenedInThePrompt runs a new message with
// several chips: the one Jev is sure is not needed reaches the model as a
// preview with its label, every other chip whole.
func TestIntegrationUnneededChipIsShortenedInThePrompt(t *testing.T) {
	db := integrationDB(t)
	jev, _ := jevBy(t, func(id, _ string) any {
		switch id {
		case "chip2":
			return yesNo(0.97)
		case "chip3":
			return yesNo(0.03)
		}
		return nil
	})
	model := &scripted{responses: []WireMessage{{Role: "assistant", Content: "Done reading."}}}
	s := New(db, readCatalog, model)
	s.SetDecisions(jev)
	c := planFixture(t, db)
	fixture := chipChat()
	c.Messages, c.Context = fixture.Messages, fixture.Context
	db.Save(&c)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	attached := ""
	for _, m := range model.seen[0] {
		if strings.HasPrefix(m.Content, "Attached context") {
			attached = m.Content
		}
	}
	if !strings.Contains(attached, "Sheet filter") || !strings.Contains(attached, "probably not needed") ||
		!strings.Contains(attached, fixture.Context[1].Value) || !strings.Contains(attached, fixture.Context[3].Value) ||
		strings.Contains(attached, fixture.Context[2].Value) {
		t.Fatalf("attached context %s", attached)
	}
}
