package suggest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

func TestNamedIn(t *testing.T) {
	projects := []namedProject{
		{ID: "t", Title: "Timely"},
		{ID: "tw", Title: "Timely website"},
		{ID: "h", Title: "Hobby"},
		{ID: "h2", Title: "hobby"},
	}
	for _, tc := range []struct {
		title, want string
	}{
		{"Do an audit on Timely", "t"},
		{"Fix the timely website footer", "tw"}, // the longer name wins
		{"Timelyish thoughts", ""},              // whole words only
		{"Sort out hobby gear", ""},             // two projects, same name
		{"Buy milk", ""},
	} {
		got, ok := namedIn(tc.title, projects)
		if (tc.want == "") == ok || (ok && got.ID != tc.want) {
			t.Errorf("%q: got %q %v, want %q", tc.title, got.ID, ok, tc.want)
		}
	}
}

func TestRequirements(t *testing.T) {
	item := func(text string) map[string]any {
		return map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}}}
	}
	rich := models.JSONMap{"type": "doc", "content": []any{map[string]any{"type": "bulletList", "content": []any{item("Pick tiles"), item("Old item")}}}}
	// The plain text was edited since: the dropped editor item no longer counts.
	got := requirements(models.Project{Description: "Pick tiles\nNew sink", DescriptionRich: rich})
	if len(got) != 1 || got[0] != "Pick tiles" {
		t.Fatalf("rich: %v", got)
	}
	got = requirements(models.Project{Description: "Goals:\n- Pick tiles\n2. Replace  the sink\n[ ] Paint\nnot a list"})
	if strings.Join(got, "|") != "Pick tiles|Replace the sink|Paint" {
		t.Fatalf("plain: %v", got)
	}
}

func TestParseWhen(t *testing.T) {
	for _, v := range []string{"2026-10-09T12:00:00Z", "2026-10-09 12:00:00.123456+00", "2026-10-09"} {
		if parseWhen(v).IsZero() {
			t.Errorf("%q did not parse", v)
		}
	}
	if !parseWhen("").IsZero() {
		t.Error("empty parsed")
	}
}

func TestSimilarNames(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"Bug", "bugs", true}, {"Urgent", "Urgnet", true}, {"Website", "Web site redesign", false}, {"Home", "Work", false}, {"Client calls", "Calls", true}} {
		if similarNames(c.a, c.b) != c.want {
			t.Errorf("%q %q: want %v", c.a, c.b, c.want)
		}
	}
}

func TestKeepSideNeverDropsTheCompletionStatus(t *testing.T) {
	done := CleanupItem{ID: "st_done", Name: "Done", Uses: 1, completes: true}
	finished := CleanupItem{ID: "st_fin", Name: "Finished", Uses: 9}
	if into, from, ok := keepSide(finished, done); !ok || into.ID != "st_done" || from.ID != "st_fin" {
		t.Fatalf("into %s from %s ok %v, want Done kept", into.ID, from.ID, ok)
	}
	todo := CleanupItem{ID: "st_todo", Name: "To do", Uses: 0, isDefault: true}
	open := CleanupItem{ID: "st_open", Name: "Todo", Uses: 5}
	if into, _, ok := keepSide(open, todo); !ok || into.ID != "st_todo" {
		t.Fatalf("into %s ok %v, want the default kept", into.ID, ok)
	}
	if _, _, ok := keepSide(done, todo); ok {
		t.Fatal("a completion status and the default status should not merge")
	}
	if into, _, _ := keepSide(CleanupItem{ID: "a", Uses: 1}, CleanupItem{ID: "b", Uses: 3}); into.ID != "b" {
		t.Fatalf("into %s, want the more used side", into.ID)
	}
}

// fakeDecide answers every effort question in a request except effort3, and
// counts the calls.
func fakeDecide(t *testing.T, calls *atomic.Int32) *decide.Service {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req struct {
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		out := map[string]any{}
		for id := range req.Questions {
			if id != "effort3" {
				out[id] = map[string]any{"type": "score", "score": 2.0, "confidence": 0.9}
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"answers": out})
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	keys := func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-test-key"}, nil
	}
	return decide.New(nil, keys, client)
}

func TestEstimateManyAsksInBatches(t *testing.T) {
	var calls atomic.Int32
	s := New(nil, fakeDecide(t, &calls), nil)
	names := make([]string, 12)
	for i := range names {
		names[i] = fmt.Sprintf("Task %d", i+1)
	}
	got := s.EstimateMany(context.Background(), "u1", names, nil)
	if calls.Load() != 2 {
		t.Fatalf("12 items took %d calls, want 2", calls.Load())
	}
	for i, m := range got {
		// effort3 goes unanswered: item 3 (the second batch has only two).
		if want := i != 2; (m > 0) != want {
			t.Errorf("item %d: %d minutes", i+1, m)
		}
	}
}

func TestShortlistLabelsPrefersSharedWordsThenUse(t *testing.T) {
	var labels []models.Lable
	for i := range 40 {
		labels = append(labels, models.Lable{ID: fmt.Sprintf("l%02d", i), Name: fmt.Sprintf("Label %02d", i)})
	}
	labels = append(labels, models.Lable{ID: "inv", Name: "Invoices"}, models.Lable{ID: "tax", Name: "Tax"})
	uses := map[string]int{"l39": 9, "l38": 5}
	got := shortlistLabels(labels, "Send the invoice to the client", uses)
	if len(got) != maxLabels {
		t.Fatalf("got %d labels", len(got))
	}
	ids := map[string]bool{}
	for _, l := range got {
		ids[l.ID] = true
	}
	if !ids["inv"] || !ids["l39"] || !ids["l38"] || ids["tax"] {
		t.Fatalf("shortlist %v", ids)
	}
}
