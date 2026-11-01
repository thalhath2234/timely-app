package provider

import (
	"context"
	"testing"

	"timely-api/internal/features/embed"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// switchingIndexer is a rebuild during which the person picks another
// embedding model, once: the PATCH lands while the first pass runs.
type switchingIndexer struct {
	embed.Indexer
	s      *Service
	to     string
	passes int
}

func (*switchingIndexer) SetCredentials(embed.Credentials) {}
func (*switchingIndexer) EnabledFor(string) bool           { return true }
func (x *switchingIndexer) Reindex(_ context.Context, userID string, progress func(done, total int)) (int, error) {
	x.passes++
	if x.passes == 1 {
		if _, err := x.s.update(userID, func(row *Settings) error {
			row.OpenRouterEmbedModel = x.to
			return nil
		}); err != nil {
			return 0, err
		}
	}
	if progress != nil {
		progress(9, 9)
	}
	return 9, nil
}

// The second switch's rebuild was folded into the running one, which ended
// "done 9/9" with the items it did before the switch still on the old model.
func TestIntegrationRebuildGoesAgainForAModelSwitchedMidRun(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	idx := &switchingIndexer{to: "embed-model-new"}
	s := New(db, idx, jobs.NewQueue(db))
	idx.s = s
	if _, err := s.update("user-a", func(row *Settings) error {
		row.OpenRouterEmbedModel = "embed-model-old"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.handleReindex(context.Background(), &models.Job{UserID: "user-a"}); err != nil {
		t.Fatal(err)
	}
	if idx.passes != 2 {
		t.Fatalf("the rebuild ran %d passes; want a second one for the new model", idx.passes)
	}
	row, err := s.load(db, "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if row.Reindex.Status != "done" || row.Reindex.Done != 9 {
		t.Fatalf("state = %+v", row.Reindex)
	}

	// Without a switch, one pass is all.
	idx.passes, idx.to = 1, ""
	if err := s.handleReindex(context.Background(), &models.Job{UserID: "user-a"}); err != nil {
		t.Fatal(err)
	}
	if idx.passes != 2 {
		t.Fatalf("an unchanged model ran %d passes; want 1", idx.passes-1)
	}
}
