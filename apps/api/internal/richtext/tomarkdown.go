// Package richtext converts between the editor's ProseMirror JSON and
// Markdown. ToMarkdown and FromMarkdown are inverses: a doc exported as .md
// and imported again (here or by the web/mobile importer in
// packages/contract/src/markdown.ts) comes back unchanged. The shared
// fixture in testdata/ pins that contract for both languages.
package richtext

import (
	"regexp"
	"strconv"
	"strings"
	"timely-api/internal/models"
	"unicode"
)

// ToMarkdown walks a ProseMirror document produced by the editor.
func ToMarkdown(doc models.JSONMap) string {
	if doc == nil {
		return ""
	}
	content := asSlice(doc["content"])
	out := strings.TrimSpace(renderBlocks(content, true))
	// A divider on the first line would read as the start of frontmatter.
	if first, ok := asMap(firstOf(content)); ok && first["type"] != "frontmatter" && (strings.HasPrefix(out, "---\n") || out == "---") {
		out = "***" + out[3:]
	}
	return out
}

// renderBlocks renders block nodes as Markdown blocks separated by blank
// lines. With keepEmpty, an empty paragraph between other blocks is written
// as a lone <br> so the blank line survives a round trip; leading and
// trailing empty paragraphs are dropped.
func renderBlocks(nodes []any, keepEmpty bool) string {
	var parts []string
	prevFamily, prevAlt := "", false
	for _, raw := range nodes {
		n, ok := asMap(raw)
		if !ok {
			continue
		}
		block := renderBlock(n)
		family, alt := listFamily(n["type"]), false
		if family != "" && family == prevFamily && !prevAlt {
			block, alt = renderList(n, true), true
		}
		if block == "" {
			if keepEmpty && n["type"] == "paragraph" {
				parts = append(parts, "")
				prevFamily, prevAlt = "", false
			}
			continue
		}
		prevFamily, prevAlt = family, alt
		parts = append(parts, block)
	}
	for len(parts) > 0 && parts[0] == "" {
		parts = parts[1:]
	}
	for len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	for i, part := range parts {
		if part == "" {
			parts[i] = "<br>"
		}
	}
	return strings.Join(parts, "\n\n")
}

// renderBlock renders one block node without surrounding blank lines.
func renderBlock(n map[string]any) string {
	kind, _ := n["type"].(string)
	switch kind {
	case "paragraph":
		return escapeLineStarts(renderInline(asSlice(n["content"]), "\\\n"))
	case "heading":
		level := intAttr(n, "level", 1)
		if level < 1 || level > 6 {
			level = 1
		}
		text := renderInline(asSlice(n["content"]), " ")
		// A closing run of # would be read as an optional closing sequence.
		if strings.HasSuffix(text, "#") {
			text = text[:len(text)-1] + `\#`
		}
		return strings.Repeat("#", level) + " " + text
	case "bulletList", "orderedList", "taskList":
		return renderList(n, false)
	case "blockquote":
		return quoteLines(renderBlocks(asSlice(n["content"]), true))
	case "callout":
		// > [!NOTE] Title, then the body as its own quoted paragraphs.
		kind, _ := attrOf(n, "kind").(string)
		if kind == "" {
			kind = "note"
		}
		head := "[!" + strings.ToUpper(kind) + "]"
		if title, _ := attrOf(n, "title").(string); title != "" {
			head += " " + escapeText(title)
		}
		body := renderBlocks(asSlice(n["content"]), true)
		if body != "" {
			head += "\n\n" + body
		}
		return quoteLines(head)
	case "mathBlock":
		return "$$\n" + textContent(asSlice(n["content"])) + "\n$$"
	case "frontmatter":
		return "---\n" + textContent(asSlice(n["content"])) + "\n---"
	case "footnote":
		label, _ := attrOf(n, "label").(string)
		body := renderBlocks(asSlice(n["content"]), true)
		// The body starts on the marker line when it is a paragraph; lists
		// and code go on their own lines. Continuation lines are indented.
		if first, ok := asMap(firstOf(asSlice(n["content"]))); ok && first["type"] == "paragraph" {
			return "[^" + label + "]: " + indentContinuation(body, 4)
		}
		return "[^" + label + "]:\n" + indentContinuation("\n"+body, 4)[1:]
	case "codeBlock":
		lang := ""
		if attrs, ok := asMap(n["attrs"]); ok {
			lang, _ = attrs["language"].(string)
		}
		text := textContent(asSlice(n["content"]))
		// A fence must be longer than any backtick run inside the code.
		fence := strings.Repeat("`", max(3, longestRun(text, '`')+1))
		return fence + lang + "\n" + text + "\n" + fence
	case "horizontalRule":
		return "---"
	case "table":
		return renderTable(asSlice(n["content"]))
	case "listItem", "taskItem", "tableRow", "tableCell", "tableHeader":
		return renderBlocks(asSlice(n["content"]), false)
	default:
		return escapeLineStarts(renderInline([]any{n}, "\\\n"))
	}
}

