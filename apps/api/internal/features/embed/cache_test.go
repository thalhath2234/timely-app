package embed

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func fixtureChunks() []cachedChunk {
	return []cachedChunk{
		{kind: KindTask, entityID: "t1", title: "Buy milk", content: "milk", model: "m", vec: []float32{1, 0, 0}},
		{kind: KindTask, entityID: "t1", title: "Buy milk", content: "milk second chunk", model: "m", vec: []float32{0.9, 0.1, 0}},
		{kind: KindDoc, entityID: "d1", title: "Notes", content: "orthogonal", model: "m", vec: []float32{0, 1, 0}},
		{kind: KindEvent, entityID: "e1", title: "Dentist", content: "opposite", model: "m", vec: []float32{-1, 0, 0}},
		{kind: KindSheet, entityID: "s1", title: "Zero", content: "zero", model: "m", vec: []float32{0, 0, 0}},
		{kind: KindProject, entityID: "p1", title: "Wrong dims", content: "dims", model: "m", vec: []float32{1, 0}},
	}
}

func TestRankOrdersAndDedupes(t *testing.T) {
	chunks := fixtureChunks()
	for i := range chunks {
		chunks[i].norm = norm(chunks[i].vec)
	}
	hits := rank(chunks, []float32{2, 0, 0}, "m", nil, 10)
	if len(hits) != 3 {
		t.Fatalf("expected 3 hits (t1, d1, e1), got %d: %+v", len(hits), hits)
	}
	if hits[0].EntityID != "t1" || hits[0].Score < 0.999 || hits[0].Content != "milk" {
		t.Fatalf("best hit = %+v", hits[0])
	}
	if hits[1].EntityID != "d1" || hits[1].Score > 0.001 || hits[1].Score < -0.001 {
		t.Fatalf("second hit = %+v", hits[1])
	}
	if hits[2].EntityID != "e1" || hits[2].Score > -0.999 {
		t.Fatalf("third hit = %+v", hits[2])
	}
	if got := rank(chunks, []float32{2, 0, 0}, "m", []string{KindDoc}, 10); len(got) != 1 || got[0].EntityID != "d1" {
		t.Fatalf("kind filter: %+v", got)
	}
	if got := rank(chunks, []float32{2, 0, 0}, "m", nil, 1); len(got) != 1 {
		t.Fatalf("limit: %+v", got)
	}
	if got := rank(chunks, []float32{0, 0, 0}, "m", nil, 5); len(got) != 0 {
		t.Fatalf("zero query: %+v", got)
	}
}

func TestVectorCacheReusesAndInvalidates(t *testing.T) {
	loads := 0
	cache := newVectorCache(time.Hour, func(ctx context.Context, userID string) ([]cachedChunk, error) {
		loads++
		return fixtureChunks(), nil
	})
	ctx := context.Background()
	if _, err := cache.get(ctx, "u1"); err != nil {
		t.Fatal(err)
	}
	chunks, _ := cache.get(ctx, "u1")
	if loads != 1 {
		t.Fatalf("expected one load, got %d", loads)
	}
	if chunks[0].norm != 1 {
		t.Fatalf("norm not precomputed: %v", chunks[0].norm)
	}
	cache.get(ctx, "u2")
	if loads != 2 {
		t.Fatalf("accounts are cached separately: loads = %d", loads)
	}
	cache.invalidate("u1")
	cache.get(ctx, "u1")
	if loads != 3 {
		t.Fatalf("invalidate should force a reload: loads = %d", loads)
	}
}

func TestVectorCacheTTL(t *testing.T) {
	loads := 0
	cache := newVectorCache(time.Minute, func(ctx context.Context, userID string) ([]cachedChunk, error) {
		loads++
		return nil, nil
	})
	now := time.Now()
	cache.now = func() time.Time { return now }
	cache.get(context.Background(), "u1")
	cache.get(context.Background(), "u1")
	now = now.Add(2 * time.Minute)
	cache.get(context.Background(), "u1")
	if loads != 2 {
		t.Fatalf("expected reload after TTL, loads = %d", loads)
	}
}

func TestVectorCacheLoadError(t *testing.T) {
	cache := newVectorCache(time.Minute, func(ctx context.Context, userID string) ([]cachedChunk, error) {
		return nil, errors.New("db down")
	})
	if _, err := cache.get(context.Background(), "u1"); err == nil {
		t.Fatal("expected error")
	}
}

