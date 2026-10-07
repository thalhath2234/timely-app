package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"timely-api/internal/features/agent"
)

func TestApprovalBoundaries(t *testing.T) {
	tests := []struct {
		name, tool, args string
		want             bool
	}{
		{"single cell", "update_sheet_cells", `{"cells":{"col":"25"}}`, false},
		{"multiple cells", "update_sheet_cells", `{"cells":{"a":"25","b":"30"}}`, true},
		{"replace grid", "update_sheet", `{"rows":[]}`, true},
		{"column data loss", "update_sheet_column", `{"type":"number"}`, true},
		{"delete row", "delete_sheet_rows", `{"rowIds":["row"]}`, true},
		{"rename sheet", "update_sheet", `{"title":"Budget"}`, false},
		{"document replace", "update_doc", `{"markdown":"replacement"}`, true},
		{"recurrence through general update", "update_event", `{"recurrence":{"rrule":"FREQ=WEEKLY"}}`, true},
		{"calendar placement", "auto_schedule_apply", `{}`, true},
		{"plain create", "create_task", `{"name":"Read"}`, false},
		{"delete checklist item", "delete_checklist_item", `{"taskId":"tsk","itemId":"itm"}`, true},
		{"delete block", "delete_block", `{"blockId":"blk"}`, true},
		{"delete task (MCP only, still reviewed)", "delete_task", `{"taskId":"tsk"}`, true},
		{"clear blocks", "clear_task_blocks", `{"taskId":"tsk"}`, true},
		{"working hours", "update_working_hours", `{"timezone":"Asia/Tokyo","days":{}}`, true},
		{"undo auto-schedule", "undo_schedule", `{}`, true},
		{"mark every notification read", "mark_notification_read", `{}`, true},
		{"mark one notification read", "mark_notification_read", `{"id":"ntf"}`, false},
		{"start focus", "start_focus", `{"taskId":"tsk"}`, false},
		{"today focus", "set_today_focus", `{"taskId":"tsk","date":"2026-10-02"}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := needsApproval([]Step{{Tool: tt.tool, Arguments: json.RawMessage(tt.args)}}, true); got != tt.want {
				t.Fatalf("approval=%v want %v", got, tt.want)
			}
		})
	}
	if !needsApproval([]Step{{Tool: "create_workspace"}, {Tool: "create_task"}}, true) {
		t.Fatal("multi-step bypassed approval")
	}
	if !needsApproval([]Step{{Tool: "create_task"}}, false) {
		t.Fatal("model-required proposal bypassed approval")
	}
}
func TestCatalogScope(t *testing.T) {
	if !isWriteTool("create_sheet_template") || !isWriteTool("update_sheet_template") {
		t.Fatal("chat cannot create or rename reusable templates")
	}
	catalog := agent.NewCatalog(agent.Deps{})
	reads, writes := 0, 0
	for name, tool := range catalog {
		if isReadTool(name) || isWriteTool(name) {
			if tool.Call == nil {
				t.Errorf("missing shared Hermes handler %s", name)
			}
		}
		if isReadTool(name) && isWriteTool(name) {
			t.Errorf("%s is both read and write", name)
		}
		if isReadTool(name) {
			reads++
		}
		if isWriteTool(name) {
			writes++
		}
	}
	if reads == 0 || writes == 0 {
		t.Fatalf("chat sees %d read and %d write tools", reads, writes)
	}
	for _, name := range []string{"delete_task", "delete_event", "delete_doc", "delete_sheet", "delete_label", "delete_stage", "update_working_hours", "update_notification_settings", "update_schedule_settings", "delete_workspace", "delete_project", "delete_status", "delete_custom_field", "delete_backup", "restore_account", "update_profile", "update_account_config", "clear_notifications", "create_backup", "export_account"} {
		if isWriteTool(name) || isReadTool(name) {
			t.Errorf("unexpected authority for %s", name)
		}
	}
	if isWriteTool("no_such_tool") || isReadTool("no_such_tool") || !needsApproval([]Step{{Tool: "no_such_tool", Arguments: raw(map[string]any{})}}, true) {
		t.Error("an undeclared tool must be unavailable and always reviewed")
	}
}
func TestReferencesUseCompletedResults(t *testing.T) {
	steps := []Step{{Status: "done", Result: raw(map[string]any{"sheet": map[string]any{"id": "sht_actual"}})}, {Status: "pending"}}
	got, err := resolve(map[string]any{"sheetId": "$0.sheet.id", "title": "Budget $20"}, steps, 1)
	if err != nil {
		t.Fatal(err)
	}
	m := got.(map[string]any)
	if m["sheetId"] != "sht_actual" || m["title"] != "Budget $20" {
		t.Fatal(m)
	}
	for _, ref := range []string{"$1.id", "$3.id", "$0.missing", "$-1.id"} {
		if _, err := resolve(ref, steps, 1); err == nil {
			t.Errorf("accepted %s", ref)
		}
	}
}

func TestBulkProposalSnapshotsEveryTask(t *testing.T) {
	catalog := agent.Catalog{"get_task": {Call: func(ctx context.Context, uid string, args json.RawMessage) (any, error) {
		var input map[string]string
		if err := json.Unmarshal(args, &input); err != nil {
			return nil, err
		}
		if uid != "owner" {
			t.Fatal("wrong owner")
		}
		return map[string]string{"id": input["taskId"], "name": "Before"}, nil
	}}}
	steps := []Step{{Tool: "bulk_update_tasks", Arguments: raw(map[string]any{"ids": []string{"first", "second"}, "update": map[string]any{"priorityLevel": 2}})}}
	s := &Service{}
	snapshots, err := s.snapshots(context.Background(), nil, catalog, "owner", steps)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 2 || snapshots[0].Hash == snapshots[1].Hash {
		t.Fatalf("missing per-task versions: %v", snapshots)
	}
	var before []any
	if err := json.Unmarshal(steps[0].Before, &before); err != nil || len(before) != 2 {
		t.Fatal("bulk review must include every prior task")
	}
}

func TestProposalRejectsAccidentalSequentialGridReplacement(t *testing.T) {
	catalog := agent.NewCatalog(agent.Deps{})
	s := &Service{}
	_, _, err := s.prepareProposal(context.Background(), catalog, "user", raw(map[string]any{
		"summary": "Create expense tracker", "direct": false,
		"steps": []any{
			map[string]any{"tool": "update_sheet", "summary": "Add transactions", "arguments": map[string]any{"sheetId": "$0.sheet.id", "rows": []any{map[string]any{"id": "expense", "cells": map[string]string{"amount": "25"}}}}},
			map[string]any{"tool": "update_sheet", "summary": "Add totals", "arguments": map[string]any{"sheetId": "$0.sheet.id", "rows": []any{map[string]any{"id": "total", "cells": map[string]string{"amount": "=SUM(A1:A1)"}}}}},
		}}), nil)
	if err == nil || !strings.Contains(err.Error(), "does not append") {
		t.Fatalf("accepted silent replacement: %v", err)
	}
}

func TestProposalRejectsDeprecatedSheetDescription(t *testing.T) {
	catalog := agent.NewCatalog(agent.Deps{})
	schema, err := catalog["create_sheet"].Parameters.Resolve(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(map[string]any{"title": "Expenses", "description": "Unsupported"}); err == nil {
		t.Fatal("deprecated description reached execution")
	}
}
