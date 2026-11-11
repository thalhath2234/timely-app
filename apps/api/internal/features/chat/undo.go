package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/agent"
)

// Undo of a proposal Auto or Full Access applied without asking (plan 5.5b).
// The undo is itself a plan of the changes that put the data back
// (agent.InversePlan), queued through the same model-free, lease-fenced
// apply as an approved proposal. It is refused once anything it would
// change reads differently from when the proposal finished applying, and
// a proposal is undone at most once.

// inverseSteps is the undo plan of a proposal's applied steps, or false
// when one of them has no inverse or the catalog lacks a tool it needs.
func inverseSteps(catalog agent.Catalog, plan []Step) ([]Step, bool) {
	applied := []agent.AppliedStep{}
	for _, step := range plan {
		if step.Status == "done" {
			applied = append(applied, agent.AppliedStep{Tool: step.Tool, Arguments: step.Arguments, Result: step.Result, Before: step.Before})
		}
	}
	if len(applied) == 0 {
		return nil, false
	}
	inverse, ok := agent.InversePlan(applied)
	if !ok || len(inverse) == 0 {
		return nil, false
	}
	steps := make([]Step, len(inverse))
	for i, inv := range inverse {
		if catalog[inv.Tool].Call == nil || (!isWriteTool(inv.Tool) && !agent.UndoTool(inv.Tool)) {
			return nil, false
		}
		steps[i] = Step{Tool: inv.Tool, Summary: inv.Summary, Arguments: inv.Arguments, Status: "pending", Undo: true}
	}
	return steps, true
}

// noteUndoReads keeps, on the auto-applied proposal whose plan just finished
// applying, the reads of what its undo would change. It runs in apply's
// final checkpoint, inside its transaction.
func (s *Service) noteUndoReads(ctx context.Context, tx *gorm.DB, row *Conversation) {
	m := latestProposal(row.Messages)
	if m == nil || !m.AutoApplied || m.UndoneAt != nil || m.UndoReads != nil {
		return
	}
	catalog := s.factory(tx)
	steps, ok := inverseSteps(catalog, row.Plan)
	if !ok {
		return
	}
	reads, err := s.undoReads(ctx, tx, catalog, row.UserID, steps)
	if err != nil {
		return
	}
	m.UndoReads = reads
}

// undoLists are the reads that guard an undo step whose target the usual
// snapshots don't read: removing a habit or goal also removes the
// check-ins made since, so a changed list refuses the Undo.
var undoLists = map[string]string{"update_habit": "list_habits", "set_goal": "list_goals"}

// undoReads are an undo plan's snapshots plus the lists that guard its
// habit and goal removals.
func (s *Service) undoReads(ctx context.Context, tx *gorm.DB, catalog agent.Catalog, uid string, steps []Step) ([]Snapshot, error) {
	reads, err := s.snapshots(ctx, tx, catalog, uid, steps)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, step := range steps {
		tool, ok := undoLists[step.Tool]
		if !ok || seen[tool] {
			continue
		}
		seen[tool] = true
		if catalog[tool].Call == nil {
			return nil, fmt.Errorf("undo of %s cannot read %s", step.Tool, tool)
		}
		args := raw(map[string]any{})
		result, err := catalog[tool].Call(ctx, uid, args)
		if err != nil {
			return nil, err
		}
		reads = append(reads, Snapshot{Tool: tool, Arguments: args, Hash: hash(result)})
	}
	return reads, nil
}

// latestProposal is the conversation's newest proposal summary.
func latestProposal(messages []Message) *Message {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Proposal {
			return &messages[i]
		}
	}
	return nil
}

// appliedPlan is the plan a proposal message applied: the live plan for the
// newest proposal, else the archive that followed it.
func appliedPlan(row *Conversation, index int) []Step {
	if latestProposal(row.Messages) == &row.Messages[index] && len(row.Plan) > 0 {
		return row.Plan
	}
	for _, m := range row.Messages[index+1:] {
		if m.Proposal {
			return nil
		}
		if m.Kind == "archive" && len(m.Steps) > 0 {
			return m.Steps
		}
	}
	return nil
}

// undo answers POST /chats/:id/undo {revision, messageId}.
func (s *Service) undo(c *echo.Context) error {
	var in struct {
		Revision  int    `json:"revision"`
		MessageID string `json:"messageId"`
	}
	if err := c.Bind(&in); err != nil || in.MessageID == "" {
		return echo.NewHTTPError(400, "Invalid request")
	}
	ctx := c.Request().Context()
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if in.Revision != 0 && row.Revision != in.Revision {
			return echo.NewHTTPError(409, "This chat changed. Review the latest version first")
		}
		if busy(row) || row.Status == "approval" {
			return echo.NewHTTPError(409, "Wait for the current run or proposal before undoing")
		}
		index := -1
		for i := range row.Messages {
			if row.Messages[i].ID == in.MessageID {
				index = i
			}
		}
		if index < 0 || !row.Messages[index].Proposal || !row.Messages[index].AutoApplied {
			return echo.NewHTTPError(404, "There is no applied change to undo here")
		}
		if row.Messages[index].UndoneAt != nil {
			return echo.NewHTTPError(409, "This change was already undone")
		}
		catalog := s.factory(tx)
		steps, ok := inverseSteps(catalog, appliedPlan(row, index))
		if !ok || row.Messages[index].UndoReads == nil {
			return echo.NewHTTPError(409, "This change can't be undone")
		}
		now, err := s.undoReads(ctx, tx, catalog, row.UserID, steps)
		if err != nil || !sameReads(now, row.Messages[index].UndoReads) {
			return echo.NewHTTPError(409, "This changed after it was applied, so it can't be undone. Ask for the change you want instead")
		}
		if len(row.Plan) > 0 {
			archivePlan(row)
		}
		done := notice(tr(row.Language, txtUndone))
		at := time.Now().UTC()
		row.Messages[index].UndoneAt = &at
		row.Messages[index].UndoMessageID = done.ID
		row.Messages = append(row.Messages, done)
		row.Plan = steps
		row.Snapshots = now
		row.Phase = "apply"
		row.Status = "queued"
		row.Error = ""
		row.Unread = false
		return nil
	})
}

// sameReads reports whether two sets of reads saw the same objects alike.
func sameReads(a, b []Snapshot) bool {
	key := func(s Snapshot) string {
		var args any
		_ = json.Unmarshal(s.Arguments, &args)
		return s.Tool + string(raw(args))
	}
	seen := map[string]string{}
	for _, snap := range b {
		seen[key(snap)] = snap.Hash
	}
	if len(a) != len(b) {
		return false
	}
	for _, snap := range a {
		if hash, ok := seen[key(snap)]; !ok || hash != snap.Hash {
			return false
		}
	}
	return true
}
