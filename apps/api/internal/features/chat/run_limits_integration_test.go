package chat

import (
	"context"
	"fmt"
	"testing"
)

// After the last automatic batch the request pauses and says so, keeping
// what is left for "continue", instead of saying Done (GC18).
func TestIntegrationCappedRequestPausesInsteadOfDone(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	c := runFixture(t, db, []Step{{Tool: "create_task", Summary: "Chapter 10", Arguments: raw(map[string]string{"name": "Chapter 10"}), Status: "done"}})
	c.Messages = []Message{message("user", "Create a task for each chapter")}
	for i := 1; i < maxBatches; i++ {
		p := message("assistant", fmt.Sprintf("Create chapter %d", i))
		p.Proposal, p.Remaining = true, "The other chapters"
		n := notice(tr("", txtContinuing))
		n.Continue = "The other chapters"
		c.Messages = append(c.Messages, p, n)
	}
	last := message("assistant", "Create chapter 10")
	last.Proposal, last.Remaining = true, "Chapters 11 to 40"
	c.Messages = append(c.Messages, last)
	c.Phase, c.Status, c.Lease = "apply", "running", "test-lease"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	end := c.Messages[len(c.Messages)-1]
	if c.Status != "idle" || end.Content != fmt.Sprintf(tr("", txtPaused), maxBatches) || end.Continue != "Chapters 11 to 40" {
		t.Fatalf("status %q last %+v", c.Status, end)
	}
}
