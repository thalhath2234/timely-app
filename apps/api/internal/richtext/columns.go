package richtext

import (
	"regexp"

	"github.com/yuin/goldmark/ast"
)

// Columns put blocks side by side. Markdown has no columns, so they are
// marked with comments, which Markdown viewers hide (showing the columns one
// after another):
//
//	<!-- columns -->
//
//	first column's blocks
//
//	<!-- column -->
//
//	second column's blocks
//
//	<!-- /columns -->
var (
	columnsOpenRe  = regexp.MustCompile(`^<!--\s*columns\s*-->$`)
	columnBreakRe  = regexp.MustCompile(`^<!--\s*column\s*-->$`)
	columnsCloseRe = regexp.MustCompile(`^<!--\s*/columns\s*-->$`)
)

func renderColumns(n map[string]any) string {
	var cols []string
	for _, raw := range asSlice(n["content"]) {
		col, ok := asMap(raw)
		if !ok {
			continue
		}
		cols = append(cols, renderBlocks(asSlice(col["content"]), true))
	}
	out := "<!-- columns -->"
	for i, col := range cols {
		if i > 0 {
			out += "\n\n<!-- column -->"
		}
		if col != "" {
			out += "\n\n" + col
		}
	}
	return out + "\n\n<!-- /columns -->"
}

func columnNode(body []any) map[string]any {
	if len(body) == 0 {
		body = []any{paragraphNode(nil)}
	}
	return map[string]any{"type": "column", "content": body}
}

// columns reads columns that start at n, up to the closing comment. Without
// one they are not columns and the comments stay as they are.
func (r reader) columns(n ast.Node) (map[string]any, ast.Node, bool) {
	b, ok := n.(*ast.HTMLBlock)
	if !ok || !columnsOpenRe.MatchString(r.htmlBlockRaw(b)) {
		return nil, nil, false
	}
	var cols []any
	var body []any
	for c := n.NextSibling(); c != nil; c = c.NextSibling() {
		if hb, ok := c.(*ast.HTMLBlock); ok {
			raw := r.htmlBlockRaw(hb)
			if columnsCloseRe.MatchString(raw) {
				cols = append(cols, columnNode(body))
				return map[string]any{"type": "columns", "content": cols}, c, true
			}
			if columnBreakRe.MatchString(raw) {
				cols = append(cols, columnNode(body))
				body = nil
				continue
			}
		}
		if node, end, ok := r.container(c); ok {
			body = append(body, node)
			c = end
			continue
		}
		body = append(body, r.block(c)...)
	}
	return nil, nil, false
}

// container reads a block written over several sibling nodes: a toggle or
// columns.
func (r reader) container(n ast.Node) (map[string]any, ast.Node, bool) {
	if node, end, ok := r.details(n); ok {
		return node, end, true
	}
	return r.columns(n)
}
