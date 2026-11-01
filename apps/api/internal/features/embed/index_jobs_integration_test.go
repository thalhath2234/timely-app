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
	// during, when set, runs while a request is in flight, before it is
	// answered: what the person does while the provider works.
	during func(texts []string)
	// refuse, when set, answers 400 for texts it returns true for.
	refuse func(texts []string) bool
}

func (f *fakeEmbeddings) RoundTrip(r *http.Request) (*http.Response, error) {
	var req embedRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	f.mu.Lock()
	f.texts = append(f.texts, req.Input...)
	during, refuse := f.during, f.refuse
	f.mu.Unlock()
	if during != nil {
		during(req.Input)
	}
	if refuse != nil && refuse(req.Input) {
		return &http.Response{StatusCode: 400, Status: "400 Bad Request", Header: http.Header{"Content-Type": {"application/json"}},
			Body: io.NopCloser(strings.NewReader(`{"error":{"message":"input rejected"}}`))}, nil
	}
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
	job, err := queue.Claim(context.Background(), "test", jobs.Lane{})
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
	running, err := queue.Claim(context.Background(), "test", jobs.Lane{})
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

// E6 follow-up: item index jobs now run beside a reindex, so a reindex that
// embedded the text it read when it started would write it over an edit that
// was indexed while it ran. Each item's text is read when the reindex gets
// to it.
func TestIntegrationReindexReadsEachItemWhenItGetsThere(t *testing.T) {
	db := integrationDB(t)
	ix, _, fake := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	if err := db.Create(&models.Workspace{ID: "ws-1", Name: "Home", UserID: &user}).Error; err != nil {
		t.Fatal(err)
	}
	saveTask(t, db, &models.Task{ID: "tsk-first", UserID: &user, Name: "Plan the garden"})
	if err := db.Exec(`INSERT INTO documents (id, user_id, workspace_id, title, plain_text, updated_at) VALUES ('doc-later', ?, 'ws-1', 'Draft budget', '', now())`, user).Error; err != nil {
		t.Fatal(err)
	}
	// Tasks come first; while the task is embedded, the doc is renamed.
	fake.during = func(texts []string) {
		if strings.Contains(strings.Join(texts, " "), "Plan the garden") {
			db.Exec(`UPDATE documents SET title = 'Kitchen renovation costs' WHERE id = 'doc-later'`)
		}
	}
	if _, err := ix.Reindex(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	if got := indexedTitles(t, db, "doc-later"); len(got) != 1 || got[0] != "Kitchen renovation costs" {
		t.Fatalf("reindex stored %v for a doc renamed while it ran", got)
	}
}

// E2 follow-up: an item deleted while its own text was being embedded had its
// rows written after the delete had removed the old ones, keeping its text.
func TestIntegrationItemDeletedWhileEmbeddedKeepsNoRows(t *testing.T) {
	db := integrationDB(t)
	ix, queue, fake := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	task := &models.Task{ID: "tsk-dup", UserID: &user, Name: "Accidental duplicate entry", Description: "locker code 4471"}
	saveTask(t, db, task)
	ix.IndexTask(task)
	fake.during = func([]string) {
		db.Exec(`DELETE FROM tasks WHERE id = ?`, task.ID)
		ix.Delete(user, KindTask, task.ID)
	}
	runIndexJob(t, ix, queue)
	var rows int64
	db.Model(&models.Embedding{}).Where("entity_id = ?", task.ID).Count(&rows)
	if rows != 0 {
		t.Fatalf("%d embedding rows kept for a task deleted while it was embedded", rows)
	}
}

// GB7: an index call still waiting on the provider when a restore (or any
// other change) replaced the item wrote the old text back afterwards, and the
// palette showed the old title for the restored item.
func TestIntegrationLateVectorsForChangedTextAreDropped(t *testing.T) {
	db := integrationDB(t)
	ix, _, fake := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	task := &models.Task{ID: "tsk-restored", UserID: &user, Name: "NEWER-1 renamed just before restore"}
	saveTask(t, db, task)
	// The rebuild after the restore already indexed the restored title.
	fake.during = func([]string) {
		fake.during = nil
		saveTask(t, db, &models.Task{ID: task.ID, UserID: &user, Name: "OLD-1 quarterly report section"})
		if err := ix.IndexEntity(context.Background(), user, KindTask, task.ID); err != nil {
			t.Error(err)
		}
	}
	if err := ix.IndexEntity(context.Background(), user, KindTask, task.ID); err != nil {
		t.Fatal(err)
	}
	if got := indexedTitles(t, db, task.ID); len(got) != 1 || got[0] != "OLD-1 quarterly report section" {
		t.Fatalf("indexed %v; the late call wrote the replaced title back", got)
	}
}

// GB14: one item whose text the provider refused failed the whole rebuild,
// on every attempt, so no other item was ever indexed.
func TestIntegrationReindexSkipsARefusedItem(t *testing.T) {
	db := integrationDB(t)
	ix, _, fake := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	for _, task := range []*models.Task{
		{ID: "tsk-1", UserID: &user, Name: "Plan the garden"},
		{ID: "tsk-2", UserID: &user, Name: "POISON review vendor"},
		{ID: "tsk-3", UserID: &user, Name: "Book piano lessons"},
	} {
		saveTask(t, db, task)
	}
	fake.refuse = func(texts []string) bool { return strings.Contains(strings.Join(texts, " "), "POISON") }
	var skipped int
	n, err := ix.Reindex(context.Background(), user, func(_, _, skip int) { skipped = skip })
	if err != nil || n != 2 || skipped != 1 {
		t.Fatalf("reindex = %d indexed, %d skipped, %v; want 2, 1, nil", n, skipped, err)
	}
	for _, id := range []string{"tsk-1", "tsk-3"} {
		if got := indexedTitles(t, db, id); len(got) != 1 {
			t.Fatalf("%s was not indexed past the refused item", id)
		}
	}

	// Refusals with nothing accepted point at the account (a model that takes
	// no input), so the rebuild stops after a few instead of trying them all.
	db.Exec(`DELETE FROM embeddings`)
	for i := 4; i <= 9; i++ {
		saveTask(t, db, &models.Task{ID: "tsk-" + string(rune('0'+i)), UserID: &user, Name: "Another task"})
	}
	fake.refuse = func([]string) bool { return true }
	before := len(fake.sent())
	if _, err := ix.Reindex(context.Background(), user, nil); !Rejected(err) {
		t.Fatalf("every item refused should stop the rebuild with the refusal, got %v", err)
	}
	if calls := len(fake.sent()) - before; calls != rejectedBeforeAny {
		t.Fatalf("made %d calls before stopping, want %d", calls, rejectedBeforeAny)
	}
}

// RV-jobs-2: a title of tabs or no-break spaces trims to nothing when it is
// indexed, so the item never gets rows; Missing counted it for good and every
// search queued a rebuild.
func TestIntegrationMissingIgnoresTitlesOfWhiteSpace(t *testing.T) {
	db := integrationDB(t)
	ix, _, _ := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	for _, task := range []*models.Task{
		{ID: "tsk-tabs", UserID: &user, Name: "\t\n"},
		{ID: "tsk-nbsp", UserID: &user, Name: "\u00a0\u2003\u3000"},
		{ID: "tsk-words", UserID: &user, Name: " Plan the garden"},
	} {
		saveTask(t, db, task)
	}
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 1 {
		t.Fatalf("missing = %d, %v; want only the task with words", n, err)
	}
	if _, err := ix.Reindex(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 0 {
		t.Fatalf("missing after a reindex = %d, %v", n, err)
	}
}

// E3 with the coverage check: searches leave out rows of an earlier
// embedding model, so an item that still has only those rows is missing.
// Counting it as covered left it out of semantic search for good once the
// rebuild after a model change failed, since nothing queued another.
func TestIntegrationMissingCountsRowsOfAnEarlierModel(t *testing.T) {
	db := integrationDB(t)
	ix, _, _ := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	saveTask(t, db, &models.Task{ID: "tsk-old-model", UserID: &user, Name: "Schedule car service"})
	if _, err := ix.Reindex(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 0 {
		t.Fatalf("missing after a reindex = %d, %v", n, err)
	}
	ix.SetCredentials(func(string) (string, string) { return "test-key", "test-model-2" })
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 1 {
		t.Fatalf("missing after the model changed = %d, %v; want the item embedded only by the old model", n, err)
	}
	if _, err := ix.Reindex(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 0 {
		t.Fatalf("missing after the new model's reindex = %d, %v", n, err)
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

// GB2 and GB16: the lazy rebuild looked only at whether any row existed, so
// one indexed item hid fifteen missing ones. Missing counts coverage: items
// with a title, no rows and no index job on the way.
func TestIntegrationMissingCountsUnindexedItems(t *testing.T) {
	db := integrationDB(t)
	ix, queue, _ := testIndexer(t, db)
	user := "user-a"
	seedUser(t, db, user)
	if err := db.Create(&models.Workspace{ID: "ws-1", Name: "Home", UserID: &user}).Error; err != nil {
		t.Fatal(err)
	}
	for _, task := range []*models.Task{
		{ID: "tsk-indexed", UserID: &user, Name: "Renamed after the restore"},
		{ID: "tsk-missing", UserID: &user, Name: "Plan the garden"},
		{ID: "tsk-queued", UserID: &user, Name: "Book piano lessons"},
		{ID: "tsk-blank", UserID: &user, Name: "  "},
	} {
		saveTask(t, db, task)
	}
	if err := db.Exec(`INSERT INTO projects (id, title, description, workspace_id, updated_at) VALUES ('pr-1', 'Kitchen', '', 'ws-1', now())`).Error; err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexEntity(context.Background(), user, KindTask, "tsk-indexed"); err != nil {
		t.Fatal(err)
	}
	if err := queue.EnqueueIndex(user, KindTask, "tsk-queued"); err != nil {
		t.Fatal(err)
	}
	// tsk-missing and the project are missing; the blank task never indexes.
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 2 {
		t.Fatalf("missing = %d, %v; want 2", n, err)
	}
	if _, err := ix.Reindex(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	if n, err := ix.Missing(context.Background(), user); err != nil || n != 0 {
		t.Fatalf("missing after a reindex = %d, %v", n, err)
	}
}