func TestRelatedUsesTheSourcesOwnVectors(t *testing.T) {
	chunks := fixtureChunks()
	for i := range chunks {
		chunks[i].norm = norm(chunks[i].vec)
	}
	src, hits, ok := related(chunks, KindDoc, "d1", "m", nil, 10)
	if !ok || src.Title != "Notes" || src.Content != "orthogonal" {
		t.Fatalf("source = %+v, ok %v", src, ok)
	}
	for _, hit := range hits {
		if hit.EntityID == "d1" {
			t.Fatalf("the source itself is listed: %+v", hits)
		}
	}
	// t1's second chunk leans toward d1, so t1 beats the opposite event.
	if len(hits) != 2 || hits[0].EntityID != "t1" || hits[1].EntityID != "e1" {
		t.Fatalf("hits = %+v", hits)
	}
	if _, _, ok := related(chunks, KindDoc, "missing", "m", nil, 10); ok {
		t.Fatal("an item with no chunks should report not found")
	}
}

// E3: after the embedding model changed, a query from the new model was
// ranked against the old model's vectors (same width, unrelated meaning)
// until the rebuild reached every row. Only the query's own model counts.
func TestRankLeavesOutOtherModels(t *testing.T) {
	chunks := []cachedChunk{
		{kind: KindTask, entityID: "car", title: "Schedule car service", model: "new", vec: []float32{1, 0, 0}},
		{kind: KindTask, entityID: "tax", title: "Prepare tax documents", model: "old", vec: []float32{1, 0, 0}},
		{kind: KindTask, entityID: "party", title: "Plan birthday party", model: "old", vec: []float32{0.9, 0.1, 0}},
	}
	for i := range chunks {
		chunks[i].norm = norm(chunks[i].vec)
	}
	hits := rank(chunks, []float32{1, 0, 0}, "new", nil, 10)
	if len(hits) != 1 || hits[0].EntityID != "car" {
		t.Fatalf("hits = %+v, want only the item embedded by the query's model", hits)
	}
	if _, _, ok := related(chunks, KindTask, "tax", "new", nil, 10); ok {
		t.Fatal("an item not yet re-embedded by the current model has no neighbours to show")
	}
	src, near, ok := related(chunks, KindTask, "tax", "old", nil, 10)
	if !ok || src.Title != "Prepare tax documents" || len(near) != 1 || near[0].EntityID != "party" {
		t.Fatalf("related within one model = %+v %+v %v", src, near, ok)
	}
}

// GB19: the chat tools build an indexer of their own, and a write through it
// left the main indexer's cache holding the old vectors for up to 15 minutes.
func TestVectorCacheSeesOtherCachesWrites(t *testing.T) {
	loads := 0
	load := func(ctx context.Context, userID string) ([]cachedChunk, error) {
		loads++
		return nil, nil
	}
	main := newVectorCache(time.Hour, load)
	chat := newVectorCache(time.Hour, load)
	ctx := context.Background()
	main.get(ctx, "gb19-user")
	main.get(ctx, "gb19-user")
	if loads != 1 {
		t.Fatalf("loads = %d before any write", loads)
	}
	chat.invalidate("gb19-user")
	main.get(ctx, "gb19-user")
	if loads != 2 {
		t.Fatalf("a write through another indexer left this cache as it was: loads = %d", loads)
	}
	main.get(ctx, "gb19-other")
	chat.invalidate("gb19-user")
	main.get(ctx, "gb19-other")
	if loads != 3 {
		t.Fatalf("another account's write reloaded this one: loads = %d", loads)
	}
}

