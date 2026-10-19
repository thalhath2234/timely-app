package sheet

import (
	"fmt"
	"testing"

	"timely-api/internal/models"
)

func TestSheetValuesRunTheAppsEngine(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	jan := &sh.Tabs[2]
	col := map[string]string{}
	for _, column := range jan.Columns {
		col[column.Name] = column.ID
	}
	for _, entry := range []map[string]string{
		{col["Date"]: "2027-01-03", col["Item"]: "Rice 5kg", col["Category"]: "Groceries", col["Qty"]: "2", col["Unit price"]: "1250"},
		{col["Item"]: "Bus pass", col["Category"]: "Transport", col["Unit price"]: "3000"},
	} {
		AppendRow(jan, models.SheetRow{ID: "r", Cells: entry})
	}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 14 {
		t.Fatalf("%d tabs", len(values))
	}
	// Summary row 1 is January: Spent 2*1250 + 3000, 2 items, biggest 3000.
	january := values[0][0]
	if january[0] != "January" || january[1] != 5500.0 || january[5] != 2.0 || january[6] != 3000.0 {
		t.Fatalf("Summary January = %v", january)
	}
	if got := values[2][1][0]; got != "2027-01-03" {
		t.Fatalf("date cell = %#v", got)
	}
	if got := values[2][1][7]; got != 2500.0 {
		t.Fatalf("row 2 Total = %#v", got)
	}
	if got := values[2][3][7]; got != "" && got != nil {
		t.Fatalf("empty prepared row Total = %#v", got)
	}

	value, err := EvaluateFormula(sh, jan.ID, `SUMIF(C2:C,"groceries",H2:H)`)
	if err != nil || value != 2500.0 {
		t.Fatalf("SUMIF = %#v, %v", value, err)
	}
	value, err = EvaluateFormula(sh, "", `=January!H1/2`)
	if err != nil || value != 2750.0 {
		t.Fatalf("cross-tab = %#v, %v", value, err)
	}
	value, _ = EvaluateFormula(sh, "", `=1/0`)
	if m, ok := value.(map[string]any); !ok || m["error"] == nil {
		t.Fatalf("1/0 = %#v", value)
	}
	if _, err := EvaluateFormula(sh, "tab_nope", "=1"); err == nil {
		t.Fatal("unknown tab accepted")
	}
}

func TestSheetValuesStopsARunawayFormula(t *testing.T) {
	columns := models.SheetColumns{{ID: "a", Name: "A", Type: "formula"}}
	sh := &models.Sheet{Columns: columns, Rows: models.SheetRows{{ID: "r", Cells: map[string]string{"a": "=A1+1"}}}}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if m, ok := values[0][0][0].(map[string]any); !ok || m["error"] == nil {
		t.Fatalf("self reference = %#v", values[0][0][0])
	}
}

// Entries past a month's prepared rows get the Total formula filled down, so
// the month total (=SUM(H2:H)) and the Summary still count them.
func TestEntriesPastPreparedRowsKeepTheirTotal(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "")
	if err != nil {
		t.Fatal(err)
	}
	dec := &sh.Tabs[13]
	col := map[string]string{}
	for _, column := range dec.Columns {
		col[column.Name] = column.ID
	}
	prepared := len(dec.Rows)
	want := 0.0
	for i := 1; i <= prepared+5; i++ {
		AppendRow(dec, models.SheetRow{ID: "r", Cells: map[string]string{col["Item"]: "Thing", col["Qty"]: "2", col["Unit price"]: "10"}})
		want += 20
	}
	if len(dec.Rows) <= prepared {
		t.Fatalf("grid did not grow: %d rows", len(dec.Rows))
	}
	last := dec.Rows[len(dec.Rows)-1].Cells[col["Total"]]
	if last != fmt.Sprintf(`=IF(G%d="","",IF(E%d="",1,E%d)*G%d)`, len(dec.Rows), len(dec.Rows), len(dec.Rows), len(dec.Rows)) {
		t.Fatalf("last row Total = %q", last)
	}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if got := values[0][11][1]; got != want {
		t.Fatalf("Summary December Spent = %v, want %v", got, want)
	}
}

