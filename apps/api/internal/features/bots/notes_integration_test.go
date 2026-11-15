package bots

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func noteBot(t *testing.T, db *gorm.DB, uid string) string {
	t.Helper()
	id := "bot_" + uuid.NewString()
	b := Bot{ID: id, UserID: uid, Name: "Notes " + id, Origin: OriginApp, Status: StatusActive, JudgeMode: JudgeRules,
		IntervalSeconds: 900, NextCheckAt: &botNow, Kind: KindWatch, Health: "new", Engine: EngineAgent, Prompt: "p", Gate: GateAlways, Permission: PermissionAuto}
	must(t, db.Create(&b).Error)
	return b.ID
}

func TestIntegrationNotesStore(t *testing.T) {
	db := migratedDB(t)
	ctx := context.Background()
	uid, other := addUser(t, db), addUser(t, db)
	bot, otherBot := noteBot(t, db, uid), noteBot(t, db, other)
	n := NewNotesStore(db)

	if _, ok, err := n.Get(ctx, uid, bot, "price"); err != nil || ok {
		t.Fatalf("Get of nothing: ok %v, err %v", ok, err)
	}
	must(t, n.Set(ctx, uid, bot, "price", "89999"))
	must(t, n.Set(ctx, uid, bot, "alerted", "yes"))
	if v, ok, err := n.Get(ctx, uid, bot, "price"); err != nil || !ok || v != "89999" {
		t.Fatalf("Get: %q %v %v", v, ok, err)
	}
	must(t, n.Set(ctx, uid, bot, "price", "88999")) // replaces
	list, err := n.List(ctx, uid, bot)
	if err != nil || len(list) != 2 || list[0].Key != "alerted" || list[1].Key != "price" || list[1].Value != "88999" {
		t.Fatalf("List: %+v %v", list, err)
	}
	if m, err := n.Map(ctx, uid, bot); err != nil || m["price"] != "88999" || m["alerted"] != "yes" {
		t.Fatalf("Map: %v %v", m, err)
	}

	// Another person's Bot is not reachable, by id or by owner.
	if err := n.Set(ctx, other, bot, "x", "y"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Errorf("Set on another's Bot: %v", err)
	}
	if _, ok, _ := n.Get(ctx, other, bot, "price"); ok {
		t.Error("another person read the note")
	}
	if err := n.Delete(ctx, other, bot, "price"); !errors.Is(err, ErrNoNote) {
		t.Errorf("Delete as another person: %v", err)
	}
	must(t, n.Set(ctx, other, otherBot, "price", "1"))
	if v, _, _ := n.Get(ctx, uid, bot, "price"); v != "88999" {
		t.Errorf("a note leaked across Bots: %q", v)
	}

	must(t, n.Delete(ctx, uid, bot, "alerted"))
	if err := n.Delete(ctx, uid, bot, "alerted"); !errors.Is(err, ErrNoNote) {
		t.Errorf("second Delete: %v", err)
	}
}

func TestIntegrationNotesCaps(t *testing.T) {
	db := migratedDB(t)
	ctx := context.Background()
	uid := addUser(t, db)
	bot := noteBot(t, db, uid)
	n := NewNotesStore(db)

	if err := n.Set(ctx, uid, bot, strings.Repeat("k", MaxNoteKeyChars+1), "v"); !errors.Is(err, ErrNoteKey) && err != ErrNoteKey {
		t.Errorf("long key: %v", err)
	}
	if err := n.Set(ctx, uid, bot, "big", strings.Repeat("v", MaxNoteValueBytes+1)); err != ErrNoteValue {
		t.Errorf("big value: %v", err)
	}
	if _, ok, _ := n.Get(ctx, uid, bot, "big"); ok {
		t.Error("a refused value was stored")
	}

	// Fill the notepad with 16 KB notes: key "a0".."a2" take 3 x (2 + 16384),
	// the fourth takes it to 65,544 bytes, past 64 KB.
	full := strings.Repeat("x", MaxNoteValueBytes)
	for _, k := range []string{"a0", "a1", "a2"} {
		must(t, n.Set(ctx, uid, bot, k, full))
	}
	if err := n.Set(ctx, uid, bot, "a3", full); err != ErrNotepadFull {
		t.Fatalf("a fourth 16 KB note: %v", err)
	}
	if _, ok, _ := n.Get(ctx, uid, bot, "a3"); ok {
		t.Error("a refused note was stored")
	}
	// Room is left for a small one, and replacing a note counts only its new size.
	must(t, n.Set(ctx, uid, bot, "a3", strings.Repeat("y", 16000)))
	must(t, n.Set(ctx, uid, bot, "a0", "short"))
	// Delete frees the room.
	must(t, n.Delete(ctx, uid, bot, "a1"))
	must(t, n.Set(ctx, uid, bot, "a4", full))

	// Exactly at the cap is allowed, one byte over is not.
	bot2 := noteBot(t, db, uid)
	for _, k := range []string{"b0", "b1", "b2"} {
		must(t, n.Set(ctx, uid, bot2, k, full))
	}
	room := MaxNotepadBytes - 3*(2+MaxNoteValueBytes) // bytes left for the last note
	must(t, n.Set(ctx, uid, bot2, "b3", strings.Repeat("z", room-2)))
	if err := n.Set(ctx, uid, bot2, "b4", ""); err != ErrNotepadFull {
		t.Errorf("past the cap: %v", err)
	}
	if err := n.Set(ctx, uid, bot2, "b3", strings.Repeat("z", room-1)); err != ErrNotepadFull {
		t.Errorf("one byte over: %v", err)
	}

	// A Bot's notes go when it does.
	must(t, db.Delete(&Bot{}, "id = ?", bot2).Error)
	if list, _ := n.List(ctx, uid, bot2); len(list) != 0 {
		t.Errorf("notes outlived the Bot: %d", len(list))
	}
}
