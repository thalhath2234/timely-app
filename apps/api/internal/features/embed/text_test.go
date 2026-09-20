package embed

import (
	"strings"
	"testing"
	"timely-api/internal/models"
)

func TestChunkShort(t *testing.T) {
	got := Chunk("hello")
	if len(got) != 1 || got[0] != "hello" {
		t.Fatalf("got %#v", got)
	}
}

func TestChunkEmpty(t *testing.T) {
	if Chunk("   ") != nil {
		t.Fatal("expected nil for blank input")
	}
}

func TestChunkSplitsAndOverlaps(t *testing.T) {
	runes := make([]rune, chunkSize*2+50)
	for i := range runes {
		if i%80 == 0 {
			runes[i] = ' '
		} else {
			runes[i] = 'a'
		}
	}
	got := Chunk(string(runes))
	if len(got) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(got))
	}
	if len([]rune(got[0])) > chunkSize {
		t.Fatalf("first chunk too long: %d", len([]rune(got[0])))
	}
}

func TestChunkCaps(t *testing.T) {
	runes := make([]rune, chunkSize*maxChunks+5000)
	for i := range runes {
		runes[i] = 'x'
	}
	got := Chunk(string(runes))
	if len(got) != maxChunks {
		t.Fatalf("got %d chunks, want %d", len(got), maxChunks)
	}
}

func TestCombine(t *testing.T) {
	if Combine("Title", "Body") != "Title\n\nBody" {
		t.Fatal("expected title then body")
	}
	if Combine("Title", "") != "Title" {
		t.Fatal("title only")
	}
	if Combine("", "Body") != "Body" {
		t.Fatal("body only")
	}
}

func TestFlattenSheet(t *testing.T) {
	colItem := "col_item"
	colCost := "col_cost"
	sheet := models.Sheet{
		Title: "Budget",
		Columns: models.SheetColumns{
			{ID: colItem, Name: "Item"},
			{ID: colCost, Name: "Cost"},
		},
		Rows: models.SheetRows{
			{ID: "row_1", Cells: map[string]string{colItem: "Paper", colCost: "12"}},
		},
	}
	text := Combine(sheet.Title, FlattenSheet(&sheet))
	for _, needle := range []string{"Budget", "Item: Paper", "Cost: 12"} {
		if !strings.Contains(text, needle) {
			t.Fatalf("missing %q in %q", needle, text)
		}
	}
}
