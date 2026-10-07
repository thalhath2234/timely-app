package sheet

import (
	"testing"
	"timely-api/internal/models"
)

func TestWorkbookTabsWrapsPrimaryGrid(t *testing.T) {
	columns := models.DefaultSheetColumns()
	sh := &models.Sheet{Title: "  Budget ", Columns: columns, Rows: models.DefaultSheetRows(columns, 2)}
	tabs := workbookTabs(sh)
	if len(tabs) != 1 {
		t.Fatalf("expected one tab, got %d", len(tabs))
	}
	if tabs[0].Name != "Budget" || tabs[0].ID == "" || len(tabs[0].Columns) != len(columns) {
		t.Fatalf("unexpected primary tab %+v", tabs[0])
	}
	idx, err := findTab(tabs, "")
	if err != nil || idx != 0 {
		t.Fatalf("empty id should address the first tab, got %d %v", idx, err)
	}
}

func TestWorkbookTabsCopiesExisting(t *testing.T) {
	sh := &models.Sheet{Tabs: models.SheetTabs{{ID: "tab_a", Name: "A"}, {ID: "tab_b", Name: "B"}}}
	tabs := workbookTabs(sh)
	tabs[0].Name = "renamed"
	if sh.Tabs[0].Name != "A" {
		t.Fatal("workbookTabs must copy, not alias, the stored tabs")
	}
	idx, err := findTab(tabs, "tab_b")
	if err != nil || idx != 1 {
		t.Fatalf("findTab(tab_b) = %d %v", idx, err)
	}
	if _, err := findTab(tabs, "tab_zzz"); err == nil {
		t.Fatal("unknown tab id should fail")
	}
}

func TestGridUpdateMirrorsPrimaryIntoFirstTab(t *testing.T) {
	columns := models.DefaultSheetColumns()
	tabs := models.SheetTabs{{ID: "tab_a", Name: "A", Columns: columns, Rows: models.DefaultSheetRows(columns, 1)}}
	nextRows := models.DefaultSheetRows(columns, 3)
	updates := map[string]any{}
	err := gridUpdate{Rows: &nextRows}.apply("Budget", columns, models.DefaultSheetRows(columns, 1), nil, tabs, updates)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := updates["columns"]; ok {
		t.Fatal("columns were not part of the update")
	}
	if got := updates["rows"].(models.SheetRows); len(got) != 3 {
		t.Fatalf("rows = %d, want 3", len(got))
	}
	if got := updates["tabs"].(models.SheetTabs); len(got[0].Rows) != 3 {
		t.Fatalf("first tab rows = %d, want 3", len(got[0].Rows))
	}
}

type projectScopeRepo struct {
	SheetRepository
}

func (projectScopeRepo) WorkspaceBelongsToUser(userID, workspaceID string) (bool, error) {
	return true, nil
}

func (projectScopeRepo) ProjectBelongsToUser(userID, projectID string) (bool, error) {
	return projectID == "pr_mine", nil
}

func TestSheetRejectsForeignProject(t *testing.T) {
	svc := NewSheetService(projectScopeRepo{}, nil)
	theirs := "pr_theirs"
	if _, err := svc.Update("usr_1", "sht_1", SheetUpdate{ProjectID: &theirs}); err == nil || err.Error() != "project not found" {
		t.Fatalf("update: expected project not found, got %v", err)
	}
	if _, err := svc.Create(&models.Sheet{UserID: "usr_1", WorkspaceID: "ws_1", ProjectID: &theirs}); err == nil || err.Error() != "project not found" {
		t.Fatalf("create: expected project not found, got %v", err)
	}
}
