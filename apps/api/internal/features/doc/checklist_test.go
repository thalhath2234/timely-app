package doc

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

// checklistRepo holds one doc in memory, as the database would: each read is
// a fresh copy, and a content update arrives as the encoded JSON.
type checklistRepo struct {
	versionRepo
	doc     models.Document
	updates int
}

func (r *checklistRepo) GetDocumentByID(_, id string) (*models.Document, error) {
	if id != r.doc.ID {
		return nil, errors.New("not found")
	}
	copied := r.doc
	raw, _ := json.Marshal(r.doc.Content)
	_ = json.Unmarshal(raw, &copied.Content)
	return &copied, nil
}

func (r *checklistRepo) LatestVersion(string) (*Version, error) { return nil, nil }

func (r *checklistRepo) UpdateDocument(_, id string, updates map[string]any) (*models.Document, error) {
	r.updates++
	if raw, ok := updates["content"].([]byte); ok {
		var content models.JSONMap
		if err := json.Unmarshal(raw, &content); err != nil {
			return nil, err
		}
		r.doc.Content = content
	}
	return r.GetDocumentByID("", id)
}

func shoppingList() models.Document {
	item := func(text string, done bool) any {
		return map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": done}, "content": []any{
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}},
		}}
	}
	return models.Document{ID: "doc_1", UserID: "usr_1", Title: "Shopping list", Content: models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "taskList", "content": []any{item("Onion", false), item("Milk", false), item("Pasta optional", true)}},
	}}}
}

// A card ticks one item in the doc as it is now: an item added since the
// card was drawn stays, and an untouched item is not saved again.
func TestSetChecklistItemTicksOneItemInTheDocAsItIsNow(t *testing.T) {
	repo := &checklistRepo{doc: shoppingList()}
	s := &documentService{repo: repo}
	// Someone adds Bread on another device after the card drew its rows.
	list := repo.doc.Content["content"].([]any)[0].(map[string]any)
	list["content"] = append(list["content"].([]any), map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": false}, "content": []any{
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Bread"}}},
	}})

	saved, err := s.SetChecklistItem("usr_1", "doc_1", ChecklistTick{Item: 1, Text: "Milk", Done: true})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, item := range richtext.ChecklistItems(saved.Content) {
		got[item.Text] = item.Done
	}
	want := map[string]bool{"Onion": false, "Milk": true, "Pasta optional": true, "Bread": false}
	if len(got) != len(want) {
		t.Fatalf("items %v, want %v", got, want)
	}
	for text, done := range want {
		if got[text] != done {
			t.Fatalf("items %v, want %v", got, want)
		}
	}
	if repo.updates != 1 {
		t.Fatalf("updates = %d", repo.updates)
	}

	if _, err := s.SetChecklistItem("usr_1", "doc_1", ChecklistTick{Item: 2, Text: "Pasta optional", Done: true}); err != nil || repo.updates != 1 {
		t.Fatalf("an item already ticked is not saved again: %v, %d updates", err, repo.updates)
	}
	if _, err := s.SetChecklistItem("usr_1", "doc_1", ChecklistTick{Item: 0, Text: "Eggs", Done: true}); !errors.Is(err, ErrNoChecklistItem) {
		t.Fatalf("err = %v", err)
	}
}

// Quick ticks on one list arrive together; each is saved on top of the one
// before, so none is lost.
func TestSetChecklistItemKeepsTicksThatArriveTogether(t *testing.T) {
	repo := &checklistRepo{doc: shoppingList()}
	s := &documentService{repo: repo}
	var wg sync.WaitGroup
	for i, text := range []string{"Onion", "Milk"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.SetChecklistItem("usr_1", "doc_1", ChecklistTick{Item: i, Text: text, Done: true}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	for _, item := range richtext.ChecklistItems(repo.doc.Content) {
		if !item.Done {
			t.Fatalf("%q was not kept ticked: %v", item.Text, richtext.ChecklistItems(repo.doc.Content))
		}
	}
}
