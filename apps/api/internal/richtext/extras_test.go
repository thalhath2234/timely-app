package richtext

import (
	"encoding/json"
	"strings"
	"testing"
)

// Handwritten forms of the extras, as GitHub and Obsidian users type them.
func TestImportHandwrittenExtras(t *testing.T) {
	src := strings.Join([]string{
		"---",
		"title: x",
		"---",
		"> [!tip] Keep it short",
		"> One line, then a list:",
		"> - a",
		"",
		"> [!NOTE]",
		"> Just a note[^n].",
		"",
		"$$x^2$$",
		"",
		"Price $5 and $x$, [[Page]] and [^missing].",
		"",
		"[^n]: Defined later.",
	}, "\n")
	doc, _ := FromMarkdown(src)
	raw, _ := json.Marshal(doc)
	got := string(raw)
	// json.Marshal writes map keys in sorted order.
	for _, want := range []string{
		`{"content":[{"text":"title: x","type":"text"}],"type":"frontmatter"}`,
		`"attrs":{"kind":"tip","title":"Keep it short"}`,
		`{"text":"One line, then a list:","type":"text"}`,
		`"attrs":{"kind":"note"}`,
		`{"attrs":{"label":"n"},"type":"footnoteRef"}`,
		`{"content":[{"text":"x^2","type":"text"}],"type":"mathBlock"}`,
		`{"text":"Price $5 and ","type":"text"},{"attrs":{"latex":"x"},"type":"mathInline"}`,
		`{"attrs":{"embed":false,"target":"Page"},"type":"wikiLink"}`,
		`{"text":" and [^missing].","type":"text"}`,
		`{"attrs":{"label":"n"},"content":[{"content":[{"text":"Defined later.","type":"text"}],"type":"paragraph"}],"type":"footnote"}`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in\n%s", want, got)
		}
	}
	// What was read must export to something that reads back the same.
	again, _ := FromMarkdown(ToMarkdown(doc))
	a, _ := json.Marshal(normalizeDoc(doc))
	b, _ := json.Marshal(normalizeDoc(again))
	if string(a) != string(b) {
		t.Fatalf("round trip changed the doc:\n%s\n%s\n%s", a, b, ToMarkdown(doc))
	}
}

func TestExportEscapesDollarsAndLeadingDivider(t *testing.T) {
	doc := docOf(
		map[string]any{"type": "horizontalRule"},
		para(txt("$$ not math $$")),
	)
	got := ToMarkdown(doc)
	want := "***\n\n\\$\\$ not math \\$\\$"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	back, _ := FromMarkdown(got)
	if first := back["content"].([]any)[0].(map[string]any); first["type"] != "horizontalRule" {
		t.Fatalf("divider did not survive: %v", back)
	}
}

func TestHandwrittenToggles(t *testing.T) {
	doc, plain := FromMarkdown("<details><summary>One line</summary>\n\nBody\n\n</details>\n\n<details>\n<summary>No end</summary>\n\nText\n")
	content := doc["content"].([]any)
	first := content[0].(map[string]any)
	if first["type"] != "details" || first["attrs"].(map[string]any)["open"] != false {
		t.Fatalf("one-line toggle not read: %v", first)
	}
	if !strings.Contains(plain, "One line") || !strings.Contains(plain, "Body") {
		t.Fatalf("plain text: %q", plain)
	}
	// Without </details> the HTML stays visible text.
	if second := content[1].(map[string]any); second["type"] != "paragraph" {
		t.Fatalf("unclosed toggle became %v", second["type"])
	}
}
