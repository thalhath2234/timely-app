package sheet

import (
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
