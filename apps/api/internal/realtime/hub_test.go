package realtime

import (
	"testing"
	"time"
)

func TestHubDeliversAndUnsubscribes(t *testing.T) {
	hub := NewHub()
	ch, cancel := hub.Subscribe("u1", "doc_1")

	hub.Publish("u1", "doc_1", Event{Type: "updated", ID: "doc_1"})

	select {
	case ev := <-ch:
		if ev.Type != "updated" || ev.ID != "doc_1" {
			t.Fatalf("unexpected event %#v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}

	cancel()
	hub.Publish("u1", "doc_1", Event{Type: "updated", ID: "doc_1"})
}

func TestHubIsolatesUsers(t *testing.T) {
	hub := NewHub()
	ch, cancel := hub.Subscribe("u1", "doc_1")
	defer cancel()

	hub.Publish("u2", "doc_1", Event{Type: "updated", ID: "doc_1"})

	select {
	case ev := <-ch:
		t.Fatalf("received other user's event %#v", ev)
	case <-time.After(30 * time.Millisecond):
	}
}

func TestHubCloseEndsStreams(t *testing.T) {
	hub := NewHub()
	ch, cancel := hub.Subscribe("u1", "chats")

	hub.Close()
	if _, open := <-ch; open {
		t.Fatal("stream still open after Close")
	}
	cancel() // already closed: must not panic
	hub.Publish("u1", "chats", Event{Type: "changed"})

	late, lateCancel := hub.Subscribe("u1", "chats")
	defer lateCancel()
	if _, open := <-late; open {
		t.Fatal("Subscribe after Close returned an open stream")
	}
}
