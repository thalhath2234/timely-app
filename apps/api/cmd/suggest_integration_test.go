package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/search"
	"timely-api/internal/features/suggest"
	"timely-api/internal/models"
)

// fixedSearch returns the same hits for every query.
type fixedSearch struct {
	search.Service
	hits []search.Hit
}

func (f fixedSearch) SemanticSearch(context.Context, string, string, int, []string) ([]search.Hit, error) {
	return f.hits, nil
}

// fakeClarifyJev answers each question by its id, the way Jev returns them.
func fakeClarifyJev(t *testing.T, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			State     struct{ Thought string }   `json:"state"`
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.Unmarshal(raw, &req)
		// A vague thought like "test": Jev calls it a reminder, and unclear.
		vague := req.State.Thought == "test"
		answers := map[string]any{}
		for id := range req.Questions {
			switch {
			case vague && strings.HasPrefix(id, "kind"):
				answers[id] = map[string]any{"type": "choice", "choice": "reminder", "confidence": 0.9}
			case vague && id == "ready":
				answers[id] = map[string]any{"type": "noul", "noul": 0.1}
			case strings.HasPrefix(id, "kind"):
				answers[id] = map[string]any{"type": "choice", "choice": "work", "confidence": 0.9}
			case id == "effort":
				answers[id] = map[string]any{"type": "score", "score": 2.2, "confidence": 0.7} // about an hour
			case id == "priority":
				answers[id] = map[string]any{"type": "score", "score": 2, "confidence": 0.8} // High
			case strings.HasPrefix(id, "workspace"):
				answers[id] = map[string]any{"type": "choice", "choice": "Home", "confidence": 0.9}
			case strings.HasPrefix(id, "project"):
				answers[id] = map[string]any{"type": "choice", "choice": "Kitchen remodel (Home)", "confidence": 0.85}
			case id == "dateRole":
				answers[id] = map[string]any{"type": "choice", "choice": "deadline", "confidence": 0.9}
			case id == "missing":
				answers[id] = map[string]any{"type": "choice", "choice": "nothing", "confidence": 0.9}
			case id == "several":
				answers[id] = map[string]any{"type": "noul", "noul": 0.05}
			case id == "ready":
				answers[id] = map[string]any{"type": "noul", "noul": 0.9}
			case id == "dup1":
				answers[id] = map[string]any{"type": "noul", "noul": 0.97}
			case id == "dup2":
				answers[id] = map[string]any{"type": "noul", "noul": 0.1}
			case strings.HasPrefix(id, "label"):
				// Yes only for the "Errands" label.
				p := 0.05
				if id == labelID(raw, "Errands") {
					p = 0.95
				}
				answers[id] = map[string]any{"type": "noul", "noul": p}
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": answers, "usage": map[string]int{"input_tokens": 100, "output_tokens": 0}})
	}))
	t.Cleanup(srv.Close)
	return srv
}

// labelID finds which labelN question asks about name.
func labelID(raw []byte, name string) string {
	var req struct {
		Questions map[string]struct {
			Instructions string `json:"instructions"`
		} `json:"questions"`
	}
	_ = json.Unmarshal(raw, &req)
	for id, q := range req.Questions {
		if strings.Contains(q.Instructions, `"`+name+`"`) {
			return id
		}
	}
	return ""
}

