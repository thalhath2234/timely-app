---
name: timely-agent-qa-harness
description: "How to live-test the in-app chat agent end to end, and what the 2026-10-02 84-scenario run found"
metadata:
  type: project
  modified: 2026-10-02T12:51:39.223Z
---

On 2026-10-02 the in-app agent was tested with 84 scenarios on a disposable account (`agent-qa-20261002@example.invalid`) against an API binary run as `API_PORT=8081 DB_SCHEMA=agentqa`. The `agentqa` schema is still in timely_db.

Non-obvious mechanics:
- The chat transcript (the agent's tool calls) is `json:"-"`. Read `agentqa.agent_conversations.transcript` from Postgres while the run is going. It is cleared when the run finishes.
- A `propose_changes` call that succeeds is never written to the transcript. Only rejected attempts show up there.
- To see raw tool output, create an API key (`POST /api-keys`) and call the same tools over `/mcp`.
- No psql on the host; use a uv venv with `psycopg[binary]`.

Top findings from that run. All of them were fixed on branch `fix/agent-qa-findings` on 2026-10-02 (uncommitted at the time; check git before assuming they are merged):
- The default model (glm-5.3-flash) often sends `steps` as a JSON string, and the server rejects it.
- The model calls write tools directly and gets "Tool not available". Claude does this too.
- Empty model turns are a hard failure ("AI returned an empty answer").
- Tool output mixes server-local `+09:00` and `Z` timestamps, and clients send no timezone.
- The stale-data snapshot is taken when the proposal is submitted, not when the model read the data. A doc rewrite wiped a concurrent append.
- Concurrent approvals hit SQLSTATE 40001, which is never retried.

**Why:** these took real time to discover; the harness lived in /tmp/agentqa.
**How to apply:** reuse this approach for future agent QA, and re-check these findings before assuming they are fixed. See [timely-worktree-qa-environment](timely-worktree-qa-environment.md).
