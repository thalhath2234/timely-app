package chat

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"

	"timely-api/internal/features/agent"
)

// The prompt layout on the agent engine (plan 5.3): a Timely block that stays
// byte-identical from one message to the next in a conversation (the worker
// passes it as Hermes' ephemeral_system_prompt, PROTOCOL.md section 9.2, so
// the provider's cached prefix holds), and a per-turn user message
// (turnInput) with everything that changes.

// chatToolsets are the Hermes toolsets a phase 2 chat run enables (PROTOCOL.md
// section 9.7): Timely's own tools, the todo list and reading skills.
var chatToolsets = []string{"timely", "todo", "skills"}

// timelySkill points the model at the bundled timely skill, which the
// worker's skills index lists (plan 5.3).
const timelySkill = "\nThe timely skill (skill_view timely) holds Timely's own notes on working with the person's data; read it when you are unsure how a Timely object or tool works."

// timelyBlock is the conversation's Timely block: the instruction (without
// the scope line for the host-allowed account, Q-2.1), the client note, the
// reply-card kit, resolve_target's hint when it is offered, the write tool
// schemas and the timely skill pointer. Classic's web search line is absent:
// web tools arrive in phase 3. The write schemas are listed in answer-only
// turns too, so the block does not change when a message tags a Bot; the
// tools refuse every change in such a turn (toolCall).
func timelyBlock(c *Conversation, run *toolRun, hostAllowed bool) string {
	system := instructionFor(hostAllowed) + clientNote(c.Client) + replyCards(c.RichUI, c.Messages)
	if run.targets {
		system += targetHint
	}
	names := make([]string, 0, len(run.catalog))
	for name := range run.catalog {
		if isWriteTool(name) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	writes := make([]agent.Tool, 0, len(names))
	for _, name := range names {
		writes = append(writes, run.catalog[name])
	}
	system += "\nWrite tool schemas:\n" + string(raw(writes))
	return system + timelySkill
}

// blockHash is run.start's system_hash.
func blockHash(block string) string {
	sum := sha256.Sum256([]byte(block))
	return hex.EncodeToString(sum[:])
}

// historySeed renders the conversation before this turn for a worker whose
// state.db may lack the session (plan 5.4, PROTOCOL.md section 9.6): the
// person's messages and the assistant's replies and proposal summaries, with
// Timely's notices as data. Tool-call structure is not kept. Nil when there
// is nothing before this turn.
func historySeed(messages []Message) []map[string]string {
	end := 0
	for i := len(messages) - 1; i >= 0; i-- {
		if m := messages[i]; m.Role == "assistant" && m.Kind == "" {
			end = i + 1
			break
		}
	}
	var out []map[string]string
	for _, m := range messages[:end] {
		switch {
		case m.Kind == "similar" || m.Kind == "archive" || m.Content == "":
			continue
		case m.Role == "user":
			out = append(out, map[string]string{"role": "user", "content": m.Content})
		case m.Kind == "":
			out = append(out, map[string]string{"role": "assistant", "content": m.Content})
		default:
			out = append(out, map[string]string{"role": "user", "content": "System notice (not written by the user): " + m.Content})
		}
	}
	return out
}

// sessionKey names a conversation's Hermes session.
func sessionKey(uid, cid string) string { return "timely:" + uid + ":" + cid }
