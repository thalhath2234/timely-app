package chat

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// AgentEngine runs a chat's plan turns on the agent engine (a Hermes
// worker, ADR 0026) instead of the classic loop in plan(). The lane that
// claims a row decides the engine (runEngine) and hands an agent turn to
// Start; from then on the engine's follower owns the run: it renews the
// lease (renewLease), answers tool calls (toolCall, prepareAgentProposal)
// and ends the turn with finishTurn, the same checkpoint classic uses.
// Timely data still changes only through a proposal and the model-free
// apply (ADR 0007). Photo chats, apply and Sensitive chats never reach it
// (Sensitive ones only as no-persist runs while the test-only switch is on).
type AgentEngine interface {
	// Available says why this chat cannot use the agent engine now (nil =
	// it can): runtime missing, a worktree without DB_SCHEMA, a CLI
	// provider. c is nil when Settings asks for the account as a whole.
	Available(ctx context.Context, uid string, c *Conversation) error
	// Start sends run.start for a claimed row whose lease the lane holds and
	// returns as soon as the worker accepted it. From then on the engine's
	// follower renews the lease and writes every checkpoint; the lane goes
	// back to claiming (Q-2.3: no Timely cap, so no lane is held). An error
	// fails the run with its action (failure.go).
	Start(ctx context.Context, c *Conversation) error
	// Lost handles a claimed agent row whose lease expired (c carries the
	// new lease): re-attach when this process still follows the run, else
	// return an error, which fails the run with Try again (txtAgentLost).
	Lost(ctx context.Context, c *Conversation) error
	// Stop ends a live run after Stop or Delete committed.
	Stop(uid, cid, runID string)
	// Steer passes a message the person typed into a live run.
	Steer(ctx context.Context, uid, cid, runID, text string) error
	// Forget drops the chat's session in the worker after Delete.
	Forget(uid, cid string)
	// Answer passes the person's answer to a question card (clarify.answer,
	// phase 4) once the fenced answer committed (answerQuestion). An error
	// means the run no longer waits for it.
	Answer(ctx context.Context, uid, cid, runID, requestID string, answers map[string]any, outcome string) error
}

// draftReader is an engine that can say how much of a live run's reply it
// has streamed (the row's activity.draft lags it by up to the activity
// throttle). Stop keeps that text as the reply.
type draftReader interface {
	Draft(uid, cid, runID string) string
}

// SetAgentEngine lets chats run on the agent engine. Without one, a chat set
// to the agent engine fails with "Use classic for this chat", never
// switching engines silently.
func (s *Service) SetAgentEngine(e AgentEngine) { s.engine = e }

// errNoEngine is the reason the agent engine is unavailable when the API
// runs without one.
var errNoEngine = errors.New("not available")

// engineAvailable is why the account (c nil) or chat cannot use the agent
// engine now, or nil.
func (s *Service) engineAvailable(ctx context.Context, uid string, c *Conversation) error {
	if s.engine == nil {
		return errNoEngine
	}
	return s.engine.Available(ctx, uid, c)
}

// runEngine is the engine a freshly claimed run uses: classic for photo
// chats (photo phases, and plan turns of a chat holding photos), apply and
// Sensitive chats (Q-4.2: unless sensitiveNoPersist, the test-only
// no-persist switch); else the chat's own choice, else the account's
// (Classic until the person picks New). It reads the account setting inside
// the claim transaction, in a savepoint so a missing row or table leaves the
// claim intact.
func runEngine(tx *gorm.DB, c *Conversation, sensitiveNoPersist bool) string {
	if c.Phase != "plan" || holdsPhotos(c) || (c.Sensitive && !sensitiveNoPersist) {
		return engineClassic
	}
	if c.Engine == engineClassic || c.Engine == engineAgent {
		return c.Engine
	}
	engine := engineClassic
	_ = tx.Transaction(func(sp *gorm.DB) error {
		var prefs AgentChatSettings
		if err := sp.Where("user_id = ?", c.UserID).Limit(1).Find(&prefs).Error; err != nil {
			return err
		}
		if prefs.Engine == engineAgent {
			engine = engineAgent
		}
		return nil
	})
	return engine
}

// holdsPhotos reports a chat with photos: a receipt or image review, or a
// message that attached images. Photo chats stay on classic (Q-4.2).
func holdsPhotos(c *Conversation) bool {
	if c.ImageReview != nil {
		return true
	}
	for _, m := range c.Messages {
		if len(m.ImageIDs) > 0 {
			return true
		}
	}
	return false
}

// startAgentRun hands a claimed plan turn to the agent engine. An unusable
// provider needs Settings as on classic; an engine that cannot run this chat
// fails it with "Use classic for this chat" and the reason.
func (s *Service) startAgentRun(ctx context.Context, c *Conversation, providerErr error) error {
	if providerErr != nil {
		return NeedsSettings(providerErr.Error())
	}
	if err := s.engineAvailable(ctx, c.UserID, c); err != nil {
		return UseClassic(fmt.Sprintf(tr(c.Language, txtAgentUnavailable), err.Error()))
	}
	return s.engine.Start(ctx, c)
}

// lostAgentRun handles a claimed agent run whose lease expired.
func (s *Service) lostAgentRun(ctx context.Context, c *Conversation) error {
	if s.engine == nil {
		return errors.New(tr(c.Language, txtAgentLost))
	}
	return s.engine.Lost(ctx, c)
}
