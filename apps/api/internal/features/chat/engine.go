package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// AgentEngine runs a chat's plan turns on the agent engine (a Hermes
// worker, ADR 0026), the only chat engine (ADR 0029). The lane that claims
// a plan turn hands it to Start; from then on the engine's follower owns the
// run: it renews the lease (renewLease), answers tool calls (toolCall,
// prepareAgentProposal) and ends the turn with finishTurn. Timely data still
// changes only through a proposal and the model-free apply (ADR 0007), which
// stays lane work with the receipt phases (runner.go runLane). Photo chats
// send their photos with the turn; Sensitive chats run no-persist.
type AgentEngine interface {
	// Available says why this chat cannot run now (nil = it can): runtime
	// missing, a worktree without DB_SCHEMA, a provider the engine cannot
	// use. c is nil when Settings asks for the account as a whole.
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

// SetAgentEngine sets the engine chat runs on. Without one every plan turn
// fails with "agent runtime missing"; nothing falls back.
func (s *Service) SetAgentEngine(e AgentEngine) { s.engine = e }

// errNoEngine is the reason chat cannot run when the API has no agent
// runtime.
var errNoEngine = errors.New("agent runtime missing")

// engineAvailable is why the account (c nil) or chat cannot run on the
// agent engine now, or nil.
func (s *Service) engineAvailable(ctx context.Context, uid string, c *Conversation) error {
	if s.engine == nil {
		return errNoEngine
	}
	return s.engine.Available(ctx, uid, c)
}

// startAgentRun hands a claimed plan turn to the agent engine. An unusable
// provider needs Settings; an engine that cannot run this chat fails it
// with the reason.
func (s *Service) startAgentRun(ctx context.Context, c *Conversation, providerErr error) error {
	if providerErr != nil {
		return NeedsSettings(providerErr.Error())
	}
	if err := s.engineAvailable(ctx, c.UserID, c); err != nil {
		return agentUnavailable(c, err.Error())
	}
	return s.engine.Start(ctx, c)
}

// agentUnavailable is the failure of a turn the agent engine cannot run:
// the reason, and Try again (a runtime that comes back runs it).
func agentUnavailable(c *Conversation, reason string) error {
	return fmt.Errorf(tr(c.Language, txtAgentUnavailable), strings.TrimRight(reason, "."))
}

// lostAgentRun handles a claimed agent run whose lease expired.
func (s *Service) lostAgentRun(ctx context.Context, c *Conversation) error {
	if s.engine == nil {
		return errors.New(tr(c.Language, txtAgentLost))
	}
	return s.engine.Lost(ctx, c)
}
