package richtext

import (
	"html"
	"regexp"
	"strings"
	"timely-api/internal/models"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var (
	markdownParser = goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(
			parser.WithBlockParsers(
				util.Prioritized(&mathBlockParser{}, 500),
				util.Prioritized(&footnoteDefParser{}, 999),
			),
			parser.WithInlineParsers(
				util.Prioritized(&footnoteRefParser{}, 150),
				util.Prioritized(&wikiLinkParser{}, 150),
				util.Prioritized(&highlightParser{}, 500),
				util.Prioritized(&mathInlineParser{}, 500),
			),
		),
	).Parser()
	calloutHeadRe = regexp.MustCompile(`^\[!([A-Za-z]+)\][ \t]*(.*?)[ \t]*$`)
	// Frontmatter is a --- fenced block that starts on the first line.
	frontmatterRe = regexp.MustCompile(`^---\n((?:.*\n)*?)---(?:\n|$)`)
	mentionHrefRe = regexp.MustCompile(`^timely://(task|project|doc|sheet)/(.+)$`)
	brTagRe       = regexp.MustCompile(`(?i)^<br\s*/?>$`)
)

// FromMarkdown turns Markdown into a ProseMirror document and a plain-text
// copy used for search. It mirrors fromMarkdown in
// packages/contract/src/markdown.ts.
func FromMarkdown(src string) (models.JSONMap, string) {
	source := []byte(strings.ReplaceAll(src, "\r\n", "\n"))
	var content []any
	if m := frontmatterRe.FindSubmatch(source); m != nil {
		content = append(content, rawBlockNode("frontmatter", strings.TrimSuffix(string(m[1]), "\n")))
		source = source[len(m[0]):]
	}
	r := reader{source: source, pc: parser.NewContext()}
	root := markdownParser.Parse(text.NewReader(source), parser.WithContext(r.pc))
	content = append(content, r.blocks(root)...)
	if len(content) == 0 {
		content = []any{paragraphNode(nil)}
	}
	var texts []string
	blockTexts(content, &texts)
	return models.JSONMap{"type": "doc", "content": content}, strings.Join(texts, "\n")
}

type reader struct {
	source []byte
	// Shared with sub-parses (a callout's first paragraph) so footnote
	// references inside them still resolve.
	pc parser.Context
}

// parse converts a slice of Markdown source with the same parser state.
func (r reader) parse(src []byte) []any {
	sub := reader{source: src, pc: r.pc}
	return sub.blocks(markdownParser.Parse(text.NewReader(src), parser.WithContext(r.pc)))
}

func (r reader) blocks(parent ast.Node) []any {
	return r.blocksFrom(parent.FirstChild())
}

// blocksFrom converts first and the siblings after it. Toggles span several
// sibling nodes (see details), so they are read here rather than in block.
func (r reader) blocksFrom(first ast.Node) []any {
	var out []any
	for n := first; n != nil; n = n.NextSibling() {
		if node, end, ok := r.details(n); ok {
			out = append(out, node)
			n = end
			continue
		}
		out = append(out, r.block(n)...)
	}
	return out
}

