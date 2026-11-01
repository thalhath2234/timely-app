package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/agent"
)

// A live block's AI call (its tool's Prepare) runs before the step's
// transaction: Stop answers while the AI is still writing and nothing is
// added, and a transaction retried after a conflict reuses the answer.
func TestIntegrationPreparedStepHoldsNoLock(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	type programKey struct{}
	started, release := make(chan struct{}, 1), make(chan struct{})
	prepares, calls, conflict := 0, 0, false
	s.factory = func(tx *gorm.DB) agent.Catalog {
		return agent.Catalog{"add_live_block": {
			Prepare: func(ctx context.Context, _ string, _ json.RawMessage) (context.Context, error) {
				prepares++
				started <- struct{}{}
				<-release
				return context.WithValue(ctx, programKey{}, "program"), nil
			},
			Call: func(ctx context.Context, _ string, _ json.RawMessage) (any, error) {
				calls++
				if ctx.Value(programKey{}) != "program" {
					return nil, fmt.Errorf("the write did not get the prepared program")
				}
				if conflict {
					conflict = false
					return nil, &pgconn.PgError{Code: "40001"}
				}
				item := testItem{ID: id("item_"), Value: "block"}
				return item, tx.Create(&item).Error
			},
		}}
	}
	steps := []Step{{Tool: "add_live_block", Summary: "Add a live block", Arguments: raw(map[string]string{"docId": "doc_1", "words": "overdue tasks"}), Status: "pending"}}

	c := runFixture(t, db, steps)
	done := make(chan error, 1)
	go func() { done <- s.apply(context.Background(), &c) }()
	<-started
	// Stop takes the conversation's lock, as POST /chats/:id/stop does.
	stopped := make(chan error, 1)
	go func() {
		stopped <- db.Transaction(func(tx *gorm.DB) error {
			var row Conversation
			if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), c.UserID, c.ID, &row); err != nil {
				return err
			}
			row.Status, row.Lease, row.LeaseUntil = "stopped", "", nil
			return tx.Save(&row).Error
		})
	}()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("Stop waited for the AI to answer")
	}
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("the stopped apply ends without writing: %v", err)
	}
	var count int64
	db.Model(&testItem{}).Count(&count)
	var row Conversation
	db.First(&row, "id = ?", c.ID)
	if count != 0 || calls != 0 || row.Plan[0].Status == "done" || row.Status != "stopped" {
		t.Fatalf("Stop keeps the block out: %d writes, %d calls, step %s, chat %s", count, calls, row.Plan[0].Status, row.Status)
	}

	// The first transaction loses a race; the retry writes with the same answer.
	prepares, conflict = 0, true
	c = runFixture(t, db, steps)
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	<-started
	db.Model(&testItem{}).Count(&count)
	if prepares != 1 || calls != 2 || count != 1 || c.Plan[0].Status != "done" {
		t.Fatalf("one AI answer for a retried step: %d prepares, %d calls, %d writes, step %s", prepares, calls, count, c.Plan[0].Status)
	}
}
