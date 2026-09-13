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
	return strings.TrimSpace(renderNodes(asSlice(doc["content"]), 0))
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
		inner := strings.Trim(trimmed, "|")
		cells := strings.Split(inner, "|")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		rows = append(rows, cells)
		consumed++
	}
	var tableRows []any
	var texts []string
	for r, row := range rows {
		var cells []any
		for _, cell := range row {
			in, p := inline(cell)
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

func renderNodes(nodes []any, depth int) string {
	var b strings.Builder
	for _, raw := range nodes {
		n, ok := raw.(map[string]any)
		if !ok {
			if m, ok := raw.(models.JSONMap); ok {
				n = m
			} else {
				continue
			}
		}
		kind, _ := n["type"].(string)
		switch kind {
		case "paragraph":
			b.WriteString(renderInline(asSlice(n["content"])))
			b.WriteString("\n\n")
		case "heading":
			level := 1
			if attrs, ok := n["attrs"].(map[string]any); ok {
				switch v := attrs["level"].(type) {
				case float64:
					level = int(v)
				case int:
					level = v
				}
			}
			b.WriteString(strings.Repeat("#", level) + " " + renderInline(asSlice(n["content"])) + "\n\n")
		case "bulletList":
			for _, item := range asSlice(n["content"]) {
				im, _ := item.(map[string]any)
				b.WriteString("- " + strings.TrimSpace(renderNodes(asSlice(im["content"]), depth+1)) + "\n")
			}
			b.WriteString("\n")
		case "orderedList":
			i := 1
			for _, item := range asSlice(n["content"]) {
				im, _ := item.(map[string]any)
				b.WriteString(strconv.Itoa(i) + ". " + strings.TrimSpace(renderNodes(asSlice(im["content"]), depth+1)) + "\n")
				i++
			}
			b.WriteString("\n")
		case "taskList":
			for _, item := range asSlice(n["content"]) {
				im, _ := item.(map[string]any)
				checked := false
				if attrs, ok := im["attrs"].(map[string]any); ok {
					checked, _ = attrs["checked"].(bool)
				}
				mark := " "
				if checked {
					mark = "x"
				}
				b.WriteString("- [" + mark + "] " + strings.TrimSpace(renderNodes(asSlice(im["content"]), depth+1)) + "\n")
			}
			b.WriteString("\n")
		case "listItem", "taskItem":
			b.WriteString(renderNodes(asSlice(n["content"]), depth+1))
		case "blockquote":
			inner := strings.TrimSpace(renderNodes(asSlice(n["content"]), depth+1))
			for _, line := range strings.Split(inner, "\n") {
				b.WriteString("> " + line + "\n")
			}
			b.WriteString("\n")
		case "codeBlock":
			lang := ""
			if attrs, ok := n["attrs"].(map[string]any); ok {
				lang, _ = attrs["language"].(string)
			}
			b.WriteString("```" + lang + "\n" + renderInline(asSlice(n["content"])) + "\n```\n\n")
		case "horizontalRule":
			b.WriteString("---\n\n")
		case "table":
			b.WriteString(renderTable(asSlice(n["content"])))
		case "hardBreak":
			b.WriteString("\n")
		default:
			b.WriteString(renderInline([]any{n}))
		}
	}
	return b.String()
}

func renderTable(rows []any) string {
	var lines []string
	for r, raw := range rows {
		row, _ := raw.(map[string]any)
		var cells []string
		for _, cellRaw := range asSlice(row["content"]) {
			cell, _ := cellRaw.(map[string]any)
			cells = append(cells, strings.ReplaceAll(strings.TrimSpace(renderNodes(asSlice(cell["content"]), 0)), "\n", " "))
		}
		lines = append(lines, "| "+strings.Join(cells, " | ")+" |")
		if r == 0 {
			sep := make([]string, len(cells))
			for i := range sep {
				sep[i] = "---"
			}
			lines = append(lines, "| "+strings.Join(sep, " | ")+" |")
		}
	}
	return strings.Join(lines, "\n") + "\n\n"
}

func renderInline(nodes []any) string {
	var b strings.Builder
	for _, raw := range nodes {
		n, ok := raw.(map[string]any)
		if !ok {
			if m, ok := raw.(models.JSONMap); ok {
				n = m
			} else {
				continue
			}
		}
		kind, _ := n["type"].(string)
		switch kind {
		case "mention":
			attrs, _ := n["attrs"].(map[string]any)
			label, _ := attrs["label"].(string)
			id, _ := attrs["id"].(string)
			entity, _ := attrs["entityType"].(string)
			if entity == "" {
				entity = "task"
			}
			b.WriteString("[@" + label + "](timely://" + entity + "/" + id + ")")
		case "hardBreak":
			b.WriteString("\n")
		case "text":
			text, _ := n["text"].(string)
			marks := asSlice(n["marks"])
			for i := len(marks) - 1; i >= 0; i-- {
				mark, _ := marks[i].(map[string]any)
				switch mark["type"] {
				case "bold":
					text = "**" + text + "**"
				case "italic":
					text = "*" + text + "*"
				case "strike":
					text = "~~" + text + "~~"
				case "code":
					text = "`" + text + "`"
				case "underline":
					text = "<u>" + text + "</u>"
				case "highlight":
					text = "==" + text + "=="
				case "link":
					href := ""
					if attrs, ok := mark["attrs"].(map[string]any); ok {
						href, _ = attrs["href"].(string)
					}
					text = "[" + text + "](" + href + ")"
				}
			}
			b.WriteString(text)
		default:
			b.WriteString(renderInline(asSlice(n["content"])))
		}
	}
	return b.String()
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
