package models

import "testing"

func TestEncodeJSONBMap(t *testing.T) {
	raw, err := EncodeJSONB(JSONMap{"type": "doc", "content": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	if raw[0] != '{' {
		t.Fatalf("expected object json, got %s", raw)
	}
}

func TestWriteJSONBRejectsBadIdent(t *testing.T) {
	err := WriteJSONB(nil, "tasks;drop", map[string]any{"x": "{}"}, "id = ?", "1")
	if err == nil {
		t.Fatal("expected invalid table name")
	}
}
