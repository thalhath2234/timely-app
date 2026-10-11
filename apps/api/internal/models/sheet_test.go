package models

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeTypedCell(t *testing.T) {
	cases := []struct {
		colType, in, want string
	}{
		{"text", "hello", "hello"},
		{"number", "1,234.5", "1234.5"},
		{"currency", "50,000.00", "50000"},
		{"percent", "115%", "1.15"},
		{"formula", "1.5", "1.5"},
		{"number", "nope", "nope"},
		{"currency", "$12.50", "12.5"},
		{"currency", "Rs 1,250", "1250"},
		{"currency", "LKR 500", "500"},
		{"currency", "€9,99", "9.99"},
		{"currency", "1.234,56", "1234.56"},
		{"currency", "(45.00)", "-45"},
		{"currency", "-$3", "-3"},
		{"number", "½", "0.5"},
		{"number", "1.5 kg", "1.5 kg"},
		{"date", "11 Oct 2026", "2026-10-11"},
		{"date", "2026/10/11", "2026-10-11"},
		{"date", "2026-09-12", "2026-09-12"},
		{"date", "2026-09-12T15:04:05Z", "2026-09-12"},
		{"date", "not a date", "not a date"},
		{"boolean", "yes", "TRUE"},
		{"boolean", "0", "FALSE"},
		{"boolean", "maybe", "maybe"},
		{"number", "=A1+1", "=A1+1"},
		{"text", "", ""},
	}
	for _, tc := range cases {
		got := NormalizeTypedCell(tc.colType, tc.in)
		if got != tc.want {
			t.Errorf("NormalizeTypedCell(%q, %q) = %q, want %q", tc.colType, tc.in, got, tc.want)
		}
	}
}

func TestNormalizeSheetColumnType(t *testing.T) {
	got, err := NormalizeSheetColumnType("checkbox")
	if err != nil || got != SheetColumnTypeBoolean {
		t.Fatalf("checkbox alias: got %q %v", got, err)
	}
	got, err = NormalizeSheetColumnType("fx")
	if err != nil || got != SheetColumnTypeFormula {
		t.Fatalf("formula alias: got %q %v", got, err)
	}
	got, err = NormalizeSheetColumnType("money")
	if err != nil || got != SheetColumnTypeCurrency {
		t.Fatalf("currency alias: got %q %v", got, err)
	}
	if _, err := NormalizeSheetColumnType("widget"); err == nil {
		t.Fatal("expected unknown type to fail")
	}
}

func TestCloneGridRemapsIDs(t *testing.T) {
	columns := SheetColumns{{ID: "col_a", Name: "A", Width: 120, Type: "currency"}}
	rows := SheetRows{{
		ID:    "row_1",
		Cells: map[string]string{"col_a": "10"},
		Formats: map[string]SheetCellFormat{
			"col_a": {Bold: true, NumberFormat: "currency"},
		},
	}}
	nextCols, nextRows := CloneGrid(columns, rows)
	if nextCols[0].ID == "col_a" {
		t.Fatal("expected a new column id")
	}
	if nextRows[0].ID == "row_1" {
		t.Fatal("expected a new row id")
	}
	if nextRows[0].Cells[nextCols[0].ID] != "10" {
		t.Fatalf("cell did not follow remapped column: %#v", nextRows[0].Cells)
	}
	if !nextRows[0].Formats[nextCols[0].ID].Bold {
		t.Fatal("format did not follow remapped column")
	}
}

func TestNormalizeCellFormats(t *testing.T) {
	got := NormalizeCellFormats(map[string]SheetCellFormat{
		"keep": {
			Italic:     true,
			TextColor:  "#F28",
			FillColor:  "#174ea6",
			Wrap:       true,
			Decimals:   intPtr(4),
			FontFamily: "serif",
			Note:       "  hello  ",
		},
		"drop": {
			Align: "diagonal",
		},
	})
	kept, ok := got["keep"]
	if !ok {
		t.Fatal("expected keep format")
	}
	if !kept.Italic {
		t.Fatal("italic")
	}
	if kept.TextColor != "#ff2288" {
		t.Fatalf("text color: %q", kept.TextColor)
	}
	if kept.FillColor != "#174ea6" {
		t.Fatalf("fill: %q", kept.FillColor)
	}
	if kept.Decimals == nil || *kept.Decimals != 4 {
		t.Fatal("decimals")
	}
	if kept.FontFamily != "serif" || kept.Note != "hello" {
		t.Fatalf("family/note: %#v", kept)
	}
	if _, exists := got["drop"]; exists {
		t.Fatal("empty invalid format should be dropped")
	}

	emoji := strings.Repeat("🙂", 700)
	truncated := NormalizeCellFormats(map[string]SheetCellFormat{
		"note": {Note: emoji},
	})
	note := truncated["note"].Note
	if !utf8.ValidString(note) {
		t.Fatal("truncated note must stay valid UTF-8")
	}
	if len(note) > 2000 {
		t.Fatalf("note too long: %d", len(note))
	}
}

func intPtr(v int) *int { return &v }

func TestNormalizeMerges(t *testing.T) {
	got := NormalizeMerges(SheetMerges{
		{StartCol: 0, StartRow: 0, ColSpan: 2, RowSpan: 1},
		{StartCol: 0, StartRow: 0, ColSpan: 2, RowSpan: 1},
		{StartCol: 9, StartRow: 0, ColSpan: 2, RowSpan: 1},
		{StartCol: 0, StartRow: 0, ColSpan: 1, RowSpan: 1},
	}, 4, 4)
	if len(got) != 1 {
		t.Fatalf("got %#v", got)
	}
}

