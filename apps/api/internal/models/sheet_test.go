package models

import "testing"

func TestNormalizeTypedCell(t *testing.T) {
	cases := []struct {
		colType, in, want string
	}{
		{"text", "hello", "hello"},
		{"number", "1,234.5", "1234.5"},
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
	if _, err := NormalizeSheetColumnType("formula"); err == nil {
		t.Fatal("expected unknown type to fail")
	}
}
