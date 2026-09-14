package utils

import "strings"

// EntityColors is the shared palette for workspaces, projects, and stages.
var EntityColors = []string{
	"#30A66D",
	"#6E56CF",
	"#FFB224",
	"#0090FF",
	"#E93D82",
	"#00A2C7",
	"#F76808",
	"#AB4ABA",
	"#3E63DD",
	"#12A594",
	"#99D52A",
	"#E5484D",
}

func ColorForIndex(index int) string {
	if len(EntityColors) == 0 {
		return "#889096"
	}
	if index < 0 {
		index = -index
	}
	return EntityColors[index%len(EntityColors)]
}

func NormalizeHexColor(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	if trimmed[0] != '#' {
		trimmed = "#" + trimmed
	}
	if len(trimmed) != 7 {
		return fallback
	}
	for _, ch := range trimmed[1:] {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') && (ch < 'A' || ch > 'F') {
			return fallback
		}
	}
	return strings.ToUpper(trimmed)
}
