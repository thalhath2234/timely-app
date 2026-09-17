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

func TestProjectTaskViewsRoundTrip(t *testing.T) {
	shown := false
	views := ProjectTaskViews{
		"pr_1": {
			ID:                   "pr_1",
			Name:                 "Timely",
			DataMode:             DataModeTask,
			RenderMode:           RenderModeKanban,
			GroupFields:          []string{"stage"},
			GroupSortDirection:   SortDirectionAsc,
			GroupValueOrders:     map[string][]string{"stage": {"R1", "R2"}},
			SortBy:               SortByPriority,
			SortDirection:        SortDirectionDesc,
			SelectedWorkspaceIds: []string{},
			SelectedStatusIds:    []string{"st_1"},
			ColumnOrder:          []string{"name", "deadline"},
			OptionsVisible:       &shown,
		},
	}
	raw, err := json.Marshal(views)
	if err != nil {
		t.Fatal(err)
	}
	var got ProjectTaskViews
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	saved, ok := got["pr_1"]
	if !ok || saved.RenderMode != RenderModeKanban || saved.SortBy != SortByPriority {
		t.Fatalf("project view did not round-trip: %+v", got)
	}
	if saved.OptionsVisible == nil || *saved.OptionsVisible {
		t.Fatalf("optionsVisible did not round-trip: %+v", saved)
	}
	if err := got.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestAppearanceNormalize(t *testing.T) {
	got, err := Appearance{}.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != ThemeSystem || got.Accent != AccentDefault {
		t.Fatalf("empty appearance = %+v", got)
	}
	got, err = Appearance{Theme: "DARK", Accent: "3e63dd"}.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != ThemeDark || got.Accent != "#3E63DD" {
		t.Fatalf("hex appearance = %+v", got)
	}
	if _, err := (Appearance{Theme: "sepia"}).Normalize(); err == nil {
		t.Fatal("expected invalid theme")
	}
	if _, err := (Appearance{Accent: "violet"}).Normalize(); err == nil {
		t.Fatal("expected invalid accent")
	}
}
