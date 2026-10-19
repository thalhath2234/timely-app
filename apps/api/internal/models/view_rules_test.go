package models

import (
	"encoding/json"
	"testing"
)

func TestValidateRules(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	good := []ViewRule{
		{Field: "deadline", Op: "in", Value: raw(`"thisWeek"`)},
		{Field: "overdue", Op: "is", Value: raw(`false`)},
		{Field: "cf:abc", Op: "gt", Value: raw(`0`)},
		{Match: "any", Rules: []ViewRule{{Field: "blocked", Op: "is", Value: raw(`true`)}, {Field: "label", Op: "isEmpty"}}},
	}
	if err := ValidateRules(good, "any"); err != nil {
		t.Fatalf("good rules: %v", err)
	}
	bad := map[string][]ViewRule{
		"unknown field": {{Field: "teleport", Op: "is"}},
		"unknown op":    {{Field: "deadline", Op: "teleport"}},
		"bad json":      {{Field: "name", Op: "contains", Value: raw(`{`)}},
		"nested group":  {{Match: "any", Rules: []ViewRule{{Match: "all", Rules: []ViewRule{{Field: "done", Op: "is"}}}}}},
		"empty group":   {{Match: "any", Rules: []ViewRule{}}},
		"group match":   {{Match: "some", Rules: []ViewRule{{Field: "done", Op: "is"}}}},
	}
	for name, rules := range bad {
		if err := ValidateRules(rules, ""); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
	if err := ValidateRules(nil, "most"); err == nil {
		t.Error("ruleMatch most: want an error")
	}
	many := make([]ViewRule, MaxViewRules+1)
	for i := range many {
		many[i] = ViewRule{Field: "done", Op: "is"}
	}
	if err := ValidateRules(many, ""); err == nil {
		t.Error("too many rules: want an error")
	}
}

func TestViewRulesRoundTripKeepFalseAndZero(t *testing.T) {
	view := TaskViewConfig{
		ID: "v", Name: "v", DataMode: DataModeTask, RenderMode: RenderModeList,
		GroupFields: []string{"deadline", "label"}, GroupSortDirection: SortDirectionAsc,
		SortBy: SortByPriority, SortDirection: SortDirectionDesc, ThenSortBy: "cf:points", ThenSortDirection: SortDirectionAsc,
		SelectedWorkspaceIds: []string{}, SelectedStatusIds: []string{}, Limit: 5, RuleMatch: "any",
		Rules: []ViewRule{{Field: "overdue", Op: "is", Value: json.RawMessage(`false`)}, {Field: "duration", Op: "gt", Value: json.RawMessage(`0`)}},
	}
	if err := view.Validate(nil); err != nil {
		t.Fatalf("validate: %v", err)
	}
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var back TaskViewConfig
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if string(back.Rules[0].Value) != "false" || string(back.Rules[1].Value) != "0" || back.Limit != 5 || back.ThenSortBy != "cf:points" {
		t.Fatalf("round trip lost fields: %s", data)
	}
	view.Limit = MaxViewLimit + 1
	if err := view.Validate(nil); err == nil {
		t.Error("limit over max: want an error")
	}
}
