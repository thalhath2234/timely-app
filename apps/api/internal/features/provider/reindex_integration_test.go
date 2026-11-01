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

func (f *failingIndexer) Reindex(context.Context, string, func(int, int)) (int, error) {
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
