package jobs

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

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
	schema := "jobs_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = db.AutoMigrate(&models.Job{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// Claim and RecoverStuck judge run_at and locked_at by the API clock, which
// wrote them, not by the database's now(). The clock here is set decades away
// from the database's, so a query that used now() would claim the first job
// years early and never claim the second.
func TestIntegrationClaimUsesTheAPIClock(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	ctx := context.Background()

	for _, at := range []time.Time{
		time.Date(2001, 1, 1, 12, 0, 0, 0, time.UTC),
		time.Date(2099, 1, 1, 12, 0, 0, 0, time.UTC),
	} {
		job, err := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobSendReminder, RunAt: at})
		if err != nil {
			t.Fatal(err)
		}

		q.now = func() time.Time { return at.Add(-time.Minute) }
		if got, err := q.Claim(ctx, "w1", Lane{}); err != nil || got != nil {
			t.Fatalf("job due %s claimed a minute early: %+v, %v", at, got, err)
		}

		q.now = func() time.Time { return at.Add(time.Second) }
		got, err := q.Claim(ctx, "w1", Lane{})
		if err != nil || got == nil || got.ID != job.ID {
			t.Fatalf("job due %s not claimed once due: %+v, %v", at, got, err)
		}
		if got.LockedAt == nil || !got.LockedAt.Equal(at.Add(time.Second)) {
			t.Fatalf("locked_at = %v, want the API clock %s", got.LockedAt, at.Add(time.Second))
		}

		// Locked a minute ago by the API clock: not stuck yet.
		q.now = func() time.Time { return at.Add(time.Minute) }
		if err := q.RecoverStuck(5 * time.Minute); err != nil {
			t.Fatal(err)
		}
		var row models.Job
		if err := db.First(&row, "id = ?", job.ID).Error; err != nil {
			t.Fatal(err)
		}
		if row.Status != models.JobRunning {
			t.Fatalf("job due %s recovered after a minute: status %s", at, row.Status)
		}
		q.now = func() time.Time { return at.Add(10 * time.Minute) }
		if err := q.RecoverStuck(5 * time.Minute); err != nil {
			t.Fatal(err)
		}
		if err := db.First(&row, "id = ?", job.ID).Error; err != nil {
			t.Fatal(err)
		}
		if row.Status != models.JobPending {
			t.Fatalf("job due %s not recovered after ten minutes: status %s", at, row.Status)
		}
		if err := q.Succeed(&row); err != nil {
			t.Fatal(err)
		}
	}
}

// A provider error with a character cut in half or a NUL used to make Fail's
// update fail, so the job stayed 'running' and RecoverStuck ran it again
// every ten minutes, forever.
func TestIntegrationFailSavesUnstorableErrors(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	ctx := context.Background()
	for _, cause := range []string{
		"openrouter embed: HTTP 503: " + strings.Repeat("x", 271) + "\xc3",
		"openrouter embed: bad \x00 input",
	} {
		job, err := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobIndexEntity})
		if err != nil {
			t.Fatal(err)
		}
		claimed, err := q.Claim(ctx, "w1", Lane{})
		if err != nil || claimed == nil || claimed.ID != job.ID {
			t.Fatalf("claim: %+v %v", claimed, err)
		}
		claimed.MaxAttempts = 1
		if err := q.Fail(claimed, errors.New(cause)); err != nil {
			t.Fatalf("fail: %v", err)
		}
		var row models.Job
		if err := db.First(&row, "id = ?", job.ID).Error; err != nil {
			t.Fatal(err)
		}
		if row.Status != models.JobFailed || row.LastError == nil || !strings.HasPrefix(*row.LastError, "openrouter embed:") {
			t.Fatalf("job after Fail: status %s error %v", row.Status, row.LastError)
		}
	}
}

// GB10: index jobs written before they named the item only still hold its
// text; the list never returns it.
func TestIntegrationListLeavesItemTextOut(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	if _, err := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobIndexEntity, Payload: models.JobPayload{
		"kind": "doc", "entityId": "doc-1", "title": "Salaries", "body": "PAYLOADLEAK",
	}}); err != nil {
		t.Fatal(err)
	}
	rows, err := q.List("user-1", "", 10)
	if err != nil || len(rows) != 1 {
		t.Fatalf("list: %v %v", rows, err)
	}
	if _, ok := rows[0].Payload["body"]; ok || rows[0].Payload["title"] != nil || rows[0].Payload.String("entityId") != "doc-1" {
		t.Fatalf("listed payload %v", rows[0].Payload)
	}
}