// quoteLines prefixes every line with "> " (">" on blank lines).
func quoteLines(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if line == "" {
			lines[i] = ">"
		} else {
			lines[i] = "> " + line
		}
	}
	return strings.Join(lines, "\n")
}

func firstOf(nodes []any) any {
	if len(nodes) == 0 {
		return nil
	}
	return nodes[0]
}

var (
	headingStartRe = regexp.MustCompile(`^#{1,6}(\s|$)`)
	bulletStartRe  = regexp.MustCompile(`^[+\-](\s|$)`)
	orderedStartRe = regexp.MustCompile(`^(\d{1,9})([.)])(\s|$)`)
	underlineRe    = regexp.MustCompile(`^(=+|-+)\s*$`)
	entityRe       = regexp.MustCompile(`^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});`)
)

// escapeLineStarts keeps text at the start of a line from being read as a
// heading, quote, list item, setext underline or indented code.
func escapeLineStarts(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		switch {
		case strings.HasPrefix(line, " "), strings.HasPrefix(line, "\t"):
			// Markdown strips leading spaces; a character reference keeps them.
			lines[i] = "&#32;" + line[1:]
			if line[0] == '\t' {
				lines[i] = "&#9;" + line[1:]
			}
		case headingStartRe.MatchString(line), strings.HasPrefix(line, ">"),
			bulletStartRe.MatchString(line), underlineRe.MatchString(line):
			lines[i] = `\` + line
		default:
			if m := orderedStartRe.FindStringSubmatchIndex(line); m != nil {
				lines[i] = line[:m[4]] + `\` + line[m[4]:]
			}
		}
	}
	return strings.Join(lines, "\n")
}

// escapeText backslash-escapes characters that Markdown would otherwise read
// as formatting. Underscores inside words are left alone (snake_case).
func escapeText(text string) string {
	runes := []rune(text)
	var b strings.Builder
	for i, r := range runes {
		switch r {
		case '\\', '*', '`', '[', ']', '~', '$':
			b.WriteRune('\\')
		case '_':
			if i == 0 || i == len(runes)-1 || !isWordRune(runes[i-1]) || !isWordRune(runes[i+1]) {
				b.WriteRune('\\')
			}
		case '=':
			if (i+1 < len(runes) && runes[i+1] == '=') || (i > 0 && runes[i-1] == '=') {
				b.WriteRune('\\')
			}
		case '<':
			if i+1 < len(runes) {
				next := runes[i+1]
				if unicode.IsLetter(next) || next == '/' || next == '!' || next == '?' {
					b.WriteRune('\\')
				}
			}
		case '&':
			if entityRe.MatchString(string(runes[i:])) {
				b.WriteRune('\\')
			}
		}
		b.WriteRune(r)
	}
	return b.String()
}

func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// linkDestination wraps a URL in <> when it holds characters that would end
// a plain (destination).
func linkDestination(href string) string {
	if strings.ContainsAny(href, " ()<>") {
		href = strings.ReplaceAll(href, "<", "%3C")
		href = strings.ReplaceAll(href, ">", "%3E")
		return "<" + href + ">"
	}
	return href
}

// listFamily groups lists Markdown would join when written back to back.
func listFamily(kind any) string {
	switch kind {
	case "bulletList", "taskList":
		return "bullet"
	case "orderedList":
		return "ordered"
	}
	return ""
}

// renderList writes a list. altMarker switches to "*" or "1)" so a list that
// directly follows a list of the same family stays a separate list.
func renderList(n map[string]any, altMarker bool) string {
	kind, _ := n["type"].(string)
	start := intAttr(n, "start", 1)
	var items []string
	for i, raw := range asSlice(n["content"]) {
		item, ok := asMap(raw)
		if !ok {
			continue
		}
		marker := "- "
		if altMarker {
			marker = "* "
		}
		checkbox := ""
		switch kind {
		case "orderedList":
			delimiter := ". "
			if altMarker {
				delimiter = ") "
			}
			marker = strconv.Itoa(start+i) + delimiter
		case "taskList":
			checked, _ := attrOf(item, "checked").(bool)
			checkbox = "[ ] "
			if checked {
				checkbox = "[x] "
			}
		}
		// Continuation lines (nested lists, extra paragraphs) are indented to
		// the item's content column so they stay inside the item.
		body := indentContinuation(renderListItem(asSlice(item["content"])), len(marker))
		items = append(items, marker+checkbox+body)
	}
	return strings.Join(items, "\n")
}

