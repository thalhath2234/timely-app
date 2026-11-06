package sheet

import (
	"strings"
	"testing"

	"timely-api/internal/models"
)

// memRepo keeps one sheet and applies the tab updates a save writes.
type memRepo struct {
	SheetRepository
	sheet *models.Sheet
	saves int
}

func (r *memRepo) GetSheetByID(userID, sheetID string) (*models.Sheet, error) {
	copy := *r.sheet
	copy.Tabs = append(models.SheetTabs{}, r.sheet.Tabs...)
	return &copy, nil
}

func (r *memRepo) UpdateSheet(userID, sheetID string, updates map[string]any) (*models.Sheet, error) {
	r.saves++
	if tabs, ok := updates["tabs"].(models.SheetTabs); ok {
		r.sheet.Tabs = tabs
	}
	return r.GetSheetByID(userID, sheetID)
}

// Ten sample expenses for a month go into the month's prepared rows in one
// save, in order, above the totals, the way ten single entries would.
func TestAddEntriesWritesAllInOneSave(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	sh.ID = "sht_1"
	repo := &memRepo{sheet: sh}
	svc := NewSheetService(repo, nil, nil).(*sheetService)
	var september models.SheetTab
	for _, tab := range sh.Tabs {
		if tab.Name == "September" {
			september = tab
		}
	}
	col := map[string]string{}
	for _, column := range september.Columns {
		col[column.Name] = column.ID
	}
	entries := []map[string]string{}
	for _, item := range []string{"Rent", "Rice", "Milk"} {
		entries = append(entries, map[string]string{col["Item"]: item, col["Unit price"]: "100"})
	}
	saved, indexes, err := svc.AddEntries("usr_1", "sht_1", september.ID, entries)
	if err != nil {
		t.Fatal(err)
	}
	if repo.saves != 1 {
		t.Fatalf("%d saves, want 1", repo.saves)
	}
	if len(indexes) != 3 || indexes[0] != 1 || indexes[1] != 2 || indexes[2] != 3 {
		t.Fatalf("rows %v", indexes)
	}
	var tab models.SheetTab
	for _, t := range saved.Tabs {
		if t.Name == "September" {
			tab = t
		}
	}
	for i, item := range []string{"Rent", "Rice", "Milk"} {
		if got := tab.Rows[indexes[i]].Cells[col["Item"]]; got != item {
			t.Fatalf("row %d holds %q, want %q", indexes[i]+1, got, item)
		}
	}
	if !strings.Contains(tab.Rows[0].Cells[col["Total"]], "SUM(") {
		t.Fatalf("month total changed: %q", tab.Rows[0].Cells[col["Total"]])
	}
	// An unknown column stops the whole call: nothing is written.
	before := repo.saves
	if _, _, err := svc.AddEntries("usr_1", "sht_1", september.ID, []map[string]string{{col["Item"]: "Bread"}, {"col_missing": "x"}}); err == nil {
		t.Fatal("an entry with an unknown column was accepted")
	}
	if repo.saves != before {
		t.Fatal("a failed call saved the sheet")
	}
}