// JC1: the palette's plain and smart searches, and hints on every view,
// embedded the same words again each time.
func TestQueryEmbedsTheSameWordsOnce(t *testing.T) {
	fake := &fakeEmbeddings{}
	ix := &indexer{http: &http.Client{Transport: fake}, model: defaultModel}
	ix.vectors = newVectorCache(time.Hour, func(context.Context, string) ([]cachedChunk, error) { return nil, nil })
	model := "jc1-model"
	ix.SetCredentials(func(userID string) (string, string) { return "key", model })
	ctx := context.Background()
	// The query cache lives for the process: fresh accounts keep a repeated
	// run (go test -count) from finding the first run's vectors.
	a, b := freshAccount("jc1-a"), freshAccount("jc1-b")
	for range 3 {
		if _, err := ix.Query(ctx, a, "money for the builder", 5, nil); err != nil {
			t.Fatal(err)
		}
	}
	if sent := fake.sent(); len(sent) != 1 {
		t.Fatalf("the same query was embedded %d times", len(sent))
	}
	ix.Query(ctx, b, "money for the builder", 5, nil)
	model = "jc1-other-model"
	ix.Query(ctx, a, "money for the builder", 5, nil)
	ix.Query(ctx, a, "money for the roofer", 5, nil)
	if sent := fake.sent(); len(sent) != 4 {
		t.Fatalf("another account, model or query must embed again: %d calls", len(sent))
	}
}

func freshAccount(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func TestQueryCacheDropsOldAndLeastUsed(t *testing.T) {
	c := newQueryCache(2, time.Minute)
	now := time.Now()
	c.now = func() time.Time { return now }
	c.put("a", []float32{1})
	c.put("b", []float32{2})
	c.get("a")
	c.put("c", []float32{3})
	if _, ok := c.get("b"); ok {
		t.Fatal("the least recently used entry should go first")
	}
	if _, ok := c.get("a"); !ok {
		t.Fatal("a recently used entry was dropped")
	}
	now = now.Add(2 * time.Minute)
	if _, ok := c.get("a"); ok {
		t.Fatal("an entry past its age limit was kept")
	}
}

// JC1: the palette sends its plain and its smart search for a new query at
// the same moment, so both missed the cache and the words were embedded twice.
func TestQueryAskedTwiceAtOnceEmbedsOnce(t *testing.T) {
	inFlight := make(chan struct{}, 2)
	release := make(chan struct{})
	fake := &fakeEmbeddings{during: func([]string) {
		inFlight <- struct{}{}
		<-release
	}}
	ix := &indexer{http: &http.Client{Transport: fake}, model: defaultModel}
	ix.vectors = newVectorCache(time.Hour, func(context.Context, string) ([]cachedChunk, error) { return nil, nil })
	ix.SetCredentials(func(string) (string, string) { return "key", "jc1-together-model" })
	ctx := context.Background()

	errs := make(chan error, 2)
	account := freshAccount("jc1-together")
	ask := func() {
		_, err := ix.Query(ctx, account, "invoice for the plumber", 5, nil)
		errs <- err
	}
	go ask()
	select {
	case <-inFlight:
	case <-time.After(5 * time.Second):
		t.Fatal("the first search never reached the provider")
	}
	go ask()
	// Without sharing, the second search sends its own request, which
	// reaches the provider while the first is still waiting for an answer.
	select {
	case <-inFlight:
		close(release)
		t.Fatal("the second search embedded the same words again")
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if sent := fake.sent(); len(sent) != 1 {
		t.Fatalf("embedded %d times", len(sent))
	}
}

// A search cancelled while its words are being embedded must not fail the
// other search waiting on the same request, and a failure is not kept.
func TestQueryShareSurvivesACancelledFirstCaller(t *testing.T) {
	c := newQueryCache(8, time.Minute)
	first, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	stop := make(chan struct{})
	firstErr := make(chan error, 1)
	go func() {
		_, err := c.share(first, "k", func() ([]float32, error) {
			close(started)
			<-stop
			return nil, first.Err()
		})
		firstErr <- err
	}()
	<-started
	type answer struct {
		vec []float32
		err error
	}
	second := make(chan answer, 1)
	go func() {
		vec, err := c.share(context.Background(), "k", func() ([]float32, error) { return []float32{7}, nil })
		second <- answer{vec, err}
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	close(stop)
	if err := <-firstErr; !errors.Is(err, context.Canceled) {
		t.Fatalf("first caller: %v", err)
	}
	got := <-second
	if got.err != nil || len(got.vec) != 1 || got.vec[0] != 7 {
		t.Fatalf("the waiting search got %+v", got)
	}

	failed := errors.New("openrouter embed: HTTP 503 Service Unavailable")
	if _, err := c.share(context.Background(), "bad", func() ([]float32, error) { return nil, failed }); !errors.Is(err, failed) {
		t.Fatalf("error: %v", err)
	}
	if _, ok := c.get("bad"); ok {
		t.Fatal("a failed embedding was cached")
	}
}