// block converts one block node; most give one editor node.
func (r reader) block(n ast.Node) []any {
	var out []any
	switch b := n.(type) {
	case *ast.Heading:
		out = append(out, withContent(map[string]any{"type": "heading", "attrs": map[string]any{"level": b.Level}}, r.inline(b)))
	case *ast.Paragraph, *ast.TextBlock:
		if link := r.linkBlock(n); link != nil {
			out = append(out, link)
		} else if r.isOnlyBreak(n) {
			out = append(out, paragraphNode(nil))
		} else {
			out = append(out, paragraphNode(r.inline(n)))
		}
	case *ast.ThematicBreak:
		out = append(out, map[string]any{"type": "horizontalRule"})
	case *ast.FencedCodeBlock:
		out = append(out, codeBlockNode(normalizeLanguage(string(b.Language(r.source))), r.lines(b.Lines())))
	case *ast.CodeBlock:
		out = append(out, codeBlockNode("", strings.TrimSuffix(r.lines(b.Lines()), "\n")))
	case *ast.Blockquote:
		if callout := r.callout(b); callout != nil {
			out = append(out, callout)
			return out
		}
		content := r.blocks(b)
		if len(content) == 0 {
			content = []any{paragraphNode(nil)}
		}
		out = append(out, map[string]any{"type": "blockquote", "content": content})
	case *mathBlockNode:
		out = append(out, rawBlockNode("mathBlock", r.lines(b.Lines())))
	case *footnoteDefNode:
		content := r.blocks(b)
		if len(content) == 0 {
			content = []any{paragraphNode(nil)}
		}
		out = append(out, map[string]any{"type": "footnote", "attrs": map[string]any{"label": b.label}, "content": content})
	case *ast.List:
		out = append(out, r.list(b))
	case *east.Table:
		out = append(out, r.table(b))
	case *ast.HTMLBlock:
		raw := r.htmlBlockRaw(b)
		if brTagRe.MatchString(raw) {
			out = append(out, paragraphNode(nil))
			return out
		}
		// Other raw HTML has no editor equivalent; keep its source as text.
		var content []any
		for i, line := range strings.Split(raw, "\n") {
			if i > 0 {
				content = append(content, map[string]any{"type": "hardBreak"})
			}
			if line != "" {
				content = append(content, map[string]any{"type": "text", "text": line})
			}
		}
		out = append(out, paragraphNode(content))
	default:
		if n.HasChildren() {
			out = append(out, r.blocks(n)...)
		}
	}
	return out
}

// callout reads a quote whose first line is [!KIND] or [!KIND] Title, as
// GitHub and Obsidian write them. The marker may be a paragraph of its own
// (how ToMarkdown writes it) or the first line of the body's paragraph.
func (r reader) callout(quote *ast.Blockquote) map[string]any {
	first, ok := quote.FirstChild().(*ast.Paragraph)
	if !ok || first.Lines().Len() == 0 {
		return nil
	}
	seg := first.Lines().At(0)
	head := strings.TrimRight(string(seg.Value(r.source)), "\n")
	m := calloutHeadRe.FindStringSubmatch(head)
	if m == nil {
		return nil
	}
	attrs := map[string]any{"kind": strings.ToLower(m[1])}
	if m[2] != "" {
		attrs["title"] = unescapeMarkdown(m[2])
	}
	var content []any
	if first.Lines().Len() > 1 {
		var rest strings.Builder
		for i := 1; i < first.Lines().Len(); i++ {
			line := first.Lines().At(i)
			rest.Write(line.Value(r.source))
		}
		content = append(content, r.parse([]byte(rest.String()))...)
	}
	content = append(content, r.blocksFrom(first.NextSibling())...)
	if len(content) == 0 {
		content = []any{paragraphNode(nil)}
	}
	return map[string]any{"type": "callout", "attrs": attrs, "content": content}
}

func (r reader) list(list *ast.List) map[string]any {
	type item struct {
		node    *ast.ListItem
		task    bool
		checked bool
	}
	var items []item
	allTasks := list.ChildCount() > 0
	for n := list.FirstChild(); n != nil; n = n.NextSibling() {
		li, ok := n.(*ast.ListItem)
		if !ok {
			continue
		}
		it := item{node: li}
		if first := li.FirstChild(); first != nil {
			if box, ok := first.FirstChild().(*east.TaskCheckBox); ok {
				it.task, it.checked = true, box.IsChecked
			}
		}
		allTasks = allTasks && it.task
		items = append(items, it)
	}

	var content []any
	for _, it := range items {
		children := r.blocks(it.node)
		// Editor list items must start with a paragraph.
		if len(children) == 0 || children[0].(map[string]any)["type"] != "paragraph" {
			children = append([]any{paragraphNode(nil)}, children...)
		}
		if allTasks {
			content = append(content, map[string]any{
				"type":    "taskItem",
				"attrs":   map[string]any{"checked": it.checked},
				"content": children,
			})
			continue
		}
		if it.task {
			// A checkbox in a list that is not all tasks stays visible as text.
			first := children[0].(map[string]any)
			box := "[ ] "
			if it.checked {
				box = "[x] "
			}
			inline, _ := first["content"].([]any)
			first["content"] = append([]any{map[string]any{"type": "text", "text": box}}, inline...)
		}
		content = append(content, map[string]any{"type": "listItem", "content": children})
	}

	switch {
	case allTasks:
		return map[string]any{"type": "taskList", "content": content}
	case list.IsOrdered():
		return map[string]any{"type": "orderedList", "attrs": map[string]any{"start": list.Start}, "content": content}
	default:
		return map[string]any{"type": "bulletList", "content": content}
	}
}

