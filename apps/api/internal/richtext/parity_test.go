package richtext

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// testdata/parity.json is a doc using everything the editor can make, and
// testdata/parity.md is its Markdown. scripts/markdown-parity.test.mjs checks
// the web/mobile importer against the same pair, so all three agree.

func readParity(t *testing.T) (map[string]any, string) {
	t.Helper()
	raw, err := os.ReadFile("testdata/parity.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	md, err := os.ReadFile("testdata/parity.md")
	if err != nil {
		t.Fatal(err)
	}
	return doc, string(md)
}

func TestParityExport(t *testing.T) {
	doc, md := readParity(t)
	if got := ToMarkdown(doc) + "\n"; got != md {
		t.Fatalf("export differs from testdata/parity.md:\n%s", got)
	}
}

func TestParityImport(t *testing.T) {
	doc, md := readParity(t)
	got, plain := FromMarkdown(md)
	if !reflect.DeepEqual(normalizeDoc(got), normalizeDoc(doc)) {
		gotJSON, _ := json.MarshalIndent(normalizeDoc(got), "", " ")
		t.Fatalf("import differs from testdata/parity.json:\n%s", gotJSON)
	}
	if !strings.Contains(plain, "Literal *stars*") || !strings.Contains(plain, "@Haircut") {
		t.Fatalf("plain text missing content:\n%s", plain)
	}
}

func TestImportIsStable(t *testing.T) {
	// Markdown written by people: setext headings, * bullets, soft wraps,
	// autolinks, entities and raw HTML. Exporting what was imported and
	// importing again must not change the doc.
	src := "Title\n=====\n\nA paragraph\nwrapped over lines with https://example.com and &copy;.\n\n* a\n* b\n\n  continued\n\n<details>\n<summary>More</summary>\n</details>\n\n1) one\n2) two\n"
	first, _ := FromMarkdown(src)
	second, _ := FromMarkdown(ToMarkdown(first))
	if !reflect.DeepEqual(normalizeDoc(first), normalizeDoc(second)) {
		a, _ := json.MarshalIndent(normalizeDoc(first), "", " ")
		b, _ := json.MarshalIndent(normalizeDoc(second), "", " ")
		t.Fatalf("round trip changed the doc:\n%s\n---\n%s\n---md\n%s", a, b, ToMarkdown(first))
	}
}

// normalizeDoc drops null and default attrs, sorts marks and joins adjacent
// text with the same marks, so docs compare by meaning.
func normalizeDoc(v any) any {
	raw, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(raw, &out)
	return normalizeNode(out)
}

func normalizeNode(v any) any {
	n, ok := v.(map[string]any)
	if !ok {
		return v
	}
	if attrs, ok := n["attrs"].(map[string]any); ok {
		for k, val := range attrs {
			if val == nil || (k == "appearance" && val == "mention") {
				delete(attrs, k)
			}
		}
		if len(attrs) == 0 {
			delete(n, "attrs")
		}
	}
	if marks, ok := n["marks"].([]any); ok {
		sort.Slice(marks, func(i, j int) bool {
			return marks[i].(map[string]any)["type"].(string) < marks[j].(map[string]any)["type"].(string)
		})
	}
	if content, ok := n["content"].([]any); ok {
		var merged []any
		for _, child := range content {
			child = normalizeNode(child)
			if len(merged) > 0 {
				prev, _ := merged[len(merged)-1].(map[string]any)
				cur, _ := child.(map[string]any)
				if prev["type"] == "text" && cur["type"] == "text" && reflect.DeepEqual(prev["marks"], cur["marks"]) {
					prev["text"] = prev["text"].(string) + cur["text"].(string)
					continue
				}
			}
			merged = append(merged, child)
		}
		if len(merged) == 0 {
			delete(n, "content")
		} else {
			n["content"] = merged
		}
	}
	return n
}
