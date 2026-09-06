package models

import (
	"encoding/json"
	"testing"
)

func TestUnmarshalJSONMapAcceptsArray(t *testing.T) {
	var m JSONMap
	if err := UnmarshalJSONMap([]byte(`[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]`), &m); err != nil {
		t.Fatal(err)
	}
	if m["type"] != "doc" {
		t.Fatalf("expected wrapped doc, got %#v", m)
	}
}

func TestUnmarshalJSONMapUnwrapsQuotedJSON(t *testing.T) {
	var m JSONMap
	inner := `{"type":"doc","content":[{"type":"paragraph"}]}`
	quoted, _ := json.Marshal(inner)
	if err := UnmarshalJSONMap(quoted, &m); err != nil {
		t.Fatal(err)
	}
	if m["type"] != "doc" {
		t.Fatalf("expected doc, got %#v", m)
	}
}

func TestIsDocumentContentEmpty(t *testing.T) {
	if !IsDocumentContentEmpty(EmptyDocumentContent()) {
		t.Fatal("blank paragraph should be empty")
	}
	filled := JSONMap{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type":    "paragraph",
				"content": []any{map[string]any{"type": "text", "text": "hello"}},
			},
		},
	}
	if IsDocumentContentEmpty(filled) {
		t.Fatal("text node should not be empty")
	}
}

func TestDocumentFromPlainText(t *testing.T) {
	doc := DocumentFromPlainText("one\n\ntwo")
	if IsDocumentContentEmpty(doc) {
		t.Fatal("expected paragraphs from plain text")
	}
}

func TestJSONMapValueIsBytes(t *testing.T) {
	m := JSONMap{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}}
	v, err := m.Value()
	if err != nil {
		t.Fatal(err)
	}
	b, ok := v.([]byte)
	if !ok {
		t.Fatalf("Value() should return []byte, got %T", v)
	}
	if !json.Valid(b) {
		t.Fatalf("invalid json %s", b)
	}
}
