package jobs

import (
	"context"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/models"

	"gorm.io/gorm"
)

func dedupeIndex(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.Exec(`CREATE UNIQUE INDEX idx_jobs_dedupe_active ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running')`).Error; err != nil {
		t.Fatal(err)
	}
}

func failOut(t *testing.T, q *Queue, cause error) *models.Job {
	t.Helper()
	job, err := q.Claim(context.Background(), "w1", Lane{})
	if err != nil || job == nil {
		t.Fatalf("claim: %+v %v", job, err)
	}
	job.Attempts = job.MaxAttempts
	if err := q.Fail(job, cause); err != nil {
		t.Fatal(err)
	}
	return job
}

func jobRow(t *testing.T, db *gorm.DB, id string) models.Job {
	t.Helper()
	var row models.Job
	if err := db.First(&row, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

// GB3: an error no retry can fix (a refused key, no credits) was tried eight
// times, each a provider call.
func TestIntegrationPermanentErrorsFailAtOnce(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	job, _ := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobIndexEntity})
	claimed, _ := q.Claim(context.Background(), "w1", Lane{})
	if err := q.Fail(claimed, Permanent(errors.New("openrouter embed: Insufficient credits"))); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, job.ID); row.Status != models.JobFailed || row.Attempts != 1 {
		t.Fatalf("a permanent error left the job %s after %d attempts", row.Status, row.Attempts)
	}

	other, _ := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobIndexEntity})
	claimed, _ = q.Claim(context.Background(), "w1", Lane{})
	if err := q.Fail(claimed, errors.New("openrouter embed: HTTP 503 Service Unavailable")); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, other.ID); row.Status != models.JobPending {
		t.Fatalf("a passing error should be tried again, job is %s", row.Status)
	}
}

// GB31: a provider error quoting the refused key was saved and listed whole.
func TestIntegrationFailHidesKeysAndClips(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	job, _ := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobIndexEntity})
	failOut(t, q, errors.New("openrouter embed: Bad key sk-or-v1-0123456789abcdef "+strings.Repeat("x", 5000)))
	row := jobRow(t, db, job.ID)
	if row.LastError == nil || strings.Contains(*row.LastError, "0123456789abcdef") || len(*row.LastError) > maxErrorBytes+len("…") {
		t.Fatalf("saved error: %.80q (%d bytes)", *row.LastError, len(*row.LastError))
	}
}

// GB12: Retry on a failed job while a newer run of the same work waited hit
// the unique index and returned raw "duplicate key ... (SQLSTATE 23505)".
// GB13: once the newer run succeeded, the old failure stayed in the list.
func TestIntegrationRetryDefersToANewerRun(t *testing.T) {
	db := integrationDB(t)
	dedupeIndex(t, db)
	q := NewQueue(db)
	old, _ := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobReindexUser, DedupeKey: "reindex:user-1"})
	failOut(t, q, errors.New("openrouter embed: input rejected"))
	newer, err := q.Enqueue(Enqueue{UserID: "user-1", Kind: models.JobReindexUser, DedupeKey: "reindex:user-1"})
	if err != nil || newer.ID == old.ID {
		t.Fatalf("new run: %+v %v", newer, err)
	}
	if _, err := q.Retry("user-1", old.ID); !errors.Is(err, ErrNewerRun) {
		t.Fatalf("retry while a newer run waits: %v", err)
	}
	if row := jobRow(t, db, old.ID); row.Status != models.JobFailed {
		t.Fatalf("the refused retry changed the old job to %s", row.Status)
	}

	claimed, _ := q.Claim(context.Background(), "w1", Lane{})
	if claimed == nil || claimed.ID != newer.ID {
		t.Fatalf("claimed %+v", claimed)
	}
	if err := q.Succeed(claimed); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, old.ID); row.Status != models.JobCancelled {
		t.Fatalf("the old failure is %s after a newer run did the work", row.Status)
	}
	failed, _ := q.List("user-1", models.JobFailed, 10)
	if len(failed) != 0 {
		t.Fatalf("failed list still shows %d jobs", len(failed))
	}
}

// GB13 for index jobs: a running job's key is freed for a newer edit, so its
// failure has no key; the newer run for the same item still clears it.
func TestIntegrationIndexSuccessClearsTheItemsOldFailures(t *testing.T) {
	db := integrationDB(t)
	dedupeIndex(t, db)
	q := NewQueue(db)
	if err := q.EnqueueIndex("user-1", "task", "tsk-1"); err != nil {
		t.Fatal(err)
	}
	running, _ := q.Claim(context.Background(), "w1", Lane{})
	if err := q.EnqueueIndex("user-1", "task", "tsk-1"); err != nil {
		t.Fatal(err)
	}
	running.Attempts = running.MaxAttempts
	if err := q.Fail(running, errors.New("timeout")); err != nil {
		t.Fatal(err)
	}
	other := models.Job{}
	q.EnqueueIndex("user-1", "task", "tsk-2")
	db.Where("payload->>'entityId' = ?", "tsk-2").First(&other)
	db.Model(&models.Job{}).Where("id = ?", other.ID).Update("status", models.JobFailed)

	next, _ := q.Claim(context.Background(), "w1", Lane{})
	if next == nil || next.Payload.String("entityId") != "tsk-1" {
		t.Fatalf("claimed %+v", next)
	}
	if err := q.Succeed(next); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, running.ID); row.Status != models.JobCancelled {
		t.Fatalf("the item's old failure is %s", row.Status)
	}
	if row := jobRow(t, db, other.ID); row.Status != models.JobFailed {
		t.Fatalf("another item's failure was cleared: %s", row.Status)
	}
}

// RV-jobs-3: an agent's edit runs in a transaction. A worker that claimed the
// item's waiting index job before it committed read the text without the
// edit, and nothing indexed the edit afterwards.
func TestIntegrationWaitingIndexJobWaitsForTheEdit(t *testing.T) {
	db := integrationDB(t)
	dedupeIndex(t, db)
	q := NewQueue(db)
	ctx := context.Background()
	if err := q.EnqueueIndex("user-1", "task", "tsk-1"); err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	defer tx.Rollback()
	if err := NewQueue(tx).EnqueueIndex("user-1", "task", "tsk-1"); err != nil {
		t.Fatal(err)
	}
	if job, err := q.Claim(ctx, "w1", Lane{}); err != nil || job != nil {
		t.Fatalf("claimed %+v (%v) before the edit was committed", job, err)
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	job, err := q.Claim(ctx, "w1", Lane{})
	if err != nil || job == nil || job.Payload.String("entityId") != "tsk-1" {
		t.Fatalf("after the commit: %+v %v", job, err)
	}
	var n int64
	db.Model(&models.Job{}).Count(&n)
	if n != 1 {
		t.Fatalf("%d jobs for one item", n)
	}
}
