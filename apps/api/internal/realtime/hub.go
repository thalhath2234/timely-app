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
	mu   sync.Mutex
	subs map[string]map[*subscriber]struct{}
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
	if h.subs[key] == nil {
		h.subs[key] = map[*subscriber]struct{}{}
	}
	h.subs[key][sub] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			if set, ok := h.subs[key]; ok {
				delete(set, sub)
				if len(set) == 0 {
					delete(h.subs, key)
				}
			}
			h.mu.Unlock()
			close(sub.ch)
		})
	}

	return sub.ch, cancel
}

func (h *Hub) Publish(userID, docID string, event Event) {
	if h == nil {
		return
	}

	h.mu.Lock()
	set := h.subs[docKey(userID, docID)]
	targets := make([]*subscriber, 0, len(set))
	for sub := range set {
		targets = append(targets, sub)
	}
	h.mu.Unlock()

	for _, sub := range targets {
		select {
		case sub.ch <- event:
		default:
			// A slow client is skipped rather than blocking writers.
		}
	}
}
