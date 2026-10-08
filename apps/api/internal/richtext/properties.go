package richtext

import (
	"regexp"
	"strings"
)

// Property is one key of a doc's frontmatter with its values. The web and
// mobile editors read frontmatter the same way (packages/contract/src/properties.ts).
type Property struct {
	Key    string
	Values []string
}

// Keys whose comma-separated values are a list, as Obsidian reads them.
var listKeys = map[string]bool{
	"tags": true, "tag": true, "aliases": true, "alias": true,
	"categories": true, "category": true, "keywords": true, "cssclasses": true,
}

var (
	propItemRe    = regexp.MustCompile(`^\s*-\s+(.*)$`)
	propLineRe    = regexp.MustCompile(`^([A-Za-z0-9_-]+)\s*:\s*(.*)$`)
	propCommentRe = regexp.MustCompile(`\s+#.*$`)
)

func unquoteProp(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
		value = value[1 : len(value)-1]
	}
	return strings.TrimSpace(value)
}

// ParseProperties reads the YAML people write by hand in frontmatter:
// "key: value", "key: [a, b]", "tags: a, b" and "key:" followed by "- item"
// lines. Anything else is skipped.
func ParseProperties(text string) []Property {
	var out []Property
	for _, line := range strings.Split(text, "\n") {
		if m := propItemRe.FindStringSubmatch(line); m != nil && len(out) > 0 {
			if v := unquoteProp(m[1]); v != "" {
				out[len(out)-1].Values = append(out[len(out)-1].Values, v)
			}
			continue
		}
		m := propLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		raw := strings.TrimSpace(propCommentRe.ReplaceAllString(m[2], ""))
		var parts []string
		switch {
		case strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]"):
			parts = strings.Split(raw[1:len(raw)-1], ",")
		case listKeys[strings.ToLower(m[1])]:
			parts = strings.Split(raw, ",")
		default:
			parts = []string{raw}
		}
		prop := Property{Key: m[1]}
		for _, part := range parts {
			if v := unquoteProp(part); v != "" {
				prop.Values = append(prop.Values, v)
			}
		}
		out = append(out, prop)
	}
	return out
}

// Frontmatter returns the text of a doc's properties block, or "".
func Frontmatter(content map[string]any) string {
	first, ok := asMap(firstOf(asSlice(content["content"])))
	if !ok || first["type"] != "frontmatter" {
		return ""
	}
	return textContent(asSlice(first["content"]))
}

// DescribeProperties writes properties as one readable line,
// "tags: travel, 2026; status: draft", for search and embeddings.
func DescribeProperties(props []Property) string {
	parts := make([]string, 0, len(props))
	for _, p := range props {
		if len(p.Values) == 0 {
			continue
		}
		parts = append(parts, p.Key+": "+strings.Join(p.Values, ", "))
	}
	return strings.Join(parts, "; ")
}
