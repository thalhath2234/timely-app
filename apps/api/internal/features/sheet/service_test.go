package sheet

import (
	"testing"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
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
	svc := NewSheetService(projectScopeRepo{}, nil, nil)
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

type liveRepo struct {
	SheetRepository
}

func (liveRepo) UpdateSheet(userID, sheetID string, updates map[string]any) (*models.Sheet, error) {
	return &models.Sheet{ID: sheetID, UserID: userID, Title: "Budget", UpdatedAt: "2026-10-15T07:00:00Z"}, nil
}

func (liveRepo) GetSheetByID(userID, sheetID string) (*models.Sheet, error) {
	return &models.Sheet{ID: sheetID, UserID: userID}, nil
}

func (liveRepo) DeleteSheet(userID, sheetID string) error { return nil }

// Dashboard cards built from a sheet watch it: every save, including an
// agent's, must reach the open watch streams with the saved sheet.
func TestSheetSavesReachWatchers(t *testing.T) {
	hub := realtime.NewHub()
	svc := NewSheetService(liveRepo{}, nil, hub)
	events, cancel := hub.Subscribe("usr_1", "sht_1")
	defer cancel()
	other, cancelOther := hub.Subscribe("usr_2", "sht_1")
	defer cancelOther()

	title := "Budget"
	if _, err := svc.Update("usr_1", "sht_1", SheetUpdate{Title: &title}); err != nil {
		t.Fatal(err)
	}
	ev := <-events
	if ev.Type != "updated" || ev.Kind != "sheet" || ev.ID != "sht_1" || ev.UpdatedAt != "2026-10-15T07:00:00Z" {
		t.Fatalf("unexpected event %+v", ev)
	}
	if sheet, ok := ev.Document.(*models.Sheet); !ok || sheet.Title != "Budget" {
		t.Fatalf("event should carry the saved sheet, got %#v", ev.Document)
	}
	if err := svc.Delete("usr_1", "sht_1"); err != nil {
		t.Fatal(err)
	}
	if ev := <-events; ev.Type != "deleted" {
		t.Fatalf("expected deleted, got %+v", ev)
	}
	select {
	case ev := <-other:
		t.Fatalf("another account's watcher got %+v", ev)
	default:
	}
}
