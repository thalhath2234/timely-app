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
		{"number", "nope", ""},
		{"date", "2026-09-12", "2026-09-12"},
		{"date", "2026-09-12T15:04:05Z", "2026-09-12"},
		{"date", "not a date", ""},
		{"boolean", "yes", "TRUE"},
		{"boolean", "0", "FALSE"},
		{"boolean", "maybe", ""},
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
