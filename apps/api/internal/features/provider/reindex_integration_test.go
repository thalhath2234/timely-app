package provider

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/embed"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// coverageIndexer is an index with a set number of items missing.
type coverageIndexer struct {
	embed.Indexer
	missing int64
}

func (c *coverageIndexer) SetCredentials(embed.Credentials)               {}
func (c *coverageIndexer) EnabledFor(string) bool                         { return true }
func (c *coverageIndexer) Missing(context.Context, string) (int64, error) { return c.missing, nil }

// GB5 and GB2: a restore dropped the whole index without queueing a rebuild,
// and Settings went on saying "Search index up to date", because the status
// was only ever set by key and model changes.
func TestIntegrationIndexStatusFollowsCoverage(t *testing.T) {
	db := integrationDB(t)
	idx := &coverageIndexer{}
	s := New(db, idx, jobs.NewQueue(db))
	reindexJobs := func() int64 {
		var n int64
		db.Model(&models.Job{}).Where("user_id = ? AND kind = ? AND status = ?", "user-a", models.JobReindexUser, models.JobPending).Count(&n)
		return n
	}
	setState := func(st ReindexState) {
		if _, err := s.update("user-a", func(row *Settings) error { row.Reindex = st; return nil }); err != nil {
			t.Fatal(err)
		}
		db.Exec(`DELETE FROM jobs`)
	}
	status := func() string {
		code, body := call(t, s, "user-a", "GET", "/agent/providers", nil)
		if code != 200 {
			t.Fatalf("overview: %d", code)
		}
		reindex, _ := body["reindex"].(map[string]any)
		st, _ := reindex["status"].(string)
		return st
	}

	// What a restore does.
	setState(ReindexState{Status: "done", Done: 16, Total: 16, UpdatedAt: time.Now()})
	if err := s.QueueReindex("user-a"); err != nil {
		t.Fatal(err)
	}
	if got := status(); got != "queued" || reindexJobs() != 1 {
		t.Fatalf("after restore: status %q, %d jobs", got, reindexJobs())
	}

	// A "done" index missing items is not reported as up to date.
	setState(ReindexState{Status: "done", Done: 16, Total: 16, UpdatedAt: time.Now()})
	idx.missing = 15
	if got := status(); got != "queued" || reindexJobs() != 1 {
		t.Fatalf("partial index: status %q, %d jobs", got, reindexJobs())
	}

	// A queued rebuild whose job is gone gets its job back.
	db.Exec(`DELETE FROM jobs`)
	s.EnsureIndex("user-a")
	if reindexJobs() != 1 {
		t.Fatal("queued rebuild without a job was not queued again")
	}

	// A rebuild that just failed is left for Settings to show.
	setState(ReindexState{Status: "failed", Error: "HTTP 401", UpdatedAt: time.Now()})
	s.EnsureIndex("user-a")
	if got := status(); got != "failed" || reindexJobs() != 0 {
		t.Fatalf("recent failure: status %q, %d jobs", got, reindexJobs())
	}
	setState(ReindexState{Status: "failed", Error: "HTTP 401", UpdatedAt: time.Now().Add(-time.Hour)})
	s.EnsureIndex("user-a")
	if reindexJobs() != 1 {
		t.Fatal("an old failure was never retried")
	}

	// A complete index stays as it is.
	setState(ReindexState{Status: "done", Done: 16, Total: 16, UpdatedAt: time.Now()})
	idx.missing = 0
	if got := status(); got != "done" || reindexJobs() != 0 {
		t.Fatalf("complete index: status %q, %d jobs", got, reindexJobs())
	}
}

// failingIndexer is an index whose rebuild fails with a provider's error.
type failingIndexer struct {
	coverageIndexer
	err error
}

func (f *failingIndexer) Reindex(context.Context, string, func(int, int, int)) (int, error) {
	return 0, f.err
}

// GB4 on the rebuild: a provider error holding a NUL could not be saved in
// the status, which stayed "running". Settings then showed "Rebuilding…"
// for good and queued a new rebuild on every look once the job had failed.
func TestIntegrationReindexFailureWithAnUnstorableErrorIsSaved(t *testing.T) {
	db := integrationDB(t)
	idx := &failingIndexer{err: errors.New("openrouter embed: bad \x00 input \xc3")}
	s := New(db, idx, jobs.NewQueue(db))
	if err := s.handleReindex(context.Background(), &models.Job{UserID: "user-a", Kind: models.JobReindexUser}); err == nil {
		t.Fatal("a failed rebuild reported success")
	}
	row, err := s.load(db, "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if row.Reindex.Status != "failed" || !strings.HasPrefix(row.Reindex.Error, "openrouter embed: bad") {
		t.Fatalf("rebuild state after the failure: %+v", row.Reindex)
	}
}

