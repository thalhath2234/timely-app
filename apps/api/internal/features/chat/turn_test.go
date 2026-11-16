package chat

import (
	"context"
	"encoding/json"
	"errors"
)

// playTurn plays one agent-engine turn of c without a worker, the way the
// engine's follower answers it (engine_agent.go toolCall and done): the
// service's provider stands in for the worker's model, each tool call it
// makes goes through toolCall, a propose_changes through
// prepareAgentProposal (a recorded proposal ends the turn), and the turn
// ends with finishTurn. The model reads the turn's input (turnInput) and
// then every tool result as a tool message, so a test can read what each
// call returned from the model's last request.
func playTurn(ctx context.Context, s *Service, c *Conversation) error {
	toolCtx, run := s.newToolRun(ctx, c)
	run.load(c, "run_test")
	run.web.on = c.WebSearch && !c.Sensitive && !run.answerOnly
	messages := []WireMessage{{Role: "user", Content: s.turnInput(ctx, c)}}
	for i := 0; i < 20; i++ {
		response, err := s.complete(ctx, messages, nil, false)
		if err != nil {
			return err
		}
		if len(response.ToolCalls) == 0 {
			return s.finishTurn(ctx, c, response.Content, nil, run)
		}
		messages = append(messages, response)
		var pending *pendingProposal
		for _, call := range response.ToolCalls {
			args := json.RawMessage(call.Function.Arguments)
			var result json.RawMessage
			switch {
			case call.Function.Name == "propose_changes" && !run.answerOnly && pending != nil:
				result = raw(map[string]string{"error": proposalTwice})
			case call.Function.Name == "propose_changes" && !run.answerOnly:
				p, refusal := s.prepareAgentProposal(toolCtx, c, run, args, len(response.ToolCalls))
				if p == nil {
					result = refusal
				} else {
					pending, result = p, raw(map[string]any{"recorded": true, "message": proposalRecorded})
				}
			default:
				if result, _, err = s.toolCall(toolCtx, c, run, call.Function.Name, args); err != nil {
					return err
				}
			}
			messages = append(messages, WireMessage{Role: "tool", ToolCallID: call.ID, Content: string(result)})
		}
		if pending != nil {
			// end_turn: the proposal ends the turn (Q-2.4).
			return s.finishTurn(ctx, c, "", pending, run)
		}
	}
	return errors.New("the turn did not end")
}
