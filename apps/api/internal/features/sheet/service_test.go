package sheet

import (
	"errors"
	"testing"
	"timely-api/internal/models"

	"gorm.io/gorm"
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

func TestMergeTabsKeepsTabsTheClientDidNotSend(t *testing.T) {
	current := models.SheetTabs{{ID: "jan", Name: "January"}, {ID: "feb", Name: "February"}}
	changed := models.SheetTabs{{ID: "feb", Name: "Feb edited"}, {ID: "mar", Name: "March"}}
	merged, err := mergeTabs(current, &changed, []string{"jan", "feb", "mar"})
	if err != nil {
		t.Fatal(err)
	}
	if len(merged) != 3 || merged[0].Name != "January" || merged[1].Name != "Feb edited" || merged[2].Name != "March" {
		t.Fatalf("unexpected merge %+v", merged)
	}
	dropped, err := mergeTabs(current, nil, []string{"feb"})
	if err != nil || len(dropped) != 1 || dropped[0].ID != "feb" {
		t.Fatalf("tabs missing from the order should be removed, got %+v %v", dropped, err)
	}
	if _, err := mergeTabs(current, nil, []string{"jan", "nope"}); err == nil {
		t.Fatal("an id the server does not know must be rejected, not dropped")
	}
}

func TestPrepareGridMakesTabNamesUnique(t *testing.T) {
	columns := models.DefaultSheetColumns()
	tabs := models.SheetTabs{
		{ID: "a", Name: "Food", Columns: columns, Rows: models.DefaultSheetRows(columns, 1)},
		{ID: "b", Name: "food", Columns: columns, Rows: models.DefaultSheetRows(columns, 1)},
		{ID: "c", Name: "Food", Columns: columns, Rows: models.DefaultSheetRows(columns, 1)},
	}
	var cols models.SheetColumns
	var rows models.SheetRows
	var merges models.SheetMerges
	if err := prepareGrid("Budget", &cols, &rows, &merges, &tabs); err != nil {
		t.Fatal(err)
	}
	if tabs[0].Name != "Food" || tabs[1].Name != "food (2)" || tabs[2].Name != "Food (3)" {
		t.Fatalf("names = %q %q %q", tabs[0].Name, tabs[1].Name, tabs[2].Name)
	}
}

// templateStore keeps sheet templates in memory, scoped by owner like the
// real repository's WHERE user_id = ?.
type templateStore struct {
	SheetRepository
	owners map[string]string
}

func (s *templateStore) GetTemplateByID(userID, templateID string) (*models.SheetTemplate, error) {
	if s.owners[templateID] != userID {
		return nil, gorm.ErrRecordNotFound
	}
	return &models.SheetTemplate{ID: templateID, UserID: userID}, nil
}

func (s *templateStore) DeleteTemplate(userID, templateID string) error {
	if s.owners[templateID] == userID {
		delete(s.owners, templateID)
	}
	return nil
}

func TestDeleteTemplateOnlyByItsOwner(t *testing.T) {
	store := &templateStore{owners: map[string]string{"shtpl_1": "usr_1"}}
	svc := NewSheetService(store, nil)

	if err := svc.DeleteTemplate("usr_2", "shtpl_1"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("someone else's delete: expected not found, got %v", err)
	}
	if _, ok := store.owners["shtpl_1"]; !ok {
		t.Fatal("someone else deleted the template")
	}
	if err := svc.DeleteTemplate("usr_1", "shtpl_1"); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	if _, ok := store.owners["shtpl_1"]; ok {
		t.Fatal("template still there after the owner deleted it")
	}
	if err := svc.DeleteTemplate("usr_1", "shtpl_1"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("second delete: expected not found, got %v", err)
	}
}
