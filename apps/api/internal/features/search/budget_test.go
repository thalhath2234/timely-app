package search

import (
	"context"
	"errors"
	"testing"
	"time"

	"timely-api/internal/features/embed"
)

// hangingIndexer's query embedding does not answer for a long time, like a
// slow provider; it stops only when the search stops waiting.
type hangingIndexer struct{ embed.Indexer }

func (hangingIndexer) EnabledFor(string) bool                       { return true }
func (hangingIndexer) Count(context.Context, string) (int64, error) { return 1, nil }
func (hangingIndexer) Query(ctx context.Context, _, _ string, _ int, _ []string) ([]embed.Hit, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(10 * time.Second):
		return nil, nil
	}
}

func TestSemanticQueryGivesUpAfterItsBudget(t *testing.T) {
	if queryEmbedBudget > 3*time.Second {
		t.Fatalf("a search waits %s for its query embedding; keep it short", queryEmbedBudget)
	}
	before := queryEmbedBudget
	queryEmbedBudget = 50 * time.Millisecond
	t.Cleanup(func() { queryEmbedBudget = before })

	s := &service{indexer: hangingIndexer{}}
	start := time.Now()
	hits, err := s.vector(context.Background(), "u1", "pelican roadmap", 10, nil)
	took := time.Since(start)
	if !errors.Is(err, context.DeadlineExceeded) || hits != nil {
		t.Fatalf("vector = %v, %v; want no hits and the deadline, so the search answers with keyword hits", hits, err)
	}
	if took > 2*time.Second {
		t.Fatalf("the search waited %s for the embedding", took)
	}
}
