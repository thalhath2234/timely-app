package embed

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
	"unicode"
	"unicode/utf8"
)

const (
	chunkSize    = 1500
	chunkOverlap = 150
	maxChunks    = 20
)

func Combine(title, body string) string {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	switch {
	case title == "":
		return body
	case body == "":
		return title
	default:
		return title + "\n\n" + body
	}
}

// DocBody is what a doc contributes to its embeddings: its properties as one
// readable line ("Properties: tags: travel, 2026; status: draft"), then its
// text without the raw frontmatter, so "draft trip notes" finds the doc.
func DocBody(doc *models.Document) string {
	plain := strings.TrimSpace(doc.PlainText)
	fm := richtext.Frontmatter(doc.Content)
	if fm == "" {
		return plain
	}
	plain = strings.TrimSpace(strings.TrimPrefix(plain, strings.TrimSpace(fm)))
	line := richtext.DescribeProperties(richtext.ParseProperties(fm))
	if line == "" {
		return plain
	}
	return "Properties: " + line + "\n\n" + plain
}

func contentHash(model, content string) string {
	sum := sha256.Sum256([]byte(model + "\x00" + content))
	return hex.EncodeToString(sum[:])
}

// Chunk splits text into overlapping rune windows, at most maxChunks of them,
// spread over the whole of a longer text. Empty input yields nothing.
func Chunk(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	runes := []rune(text)
	if len(runes) <= chunkSize {
		return []string{text}
	}

	type window struct{ start, end int }
	var windows []window
	start := 0
	for start < len(runes) {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		if end < len(runes) {
			end = breakAtBoundary(runes, start, end)
		}
		windows = append(windows, window{start, end})
		if end >= len(runes) {
			break
		}
		start = end - chunkOverlap
		if start < 0 {
			start = 0
		}
		if start >= end {
			start = end
		}
	}
	// A long text keeps maxChunks windows spread evenly from its first to its
	// last, so its middle and end can be found by meaning too, not only its
	// first maxChunks windows.
	picked := windows
	if len(windows) > maxChunks {
		picked = make([]window, maxChunks)
		for n := range picked {
			picked[n] = windows[n*(len(windows)-1)/(maxChunks-1)]
		}
	}
	chunks := make([]string, len(picked))
	for n, w := range picked {
		chunks[n] = string(runes[w.start:w.end])
	}
	return chunks
}

func breakAtBoundary(runes []rune, start, end int) int {
	window := runes[start:end]
	for i := len(window) - 1; i > len(window)/2; i-- {
		if window[i] == '\n' || unicode.IsSpace(window[i]) {
			return start + i + 1
		}
	}
	return end
}

func FlattenSheet(sheet *models.Sheet) string {
	if sheet == nil {
		return ""
	}
	var b strings.Builder

	names := make(map[string]string, len(sheet.Columns))
	for _, col := range sheet.Columns {
		name := strings.TrimSpace(col.Name)
		if name == "" {
			name = col.ID
		}
		names[col.ID] = name
	}

	appendRows := func(columns models.SheetColumns, rows models.SheetRows, names map[string]string) {
		for _, row := range rows {
			var parts []string
			for _, col := range columns {
				value := strings.TrimSpace(row.Cells[col.ID])
				if value == "" {
					continue
				}
				parts = append(parts, names[col.ID]+": "+value)
			}
			if len(parts) == 0 {
				continue
			}
			if b.Len() > 0 {
				b.WriteString("\n")
			}
			b.WriteString(strings.Join(parts, " · "))
		}
	}

	appendRows(sheet.Columns, sheet.Rows, names)
	for i, tab := range sheet.Tabs {
		if i == 0 {
			continue
		}
		tabNames := make(map[string]string, len(tab.Columns))
		for _, col := range tab.Columns {
			name := strings.TrimSpace(col.Name)
			if name == "" {
				name = col.ID
			}
			tabNames[col.ID] = name
		}
		if b.Len() > 0 && strings.TrimSpace(tab.Name) != "" {
			b.WriteString("\n")
			b.WriteString(tab.Name)
		}
		appendRows(tab.Columns, tab.Rows, tabNames)
	}
	return b.String()
}

func validUTF8(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	return strings.ToValidUTF8(s, "")
}