// runReindexJob claims the account's rebuild job and does what the worker does.
func runReindexJob(t *testing.T, s *Service, queue *jobs.Queue) models.Job {
	t.Helper()
	job, err := queue.Claim(context.Background(), "test", jobs.Lane{})
	if err != nil || job == nil {
		t.Fatalf("no rebuild job to run: %v", err)
	}
	if err := s.handleReindex(context.Background(), job); err != nil {
		if err := queue.Fail(job, err); err != nil {
			t.Fatal(err)
		}
	} else if err := queue.Succeed(job); err != nil {
		t.Fatal(err)
	}
	var row models.Job
	s.db.First(&row, "id = ?", job.ID)
	return row
}

// GB28: the card read "failed" after the first failed attempt while the job
// was still waiting to try again. GB3: an error no retry can fix (no credits,
// a refused key) spent all eight attempts, and a Retry eight more.
func TestIntegrationRebuildStatusFollowsItsAttempts(t *testing.T) {
	db := integrationDB(t)
	queue := jobs.NewQueue(db)
	idx := &failingIndexer{err: &embed.ProviderError{Status: 503, Message: "openrouter embed: HTTP 503 Service Unavailable"}}
	s := New(db, idx, queue)
	state := func() ReindexState {
		row, err := s.load(db, "user-a")
		if err != nil {
			t.Fatal(err)
		}
		return row.Reindex
	}
	if err := s.QueueReindex("user-a"); err != nil {
		t.Fatal(err)
	}
	job := runReindexJob(t, s, queue)
	if st := state(); job.Status != models.JobPending || st.Status != "retrying" {
		t.Fatalf("after a failed first attempt: job %s, card %+v", job.Status, st)
	}

	db.Exec(`UPDATE jobs SET run_at = now() - interval '1 minute', attempts = max_attempts - 1`)
	job = runReindexJob(t, s, queue)
	if st := state(); job.Status != models.JobFailed || st.Status != "failed" || st.Error == "" {
		t.Fatalf("after the last attempt: job %s, card %+v", job.Status, st)
	}

	idx.err = &embed.ProviderError{Status: 402, Message: "openrouter embed: Insufficient credits"}
	if _, err := queue.Retry("user-a", job.ID); err != nil {
		t.Fatal(err)
	}
	job = runReindexJob(t, s, queue)
	if st := state(); job.Status != models.JobFailed || job.Attempts != 1 || st.Error != "openrouter embed: Insufficient credits" {
		t.Fatalf("no credits: job %s after %d attempts, card %+v", job.Status, job.Attempts, st)
	}
}

// skippingIndexer is a rebuild in which OpenRouter refused some items.
type skippingIndexer struct {
	coverageIndexer
	indexed, skipped int
}

func (s *skippingIndexer) Reindex(_ context.Context, _ string, progress func(int, int, int)) (int, error) {
	progress(s.indexed+s.skipped, s.indexed+s.skipped, s.skipped)
	return s.indexed, nil
}

// GB14: one item OpenRouter refused failed the whole rebuild, so nothing else
// was indexed. Now it is skipped and counted, and the items it leaves missing
// do not queue a new rebuild on every search.
func TestIntegrationRebuildCountsRefusedItems(t *testing.T) {
	db := integrationDB(t)
	queue := jobs.NewQueue(db)
	idx := &skippingIndexer{indexed: 5, skipped: 1}
	idx.missing = 1
	s := New(db, idx, queue)
	if err := s.QueueReindex("user-a"); err != nil {
		t.Fatal(err)
	}
	if job := runReindexJob(t, s, queue); job.Status != models.JobSucceeded {
		t.Fatalf("rebuild job %s", job.Status)
	}
	row, _ := s.load(db, "user-a")
	if st := row.Reindex; st.Status != "done" || st.Total != 5 || st.Skipped != 1 {
		t.Fatalf("card after the rebuild: %+v", st)
	}
	s.EnsureIndex("user-a")
	var waiting int64
	db.Model(&models.Job{}).Where("status = ?", models.JobPending).Count(&waiting)
	if waiting != 0 {
		t.Fatal("the refused item queued another rebuild straight away")
	}
}
