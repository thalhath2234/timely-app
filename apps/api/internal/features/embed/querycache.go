package embed

import (
	"container/list"
	"context"
	"errors"
	"sync"
	"time"
)

// queryVectors keeps recent search-query vectors for every indexer in the
// process. A query's vector depends only on its words and the model, so a
// repeat within the hour needs no provider call. Keys carry the account, so
// one person's searches never answer (or time) another's.
var queryVectors = newQueryCache(512, time.Hour)

type queryEntry struct {
	key string
	vec []float32
	at  time.Time
}

// queryFlight is a query being embedded right now. Callers that ask for the
// same key meanwhile wait for its answer instead of sending their own.
type queryFlight struct {
	done chan struct{}
	vec  []float32
	err  error
	// abandoned is set when the caller that sent the request gave up (its
	// request was cancelled): a waiter then asks again on its own behalf.
	abandoned bool
}

// errQueryUnfinished is what waiters see when the request they waited on
// ended without an answer or an error of its own.
var errQueryUnfinished = errors.New("openrouter embed: the query was not embedded")

// queryCache is a small least-recently-used map with an age limit.
type queryCache struct {
	mu      sync.Mutex
	max     int
	ttl     time.Duration
	order   *list.List // front = most recently used
	items   map[string]*list.Element
	flights map[string]*queryFlight
	now     func() time.Time
}

func newQueryCache(max int, ttl time.Duration) *queryCache {
	return &queryCache{max: max, ttl: ttl, order: list.New(), items: map[string]*list.Element{}, flights: map[string]*queryFlight{}, now: time.Now}
}

func (c *queryCache) get(key string) ([]float32, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lookup(key)
}

func (c *queryCache) put(key string, vec []float32) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store(key, vec)
}

// share returns the cached vector for key, or embeds it with fetch. Callers
// that ask for the same key while it is being embedded share that one
// request: the search palette sends its plain and its smart search at the
// same moment, and both would miss the cache.
func (c *queryCache) share(ctx context.Context, key string, fetch func() ([]float32, error)) ([]float32, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		c.mu.Lock()
		if vec, ok := c.lookup(key); ok {
			c.mu.Unlock()
			return vec, nil
		}
		f, waiting := c.flights[key]
		if !waiting {
			f = &queryFlight{done: make(chan struct{}), err: errQueryUnfinished}
			c.flights[key] = f
			c.mu.Unlock()
			c.lead(ctx, key, f, fetch)
			return f.vec, f.err
		}
		c.mu.Unlock()
		select {
		case <-f.done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		if !f.abandoned {
			return f.vec, f.err
		}
	}
}

// lead sends the request for a flight and hands its answer to the waiters.
func (c *queryCache) lead(ctx context.Context, key string, f *queryFlight, fetch func() ([]float32, error)) {
	defer func() {
		c.mu.Lock()
		delete(c.flights, key)
		if f.err == nil {
			c.store(key, f.vec)
		}
		c.mu.Unlock()
		close(f.done)
	}()
	vec, err := fetch()
	f.vec, f.err = vec, err
	f.abandoned = err != nil && ctx.Err() != nil
}

// lookup and store expect c.mu held.
func (c *queryCache) lookup(key string) ([]float32, bool) {
	el, ok := c.items[key]
	if !ok {
		return nil, false
	}
	entry := el.Value.(*queryEntry)
	if c.now().Sub(entry.at) >= c.ttl {
		c.order.Remove(el)
		delete(c.items, key)
		return nil, false
	}
	c.order.MoveToFront(el)
	return entry.vec, true
}

func (c *queryCache) store(key string, vec []float32) {
	if el, ok := c.items[key]; ok {
		el.Value = &queryEntry{key: key, vec: vec, at: c.now()}
		c.order.MoveToFront(el)
		return
	}
	c.items[key] = c.order.PushFront(&queryEntry{key: key, vec: vec, at: c.now()})
	for c.order.Len() > c.max {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.items, oldest.Value.(*queryEntry).key)
	}
}
