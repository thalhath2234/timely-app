package search

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/embed"
)

// fixedHits is a search Service that always returns the same hits.
type fixedHits struct {
	Service
	hits []Hit
}

func (f fixedHits) SemanticSearch(context.Context, string, string, int, []string) ([]Hit, error) {
	return append([]Hit(nil), f.hits...), nil
}

// nearIndexer is an embed.Indexer whose Related returns fixed neighbours.
type nearIndexer struct {
	embed.Indexer
	near []embed.Hit
}

func (n nearIndexer) EnabledFor(string) bool { return true }
func (n nearIndexer) Related(context.Context, string, string, string, int, []string) (embed.Source, []embed.Hit, error) {
	return embed.Source{Title: "Kitchen remodel", Content: "Cabinets, tiles and the budget."}, n.near, nil
}

// fakeJev answers each question id from a table, the way Jev returns them.
func fakeJev(t *testing.T, calls *atomic.Int32, answers map[string]any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.Unmarshal(raw, &req)
		out := map[string]any{}
		for id := range req.Questions {
			key := id
			if len(id) > 3 && id[len(id)-3:] == "__2" {
				key = id[:len(id)-3]
			}
			if a, ok := answers[key]; ok {
				out[id] = a
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": out})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func jevService(t *testing.T, enabled bool, answers map[string]any, calls *atomic.Int32) Decider {
	srv := fakeJev(t, calls, answers)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	keys := decide.Keys{Enabled: enabled, TypeSafe: "ts-test-key-123"}
	return decide.New(nil, func(context.Context, string) (decide.Keys, error) { return keys, nil }, client)
}

func yes(p float64) map[string]any { return map[string]any{"type": "noul", "noul": p} }
func pick(name string) map[string]any {
	return map[string]any{"type": "choice", "choice": name, "confidence": 0.9}
}

func TestSmartSearchReordersHidesAndReadsCommands(t *testing.T) {
	var calls atomic.Int32
	d := jevService(t, true, map[string]any{
		"match1":   yes(0.4),
		"match2":   yes(0.95),
		"match3":   yes(0.03), // a clear miss
		"match4":   yes(0.2),
		"intent":   pick("sheet"),
		"category": pick("sheet"),
	}, &calls)
	hits := []Hit{{Kind: "doc", ID: "a", Title: "Budget notes"}, {Kind: "sheet", ID: "b", Title: "Budget 2026"}, {Kind: "task", ID: "c", Title: "Buy milk"}, {Kind: "doc", ID: "d", Title: "Old"}}
	s := NewSmart(fixedHits{hits: hits}, nil, d)

	got, err := s.Search(context.Background(), "u1", "make a budget sheet", nil)
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, h := range got.Hits {
		order = append(order, h.ID)
	}
	if len(order) != 3 || order[0] != "b" || order[1] != "a" || order[2] != "d" {
		t.Fatalf("order = %v, want [b a d]", order)
	}
	if len(got.Hidden) != 1 || got.Hidden[0].ID != "c" {
		t.Fatalf("hidden = %+v", got.Hidden)
	}
	if got.Category != "sheet" {
		t.Fatalf("category = %q", got.Category)
	}
	if got.Create == nil || got.Create.Kind != "sheet" || got.Create.Title != "Budget" {
		t.Fatalf("create = %+v", got.Create)
	}
}

func TestSmartSearchOffOrUnsureChangesNothing(t *testing.T) {
	var calls atomic.Int32
	hits := []Hit{{Kind: "doc", ID: "a"}, {Kind: "doc", ID: "b"}}
	off := NewSmart(fixedHits{hits: hits}, nil, jevService(t, false, nil, &calls))
	got, err := off.Search(context.Background(), "u1", "budget", nil)
	if err != nil || got.Hits != nil || got.Create != nil || got.Category != "" {
		t.Fatalf("off: %+v, %v", got, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("off sent %d calls to Jev", calls.Load())
	}

	// Unsure: "find" is the only confident intent, the category is "any".
	unsure := NewSmart(fixedHits{hits: hits}, nil, jevService(t, true, map[string]any{
		"intent":   map[string]any{"type": "choice", "choice": "doc", "confidence": 0.5},
		"category": pick("any"),
	}, &calls))
	got, err = unsure.Search(context.Background(), "u1", "budget", nil)
	if err != nil || got.Create != nil || got.Category != "" || len(got.Hidden) != 0 || len(got.Hits) != 2 {
		t.Fatalf("unsure: %+v, %v", got, err)
	}
}

func TestRerankSaysWhenEverythingMisses(t *testing.T) {
	var calls atomic.Int32
	s := NewSmart(nil, nil, jevService(t, true, map[string]any{"match1": yes(0.02), "match2": yes(0.05)}, &calls))
	kept, hidden, ok := s.Rerank(context.Background(), "u1", "dentist", []Hit{{ID: "a"}, {ID: "b"}})
	if !ok || len(kept) != 0 || len(hidden) != 2 {
		t.Fatalf("kept %v hidden %v ok %v", kept, hidden, ok)
	}
}

func TestRelatedKeepsOnlyConfirmedItems(t *testing.T) {
	var calls atomic.Int32
	d := jevService(t, true, map[string]any{"rel1": yes(0.9), "rel2": yes(0.3), "rel3": yes(0.85)}, &calls)
	idx := nearIndexer{near: []embed.Hit{
		{Kind: "sheet", EntityID: "s1", Title: "Remodel budget"},
		{Kind: "doc", EntityID: "d2", Title: "Garden ideas"},
		{Kind: "task", EntityID: "t1", Title: "Order tiles"},
	}}
	got, err := NewSmart(nil, idx, d).Related(context.Background(), "u1", "project", "p1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "s1" || got[1].ID != "t1" {
		t.Fatalf("related = %+v", got)
	}
	if _, err := NewSmart(nil, idx, d).Related(context.Background(), "u1", "event", "e1"); err == nil {
		t.Fatal("events have no Related list")
	}
}

func TestCreateTitle(t *testing.T) {
	cases := map[string]string{
		"make a budget sheet":         "Budget",
		"create new doc for meeting":  "Meeting",
		"new project kitchen remodel": "Kitchen remodel",
		"a sheet for the budget":      "Budget",
		"sheet":                       "",
		"plan trip to Porto":          "Trip to Porto",
		"Creata doc Test":             "Test",
		"crate a sheet for taxes":     "Taxes",
		"white paper":                 "White paper",
		"write doc":                   "",
	}
	for in, want := range cases {
		if got := createTitle(in, "sheet"); got != want {
			t.Errorf("createTitle(%q) = %q, want %q", in, got, want)
		}
	}
}
