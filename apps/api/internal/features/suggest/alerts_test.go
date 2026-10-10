package suggest

import (
	"testing"
	"time"

	"timely-api/internal/features/notify"
)

// The same task never makes two candidates in one run: a task due tomorrow
// that is also idle or just unblocked keeps only its first (due) candidate.
func TestCandidateListDropsCoveredWork(t *testing.T) {
	one := func(kind, id string) alertCandidate {
		return alertCandidate{key: kind + ":" + id, kind: kind, items: []notify.AlertItem{{ID: id, Name: id}}}
	}
	l := candidateList{skip: map[string]bool{"skipped": true}, covered: map[string]bool{}}
	if !l.add(one("due", "a")) {
		t.Fatal("first candidate dropped")
	}
	if l.add(one("unblocked", "a")) || l.add(one("stale", "a")) {
		t.Fatal("second candidate for the same task kept")
	}
	if l.add(one("stale", "skipped")) || l.add(alertCandidate{kind: "stale"}) {
		t.Fatal("skipped or empty candidate kept")
	}
	// A project whose open work is partly covered still has something new.
	project := alertCandidate{key: "project:p", kind: "project", items: []notify.AlertItem{{ID: "a"}, {ID: "b"}}}
	if !l.add(project) || l.add(one("stale", "b")) {
		t.Fatal("project candidate")
	}
	if len(l.out) != 2 || l.out[0].key != "due:a" || l.out[1].key != "project:p" {
		t.Fatalf("%+v", l.out)
	}
}

func TestDueByLeavesNearDeadlinesOutOfStale(t *testing.T) {
	day := time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)
	last := day.AddDate(0, 0, dueSoonDays)
	str := func(s string) *string { return &s }
	for _, tc := range []struct {
		deadline *string
		want     bool
	}{
		{nil, false},
		{str(""), false},
		{str("2026-10-01"), true},
		{str("2026-10-13"), true},
		{str("2026-10-13T00:00:00Z"), true},
		{str("2026-10-14"), false},
	} {
		if got := dueBy(tc.deadline, last, time.UTC); got != tc.want {
			t.Errorf("%v: got %v", tc.deadline, got)
		}
	}
}

func TestAgoWordsCountsCalendarDays(t *testing.T) {
	now := time.Date(2026, 10, 10, 0, 30, 0, 0, time.UTC)
	if got := agoWords(now, now.Add(-time.Hour)); got != "yesterday" {
		t.Fatalf("an hour before just after midnight: %q", got)
	}
	if got := agoWords(now, time.Date(2026, 10, 8, 23, 0, 0, 0, time.UTC)); got != "2 days ago" {
		t.Fatalf("%q", got)
	}
	if got := agoWords(now, now.Add(-10*time.Minute)); got != "today" {
		t.Fatalf("%q", got)
	}
}

func TestStepsForKind(t *testing.T) {
	names := func(kind string) map[string]bool {
		out := map[string]bool{}
		for _, o := range stepsFor(kind) {
			out[o.Name] = true
		}
		return out
	}
	if inbox := names("inbox"); len(inbox) != 2 || !inbox[notify.AlertClarify] || !inbox[notify.AlertReview] {
		t.Fatalf("inbox %v", inbox)
	}
	if stale := names("stale"); len(stale) != 4 {
		t.Fatalf("stale %v", stale)
	}
}
