package search

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"timely-api/internal/features/embed"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func integrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schema := "search_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); db.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.Project{}, &models.Task{}, &models.Document{}, &models.Sheet{}, &models.Event{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// fakeIndexer returns canned vector hits so the fusion path runs without a
// provider. Only the methods SemanticSearch touches do anything.
type fakeIndexer struct {
	embed.Indexer
	enabled bool
	hits    []embed.Hit
	queried string
}

func (f *fakeIndexer) EnabledFor(string) bool { return f.enabled }
func (f *fakeIndexer) Count(context.Context, string) (int64, error) {
	return int64(len(f.hits)) + 1, nil
}
func (f *fakeIndexer) Query(_ context.Context, _ string, q string, _ int, _ []string) ([]embed.Hit, error) {
	f.queried = q
	return f.hits, nil
}

func seed(t *testing.T, db *gorm.DB, userID string) (ws string) {
	t.Helper()
	ws = uuid.NewString()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Create(&models.User{ID: userID, Email: userID + "@test.local"}).Error)
	must(db.Create(&models.Workspace{ID: ws, Name: "W", UserID: &userID}).Error)
	must(db.Exec(`INSERT INTO tasks (id, name, description, user_id, workspace_id, updated_at) VALUES
		(?, 'Pay rent', 'monthly', ?, ?, '2026-01-01'),
		(?, 'Pay rent reminder', 'set up autopay', ?, ?, '2026-02-01'),
		(?, 'Groceries', 'milk and pay rent money back to Sam', ?, ?, '2026-03-01'),
		(?, 'Unrelated 100% done', 'nothing', ?, ?, '2026-03-02')`,
		"t-exact", userID, ws, "t-prefix", userID, ws, "t-body", userID, ws, "t-pct", userID, ws).Error)
	must(db.Exec(`INSERT INTO projects (id, title, description, workspace_id, updated_at) VALUES
		(?, 'Apartment: rent and bills', '', ?, '2026-01-01')`, "p-title", ws).Error)
	must(db.Exec(`INSERT INTO documents (id, title, plain_text, user_id, workspace_id, updated_at) VALUES
		(?, 'Lease', 'the rent is due on the first', ?, ?, '2026-01-01')`, "d-body", userID, ws).Error)
	must(db.Exec(`INSERT INTO sheets (id, title, user_id, workspace_id, updated_at) VALUES
		(?, 'Rent tracker', ?, ?, '2026-01-01')`, "s-prefix", userID, ws).Error)
	must(db.Exec(`INSERT INTO events (id, title, description, user_id, workspace_id, start_at, end_at, updated_at) VALUES
		(?, 'Landlord call', 'discuss rent increase', ?, ?, now(), now(), '2026-01-01')`, "e-body", userID, ws).Error)
	return ws
}

func TestIntegrationKeywordRanksByTier(t *testing.T) {
	db := integrationDB(t)
	user := uuid.NewString()
	seed(t, db, user)
	svc := NewService(db, &fakeIndexer{enabled: false})

	hits, err := svc.Search(user, "pay rent", 20)
	if err != nil {
		t.Fatal(err)
	}
	got := ids(hits)
	// exact title, then title prefix, then body substring (t-body).
	if len(got) < 3 || got[0] != "t-exact" || got[1] != "t-prefix" || got[2] != "t-body" {
		t.Fatalf("unexpected keyword order: %v", got)
	}
	for _, h := range hits {
		if h.ID == "t-pct" || h.ID == "d-body" {
			t.Fatalf("%s should not match %q: %v", h.ID, "pay rent", got)
		}
	}

	// "rent" is a title prefix for the sheet and a substring elsewhere;
	// prefix hits come before plain title hits, which come before body hits.
	hits, err = svc.Search(user, "rent", 20)
	if err != nil {
		t.Fatal(err)
	}
	tierOf := map[string]int{}
	for i, h := range hits {
		tierOf[h.ID] = i
	}
	if tierOf["s-prefix"] > tierOf["p-title"] || tierOf["p-title"] > tierOf["d-body"] || tierOf["p-title"] > tierOf["e-body"] {
		t.Fatalf("tiers out of order: %v", ids(hits))
	}
	if _, ok := tierOf["t-exact"]; !ok {
		t.Fatalf("title substring 'Pay rent' missing: %v", ids(hits))
	}
}

func TestIntegrationKeywordEscapesLikeWildcards(t *testing.T) {
	db := integrationDB(t)
	user := uuid.NewString()
	seed(t, db, user)
	svc := NewService(db, nil)

	hits, err := svc.Search(user, "100%", 20)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(hits); !equal(got, []string{"t-pct"}) {
		t.Fatalf("expected only the literal 100%% task, got %v", got)
	}
	hits, _ = svc.Search(user, "100_", 20)
	if len(hits) != 0 {
		t.Fatalf("underscore should be literal, got %v", ids(hits))
	}
}

func TestIntegrationHybridFallsBackWhenDisabled(t *testing.T) {
	db := integrationDB(t)
	user := uuid.NewString()
	seed(t, db, user)
	svc := NewService(db, &fakeIndexer{enabled: false})

	hits, err := svc.SemanticSearch(context.Background(), user, "pay rent", 20, nil)
	if err != nil {
		t.Fatalf("hybrid must not fail without a provider: %v", err)
	}
	if got := ids(hits); len(got) == 0 || got[0] != "t-exact" {
		t.Fatalf("expected keyword-only fallback led by the exact title, got %v", got)
	}

	hits, err = svc.SemanticSearch(context.Background(), user, "rent", 20, []string{"sheet", "bogus"})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(hits); !equal(got, []string{"s-prefix"}) {
		t.Fatalf("kinds filter should keep only the sheet, got %v", got)
	}
}

