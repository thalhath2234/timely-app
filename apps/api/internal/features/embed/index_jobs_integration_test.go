package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"timely-api/internal/jobs"
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
	if err = db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.Project{}, &models.Task{}, &models.Document{}, &models.Sheet{}, &models.Event{}, &models.Embedding{}, &models.Job{}); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`CREATE UNIQUE INDEX embeddings_entity_chunk ON embeddings (user_id, entity_kind, entity_id, chunk_index)`,
		`CREATE UNIQUE INDEX idx_jobs_dedupe_active ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running')`,
	} {
		if err = db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	return db
}

// fakeEmbeddings answers OpenRouter's embeddings API and records every text
// it was sent.
type fakeEmbeddings struct {
	mu    sync.Mutex
	texts []string
}

func (f *fakeEmbeddings) RoundTrip(r *http.Request) (*http.Response, error) {
	var req embedRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	f.mu.Lock()
	f.texts = append(f.texts, req.Input...)
	f.mu.Unlock()
	var out embedResponse
	for n := range req.Input {
		vec := make([]float32, vectorDims)
		vec[n%vectorDims] = 1
		out.Data = append(out.Data, struct {
			Embedding []float32 `json:"embedding"`
			Index     int       `json:"index"`
		}{vec, n})
	}
	body, _ := json.Marshal(out)
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(bytes.NewReader(body))}, nil
}

func (f *fakeEmbeddings) sent() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.texts...)
}

const noKeyUser = "user-without-key"

func testIndexer(t *testing.T, db *gorm.DB) (*indexer, *jobs.Queue, *fakeEmbeddings) {
	t.Helper()
	fake := &fakeEmbeddings{}
	ix := New(db).(*indexer)
	ix.http = &http.Client{Transport: fake}
	ix.SetCredentials(func(userID string) (string, string) {
		if userID == noKeyUser {
			return "", ""
		}
		return "test-key", "test-model"
	})
	queue := jobs.NewQueue(db)
	ix.SetQueue(queue)
	return ix, queue, fake
}

// runIndexJob does what the worker does with the next index job.
func runIndexJob(t *testing.T, ix *indexer, queue *jobs.Queue) *models.Job {
	t.Helper()
	job, err := queue.Claim(context.Background(), "test")
	if err != nil || job == nil {
		t.Fatalf("no index job to run: %v", err)
	}
	if err := ix.IndexEntity(context.Background(), job.UserID, job.Payload.String("kind"), job.Payload.String("entityId")); err != nil {
		t.Fatal(err)
	}
	if err := queue.Succeed(job); err != nil {
		t.Fatal(err)
	}
	return job
}

