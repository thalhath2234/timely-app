package richtext

import (
	"encoding/json"
	"reflect"
	"testing"

	"timely-api/internal/models"
)

// checklistDoc is the contract's test doc (scripts/genui.test.mjs): a
// shopping list with a ticked item and an empty one, a heading, a nested
// item and tick boxes inside code, which are not items.
func checklistDoc(t *testing.T) models.JSONMap {
	t.Helper()
	var doc models.JSONMap
	err := json.Unmarshal([]byte(`{"type": "doc", "content": [
		{"type": "taskList", "content": [
			{"type": "taskItem", "attrs": {"checked": false}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Onion"}]}]},
			{"type": "taskItem", "attrs": {"checked": true}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Milk"}]}]},
			{"type": "taskItem", "attrs": {"checked": false}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Pasta   optional"}]}]},
			{"type": "taskItem", "attrs": {"checked": false}, "content": [{"type": "paragraph"}]},
			{"type": "taskItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Ask "}, {"type": "mention", "attrs": {"label": "Sam", "id": "u1"}}]}]}
		]},
		{"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Hardware"}]},
		{"type": "taskList", "content": [
			{"type": "taskItem", "attrs": {"checked": false}, "content": [
				{"type": "paragraph", "content": [{"type": "text", "text": "Nails"}]},
				{"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": false}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Milk"}]}]}]}
			]}
		]},
		{"type": "codeBlock", "content": [{"type": "text", "text": "- [ ] not an item"}]}
	]}`), &doc)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestChecklistItemsNumbersAsTheAppsDo(t *testing.T) {
	got := ChecklistItems(checklistDoc(t))
	want := []ChecklistItem{
		{Item: 0, Text: "Onion"},
		{Item: 1, Text: "Milk", Done: true},
		{Item: 2, Text: "Pasta optional"},
		// The empty item keeps its number.
		{Item: 4, Text: "Ask Sam"},
		{Item: 5, Text: "Nails", Heading: "Hardware"},
		{Item: 6, Text: "Milk", Heading: "Hardware"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestSetChecklistItemTicksTheItemMeant(t *testing.T) {
	doc := checklistDoc(t)
	// The second Milk by its place, though another item has the same words.
	if got, changed, err := SetChecklistItem(doc, 6, "milk", true); err != nil || got.Item != 6 || !got.Done || !changed {
		t.Fatalf("got %+v, %v, %v", got, changed, err)
	}
	// An item that moved since the card was drawn is found by its words.
	if got, _, err := SetChecklistItem(doc, 9, "Onion", true); err != nil || got.Item != 0 {
		t.Fatalf("got %+v, %v", got, err)
	}
	// An item with no attrs yet gets them.
	if got, _, err := SetChecklistItem(doc, 4, "Ask Sam", true); err != nil || got.Item != 4 {
		t.Fatalf("got %+v, %v", got, err)
	}
	if _, changed, err := SetChecklistItem(doc, 1, "Milk", false); err != nil || !changed {
		t.Fatal(err)
	}
	if _, changed, _ := SetChecklistItem(doc, 1, "Milk", false); changed {
		t.Fatal("ticking an item to the state it has changes nothing")
	}
	done := map[int]bool{}
	for _, item := range ChecklistItems(doc) {
		done[item.Item] = item.Done
	}
	if want := map[int]bool{0: true, 1: false, 2: false, 4: true, 5: false, 6: true}; !reflect.DeepEqual(done, want) {
		t.Fatalf("ticks %v, want %v", done, want)
	}
	if _, _, err := SetChecklistItem(doc, 0, "Bread", true); err == nil {
		t.Fatal("an item the doc doesn't have is an error")
	}
	if _, _, err := SetChecklistItem(doc, 0, "not an item", true); err == nil {
		t.Fatal("tick boxes in code are not items")
	}
}
