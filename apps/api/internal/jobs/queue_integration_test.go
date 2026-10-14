package jobs

import (
	"context"
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
		if got, err := q.Claim(ctx, "w1"); err != nil || got != nil {
			t.Fatalf("job due %s claimed a minute early: %+v, %v", at, got, err)
		}

		q.now = func() time.Time { return at.Add(time.Second) }
		got, err := q.Claim(ctx, "w1")
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