// renderListItem keeps an item tight: a nested list follows its text on the
// next line, while separate paragraphs keep a blank line between them.
func renderListItem(children []any) string {
	var b strings.Builder
	prevList := false
	first := true
	for _, raw := range children {
		child, ok := asMap(raw)
		if !ok {
			continue
		}
		block := renderBlock(child)
		if block == "" {
			continue
		}
		kind, _ := child["type"].(string)
		isList := kind == "bulletList" || kind == "orderedList" || kind == "taskList"
		if !first {
			if isList || prevList {
				b.WriteString("\n")
			} else {
				b.WriteString("\n\n")
			}
		}
		b.WriteString(block)
		prevList = isList
		first = false
	}
	return b.String()
}

func indentContinuation(text string, width int) string {
	lines := strings.Split(text, "\n")
	pad := strings.Repeat(" ", width)
	for i := 1; i < len(lines); i++ {
		if lines[i] != "" {
			lines[i] = pad + lines[i]
		}
	}
	return strings.Join(lines, "\n")
}

// renderTable writes a GFM table. Markdown has no merged cells, so a cell
// spanning several columns or rows keeps its text in its first slot and the
// slots it covered are left empty, which keeps every column aligned.
func renderTable(rows []any) string {
	type slot struct{ row, col int }
	covered := map[slot]bool{}
	var grid [][]string
	width := 0
	for r, raw := range rows {
		row, ok := asMap(raw)
		if !ok {
			continue
		}
		var line []string
		col := 0
		skipCovered := func() {
			for covered[slot{r, col}] {
				line = append(line, "")
				col++
			}
		}
		for _, cellRaw := range asSlice(row["content"]) {
			cell, ok := asMap(cellRaw)
			if !ok {
				continue
			}
			skipCovered()
			colspan := max(1, intAttr(cell, "colspan", 1))
			rowspan := max(1, intAttr(cell, "rowspan", 1))
			for c := 0; c < colspan; c++ {
				text := ""
				if c == 0 {
					text = renderCell(cell)
				}
				line = append(line, text)
				for extra := 1; extra < rowspan; extra++ {
					covered[slot{r + extra, col}] = true
				}
				col++
			}
		}
		skipCovered()
		grid = append(grid, line)
		width = max(width, len(line))
	}
	if len(grid) == 0 || width == 0 {
		return ""
	}
	lines := make([]string, 0, len(grid)+1)
	for r, line := range grid {
		for len(line) < width {
			line = append(line, "")
		}
		lines = append(lines, "| "+strings.Join(line, " | ")+" |")
		if r == 0 {
			sep := make([]string, width)
			for i := range sep {
				sep[i] = "---"
			}
			lines = append(lines, "| "+strings.Join(sep, " | ")+" |")
		}
	}
	return strings.Join(lines, "\n")
}

// renderCell flattens a cell to one line: line breaks and paragraph breaks
// become <br>, and pipes are escaped so they do not split the cell.
func renderCell(cell map[string]any) string {
	var parts []string
	for _, raw := range asSlice(cell["content"]) {
		child, ok := asMap(raw)
		if !ok {
			continue
		}
		if child["type"] == "paragraph" {
			parts = append(parts, renderInline(asSlice(child["content"]), "<br>"))
			continue
		}
		parts = append(parts, strings.ReplaceAll(renderBlock(child), "\n", "<br>"))
	}
	return strings.ReplaceAll(strings.Join(parts, "<br>"), "|", `\|`)
}

type inlineMark struct{ kind, href string }

type inlineSegment struct {
	text  string
	atom  bool // pre-rendered Markdown (mention, line break) that takes no marks
	marks []inlineMark
}

// Marks open in this order, so a link wraps bold wraps italic and so on.
var markOrder = []string{"link", "bold", "italic", "strike", "highlight", "underline", "code"}

