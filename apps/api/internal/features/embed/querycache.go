package embed

import (
	"container/list"
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

// queryCache is a small least-recently-used map with an age limit.
type queryCache struct {
	mu    sync.Mutex
	max   int
	ttl   time.Duration
	order *list.List // front = most recently used
	items map[string]*list.Element
	now   func() time.Time
}

func newQueryCache(max int, ttl time.Duration) *queryCache {
	return &queryCache{max: max, ttl: ttl, order: list.New(), items: map[string]*list.Element{}, now: time.Now}
}

func (c *queryCache) get(key string) ([]float32, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
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

func (c *queryCache) put(key string, vec []float32) {
	c.mu.Lock()
	defer c.mu.Unlock()
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
