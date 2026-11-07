package bots

import (
	"encoding/json"
	"testing"
)

// A PATCH's "knowledge": left out keeps it, null clears it, an object sets
// it, anything else is refused.
func TestKnowledgePatch(t *testing.T) {
	for _, c := range []struct {
		raw   string
		in    *KnowledgeInput
		clear bool
		bad   bool
	}{
		{raw: ""},
		{raw: "null", clear: true},
		{raw: ` null `, clear: true},
		{raw: `{"kind":"sheet","id":"sht_1"}`, in: &KnowledgeInput{Kind: "sheet", ID: "sht_1"}},
		{raw: `"sheet"`, bad: true},
		{raw: `[1]`, bad: true},
	} {
		in, clear, err := KnowledgePatch(json.RawMessage(c.raw))
		if (err != nil) != c.bad || clear != c.clear || (in == nil) != (c.in == nil) || (in != nil && *in != *c.in) {
			t.Errorf("%q: %+v %v %v", c.raw, in, clear, err)
		}
	}
}

// Worked-out cells keep to their line and column, numbers without an
// exponent, errors by their code.
func TestKnowledgeCells(t *testing.T) {
	for _, c := range []struct {
		v    any
		want string
	}{
		{nil, ""},
		{80.0, "80"},
		{1234567.5, "1234567.5"},
		{true, "true"},
		{"a\tb\nc", "a b c"},
		{map[string]any{"error": "#DIV/0!"}, "#DIV/0!"},
	} {
		if got := tsvCell(cellText(c.v)); got != c.want {
			t.Errorf("%v: %q, want %q", c.v, got, c.want)
		}
	}
}