func indexJobs(t *testing.T, db *gorm.DB, entityID string) []models.Job {
	t.Helper()
	var rows []models.Job
	if err := db.Where("kind = ? AND payload->>'entityId' = ?", models.JobIndexEntity, entityID).Order("created_at").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func indexedTitles(t *testing.T, db *gorm.DB, entityID string) []string {
	t.Helper()
	var titles []string
	if err := db.Model(&models.Embedding{}).Where("entity_id = ?", entityID).Pluck("title", &titles).Error; err != nil {
		t.Fatal(err)
	}
	return titles
}

func seedUser(t *testing.T, db *gorm.DB, userID string) {
	t.Helper()
	if err := db.Create(&models.User{ID: userID, Email: userID + "@test.local"}).Error; err != nil {
		t.Fatal(err)
	}
}

func saveTask(t *testing.T, db *gorm.DB, task *models.Task) {
	t.Helper()
	if err := db.Exec(`INSERT INTO tasks (id, name, description, user_id, updated_at) VALUES (?, ?, ?, ?, now())
		ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
		task.ID, task.Name, task.Description, *task.UserID).Error; err != nil {
		t.Fatal(err)
	}
}

// E1: an edit made while the item's index job waited, or ran, used to be
// dropped, because the job kept the text it was queued with.
func TestIntegrationIndexJobsIndexTheLatestText(t *testing.T) {
	db := integrationDB(t)
	ix, queue, fake := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)

	task := &models.Task{ID: "tsk-1", UserID: &user, Name: "Draft garden shed plan", Description: "measure the back yard"}
	saveTask(t, db, task)
	ix.IndexTask(task)
	task.Name, task.Description = "Book piano lessons for Leo", "Thursday afternoons"
	saveTask(t, db, task)
	ix.IndexTask(task)

	queued := indexJobs(t, db, task.ID)
	if len(queued) != 1 {
		t.Fatalf("want one waiting job, got %d", len(queued))
	}
	if _, ok := queued[0].Payload["title"]; ok {
		t.Fatalf("job payload carries the title: %v", queued[0].Payload)
	}
	if _, ok := queued[0].Payload["body"]; ok {
		t.Fatalf("job payload carries the text: %v", queued[0].Payload)
	}
	runIndexJob(t, ix, queue)
	if got := indexedTitles(t, db, task.ID); len(got) != 1 || got[0] != "Book piano lessons for Leo" {
		t.Fatalf("indexed %v, want the renamed task", got)
	}
	if sent := fake.sent(); len(sent) != 1 || strings.Contains(sent[0], "garden shed") {
		t.Fatalf("sent %q", sent)
	}

	// An edit while the job runs gets a job of its own.
	task.Name = "Call the insurance broker"
	saveTask(t, db, task)
	ix.IndexTask(task)
	running, err := queue.Claim(context.Background(), "test")
	if err != nil || running == nil {
		t.Fatalf("claim: %v", err)
	}
	task.Name = "Water the tomato plants"
	saveTask(t, db, task)
	ix.IndexTask(task)
	if err := ix.IndexEntity(context.Background(), user, KindTask, task.ID); err != nil {
		t.Fatal(err)
	}
	if err := queue.Succeed(running); err != nil {
		t.Fatal(err)
	}
	var waiting int64
	db.Model(&models.Job{}).Where("kind = ? AND status = ? AND payload->>'entityId' = ?", models.JobIndexEntity, models.JobPending, task.ID).Count(&waiting)
	if waiting != 1 {
		t.Fatalf("an edit during a running job left %d waiting jobs, want 1", waiting)
	}
	runIndexJob(t, ix, queue)
	if got := indexedTitles(t, db, task.ID); len(got) != 1 || got[0] != "Water the tomato plants" {
		t.Fatalf("indexed %v after the running-job edit", got)
	}
}

// E2 and GB9: an item deleted before its index job ran, or whose failed job
// was retried after the delete, used to be sent to the provider and stored.
func TestIntegrationDeletedItemsAreNeverIndexed(t *testing.T) {
	db := integrationDB(t)
	ix, queue, fake := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)

	task := &models.Task{ID: "tsk-typo", UserID: &user, Name: "Typo task please ignore", Description: "locker code 4471"}
	saveTask(t, db, task)
	ix.IndexTask(task)
	db.Exec(`DELETE FROM tasks WHERE id = ?`, task.ID)
	ix.Delete(user, KindTask, task.ID)
	if rows := indexJobs(t, db, task.ID); len(rows) != 1 || rows[0].Status != models.JobCancelled {
		t.Fatalf("deleting the task left its job %+v", rows)
	}

	doc := &models.Document{ID: "doc-ghost", UserID: user, Title: "GHOSTTWO secret", PlainText: "salary list: Erin 140k"}
	if err := db.Create(&models.Workspace{ID: "ws-1", Name: "Home", UserID: &user}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO documents (id, user_id, workspace_id, title, plain_text, updated_at) VALUES (?, ?, 'ws-1', ?, ?, now())`, doc.ID, user, doc.Title, doc.PlainText).Error; err != nil {
		t.Fatal(err)
	}
	ix.IndexDoc(doc)
	failed := indexJobs(t, db, doc.ID)[0]
	db.Model(&models.Job{}).Where("id = ?", failed.ID).Update("status", models.JobFailed)
	db.Exec(`DELETE FROM documents WHERE id = ?`, doc.ID)
	ix.Delete(user, KindDoc, doc.ID)
	if _, err := queue.Retry(user, failed.ID); err != nil {
		t.Fatal(err)
	}
	runIndexJob(t, ix, queue)

	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("deleted items were sent to the provider: %q", sent)
	}
	var rows int64
	db.Model(&models.Embedding{}).Count(&rows)
	if rows != 0 {
		t.Fatalf("%d embedding rows stored for deleted items", rows)
	}

	// Rows left by deleted items before this fix are removed by a reindex.
	if err := db.Create(&models.Embedding{ID: "emb-orphan", UserID: user, EntityKind: KindTask, EntityID: "tsk-gone", Title: "old", Content: "old", Embedding: make(models.Vector, vectorDims), ContentHash: "x", Model: "test-model"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ix.Reindex(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	db.Model(&models.Embedding{}).Where("entity_id = ?", "tsk-gone").Count(&rows)
	if rows != 0 {
		t.Fatal("reindex kept the rows of a deleted task")
	}
}

// GB10: accounts without embeddings queued an index job, with the item's
// whole text, on every edit.
func TestIntegrationNoIndexJobsWithoutEmbeddings(t *testing.T) {
	db := integrationDB(t)
	ix, _, _ := testIndexer(t, db)
	user := noKeyUser
	seedUser(t, db, user)
	task := &models.Task{ID: "tsk-nokey", UserID: &user, Name: "PAYLOADLEAK", Description: strings.Repeat("x", 1000)}
	saveTask(t, db, task)
	ix.IndexTask(task)
	if rows := indexJobs(t, db, task.ID); len(rows) != 0 {
		t.Fatalf("queued %d index jobs for an account without embeddings", len(rows))
	}
}
