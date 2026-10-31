package chat

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"timely-api/internal/realtime"
)

func TestIntegrationChatChangesReachWatchers(t *testing.T) {
	db := integrationDB(t)
	migration, err := os.ReadFile("../../../migrations/20261031090000_chat_change_notify.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(strings.Split(string(migration), "-- +goose Down")[0]).Error; err != nil {
		t.Fatal(err)
	}
	live := realtime.NewHub()
	s := New(db, nil, nil)
	s.SetLive(live)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.relayChanges(ctx)
	mine, stopMine := live.Subscribe("user-a", watchKey)
	defer stopMine()
	theirs, stopTheirs := live.Subscribe("user-b", watchKey)
	defer stopTheirs()

	next := func(within time.Duration) (realtime.Event, bool) {
		select {
		case ev := <-mine:
			return ev, true
		case <-time.After(within):
			return realtime.Event{}, false
		}
	}
	c := runFixture(t, db, nil)
	// The listener starts in the background; touch the chat until it hears.
	for deadline := time.Now().Add(5 * time.Second); ; {
		if ev, ok := next(100 * time.Millisecond); ok {
			if ev.Type != "changed" || ev.ID != c.ID {
				t.Fatalf("unexpected event %#v", ev)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no change event for a new chat")
		}
		db.Model(&Conversation{}).Where("id = ?", c.ID).UpdateColumn("title", "Touched "+time.Now().String())
	}
	for {
		if _, ok := next(300 * time.Millisecond); !ok {
			break
		}
	}

	// keepLease renews every few seconds while a run works; nobody sees it.
	if err := db.Model(&Conversation{}).Where("id = ?", c.ID).UpdateColumn("lease_until", time.Now().Add(3*time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if ev, ok := next(300 * time.Millisecond); ok {
		t.Fatalf("lease renewal sent %#v", ev)
	}
	if err := db.Model(&Conversation{}).Where("id = ?", c.ID).UpdateColumn("status", "idle").Error; err != nil {
		t.Fatal(err)
	}
	if ev, ok := next(2 * time.Second); !ok || ev.ID != c.ID {
		t.Fatalf("status change: got %#v, %v", ev, ok)
	}
	// A rolled-back transaction (proposal rehearsal) announces nothing.
	tx := db.Begin()
	tx.Model(&Conversation{}).Where("id = ?", c.ID).UpdateColumn("status", "running")
	tx.Rollback()
	if ev, ok := next(300 * time.Millisecond); ok {
		t.Fatalf("rolled-back change sent %#v", ev)
	}
	if err := db.Delete(&Conversation{}, "id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ev, ok := next(2 * time.Second); !ok || ev.ID != c.ID {
		t.Fatalf("delete: got %#v, %v", ev, ok)
	}
	select {
	case ev := <-theirs:
		t.Fatalf("another account heard %#v", ev)
	default:
	}
}
