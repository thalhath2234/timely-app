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

// The block names no timely skill: none ships yet (plan 9.2, the phase 3
// status's Open list), and a pointer to a missing skill sent the model to
// skill_view a name a learned skill could take. The worker reserves the name
// (seed.RESERVED_SKILL_NAMES) until it ships.

// timelyBlock is the conversation's Timely block: the instruction (without
// the scope line for the host-allowed account, Q-2.1), the client note, the
// reply-card kit, resolve_target's hint when it is offered, classic's web
// search line when the run has the web (flags.web) and the write tool
// schemas. The write schemas are listed in answer-only
// turns too, so the block does not change when a message tags a Bot; the
// tools refuse every change in such a turn (toolCall).
func timelyBlock(c *Conversation, run *toolRun, hostAllowed bool) string {
	system := instructionFor(hostAllowed) + clientNote(c.Client) + replyCards(c.RichUI, c.Messages)
	if run.targets {
		system += targetHint
	}
	if run.web.on {
		system += webSearchOn
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
	return system + "\nWrite tool schemas:\n" + string(raw(writes))
}

// askHint is the Timely block's line on the question card and sub-tasks
// (Q-4.3), for every conversation whose runs may ask (not a no-persist
// Sensitive chat, which never gets clarify or delegation). It is fixed per
// conversation, so the block stays byte-identical; an answer-only turn simply
// has no clarify tool to call. Without it the reply-card kit's Choices line
// made the model ask in a finished reply instead of pausing the run.
const askHint = "\nWhile you work you can pause and ask the person: when you need their decision to finish what they asked (which day, which of two options, a detail only they know), call clarify with the question and up to four short choices, then carry on from their answer in this same turn. Do not end your reply with that question in text or in a Choices reply card: the turn would stop with the work unfinished. Choices are only for an optional follow-up after a finished reply. When a request has two or more independent parts that each need their own reading (web pages, searches), hand them to sub-tasks in one delegate_task call; sub-tasks cannot propose changes, so you propose after they report. If clarify is not among your tools this turn, ask in your reply instead."

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
		if m := messages[i]; m.Role == "assistant" && m.Kind == "" && !m.Cut {
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
