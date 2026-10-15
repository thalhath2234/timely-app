package suggest

import (
	"context"
	"testing"

	"timely-api/internal/models"
)

func TestQuotesItem(t *testing.T) {
	desc := "Name new tasks with the default model.\n\nFrom Timely ideas: “Use ai generated text to generate title for the sugggested task. Use default selected model”"
	for _, name := range []string{"use ai generated text to generate title for the sugggested task", "use ai generated text…"} {
		if !quotesItem(desc, name) {
			t.Errorf("%q should be quoted", name)
		}
	}
	for _, name := range []string{"use default selected model", "name new tasks", "", "…"} {
		if quotesItem(desc, name) {
			t.Errorf("%q is not the quoted item", name)
		}
	}
}

// A task named with AI keeps the item only in its description; it still
// counts as made from this doc's item, and only from this doc.
func TestIntegrationDocChecklistFindsAINamedTasks(t *testing.T) {
	w := newWorld(t)
	doc := models.Document{ID: "doc_ai", Title: "Timely ideas", WorkspaceID: w.ws, UserID: w.user, CreatedAt: "2026-10-01T09:00:00Z"}
	other := models.Document{ID: "doc_other", Title: "Other", WorkspaceID: w.ws, UserID: w.user, CreatedAt: "2026-10-01T09:00:00Z"}
	must(t, w.db.Create(&doc).Error)
	must(t, w.db.Create(&other).Error)
	rich := func(docID string) models.JSONMap {
		return models.JSONMap{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{
			map[string]any{"type": "text", "text": "From "},
			map[string]any{"type": "mention", "attrs": map[string]any{"id": docID, "label": "Timely ideas", "entityType": "doc"}},
			map[string]any{"type": "text", "text": ": “Use ai generated text to generate title. Use default model”"},
		}}}}
	}
	named := w.task(t, "Generate AI task titles", func(task *models.Task) {
		task.Description = "Name new tasks with AI.\n\nFrom Timely ideas: “Use ai generated text to generate title. Use default model”"
		task.DescriptionRich = rich(doc.ID)
	})
	// The same words quoted from another doc do not count here.
	w.task(t, "Book the venue", func(task *models.Task) {
		task.Description = "From Other: “book venue”"
		task.DescriptionRich = rich(other.ID)
	})
	s := New(w.db, nil, nil)
	out, err := s.DocChecklist(context.Background(), w.user, doc.ID, []string{"Use ai generated text to generate title", "book venue", "Buy milk"}, "")
	must(t, err)
	if len(out.Existing) != 1 || out.Existing[0].TaskID != named.ID || out.Existing[0].Name != "Use ai generated text to generate title" {
		t.Fatalf("existing %+v", out.Existing)
	}
}
