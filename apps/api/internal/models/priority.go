package models

import "strings"

// Canonical task and project priorities. Critical is accepted as an alias of
// Urgent so older clients and seed data round-trip to one value.
const (
	PriorityLow    = "Low"
	PriorityMedium = "Medium"
	PriorityHigh   = "High"
	PriorityUrgent = "Urgent"
)

var canonicalPriorities = []string{PriorityLow, PriorityMedium, PriorityHigh, PriorityUrgent}

// NormalizePriority returns the Title Case canonical value. Empty input stays
// empty. Unknown values are returned trimmed, unchanged, so a bad payload can
// still be rejected by ValidatePriority.
func NormalizePriority(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return ""
	case "low":
		return PriorityLow
	case "medium":
		return PriorityMedium
	case "high":
		return PriorityHigh
	case "urgent", "critical":
		return PriorityUrgent
	default:
		return strings.TrimSpace(value)
	}
}

func ValidatePriority(value string) bool {
	switch NormalizePriority(value) {
	case "", PriorityLow, PriorityMedium, PriorityHigh, PriorityUrgent:
		return true
	default:
		return false
	}
}

func CanonicalPriorities() []string {
	out := make([]string, len(canonicalPriorities))
	copy(out, canonicalPriorities)
	return out
}

// PriorityRank is lower for more urgent work. Unknown values sort as medium
// so they are not buried or treated as more important than Urgent.
func PriorityRank(value string) int {
	switch NormalizePriority(value) {
	case PriorityUrgent:
		return 0
	case PriorityHigh:
		return 1
	case PriorityMedium:
		return 2
	case PriorityLow:
		return 3
	default:
		return 2
	}
}
