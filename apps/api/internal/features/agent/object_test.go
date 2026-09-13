package agent

import "testing"

func TestObjectContentWrapsSlices(t *testing.T) {
	got := objectContent([]string{"a", "b"})
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", got)
	}
	if _, ok := m["items"]; !ok {
		t.Fatal("expected items key")
	}

	dict := objectContent(map[string]any{"tasks": []string{"x"}})
	if _, ok := dict.(map[string]any); !ok {
		t.Fatalf("dict should stay a map, got %T", dict)
	}
}
