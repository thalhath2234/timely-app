package richtext

import (
	"fmt"
	"strings"
	"timely-api/internal/models"
)

// ChecklistItem is one tick-box item in a doc, read the way the apps read it
// (checklistItems in packages/contract/src/docChecklist.ts), so a card's
// CheckRow and this server agree on which item a tick means.
type ChecklistItem struct {
	// Item is the item's place among the doc's checklist items, from 0,
	// empty ones counted.
	Item int    `json:"item"`
	Text string `json:"text"`
	Done bool   `json:"done"`
	// Heading is the heading above its checklist, when there is one.
	Heading string `json:"heading"`
}

// checklistSkip are blocks whose tick boxes are not checklist items: code,
// diagrams and properties.
var checklistSkip = map[string]bool{"frontmatter": true, "codeBlock": true, "mermaid": true}

// ChecklistItems lists every checklist item in a doc in order, nested ones
// too. Empty items are left out but keep their place in the numbering.
func ChecklistItems(doc models.JSONMap) []ChecklistItem {
	var out []ChecklistItem
	walkChecklist(doc, func(item int, node map[string]any, heading string) bool {
		if text := checklistText(node); text != "" {
			out = append(out, ChecklistItem{Item: item, Text: text, Done: checked(node), Heading: heading})
		}
		return true
	})
	return out
}

// SetChecklistItem ticks or unticks the item at place item when its words
// still match text, else the first item with those words, as CheckRow finds
// it. It changes doc in place and says which item it found and whether its
// state changed.
func SetChecklistItem(doc models.JSONMap, item int, text string, done bool) (ChecklistItem, bool, error) {
	key := checklistKey(text)
	if key == "" {
		return ChecklistItem{}, false, fmt.Errorf("say which item to tick")
	}
	var placed, first map[string]any
	at := -1
	firstAt := -1
	walkChecklist(doc, func(place int, node map[string]any, _ string) bool {
		if checklistKey(checklistText(node)) != key {
			return true
		}
		if place == item {
			placed, at = node, place
			return false
		}
		if first == nil {
			first, firstAt = node, place
		}
		return true
	})
	if placed == nil {
		placed, at = first, firstAt
	}
	if placed == nil {
		return ChecklistItem{}, false, fmt.Errorf("the doc has no item %q", strings.TrimSpace(text))
	}
	changed := checked(placed) != done
	attrs, _ := asMap(placed["attrs"])
	if attrs == nil {
		attrs = map[string]any{}
	}
	attrs["checked"] = done
	placed["attrs"] = attrs
	return ChecklistItem{Item: at, Text: checklistText(placed), Done: done}, changed, nil
}

// walkChecklist calls visit with each taskItem and its place, in doc order,
// until visit returns false.
func walkChecklist(doc models.JSONMap, visit func(item int, node map[string]any, heading string) bool) {
	item := 0
	heading := ""
	stopped := false
	var walk func(raw any)
	walk = func(raw any) {
		node, ok := asMap(raw)
		if !ok || stopped {
			return
		}
		kind, _ := node["type"].(string)
		if checklistSkip[kind] {
			return
		}
		if kind == "heading" {
			heading = strings.Join(strings.Fields(checklistInline(node)), " ")
			return
		}
		if kind == "taskItem" {
			place := item
			item++
			if !visit(place, node, heading) {
				stopped = true
				return
			}
		}
		for _, child := range asSlice(node["content"]) {
			walk(child)
		}
	}
	walk(map[string]any(doc))
}

func checked(node map[string]any) bool {
	attrs, _ := asMap(node["attrs"])
	done, _ := attrs["checked"].(bool)
	return done
}

// checklistText is an item's own words: its paragraphs, not its nested
// items, spaces collapsed.
func checklistText(node map[string]any) string {
	var parts []string
	for _, raw := range asSlice(node["content"]) {
		if child, ok := asMap(raw); ok && child["type"] == "paragraph" {
			parts = append(parts, checklistInline(child))
		}
	}
	return strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
}

// checklistInline is a block's text with a mention read as its label and a
// line break as a space, as the apps read it.
func checklistInline(node map[string]any) string {
	var b strings.Builder
	for _, raw := range asSlice(node["content"]) {
		child, ok := asMap(raw)
		if !ok {
			continue
		}
		switch child["type"] {
		case "text":
			text, _ := child["text"].(string)
			b.WriteString(text)
		case "mention":
			attrs, _ := asMap(child["attrs"])
			if label, ok := attrs["label"]; ok && label != nil {
				b.WriteString(fmt.Sprint(label))
			}
		case "hardBreak":
			b.WriteString(" ")
		default:
			b.WriteString(checklistInline(child))
		}
	}
	return b.String()
}

func checklistKey(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(text), " "))
}
