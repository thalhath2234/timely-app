package richtext

import (
	"strings"
	"timely-api/internal/models"
)

// LinkSnippets returns the text of each block in doc that links to the doc
// with docID, either as an @mention or subpage link, or as a [[wiki link]]
// naming its title (case-insensitive, ignoring a #heading part).
func LinkSnippets(doc models.JSONMap, docID, title string) []string {
	title = strings.TrimSpace(title)
	var out []string
	var walk func(nodes []any)
	walk = func(nodes []any) {
		for _, raw := range nodes {
			n, ok := asMap(raw)
			if !ok {
				continue
			}
			content := asSlice(n["content"])
			if isTextblock(content) {
				if linksTo(content, docID, title) {
					snippet := strings.TrimSpace(plainText(content))
					if len([]rune(snippet)) > 200 {
						snippet = string([]rune(snippet)[:200]) + "…"
					}
					out = append(out, snippet)
				}
				continue
			}
			walk(content)
		}
	}
	walk(asSlice(doc["content"]))
	return out
}

func isTextblock(content []any) bool {
	if len(content) == 0 {
		return false
	}
	for _, raw := range content {
		if c, ok := asMap(raw); !ok || !inlineTypes[stringOf(c["type"])] {
			return false
		}
	}
	return true
}

func linksTo(content []any, docID, title string) bool {
	for _, raw := range content {
		n, _ := asMap(raw)
		attrs, _ := asMap(n["attrs"])
		switch n["type"] {
		case "mention":
			kind := stringOf(attrs["entityType"])
			if attrs["id"] == docID && (kind == "" || kind == "doc") {
				return true
			}
		case "wikiLink":
			page, _, _ := strings.Cut(stringOf(attrs["target"]), "#")
			if title != "" && strings.EqualFold(strings.TrimSpace(page), title) {
				return true
			}
		}
	}
	return false
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}
