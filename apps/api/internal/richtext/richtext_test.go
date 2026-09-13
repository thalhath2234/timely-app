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
