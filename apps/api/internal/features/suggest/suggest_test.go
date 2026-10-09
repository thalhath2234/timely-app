package suggest

import (
	"strings"
	"testing"

	"timely-api/internal/models"
)

func TestNamedIn(t *testing.T) {
	projects := []namedProject{
		{ID: "t", Title: "Timely"},
		{ID: "tw", Title: "Timely website"},
		{ID: "h", Title: "Hobby"},
		{ID: "h2", Title: "hobby"},
	}
	for _, tc := range []struct {
		title, want string
	}{
		{"Do an audit on Timely", "t"},
		{"Fix the timely website footer", "tw"}, // the longer name wins
		{"Timelyish thoughts", ""},              // whole words only
		{"Sort out hobby gear", ""},             // two projects, same name
		{"Buy milk", ""},
	} {
		got, ok := namedIn(tc.title, projects)
		if (tc.want == "") == ok || (ok && got.ID != tc.want) {
			t.Errorf("%q: got %q %v, want %q", tc.title, got.ID, ok, tc.want)
		}
	}
}

func TestRequirements(t *testing.T) {
	item := func(text string) map[string]any {
		return map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}}}
	}
	rich := models.JSONMap{"type": "doc", "content": []any{map[string]any{"type": "bulletList", "content": []any{item("Pick tiles"), item("Old item")}}}}
	// The plain text was edited since: the dropped editor item no longer counts.
	got := requirements(models.Project{Description: "Pick tiles\nNew sink", DescriptionRich: rich})
	if len(got) != 1 || got[0] != "Pick tiles" {
		t.Fatalf("rich: %v", got)
	}
	got = requirements(models.Project{Description: "Goals:\n- Pick tiles\n2. Replace  the sink\n[ ] Paint\nnot a list"})
	if strings.Join(got, "|") != "Pick tiles|Replace the sink|Paint" {
		t.Fatalf("plain: %v", got)
	}
}

func TestParseWhen(t *testing.T) {
	for _, v := range []string{"2026-10-09T12:00:00Z", "2026-10-09 12:00:00.123456+00", "2026-10-09"} {
		if parseWhen(v).IsZero() {
			t.Errorf("%q did not parse", v)
		}
	}
	if !parseWhen("").IsZero() {
		t.Error("empty parsed")
	}
}

func TestSimilarNames(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"Bug", "bugs", true}, {"Urgent", "Urgnet", true}, {"Website", "Web site redesign", false}, {"Home", "Work", false}, {"Client calls", "Calls", true}} {
		if similarNames(c.a, c.b) != c.want {
			t.Errorf("%q %q: want %v", c.a, c.b, c.want)
		}
	}
}
