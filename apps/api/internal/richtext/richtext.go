package richtext

import (
	"regexp"
	"strconv"
	"strings"
	"timely-api/internal/models"
)

var (
	headingRe   = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)
	ulRe        = regexp.MustCompile(`^(\s*)[-*]\s+(.*)$`)
	olRe        = regexp.MustCompile(`^(\s*)\d+\.\s+(.*)$`)
	taskRe      = regexp.MustCompile(`^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$`)
	hrRe        = regexp.MustCompile(`^(\*\*\*|---|___)\s*$`)
	fenceRe     = regexp.MustCompile("^```([a-zA-Z0-9_-]*)\\s*$")
	tableRowRe  = regexp.MustCompile(`^\|(.+)\|$`)
	tableSepRe  = regexp.MustCompile(`^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$`)
	mentionRe   = regexp.MustCompile(`\[@([^\]]+)\]\(timely://(task|project|doc|sheet)/([^)]+)\)`)
	linkRe      = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	boldRe      = regexp.MustCompile(`\*\*(.+?)\*\*`)
	italicRe    = regexp.MustCompile(`\*(.+?)\*`)
	strikeRe    = regexp.MustCompile(`~~(.+?)~~`)
	highlightRe = regexp.MustCompile(`==(.+?)==`)
	codeRe      = regexp.MustCompile("`([^`]+)`")
	underlineRe = regexp.MustCompile(`<u>(.+?)</u>`)
	brRe        = regexp.MustCompile(`(?i)<br\s*/?>`)
)

// FromMarkdown turns agent-authored markdown into a ProseMirror document and
// a plain-text copy used for search.
func FromMarkdown(src string) (models.JSONMap, string) {
	src = strings.ReplaceAll(src, "\r\n", "\n")
	lines := strings.Split(src, "\n")
	var content []any
	var plain []string

	i := 0
	for i < len(lines) {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			i++
			continue
		}

		if m := fenceRe.FindStringSubmatch(trimmed); m != nil {
			lang := m[1]
			var body []string
			i++
			for i < len(lines) && !fenceRe.MatchString(strings.TrimSpace(lines[i])) {
				body = append(body, lines[i])
				i++
			}
			if i < len(lines) {
				i++
			}
			text := strings.Join(body, "\n")
			attrs := map[string]any{}
			if lang != "" {
				attrs["language"] = lang
			}
			content = append(content, node("codeBlock", attrs, []any{textNode(text)}))
			plain = append(plain, text)
			continue
		}

		if hrRe.MatchString(trimmed) {
			content = append(content, node("horizontalRule", nil, nil))
			i++
			continue
		}

		if m := headingRe.FindStringSubmatch(trimmed); m != nil {
			level := len(m[1])
			in, p := inline(m[2])
			content = append(content, node("heading", map[string]any{"level": level}, in))
			plain = append(plain, p)
			i++
			continue
		}

		if tableRowRe.MatchString(trimmed) && i+1 < len(lines) && tableSepRe.MatchString(strings.TrimSpace(lines[i+1])) {
			table, texts, consumed := parseTable(lines[i:])
			content = append(content, table)
			plain = append(plain, texts...)
			i += consumed
			continue
		}

		if taskRe.MatchString(line) {
			items, texts, consumed := parseTaskList(lines[i:])
			content = append(content, node("taskList", nil, items))
			plain = append(plain, texts...)
			i += consumed
			continue
		}

		if ulRe.MatchString(line) {
			items, texts, consumed := parseList(lines[i:], false)
			content = append(content, node("bulletList", nil, items))
			plain = append(plain, texts...)
			i += consumed
			continue
		}

		if olRe.MatchString(line) {
			items, texts, consumed := parseList(lines[i:], true)
			content = append(content, node("orderedList", nil, items))
			plain = append(plain, texts...)
			i += consumed
			continue
		}

		if strings.HasPrefix(trimmed, "> ") || trimmed == ">" {
			quote, texts, consumed := parseQuote(lines[i:])
			content = append(content, quote)
			plain = append(plain, texts...)
			i += consumed
			continue
		}

		in, p := inline(trimmed)
		content = append(content, node("paragraph", nil, in))
		plain = append(plain, p)
		i++
	}

	if len(content) == 0 {
		content = []any{node("paragraph", nil, nil)}
	}
	return models.JSONMap{"type": "doc", "content": content}, strings.Join(plain, "\n")
}

