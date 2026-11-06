package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
)

func rowStep(sheet, tab, item string) Step {
	return Step{Tool: "add_sheet_row", Summary: tab + ": " + item, Status: "pending", Arguments: raw(map[string]any{"sheetId": sheet, "tabId": tab, "cells": map[string]string{"Item": item, "Unit price": "100"}})}
}

func entriesOf(t *testing.T, step Step) (string, string, []map[string]string) {
	t.Helper()
	var in struct {
		SheetID string `json:"sheetId"`
		TabID   string `json:"tabId"`
		Entries []struct {
			Cells map[string]string `json:"cells"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(step.Arguments, &in); err != nil {
		t.Fatal(err)
	}
	cells := make([]map[string]string, len(in.Entries))
	for i, e := range in.Entries {
		cells[i] = e.Cells
	}
	return in.SheetID, in.TabID, cells
}

// The user's request: ten sample expenses in each of three months came back
// as 30 add_sheet_row steps; they become one add_sheet_entries step per tab.
func TestMergeSheetEntriesMakesOneStepPerTab(t *testing.T) {
	var steps []Step
	for _, tab := range []string{"September", "October", "November"} {
		for i := 0; i < 10; i++ {
			steps = append(steps, rowStep("sht_1", tab, fmt.Sprintf("Item %d", i)))
		}
	}
	merged, origins := mergeSheetEntries(steps)
	if len(merged) != 3 {
		t.Fatalf("merged into %d steps, want 3", len(merged))
	}
	for i, tab := range []string{"September", "October", "November"} {
		sheet, gotTab, cells := entriesOf(t, merged[i])
		if merged[i].Tool != "add_sheet_entries" || sheet != "sht_1" || gotTab != tab || len(cells) != 10 {
			t.Fatalf("step %d: %s %s %s %d entries", i, merged[i].Tool, sheet, gotTab, len(cells))
		}
		if cells[0]["Item"] != "Item 0" || cells[9]["Item"] != "Item 9" {
			t.Fatalf("entries out of order: %v", cells)
		}
		if want := "Add 10 entries to " + tab; merged[i].Summary != want || merged[i].Status != "pending" {
			t.Fatalf("summary %q status %q", merged[i].Summary, merged[i].Status)
		}
	}
	if got := origins.label(1); got != "Steps 11–20" {
		t.Fatalf("label %q", got)
	}
}

func TestMergeSheetEntriesKeepsSingleRowsAndOtherTools(t *testing.T) {
	steps := []Step{
		rowStep("sht_1", "October", "Rice"),
		{Tool: "create_task", Summary: "Create", Arguments: raw(map[string]any{"name": "Pay rent"})},
		rowStep("sht_1", "October", "Milk"),
		rowStep("sht_2", "October", "Bread"),
	}
	merged, origins := mergeSheetEntries(steps)
	if len(merged) != 4 || merged[0].Tool != "add_sheet_row" || merged[2].Tool != "add_sheet_row" || merged[3].Tool != "add_sheet_row" {
		t.Fatalf("rows that are not a run were merged: %+v", merged)
	}
	if origins.label(3) != "Step 4" {
		t.Fatalf("label %q", origins.label(3))
	}
}

// Tabs match as the person names them: "October" and " october " are one tab.
func TestMergeSheetEntriesMatchesTabNamesLoosely(t *testing.T) {
	merged, _ := mergeSheetEntries([]Step{rowStep("sht_1", "October", "Rice"), rowStep("sht_1", " october ", "Milk")})
	if len(merged) != 1 || merged[0].Tool != "add_sheet_entries" {
		t.Fatalf("got %+v", merged)
	}
}

// A step that reads a row's result ("$1.row") keeps that row its own step,
// and references to steps after a merged run follow the new numbering.
func TestMergeSheetEntriesRenumbersAndKeepsReferencedRows(t *testing.T) {
	steps := []Step{
		{Tool: "create_sheet", Summary: "Create", Arguments: raw(map[string]any{"title": "Trip"})},
		{Tool: "add_sheet_row", Summary: "a", Arguments: raw(map[string]any{"sheetId": "$0.sheet.id", "cells": map[string]string{"Item": "a"}})},
		{Tool: "add_sheet_row", Summary: "b", Arguments: raw(map[string]any{"sheetId": "$0.sheet.id", "cells": map[string]string{"Item": "b"}})},
		{Tool: "create_task", Summary: "Task", Arguments: raw(map[string]any{"name": "Check", "description": "$1.markdown"})},
		{Tool: "add_sheet_row", Summary: "c", Arguments: raw(map[string]any{"sheetId": "sht_9", "tabId": "Notes", "cells": map[string]string{"Item": "c"}})},
		{Tool: "add_sheet_row", Summary: "d", Arguments: raw(map[string]any{"sheetId": "sht_9", "tabId": "Notes", "cells": map[string]string{"Item": "d", "Price": "$5.00"}})},
		{Tool: "update_task", Summary: "Link", Arguments: raw(map[string]any{"taskId": "$3.task.id", "description": "$0.sheet.title"})},
	}
	merged, origins := mergeSheetEntries(steps)
	tools := []string{}
	for _, s := range merged {
		tools = append(tools, s.Tool)
	}
	if got := strings.Join(tools, ","); got != "create_sheet,add_sheet_row,add_sheet_row,create_task,add_sheet_entries,update_task" {
		t.Fatalf("tools %s", got)
	}
	var last map[string]any
	_ = json.Unmarshal(merged[5].Arguments, &last)
	if last["taskId"] != "$3.task.id" || last["description"] != "$0.sheet.title" {
		t.Fatalf("references %v", last)
	}
	_, _, cells := entriesOf(t, merged[4])
	if cells[1]["Price"] != "$5.00" {
		t.Fatalf("a price was read as a reference: %v", cells[1])
	}
	if origins.label(4) != "Steps 5–6" || origins.label(5) != "Step 7" {
		t.Fatalf("labels %q %q", origins.label(4), origins.label(5))
	}
}

func TestMergeSheetEntriesRenumbersLaterReferences(t *testing.T) {
	steps := []Step{
		rowStep("sht_1", "October", "Rice"),
		rowStep("sht_1", "October", "Milk"),
		{Tool: "create_task", Summary: "Create", Arguments: raw(map[string]any{"name": "Shop"})},
		{Tool: "set_task_labels", Summary: "Tag", Arguments: raw(map[string]any{"taskId": "$2.task.id", "labelIds": []string{"lbl_1"}})},
	}
	merged, _ := mergeSheetEntries(steps)
	var tag map[string]any
	_ = json.Unmarshal(merged[2].Arguments, &tag)
	if len(merged) != 3 || tag["taskId"] != "$1.task.id" {
		t.Fatalf("got %d steps, %v", len(merged), tag)
	}
}

// Through the proposal: the model's 30 rows become three reviewed changes, and
// two rows proposed as direct still need review, as two steps did before.
func TestProposalMergesRowsIntoEntries(t *testing.T) {
	noop := func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }
	sheet := func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]any{"sheet": map[string]any{"id": "sht_1"}}, nil
	}
	catalog := agent.Catalog{"add_sheet_row": {Call: noop}, "add_sheet_entries": {Call: noop}, "get_sheet": {Call: sheet}}
	var steps []any
	for _, tab := range []string{"September", "October", "November"} {
		for i := 0; i < 10; i++ {
			steps = append(steps, map[string]any{"tool": "add_sheet_row", "summary": tab, "arguments": map[string]any{"sheetId": "sht_1", "tabId": tab, "cells": map[string]string{"Item": fmt.Sprint(i)}}})
		}
	}
	p, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", raw(map[string]any{"summary": "Sample expenses", "steps": steps, "remaining": "none"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Steps) != 3 || p.Steps[0].Tool != "add_sheet_entries" {
		t.Fatalf("got %d steps", len(p.Steps))
	}
	two, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", raw(map[string]any{"summary": "Two", "direct": true, "steps": steps[:2]}), nil)
	if err != nil || len(two.Steps) != 1 {
		t.Fatalf("%v %d", err, len(two.Steps))
	}
	if !needsApproval(two.Steps, true) {
		t.Fatal("two entries merged into one step skipped review")
	}
	// Without the entries tool (an older catalog) the rows stay as they were.
	old := agent.Catalog{"add_sheet_row": {Call: noop}, "get_sheet": {Call: sheet}}
	kept, _, err := (&Service{}).prepareProposal(context.Background(), old, "user", raw(map[string]any{"summary": "Two", "steps": steps[:2]}), nil)
	if err != nil || len(kept.Steps) != 2 {
		t.Fatalf("%v %d", err, len(kept.Steps))
	}
}
