package suggest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// A project, stage or value named like the question's own sentinel is
// renamed, so the option list never holds the same name twice and the
// sentinel keeps its meaning.
func TestNotSentinel(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"none", "none (project)"},
		{"Unknown", "Unknown (project)"},
		{"Nonesuch", "Nonesuch"},
		{"Garden", "Garden"},
	} {
		if got := notSentinel(tc.in, "project", "none", "unknown"); got != tc.want {
			t.Errorf("notSentinel(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// Ten steps full of "&" used to outgrow the state, so no estimate was asked
// and every step fell back to 30 minutes; they are now cut and asked.
func TestEstimateManyFitsOversizedItems(t *testing.T) {
	var calls atomic.Int32
	s := New(nil, fakeDecide(t, &calls), nil)
	names := make([]string, 10)
	descriptions := make([]string, 10)
	for i := range names {
		names[i] = "Pasted note task " + strings.Repeat("&", 180)
		descriptions[i] = strings.Repeat("&", 400)
	}
	got := s.EstimateMany(context.Background(), "u1", names, descriptions)
	if calls.Load() != 1 {
		t.Fatalf("made %d calls, want 1", calls.Load())
	}
	if got[0] == 0 || got[9] == 0 {
		t.Fatalf("estimates %v", got)
	}
}

// A traits call that fails at once is reported, so the Preview hook pauses
// instead of asking again (two calls with the fallback) on every Preview;
// before, only a call that ran out of time paused it.
func TestFillTopTraitsReportsAFastFailure(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "upstream broke", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	d := decide.New(nil, func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-test-key"}, nil
	}, client)
	s := New(nil, d, nil)
	s.schedule = &fixedSchedule{db: func() []models.Task {
		return []models.Task{{ID: "tsk_1", Name: "Write the grant report", Kind: models.KindTask}}
	}}
	if err := s.fillTopTraits(context.Background(), "u1", ""); err == nil || calls.Load() == 0 {
		t.Fatalf("err %v after %d calls", err, calls.Load())
	}
}

// A blocker theme Jev made up is not an answer: the task is left out of the
// groups instead of making a nameless one.
func TestReasonsDropUnknownThemes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"answers": map[string]any{
			"b1": map[string]any{"type": "choice", "choice": "money", "confidence": 0.9},
			"b2": map[string]any{"type": "choice", "choice": "person", "confidence": 0.9},
		}})
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	d := decide.New(nil, func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-test-key"}, nil
	}, client)
	blocked := []workNote{{ID: "t1", Name: "Order the new office chairs"}, {ID: "t2", Name: "Write the grant report"}}
	asked, askedMissed, state, questions := reasonsRequest(blocked, nil)
	a, err := d.Ask(context.Background(), "u1", decide.Request{Feature: "dashboard_reasons", State: state, Questions: questions})
	if err != nil {
		t.Fatal(err)
	}
	groups := groupBy(asked, "b", a, blockerLabels)
	if len(groups) != 1 || groups[0].Label != "Waiting on someone" || groups[0].Count != 1 || groups[0].Tasks[0].ID != "t2" {
		t.Fatalf("groups %+v", groups)
	}
	if m := groupBy(askedMissed, "m", a, missedLabels); len(m) != 0 {
		t.Fatalf("missed %+v", m)
	}
}

// A free gap that starts now moves to the next five-minute mark as the clock
// runs, so Today's state names it "now" with its length to the quarter hour:
// reloads a few minutes apart send the same state and reuse the answer.
func TestGapStateHoldsWhileTheGapMoves(t *testing.T) {
	loc := time.UTC
	end := time.Date(2026, 11, 2, 15, 0, 0, 0, loc)
	at := func(now time.Time) map[string]any {
		start := now.Truncate(5 * time.Minute).Add(5 * time.Minute)
		return gapState(&FreeGap{Start: start, End: end, Minutes: int(end.Sub(start).Minutes())}, now, loc)
	}
	first := at(time.Date(2026, 11, 2, 13, 2, 0, 0, loc))
	if first["starts"] != "now" || first["minutes"] != 105 || first["partOfDay"] != "afternoon" {
		t.Fatalf("gap state %v", first)
	}
	for _, m := range []int{7, 12} {
		if got := at(time.Date(2026, 11, 2, 13, m, 0, 0, loc)); got["starts"] != first["starts"] || got["minutes"] != first["minutes"] {
			t.Fatalf("13:%02d reads %v, 13:02 read %v", m, got, first)
		}
	}
	later := gapState(&FreeGap{Start: end, End: end.Add(25 * time.Minute), Minutes: 25}, time.Date(2026, 11, 2, 13, 2, 0, 0, loc), loc)
	if later["starts"] != "15:00" || later["minutes"] != minGapMinutes {
		t.Fatalf("a later gap keeps its time and never reads shorter than a gap can be: %v", later)
	}
}
