# Phase 4 work packages: CLI providers, delegation, clarify, Sensitive groundwork

- Date: 2026-11-13. Branch `feature/hermes-phase4`, stacked on `feature/hermes-phase3b` (PR #294), which is stacked on `feature/hermes-phase3` (PR #293). Phases 1 and 2 are merged into `dev`.
- Plan: `docs/plans/2026-11-08-timely-agent-from-hermes.md` ("the plan"), section 13 "Phase 4" and what it cites: 3.4 and 3.5 (a chat turn, an approval wait), 5.1 (host protocol), 5.4 (storage, lost runs), 5.5 and 5.5b (cards, permission modes), 5.6 (Sensitive and photos), 5.7 (providers, the CLI gateway as built in phase 2), 8.1 (tool table: `clarify` block → card, `delegate_task` allow, capped), 9b.5 (taint and learning staging), 12 (security), and the phase 2, 3 and 3b status notes.
- This document wrote no product code.
- Status (2026-11-13): all five packages are committed on `feature/hermes-phase4`: `gateway` `1fcc6e80`, `worker` `89268ebc` (with `25e8e632`), `go-engine` `46fd718f` and `7d5e2a81`, `ui` `dc9569a1`, `verify-docs` `8c01997d` and its docs commit. The results, findings and open items are under "Phase 4 status" in the plan's section 13, and the exit check (integration fixes, the live Claude Code + Sonnet run, parity 71 and 72 of 84) under "Phase 4 exit check" right after it. Not pushed.

## Binding owner answers used here

| Answer | Effect on phase 4 |
|---|---|
| Q-4.1 (2026-11-13) | No Hermes-native OAuth sign-ins: no ChatGPT/Codex OAuth, no borrowing the Claude Code login, no Nous Portal. API keys and the CLI providers through the Go gateway only. Phase 4 proves Hermes' OAuth provider paths are unreachable. |
| Q-4.2 (2026-11-13) | Sensitive and photo chats stay on classic. Phase 4 builds and proves the no-persist path (no `state.db` writes, no learning, no session search hits, ZDR via the gateway) behind a flag that is off; nothing routes them to the new engine. |
| Q-4.3 (2026-11-13) | `clarify` is an answer card the run waits on, on web and phone; after the answer the run continues where it was. Stop, chat delete, lease expiry and timeouts are handled like the existing approval waits. |
| Q-P1, 5.5b | Permission modes Supervised / Auto / Full Access; new chats Supervised, bots Auto. Unchanged by phase 4. |
| Recursion guard | Bots never get `clarify` or `delegate_task`. |
| 9b.5, 5.5b item 6 | After outside content every later proposal is held and learning is staged. A child's outside read counts as the parent's. |
| Q-3.9 | Hermes' own untrusted-content handling applies on every web path, children included; Timely adds no web rule after taint. |
| Q-1.3 | `apps/agent/hermes/**` stays byte-identical; seams and plugins only; `make hermes-sync-check` passes. |

## What exists today (mapped 2026-11-13)

**CLI model gateway** (`apps/api/internal/features/provider/gateway.go`, built in phase 2 for the parity run). Its own `http.Server` on `127.0.0.1:0`; `POST /v1/chat/completions` and `GET /v1/models`; a bearer secret per (account, provider, model) made once per process (`grant`), handed to the worker as `run.start.model.api_key` with `provider: "custom"` (`agentrun.go` `cliAgentModel`). It answers with the account's `chat.Completer` (`Service.Completer`), non-streaming; a streamed request gets the whole answer as one chunk, then the tool calls, then the finish; usage is reported as 0. `cmd/agent_engine.go` starts it only when the supervisor is available (`providers.StartAgentGateway()`); without it `AgentModel` returns `ErrAgentEngineUnsupported` ("Claude Code and Codex use the classic engine until a later update") and the chat fails with "Use classic for this chat". Tests (`gateway_test.go`): a relayed tool call, streaming, other callers refused (401/400), CLI runs routed through it, `TestGatewayIsNotOnTheMainRouter` (an `echo.New()` with only the provider routes), Hermes' untrusted block kept whole, forged turn headers escaped. **Missing:** Sensitive runs (no grant carries Sensitive, no ZDR), any test through a real worker, a fake-CLI test of the whole loop, a non-loopback listener test, a test on the real router `cmd/main.go` builds (it builds Echo inline at `main.go:347`). ZDR exists only on classic: `chat/provider.go:347-374` sets `provider.zdr=true` on OpenRouter when any `WireMessage.Sensitive` is true. Fake CLIs are `/bin/sh` scripts (`provider_test.go:130-140`, `CLAUDE_BIN`/`CODEX_BIN` overrides, skipped on Windows).

**Chat agent engine** (`apps/api/internal/features/chat`). `engine.go`: the `AgentEngine` interface (`Available`, `Start`, `Lost`, `Stop`, `Steer`, `Forget`) and `runEngine`, which sends a run to classic when `c.Sensitive || c.Phase != "plan"`. `engine_agent.go` `WorkerEngine`: `Available` refuses Sensitive ("Sensitive chats use the classic engine") and non-plan phases ("Photos and receipts use the classic engine"); `Start` builds the turn, writes `agent_run_id`/`agent_instance` in a fenced checkpoint, sends `run.start` with `flags {sensitive, answer_only, web, rich_ui, from_bot:false, learning_writes, search_history}`, toolsets from `runToolsets` (`engine_learning.go`: `timely, todo, skills` + `memory` + `session_search` + `web`), `permission`, `tainted_sources`. One follower goroutine per run handles `event` (`engine_live.go`: `delta`, `tool.*`, `reasoning`, `status`; `approval.request`, `learning`, `subagent` are ignored as "later phases"), `taint` (merged through `keepTaint`, append-only), `tool.call` (`toolCall`, shared with classic through `toolcall.go`), `run.done` (`done` → `finishTurn`), renews the lease every 20 s (`renew` → `renewLease`, only while `status = 'running'` and the row names this run), and ends with `stopped`/`fail`. `Lost` re-attaches when this process follows the run, else fails it with Try again.

**Run statuses** are free text (`agent_conversations.status text NOT NULL DEFAULT 'idle'`, no CHECK): `idle`, `queued`, `running`, `approval` (a proposal held for Approve), `choose` (similar-chat pointer), `stopped`, `failed`; plan steps carry `pending`, `review`, `done`, `failed`, `discarded`. Claim: `status = 'queued' OR (status = 'running' AND lease_until < now)`, `FOR UPDATE SKIP LOCKED`. **There is no live wait on the agent engine today.** A held proposal ends the run (`approval`), and Approve is a later model-free apply. Hermes' own approval gate (`approval.request` / `approval.answer`) is wired in the worker and the fake worker, but Go answers every non-local `gate.ask` with block, so it never fires. `service.go` `stop` acts on `busy(row) || row.Status == "approval"`: status `stopped`, lease and run cleared, the streamed draft kept, then `engine.Stop` sends `run.stop`. Delete (`remove`) does the same and then `Forget` (`session.delete`). Plan 3.5's host-approval design (status `host_approval`, lane release, live then parked wait) is phase 5.

**Worker protocol and plugins** (`apps/agent/PROTOCOL.md`, `timely_agent/`). Run identity is the `bridge.current_run` context variable; hook calls (`gate.ask`, `tool.call`) answer within 25 s. `timely_gate` (`pre_tool_call`): messaging and never-offered tools blocked, private browser targets blocked, `end_turn` after a recorded proposal, `propose_changes` alone in its batch, `pre_approved`, `LOCAL_ALLOW` (`todo_list`, `skills_*`, `skill_manage`, `memory`, `session_search`) and the `timely` toolset allowed, everything else to Go. `post_tool_call` reports `web_extract` hosts as taint. `policy.py` `TAINT_SOURCES` lists `delegate_task: "subagent"` outright, "until the child-to-parent map arrives (phase 4)". `timely_learning` stages or blocks learning writes from session state (`bridge.session_state(session_id)`). `run_chat.build_agent` always passes `session_db=SessionDB()`, `skip_memory=False`, and no `clarify_callback`. `.hermes-sync/policy/tools.yaml`: `clarify@core` chat block, bot block, phase 4, gate `clarify-card`, no schema hash yet; `delegate_task@core` chat allow, bot block, phase 4, gate `delegate-cap`, schema hash recorded. Contract test 9's `delegate_task` case is skipped "phase 4: delegate_task" (`tests/contract/test_c09_learning.py:573`). The fake worker (`agenthost/agenthosttest/fake.go`) can script `approval.request`.

**Hermes `clarify`** (`hermes:tools/clarify_tool.py`, an inline executor, `hermes:agent/inline_tool_executors.py:270`). `clarify(questions=[{question, choices?, multi_select?}])`, 1-5 questions, up to 4 choices each (the first is labelled "(Recommended)", every surface adds an "Other" free-text row), 8,000 characters per choice. It calls `agent.clarify_callback(shown)` with the display copy (secrets redacted by `redact_approval_display`), each entry `{qid: "q<i>", question, choices, choices_offered, multi_select}`, and expects `{"answers": {qid: raw | None}, "outcome": submitted|cancelled|timed_out|undelivered, "notice"?}`. Without a callback the tool returns "Clarify tool is not available in this execution context". The wait runs inside `human_input_request("clarify", ...)`. The callback is an `AIAgent(clarify_callback=...)` constructor argument; delegated children always get `clarify_callback=None`.

**Hermes `delegate_task`** (`hermes:tools/delegate_tool.py` and its `delegate_tool_*` siblings). It builds child `AIAgent`s with a fresh conversation, `skip_memory=True`, `clarify_callback=None`, `iteration_budget=None` (**a fresh budget per child, not shared**), `session_db` reserved from the parent's database, `session_id` of their own and `parent_session_id` = the parent's. Children get the parent's toolsets minus `DELEGATE_BLOCKED_TOOLS` (`delegate_task`, `clarify`, `memory`, `send_message`, `cronjob_manage`) and minus the `delegation` and `kanban` toolsets; so a Timely child would get `timely` (including `propose_changes`), `web`, `skills`, `todo`, `session_search`. Batches run in a thread pool through `contextvars.copy_context().run`, so `bridge.current_run` is visible in children. Lifecycle hooks `subagent_start {parent_session_id, child_session_id, child_subagent_id, child_goal, ...}` and `subagent_stop {parent_session_id, ..., tool_call_history}`. Config `delegation.*`: `max_concurrent_children` (default 10), `max_spawn_depth`, `orchestrator_enabled`, `max_async_children`, `max_iterations` (default 250), `child_timeout_seconds`, `oneshot_max_children`, and `provider`/`model`/`base_url`/`api_key` overrides; `background=true` makes a child outlive the call. Children inherit the parent's credentials unless the config pins a provider.

**Sensitive and photo routing.** Classic runs Sensitive chats with `decide.WithSensitive` and every wire message `Sensitive: true` (ZDR on OpenRouter, no web). The agent engine refuses them twice (`runEngine`, `Available`). Photo phases (`extract`, `receipt_plan`, `receipt_edit`) are classic by phase; `go-engine` must confirm that a plan turn of a chat holding photos also stays classic (Q-4.2 says photo chats, not only photo phases).

**Web and phone assistant cards.** Web `apps/web/app/_components/chat`: `proposalPanel.tsx` and `changeCards.tsx` (proposal), `turnLearning.tsx` (learning chip, Keep / Discard), `failureCard.tsx`, `agentRun.tsx` (activity lines, live draft), `permissionPicker.tsx`, `composer.tsx`, `conversation.tsx`, `chatMeta.ts` (status words). Phone `apps/mobile/components/chat`: `ProposalPage.tsx`, `ChangeCards.tsx`, `LearningCards.tsx`, `AgentRun.tsx`, `PermissionSheet.tsx`, `Composer.tsx`, `Thread.tsx`, `chatMeta.ts`; notification taps through `apps/mobile/lib/notificationRoute.ts`. Shared wire types in `packages/contract/src/agentChat.ts`, tested by `scripts/agent-chat.test.mjs` (`make test-agent-chat`). Phone checks: `make test-mobile-assistant`, `make audit-mobile-assistant` (fixture APIs, Chromium, web on 4002).

**TLA+** (`.agents/skills/verify-agent-runs`). `AgentRunApply.tla` with two checks (apply, turn); guards read from anchors in `tools/coverage.go`; covered functions fingerprinted in `coverage.lock`; `make verify-agent-runs` (0 pass, 1 violation, 2 model mismatch, 3 drift) and `ARGS=--mutants`.

## Decisions this decomposition makes

1. **A clarify wait keeps `status = 'running'` and adds a `question` column.** No new status. On the agent engine no lane is held during a run (Q-2.3: the follower owns it), so the reason plan 3.5 gives for `host_approval` (releasing a lane) does not apply. Keeping `running` keeps the claim predicate, `renewLease`, `Lost`, Stop and Delete exactly as the TLA+ model checks them: Stop and Delete already act on a running row and send `run.stop`, the follower keeps renewing the lease while the worker waits, and a dead API or worker is a lost run (Try again) as today. The UI shows "Needs your answer" from `status = 'running' && question.requestId != ""`. The model still gains two actions (Ask, Answer) and one property (decision 2), so TLA+ is updated.
2. **The answer is fenced on the live run.** `POST /chats/:id/answer {requestId, answers}` commits only when the row is `running`, `agent_run_id` names the run that asked, and `question.requestId` matches; it clears `question` in that transaction and then sends `clarify.answer`. A stale answer is a 409. Property: no answer reaches a run after Stop, Delete or Lost.
3. **Clarify timeout: 10 minutes, then the run goes on without the answer.** `run.start.clarify_timeout_s` (Go sets 600; `TIMELY_AGENT_CLARIFY_TIMEOUT_S` overrides it only when `DB_SCHEMA` is set, for tests and `verify-timely`). On expiry the worker returns Hermes' `outcome: "timed_out"` with a notice, the model finishes the turn (usually by asking in text), and the card reads "Not answered in time". There is no parked continuation (plan 3.5 step 7 is for host approvals): a later reply is an ordinary message.
4. **A typed message while a card waits answers it.** `send` and `steer` on a row with a pending question deliver the text as the answer to every unanswered question (Hermes reads a string as the typed "Other" answer), `outcome: "submitted"`. The person never has two places to answer.
5. **Delegation caps** (constants in `timely_agent/policy.py`, floors in the managed config): at most **3 children per run in total** (across every `delegate_task` call of the run, not only at once); `max_spawn_depth: 1` and `orchestrator_enabled: false` (no grandchildren); `max_async_children: 0` and `background: true` refused (a child must not outlive the run); each child `max_iterations: 20`, `child_timeout_seconds: 300`; a **shared pool of 60 tool calls across all children of the run**, counted by the plugin, after which a child's next call is blocked with "The sub-task budget for this reply is used up. Finish with what you have."; `delegation.provider/model/base_url/api_key` always empty, so children run on the parent's run credentials (the gateway grant for CLI providers) and can never select an OAuth provider (Q-4.1).
6. **Children read, never propose.** In a child session `timely_gate` blocks `propose_changes` ("Only the main assistant proposes changes"), `session_search`, and every `skill_manage` write; Timely read tools and `web` (when the parent's run has it) are allowed. A child's Timely `tool.call` reaches Go under the parent's run id (the copied context) and carries `subagent: <child session id>`.
7. **Child → parent taint.** A plugin map `child_session_id → parent RunContext` is filled from `subagent_start` and cleared on `subagent_stop`; every taint source a child adds (Hermes-side via `TAINT_SOURCES`/`post_tool_call`, `web_extract` hosts) is added to the parent's run as `{kind, tool, host?, via: "subagent"}` and sent as `taint` at once. `delegate_task` itself leaves `TAINT_SOURCES`: a child that read nothing outside does not taint. Learning staging follows the parent's session state, so a child's web read stages the parent's learning.
8. **Delegation and clarify are off where they must be.** Go adds the `clarify` and `delegation` toolsets only to chat runs that are not answer-only, not `from_bot`, and not no-persist; `timely_gate` blocks both in any run whose `run_kind` is `bot` or whose `flags.from_bot` is true, and `delegate_task` under `flags.no_persist` (second line). `bot.run` stays `unsupported` until phase 6.
9. **No-persist path.** `run.start.flags.no_persist: true` makes the worker build an uncached agent with `session_db=None`, `skip_memory=True`, `skip_background_review=True`, no counters stored, toolsets `["timely", "todo"]`, the full history from Go as `conversation_history` on every turn, and no write anywhere under the account home. Hermes creates `sessions/` and may write a session log during agent init: the `worker` package finds the seams that stop every write (and records them in `TIMELY_SEAMS`); if one cannot be stopped without a patch point, the fallback is a per-run scratch `HERMES_HOME` deleted after the run (flagged below). The test snapshots the home (every path, size, mode, mtime, sha256) before and after two Sensitive turns with a tool call and asserts it is unchanged.
10. **The no-persist flag is test-only.** `TIMELY_AGENT_SENSITIVE_NO_PERSIST=1` is read only when `DB_SCHEMA` is also set, so a shipped app cannot turn it on (Q-4.2: Sensitive does not route to the new engine). Off (the default): `runEngine` and `Available` behave exactly as today, and a test says so for Sensitive and for photo chats. On: Sensitive plan turns follow the chat's engine choice, `run.start` carries `flags.no_persist`, and the model is the gateway's Sensitive grant. Photo chats stay classic either way. Sensitive is set only by attaching photos (`images.go` also sets `ImageReview`, so `holdsPhotos` keeps the chat classic), so with the switch on no real chat takes the path; the proof uses a row marked Sensitive by hand.
11. **Sensitive model calls go through the gateway for every provider.** `AgentModelFor(..., AgentRunOptions{Sensitive: true})` returns the gateway for OpenRouter and API-key providers too, with a grant keyed `(uid, provider, model, sensitive)`; the gateway marks every message `Sensitive` and passes `search=false`, so the Completer applies classic's Sensitive behaviour (ZDR on OpenRouter). Like classic Sensitive and CLI runs, these runs do not stream and report no token counts.
12. **Q-4.1 is enforced on both sides.** Go never emits a Hermes OAuth provider id (`hermesProvider` maps only registry entries; a test walks the registry) and refuses an Anthropic "key" that is a Claude Code OAuth token (`sk-ant-oat…`) with "This is a Claude Code sign-in token, not an API key". The worker refuses a `run.start` whose `model.provider` is outside an allowlist (the ids `hermesProvider` can produce: `custom`, `openrouter`, `anthropic`, `gemini`, `deepseek`, `xai`, `zai`, `nvidia`, `opencode-zen`, `opencode-go`, `ollama-cloud`), never reads `~/.claude/.credentials.json` or the macOS Keychain, and its self-test fails when `auth.json` exists in the home or any `model`/`delegation`/`auxiliary` provider in the rendered config is an OAuth id.
13. **The exit is mostly proof, not new code.** Claude Code and Codex already reach the agent engine through the gateway whenever the runtime is available. Phase 4 adds the fake-CLI tests through a real worker, a Codex path test, copy that no longer says "until a later update", and a live Claude Code + Sonnet smoke in `verify-docs`. Codex is tested only with the fake CLI (the only live model allowed is Claude Code + Sonnet).

## Waves

```
wave 1:  gateway        (no deps)          worker (no deps)        parallel; neither runs dev servers
wave 2:  go-engine      (deps: gateway)                            may overlap with worker
wave 3:  ui             (deps: go-engine)                          the only dev-server user in its wave
wave 4:  verify-docs    (deps: gateway, worker, go-engine, ui)     dev servers, real worker, the one live run
```

A package starts only when every dependency is committed on `feature/hermes-phase4`. Only `ui` and `verify-docs` start dev servers (API 8081 with `DB_SCHEMA=<name>`, web 4002, Expo web 8082; never 8080/4001), and never at the same time. The live model (Claude Code CLI, provider `claude`, model `sonnet`, through the loopback gateway) is used only by `verify-docs`. Disk is about 20 GB free: delete test homes (`$HOME/.cache/timely-agent-test/*`), scratch schemas you created, staged runtimes and evidence copies once their numbers are recorded.

## File ownership (disjoint)

Only the named package edits these paths. A path not listed is not edited in phase 4; a package that finds it must change one asks the coordinator first.

| Package | Owns |
|---|---|
| `gateway` | `apps/api/internal/features/provider/**` (new: `gateway_realworker_test.go`, `testdata/fakecli/**`); `apps/api/cmd/main.go` (only to extract the router builder the listener test needs); new `apps/api/cmd/agent_gateway_test.go` |
| `worker` | `apps/agent/timely_agent/**` (new plugin folder allowed: `plugins/timely_delegate/`); `apps/agent/tests/**`; `apps/agent/PROTOCOL.md`; `apps/agent/AGENTS.md`; `apps/agent/.hermes-sync/policy/**` and the regenerated dumps under `apps/agent/.hermes-sync/`; `apps/agent/skills/**`; `scripts/hermes-sync/check_seams.py` |
| `go-engine` | `apps/api/internal/features/chat/**` except `engine_phase4_realworker_test.go`; `apps/api/internal/agenthost/**` (with `agenthosttest/`); `apps/api/cmd/agent_engine.go` and its tests; the new migration in `apps/api/migrations/`; `.agents/skills/verify-agent-runs/**`; `packages/contract/src/agentChat.ts`; `scripts/agent-chat.test.mjs`; `Makefile` |
| `ui` | `apps/web/app/_components/chat/**`; `apps/web/app/_store/chatStore.ts`; `apps/web/app/utils/api/chat.ts`; `apps/web/app/utils/hooks/chat.ts`; `apps/web/app/(pages)/(nav_pages)/chat/**`; `apps/web/app/_components/settings/agentEngine.tsx`; `apps/mobile/components/chat/**`; `apps/mobile/lib/chat/**`; `apps/mobile/lib/api/chat.ts`; `apps/mobile/lib/notificationRoute.ts`; `apps/mobile/components/settings/EngineCard.tsx`; `apps/mobile/app/(app)/settings/agent.tsx` (CLI copy only); `apps/mobile/app/(app)/assistant.tsx`; `scripts/mobile-assistant.test.mjs`; `scripts/audit-mobile-assistant.mjs` |
| `verify-docs` | `docs/plans/2026-11-08-timely-agent-from-hermes.md`; this file (status lines only); `docs/adr/**`; `CONTEXT.md`; new `apps/api/internal/features/chat/engine_phase4_realworker_test.go`; `apps/api/scripts/agentqa/**` (the stub shim's directives); `.agents/skills/verify-timely/**`; `.github/workflows/**` |

`apps/agent/hermes/**` belongs to nobody: it stays byte-identical.

## Shared contracts every package follows

### 1. Worker protocol additions (version stays 1; every field additive and optional for an older peer)

`worker` documents these in `PROTOCOL.md` section 11 "Phase 4"; `go-engine` implements the Go side and the fake worker.

| Direction | Message | Fields |
|---|---|---|
| Go → W | `run.start` additions | `flags.no_persist` (bool), `clarify_timeout_s` (int; Go sends 600). Toolsets may now include `clarify` and `delegation` (decision 8). With `no_persist`, `history` is the whole conversation on every turn. |
| W → Go | `event` kind `clarify.request` | `{request_id, questions: [{qid, question, choices: string[] \| null, recommended: 0 \| null, multi_select}], timeout_s}`. `choices` are the display copy without the "(Recommended)" suffix; `recommended` is the index Hermes marks. Sent once per `clarify` call, after the stream is flushed. |
| Go → W | `clarify.answer` | `{id, run, request_id, answers: {qid: string \| string[] \| null}, outcome: "submitted" \| "cancelled", notice?}` → `ack` (`ok: false` when that request is no longer pending). Missing `request_id` → `error bad_message`. |
| W → Go | `event` kind `clarify.closed` | `{request_id, outcome: submitted \| cancelled \| timed_out \| undelivered}`: always sent once when the wait ends, whoever ended it (answer, timeout, `run.stop`, shutdown). |
| W → Go | `event` kind `subagent` | `{phase: "start" \| "stop", subagent_id, child_session_id, goal (cut to 200 chars), status?, tool_calls?}` |
| W → Go | `tool.call` addition | `subagent` (the child session id) when a child made the call; absent for the parent. |
| W → Go | `taint` source shape | adds optional `via: "subagent"` (and `child`, the child session id) to `{kind, tool, host?, session?}`. |
| W → Go | `run.done` | unchanged; `tainted_sources` includes child sources. |

Rules: `run.stop` during a clarify wait ends the wait with `outcome: "cancelled"` and then the run (`run.done interrupted: true`); `shutdown` does the same within its grace; the worker counts a waiting run as busy (never reaped). The wait does not count against Hermes' tool batch deadline (the `worker` package proves it with a wait longer than that deadline). `session.delete` also deletes every child session whose `parent_session_id` is the conversation.

### 2. Database (`go-engine` writes the one migration with `make migrate-create NAME=agent_conversation_question`)

- `agent_conversations.question jsonb NOT NULL DEFAULT '{}'`: `{requestId, run, questions[], askedAt, expiresAt}` while a card waits, `{}` otherwise. Down step drops it. It rides the existing change NOTIFY.
- The asked questions and the answers are kept in the thread as a message of kind `question` (`{questions, answers, outcome}`), written when the wait closes, so history seeds and the apps show what was asked and answered.
- `TaintSource` gains `via` (and `child`) in JSON only; the column stays `tainted_sources jsonb`.

### 3. HTTP API (signed-in, account-scoped; another account's chat answers 404)

- `POST /chats/:id/answer` `{requestId, answers: {qid: string | string[] | null}}` → 200 with the row; 409 "This question was already closed" when the row is not running, names another run, or holds another request; 400 for an unknown `qid` or a choice outside a single-select's list (typed "Other" text is any string up to 2,000 characters).
- `GET /chats`, `GET /chats/:id` and watch rows carry `question`. Status words: `running` with a question reads "Needs your answer" (web and phone, `chatMeta.ts`).
- `send` and `steer` while a question waits: decision 4.

### 4. Push

- One notification per `clarify.request`: "Timely has a question" with the chat title, through the existing `notify(tx, row, ...)` path; the phone's notification route opens the chat with the card in view.

### 5. Go seams

- `chat.AgentEngine` gains `Answer(ctx, uid, cid, runID, requestID string, answers map[string]any, outcome string) error` (sends `clarify.answer`; the handler calls it after the fenced commit).
- `chat.WorkerEngineOptions.Model` becomes `func(ctx, uid, provider, model string, opts RunModelOptions) (any, error)` with `RunModelOptions{Sensitive bool}`; `cmd/agent_engine.go` passes it to `provider.Service.AgentModelFor(ctx, uid, provider, model, provider.AgentRunOptions{Sensitive: opts.Sensitive})`. `AgentModel(ctx, uid, provider, model)` stays as the non-Sensitive shorthand.
- `chat.Service.SetSensitiveNoPersist(bool)`: set by `cmd` from `TIMELY_AGENT_SENSITIVE_NO_PERSIST` only when `DB_SCHEMA` is set.
- `agenthost` gains `TypeClarifyAnswer = "clarify.answer"`; `agenthosttest` fake worker scripts `clarify.request`/`clarify.closed`, `subagent` events and child taint.

### 6. Python seams

- `bridge.RunContext` gains `children: dict[str, ChildState]` (`{session_id, subagent_id, tool_calls}`), `children_spawned`, `child_tool_calls`; `bridge.child_run(session_id) -> RunContext | None` reads the map; `bridge.clarify_wait(ctx, questions, timeout) -> reply` blocks on a per-request event the worker's reader sets on `clarify.answer`, `run.stop` or shutdown.
- `run_chat.build_agent` passes `clarify_callback` when `"clarify"` is in the run's toolsets, and honours `flags.no_persist` (decision 9).
- `config_render` renders the `delegation` floors of decision 5 and the provider floors of decision 12 as managed (canary-checked) keys.

### 7. Make targets

No new targets are planned. Suites: `make test-api`, `TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration` (covers `./internal/features/provider` and `./internal/features/chat`, so the real-worker tests run there), `make agent-test`, `make agent-contract`, `make hermes-sync-check`, `make agent-go-integration`, `make verify-agent-runs` (`ARGS=--mutants`), `make test-agent-chat`, `make test-mobile-assistant`, `make audit-mobile-assistant`, `make lint`, `make typecheck`, `make lint-chat`, `make check-format-chat`, `make agent-lint`, `make agent-go-vet-windows`. A package that needs a target asks `go-engine` (owner of the `Makefile`).

### 8. UI names

Web `apps/web/app/_components/chat/questionCard.tsx` (`QuestionCard`); phone `apps/mobile/components/chat/QuestionCard.tsx` (`QuestionCard`); activity line kind `subagent` ("Sub-task: <goal>"); status word "Needs your answer"; card titles "Timely needs an answer", "Not answered in time", "Answered", "Stopped before you answered".

### 9. Rules for every package

- `export GOTMPDIR=$HOME/.cache/gotmp TMPDIR=$HOME/.cache/gotmp UV_CACHE_DIR=$HOME/.cache/uv` before any command. Never touch `~/.hermes`. Never read, print or copy `.env` values; never use its OpenRouter key.
- Unit and contract tests use the stub model (`tests/stub_openai.py`, `stubModel`, `ollama_shim.py`) or a fake CLI. The only live model is Claude Code + Sonnet through the loopback gateway, in `verify-docs` only.
- Never ports 8080/4001; one package at a time runs dev servers; never run `git stash`; commit only your own paths (`git add <paths>`), messages `area: what changed` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; retry on `index.lock`. No push, no PR, no tags, never touch `dev`/`main`. Never commit `.env`, a `.venv` or build output.
- Any change to how runs are claimed, leased, applied, stopped or waited on runs `make verify-agent-runs` and `ARGS=--mutants`, updates the spec and anchors, and resyncs coverage.
- UI: design skills (`design:design-system`, `design:ux-copy`, `design:accessibility-review`), match the existing assistant cards, screenshots in light and dark at desktop 1440 and phone 390 (Expo web), grouped by surface. The only keyboard shortcuts are Ctrl/Cmd+K and Ctrl/Cmd+Shift+J: add none (the card answers through its buttons).

## Packages

### `gateway`: Sensitive gateway runs, fake-CLI tests through a real worker, listener test, Q-4.1 Go half, the CLI exit (wave 1)

Owns: see the ownership table. Deps: none.

Deliverables:
1. `AgentRunOptions{Sensitive}` and `AgentModelFor`. Sensitive returns the gateway for every provider (decision 11); the grant key gains `sensitive`, so a Sensitive and a normal secret for the same model differ and the gateway knows which it serves. In a Sensitive grant the gateway marks every `WireMessage` `Sensitive: true` and calls `Complete(..., search=false)`. `ErrAgentEngineUnsupported` reads "The model gateway is not running, so Claude Code and Codex use the classic engine" (it now means only that).
2. Q-4.1, Go half: a test that walks every registry entry and OpenRouter through `hermesProvider`/`AgentModelFor` and finds only allowlisted ids (decision 12); an Anthropic key starting `sk-ant-oat` is refused when saved and in `AgentModelFor`.
3. Fake-CLI translation tests through a real worker: `gateway_realworker_test.go`, `TestIntegrationGatewayRealWorker*`, skipped unless `TIMELY_AGENT_TEST_RUNTIME` is set (so `TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration` runs them), no Postgres, `/bin/sh` fake `claude` and `codex` under `testdata/fakecli/` selected with `CLAUDE_BIN`/`CODEX_BIN` (skip on Windows). The test starts the gateway and a real worker through `agenthost`, sends `run.start` with the gateway model, and plays Go for `tool.call`. Cases, each for both CLIs: a Timely read (`list_tasks`) the fake CLI asks for comes back as a worker `tool.call` with the right arguments, and the CLI's next invocation sees the result in its transcript; two calls in one reply arrive with `batch_size: 2`; `propose_changes` alone; a streamed request (Hermes' default); a plain answer ends `run.done` with that text; a Sensitive grant makes the fake CLI see classic's Sensitive arguments.
4. ZDR: with a Sensitive grant on OpenRouter, the request an `httptest` OpenRouter receives carries `provider.zdr: true`; without one it does not.
5. Listener test (`cmd/agent_gateway_test.go`): the real router `cmd/main.go` builds (extract `newRouter` if needed, no behaviour change) served on a listener bound to a non-loopback address of the host (the first non-loopback unicast address from `net.Interfaces`; skip with the reason when there is none): `POST /v1/chat/completions`, `POST /internal/agent/v1/chat/completions` and `GET /v1/models` answer 404; dialing the gateway's port on that address is refused; the gateway on 127.0.0.1 answers 401 without a key. The existing main-router test stays.
6. Exit (Go): with the gateway up and fake CLIs on `CLAUDE_BIN`/`CODEX_BIN`, `AgentModel` returns the gateway for `claude` and `codex`, a chat on either is `Available`, and an account whose chat provider is either reports `engineAvailable: true`.

Verification: `make test-api`; `TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration` (provider package green, the real-worker gateway tests ran, not skipped); `go vet ./...`; `GOOS=windows go vet ./internal/features/provider ./cmd`.

### `worker`: clarify in the worker, delegation, no-persist, Q-4.1 worker half (wave 1)

Owns: see the ownership table. Deps: none.

Deliverables:
1. Clarify: `tools.yaml` `clarify@core` chat `allow` (bot `block`) with its reviewed schema hash; `timely_gate` lets `clarify` through locally in a chat run and blocks it in a bot or `from_bot` run; `clarify_callback` sends `clarify.request`, waits up to `clarify_timeout_s`, and returns Hermes' reply shape; `clarify.answer`, `run.stop`, shutdown and timeout each end the wait once and send `clarify.closed`. The run continues in the same turn after the answer.
2. Delegation: the `delegation` toolset in the account's offered set; the `delegation` config floors; a `timely_delegate` plugin (or `timely_gate` additions) with `subagent_start`/`subagent_stop` hooks, the child map, the caps and shared pool, background refused, children blocked from `propose_changes`/`session_search`/`skill_manage` writes, child taint to the parent with `via: "subagent"` (decisions 5-8), `subagent` events, child `tool.call`s marked `subagent`; `delegate_task` out of `TAINT_SOURCES`; `session.delete` removes child sessions.
3. No-persist: `flags.no_persist` per decision 9, plus the seams that stop every write in the home, recorded in `TIMELY_SEAMS`.
4. Q-4.1, worker half: the provider allowlist on `run.start`, the self-test checks, and no Claude Code credential read (decision 12).
5. `PROTOCOL.md` section 11, `AGENTS.md` (testing notes for clarify and delegation), `timely_agent/README.md`, `make hermes-tools-dump` output.

Tests (stub model; the stub's `SCRIPT` makes the parent call `delegate_task` with a goal that carries the child's own directives):
- Clarify contract test: a run that calls `clarify` emits `clarify.request`; an answer resumes the same turn and the model sees `user_response`; a multi-select answer; a typed answer; an answer after the wait closed gets `ack ok: false`; `run.stop` during the wait ends it `cancelled` and the run `interrupted`; a short `clarify_timeout_s` ends it `timed_out` and the turn completes; a wait longer than Hermes' tool batch deadline does not trip it; a bot or `from_bot` run's `clarify` is blocked.
- Delegation contract tests: a batch of 3 runs; a 4th child in the same run (in one call or a later one) is refused with the cap message; `background: true` is refused; the shared pool blocks a child's 61st call; a child's `web_extract` of a fixture page adds `{kind: "web", tool: "web_extract", host, via: "subagent"}` to the parent's taint, sends `taint` and lands in `run.done.tainted_sources`; a child's `propose_changes` is blocked and never reaches Go; a child that read nothing outside adds no taint; children refused in a bot or `from_bot` run and under `no_persist`; deleting the chat deletes the child sessions; contract test 9's skipped delegate case now runs (a child's outside read stages the parent's learning).
- No-persist test: home snapshot unchanged across two Sensitive turns with a tool call (decision 9); `state.db` session count unchanged; no counters file change; nothing staged or learned; a `session_search` in another chat finds nothing from it.
- Q-4.1 tests: a `run.start` with `provider` `openai-codex`, `nous` or `copilot` is refused `bad_message`; with `anthropic` and an empty key, a fake `.claude/.credentials.json` under both the account `HOME` and `HERMES_REAL_HOME` is never sent to the stub; the self-test fails on a planted `auth.json` and on an OAuth provider in the config.

Verification: `make agent-lint`, `make agent-test`, `make agent-contract`, `make hermes-sync-check` (vendored Hermes byte-identical, 0 patch points unless the no-persist fallback needs one, which goes to the coordinator first), `make agent-go-integration`.

### `go-engine`: clarify waits in Go, delegation and Sensitive wiring, migration, TLA+, contract (wave 2; deps `gateway`)

Owns: see the ownership table. Deps: `gateway` (`AgentModelFor`).

Deliverables:
1. Migration `agent_conversation_question` with its down step; `Conversation.Question`; the `question` message kind; `TaintSource.Via`/`Child`.
2. Engine: `clarify.request` writes `question` in a fenced checkpoint and notifies (push); `clarify.closed` clears it and appends the `question` message; `Answer` sends `clarify.answer`; `subagent` events become activity lines (kind `subagent`); child taint merges through `keepTaint`, so `ForceReview` holds the next proposal in every mode.
3. Service: `POST /chats/:id/answer` (fenced, decision 2); `stop`, `remove` and `retry` clear `question`; `send`/`steer` with a pending question answer it (decision 4); rows and list items carry `question`; "Needs your answer" status word in Go's push and failure copy.
4. Lifecycle: Stop or Delete during a wait (row `stopped`, `run.stop` sent, the worker's `clarify.closed cancelled` ignored for a cleared row); a worker that exits during a wait and a lost lease (the follower gone) fail the run with Try again and clear the card; a timed-out wait leaves the run going; the follower keeps renewing the lease through the wait.
5. Delegation and clarify wiring: `runToolsets` adds `clarify` and `delegation` per decision 8; `accountSettings` offers both toolsets; `run.start.clarify_timeout_s`, with `TIMELY_AGENT_CLARIFY_TIMEOUT_S` honoured only with `DB_SCHEMA`.
6. Sensitive: `SetSensitiveNoPersist` (decision 10); with it off, a test proves Sensitive chats and photo chats (photo phases and a plan turn of a chat holding photos) claim on classic and `Available` says why; with it on, a Sensitive plan turn starts on the agent engine with `flags.no_persist`, toolsets `["timely", "todo"]`, the full history, and the model from `AgentModelFor(..., Sensitive: true)`.
7. TLA+: actions Ask (follower writes the question under its lease), Answer (the fenced commit) and CloseQuestion (timeout or cancel) in `AgentRunApply.tla`; property "no answer reaches a run after Stop, Delete or Lost"; an `AnswerFenced` guard with its anchor in `tools/coverage.go` and a mutant; coverage resynced.
8. Contract: `question` and the `subagent` activity kind in `packages/contract/src/agentChat.ts`, with pure helpers the apps share (status word, card state from a row) tested in `scripts/agent-chat.test.mjs`.

Tests (fake worker; Postgres through `CHAT_TEST_ENV`): `TestIntegrationAgentEngineClarify*` for ask → card → answer → the same run ends with its reply; stale answer 409; another account 404; Stop, Delete, worker exit and lease loss during a wait; timeout; typed message answers; one push per question; child taint (`via: "subagent"`) holds a `direct=true` proposal in Auto; routing tests for the flag off and on; an existing test per status that `question` is `{}` outside a wait.

Verification: `make test-api`; `TIMELY_AGENT_TEST_RUNTIME=dev make test-chat-integration`; `make verify-agent-runs` then `ARGS=--mutants` (every mutant caught), resync, rerun exit 0; `make test-agent-chat`; `go vet ./...`; `make agent-go-vet-windows`; `make migrate-*` up and down on a scratch schema.

### `ui`: the answer card on web, desktop and phone, sub-task lines, CLI engine copy (wave 3; deps `go-engine`)

Owns: see the ownership table. Deps: `go-engine` (the contract and the endpoint).

Deliverables:
1. Web and desktop `QuestionCard` in the thread, built like the proposal and learning cards: one to five questions; single-select rows with the recommended one marked; multi-select; an "Other" text row on every question; open questions as a text field; Send answer and Skip; sending, answered (collapsed summary), not answered in time, and stopped states; the time left. The question text renders as plain text (no links), since a tainted model can ask it. The composer's placeholder points at the card while it waits, and a typed message answers it (decision 4). "Needs your answer" in the chat header, sidebar and list.
2. Phone `QuestionCard` with the same states, in the thread and reachable from the notification; text inputs `blur()` before they unmount (memory note `timely-rn-android-focus-jump`); bottom-sheet free text where the card's inline field would be cramped at 390.
3. Activity lines of kind `subagent` on both apps.
4. Settings copy: nothing says Claude Code or Codex are classic-only; the engine rows explain CLI providers run on New through the server's CLI.
5. `scripts/mobile-assistant.test.mjs` and `scripts/audit-mobile-assistant.mjs` gain the card states and the notification route.

Verification: `make lint-chat`, `make check-format-chat`, `make typecheck`, `make lint`, `make test-agent-chat`, `make test-mobile-assistant`, `make audit-mobile-assistant`; screenshots of every card state in light and dark at desktop 1440 and phone 390 (Expo web), grouped by surface, against the worktree API on 8081 (`DB_SCHEMA=phase4ui`) and the stub model; `design:accessibility-review` on the card (focus order, labels, contrast, touch targets).

### `verify-docs`: real-worker tests, end to end, the live smoke, the plan's status (wave 4; deps all)

Owns: see the ownership table. Deps: `gateway`, `worker`, `go-engine`, `ui`.

Deliverables:
1. `engine_phase4_realworker_test.go` (skipped without `TIMELY_AGENT_TEST_RUNTIME`): with the real worker on the stub model, through Go and Postgres: clarify → card on the row → `POST /answer` → the same turn continues and proposes; Stop and Delete during the wait; the worker killed during the wait → Try again; a short timeout; a parent whose child `web_extract`s a fixture page ends with the chat tainted (`via: "subagent"`) and its `direct=true` proposal held in Auto; with the no-persist flag on, a Sensitive chat's two turns leave the account home unchanged and its model calls went through the gateway's Sensitive grant; with the flag off the same chat runs classic.
2. `ollama_shim.py` directives for `clarify` and `delegate_task` if `verify-timely` needs them.
3. `verify-timely` end to end: API 8081 (`DB_SCHEMA=phase4`, fixture pages, short clarify timeout), web 4002, Expo web 8082, the stub model; web 1440 and phone 390, light and dark: a question card answered and the reply continues; a multi-question card; Stop during a wait; Delete during a wait; a timed-out card; a delegation run with sub-task lines whose next proposal is held after a child read a page; Engine = New with a Claude Code and a Codex account (fake CLIs) answering.
4. The live smoke, Claude Code + Sonnet through the gateway only: an account on Claude Code with Engine = New gets a reply, a held proposal applied with Apply changes, and a request worded to need a decision (record whether Sonnet calls `clarify` and how the card behaved; the model choosing not to ask is a finding, not a failure).
5. Suites, all listed in contract 7, plus `make test` and `make -k test`; final `make hermes-sync-check` and `make verify-agent-runs`.
6. Docs: the plan's "Phase 4 status" in the style of phase 3's (what was built, each suite with its counts and exit code, TLA+ result, `verify-timely` scenarios, the live smoke, open items); the 5.6, 5.7 and 8.1 notes updated to what was built; ADR and `CONTEXT.md` entries if the decisions above change a recorded term (the question card, sub-tasks); the status line of this file.
7. Cleanup: test homes, scratch schemas this package created, evidence copies (git-ignored) once summarised.

## Coverage: every phase 4 item, in exactly one package

| Item (plan section 13 phase 4, Q-4.1 to Q-4.3, task list) | Package |
|---|---|
| Gateway tool-call translation tests with the fake CLI through a real worker (claude and codex) | `gateway` |
| Sensitive-capable gateway runs with ZDR | `gateway` |
| Gateway route 404 through a listener on a non-loopback address, and 404 on the main router | `gateway` |
| Q-4.1, Go half: no OAuth provider id ever emitted, Claude Code OAuth token refused as a key | `gateway` |
| Exit: `claude` and `codex` selectable with Engine = New through the gateway (Go and tests) | `gateway` |
| Q-4.1, worker half: provider allowlist, no Claude Code credential read, self-test checks | `worker` |
| `delegate_task` with caps (3 children per run, shared budget, no background, no grandchildren) | `worker` |
| Child → parent taint, including a child `web_extract` tainting the parent | `worker` |
| Children refused in bot runs (and `from_bot`, `no_persist`) | `worker` |
| Contract test 9's delegate case (a child's outside read stages the parent's learning) | `worker` |
| Clarify: the worker blocks, resumes, times out, cancels on Stop and shutdown | `worker` |
| No-persist worker path and the test that nothing is written in the home | `worker` |
| `PROTOCOL.md`, `apps/agent/AGENTS.md`, tool policy and seams | `worker` |
| Clarify: Go waiting state, answer endpoint, the run resumes, push | `go-engine` |
| Clarify: Stop, Delete, lease loss, worker exit and timeouts in Go | `go-engine` |
| TLA+ updated for the question wait (Ask, Answer, CloseQuestion; fenced answer property and mutant) | `go-engine` |
| Delegation and clarify wiring in Go (toolsets per run kind, `subagent` activity, child taint holds proposals) | `go-engine` |
| No-persist flag off by default; Sensitive and photo chats route to classic (test) | `go-engine` |
| Migration with its down step; contract types | `go-engine` |
| Clarify answer card on web and desktop | `ui` |
| Clarify answer card on the phone, with its notification route | `ui` |
| Sub-task activity lines; CLI engine copy in Settings | `ui` |
| Real-worker end-to-end tests (clarify, delegation taint, Sensitive no-persist through Go) | `verify-docs` |
| `verify-timely` on web and phone, light and dark | `verify-docs` |
| Live Claude Code + Sonnet smoke of the exit | `verify-docs` |
| Plan's phase 4 status; ADR and `CONTEXT.md` updates | `verify-docs` |

## Flagged for the coordinator or the owner

1. **No new status for a clarify wait** (decision 1). If the owner wants the chat list to treat it exactly like a held proposal (its own status, out of `busy`), it becomes a `question` status with lane-free waits, a new claim and Stop rule, and a larger TLA+ change.
2. **10-minute live wait, no parked continuation** (decision 3). An answer after the timeout is an ordinary message. A parked card (Run once style) would need plan 3.5's continuation machinery, which phase 5 builds for host cards.
3. **Delegation numbers** (decision 5): 3 children per reply in total, 60 child tool calls shared, 20 iterations and 300 s per child, no grandchildren, no background children.
4. **The no-persist flag is test-only** (decision 10). If the owner wants to try Sensitive on the new engine on a real install before phase 8, the `DB_SCHEMA` condition has to go.
5. **No-persist fallback.** If Hermes writes into the home during agent init in a way no seam stops, the fallback is a per-run scratch `HERMES_HOME` for Sensitive runs, deleted after the run, or a patch point (budget zero today, cap five). Either needs the coordinator's yes.
6. **Sensitive and CLI runs through the gateway do not stream and report no tokens or cost** (the gateway answers in one piece; usage 0). Same as classic for CLI providers.
7. **Children cannot propose or search past chats** (decision 6). A sub-task that wants to change data returns its findings and the parent proposes.
8. **Codex is never run live** (only Claude Code + Sonnet is allowed); its gateway path is proven with the fake CLI only.
9. **Gateway grants still are not rotated** (phase 2 note in 5.7); phase 5 revisits this before terminal children can reach 127.0.0.1.
10. `make audit-chat` fails at the history rename step since before phase 2; it is not used here.
