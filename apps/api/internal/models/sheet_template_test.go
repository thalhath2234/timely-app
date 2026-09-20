package models

import "testing"

func TestCloneGridKeepsFormulasAndValues(t *testing.T) {
	columns := SheetColumns{
		{ID: "col_a", Name: "A", Width: 160, Type: "number"},
		{ID: "col_b", Name: "B", Width: 160, Type: "text"},
	}
	rows := SheetRows{
		{
			ID: "row_1",
			Cells: map[string]string{
				"col_a": "10",
				"col_b": "=IF(A1>0,\"high\",\"low\")",
			},
			Formats: map[string]SheetCellFormat{
				"col_b": {Bold: true},
			},
		},
	}

	nextColumns, nextRows := CloneGrid(columns, rows)
	if len(nextColumns) != 2 || nextColumns[0].ID == "col_a" {
		t.Fatalf("expected remapped columns, got %#v", nextColumns)
	}
	if nextRows[0].Cells[nextColumns[0].ID] != "10" {
		t.Fatalf("value not copied: %#v", nextRows[0].Cells)
	}
	if nextRows[0].Cells[nextColumns[1].ID] != `=IF(A1>0,"high","low")` {
		t.Fatalf("formula not copied: %#v", nextRows[0].Cells)
	}
	if !nextRows[0].Formats[nextColumns[1].ID].Bold {
		t.Fatal("expected format to follow the remapped column")
	}
}

func TestTabFromTemplateUsesFirstTab(t *testing.T) {
	tpl := &SheetTemplate{
		Name: "Budget",
		Columns: SheetColumns{
			{ID: "col_a", Name: "A", Width: 160, Type: "text"},
		},
		Rows: SheetRows{
			{ID: "row_1", Cells: map[string]string{"col_a": "ignored"}},
		},
		Tabs: SheetTabs{
			{
				ID:   "tab_income",
				Name: "Income",
				Columns: SheetColumns{
					{ID: "col_x", Name: "A", Width: 160, Type: "number"},
				},
				Rows: SheetRows{
					{ID: "row_x", Cells: map[string]string{"col_x": "=SUM(A2:A9)"}},
				},
			},
		},
	}

	tab, err := TabFromTemplate(tpl, "")
	if err != nil {
		t.Fatal(err)
	}
	if tab.Name != "Income" {
		t.Fatalf("name = %q", tab.Name)
	}
	if tab.Rows[0].Cells[tab.Columns[0].ID] != "=SUM(A2:A9)" {
		t.Fatalf("formula not copied onto the new tab: %#v", tab.Rows[0].Cells)
	}
}

func TestTabFromTemplateUnknownTab(t *testing.T) {
	tpl := &SheetTemplate{
		Name: "Budget",
		Tabs: SheetTabs{
			{ID: "tab_income", Name: "Income"},
		},
	}

	if _, err := TabFromTemplate(tpl, "tab_missing"); err == nil || err.Error() != "tab not found" {
		t.Fatalf("err = %v", err)
	}
}
