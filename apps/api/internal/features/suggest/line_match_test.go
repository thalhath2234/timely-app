package suggest

import "testing"

func TestSameWork(t *testing.T) {
	cases := []struct {
		a, b    string
		fromDoc bool
		want    bool
	}{
		// Polished by hand or with Help me write: still the same Work.
		{"Setup live notifications mobile", "Set up live notifications on the mobile app.", false, true},
		{"Setup live notifications mobile", "Set up live notifications on the mobile app.", true, true},
		{"fix login bug", "Investigate and fix the login bug affecting Android users.", false, true},
		{"Add predictive back gesture", "Add the predictive back gesture to the Android app", false, true},
		{"Redesign project settings page", "Redesign the project settings page so it is easier to scan", false, true},
		{"Book the dentst", "Book the dentist", false, true},
		{"Call mom", "Call mom tonight", false, true},
		{"Write release notes for v0.3.4", "Write the release notes for Timely v0.3.4", false, true},
		{"Email Sara about the contract", "Send Sara an email about the contract renewal", true, true},
		// Different Work that shares words.
		{"Call mom", "Call dad", true, false},
		{"Book the dentist", "Book the vet", true, false},
		{"Review PR for login", "Review PR for logout", false, false},
		{"Fix login bug", "Fix the sync bug in the calendar widget", false, false},
		{"Buy milk", "Buy a new laptop", true, false},
		{"Update docs", "Update the onboarding flow, the landing page, the docs and the release notes for v1", false, false},
		{"the", "the", false, false},
	}
	for _, c := range cases {
		if got := sameWork(c.a, c.b, c.fromDoc); got != c.want {
			t.Errorf("sameWork(%q, %q, %v) = %v, want %v", c.a, c.b, c.fromDoc, got, c.want)
		}
		if got := sameWork(c.b, c.a, c.fromDoc); got != c.want {
			t.Errorf("sameWork(%q, %q, %v) = %v, want %v (swapped)", c.b, c.a, c.fromDoc, got, c.want)
		}
	}
}

func TestQuotedItem(t *testing.T) {
	if got := quotedItem("Plan the trip.\n\nFrom Ideas: “Plan the trip to Kyoto”"); got != "Plan the trip to Kyoto" {
		t.Fatalf("got %q", got)
	}
	if got := quotedItem("From Ideas"); got != "" {
		t.Fatalf("got %q", got)
	}
}