// ToMarkdown walks a ProseMirror document produced by the editor.
func ToMarkdown(doc models.JSONMap) string {
	if doc == nil {
		return ""
	}
	return strings.TrimSpace(renderBlocks(asSlice(doc["content"])))
}

func parseList(lines []string, ordered bool) ([]any, []string, int) {
	var items []any
	var texts []string
	consumed := 0
	for consumed < len(lines) {
		line := lines[consumed]
		var rest string
		if ordered {
			m := olRe.FindStringSubmatch(line)
			if m == nil {
				break
			}
			rest = m[2]
		} else {
			if taskRe.MatchString(line) {
				break
			}
			m := ulRe.FindStringSubmatch(line)
			if m == nil {
				break
			}
			rest = m[2]
		}
		in, p := inline(rest)
		items = append(items, node("listItem", nil, []any{node("paragraph", nil, in)}))
		texts = append(texts, p)
		consumed++
	}
	if consumed == 0 {
		consumed = 1
	}
	return items, texts, consumed
}

func parseTaskList(lines []string) ([]any, []string, int) {
	var items []any
	var texts []string
	consumed := 0
	for consumed < len(lines) {
		m := taskRe.FindStringSubmatch(lines[consumed])
		if m == nil {
			break
		}
		checked := strings.EqualFold(m[2], "x")
		in, p := inline(m[3])
		items = append(items, node("taskItem", map[string]any{"checked": checked}, []any{node("paragraph", nil, in)}))
		texts = append(texts, p)
		consumed++
	}
	if consumed == 0 {
		consumed = 1
	}
	return items, texts, consumed
}

func parseQuote(lines []string) (map[string]any, []string, int) {
	var paras []any
	var texts []string
	consumed := 0
	for consumed < len(lines) {
		trimmed := strings.TrimSpace(lines[consumed])
		if !strings.HasPrefix(trimmed, ">") {
			break
		}
		rest := strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))
		if rest == "" {
			consumed++
			continue
		}
		in, p := inline(rest)
		paras = append(paras, node("paragraph", nil, in))
		texts = append(texts, p)
		consumed++
	}
	if len(paras) == 0 {
		paras = []any{node("paragraph", nil, nil)}
	}
	if consumed == 0 {
		consumed = 1
	}
	return node("blockquote", nil, paras), texts, consumed
}

func parseTable(lines []string) (map[string]any, []string, int) {
	var rows [][]string
	consumed := 0
	for consumed < len(lines) {
		trimmed := strings.TrimSpace(lines[consumed])
		if consumed == 1 && tableSepRe.MatchString(trimmed) {
			consumed++
			continue
		}
		if !tableRowRe.MatchString(trimmed) {
			break
		}
		rows = append(rows, splitTableRow(trimmed))
		consumed++
	}
	var tableRows []any
	var texts []string
	for r, row := range rows {
		var cells []any
		for _, cell := range row {
			in, p := cellInline(cell)
			kind := "tableCell"
			if r == 0 {
				kind = "tableHeader"
			}
			cells = append(cells, node(kind, nil, []any{node("paragraph", nil, in)}))
			texts = append(texts, p)
		}
		tableRows = append(tableRows, node("tableRow", nil, cells))
	}
	return node("table", nil, tableRows), texts, consumed
}

