package chat

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// brokenErrorCompleters fails every run with a provider error that Postgres
// cannot store as it is: a character cut in half and a NUL.
type brokenErrorCompleters struct{ calls chan struct{} }

func (b *brokenErrorCompleters) Resolve(context.Context, string) (string, string, error) {
	return "anthropic", "test-model", nil
}
func (b *brokenErrorCompleters) Completer(context.Context, string, string, string) (Completer, error) {
	b.calls <- struct{}{}
	return nil, errors.New("Anthropic API returned HTTP 400: " + strings.Repeat("x", 299) + "\xc3 cut, nul \x00 here")
}

// A provider error with invalid UTF-8 or a NUL used to make the failure
// checkpoint fail, so the run stayed 'running' and was sent again every time
// its lease ran out.
func TestIntegrationUnstorableProviderErrorStillFailsTheRun(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	completers := &brokenErrorCompleters{calls: make(chan struct{}, 4)}
	s.SetCompleters(completers)
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Test", Status: "queued", Phase: "plan", Context: []ContextChip{}, Messages: []Message{{Role: "user", Content: "hi"}}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if err := db.Create(&c).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.work(ctx)
	select {
	case <-completers.calls:
	case <-time.After(10 * time.Second):
		t.Fatal("run not claimed")
	}
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if db.First(&c, "id = ?", c.ID); c.Status != "running" {
			break
		}
	}
	if c.Status != "failed" {
		t.Fatalf("run status %q, want failed", c.Status)
	}
	if !utf8.ValidString(c.Error) || strings.ContainsRune(c.Error, 0) || !strings.HasPrefix(c.Error, "Anthropic API returned HTTP 400: xxx") {
		t.Fatalf("saved error %q", c.Error)
	}
}

// failPlainly is the last resort when even the cleaned failure cannot be
// saved: it changes only the status columns and leaves other workers' runs
// alone.
func TestIntegrationFailPlainlyEndsTheRun(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	c := runFixture(t, db, []Step{})
	if err := s.failPlainly(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	var row Conversation
	db.First(&row, "id = ?", c.ID)
	if row.Status != "failed" || row.Error != runFailedUnsaved || !row.Unread || row.Revision != c.Revision+1 {
		t.Fatalf("got status %q error %q unread %v revision %d", row.Status, row.Error, row.Unread, row.Revision)
	}

	other := runFixture(t, db, []Step{})
	stale := other
	stale.Lease = "someone-else"
	if err := s.failPlainly(context.Background(), &stale); err != nil {
		t.Fatal(err)
	}
	var kept Conversation
	db.First(&kept, "id = ?", other.ID)
	if kept.Status != "running" {
		t.Fatalf("a run held by another lease was changed to %q", kept.Status)
	}
}