func (r reader) table(table *east.Table) map[string]any {
	var rows []any
	for row := table.FirstChild(); row != nil; row = row.NextSibling() {
		kind := "tableCell"
		if _, ok := row.(*east.TableHeader); ok {
			kind = "tableHeader"
		}
		var cells []any
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			cells = append(cells, map[string]any{
				"type":    kind,
				"content": []any{paragraphNode(r.inline(cell))},
			})
		}
		rows = append(rows, map[string]any{"type": "tableRow", "content": cells})
	}
	return map[string]any{"type": "table", "content": rows}
}

func (r reader) lines(lines *text.Segments) string {
	var b strings.Builder
	for i := 0; i < lines.Len(); i++ {
		seg := lines.At(i)
		b.Write(seg.Value(r.source))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (r reader) isOnlyBreak(n ast.Node) bool {
	var raw strings.Builder
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch v := c.(type) {
		case *ast.RawHTML:
			raw.WriteString(r.rawHTML(v))
		case *ast.Text:
			if strings.TrimSpace(string(v.Segment.Value(r.source))) != "" {
				return false
			}
		default:
			return false
		}
	}
	return brTagRe.MatchString(strings.TrimSpace(raw.String()))
}

func (r reader) rawHTML(n *ast.RawHTML) string {
	var b strings.Builder
	for i := 0; i < n.Segments.Len(); i++ {
		seg := n.Segments.At(i)
		b.Write(seg.Value(r.source))
	}
	return b.String()
}

// inline converts the inline children of n. Marks are tracked as a list so
// <u>…</u> and <mark>…</mark> (separate raw HTML nodes) can open and close.
func (r reader) inline(n ast.Node) []any {
	var out []any
	r.inlineInto(n, nil, &out)
	return out
}

func (r reader) inlineInto(parent ast.Node, inherited []any, out *[]any) {
	marks := inherited
	for n := parent.FirstChild(); n != nil; n = n.NextSibling() {
		switch v := n.(type) {
		case *ast.Text:
			value := string(v.Segment.Value(r.source))
			if !v.IsRaw() {
				value = unescapeMarkdown(value)
			}
			appendText(out, value, marks)
			if v.HardLineBreak() {
				*out = append(*out, map[string]any{"type": "hardBreak"})
			} else if v.SoftLineBreak() {
				appendText(out, " ", marks)
			}
		case *ast.String:
			appendText(out, string(v.Value), marks)
		case *east.TaskCheckBox:
			// Handled by the list.
		case *ast.Emphasis:
			kind := "italic"
			if v.Level >= 2 {
				kind = "bold"
			}
			r.inlineInto(v, addMark(marks, map[string]any{"type": kind}), out)
		case *east.Strikethrough:
			r.inlineInto(v, addMark(marks, map[string]any{"type": "strike"}), out)
		case *highlightNode:
			r.inlineInto(v, addMark(marks, map[string]any{"type": "highlight"}), out)
		case *mathInlineNode:
			*out = append(*out, map[string]any{"type": "mathInline", "attrs": map[string]any{"latex": v.latex}})
		case *footnoteRefNode:
			*out = append(*out, map[string]any{"type": "footnoteRef", "attrs": map[string]any{"label": v.label}})
		case *wikiLinkNode:
			attrs := map[string]any{"target": v.target, "embed": v.embed}
			if v.alias != "" {
				attrs["alias"] = v.alias
			}
			*out = append(*out, map[string]any{"type": "wikiLink", "attrs": attrs})
		case *ast.CodeSpan:
			var b strings.Builder
			for c := v.FirstChild(); c != nil; c = c.NextSibling() {
				if t, ok := c.(*ast.Text); ok {
					b.Write(t.Segment.Value(r.source))
				} else if s, ok := c.(*ast.String); ok {
					b.Write(s.Value)
				}
			}
			appendText(out, b.String(), addMark(marks, map[string]any{"type": "code"}))
		case *ast.Link:
			href := string(v.Destination)
			if m := mentionHrefRe.FindStringSubmatch(href); m != nil {
				label := plainText(r.inline(v))
				attrs := map[string]any{"id": m[2], "entityType": m[1]}
				if strings.HasPrefix(label, "@") {
					attrs["label"] = strings.TrimPrefix(label, "@")
				} else {
					attrs["label"] = label
					attrs["appearance"] = "page"
				}
				*out = append(*out, map[string]any{"type": "mention", "attrs": attrs})
				continue
			}
			r.inlineInto(v, addMark(marks, linkMark(href)), out)
		case *ast.AutoLink:
			url := string(v.URL(r.source))
			href := url
			if v.AutoLinkType == ast.AutoLinkEmail && !strings.HasPrefix(href, "mailto:") {
				href = "mailto:" + href
			}
			appendText(out, string(v.Label(r.source)), addMark(marks, linkMark(href)))
		case *ast.Image:
			attrs := map[string]any{"src": string(v.Destination)}
			if alt := plainText(r.inline(v)); alt != "" {
				attrs["alt"] = alt
			}
			if len(v.Title) > 0 {
				attrs["title"] = unescapeMarkdown(string(v.Title))
			}
			*out = append(*out, map[string]any{"type": "image", "attrs": attrs})
		case *ast.RawHTML:
			raw := r.rawHTML(v)
			switch tag := strings.ToLower(strings.TrimSpace(raw)); {
			case tag == "<u>":
				marks = addMark(marks, map[string]any{"type": "underline"})
			case tag == "</u>":
				marks = removeMark(marks, "underline")
			case tag == "<mark>":
				marks = addMark(marks, map[string]any{"type": "highlight"})
			case tag == "</mark>":
				marks = removeMark(marks, "highlight")
			case brTagRe.MatchString(tag):
				*out = append(*out, map[string]any{"type": "hardBreak"})
			default:
				appendText(out, raw, marks)
			}
		default:
			if n.HasChildren() {
				r.inlineInto(n, marks, out)
			}
		}
	}
}

func linkMark(href string) map[string]any {
	return map[string]any{"type": "link", "attrs": map[string]any{"href": href}}
}

func addMark(marks []any, mark map[string]any) []any {
	for _, existing := range marks {
		if existing.(map[string]any)["type"] == mark["type"] {
			return marks
		}
	}
	next := make([]any, 0, len(marks)+1)
	next = append(next, marks...)
	return append(next, mark)
}

func removeMark(marks []any, kind string) []any {
	next := make([]any, 0, len(marks))
	for _, mark := range marks {
		if mark.(map[string]any)["type"] != kind {
			next = append(next, mark)
		}
	}
	return next
}

// appendText adds a text node, merging it into the previous one when both
// carry the same marks (goldmark splits text at escapes and entities).
func appendText(out *[]any, value string, marks []any) {
	if value == "" {
		return
	}
	if len(*out) > 0 {
		if prev, ok := (*out)[len(*out)-1].(map[string]any); ok && prev["type"] == "text" && sameMarks(prev["marks"], marks) {
			prev["text"] = prev["text"].(string) + value
			return
		}
	}
	node := map[string]any{"type": "text", "text": value}
	if len(marks) > 0 {
		node["marks"] = marks
	}
	*out = append(*out, node)
}

func sameMarks(a any, b []any) bool {
	list, _ := a.([]any)
	if len(list) != len(b) {
		return false
	}
	for i := range list {
		am, bm := list[i].(map[string]any), b[i].(map[string]any)
		if am["type"] != bm["type"] {
			return false
		}
		if am["type"] == "link" && am["attrs"].(map[string]any)["href"] != bm["attrs"].(map[string]any)["href"] {
			return false
		}
	}
	return true
}

// unescapeMarkdown resolves backslash escapes and character references in
// one pass, so an escaped "\&amp;" stays the literal text "&amp;".
func unescapeMarkdown(value string) string {
	var b strings.Builder
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c == '\\' && i+1 < len(value) && util.IsPunct(value[i+1]) {
			b.WriteByte(value[i+1])
			i++
			continue
		}
		if c == '&' {
			if loc := entityRe.FindStringIndex(value[i:]); loc != nil {
				b.WriteString(html.UnescapeString(value[i : i+loc[1]]))
				i += loc[1] - 1
				continue
			}
		}
		b.WriteByte(c)
	}
	return b.String()
}

