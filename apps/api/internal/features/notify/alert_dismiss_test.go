package notify

import (
	"testing"
	"time"

	"timely-api/internal/models"
)

// A kind of alert is muted after three dismissals in 14 days, unless the
// person ever took a step on one of that kind.
func TestMutedAlertKinds(t *testing.T) {
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)
	at := func(days int) *time.Time { v := now.AddDate(0, 0, -days); return &v }
	rows := []alertOutcome{
		// stale: three recent dismissals, never acted on.
		{Kind: "stale", DismissedAt: at(1)}, {Kind: "stale", DismissedAt: at(5)}, {Kind: "stale", DismissedAt: at(13)},
		// due: three recent dismissals, but one due alert was acted on.
		{Kind: "due", DismissedAt: at(1)}, {Kind: "due", DismissedAt: at(2)}, {Kind: "due", DismissedAt: at(3)},
		{Kind: "due", DismissedAt: at(4), Acted: true},
		// inbox: one of three dismissals is older than 14 days.
		{Kind: "inbox", DismissedAt: at(1)}, {Kind: "inbox", DismissedAt: at(2)}, {Kind: "inbox", DismissedAt: at(15)},
		// project: two dismissals only.
		{Kind: "project", DismissedAt: at(1)}, {Kind: "project", DismissedAt: at(2)},
	}
	got := mutedAlertKinds(rows, now)
	if len(got) != 1 || !got["stale"] {
		t.Fatalf("muted %v, want only stale", got)
	}
	if len(mutedAlertKinds(nil, now)) != 0 {
		t.Fatal("nothing dismissed, something muted")
	}
}

// Dismissed alerts count as not kept once per decision, never for an alert
// whose step was taken, and not at all with no recorder set.
func TestAlertsDismissedRecordsOncePerDecision(t *testing.T) {
	alert := func(logID, acted string) models.Notification {
		data := models.JobPayload{"kind": "stale"}
		if logID != "" {
			data["logId"] = logID
		}
		if acted != "" {
			data["acted"] = acted
		}
		return models.Notification{Category: models.NotifySuggestion, Data: data}
	}
	rows := []models.Notification{alert("dec_a", ""), alert("dec_a", ""), alert("dec_b", AlertFocus), alert("", ""), alert("dec_c", "")}
	s := &Service{}
	s.alertsDismissed("usr", rows) // no recorder: nothing to do, no panic
	var got []string
	s.SetDismissed(func(userID, logID string) error {
		if userID != "usr" {
			t.Fatalf("user %q", userID)
		}
		got = append(got, logID)
		return nil
	})
	s.alertsDismissed("usr", rows)
	if len(got) != 2 || got[0] != "dec_a" || got[1] != "dec_c" {
		t.Fatalf("recorded %v, want dec_a and dec_c once each", got)
	}
}