// renderInline writes inline nodes, opening and closing each mark once across
// neighbouring text nodes so "**bold *and italic***" stays valid Markdown.
func renderInline(nodes []any, hardBreak string) string {
	segments := normalizeEdgeSpaces(mergeSegments(collectInline(nodes, hardBreak)))

	var b strings.Builder
	var open []inlineMark
	closeFrom := func(k int) {
		for len(open) > k {
			b.WriteString(closeMark(open[len(open)-1]))
			open = open[:len(open)-1]
		}
	}
	for _, seg := range segments {
		keep := 0
		for keep < len(open) && hasMark(seg.marks, open[keep]) {
			keep++
		}
		closeFrom(keep)
		if seg.atom {
			b.WriteString(seg.text)
			continue
		}
		isCode := false
		for _, m := range seg.marks {
			if m.kind == "code" {
				isCode = true
				continue
			}
			if !hasMark(open, m) {
				b.WriteString(openMark(m))
				open = append(open, m)
			}
		}
		if isCode {
			b.WriteString(codeSpan(seg.text))
		} else {
			b.WriteString(escapeText(seg.text))
		}
	}
	closeFrom(0)
	return b.String()
}

func collectInline(nodes []any, hardBreak string) []inlineSegment {
	var out []inlineSegment
	for _, raw := range nodes {
		n, ok := asMap(raw)
		if !ok {
			continue
		}
		kind, _ := n["type"].(string)
		switch kind {
		case "text":
			text, _ := n["text"].(string)
			marks := textMarks(n)
			// Text nodes should not hold newlines; old content can, so they
			// become line breaks rather than splitting the block.
			for i, line := range strings.Split(text, "\n") {
				if i > 0 {
					out = append(out, inlineSegment{atom: true, text: hardBreak})
				}
				if line != "" {
					out = append(out, inlineSegment{text: line, marks: marks})
				}
			}
		case "mention":
			attrs, _ := asMap(n["attrs"])
			label, _ := attrs["label"].(string)
			id, _ := attrs["id"].(string)
			entity, _ := attrs["entityType"].(string)
			if entity == "" {
				entity = "task"
			}
			// A subpage link shows only its title; an @mention keeps the @.
			if appearance, _ := attrs["appearance"].(string); appearance != "page" {
				label = "@" + label
			}
			out = append(out, inlineSegment{atom: true, text: "[" + escapeText(label) + "](timely://" + entity + "/" + id + ")"})
		case "image":
			attrs, _ := asMap(n["attrs"])
			src, _ := attrs["src"].(string)
			alt, _ := attrs["alt"].(string)
			title, _ := attrs["title"].(string)
			dest := linkDestination(src)
			if title != "" {
				dest += ` "` + strings.ReplaceAll(title, `"`, `\"`) + `"`
			}
			out = append(out, inlineSegment{atom: true, text: "![" + escapeText(alt) + "](" + dest + ")"})
		case "hardBreak":
			out = append(out, inlineSegment{atom: true, text: hardBreak})
		case "mathInline":
			latex, _ := attrOf(n, "latex").(string)
			out = append(out, inlineSegment{atom: true, text: "$" + latex + "$"})
		case "footnoteRef":
			label, _ := attrOf(n, "label").(string)
			out = append(out, inlineSegment{atom: true, text: "[^" + label + "]"})
		case "wikiLink":
			target, _ := attrOf(n, "target").(string)
			alias, _ := attrOf(n, "alias").(string)
			text := "[[" + target
			if alias != "" {
				text += "|" + alias
			}
			if embed, _ := attrOf(n, "embed").(bool); embed {
				text = "!" + text
			}
			out = append(out, inlineSegment{atom: true, text: text + "]]"})
		default:
			out = append(out, collectInline(asSlice(n["content"]), hardBreak)...)
		}
	}
	return out
}

// mergeSegments joins neighbouring text with the same marks. Editors can
// store one run as several text nodes, and escaping must see the whole run
// (a "=" next to a "=" in the next node is still "==").
func mergeSegments(segments []inlineSegment) []inlineSegment {
	out := make([]inlineSegment, 0, len(segments))
	for _, seg := range segments {
		if n := len(out); n > 0 && !seg.atom && !out[n-1].atom && sameMarkList(out[n-1].marks, seg.marks) {
			out[n-1].text += seg.text
			continue
		}
		out = append(out, seg)
	}
	return out
}

