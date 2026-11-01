package decide

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

// Characters JSON escapes ("&" takes six bytes) and non-Latin text push a
// state past the limit long before its rune count does; Fit cuts the field
// that takes the most encoded bytes until the state fits.
func TestFitCutsTheBiggestEncodedField(t *testing.T) {
	items := []map[string]any{}
	for range 12 {
		items = append(items, map[string]any{
			"title":       strings.Repeat("&", 200),
			"description": strings.Repeat("<", 300),
			"tag":         "keep me",
		})
	}
	items = append(items, map[string]any{"title": "Short title", "description": strings.Repeat("会", 2000)})
	state := map[string]any{"tasks": items, "today": "Sunday 1 November 2026"}
	if raw, _ := json.Marshal(state); len(raw) <= MaxStateBytes {
		t.Fatalf("the test state is only %d bytes", len(raw))
	}
	if !Fit(state, items, "description", "title") {
		t.Fatal("the state did not fit")
	}
	raw, _ := json.Marshal(state)
	if len(raw) > MaxStateBytes {
		t.Fatalf("state is %d bytes", len(raw))
	}
	for i, it := range items {
		for _, f := range []string{"title", "description"} {
			if n := utf8.RuneCountInString(it[f].(string)); n < min(fitFloor, len([]rune(it[f].(string)))) {
				t.Errorf("item %d %s cut below the floor: %d", i, f, n)
			}
		}
	}
	if items[0]["tag"] != "keep me" || items[12]["title"] != "Short title" {
		t.Errorf("a field outside the list or under the floor was cut: %v %v", items[0]["tag"], items[12]["title"])
	}
	if !utf8.ValidString(items[12]["description"].(string)) {
		t.Error("cut inside a character")
	}

	// Nothing left to cut: it says so instead of looping.
	big := map[string]any{"blob": strings.Repeat("x", MaxStateBytes+10)}
	if Fit(big, nil, "title") {
		t.Fatal("reported a fit for a state with nothing to cut")
	}
}
