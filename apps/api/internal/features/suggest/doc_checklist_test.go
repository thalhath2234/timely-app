package suggest

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"timely-api/internal/features/decide"
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

// Only the items Jev confidently reads as things to get done are offered,
// and only while suggestions are on; a dismissed item, the doc's offers
// turned off, or an item already a task is not asked about.
func TestIntegrationDocChecklistOffers(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.AutoMigrate(&decide.DecisionLog{}))
	item := func(text string) map[string]any {
		return map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": false}, "content": []any{
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}},
		}}
	}
	doc := models.Document{ID: "doc_week", Title: "This week", WorkspaceID: w.ws, UserID: w.user, CreatedAt: "2026-10-01T09:00:00Z",
		Content: models.JSONMap{"type": "doc", "content": []any{
			map[string]any{"type": "heading", "attrs": map[string]any{"level": 2}, "content": []any{map[string]any{"type": "text", "text": "Groceries"}}},
			map[string]any{"type": "taskList", "content": []any{item("Milk"), item("Eggs")}},
			map[string]any{"type": "heading", "attrs": map[string]any{"level": 2}, "content": []any{map[string]any{"type": "text", "text": "Errands"}}},
			map[string]any{"type": "taskList", "content": []any{item("Call the plumber"), item("Book the venue")}},
		}}}
	must(t, w.db.Create(&doc).Error)
	names := []string{"Milk", "Eggs", "Call the plumber", "Book the venue"}
	// Book the venue: Jev is not sure, so it is not offered.
	jev := &jevStub{answers: map[string]any{"i1": yesNo(0.05), "i2": yesNo(0.1), "i3": yesNo(0.95), "i4": yesNo(0.7)}}
	s := New(w.db, jev.serviceDB(t, w.db), nil)
	ctx := context.Background()

	out, err := s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if !out.Available || out.Off || len(out.Offer) != 1 || out.Offer[0] != "Call the plumber" || out.LogID == "" {
		t.Fatalf("%+v", out)
	}
	if len(jev.asked(0)) != 4 {
		t.Fatalf("asked %d", len(jev.asked(0)))
	}
	// Jev reads each item with the list and heading it sits under.
	lists, _ := jev.requests[0].State["checklists"].([]any)
	if len(lists) != 2 || lists[0].(map[string]any)["heading"] != "Groceries" {
		t.Fatalf("checklists %v", jev.requests[0].State["checklists"])
	}

	// A dismissed item is not asked about again; the rest still are.
	// Questions are numbered per read: i3 is now Book the venue.
	must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("todo", "call  the PLUMBER")))
	jev.answers["i3"] = yesNo(0.7)
	out, err = s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if len(jev.asked(1)) != 3 || len(out.Offer) != 0 {
		t.Fatalf("%+v asked %d", out, len(jev.asked(1)))
	}

	// An item that is a task already is not asked about either.
	w.task(t, "Book the venue", nil)
	out, err = s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if len(jev.asked(2)) != 2 || len(out.Existing) != 1 {
		t.Fatalf("%+v asked %d", out, len(jev.asked(2)))
	}

	// Offers off for the doc: nothing is asked, and the hints say so.
	must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("todos", "")))
	out, err = s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if !out.Off || len(out.Offer) != 0 || len(jev.requests) != 3 || out.Existing == nil {
		t.Fatalf("%+v after %d requests", out, len(jev.requests))
	}
	hints, err := s.DocHints(ctx, w.user, doc.ID, time.Now())
	must(t, err)
	if !hints.TodosOff {
		t.Fatalf("hints %+v", hints)
	}
	// On again: offers come back.
	must(t, s.RestoreDocHint(ctx, w.user, doc.ID, docHintKey("todos", "")))
	must(t, s.RestoreDocHint(ctx, w.user, doc.ID, docHintKey("todo", "Call the plumber")))
	jev.mu.Lock()
	n := len(jev.requests)
	jev.answers["i3"] = yesNo(0.95)
	jev.mu.Unlock()
	out, err = s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if out.Off || len(out.Offer) != 1 || out.Offer[0] != "Call the plumber" || len(jev.asked(n)) != 3 {
		t.Fatalf("%+v asked %d", out, len(jev.asked(n)))
	}

	// Suggestions off: no offers and no call.
	off := New(w.db, decide.New(w.db, func(context.Context, string) (decide.Keys, error) { return decide.Keys{TypeSafe: "ts-key"}, nil }, decide.NewClient(nil)), nil)
	out, err = off.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if out.Available || len(out.Offer) != 0 {
		t.Fatalf("%+v", out)
	}
}

