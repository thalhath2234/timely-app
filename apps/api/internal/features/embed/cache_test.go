package embed

import (
	"context"
	"errors"
	"testing"
	"time"
)

func fixtureChunks() []cachedChunk {
	return []cachedChunk{
		{kind: KindTask, entityID: "t1", title: "Buy milk", content: "milk", vec: []float32{1, 0, 0}},
		{kind: KindTask, entityID: "t1", title: "Buy milk", content: "milk second chunk", vec: []float32{0.9, 0.1, 0}},
		{kind: KindDoc, entityID: "d1", title: "Notes", content: "orthogonal", vec: []float32{0, 1, 0}},
		{kind: KindEvent, entityID: "e1", title: "Dentist", content: "opposite", vec: []float32{-1, 0, 0}},
		{kind: KindSheet, entityID: "s1", title: "Zero", content: "zero", vec: []float32{0, 0, 0}},
		{kind: KindProject, entityID: "p1", title: "Wrong dims", content: "dims", vec: []float32{1, 0}},
	}
}

func TestRankOrdersAndDedupes(t *testing.T) {
	chunks := fixtureChunks()
	for i := range chunks {
		chunks[i].norm = norm(chunks[i].vec)
	}
	hits := rank(chunks, []float32{2, 0, 0}, nil, 10)
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
	if got := rank(chunks, []float32{2, 0, 0}, []string{KindDoc}, 10); len(got) != 1 || got[0].EntityID != "d1" {
		t.Fatalf("kind filter: %+v", got)
	}
	if got := rank(chunks, []float32{2, 0, 0}, nil, 1); len(got) != 1 {
		t.Fatalf("limit: %+v", got)
	}
	if got := rank(chunks, []float32{0, 0, 0}, nil, 5); len(got) != 0 {
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
