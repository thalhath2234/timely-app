---
name: no-adversary-no-fable
description: User said not to run the adversary agent and not to use the Fable model (2026-10-09)
metadata:
  type: feedback
  modified: 2026-10-09T10:46:09.688Z
---

On 2026-10-09, during Jev agent-chat QA, the user said: "dont run adversory agent and dont use fable". The adversary I had launched in the background was stopped.

**Why:** the user's own instruction; it overrides the global CLAUDE.md rule that the adversary reviews before a PR. No reason was given.
**How to apply:** don't spawn the `adversary` subagent and don't pick `fable` as a model for agents. Do the review yourself, or ask before a PR. See [timely-agent-qa-harness](timely-agent-qa-harness.md).

Later the user sometimes asked for Fable by name ("use fable", 2026-10 Claude project threads). So: pick Fable only when the user asks for it in that conversation.
