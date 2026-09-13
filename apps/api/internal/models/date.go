package models

import "strings"

// NormalizeDate returns YYYY-MM-DD when Postgres DATE values scan into
// RFC3339 timestamps such as 2026-09-12T00:00:00Z.
func NormalizeDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) >= 10 && raw[4] == '-' && raw[7] == '-' {
		return raw[:10]
	}
	return raw
}

func normalizeDatePtr(v *string) {
	if v == nil || *v == "" {
		return
	}
	*v = NormalizeDate(*v)
}
