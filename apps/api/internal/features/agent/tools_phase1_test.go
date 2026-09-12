package agent

import (
	"testing"
	"timely-api/internal/models"
)

func TestCountDocDescendants(t *testing.T) {
	root := "doc_root"
	child := "doc_child"
	grand := "doc_grand"
	docs := []models.Document{
		{ID: root},
		{ID: child, ParentID: &root},
		{ID: grand, ParentID: &child},
		{ID: "doc_other"},
	}
	if got := countDocDescendants(docs, root); got != 2 {
		t.Fatalf("root descendants = %d, want 2", got)
	}
	if got := countDocDescendants(docs, child); got != 1 {
		t.Fatalf("child descendants = %d, want 1", got)
	}
	if got := countDocDescendants(docs, "doc_other"); got != 0 {
		t.Fatalf("leaf descendants = %d, want 0", got)
	}
}

func TestViewFromInputPhase1Filters(t *testing.T) {
	hide := false
	reminders := true
	view := viewFromInput(createViewIn{
		Name:               "Reminders",
		ShowReminders:      &reminders,
		ShowCompleted:      &hide,
		SelectedProjectIds: []string{"pr_1"},
		SelectedStageIds:   []string{"stg_1"},
		OnlyOverdue:        boolPtr(true),
	}, nil)
	if !view.ShowReminders || view.ShowCompleted == nil || *view.ShowCompleted {
		t.Fatalf("create flags: %+v", view)
	}
	if len(view.SelectedProjectIds) != 1 || view.SelectedProjectIds[0] != "pr_1" {
		t.Fatalf("projects = %v", view.SelectedProjectIds)
	}
	if !view.OnlyOverdue {
		t.Fatal("expected onlyOverdue")
	}

	updated := viewFromInput(createViewIn{
		ShowReminders: boolPtr(false),
		Name:          "Work",
	}, &view)
	if updated.ID != view.ID {
		t.Fatal("update should keep id until caller overwrites")
	}
	if updated.ShowReminders {
		t.Fatal("showReminders should clear")
	}
	if len(updated.SelectedProjectIds) != 1 {
		t.Fatalf("omitted project filter should stay, got %v", updated.SelectedProjectIds)
	}
}
