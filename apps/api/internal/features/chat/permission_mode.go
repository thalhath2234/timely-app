package chat

import (
	"encoding/json"

	"timely-api/internal/features/agent"
)

// Permission modes for Timely data (plan 5.5b, phase 2), the same rule on
// both engines. Supervised holds every proposal for Approve. Auto and Full
// Access apply a proposal at once (status queued, phase apply, shown as
// applied with Undo) unless something below holds it; in phase 2 Full
// Access lifts nothing more than Auto for Timely data. The model's direct
// flag no longer decides anything. A switch to a looser mode never
// approves a card already waiting (nothing here touches one); a stricter
// mode holds the next proposal, because the decision reads the stored row
// when the turn ends.

// Why a proposal is held, for tests and logs.
const (
	heldSupervised = "supervised"
	heldSensitive  = "sensitive"
	heldReview     = "review"    // ForceReview: data changed, or a page was read this run
	heldTainted    = "tainted"   // the chat read outside sources (critical item 6)
	heldNotes      = "notes"     // Jev added review notes
	heldRecurring  = "recurring" // it edits a repeating series
	heldCritical   = "critical"  // a step is on the critical list
	heldAuthority  = "authority" // the tool's own floor (ADR 0007) asks for review
	heldNoUndo     = "no undo"   // Undo could not reverse it
)

// proposalStatus is the status a recorded proposal takes: "approval" when
// it waits for the person, else "queued" to apply at once. direct is the
// model's own flag, kept for the record; it decides nothing.
func proposalStatus(row *Conversation, steps []Step, direct bool, notes []string) string {
	_ = direct
	if holdReason(row, steps, notes) != "" {
		return "approval"
	}
	return "queued"
}

// holdReason is the first reason the proposal waits for Approve, or "" when
// the chat's mode lets it apply now.
func holdReason(row *Conversation, steps []Step, notes []string) string {
	mode, err := agent.ParseMode(row.Permission)
	if err != nil || mode == agent.Supervised {
		return heldSupervised
	}
	switch {
	case row.Sensitive:
		return heldSensitive
	case row.ForceReview:
		return heldReview
	case len(row.TaintedSources) > 0:
		return heldTainted
	case len(notes) > 0:
		return heldNotes
	case recurringEdit(steps):
		return heldRecurring
	}
	actions := make([]agent.Action, len(steps))
	planned := make([]agent.PlannedStep, len(steps))
	args := make([]map[string]any, len(steps))
	for i, step := range steps {
		_ = json.Unmarshal(step.Arguments, &args[i])
		actions[i] = agent.Action{Tool: step.Tool, Args: args[i], Tainted: len(row.TaintedSources) > 0}
		planned[i] = agent.PlannedStep{Tool: step.Tool, Arguments: step.Arguments, Before: step.Before}
	}
	if _, _, critical := agent.CriticalPlan(actions); mode.HoldsTimelyChange(critical) {
		return heldCritical
	}
	for i, step := range steps {
		// The per-tool floors of ADR 0007 stay whatever the mode.
		if authority, ok := agent.AuthorityOf(step.Tool); !ok || authority.NeedsProposal(args[i]) {
			return heldAuthority
		}
	}
	if !agent.UndoablePlan(planned) {
		return heldNoUndo
	}
	return ""
}
