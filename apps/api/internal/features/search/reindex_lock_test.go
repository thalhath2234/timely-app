package search

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"timely-api/internal/features/embed"
)

// countingIndexer records how many rebuilds run at the same time.
type countingIndexer struct {
	embed.Indexer
	running, most atomic.Int32
	runs          atomic.Int32
}

func (*countingIndexer) EnabledFor(string) bool { return true }
func (c *countingIndexer) ReindexUser(context.Context, string) (int, error) {
	now := c.running.Add(1)
	defer c.running.Add(-1)
	for {
		most := c.most.Load()
		if now <= most || c.most.CompareAndSwap(most, now) {
			break
		}
	}
	c.runs.Add(1)
	time.Sleep(30 * time.Millisecond)
	return 5, nil
}

// Two manual rebuilds at once each embedded every stale item.
func TestManualReindexRunsOneAtATime(t *testing.T) {
	idx := &countingIndexer{}
	s := &service{indexer: idx}
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Reindex(context.Background(), "u1"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if idx.runs.Load() != 3 {
		t.Fatalf("every request still runs (and finds nothing left), got %d runs", idx.runs.Load())
	}
	if idx.most.Load() != 1 {
		t.Fatalf("%d rebuilds ran at once for one account; want 1", idx.most.Load())
	}
}

func TestManualReindexWaitGivesUpWithItsRequest(t *testing.T) {
	unlock, err := reindexing.lock(context.Background(), "u2")
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	s := &service{indexer: &countingIndexer{}}
	if _, err := s.Reindex(ctx, "u2"); err == nil {
		t.Fatal("a request that stops waiting must not start a second rebuild")
	}
	// Another account is not held up.
	if _, err := s.Reindex(context.Background(), "u3"); err != nil {
		t.Fatal(err)
	}
}

func TestClampLimit(t *testing.T) {
	for in, want := range map[int]int{0: 20, -1: 20, 10: 10, 40: 40, 50: 50, 80: 50} {
		if got := clampLimit(in); got != want {
			t.Errorf("clampLimit(%d) = %d, want %d", in, got, want)
		}
	}
}
