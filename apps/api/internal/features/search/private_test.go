package search

import (
	"context"
	"errors"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/embed"
)

// countingIndexer fails the test if a private chat's search reaches it.
type countingIndexer struct {
	embed.Indexer
	calls int
}

func (c *countingIndexer) EnabledFor(string) bool { return true }
func (c *countingIndexer) Count(context.Context, string) (int64, error) {
	c.calls++
	return 0, nil
}
func (c *countingIndexer) ReindexUser(context.Context, string) (int, error) {
	c.calls++
	return 0, nil
}
func (c *countingIndexer) Query(context.Context, string, string, int, []string) ([]embed.Hit, error) {
	c.calls++
	return nil, nil
}

func TestPrivateChatSearchesSkipEmbeddings(t *testing.T) {
	idx := &countingIndexer{}
	s := &service{indexer: idx}
	hits, err := s.vector(decide.WithSensitive(context.Background()), "user", "Dr. Alice Moore cardiology", 20, nil)
	if !errors.Is(err, embed.ErrDisabled) || hits != nil {
		t.Fatalf("hits %v err %v, want the keyword-only fallback", hits, err)
	}
	if idx.calls != 0 {
		t.Fatalf("%d indexer calls for a private chat", idx.calls)
	}
}
