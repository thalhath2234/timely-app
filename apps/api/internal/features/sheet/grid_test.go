package sheet

import (
	"encoding/json"
	"testing"

	"timely-api/internal/models"
)

func rowsJSON(t *testing.T, rows models.SheetRows) string {
	t.Helper()
	b, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestAppendRowPlacementPreservesLayout(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(*models.SheetTab)
		want  int
	}{
		{"empty padding", func(tab *models.SheetTab) {}, 0},
		{"internal gap", func(tab *models.SheetTab) { tab.Rows[2].Cells["a"] = "keep" }, 3},
		{"formula", func(tab *models.SheetTab) { tab.Rows[2].Cells["a"] = "=SUM(A1:A2)" }, 3},
		{"note", func(tab *models.SheetTab) {
			tab.Rows[1].Formats = map[string]models.SheetCellFormat{"a": {Note: "keep"}}
		}, 2},
		{"merge", func(tab *models.SheetTab) {
			tab.Merges = models.SheetMerges{{StartRow: 1, RowSpan: 2, StartCol: 0, ColSpan: 1}}
		}, 3},
		{"full", func(tab *models.SheetTab) { tab.Rows[3].Cells["a"] = "keep" }, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tab := models.SheetTab{Rows: models.DefaultSheetRows(nil, 4)}
			tc.setup(&tab)
			before := rowsJSON(t, tab.Rows[:tc.want])
			row := models.SheetRow{ID: "new", Cells: map[string]string{"receipt": "receipt-id"}}
			got := AppendRow(&tab, row)
			if got != tc.want || tab.Rows[got].Cells["receipt"] != "receipt-id" {
				t.Fatalf("got row %d, want %d", got, tc.want)
			}
			if rowsJSON(t, tab.Rows[:tc.want]) != before {
				t.Fatal("existing layout changed")
			}
		})
	}
}

func TestAppendRowGoesAboveTheTotalsRow(t *testing.T) {
	columns := models.SheetColumns{{ID: "item"}, {ID: "qty"}, {ID: "unit"}, {ID: "total"}, {ID: "note"}}
	tab := models.SheetTab{Columns: columns, Rows: models.SheetRows{
		{ID: "rent", Cells: map[string]string{"item": "Rent", "total": "=B1*C1"}},
		{ID: "gym", Cells: map[string]string{"item": "Gym", "total": "=B2*C2"}},
		{ID: "sum", Cells: map[string]string{"item": "Total", "total": "=SUM(D1:D2)+LOG10(D3)", "note": "=D3/2+ATAN2(1,2)"}},
		{ID: "pad", Cells: map[string]string{}},
	}}
	got := AppendRow(&tab, models.SheetRow{ID: "receipt", Cells: map[string]string{"total": "28.76"}})
	if got != 2 || tab.Rows[2].ID != "receipt" || tab.Rows[3].ID != "sum" || len(tab.Rows) != 4 {
		t.Fatalf("receipt at %d, rows %v", got, tab.Rows)
	}
	if tab.Rows[3].Cells["total"] != "=SUM(D1:D3)+LOG10(D4)" || tab.Rows[3].Cells["note"] != "=D4/2+ATAN2(1,2)" {
		t.Fatalf("totals formulas not shifted: %v", tab.Rows[3].Cells)
	}
	if tab.Rows[0].Cells["total"] != "=B1*C1" || tab.Rows[1].Cells["total"] != "=B2*C2" {
		t.Fatal("rows above the total changed")
	}
	// A total over a column the receipt does not fill stays where it is.
	other := models.SheetTab{Columns: columns, Rows: models.SheetRows{
		{ID: "rent", Cells: map[string]string{"qty": "1"}},
		{ID: "sum", Cells: map[string]string{"qty": "=SUM(B1:B1)"}},
	}}
	if got := AppendRow(&other, models.SheetRow{ID: "receipt", Cells: map[string]string{"total": "28.76"}}); got != 2 || other.Rows[1].Cells["qty"] != "=SUM(B1:B1)" {
		t.Fatalf("unrelated total moved: %d %v", got, other.Rows)
	}
}

func TestShiftTotalsFormula(t *testing.T) {
	for _, tc := range []struct {
		in     string
		number int
		want   string
	}{
		{"=SUM(D1:D5)", 6, "=SUM(D1:D6)"},
		{"=SUM($D$1:$D$5)+D6", 6, "=SUM($D$1:$D$6)+D7"},
		{"=D6/2+LOG10(D7)", 6, "=D7/2+LOG10(D7)"},
		{"=SUM(D1:D4)", 6, "=SUM(D1:D4)"},
		{"Total D6", 6, "Total D6"},
	} {
		if got := shiftTotalsFormula(tc.in, tc.number); got != tc.want {
			t.Errorf("shiftTotalsFormula(%q, %d) = %q, want %q", tc.in, tc.number, got, tc.want)
		}
	}
}

func TestTabsOfPresentsPrimaryGridAsOneTab(t *testing.T) {
	columns := models.DefaultSheetColumns()
	legacy := models.Sheet{Columns: columns, Rows: models.DefaultSheetRows(columns, 2)}
	tabs := TabsOf(legacy)
	if len(tabs) != 1 || tabs[0].ID != "primary" || tabs[0].Name != "Expenses" || len(tabs[0].Rows) != 2 {
		t.Fatalf("unexpected primary tab %+v", tabs)
	}
	stored := models.Sheet{Tabs: models.SheetTabs{{ID: "a", Name: "A"}}}
	if got := TabsOf(stored); len(got) != 1 || got[0].ID != "a" {
		t.Fatalf("stored tabs must win: %+v", got)
	}
}
