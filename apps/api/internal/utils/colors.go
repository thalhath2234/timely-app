package utils

import "strings"

const UnstagedColor = "#889096"

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
		return UnstagedColor
	}
	if index < 0 {
		index = -index
	}
	return EntityColors[index%len(EntityColors)]
}

// ColorForIndexSkipping walks the palette like ColorForIndex but omits skip
// so a project is not assigned the same hue as its workspace.
func ColorForIndexSkipping(index int, skip string) string {
	if len(EntityColors) == 0 {
		return UnstagedColor
	}
	if index < 0 {
		index = -index
	}
	skip = strings.ToUpper(strings.TrimSpace(skip))
	palette := make([]string, 0, len(EntityColors))
	for _, color := range EntityColors {
		if skip != "" && strings.EqualFold(color, skip) {
			continue
		}
		palette = append(palette, color)
	}
	if len(palette) == 0 {
		return EntityColors[index%len(EntityColors)]
	}
	return palette[index%len(palette)]
}

func HashID(id string) uint32 {
	var hash uint32
	for i := 0; i < len(id); i++ {
		hash = hash*31 + uint32(id[i])
	}
	return hash
}

func StableColorForID(id string) string {
	if strings.TrimSpace(id) == "" {
		return UnstagedColor
	}
	return ColorForIndex(int(HashID(id)))
}

func ResolvedColor(color, fallbackID string, fallbackIndex int) string {
	if normalized := NormalizeHexColor(strings.TrimSpace(color), ""); normalized != "" {
		return normalized
	}
	if strings.TrimSpace(fallbackID) != "" {
		return StableColorForID(fallbackID)
	}
	return ColorForIndex(fallbackIndex)
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
