package search

import (
	"regexp"
	"strings"

	"gorm.io/gorm"
)

// propertyFilter is a "key:value" term in a search query. It keeps docs whose
// properties (frontmatter) have that key with a value containing the text,
// e.g. status:draft, tags:travel or owner:"Sam Lee".
type propertyFilter struct {
	Key   string
	Value string
}

var propertyTermRe = regexp.MustCompile(`(^|\s)([A-Za-z][A-Za-z0-9_-]*):(?:"([^"]+)"|([^\s"/][^\s]*))`)

// splitQuery pulls property filters out of a query and returns the words left.
func splitQuery(query string) (string, []propertyFilter) {
	var filters []propertyFilter
	rest := propertyTermRe.ReplaceAllStringFunc(query, func(term string) string {
		m := propertyTermRe.FindStringSubmatch(term)
		value := m[3]
		if value == "" {
			value = m[4]
		}
		filters = append(filters, propertyFilter{Key: m[2], Value: value})
		return m[1]
	})
	return strings.Join(strings.Fields(rest), " "), filters
}

// frontmatterText is the properties block's text: the first node of a doc
// when it is a frontmatter node.
const frontmatterText = "(CASE WHEN content->'content'->0->>'type' = 'frontmatter' THEN content->'content'->0->'content'->0->>'text' END)"

// pattern matches the key's line ("key: a, b", "key: [a, b]") or the "- item"
// lines under it, case-insensitively, with the value anywhere in a value.
func (f propertyFilter) pattern() string {
	key := regexp.QuoteMeta(f.Key)
	value := regexp.QuoteMeta(f.Value)
	return "(^|\n)" + key + "[ \t]*:([^\n]*" + value + "|([ \t]*\n[ \t]*-[^\n]*)*\n[ \t]*-[^\n]*" + value + ")"
}

func withProperties(filters []propertyFilter) func(*gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		for _, f := range filters {
			db = db.Where(frontmatterText+" ~* ?", f.pattern())
		}
		return db
	}
}