// splitTableRow splits a row like "| a | b \| c |" on unescaped pipes and unescapes
// the rest, matching what ToMarkdown writes.
func splitTableRow(line string) []string {
	line = strings.TrimPrefix(line, "|")
	if strings.HasSuffix(line, "|") && !strings.HasSuffix(line, `\|`) {
		line = strings.TrimSuffix(line, "|")
	}
	var cells []string
	var cell strings.Builder
	for i := 0; i < len(line); i++ {
		if line[i] == '\\' && i+1 < len(line) && line[i+1] == '|' {
			cell.WriteByte('|')
			i++
			continue
		}
		if line[i] == '|' {
			cells = append(cells, strings.TrimSpace(cell.String()))
			cell.Reset()
			continue
		}
		cell.WriteByte(line[i])
	}
	return append(cells, strings.TrimSpace(cell.String()))
}

// cellInline parses one table cell, turning <br> back into line breaks.
func cellInline(src string) ([]any, string) {
	var out []any
	var plain []string
	for i, part := range brRe.Split(src, -1) {
		if i > 0 {
			out = append(out, map[string]any{"type": "hardBreak"})
		}
		in, p := inline(strings.TrimSpace(part))
		out = append(out, in...)
		plain = append(plain, p)
	}
	return out, strings.Join(plain, " ")
}

func inline(src string) ([]any, string) {
	if src == "" {
		return nil, ""
	}
	type token struct {
		kind  string
		text  string
		attrs map[string]any
		marks []any
	}
	rest := src
	var tokens []token
	plain := strings.Builder{}

	for rest != "" {
		switch {
		case strings.HasPrefix(rest, "[@"):
			if loc := mentionRe.FindStringSubmatchIndex(rest); loc != nil && loc[0] == 0 {
				label := rest[loc[2]:loc[3]]
				kind := rest[loc[4]:loc[5]]
				id := rest[loc[6]:loc[7]]
				tokens = append(tokens, token{
					kind:  "mention",
					text:  label,
					attrs: map[string]any{"id": id, "label": label, "entityType": kind},
				})
				plain.WriteString("@" + label)
				rest = rest[loc[1]:]
				continue
			}
			fallthrough
		case strings.HasPrefix(rest, "["):
			if loc := linkRe.FindStringSubmatchIndex(rest); loc != nil && loc[0] == 0 {
				label := rest[loc[2]:loc[3]]
				href := rest[loc[4]:loc[5]]
				inner, p := inline(label)
				_ = inner
				tokens = append(tokens, token{
					kind:  "text",
					text:  p,
					marks: []any{map[string]any{"type": "link", "attrs": map[string]any{"href": href}}},
				})
				plain.WriteString(p)
				rest = rest[loc[1]:]
				continue
			}
		}

		next := firstInline(rest)
		if next.start > 0 {
			chunk := rest[:next.start]
			tokens = append(tokens, token{kind: "text", text: chunk})
			plain.WriteString(chunk)
			rest = rest[next.start:]
			continue
		}
		if next.length == 0 {
			tokens = append(tokens, token{kind: "text", text: rest})
			plain.WriteString(rest)
			break
		}
		inner := rest[next.innerStart:next.innerEnd]
		tokens = append(tokens, token{kind: "text", text: inner, marks: []any{map[string]any{"type": next.mark}}})
		plain.WriteString(inner)
		rest = rest[next.length:]
	}

	out := make([]any, 0, len(tokens))
	for _, t := range tokens {
		if t.kind == "mention" {
			out = append(out, map[string]any{"type": "mention", "attrs": t.attrs})
			continue
		}
		n := map[string]any{"type": "text", "text": t.text}
		if len(t.marks) > 0 {
			n["marks"] = t.marks
		}
		out = append(out, n)
	}
	return out, plain.String()
}

type inlineMatch struct {
	start, length, innerStart, innerEnd int
	mark                                string
}

