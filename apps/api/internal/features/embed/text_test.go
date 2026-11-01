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

// E4: a doc past about 30,000 characters kept only its first 20 windows, so
// its end was never searchable by meaning.
func TestChunkSpreadsOverALongText(t *testing.T) {
	var b strings.Builder
	for i := 0; b.Len() < 37000; i++ {
		b.WriteString("Paragraph about the garden, the kitchen and the weekly shop. ")
	}
	b.WriteString("Zebra-striped umbrella stand from the antique shop in Porto.")
	text := b.String()
	got := Chunk(text)
	if len(got) != maxChunks {
		t.Fatalf("got %d chunks, want %d", len(got), maxChunks)
	}
	if !strings.HasPrefix(text, got[0]) {
		t.Fatal("the first chunk should start the text")
	}
	if last := got[len(got)-1]; !strings.HasSuffix(last, "antique shop in Porto.") {
		t.Fatalf("the last paragraph is not indexed; the last chunk ends %q", last[len(last)-40:])
	}
	// The chunks keep their order through the text.
	at := 0
	for n, chunk := range got {
		next := strings.Index(text[at:], chunk)
		if next < 0 {
			t.Fatalf("chunk %d is not the text's, in order", n)
		}
		at += next + 1
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
