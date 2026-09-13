package models

import "testing"

func TestNormalizePriority(t *testing.T) {
	cases := map[string]string{
		"":         "",
		"low":      PriorityLow,
		"LOW":      PriorityLow,
		"Medium":   PriorityMedium,
		"high":     PriorityHigh,
		"urgent":   PriorityUrgent,
		"Critical": PriorityUrgent,
		"critical": PriorityUrgent,
	}
	for in, want := range cases {
		if got := NormalizePriority(in); got != want {
			t.Fatalf("NormalizePriority(%q)=%q want %q", in, got, want)
		}
	}
}

func TestValidatePriority(t *testing.T) {
	if !ValidatePriority("urgent") || !ValidatePriority("") || ValidatePriority("asap") {
		t.Fatal("unexpected validation result")
	}
}

func TestPriorityRank(t *testing.T) {
	if PriorityRank("Urgent") >= PriorityRank("High") {
		t.Fatal("urgent should rank above high")
	}
	if PriorityRank("critical") != PriorityRank("urgent") {
		t.Fatal("critical should rank as urgent")
	}
}