func paragraphNode(content []any) map[string]any {
	return withContent(map[string]any{"type": "paragraph"}, content)
}

// rawBlockNode holds verbatim text (a formula, frontmatter) as one text node.
func rawBlockNode(kind, body string) map[string]any {
	node := map[string]any{"type": kind}
	if body != "" {
		node["content"] = []any{map[string]any{"type": "text", "text": body}}
	}
	return node
}

func codeBlockNode(language, code string) map[string]any {
	var lang any
	if language != "" {
		lang = language
	}
	node := map[string]any{"type": "codeBlock", "attrs": map[string]any{"language": lang}}
	if code != "" {
		node["content"] = []any{map[string]any{"type": "text", "text": code}}
	}
	return node
}

func withContent(node map[string]any, content []any) map[string]any {
	if len(content) > 0 {
		node["content"] = content
	}
	return node
}

// languageAliases mirrors LANGUAGE_ALIASES in packages/contract/src/markdown.ts.
var languageAliases = map[string]string{
	"js": "javascript", "mjs": "javascript", "cjs": "javascript",
	"ts": "typescript", "py": "python", "rb": "ruby", "rs": "rust",
	"golang": "go", "sh": "bash", "shell": "bash", "zsh": "bash",
	"yml": "yaml", "md": "markdown", "htm": "html", "jsonc": "json",
	"c++": "cpp", "c#": "csharp", "cs": "csharp", "kt": "kotlin",
	"plaintext": "", "text": "", "txt": "", "plain": "",
}

