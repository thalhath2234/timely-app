package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/features/agent"

	"gorm.io/gorm"
)

// fakeDocCatalog's get_doc returns one fixed doc, the way the real tool's
// payload carries it.
func fakeDocCatalog(text string) func(*gorm.DB) agent.Catalog {
	return func(*gorm.DB) agent.Catalog {
		catalog := agent.NewCatalog(agent.Deps{})
		get := catalog["get_doc"]
		get.Call = func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"id": "doc_plan", "title": "Trip plan", "plainText": text}, nil
		}
		catalog["get_doc"] = get
		return catalog
	}
}

func TestIntegrationReviewNotesCheckDocDrafts(t *testing.T) {
	db := integrationDB(t)
	jev, bodies := jevBy(t, func(id, _ string) any {
		switch id {
		case "asked1", "asked2", "asked3":
			return yesNo(0.95)
		case "missing", "draft2", "draft3", "contra3":
			return yesNo(0.05)
		case "draft1", "contra2":
			return yesNo(0.95)
		}
		return nil
	})
	s := New(db, fakeDocCatalog("We fly to Lisbon on Friday 12 June and stay four nights."), nil)
	s.SetDecisions(jev)
	c := runFixture(t, db, nil)
	c.Messages = []Message{message("user", "Write a packing list doc with a section for documents, and add the hotel to my trip plan")}
	p := proposal{Steps: []Step{
		{Tool: "create_doc", Summary: "Create Packing list", Arguments: raw(map[string]any{"title": "Packing list", "markdown": "# Packing list\n\n- Clothes\n- Charger"})},
		{Tool: "append_to_doc", Summary: "Add the hotel to Trip plan", Arguments: raw(map[string]any{"docId": "doc_plan", "markdown": "Hotel: Casa Azul, arriving Saturday 13 June for six nights."})},
		{Tool: "update_doc", Summary: "Rename Trip plan", Arguments: raw(map[string]any{"docId": "doc_plan", "title": "Lisbon trip"})},
	}}
	notes := s.reviewNotes(context.Background(), &c, p)
	if len(notes) != 2 ||
		notes[0] != tr("en", txtNoteDraftMisses)+" Create Packing list" ||
		notes[1] != tr("en", txtNoteContradiction)+" Add the hotel to Trip plan" {
		t.Fatalf("notes %q", notes)
	}
	body := (*bodies)[0]
	// The new doc has no current text; the title-only update sends no draft.
	for _, want := range []string{`"draft1"`, `"draft2"`, `"contra2"`, "Lisbon on Friday 12 June"} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s in the request", want)
		}
	}
	for _, unwanted := range []string{`"contra1"`, `"draft3"`, `"contra3"`} {
		if strings.Contains(body, unwanted) {
			t.Errorf("asked %s", unwanted)
		}
	}
}
