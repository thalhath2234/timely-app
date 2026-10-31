package richtext

import "testing"

// A list that mixes tick boxes with plain items (models often write "- [ ]"
// and "-" lines together) is one checklist, the plain items unticked, and no
// "[ ]" is left as text. Same rule as Help me write; mirrors
// markdown-parity.test.mjs.
func TestMixedListIsAChecklist(t *testing.T) {
	doc, plain := FromMarkdown("- [ ] Flights\n- Notes\n- [x] Insurance\n\n1. Pack\n2. Leave")
	blocks := asSlice(doc["content"])
	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want 2", len(blocks))
	}
	list := blocks[0].(map[string]any)
	if list["type"] != "taskList" {
		t.Fatalf("first block is %v, want taskList", list["type"])
	}
	var checked []bool
	for _, item := range asSlice(list["content"]) {
		node := item.(map[string]any)
		if node["type"] != "taskItem" {
			t.Fatalf("item is %v, want taskItem", node["type"])
		}
		checked = append(checked, node["attrs"].(map[string]any)["checked"].(bool))
	}
	if len(checked) != 3 || checked[0] || checked[1] || !checked[2] {
		t.Fatalf("checked = %v, want [false false true]", checked)
	}
	if kind := blocks[1].(map[string]any)["type"]; kind != "orderedList" {
		t.Fatalf("a list without boxes stays %v, want orderedList", kind)
	}
	if want := "Flights\nNotes\nInsurance\nPack\nLeave"; plain != want {
		t.Fatalf("plain text = %q, want %q", plain, want)
	}
}
