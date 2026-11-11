# agentqa: the agent parity run

Runs the agent QA scenarios on the classic engine, the agent engine or both, against a running Timely API, and writes what each chat did (plan section 13, phase 2: "parity within an agreed margin on the 84 scenarios").

```bash
# The owner's choice: the API host's signed-in Claude Code CLI with Sonnet, no key.
make agent-parity ENGINE=both PROVIDER=claude MODEL=sonnet \
  SCENARIOS=apps/api/scripts/agentqa/scenarios.json OUT=<dir> [ONLY=tasks-01,docs]

# An API-key provider instead:
export TIMELY_PARITY_KEY=...    # the provider key, from your shell only; never .env, never a flag
make agent-parity ENGINE=both PROVIDER=openrouter MODEL=<id> \
  SCENARIOS=apps/api/scripts/agentqa/scenarios.json OUT=<dir> [ONLY=tasks-01,docs]
```

- The API is `TIMELY_API` (default `http://localhost:8081`, the worktree API). Never point it at `:8080`.
- Each engine gets its own disposable account (`agentqa+<engine>-<n>@example.invalid`, so the API needs `ALLOW_REGISTRATION=true`) with a `Home` workspace, the provider connected (with the key, or for `claude` and `codex` with `POST /agent/providers/<id>/connect`, which checks the host's CLI login), the model as default, and Settings → Agent → Engine set to that engine. The key is sent once, to `POST /agent/providers/<id>/key`, and is never printed or written. An error that echoes it is scrubbed.
- Each scenario: its setup requests (REST), a new chat (`POST /chats` with the scenario's time zone and `-permission`, default `supervised`), a wait for the run to end, then, when the scenario says `approve` and a proposal waits, its `between` requests (stale data) and Approve, and a second wait.
- `ONLY` takes scenario ids or whole categories, comma-separated.

## Output

- `<OUT>/classic.json` and `<OUT>/agent.json`: per scenario the turn's engine, final status and error, replies, notices, the proposal (summary, steps, held or applied), the plan at the end, what Approve led to (`applied`, `replanned`, `failed`), the tool trace, the time, and pass or fail with the reasons.
- `<OUT>/report.md`: totals per engine and category, and one row per scenario side by side, with whether both engines ended the same way.

Scoring (`report.go` `Score`) checks the outcome (`proposal`, `reply`, `any`), the tools the proposal must hold, words one of which the reply must contain, and what Approve must lead to. A pass is a floor, not a judgment of quality: read the replies in the JSON.

The tool trace is what was seen while the run was live: the agent engine's activity lines (written at most once a second, so a fast run may show none), and for classic, only with `-dsn` (or `TIMELY_PARITY_DSN`, a DSN whose `search_path` is the API's schema), the `transcript` column, which the API does not expose and clears when the run ends.

## Scenarios

`scenarios.json` holds 84 scenarios, seven in each category of the 2026-10-02 run: tasks, reminders, events, recurring edits, sheets, docs, bulk edits, bots, questions, out-of-scope declines, stale data, time zones. The 2026-10-02 scripts were lost with `/tmp/agentqa`; these were written again on 2026-11-09 from its categories and findings. `agentqa_test.go` checks the file (count, categories, templates).

Templates in messages, setup and stub directives: `{{workspace}}`, `{{timezone}}`, `{{today+N}}` (a date in the scenario's zone), `{{today+NThh:mm}}` (a time there, RFC 3339), `{{alias.path}}` (a field of the setup answer saved `as` alias; `{{t1.id}}` finds the first id).

## Against the stub model (no provider, no key)

The smoke run uses `apps/agent/tests/stub_openai.py` behind an Ollama shim that answers both Ollama's `/api/chat` (classic) and `/v1/chat/completions` (the agent engine's worker), with a phrase table that maps a message to a stub directive. Scenarios with a `stub` field carry their directive; the harness writes it into the phrase table, so the chat shows only the person's words.

```bash
python3 -I apps/api/scripts/agentqa/ollama_shim.py 11435 apps/agent/tests <dir>/phrases.json &   # prints the port
# API on :8081 with OLLAMA_BASE_URL=http://127.0.0.1:11435, its own DB_SCHEMA, ALLOW_REGISTRATION=true
export TIMELY_PARITY_KEY=stub TIMELY_PARITY_STUB_PHRASES=<dir>/phrases.json
make agent-parity ENGINE=both PROVIDER=ollama MODEL=stub-model \
  SCENARIOS=apps/api/scripts/agentqa/scenarios.json OUT=<dir>/out \
  ONLY=tasks-01,bulk-01,questions-01,declines-01,stale-01
```

Without a phrase table the directive is appended to the message, which works on classic only: the agent engine's turn input adds Timely's notices after the person's words.

`ollama_shim.py` is the shim the phase 2 web, phone and parity proofs used; it imports `stub_openai` from the folder named in its second argument.
