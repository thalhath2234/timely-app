package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/bots"
)

// A Bot run may propose a Timely write (Q-B5). It waits on the alert as a
// Review card and nothing applies until the person approves it. Approval goes
// through chat's model-free apply (ADR 0007): the proposal becomes the plan of
// a chat of its own, tainted by the Bot, and runs through apply() with the
// same checks, receipt and Undo as any approved proposal. The alert's
// proposal_state follows: pending -> approved -> applied or failed, pending ->
// dismissed, applied -> undone. Every transition is idempotent and an invalid
// one is refused.

// The review actions a person takes.
const (
	reviewApprove = "approve"
	reviewDiscard = "discard"
)

// ReviewResult is where a Review card stands after an action.
type ReviewResult struct {
	// State is the alert's proposal_state.
	State string `json:"state"`
	// ConversationID is the chat that applied the proposal (the receipt, with
	// Undo through POST /chats/:id/undo and MessageID), "" before it applied.
	ConversationID string `json:"conversationId,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
	// Error says why an approved proposal could not be applied.
	Error string `json:"error,omitempty"`
}

// errReviewState is an action the card's state does not allow.
func errReviewState(state, action string) error {
	words := map[string]string{
		bots.ProposalApproved:  "approved",
		bots.ProposalApplied:   "applied",
		bots.ProposalDismissed: "turned down",
		bots.ProposalUndone:    "undone",
		bots.ProposalFailed:    "tried and could not be applied",
	}
	if state == "" {
		return echo.NewHTTPError(404, "This alert has no change to review")
	}
	return echo.NewHTTPError(409, fmt.Sprintf("This change was already %s; it can't be %sd", words[state], action))
}

// reviewTransition decides what an action does to a card in state: the state
// it moves to, or noop when the card already is where the action leads, or an
// error when the action does not fit. approved stays approvable, so an apply
// that a crash cut short is finished by approving again.
func reviewTransition(state, action string) (next string, noop bool, err error) {
	switch action {
	case reviewApprove:
		switch state {
		case bots.ProposalPending:
			return bots.ProposalApproved, false, nil
		case bots.ProposalApproved:
			return bots.ProposalApproved, false, nil // finish the apply
		case bots.ProposalApplied, bots.ProposalUndone:
			return state, true, nil
		}
	case reviewDiscard:
		switch state {
		case bots.ProposalPending:
			return bots.ProposalDismissed, false, nil
		case bots.ProposalDismissed:
			return state, true, nil
		}
	default:
		return "", false, echo.NewHTTPError(400, "Approve or discard")
	}
	return "", false, errReviewState(state, action)
}

// reviewChatID is the apply chat of an alert's proposal: one per alert, so
// approving twice never applies twice.
func reviewChatID(alertID string) string {
	return "chat_" + uuid.NewSHA1(uuid.NameSpaceOID, []byte("bot-review:"+alertID)).String()
}

// proposalOf reads a stored proposal as a chat proposal: {summary, steps:
// [{tool, summary, arguments}]}, or one step as {tool, args|arguments,
// summary}.
func proposalOf(stored json.RawMessage) (json.RawMessage, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(stored, &obj); err != nil || obj == nil {
		return nil, errors.New("The proposal is not readable")
	}
	if _, ok := obj["steps"]; ok {
		return stored, nil
	}
	var tool, summary string
	_ = json.Unmarshal(obj["tool"], &tool)
	_ = json.Unmarshal(obj["summary"], &summary)
	args := obj["arguments"]
	if len(args) == 0 {
		args = obj["args"]
	}
	if strings.TrimSpace(tool) == "" || len(args) == 0 {
		return nil, errors.New("The proposal names no change")
	}
	if strings.TrimSpace(summary) == "" {
		summary = tool
	}
	return raw(map[string]any{"summary": summary, "steps": []any{map[string]any{"tool": tool, "summary": summary, "arguments": json.RawMessage(args)}}}), nil
}

// reviewCard is an alert's proposal as the Bot thread shows it.
type reviewCard struct {
	State          string   `json:"state"`
	Summary        string   `json:"summary"`
	Steps          []string `json:"steps"`
	ConversationID string   `json:"conversationId,omitempty"`
	MessageID      string   `json:"messageId,omitempty"`
}

// cardOf is the Review card of alert a, nil when it has no proposal.
func cardOf(a bots.Alert) *reviewCard {
	if len(a.Proposal) == 0 || a.ProposalState == "" {
		return nil
	}
	card := &reviewCard{State: a.ProposalState, Steps: []string{}}
	norm, err := proposalOf(a.Proposal)
	if err != nil {
		return card
	}
	var p proposal
	if json.Unmarshal(lenientProposal(norm), &p) != nil {
		return card
	}
	card.Summary = clip(strings.TrimSpace(p.Summary), 300)
	for _, step := range p.Steps {
		card.Steps = append(card.Steps, clip(strings.TrimSpace(step.Summary), 200))
	}
	if a.ProposalState == bots.ProposalApplied || a.ProposalState == bots.ProposalUndone || a.ProposalState == bots.ProposalFailed {
		card.ConversationID = reviewChatID(a.ID)
	}
	return card
}

// ReviewAlert approves or discards the proposal of alert alertID.
func (s *Service) ReviewAlert(ctx context.Context, uid, alertID, action string) (ReviewResult, error) {
	var a bots.Alert
	db := s.db.WithContext(ctx)
	if err := db.Where("id = ? AND user_id = ?", alertID, uid).First(&a).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ReviewResult{}, echo.NewHTTPError(404, "Alert not found")
		}
		return ReviewResult{}, err
	}
	// The conversation of a card that is already applied may since have been
	// undone: look first, so a card is never shown applied after its Undo.
	a.ProposalState = s.syncUndone(ctx, a)
	next, noop, err := reviewTransition(a.ProposalState, action)
	if err != nil {
		return ReviewResult{}, err
	}
	if noop {
		return s.reviewResult(ctx, a.ID, next), nil
	}
	if action == reviewDiscard {
		return s.moveCard(ctx, a, bots.ProposalPending, next)
	}
	if a.ProposalState == bots.ProposalPending {
		if _, err := s.moveCard(ctx, a, bots.ProposalPending, bots.ProposalApproved); err != nil {
			return ReviewResult{}, err
		}
	}
	return s.applyProposal(ctx, a)
}

// moveCard moves the card from one state to another with a compare and swap,
// so two taps cannot both win; the loser reads where the card went.
func (s *Service) moveCard(ctx context.Context, a bots.Alert, from, to string) (ReviewResult, error) {
	res := s.db.WithContext(ctx).Model(&bots.Alert{}).Where("id = ? AND user_id = ? AND proposal_state = ?", a.ID, a.UserID, from).
		Update("proposal_state", to)
	if res.Error != nil {
		return ReviewResult{}, res.Error
	}
	if res.RowsAffected == 0 {
		var cur bots.Alert
		if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", a.ID, a.UserID).First(&cur).Error; err != nil {
			return ReviewResult{}, err
		}
		if cur.ProposalState == to {
			return s.reviewResult(ctx, a.ID, to), nil
		}
		action := reviewApprove
		if to == bots.ProposalDismissed {
			action = reviewDiscard
		}
		return ReviewResult{}, errReviewState(cur.ProposalState, action)
	}
	return s.reviewResult(ctx, a.ID, to), nil
}

// reviewResult is the card's result in state, with the apply chat when there is
// one.
func (s *Service) reviewResult(ctx context.Context, alertID, state string) ReviewResult {
	out := ReviewResult{State: state}
	if state != bots.ProposalApplied && state != bots.ProposalUndone && state != bots.ProposalFailed {
		return out
	}
	var row Conversation
	if err := s.db.WithContext(ctx).Select("id", "messages").Where("id = ?", reviewChatID(alertID)).Limit(1).Find(&row).Error; err != nil || row.ID == "" {
		return out
	}
	out.ConversationID = row.ID
	if m := latestProposal(row.Messages); m != nil {
		out.MessageID = m.ID
	}
	return out
}

// syncUndone moves an applied card to undone when its Undo has run (the apply
// chat's proposal message carries UndoneAt), and returns the card's state.
func (s *Service) syncUndone(ctx context.Context, a bots.Alert) string {
	if a.ProposalState != bots.ProposalApplied {
		return a.ProposalState
	}
	var row Conversation
	if err := s.db.WithContext(ctx).Select("id", "messages").Where("id = ?", reviewChatID(a.ID)).Limit(1).Find(&row).Error; err != nil || row.ID == "" {
		return a.ProposalState
	}
	if m := latestProposal(row.Messages); m != nil && m.UndoneAt != nil {
		res := s.db.WithContext(ctx).Model(&bots.Alert{}).Where("id = ? AND proposal_state = ?", a.ID, bots.ProposalApplied).Update("proposal_state", bots.ProposalUndone)
		if res.Error == nil {
			return bots.ProposalUndone
		}
	}
	return a.ProposalState
}

// applyProposal applies an approved alert's proposal through the model-free
// apply and records applied or failed on the card.
func (s *Service) applyProposal(ctx context.Context, a bots.Alert) (ReviewResult, error) {
	cid := reviewChatID(a.ID)
	var existing Conversation
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", cid, a.UserID).Limit(1).Find(&existing).Error; err != nil {
		return ReviewResult{}, err
	}
	if existing.ID != "" {
		// An earlier approval got this far: its chat decides the card.
		return s.settleCard(ctx, a, existing), nil
	}
	fail := func(reason string) (ReviewResult, error) {
		res, err := s.moveCard(ctx, a, bots.ProposalApproved, bots.ProposalFailed)
		res.Error = reason
		return res, err
	}
	stored, err := proposalOf(a.Proposal)
	if err != nil {
		return fail(err.Error())
	}
	catalog := s.factory(s.db.WithContext(ctx))
	p, snapshots, err := s.prepareProposal(ctx, catalog, a.UserID, stored, map[string]string{})
	if err != nil {
		return fail(clip(err.Error(), 400))
	}
	var botName string
	_ = s.db.WithContext(ctx).Model(&bots.Bot{}).Where("id = ? AND user_id = ?", a.BotID, a.UserID).Pluck("name", &botName).Error
	lease := id("lease_")
	until := time.Now().UTC().Add(3 * time.Minute)
	botID := a.BotID
	summary := message("assistant", p.Summary)
	summary.Proposal, summary.AutoApplied = true, true
	from := notice(clip(fmt.Sprintf("From %s's alert: %s. You approved this change.", orDefault(botName, "a bot"), a.Title), 300))
	row := Conversation{ID: cid, UserID: a.UserID, Title: clip("Review: "+a.Title, 200), Status: "running", Phase: "apply", Lease: lease, LeaseUntil: &until,
		Kind: KindChat, FromBotID: &botID, TaintedSources: TaintSources{{Kind: "bot", BotID: a.BotID}}, ForceReview: true,
		Permission: "supervised", HostGrants: HostGrants{}, Context: []ContextChip{}, Messages: []Message{from, summary},
		Plan: p.Steps, Snapshots: snapshots}
	res := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if res.Error != nil {
		return ReviewResult{}, res.Error
	}
	if res.RowsAffected == 0 {
		// Another tap made it first and applies it.
		if err := s.db.WithContext(ctx).Where("id = ?", cid).First(&existing).Error; err != nil {
			return ReviewResult{}, err
		}
		return s.settleCard(ctx, a, existing), nil
	}
	if err := s.apply(ctx, &row); err != nil {
		_ = s.checkpoint(ctx, &row, func(tx *gorm.DB, r *Conversation) error {
			r.Status, r.Error = "failed", clip(err.Error(), 400)
			return nil
		})
		return fail(clip(err.Error(), 400))
	}
	out, err := s.moveCard(ctx, a, bots.ProposalApproved, bots.ProposalApplied)
	if err != nil {
		return out, err
	}
	return s.reviewResult(ctx, a.ID, out.State), nil
}

// settleCard moves a card to what its apply chat says: applied once every step
// ran, failed when the chat failed, otherwise it stays approved.
func (s *Service) settleCard(ctx context.Context, a bots.Alert, row Conversation) ReviewResult {
	switch {
	case row.Status == "failed":
		res, _ := s.moveCard(ctx, a, bots.ProposalApproved, bots.ProposalFailed)
		res.Error = row.Error
		return res
	case row.Status == "idle" && !hasPending(row.Plan):
		res, _ := s.moveCard(ctx, a, bots.ProposalApproved, bots.ProposalApplied)
		if res.State == "" {
			res.State = bots.ProposalApplied
		}
		return s.reviewResult(ctx, a.ID, res.State)
	}
	return ReviewResult{State: bots.ProposalApproved}
}

func orDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}

// review answers POST /chat/bot-alerts/:alertId/review {action: "approve" |
// "discard"}.
func (s *Service) review(c *echo.Context) error {
	var in struct {
		Action string `json:"action"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	if user(c) == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	res, err := s.ReviewAlert(c.Request().Context(), user(c), c.Param("alertId"), strings.ToLower(strings.TrimSpace(in.Action)))
	if err != nil {
		return err
	}
	return c.JSON(200, res)
}