func sameMarkList(a, b []inlineMark) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// normalizeEdgeSpaces moves spaces at the edge of a marked run outside the
// delimiters, because "**bold **" is not bold in Markdown.
func normalizeEdgeSpaces(segments []inlineSegment) []inlineSegment {
	out := make([]inlineSegment, 0, len(segments))
	for i, seg := range segments {
		if seg.atom || len(seg.marks) == 0 || hasKind(seg.marks, "code") {
			out = append(out, seg)
			continue
		}
		var prev, next []inlineMark
		if i > 0 {
			prev = segments[i-1].marks
		}
		if i+1 < len(segments) {
			next = segments[i+1].marks
		}
		core := strings.TrimLeft(seg.text, " \t")
		lead := seg.text[:len(seg.text)-len(core)]
		trimmed := strings.TrimRight(core, " \t")
		trail := core[len(trimmed):]
		if trimmed == "" {
			out = append(out, inlineSegment{text: seg.text, marks: intersectMarks(intersectMarks(seg.marks, prev), next)})
			continue
		}
		if lead != "" {
			out = append(out, inlineSegment{text: lead, marks: intersectMarks(seg.marks, prev)})
		}
		out = append(out, inlineSegment{text: trimmed, marks: seg.marks})
		if trail != "" {
			out = append(out, inlineSegment{text: trail, marks: intersectMarks(seg.marks, next)})
		}
	}
	return out
}

func textMarks(n map[string]any) []inlineMark {
	present := map[string]inlineMark{}
	for _, raw := range asSlice(n["marks"]) {
		mark, ok := asMap(raw)
		if !ok {
			continue
		}
		kind, _ := mark["type"].(string)
		m := inlineMark{kind: kind}
		if kind == "link" {
			m.href, _ = attrOf(mark, "href").(string)
		}
		present[kind] = m
	}
	var out []inlineMark
	for _, kind := range markOrder {
		if m, ok := present[kind]; ok {
			out = append(out, m)
		}
	}
	return out
}

func openMark(m inlineMark) string {
	switch m.kind {
	case "link":
		return "["
	case "bold":
		return "**"
	case "italic":
		return "*"
	case "strike":
		return "~~"
	case "highlight":
		return "=="
	case "underline":
		return "<u>"
	}
	return ""
}

func closeMark(m inlineMark) string {
	switch m.kind {
	case "link":
		return "](" + linkDestination(m.href) + ")"
	case "underline":
		return "</u>"
	}
	return openMark(m)
}

// codeSpan wraps text in enough backticks that backticks inside it survive.
func codeSpan(text string) string {
	ticks := strings.Repeat("`", longestRun(text, '`')+1)
	// Markdown strips one space from each side of a code span when both
	// sides have one, so pad in that case too.
	spaced := strings.HasPrefix(text, " ") && strings.HasSuffix(text, " ") && strings.TrimSpace(text) != ""
	if spaced || strings.HasPrefix(text, "`") || strings.HasSuffix(text, "`") {
		return ticks + " " + text + " " + ticks
	}
	return ticks + text + ticks
}

func hasMark(marks []inlineMark, m inlineMark) bool {
	for _, candidate := range marks {
		if candidate == m {
			return true
		}
	}
	return false
}

func hasKind(marks []inlineMark, kind string) bool {
	for _, m := range marks {
		if m.kind == kind {
			return true
		}
	}
	return false
}

func intersectMarks(a, b []inlineMark) []inlineMark {
	var out []inlineMark
	for _, m := range a {
		if hasMark(b, m) {
			out = append(out, m)
		}
	}
	return out
}

func longestRun(text string, r rune) int {
	best, run := 0, 0
	for _, c := range text {
		if c == r {
			run++
			best = max(best, run)
		} else {
			run = 0
		}
	}
	return best
}

func textContent(nodes []any) string {
	var b strings.Builder
	for _, raw := range nodes {
		n, ok := asMap(raw)
		if !ok {
			continue
		}
		if text, ok := n["text"].(string); ok {
			b.WriteString(text)
		} else if n["type"] == "hardBreak" {
			b.WriteString("\n")
		}
		b.WriteString(textContent(asSlice(n["content"])))
	}
	return b.String()
}

func attrOf(n map[string]any, key string) any {
	attrs, ok := asMap(n["attrs"])
	if !ok {
		return nil
	}
	return attrs[key]
}

func intAttr(n map[string]any, key string, fallback int) int {
	switch v := attrOf(n, key).(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return fallback
}

func asMap(v any) (map[string]any, bool) {
	if n, ok := v.(map[string]any); ok {
		return n, true
	}
	if m, ok := v.(models.JSONMap); ok {
		return m, true
	}
	return nil, false
}

func asSlice(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case models.JSONMap:
		return nil
	default:
		return nil
	}
}
