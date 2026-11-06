package realtime

import (
	"sync"
)

// Event is a last-write-wins invalidation notice. Clients refetch or apply
// the embedded document when they have no local unsaved edits.
type Event struct {
	Type      string `json:"type"`
	Kind      string `json:"kind"`
	ID        string `json:"id"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	Document  any    `json:"document,omitempty"`
}

type subscriber struct {
	ch chan Event
}

// Hub fans document mutations out to every open watch stream for that doc.
type Hub struct {
	mu     sync.Mutex
	subs   map[string]map[*subscriber]struct{}
	closed bool
}

func NewHub() *Hub {
	return &Hub{subs: map[string]map[*subscriber]struct{}{}}
}

func docKey(userID, docID string) string {
	return userID + "/" + docID
}

// Subscribe receives events for one document owned by userID. Call the
// returned function to unsubscribe.
func (h *Hub) Subscribe(userID, docID string) (<-chan Event, func()) {
	if h == nil {
		ch := make(chan Event)
		close(ch)
		return ch, func() {}
	}

	sub := &subscriber{ch: make(chan Event, 8)}
	key := docKey(userID, docID)

	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		close(sub.ch)
		return sub.ch, func() {}
	}
	if h.subs[key] == nil {
		h.subs[key] = map[*subscriber]struct{}{}
	}
	h.subs[key][sub] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		set, ok := h.subs[key]
		if _, subscribed := set[sub]; !ok || !subscribed {
			return
		}
		delete(set, sub)
		if len(set) == 0 {
			delete(h.subs, key)
		}
		close(sub.ch)
	}

	return sub.ch, cancel
}

// Publish sends without blocking, under the lock, so a stream that is being
// cancelled or closed never receives on a closed channel.
func (h *Hub) Publish(userID, docID string, event Event) {
	if h == nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subs[docKey(userID, docID)] {
		select {
		case sub.ch <- event:
		default:
			// A slow client is skipped rather than blocking writers.
		}
	}
}

// Close ends every open stream and every later Subscribe. The server calls it
// on shutdown, since watch streams would otherwise hold Shutdown open.
func (h *Hub) Close() {
	if h == nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for key, set := range h.subs {
		for sub := range set {
			close(sub.ch)
		}
		delete(h.subs, key)
	}
}
