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
