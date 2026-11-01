package embed

import (
	"context"
	"math"
	"sort"
	"sync"
	"time"
)

// cacheTTL bounds how stale an account's vectors can get if an invalidation
// is ever missed; every write path invalidates explicitly.
const cacheTTL = 15 * time.Minute

// cachedChunk is one embedded chunk held in memory for ranking (ADR 0011:
// cosine similarity runs in Go over a per-account cache, not in Postgres).
// model is the embedding model that made vec: two models' vectors have the
// same width but cannot be compared.
type cachedChunk struct {
	kind     string
	entityID string
	title    string
	content  string
	model    string
	vec      []float32
	norm     float32
}

type accountVectors struct {
	chunks   []cachedChunk
	loadedAt time.Time
	gen      uint64
}

// generations counts, per account, the writes to its embeddings in this
// process. Every indexer has a cache of its own (the chat tools build one per
// run), so a write through one of them has to reach the others: a cache entry
// remembers the generation it was loaded at and is reloaded once it changes.
var generations = struct {
	sync.Mutex
	byUser map[string]uint64
}{byUser: map[string]uint64{}}

func generation(userID string) uint64 {
	generations.Lock()
	defer generations.Unlock()
	return generations.byUser[userID]
}

func bumpGeneration(userID string) {
	generations.Lock()
	generations.byUser[userID]++
	generations.Unlock()
}

type chunkLoader func(ctx context.Context, userID string) ([]cachedChunk, error)

// vectorCache keeps each account's chunks until a write invalidates them or
// the TTL lapses.
type vectorCache struct {
	mu       sync.RWMutex
	accounts map[string]*accountVectors
	ttl      time.Duration
	load     chunkLoader
	now      func() time.Time
}

func newVectorCache(ttl time.Duration, load chunkLoader) *vectorCache {
	return &vectorCache{accounts: map[string]*accountVectors{}, ttl: ttl, load: load, now: time.Now}
}

func (c *vectorCache) get(ctx context.Context, userID string) ([]cachedChunk, error) {
	gen := generation(userID)
	c.mu.RLock()
	entry, ok := c.accounts[userID]
	c.mu.RUnlock()
	if ok && entry.gen == gen && c.now().Sub(entry.loadedAt) < c.ttl {
		return entry.chunks, nil
	}
	chunks, err := c.load(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range chunks {
		chunks[i].norm = norm(chunks[i].vec)
	}
	c.mu.Lock()
	c.accounts[userID] = &accountVectors{chunks: chunks, loadedAt: c.now(), gen: gen}
	c.mu.Unlock()
	return chunks, nil
}

// invalidate drops the account's vectors from this cache and from every
// other one in the process.
func (c *vectorCache) invalidate(userID string) {
	bumpGeneration(userID)
	c.mu.Lock()
	delete(c.accounts, userID)
	c.mu.Unlock()
}

func norm(v []float32) float32 {
	var sum float64
	for _, f := range v {
		sum += float64(f) * float64(f)
	}
	return float32(math.Sqrt(sum))
}

// rank scores the chunks made by model against the query by cosine
// similarity (1 = identical), keeps the requested kinds, and returns the best
// chunk per entity in descending order, at most limit entries. Chunks of
// another model are left out: after the embedding model changes, the rows a
// rebuild has not reached yet would otherwise be ranked by noise.
func rank(chunks []cachedChunk, query []float32, model string, kinds []string, limit int) []Hit {
	queryNorm := norm(query)
	if queryNorm == 0 || limit <= 0 {
		return []Hit{}
	}
	var allowed map[string]bool
	if len(kinds) > 0 {
		allowed = make(map[string]bool, len(kinds))
		for _, kind := range kinds {
			allowed[kind] = true
		}
	}
	best := map[string]int{} // entity key -> index in hits
	hits := make([]Hit, 0, 64)
	for i := range chunks {
		chunk := &chunks[i]
		if allowed != nil && !allowed[chunk.kind] {
			continue
		}
		if chunk.model != model || chunk.norm == 0 || len(chunk.vec) != len(query) {
			continue
		}
		var dot float64
		for j, f := range chunk.vec {
			dot += float64(f) * float64(query[j])
		}
		score := dot / (float64(chunk.norm) * float64(queryNorm))
		key := chunk.kind + ":" + chunk.entityID
		if at, seen := best[key]; seen {
			if score > hits[at].Score {
				hits[at].Score = score
				hits[at].Content = chunk.content
				hits[at].Title = chunk.title
			}
			continue
		}
		best[key] = len(hits)
		hits = append(hits, Hit{Kind: chunk.kind, EntityID: chunk.entityID, Title: chunk.title, Content: chunk.content, Score: score})
	}
	sort.SliceStable(hits, func(a, b int) bool { return hits[a].Score > hits[b].Score })
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits
}

// related ranks every other entity by cosine similarity to the mean of the
// source entity's chunk vectors, all made by model (see rank). found is false
// when the source has no chunks of model (not indexed yet, embeddings off
// when it was saved, or not re-embedded since the model changed).
func related(chunks []cachedChunk, kind, entityID, model string, kinds []string, limit int) (Source, []Hit, bool) {
	var src Source
	var mean []float64
	n := 0
	for i := range chunks {
		chunk := &chunks[i]
		if chunk.kind != kind || chunk.entityID != entityID || chunk.norm == 0 || chunk.model != model {
			continue
		}
		if mean == nil {
			mean = make([]float64, len(chunk.vec))
			src = Source{Title: chunk.title, Content: chunk.content}
		}
		if len(chunk.vec) != len(mean) {
			continue
		}
		// Unit vectors, so a long chunk doesn't outweigh a short one.
		for j, f := range chunk.vec {
			mean[j] += float64(f) / float64(chunk.norm)
		}
		n++
	}
	if n == 0 {
		return Source{}, nil, false
	}
	query := make([]float32, len(mean))
	for j := range mean {
		query[j] = float32(mean[j] / float64(n))
	}
	others := make([]cachedChunk, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk.kind == kind && chunk.entityID == entityID {
			continue
		}
		others = append(others, chunk)
	}
	return src, rank(others, query, model, kinds, limit), true
}
