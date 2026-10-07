package chat

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"timely-api/internal/features/agent"
)

// Characterization of needsApproval (ADR 0007 Agent proposal rules): the
// outcome for every tool in the shared catalog, across representative argument
// sets. It records behaviour rather than prescribing it, so it must pass
// unchanged before and after the policy moves into the tool declarations.

// Tools whose single direct call needs an Agent proposal whatever the arguments
// are. mark_notification_read and update_sheet_cells are argument-dependent but
// need one for empty arguments, so they are listed in argumentCases instead.
var alwaysReviewed = toolSet(`add_sheet_rows auto_schedule_apply bulk_update_tasks clear_task_blocks clear_task_recurrence
	delete_backup delete_block delete_checklist_item delete_custom_field delete_doc delete_event delete_label delete_project
	delete_sheet delete_sheet_column delete_sheet_rows delete_sheet_tab delete_sheet_template delete_stage delete_status
	delete_task delete_task_view delete_workspace edit_event_occurrence edit_task_occurrence set_task_recurrence
	split_event_series split_task_series undo_schedule update_notification_settings update_working_hours`)

// Tools whose outcome depends on the arguments. Every tool not listed here
// returns the same outcome for every argument set.
var argumentCases = map[string][]struct {
	args string
	want bool
}{
	"update_sheet_cells": {
		{`{"cells":{"col":"25"}}`, false}, {`{"cells":{"a":"25","b":"30"}}`, true}, {`{"cells":{}}`, true},
		{`{"cells":null}`, true}, {`{"cells":["a"]}`, true}, {`{}`, true}, {`null`, true}, {``, true},
		{`{"sheetId":"sht","rowId":"r","cells":{"col":""}}`, false},
	},
	"update_sheet": {
		{`{"title":"Budget"}`, false}, {`{"sheetId":"sht","icon":"x"}`, false}, {`{}`, false},
		{`{"rows":[]}`, true}, {`{"columns":[]}`, true}, {`{"tabs":[]}`, true}, {`{"merges":[]}`, true},
		{`{"rows":null}`, true}, {`{"title":"Budget","merges":[{}]}`, true},
	},
	"update_sheet_column": {
		{`{"name":"Cost"}`, false}, {`{}`, false}, {`{"type":"number"}`, true}, {`{"type":null}`, true},
		{`{"name":"Cost","options":["a"]}`, false},
	},
	"create_sheet": {
		{`{"title":"Expenses"}`, false}, {`{"templateId":""}`, false}, {`{"templateId":null}`, false}, {`{}`, false},
		{`{"templateId":"tst"}`, true}, {`{"title":"Expenses","templateId":"tst"}`, true}, {`{"templateId":5}`, true},
	},
	"update_doc": {
		{`{"title":"Notes"}`, false}, {`{}`, false}, {`{"markdown":"replacement"}`, true}, {`{"markdown":""}`, true},
		{`{"title":"Notes","markdown":"x"}`, true},
	},
	"update_task": {
		{`{"name":"Read"}`, false}, {`{}`, false}, {`{"recurrence":{"rrule":"FREQ=WEEKLY"}}`, true}, {`{"recurrence":null}`, true},
		{`{"clearRecurrence":true}`, true}, {`{"clearRecurrence":false}`, true}, {`{"name":"Read","recurrence":{}}`, true},
	},
	"update_event": {
		{`{"title":"Lunch"}`, false}, {`{}`, false}, {`{"recurrence":{"rrule":"FREQ=WEEKLY"}}`, true}, {`{"recurrence":null}`, true},
		{`{"clearRecurrence":true}`, true}, {`{"clearRecurrence":false}`, true},
	},
	"mark_notification_read": {
		{`{"id":"ntf"}`, false}, {`{"id":""}`, true}, {`{}`, true}, {`null`, true}, {``, true}, {`{"id":5}`, true},
	},
}

// Argument sets that match none of the argument-dependent rules above.
var neutralArguments = []string{``, `null`, `{}`, `{"name":"x"}`, `{"taskId":"tsk","summary":"s"}`, `{"id":"x","confirm":true}`, `not json`}

func approval(tool, args string, direct bool) bool {
	return needsApproval([]Step{{Tool: tool, Arguments: json.RawMessage(args)}}, direct)
}

func TestApprovalCharacterization(t *testing.T) {
	catalog := agent.NewCatalog(agent.Deps{})
	tools := make([]string, 0, len(catalog))
	for name := range catalog {
		tools = append(tools, name)
	}
	sort.Strings(tools)
	if len(tools) < 100 {
		t.Fatalf("catalog suspiciously small: %d", len(tools))
	}
	for _, tool := range tools {
		t.Run(tool, func(t *testing.T) {
			// Several steps, and a proposal the model itself required, are always reviewed.
			if !needsApproval([]Step{{Tool: tool}, {Tool: tool}}, true) {
				t.Error("multi-step plan bypassed approval")
			}
			if !needsApproval(nil, true) {
				t.Error("empty plan bypassed approval")
			}
			if cases, ok := argumentCases[tool]; ok {
				for _, c := range cases {
					if got := approval(tool, c.args, true); got != c.want {
						t.Errorf("args %q: approval=%v want %v", c.args, got, c.want)
					}
					if !approval(tool, c.args, false) {
						t.Errorf("args %q: model-required proposal bypassed approval", c.args)
					}
				}
				return
			}
			want := alwaysReviewed[tool]
			for _, args := range neutralArguments {
				if got := approval(tool, args, true); got != want {
					t.Errorf("args %q: approval=%v want %v", args, got, want)
				}
				if !approval(tool, args, false) {
					t.Errorf("args %q: model-required proposal bypassed approval", args)
				}
			}
		})
	}
	for tool := range alwaysReviewed {
		if catalog[tool].Call == nil {
			t.Errorf("alwaysReviewed lists unknown tool %s", tool)
		}
	}
	for tool := range argumentCases {
		if catalog[tool].Call == nil || alwaysReviewed[tool] {
			t.Errorf("argumentCases lists unknown or duplicated tool %s", tool)
		}
	}
}

func toolSet(list string) map[string]bool {
	out := map[string]bool{}
	for _, name := range strings.Fields(list) {
		out[name] = true
	}
	return out
}
