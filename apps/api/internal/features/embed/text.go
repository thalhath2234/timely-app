package embed

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"timely-api/internal/models"
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

func contentHash(model, content string) string {
	sum := sha256.Sum256([]byte(model + "\x00" + content))
	return hex.EncodeToString(sum[:])
}

// Chunk splits text into overlapping rune windows. Empty input yields nothing.
func Chunk(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	runes := []rune(text)
	if len(runes) <= chunkSize {
		return []string{text}
	}

	var chunks []string
	start := 0
	for len(chunks) < maxChunks && start < len(runes) {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		if end < len(runes) {
			end = breakAtBoundary(runes, start, end)
		}
		chunks = append(chunks, string(runes[start:end]))
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