func normalizeLanguage(raw string) string {
	fields := strings.Fields(strings.ToLower(raw))
	if len(fields) == 0 {
		return ""
	}
	if alias, ok := languageAliases[fields[0]]; ok {
		return alias
	}
	return fields[0]
}

func plainText(nodes []any) string {
	var b strings.Builder
	for _, raw := range nodes {
		n, ok := asMap(raw)
		if !ok {
			continue
		}
		switch n["type"] {
		case "text":
			s, _ := n["text"].(string)
			b.WriteString(s)
		case "hardBreak":
			b.WriteString("\n")
		case "mention":
			attrs, _ := asMap(n["attrs"])
			label, _ := attrs["label"].(string)
			if attrs["appearance"] != "page" {
				label = "@" + label
			}
			b.WriteString(label)
		case "image":
			attrs, _ := asMap(n["attrs"])
			alt, _ := attrs["alt"].(string)
			b.WriteString(alt)
		case "mathInline":
			attrs, _ := asMap(n["attrs"])
			latex, _ := attrs["latex"].(string)
			b.WriteString(latex)
		case "wikiLink":
			attrs, _ := asMap(n["attrs"])
			label, _ := attrs["alias"].(string)
			if label == "" {
				label, _ = attrs["target"].(string)
			}
			b.WriteString(label)
		case "footnoteRef":
			// Reference markers carry no words worth searching.
		default:
			b.WriteString(plainText(asSlice(n["content"])))
		}
	}
	return b.String()
}

var inlineTypes = map[string]bool{"text": true, "hardBreak": true, "mention": true, "image": true, "mathInline": true, "footnoteRef": true, "wikiLink": true}

func blockTexts(nodes []any, out *[]string) {
	for _, raw := range nodes {
		n, ok := asMap(raw)
		if !ok {
			continue
		}
		hasBlocks := false
		for _, child := range asSlice(n["content"]) {
			if c, ok := asMap(child); ok && !inlineTypes[c["type"].(string)] {
				hasBlocks = true
			}
		}
		if n["type"] == "bookmark" {
			if s := bookmarkText(n); s != "" {
				*out = append(*out, s)
			}
			continue
		}
		if n["type"] == "codeBlock" || !hasBlocks {
			if s := plainText(asSlice(n["content"])); s != "" {
				*out = append(*out, s)
			}
			continue
		}
		blockTexts(asSlice(n["content"]), out)
	}
}
