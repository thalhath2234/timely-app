package sheet

import (
	"strings"
	"testing"

	"timely-api/internal/models"
)

func TestBuildBuiltinYearlyExpenses(t *testing.T) {
	list, err := BuiltinTemplates()
	if err != nil || len(list) == 0 || list[0].ID != "builtin:yearly-expenses" || list[0].Tabs != nil {
		t.Fatalf("templates = %+v, %v", list, err)
	}
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	if sh.Title != "Expenses 2027" || len(sh.Tabs) != 14 || sh.Tabs[2].Name != "January" || sh.Tabs[13].Name != "December" {
		t.Fatalf("title %q, %d tabs", sh.Title, len(sh.Tabs))
	}
	again, _ := BuildBuiltin("builtin:yearly-expenses", 2027, "")
	ids := map[string]bool{}
	for _, tab := range sh.Tabs {
		if tab.ID == again.Tabs[0].ID || ids[tab.ID] {
			t.Fatalf("tab id %s reused", tab.ID)
		}
		ids[tab.ID] = true
		columns := map[string]bool{}
		for _, column := range tab.Columns {
			columns[column.ID] = true
			if column.Type == models.SheetColumnTypeCurrency && (column.Format == nil || column.Format.Currency != "LKR") {
				t.Fatalf("%s/%s has no LKR format", tab.Name, column.Name)
			}
		}
		for _, row := range tab.Rows {
			if len(row.Cells) != len(tab.Columns) {
				t.Fatalf("%s row has %d cells for %d columns", tab.Name, len(row.Cells), len(tab.Columns))
			}
			for key := range row.Cells {
				if !columns[key] {
					t.Fatalf("%s cell keyed by unknown column %s", tab.Name, key)
				}
			}
		}
		for _, rule := range tab.ConditionalFormats {
			if !columns[rule.ColumnID] || rule.ID == "" {
				t.Fatalf("%s rule %+v", tab.Name, rule)
			}
		}
	}
	if _, err := BuildBuiltin("builtin:nope", 2027, ""); err == nil {
		t.Fatal("unknown template built")
	}
}

func TestAppendRowFillsTemplateMonth(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "")
	if err != nil {
		t.Fatal(err)
	}
	tab := sh.Tabs[2]
	col := map[string]string{}
	for _, column := range tab.Columns {
		col[column.Name] = column.ID
	}
	totalFormula := tab.Rows[1].Cells[col["Total"]]
	size := len(tab.Rows)
	index := AppendRow(&tab, models.SheetRow{ID: "new", Cells: map[string]string{col["Item"]: "Rice", col["Unit price"]: "450"}})
	if index != 1 || len(tab.Rows) != size {
		t.Fatalf("entry went to row %d of %d (was %d rows)", index+1, len(tab.Rows), size)
	}
	row := tab.Rows[1]
	if row.Cells[col["Item"]] != "Rice" || row.Cells[col["Total"]] != totalFormula || !strings.HasPrefix(totalFormula, "=IF(G2") {
		t.Fatalf("row 2 = %v", row.Cells)
	}
	if next := AppendRow(&tab, models.SheetRow{ID: "two", Cells: map[string]string{col["Item"]: "Milk"}}); next != 2 {
		t.Fatalf("second entry went to row %d", next+1)
	}
	if !strings.Contains(tab.Rows[0].Cells[col["Total"]], "SUM(H2:H)") {
		t.Fatalf("month total changed: %q", tab.Rows[0].Cells[col["Total"]])
	}
}

func TestOwnRowFormula(t *testing.T) {
	for _, tc := range []struct {
		value string
		row   int
		want  bool
	}{
		{`=IF(G2="","",IF(E2="",1,E2)*G2)`, 2, true},
		{`=SUM(E2:G2)`, 2, true},
		{`=SUM(H2:H)`, 2, false},
		{`=SUM(H:H)`, 2, false},
		{`=SUM(2:2)`, 2, false},
		{`=A1+A2`, 2, false},
		{`=January!H2`, 2, false},
		{`=TODAY()`, 2, false},
		{`plain`, 2, false},
	} {
		if got := ownRowFormula(tc.value, tc.row); got != tc.want {
			t.Errorf("ownRowFormula(%q, %d) = %v", tc.value, tc.row, got)
		}
	}
}

func TestRenameTabInFormula(t *testing.T) {
	for _, tc := range []struct{ value, old, new, want string }{
		{`=January!H2`, "January", "Jan 2027", `='Jan 2027'!H2`},
		{`=SUM('Jan 2027'!H2:H)+january!A1`, "Jan 2027", "January", `=SUM(January!H2:H)+january!A1`},
		{`=SUM(January!H2:H)+january!A1`, "January", "Jan", `=SUM(Jan!H2:H)+Jan!A1`},
		{`="January!H2"&January!B2`, "January", "Jan", `="January!H2"&Jan!B2`},
		{`=NotJanuary!A1`, "January", "Jan", `=NotJanuary!A1`},
		{`='Bob''s'!A1`, "Bob's", "Q1", `='Q1'!A1`},
		{`January!A1`, "January", "Jan", `January!A1`},
	} {
		if got := renameTabInFormula(tc.value, tc.old, tc.new); got != tc.want {
			t.Errorf("rename %q: got %q, want %q", tc.value, got, tc.want)
		}
	}
	tabs := models.SheetTabs{{ID: "a", Name: "Summary"}, {ID: "b", Name: "January"}}
	if err := renameTab(tabs, 0, "january"); err == nil {
		t.Fatal("rename to another tab's name was allowed")
	}
}