// Deleting an entry row moves the rows below up with their formulas fixed,
// as the apps do; before, the Totals below read the next row's numbers.
func TestDeleteFromTabKeepsFormulasOnTheirCells(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "")
	if err != nil {
		t.Fatal(err)
	}
	jan := &sh.Tabs[2]
	col := map[string]string{}
	for _, column := range jan.Columns {
		col[column.Name] = column.ID
	}
	for i, price := range []string{"100", "200", "300", "400"} {
		AppendRow(jan, models.SheetRow{ID: fmt.Sprint("r", i), Cells: map[string]string{col["Item"]: "Thing", col["Qty"]: "2", col["Unit price"]: price}})
	}
	// Rows 3 and 4 (index 2 and 3; 100 is row 2) hold 200 and 300.
	tabs, err := deleteFromTab(sh.Tabs, jan.ID, "row", []int{3, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	sh.Tabs = tabs
	jan = &sh.Tabs[2]
	if got := jan.Rows[2].Cells[col["Total"]]; got != `=IF(G3="","",IF(E3="",1,E3)*G3)` {
		t.Fatalf("moved-up Total = %q", got)
	}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if got := values[0][0][1]; got != 1000.0 {
		t.Fatalf("Summary January Spent = %v, want 1000 (2×100 + 2×400)", got)
	}
	// Deleting a column fixes the formulas right of it; ones that read it get #REF!.
	tabs, err = deleteFromTab(sh.Tabs, jan.ID, "col", []int{5}) // Unit
	if err != nil {
		t.Fatal(err)
	}
	total := tabs[2].Rows[1].Cells[col["Total"]]
	if total != `=IF(F2="","",IF(E2="",1,E2)*F2)` {
		t.Fatalf("Total after deleting Unit = %q", total)
	}
	if _, ok := tabs[2].Rows[1].Cells[col["Unit"]]; ok || len(tabs[2].Columns) != len(jan.Columns)-1 {
		t.Fatal("Unit column kept")
	}
}

// One tab worked out alone, with the tabs its formulas reach, shows the same
// values as the whole workbook.
func TestTabValuesMatchTheWholeWorkbook(t *testing.T) {
	yearly, err := BuildBuiltin("builtin:yearly-expenses", 2027, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	oct := &yearly.Tabs[11]
	col := map[string]string{}
	for _, column := range oct.Columns {
		col[column.Name] = column.ID
	}
	AppendRow(oct, models.SheetRow{ID: "r", Cells: map[string]string{
		col["Date"]: "2027-10-03", col["Item"]: "Rice 5kg", col["Category"]: "Groceries", col["Qty"]: "2", col["Unit price"]: "1250"}})

	cell := func(id, value string) models.SheetRow {
		return models.SheetRow{ID: id, Cells: map[string]string{"a": value}}
	}
	columns := models.SheetColumns{{ID: "a", Name: "A", Type: "text"}}
	tab := func(id, name string, rows ...models.SheetRow) models.SheetTab {
		return models.SheetTab{ID: id, Name: name, Columns: columns, Rows: rows}
	}
	refs := &models.Sheet{Tabs: models.SheetTabs{
		tab("main", "Main", cell("1", "='Sam''s Rates'!A1*2"), cell("2", "=totals!A1"), cell("3", "=A1+A2")),
		tab("rates", "Sam's Rates", cell("1", "21")),
		tab("totals", "Totals", cell("1", "=Base!A1+1")),
		tab("base", "Base", cell("1", "100")),
		tab("unused", "Unused", cell("1", "=Main!A3")),
	}}

	for _, sh := range []*models.Sheet{yearly, refs} {
		whole, err := SheetValues(sh)
		if err != nil {
			t.Fatal(err)
		}
		for i, tab := range WorkbookTabs(sh) {
			one, err := TabValues(sh, tab.ID)
			if err != nil {
				t.Fatalf("%s: %v", tab.Name, err)
			}
			if got, want := fmt.Sprint(one), fmt.Sprint(whole[i]); got != want {
				t.Errorf("%s alone = %s, in the workbook %s", tab.Name, got, want)
			}
		}
	}
	main, _ := TabValues(refs, "main")
	if main[2][0] != 143.0 {
		t.Fatalf("Main!A3 = %v, want 42+101", main[2][0])
	}
	if _, err := TabValues(refs, "missing"); err == nil {
		t.Fatal("an unknown tab must fail")
	}
}
