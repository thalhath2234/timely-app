package richtext

import "testing"

func TestRoundTripBasics(t *testing.T) {
	src := `# Title

A **bold** and *italic* note with ~~strike~~ and ==hi== and ` + "`code`" + `.

- [ ] todo
- [x] done

- one
- two

1. first
2. second

> quoted

` + "```go\nfmt.Println(\"hi\")\n```" + `

| A | B |
| --- | --- |
| 1 | 2 |

See [@Haircut](timely://task/tsk_1).
`
	doc, plain := FromMarkdown(src)
	if plain == "" {
		t.Fatal("expected plain text")
	}
	out := ToMarkdown(doc)
	for _, needle := range []string{"# Title", "**bold**", "- [x] done", "timely://task/tsk_1", "fmt.Println"} {
		if !contains(out, needle) {
			t.Errorf("missing %q in:\n%s", needle, out)
		}
	}
}

func TestLinkKeepsInnerMarksOnExport(t *testing.T) {
	src := "Visit [the **docs**](https://example.com)."
	doc, _ := FromMarkdown(src)
	out := ToMarkdown(doc)
	if !contains(out, "[the **docs**](https://example.com)") {
		t.Fatalf("expected a single link with inner marks, got:\n%s", out)
	}
	if contains(out, "[the ](https://example.com)") {
		t.Fatalf("split adjacent links:\n%s", out)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || (len(s) > 0 && (indexOf(s, sub) >= 0)))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func text(value string, marks ...string) map[string]any {
	n := map[string]any{"type": "text", "text": value}
	if len(marks) > 0 {
		var list []any
		for _, m := range marks {
			list = append(list, map[string]any{"type": m})
		}
		n["marks"] = list
	}
	return n
}

func para(children ...any) map[string]any {
	return map[string]any{"type": "paragraph", "content": children}
}

func item(kind string, children ...any) map[string]any {
	return map[string]any{"type": kind, "content": children}
}

func docOf(blocks ...any) map[string]any {
	return map[string]any{"type": "doc", "content": blocks}
}

func TestNestedListsKeepIndentation(t *testing.T) {
	doc := docOf(map[string]any{
		"type":  "orderedList",
		"attrs": map[string]any{"start": float64(3)},
		"content": []any{
			item("listItem",
				para(text("parent")),
				map[string]any{"type": "bulletList", "content": []any{
					item("listItem", para(text("child"))),
				}},
			),
			item("listItem", para(text("next"))),
		},
	})
	want := "3. parent\n   - child\n4. next"
	if got := ToMarkdown(doc); got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestNestedTaskList(t *testing.T) {
	doc := docOf(map[string]any{"type": "taskList", "content": []any{
		map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": true}, "content": []any{
			para(text("done")),
			map[string]any{"type": "taskList", "content": []any{
				map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": false}, "content": []any{para(text("sub"))}},
			}},
		}},
	}})
	want := "- [x] done\n  - [ ] sub"
	if got := ToMarkdown(doc); got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestOverlappingMarksStayBalanced(t *testing.T) {
	doc := docOf(para(text("plain "), text("bold ", "bold"), text("both", "bold", "italic"), text(" end")))
	want := "plain **bold *both*** end"
	if got := ToMarkdown(doc); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestHardBreakAndCodeFences(t *testing.T) {
	doc := docOf(
		para(text("one"), map[string]any{"type": "hardBreak"}, text("two")),
		map[string]any{"type": "codeBlock", "attrs": map[string]any{"language": "md"}, "content": []any{text("```\nx\n```")}},
		para(text("a`b", "code")),
	)
	want := "one  \ntwo\n\n````md\n```\nx\n```\n````\n\n``a`b``"
	if got := ToMarkdown(doc); got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestTableEscapesPipesAndKeepsMergedColumns(t *testing.T) {
	cell := func(kind string, attrs map[string]any, children ...any) map[string]any {
		n := map[string]any{"type": kind, "content": children}
		if attrs != nil {
			n["attrs"] = attrs
		}
		return n
	}
	doc := docOf(map[string]any{"type": "table", "content": []any{
		item("tableRow",
			cell("tableHeader", nil, para(text("A"))),
			cell("tableHeader", nil, para(text("B"))),
			cell("tableHeader", nil, para(text("C"))),
		),
		item("tableRow",
			cell("tableCell", map[string]any{"colspan": float64(2), "rowspan": float64(2)}, para(text("wide"))),
			cell("tableCell", nil, para(text("x | y"))),
		),
		item("tableRow",
			cell("tableCell", nil, para(text("l1"), map[string]any{"type": "hardBreak"}, text("l2"))),
		),
	}})
	want := "| A | B | C |\n| --- | --- | --- |\n| wide |  | x \\| y |\n|  |  | l1<br>l2 |"
	got := ToMarkdown(doc)
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}

	back, _ := FromMarkdown(got)
	if again := ToMarkdown(back); again != want {
		t.Fatalf("table did not round-trip:\n%s", again)
	}
}
