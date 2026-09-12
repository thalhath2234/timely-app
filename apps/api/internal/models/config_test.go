package models

import (
	"encoding/json"
	"testing"
)

func TestTaskViewConfigRoundTripFilters(t *testing.T) {
	hide := false
	view := TaskViewConfig{
		ID:                     "view_reminders",
		Name:                   "Reminders",
		DataMode:               DataModeTask,
		RenderMode:             RenderModeList,
		GroupFields:            []string{},
		GroupSortDirection:     SortDirectionAsc,
		GroupValueOrders:       map[string][]string{},
		SortBy:                 SortByDeadline,
		SortDirection:          SortDirectionAsc,
		SelectedWorkspaceIds:   []string{},
		SelectedStatusIds:      []string{},
		SelectedProjectIds:     []string{"pr_1"},
		SelectedPriorityLevels: []string{PriorityUrgent},
		SelectedLabelIds:       []string{"lbl_1"},
		SelectedStageIds:       []string{"stg_1"},
		ShowCompleted:          &hide,
		OnlyOverdue:            true,
		OnlyScheduled:          true,
		OnlyRecurring:          true,
		ShowReminders:          true,
		ColumnOrder:            []string{},
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var got TaskViewConfig
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !got.ShowReminders || !got.OnlyOverdue || got.ShowCompleted == nil || *got.ShowCompleted {
		t.Fatalf("filter flags did not round-trip: %+v", got)
	}
	if len(got.SelectedProjectIds) != 1 || got.SelectedProjectIds[0] != "pr_1" {
		t.Fatalf("selectedProjectIds = %v", got.SelectedProjectIds)
	}
}
