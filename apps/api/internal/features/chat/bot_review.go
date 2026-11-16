package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/bots"
)

// Feedback reviews and Bot skill deletes on the agent engine (phase 7,
// PROTOCOL.md 14.2 and 14.3): BotAgent implements bots.Reviewer. A review
// is one bot.review on the account's worker, answered by learning.result;
// what it stages reaches Timely as "learning" messages with the Bot's id
// (the learning feature records them), so the answer is only the ids.

const (
	typeBotReview = "bot.review"
	typeBotForget = "bot.forget"
	// botReviewDeadline is a review's wall clock (the worker's default);
	// Go waits botGrace more for its answer.
	botReviewDeadline = 5 * time.Minute
	// botForgetWait bounds a skill delete, the worker's start included.
	botForgetWait = 2 * time.Minute
)

var _ bots.Reviewer = (*BotAgent)(nil)

// Review implements bots.Reviewer: one bot.review on the Bot's model.
func (a *BotAgent) Review(ctx context.Context, userID string, in bots.ReviewInput) (bots.ReviewResult, error) {
	if !bots.ValidSkillSlug(in.SkillSlug) {
		return bots.ReviewResult{}, fmt.Errorf("the bot has no skill name (%q)", in.SkillSlug)
	}
	if a.e.sup == nil {
		return bots.ReviewResult{}, errNoEngine
	}
	model, choice, err := a.model(ctx, userID, in.Model)
	if err != nil {
		return bots.ReviewResult{}, err
	}
	ensureCtx, cancelEnsure := context.WithTimeout(ctx, 2*time.Minute)
	w, err := a.e.sup.Ensure(ensureCtx, userID)
	cancelEnsure()
	if err != nil {
		return bots.ReviewResult{}, fmt.Errorf("no agent worker: %s", workerReason(err))
	}
	release := w.Hold()
	defer release()
	// The gateway's grant lasts as long as its worker: resolve again for this one.
	if again, _, err := a.model(ctx, userID, choice); err == nil {
		model = again
	}
	messages := in.Messages
	if messages == nil {
		messages = []json.RawMessage{}
	}
	feedback := in.Feedback
	if feedback != bots.FeedbackUseful {
		feedback = bots.FeedbackNotUseful
	}
	fields := map[string]any{
		"bot_id": in.BotID, "bot_name": in.BotName, "skill_slug": in.SkillSlug, "check_id": in.CheckID,
		"prompt": in.Prompt, "messages": messages, "focus": in.Focus, "feedback": feedback, "model": model,
		"deadline_s": int(botReviewDeadline / time.Second),
	}
	rctx, cancel := context.WithTimeout(ctx, botReviewDeadline+botGrace)
	defer cancel()
	data, err := learningResult(w.Request(rctx, typeBotReview, fields))
	if err != nil {
		return bots.ReviewResult{}, err
	}
	var body struct {
		PendingIDs []string `json:"pending_ids"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return bots.ReviewResult{}, fmt.Errorf("the agent's review answer could not be read: %w", err)
	}
	return bots.ReviewResult{PendingIDs: body.PendingIDs}, nil
}

// Forget implements bots.Reviewer: bot.forget deletes the Bot skill.
func (a *BotAgent) Forget(ctx context.Context, userID, slug string) error {
	if !bots.ValidSkillSlug(slug) {
		return nil
	}
	if a.e.sup == nil {
		return errNoEngine
	}
	ctx, cancel := context.WithTimeout(ctx, botForgetWait)
	defer cancel()
	w, err := a.e.sup.Ensure(ctx, userID)
	if err != nil {
		return fmt.Errorf("no agent worker: %s", workerReason(err))
	}
	release := w.Hold()
	defer release()
	_, err = learningResult(w.Request(ctx, typeBotForget, map[string]any{"skill_slug": slug}))
	return err
}

// errReviewFailed is a review the worker ended before it staged anything.
var errReviewFailed = errors.New("the feedback review failed")

// learningResult reads a learning.result answer: its data, or the failure.
func learningResult(m agenthost.Message, err error) (json.RawMessage, error) {
	if err != nil {
		return nil, err
	}
	if m.Type != agenthost.TypeLearningResult {
		return nil, fmt.Errorf("the agent answered %s instead of a result", clip(m.Type, 40))
	}
	var res struct {
		OK      bool            `json:"ok"`
		Data    json.RawMessage `json:"data"`
		Message string          `json:"message"`
	}
	if err := m.Decode(&res); err != nil {
		return nil, err
	}
	if !res.OK {
		var data struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(res.Data, &data)
		why := data.Message
		if why == "" {
			why = res.Message
		}
		return nil, fmt.Errorf("%w: %s", errReviewFailed, clip(why, 300))
	}
	if len(res.Data) == 0 {
		return json.RawMessage("{}"), nil
	}
	return res.Data, nil
}