func TestNormalizeSelectOptions(t *testing.T) {
	got := NormalizeSelectOptions([]string{" Todo ", "todo", "", "Done", "DONE", "Blocked"})
	want := []string{"Todo", "Done", "Blocked"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("NormalizeSelectOptions = %v, want %v", got, want)
	}
	if NormalizeSelectOptions(nil) != nil || NormalizeSelectOptions([]string{" "}) != nil {
		t.Fatal("empty option lists should normalize to nil")
	}
}

func TestNormalizeSheetColumnTypeSelectAliases(t *testing.T) {
	for _, alias := range []string{"select", "dropdown", "choice", "enum", "Select"} {
		got, err := NormalizeSheetColumnType(alias)
		if err != nil || got != SheetColumnTypeSelect {
			t.Fatalf("%q: got %q %v", alias, got, err)
		}
	}
}

func TestNormalizeSheetColumnsClearsOptionsOffSelect(t *testing.T) {
	columns := SheetColumns{
		{ID: "a", Type: "select", Options: []string{"x", "X", "y"}},
		{ID: "b", Type: "text", Options: []string{"stale"}},
	}
	if err := NormalizeSheetColumns(columns); err != nil {
		t.Fatal(err)
	}
	if strings.Join(columns[0].Options, "|") != "x|y" {
		t.Fatalf("select options = %v", columns[0].Options)
	}
	if columns[1].Options != nil {
		t.Fatalf("text column kept options %v", columns[1].Options)
	}
}

func TestNormalizeSheetCellsSelect(t *testing.T) {
	columns := SheetColumns{{ID: "s", Type: "select", Options: []string{"Todo", "Done"}}}
	rows := SheetRows{
		{ID: "r1", Cells: map[string]string{"s": " done "}},
		{ID: "r2", Cells: map[string]string{"s": "Blocked"}},
		{ID: "r3", Cells: map[string]string{"s": ""}},
		{ID: "r4", Cells: map[string]string{"s": "=A1"}},
	}
	NormalizeSheetCells(columns, rows)
	if rows[0].Cells["s"] != "Done" {
		t.Fatalf("expected option spelling, got %q", rows[0].Cells["s"])
	}
	if rows[1].Cells["s"] != "Blocked" {
		t.Fatalf("new value kept, got %q", rows[1].Cells["s"])
	}
	if strings.Join(columns[0].Options, "|") != "Todo|Done|Blocked" {
		t.Fatalf("options after cells = %v", columns[0].Options)
	}
	if rows[2].Cells["s"] != "" || rows[3].Cells["s"] != "=A1" {
		t.Fatalf("empty/formula cells changed: %v %v", rows[2].Cells, rows[3].Cells)
	}
}

func TestNormalizeSheetTabSettings(t *testing.T) {
	columns := SheetColumns{
		{ID: "amt", Name: "Amount", Type: "currency", Format: &SheetColumnFormat{Currency: " LKR ", DateFormat: "nope"}},
		{ID: "d", Name: "Date", Type: "date", Format: &SheetColumnFormat{DateFormat: "d mmm yyyy"}},
		{ID: "t", Name: "Text", Type: "text", Format: &SheetColumnFormat{}},
	}
	tab, err := NormalizeSheetTab(SheetTab{
		Name:       "March",
		Columns:    columns,
		Rows:       DefaultSheetRows(columns, 3),
		Color:      "#ABC",
		FrozenRows: 99,
		FrozenCols: 2,
		ConditionalFormats: []SheetConditionalFormat{
			{ColumnID: "amt", Operator: "gt", Value: "1000", FillColor: "#FF0000"},
			{ColumnID: "missing", Operator: "gt"},
			{ColumnID: "amt", Operator: "explode"},
		},
	}, "Sheet")
	if err != nil {
		t.Fatal(err)
	}
	if tab.Columns[0].Format.Currency != "LKR" || tab.Columns[0].Format.DateFormat != "" {
		t.Fatalf("currency format = %+v", tab.Columns[0].Format)
	}
	if tab.Columns[1].Format.DateFormat != "d mmm yyyy" || tab.Columns[2].Format != nil {
		t.Fatalf("date format = %+v, empty format = %+v", tab.Columns[1].Format, tab.Columns[2].Format)
	}
	if tab.Color != "#aabbcc" || tab.FrozenRows != 3 || tab.FrozenCols != 2 {
		t.Fatalf("settings = %q %d %d", tab.Color, tab.FrozenRows, tab.FrozenCols)
	}
	if len(tab.ConditionalFormats) != 1 || tab.ConditionalFormats[0].ID == "" || tab.ConditionalFormats[0].FillColor != "#ff0000" {
		t.Fatalf("rules = %+v", tab.ConditionalFormats)
	}
}

func TestCloneTabKeepsRulesOnTheirColumns(t *testing.T) {
	columns := SheetColumns{{ID: "a", Name: "A", Type: "text"}, {ID: "b", Name: "B", Type: "number"}}
	tab := SheetTab{ID: "t", Name: "Jan", Columns: columns, Rows: DefaultSheetRows(columns, 1), FrozenRows: 1, Color: "#112233",
		ConditionalFormats: []SheetConditionalFormat{{ID: "r", ColumnID: "b", Operator: "gt", Value: "5"}}}
	clone := CloneTab(tab)
	if clone.Columns[1].ID == "b" || len(clone.ConditionalFormats) != 1 || clone.ConditionalFormats[0].ColumnID != clone.Columns[1].ID {
		t.Fatalf("rule did not follow its column: %+v", clone.ConditionalFormats)
	}
	if clone.FrozenRows != 1 || clone.Color != "#112233" {
		t.Fatalf("settings lost: %+v", clone)
	}
}