func firstInline(src string) inlineMatch {
	best := inlineMatch{start: len(src)}
	try := func(re *regexp.Regexp, mark string) {
		loc := re.FindStringSubmatchIndex(src)
		if loc == nil {
			return
		}
		if loc[0] < best.start {
			best = inlineMatch{start: loc[0], length: loc[1], innerStart: loc[2], innerEnd: loc[3], mark: mark}
		}
	}
	try(boldRe, "bold")
	try(italicRe, "italic")
	try(strikeRe, "strike")
	try(highlightRe, "highlight")
	try(codeRe, "code")
	try(underlineRe, "underline")
	if best.start == len(src) {
		return inlineMatch{}
	}
	return best
}

// renderBlocks renders block nodes as Markdown blocks separated by blank lines.
func renderBlocks(nodes []any) string {
	var parts []string
	for _, raw := range nodes {
		n, ok := asMap(raw)
		if !ok {
			continue
		}
		if block := renderBlock(n); block != "" {
			parts = append(parts, block)
		}
	}
	return strings.Join(parts, "\n\n")
}

// renderBlock renders one block node without surrounding blank lines.
func renderBlock(n map[string]any) string {
	kind, _ := n["type"].(string)
	switch kind {
	case "paragraph":
		return renderInline(asSlice(n["content"]), "  \n")
	case "heading":
		level := intAttr(n, "level", 1)
		if level < 1 || level > 6 {
			level = 1
		}
		return strings.Repeat("#", level) + " " + renderInline(asSlice(n["content"]), " ")
	case "bulletList", "orderedList", "taskList":
		return renderList(n)
	case "blockquote":
		lines := strings.Split(renderBlocks(asSlice(n["content"])), "\n")
		for i, line := range lines {
			if line == "" {
				lines[i] = ">"
			} else {
				lines[i] = "> " + line
			}
		}
		return strings.Join(lines, "\n")
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
		return renderBlocks(asSlice(n["content"]))
	default:
		return renderInline([]any{n}, "  \n")
	}
}

func renderList(n map[string]any) string {
	kind, _ := n["type"].(string)
	start := intAttr(n, "start", 1)
	var items []string
	for i, raw := range asSlice(n["content"]) {
		item, ok := asMap(raw)
		if !ok {
			continue
		}
		marker := "- "
		checkbox := ""
		switch kind {
		case "orderedList":
			marker = strconv.Itoa(start+i) + ". "
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
	text := renderBlocks(asSlice(cell["content"]))
	text = strings.ReplaceAll(text, "  \n", "<br>")
	text = strings.ReplaceAll(text, "\n\n", "<br>")
	text = strings.ReplaceAll(text, "\n", "<br>")
	return strings.ReplaceAll(text, "|", `\|`)
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
	segments := normalizeEdgeSpaces(collectInline(nodes, hardBreak))

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
			b.WriteString(seg.text)
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
			if text != "" {
				out = append(out, inlineSegment{text: text, marks: textMarks(n)})
			}
		case "mention":
			attrs, _ := asMap(n["attrs"])
			label, _ := attrs["label"].(string)
			id, _ := attrs["id"].(string)
			entity, _ := attrs["entityType"].(string)
			if entity == "" {
				entity = "task"
			}
			out = append(out, inlineSegment{atom: true, text: "[@" + label + "](timely://" + entity + "/" + id + ")"})
		case "hardBreak":
			out = append(out, inlineSegment{atom: true, text: hardBreak})
		default:
			out = append(out, collectInline(asSlice(n["content"]), hardBreak)...)
		}
	}
	return out
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
		return "](" + m.href + ")"
	case "underline":
		return "</u>"
	}
	return openMark(m)
}

// codeSpan wraps text in enough backticks that backticks inside it survive.
func codeSpan(text string) string {
	ticks := strings.Repeat("`", longestRun(text, '`')+1)
	if strings.HasPrefix(text, "`") || strings.HasSuffix(text, "`") {
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

func node(kind string, attrs map[string]any, content []any) map[string]any {
	n := map[string]any{"type": kind}
	if attrs != nil {
		n["attrs"] = attrs
	}
	if content != nil {
		n["content"] = content
	}
	return n
}

func textNode(text string) map[string]any {
	return map[string]any{"type": "text", "text": text}
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
