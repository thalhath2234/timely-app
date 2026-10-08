package agent

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

func TestBigBlocksRoundTripThroughPlaceholders(t *testing.T) {
	stl, _, err := buildSTL(add3DModelIn{Name: "robot", Parts: []modelPartIn{
		{Name: "head", Shape: "sphere", Center: []float64{0, 0, 60}, Size: []float64{12, 12, 13}, Color: "#ff0000"},
		{Name: "body", Shape: "box", Center: []float64{0, 0, 30}, Size: []float64{20, 10, 30}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	source := "# Robot\n\nSome text.\n\n```stl\n" + stl + "```\n\n> [!NOTE]\n> Inside a callout:\n>\n> ```stl\n> " +
		strings.ReplaceAll(strings.TrimSuffix(stl, "\n"), "\n", "\n> ") + "\n> ```\n\n```go\nfmt.Println(1)\n```"
	original, _ := richtext.FromMarkdown(source)

	shortened, kept := shortenBlocks("doc_1", original)
	if kept != 2 {
		t.Fatalf("kept %d blocks, want 2", kept)
	}
	markdown := richtext.ToMarkdown(shortened)
	if len(markdown) > 2000 || !strings.Contains(markdown, "[kept doc_1#") || !strings.Contains(markdown, "parts: head body") || !strings.Contains(markdown, "fmt.Println(1)") {
		t.Fatalf("unexpected shortened markdown:\n%s", markdown)
	}
	// The stored doc is left alone.
	if !strings.Contains(richtext.ToMarkdown(original), "endsolid head") {
		t.Fatal("shortening changed the original content")
	}

	// The agent edits the text around the placeholders and writes it back.
	edited := strings.Replace(markdown, "Some text.", "Edited text.", 1)
	rich, _ := md(edited)
	restored, err := restoreBlocks(rich, func(id string) (models.JSONMap, error) {
		if id != "doc_1" {
			return nil, errors.New("not found")
		}
		return original, nil
	})
	if err != nil || !restored {
		t.Fatalf("restore: %v %v", restored, err)
	}
	want, _ := json.Marshal(original)
	got, _ := json.Marshal(rich)
	if strings.Replace(string(want), "Some text.", "Edited text.", 1) != string(got) {
		t.Fatalf("restored doc differs:\n%s", richtext.ToMarkdown(rich))
	}
	if plain := richtext.PlainText(rich); !strings.Contains(plain, "endsolid body") {
		t.Fatal("plain text misses the restored block")
	}
}

func TestRestoreRejectsStalePlaceholder(t *testing.T) {
	rich, _ := md("```stl\n[kept doc_1#0123456789ab 3D model]\n```")
	_, err := restoreBlocks(rich, func(string) (models.JSONMap, error) {
		other, _ := richtext.FromMarkdown("```stl\nsolid other\nendsolid other\n```")
		return other, nil
	})
	if err == nil || !strings.Contains(err.Error(), "get_doc again") {
		t.Fatalf("want a stale placeholder error, got %v", err)
	}
}