func seedClarify(t *testing.T, db *gorm.DB, uid string) (inbox, dup, home, kitchen, errands string) {
	t.Helper()
	work, homeID := uuid.NewString(), uuid.NewString()
	for _, w := range []models.Workspace{{ID: work, Name: "Work", UserID: &uid}, {ID: homeID, Name: "Home", UserID: &uid}} {
		if err := db.Create(&w).Error; err != nil {
			t.Fatal(err)
		}
	}
	kitchen = uuid.NewString()
	for _, p := range []models.Project{{ID: kitchen, Title: "Kitchen remodel", WorkspaceID: &homeID}, {ID: uuid.NewString(), Title: "Q4 launch", WorkspaceID: &work}} {
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	errands = uuid.NewString()
	for _, l := range []models.Lable{{ID: errands, Name: "Errands", WorkspaceID: homeID}, {ID: uuid.NewString(), Name: "Garden", WorkspaceID: homeID}} {
		if err := db.Create(&l).Error; err != nil {
			t.Fatal(err)
		}
	}
	inbox, dup = uuid.NewString(), uuid.NewString()
	other := uuid.NewString()
	for _, task := range []models.Task{
		{ID: inbox, Name: "Buy tiles for the kitchen by Friday", Kind: models.KindInbox, UserID: &uid},
		{ID: dup, Name: "Pick kitchen tiles", Kind: models.KindTask, Duration: 30, UserID: &uid, WorkspaceID: &homeID},
		{ID: other, Name: "Tile the bathroom", Kind: models.KindTask, Duration: 30, UserID: &uid, WorkspaceID: &homeID},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	return inbox, dup, homeID, kitchen, errands
}

func TestIntegrationClarifySuggestions(t *testing.T) {
	db, uid := agentToolsDB(t)
	inbox, dup, home, kitchen, errands := seedClarify(t, db, uid)
	var other models.Task
	db.Where("name = ?", "Tile the bathroom").First(&other)

	var calls atomic.Int32
	jev := fakeClarifyJev(t, &calls)
	client := decide.NewClient(nil)
	client.TypeSafeURL = jev.URL
	keys := decide.Keys{Enabled: true, TypeSafe: "ts-test-key-123"}
	d := decide.New(db, func(context.Context, string) (decide.Keys, error) { return keys, nil }, client)
	hits := fixedSearch{hits: []search.Hit{{Kind: "task", ID: inbox}, {Kind: "task", ID: dup}, {Kind: "task", ID: other.ID}}}
	s := suggest.New(db, d, hits)

	got, err := s.Clarify(context.Background(), uid, inbox)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Available || got.LogID == "" {
		t.Fatalf("suggestions should be available: %+v", got)
	}
	if got.Kind != models.KindTask || got.Duration != 60 || got.Priority != models.PriorityHigh {
		t.Fatalf("kind/duration/priority: %+v", got)
	}
	if got.ProjectID != kitchen || got.WorkspaceID != home {
		t.Fatalf("project %q workspace %q, want %q %q", got.ProjectID, got.WorkspaceID, kitchen, home)
	}
	if got.DateRole != "deadline" || got.SeveralActions || got.NotReady || got.Missing != "" {
		t.Fatalf("hints: %+v", got)
	}
	if len(got.Duplicates) != 1 || got.Duplicates[0].ID != dup {
		t.Fatalf("duplicates: %+v (the item itself must never be its own duplicate)", got.Duplicates)
	}
	if len(got.LabelIDs) != 1 || got.LabelIDs[0] != errands {
		t.Fatalf("labels: %v", got.LabelIDs)
	}
	if calls.Load() != 2 {
		t.Fatalf("want one call for the form and one for labels, got %d", calls.Load())
	}

	// A vague thought keeps the form's kind, even when Jev is sure.
	db.Model(&models.Task{}).Where("id = ?", inbox).Update("name", "test")
	got, err = s.Clarify(context.Background(), uid, inbox)
	if err != nil || !got.Available || got.Kind != "" || !got.NotReady {
		t.Fatalf("a vague thought must not switch the kind: %+v %v", got, err)
	}
	db.Model(&models.Task{}).Where("id = ?", inbox).Update("name", "Buy tiles for the kitchen by Friday")

	// Another account cannot read this item's suggestions.
	if _, err := s.Clarify(context.Background(), "someone-else", inbox); err == nil {
		t.Fatal("another account's Inbox item must not be found")
	}

	// Off: no call and nothing suggested.
	keys = decide.Keys{Enabled: true}
	before := calls.Load()
	got, err = s.Clarify(context.Background(), uid, inbox)
	if err != nil || got.Available || got.Kind != "" || calls.Load() != before {
		t.Fatalf("off must suggest nothing and call nothing: %+v %v", got, err)
	}
	if got.Error != "" {
		t.Fatalf("off is not a failure: %q", got.Error)
	}
	if _, ok := s.Estimate(context.Background(), uid, "Write report", ""); ok {
		t.Fatal("estimate must be unavailable when off")
	}

	// A refused call says why instead of looking like suggestions are off.
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"error":{"message":"No endpoints found for typesafe/jev-latest."}}`))
	}))
	t.Cleanup(broken.Close)
	client.OpenRouterURL = broken.URL
	keys = decide.Keys{Enabled: true, OpenRouter: "or-test-key-123"}
	// A new title, so the earlier answer is not served from the cache.
	db.Model(&models.Task{}).Where("id = ?", inbox).Update("name", "Buy grout for the kitchen")
	got, err = s.Clarify(context.Background(), uid, inbox)
	if err != nil || got.Available || !strings.Contains(got.Error, "No endpoints found") {
		t.Fatalf("a failed call must report its reason: %+v %v", got, err)
	}
}

// TestIntegrationAgentWorkEstimate checks that create_task uses the smart
// estimate when Work has no length, and keeps 30 minutes otherwise.
func TestIntegrationAgentWorkEstimate(t *testing.T) {
	db, uid := agentToolsDB(t)
	defer func(old func(context.Context, string, string, string) (int, bool)) { workEstimate = old }(workEstimate)

	for _, tc := range []struct {
		name     string
		estimate func(context.Context, string, string, string) (int, bool)
		args     map[string]any
		want     float64
	}{
		{"estimate used", func(context.Context, string, string, string) (int, bool) { return 120, true }, map[string]any{}, 120},
		{"unsure keeps 30", func(context.Context, string, string, string) (int, bool) { return 0, false }, map[string]any{}, 30},
		{"off keeps 30", nil, map[string]any{}, 30},
		{"given length wins", func(context.Context, string, string, string) (int, bool) { return 120, true }, map[string]any{"duration": 45}, 45},
	} {
		t.Run(tc.name, func(t *testing.T) {
			workEstimate = tc.estimate
			_ = db.Transaction(func(tx *gorm.DB) error {
				call := agentToolCaller(t, tx, uid)
				ws := call("create_workspace", map[string]any{"name": "Personal"})
				args := map[string]any{"name": "Write the quarterly report", "workspaceId": ws["id"]}
				for k, v := range tc.args {
					args[k] = v
				}
				task := call("create_task", args)["task"].(map[string]any)
				if task["duration"] != tc.want {
					t.Fatalf("duration %v, want %v", task["duration"], tc.want)
				}
				return errRollback
			})
		})
	}
}

var errRollback = errorString("rollback")

type errorString string

func (e errorString) Error() string { return string(e) }
