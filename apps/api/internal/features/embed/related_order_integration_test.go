package embed

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// embedTestDB is an empty schema with the embeddings table, dropped after
// the test. It needs CHAT_TEST_ENV (make test-chat-integration).
func embedTestDB(t *testing.T) *gorm.DB {
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
	schema := "embed_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = db.AutoMigrate(&models.Embedding{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// After an edit rewrites a doc's first chunk, its row is stored last, and
// Related used to read whichever chunk the table returned first as the
// doc's opening text ("f the greenhouse manual explains…").
func TestIntegrationRelatedReadsTheFirstChunk(t *testing.T) {
	db := embedTestDB(t)
	vec := func(x float32) models.Vector {
		v := make(models.Vector, 3)
		v[0], v[1] = 1, x
		return v
	}
	rows := []models.Embedding{
		{ID: "e1", UserID: "u1", EntityKind: KindDoc, EntityID: "d1", ChunkIndex: 1, Title: "Greenhouse manual", Content: "f the greenhouse manual explains the vents", Embedding: vec(0.1), ContentHash: "h1", Model: defaultModel},
		{ID: "e2", UserID: "u1", EntityKind: KindDoc, EntityID: "d2", ChunkIndex: 0, Title: "Seed list", Content: "Seed list", Embedding: vec(0.2), ContentHash: "h2", Model: defaultModel},
		{ID: "e0", UserID: "u1", EntityKind: KindDoc, EntityID: "d1", ChunkIndex: 0, Title: "Greenhouse manual", Content: "Greenhouse manual. This part of the greenhouse manual", Embedding: vec(0.1), ContentHash: "h0", Model: defaultModel},
	}
	for _, row := range rows {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	i := New(db).(*indexer)
	i.resolve = func(string) (string, string) { return "sk-or-test", defaultModel }
	src, hits, err := i.Related(context.Background(), "u1", KindDoc, "d1", 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(src.Content, "Greenhouse manual.") {
		t.Fatalf("Related read %q as the doc's text; want its first chunk", src.Content)
	}
	if len(hits) != 1 || hits[0].EntityID != "d2" {
		t.Fatalf("hits = %+v", hits)
	}
}
