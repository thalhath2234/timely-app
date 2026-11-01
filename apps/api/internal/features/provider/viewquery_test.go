package provider

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"timely-api/internal/models"
)

func testVocab() viewVocab {
	return viewVocab{
		workspaces: []vocabRow{{ID: "w1", Name: "Home"}},
		projects:   []vocabRow{{ID: "p1", Name: "Timely"}},
		labels:     []vocabRow{{ID: "l1", Name: "bug"}},
		fields: []vocabRow{{ID: "c1", Name: "Type", Type: "select", Options: models.Options{Options: []models.Option{{ID: "o1", Value: "Feature"}}}},
			{ID: "c3", Name: "Points", Type: "number"}},
	}
}

func TestParseViewDraftFindsJSONInProse(t *testing.T) {
	draft, err := parseViewDraft("Sure! ```json\n{\"name\":\"Bugs\",\"rules\":[{\"field\":\"label\",\"op\":\"anyOf\",\"value\":[\"bug\"]}]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if draft.Name != "Bugs" || len(draft.Rules) != 1 {
		t.Fatalf("draft = %+v", draft)
	}
	if _, err := parseViewDraft("I can't do that"); err == nil {
		t.Error("want an error when there is no JSON")
	}
}

func TestResolveDraftMapsNamesAndDropsUnknowns(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	draft := viewQueryDraft{
		Name: "  Home bugs ", RenderMode: "gantt", GroupFields: []string{"Type", "cf:Type", "teleport"},
		SortBy: "cf:points", SortDirection: "sideways", ThenSortBy: "nope", Limit: -3,
		Rules: []models.ViewRule{
			{Field: "workspace", Op: "anyOf", Value: raw(`["home"]`)},
			{Field: "label", Op: "anyOf", Value: raw(`"bug"`)},
			{Field: "project", Op: "anyOf", Value: raw(`["Mars"]`)},
			{Field: "priority", Op: "anyOf", Value: raw(`["high","bogus"]`)},
			{Field: "cf:Type", Op: "anyOf", Value: raw(`["feature"]`)},
			{Field: "teleport", Op: "is"},
			{Match: "any", Rules: []models.ViewRule{{Field: "overdue", Op: "is", Value: raw(`true`)}, {Field: "stage", Op: "anyOf", Value: raw(`["Ship"]`)}}},
		},
	}
	out, dropped, err := testVocab().resolveDraft(draft, true)
	if err != nil {
		t.Fatal(err)
	}
	if out.Name != "Home bugs" || out.RenderMode != "list" || out.SortBy != "cf:c3" || out.SortDirection != "asc" || out.ThenSortBy != "" || out.Limit != 0 {
		t.Fatalf("sanitized = %+v", out)
	}
	if strings.Join(out.GroupFields, ",") != "cf:c1" {
		t.Fatalf("groups = %v", out.GroupFields)
	}
	got := []string{}
	for _, rule := range out.Rules {
		if len(rule.Rules) > 0 {
			got = append(got, "group:"+string(rule.Rules[0].Field))
			if len(rule.Rules) != 1 {
				t.Errorf("group kept %d rules, want 1", len(rule.Rules))
			}
			continue
		}
		got = append(got, rule.Field+"="+string(rule.Value))
	}
	want := `workspace=["w1"] label=["l1"] priority=["High"] cf:c1=["o1"] group:overdue`
	if strings.Join(got, " ") != want {
		t.Fatalf("rules = %s\nwant    %s", strings.Join(got, " "), want)
	}
	if len(dropped) != 3 {
		t.Errorf("dropped = %v, want the project, the bad field and the stage", dropped)
	}
}

// A view whose every filter names something that does not exist is not
// made: with no rules left it would show every task (W7).
func TestViewQueryRefusesAViewWithNothingLeft(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	resolve := func(rules ...models.ViewRule) error {
		draft := viewQueryDraft{Name: "Atlantis tasks", Rules: rules}
		asked := len(draft.Rules)
		out, dropped, err := testVocab().resolveDraft(draft, false)
		if err != nil {
			t.Fatal(err)
		}
		return nothingLeft(asked, out, dropped)
	}
	err := resolve(models.ViewRule{Field: "project", Op: "anyOf", Value: raw(`["Atlantis"]`)})
	var he *echo.HTTPError
	if !errors.As(err, &he) || he.Code != 422 || !strings.Contains(fmt.Sprint(he.Message), "no project named Atlantis") {
		t.Fatalf("want 422 naming the project, got %v", err)
	}
	// A group whose rules all fail goes the same way.
	group := models.ViewRule{Match: "any", Rules: []models.ViewRule{{Field: "stage", Op: "anyOf", Value: raw(`["Ship"]`)}}}
	if err := resolve(group); err == nil {
		t.Error("an emptied group must not leave a view of everything")
	}
	// Some rules left: the view is made, and what was left out is reported.
	if err := resolve(models.ViewRule{Field: "label", Op: "anyOf", Value: raw(`["bug"]`)}, models.ViewRule{Field: "project", Op: "anyOf", Value: raw(`["Atlantis"]`)}); err != nil {
		t.Errorf("a view with a rule left must be made: %v", err)
	}
	// No rules asked for (only a sort): nothing was dropped, so it is fine.
	if err := resolve(); err != nil {
		t.Errorf("a view with no rules asked for: %v", err)
	}
}
