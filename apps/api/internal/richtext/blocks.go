package richtext

import (
	"html"
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
)

// Toggle blocks are written as HTML <details>, which GitHub and Obsidian
// show as a fold:
//
//	<details open>
//	<summary>Title</summary>
//
//	body blocks
//
//	</details>
//
// The summary is plain text. A toggle with an empty body is written on three
// lines with no blank line, which is also how people write one by hand.
var (
	detailsOpenRe  = regexp.MustCompile(`(?is)^<details(\s+open(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)?\s*>\s*<summary>(.*?)</summary>\s*(</details>)?$`)
	detailsCloseRe = regexp.MustCompile(`(?i)^</details>$`)
)

func renderDetails(n map[string]any) string {
	content := asSlice(n["content"])
	summary := ""
	if first, ok := asMap(firstOf(content)); ok && first["type"] == "detailsSummary" {
		summary = textContent(asSlice(first["content"]))
		content = content[1:]
	}
	head := "<details"
	if open, ok := attrOf(n, "open").(bool); !ok || open {
		head += " open"
	}
	head += ">\n<summary>" + escapeHTMLText(strings.ReplaceAll(summary, "\n", " ")) + "</summary>"
	body := renderBlocks(content, true)
	if body == "" {
		return head + "\n</details>"
	}
	return head + "\n\n" + body + "\n\n</details>"
}

func escapeHTMLText(text string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(text)
}

func detailsNode(summary string, open bool, body []any) map[string]any {
	if len(body) == 0 {
		body = []any{paragraphNode(nil)}
	}
	head := map[string]any{"type": "detailsSummary"}
	if summary != "" {
		head["content"] = []any{map[string]any{"type": "text", "text": summary}}
	}
	return map[string]any{
		"type":    "details",
		"attrs":   map[string]any{"open": open},
		"content": append([]any{head}, body...),
	}
}

func (r reader) htmlBlockRaw(b *ast.HTMLBlock) string {
	raw := strings.TrimSpace(r.lines(b.Lines()))
	if b.HasClosure() {
		raw = strings.TrimSpace(raw + "\n" + string(b.ClosureLine.Value(r.source)))
	}
	return raw
}

// details reads a toggle that starts at n: the opening HTML block, the
// blocks after it and the closing </details>. It returns the last node used.
// Without a closing tag it is not a toggle and stays raw HTML.
func (r reader) details(n ast.Node) (map[string]any, ast.Node, bool) {
	b, ok := n.(*ast.HTMLBlock)
	if !ok {
		return nil, nil, false
	}
	m := detailsOpenRe.FindStringSubmatch(r.htmlBlockRaw(b))
	if m == nil {
		return nil, nil, false
	}
	summary := html.UnescapeString(strings.TrimSpace(m[2]))
	open := m[1] != ""
	if m[3] != "" {
		return detailsNode(summary, open, nil), n, true
	}
	var body []any
	for c := n.NextSibling(); c != nil; c = c.NextSibling() {
		if hb, ok := c.(*ast.HTMLBlock); ok && detailsCloseRe.MatchString(r.htmlBlockRaw(hb)) {
			return detailsNode(summary, open, body), c, true
		}
		if nested, end, ok := r.container(c); ok {
			body = append(body, nested)
			c = end
			continue
		}
		body = append(body, r.block(c)...)
	}
	return nil, nil, false
}