// A job that keeps losing its worker stops once its attempts are used up.
func TestIntegrationRecoverStuckFailsAJobOutOfAttempts(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	job, err := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobIndexEntity})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.Job{}).Where("id = ?", job.ID).Updates(map[string]any{
		"status": models.JobRunning, "attempts": 8, "locked_at": time.Now().Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := q.RecoverStuck(10 * time.Minute); err != nil {
		t.Fatal(err)
	}
	var row models.Job
	db.First(&row, "id = ?", job.ID)
	if row.Status != models.JobFailed || row.LastError == nil || row.FinishedAt == nil {
		t.Fatalf("job out of attempts: status %s error %v", row.Status, row.LastError)
	}
}

// E6: one account's reindex, one slow request per item, used to hold every
// other job for every account until it finished.
func TestIntegrationReindexDoesNotHoldUpOtherJobs(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	w := NewWorker(q)
	w.interval = 20 * time.Millisecond
	w.Separate(models.JobReindexUser)
	w.Separate(models.JobIndexEntity)

	release := make(chan struct{})
	started := make(chan struct{}, 1)
	ran := make(chan string, 8)
	w.Handle(models.JobReindexUser, func(ctx context.Context, job *models.Job) error {
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil
	})
	for _, kind := range []string{models.JobIndexEntity, models.JobSendReminder} {
		w.Handle(kind, func(ctx context.Context, job *models.Job) error {
			ran <- job.Kind
			return nil
		})
	}

	if _, err := q.Enqueue(Enqueue{UserID: "user-a", Kind: models.JobReindexUser}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()
	defer func() { close(release); cancel(); <-done }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("reindex never started")
	}
	for _, kind := range []string{models.JobIndexEntity, models.JobSendReminder} {
		if _, err := q.Enqueue(Enqueue{UserID: "user-b", Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	got := map[string]bool{}
	for len(got) < 2 {
		select {
		case kind := <-ran:
			got[kind] = true
		case <-time.After(5 * time.Second):
			t.Fatalf("jobs waited behind the running reindex; ran only %v", got)
		}
	}
}

// Lanes claim only their own kinds.
func TestIntegrationClaimKeepsToItsLane(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	ctx := context.Background()
	reindex, _ := q.Enqueue(Enqueue{UserID: "user-a", Kind: models.JobReindexUser})
	push, _ := q.Enqueue(Enqueue{UserID: "user-a", Kind: models.JobSendPush})
	if got, err := q.Claim(ctx, "w1", Lane{Exclude: []string{models.JobReindexUser}}); err != nil || got == nil || got.ID != push.ID {
		t.Fatalf("main lane claimed %+v, %v", got, err)
	}
	if got, err := q.Claim(ctx, "w1", Lane{Exclude: []string{models.JobReindexUser}}); err != nil || got != nil {
		t.Fatalf("main lane took a reindex: %+v, %v", got, err)
	}
	if got, err := q.Claim(ctx, "w1", Lane{Kinds: []string{models.JobReindexUser}}); err != nil || got == nil || got.ID != reindex.ID {
		t.Fatalf("reindex lane claimed %+v, %v", got, err)
	}
}

// A long job renews its lock, so RecoverStuck does not run it a second time.
func TestIntegrationRenewKeepsALongJobRunning(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	start := time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)
	q.now = func() time.Time { return start }
	job, _ := q.Enqueue(Enqueue{UserID: "user-a", Kind: models.JobReindexUser, RunAt: start})
	claimed, err := q.Claim(context.Background(), "w1", Lane{})
	if err != nil || claimed == nil {
		t.Fatalf("claim: %v", err)
	}
	q.now = func() time.Time { return start.Add(9 * time.Minute) }
	if err := q.Renew(claimed, "w1"); err != nil {
		t.Fatal(err)
	}
	q.now = func() time.Time { return start.Add(15 * time.Minute) }
	if err := q.RecoverStuck(10 * time.Minute); err != nil {
		t.Fatal(err)
	}
	var row models.Job
	db.First(&row, "id = ?", job.ID)
	if row.Status != models.JobRunning {
		t.Fatalf("a job renewed 6 minutes ago was recovered: %s", row.Status)
	}
}