// Items already handled (dismissed, or tasks already) leave room for later
// ones: up to maxChecklistAsk of the rest are read, however many come first.
func TestIntegrationDocChecklistAsksPastHandledItems(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.AutoMigrate(&decide.DecisionLog{}))
	doc := models.Document{ID: "doc_trip", Title: "Trip", WorkspaceID: w.ws, UserID: w.user, CreatedAt: "2026-10-01T09:00:00Z"}
	must(t, w.db.Create(&doc).Error)
	s := New(w.db, nil, nil)
	ctx := context.Background()
	var names []string
	for i := 1; i <= 59; i++ {
		names = append(names, fmt.Sprintf("Pack item %d", i))
		if i <= 20 {
			must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("todo", names[i-1])))
		}
	}
	names = append(names, "Book the airport taxi")
	// Items 21-60 are read, numbered from i1: the taxi is i40.
	jev := &jevStub{answers: map[string]any{"i40": yesNo(0.95)}}
	for i := 1; i < 40; i++ {
		jev.answers[fmt.Sprintf("i%d", i)] = yesNo(0.05)
	}
	s = New(w.db, jev.serviceDB(t, w.db), nil)
	out, err := s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if len(jev.asked(0)) != 40 || len(out.Offer) != 1 || out.Offer[0] != "Book the airport taxi" {
		t.Fatalf("%+v asked %d", out, len(jev.asked(0)))
	}
	// At most maxChecklistAsk are read at once.
	var many []string
	for i := 1; i <= 70; i++ {
		many = append(many, fmt.Sprintf("Errand %d", i))
	}
	_, err = s.DocChecklist(ctx, w.user, doc.ID, many, "")
	must(t, err)
	if len(jev.asked(1)) != maxChecklistAsk {
		t.Fatalf("asked %d", len(jev.asked(1)))
	}
}

// A doc full of dismissals still keeps its task offers turned off, and a
// dismissal past the cap is refused rather than dropped without a word.
func TestIntegrationDocDismissalsCap(t *testing.T) {
	w := newWorld(t)
	doc := models.Document{ID: "doc_full", Title: "Weekly", WorkspaceID: w.ws, UserID: w.user, CreatedAt: "2026-10-01T09:00:00Z"}
	must(t, w.db.Create(&doc).Error)
	s := New(w.db, nil, nil)
	ctx := context.Background()
	for i := 0; i < maxDocDismissals; i++ {
		must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("work", fmt.Sprintf("line %d", i))))
	}
	if err := s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("todo", "Call the plumber")); !errors.Is(err, errDocDismissalsFull) {
		t.Fatalf("past the cap: %v", err)
	}
	// Kept already: not an error, full or not.
	must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("work", "line 3")))
	must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("todos", "")))
	must(t, s.DismissDocHint(ctx, w.user, doc.ID, docHintKey("todos", "")))
	if !s.docDismissed(ctx, w.user, doc.ID)["todos"] {
		t.Fatal("todos not kept")
	}
}

func TestDocHintKeyForChecklistOffers(t *testing.T) {
	if docHintKey("todos", "ignored") != "todos" || docHintKey("todo", " Call  the Plumber ") != "todo:call the plumber" || docHintKey("todo", " ") != "" {
		t.Fatal(docHintKey("todos", "ignored"), docHintKey("todo", " Call  the Plumber "))
	}
}