func TestIntegrationHybridFusesVectorAndKeyword(t *testing.T) {
	db := integrationDB(t)
	user := uuid.NewString()
	seed(t, db, user)
	idx := &fakeIndexer{enabled: true, hits: []embed.Hit{
		{Kind: "doc", EntityID: "d-body", Title: "Lease", Content: "the rent is due on the first", Score: 0.91},
		{Kind: "task", EntityID: "t-body", Title: "Groceries", Content: "pay rent money back", Score: 0.85},
		{Kind: "event", EntityID: "e-body", Title: "Landlord call", Content: "discuss rent increase", Score: 0.80},
	}}
	svc := NewService(db, idx)

	hits, err := svc.SemanticSearch(context.Background(), user, "pay rent", 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if idx.queried != "pay rent" {
		t.Fatalf("vector query not issued: %q", idx.queried)
	}
	got := ids(hits)
	if got[0] != "t-exact" {
		t.Fatalf("exact title must stay on top of hybrid results, got %v", got)
	}
	pos := map[string]int{}
	for i, id := range got {
		pos[id] = i
	}
	// t-body is in both lists; it must beat d-body, which only the vector list has.
	if pos["t-body"] > pos["d-body"] {
		t.Fatalf("item in both lists should outrank a vector-only item: %v", got)
	}
	if _, ok := pos["d-body"]; !ok {
		t.Fatalf("vector-only hit dropped: %v", got)
	}
	for _, h := range hits {
		if h.ID == "d-body" && h.Content == "" {
			t.Fatalf("semantic content lost on fused hit: %+v", h)
		}
		if h.Score <= 0 {
			t.Fatalf("fused hits need a score: %+v", h)
		}
	}
}

func TestIntegrationExistingDropsGoneItems(t *testing.T) {
	db := integrationDB(t)
	user, other := uuid.NewString(), uuid.NewString()
	seed(t, db, user)
	svc := NewService(db, nil)
	got := svc.Existing(user, []embed.Hit{
		{Kind: "task", EntityID: "t-exact"},
		{Kind: "doc", EntityID: "d-deleted"}, // its embeddings outlived it
		{Kind: "project", EntityID: "p-title"},
		{Kind: "sheet", EntityID: "s-prefix"},
		{Kind: "event", EntityID: "e-body"},
		{Kind: "task", EntityID: "t-gone"},
	})
	want := []string{"t-exact", "p-title", "s-prefix", "e-body"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i, hit := range got {
		if hit.EntityID != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	// Another account's items are never "existing" for this one.
	if got := svc.Existing(other, []embed.Hit{{Kind: "task", EntityID: "t-exact"}, {Kind: "project", EntityID: "p-title"}}); len(got) != 0 {
		t.Fatalf("other account's items must be dropped: %v", got)
	}
}

func TestIntegrationRelatableDropsInboxAndOwnTasks(t *testing.T) {
	db := integrationDB(t)
	user := uuid.NewString()
	seed(t, db, user)
	if err := db.Exec(`INSERT INTO tasks (id, name, user_id, workspace_id, kind, updated_at) VALUES (?, 'Call the bank', ?, NULL, ?, now())`,
		"t-inbox", user, models.KindInbox).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE tasks SET project_id = ? WHERE id = ?`, "p-title", "t-prefix").Error; err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil)
	hits := []embed.Hit{
		{Kind: "task", EntityID: "t-exact"},
		{Kind: "task", EntityID: "t-inbox"},
		{Kind: "task", EntityID: "t-prefix"},
		{Kind: "doc", EntityID: "d-body"},
	}
	ids := func(hits []embed.Hit) string {
		out := []string{}
		for _, h := range hits {
			out = append(out, h.EntityID)
		}
		return strings.Join(out, ",")
	}
	if got := ids(svc.Relatable(user, "project", "p-title", hits)); got != "t-exact,d-body" {
		t.Fatalf("project related = %s, want no inbox item and none of its own tasks", got)
	}
	if got := ids(svc.Relatable(user, "doc", "d-other", hits)); got != "t-exact,t-prefix,d-body" {
		t.Fatalf("doc related = %s, want no inbox item", got)
	}
}

// ViewsFromDB reads the phone's saved views for client=phone, the web's
// otherwise, and names their projects in the descriptions.
func TestIntegrationViewsFromDBFollowsTheClient(t *testing.T) {
	db := integrationDB(t)
	if err := db.AutoMigrate(&models.Config{}, &models.Status{}, &models.Lable{}); err != nil {
		t.Fatal(err)
	}
	userID := "u-" + uuid.NewString()
	seed(t, db, userID)
	web := models.TaskViewConfig{ID: "view_rent", Name: "Rent", SelectedProjectIds: []string{"p-title"}}
	phone := models.TaskViewConfig{ID: "native_view_late", Name: "Late", OnlyOverdue: true}
	if err := db.Create(&models.Config{ID: "cfg-" + userID, UserID: userID, TaskViews: models.TaskViews{web}, MobileTaskViews: models.TaskViews{phone}}).Error; err != nil {
		t.Fatal(err)
	}
	views := ViewsFromDB(db)
	got := views(context.Background(), userID, ClientPhone)
	if len(got) != 1 || got[0].ID != "native_view_late" || got[0].Description != "lists work items; only overdue ones" {
		t.Fatalf("phone = %+v", got)
	}
	for _, client := range []string{ClientWeb, ""} {
		got = views(context.Background(), userID, client)
		if len(got) != 1 || got[0].ID != "view_rent" || got[0].Description != "lists work items; in Apartment: rent and bills" {
			t.Fatalf("%q = %+v", client, got)
		}
	}
}
