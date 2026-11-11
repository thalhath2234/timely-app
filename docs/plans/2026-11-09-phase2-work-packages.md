# Phase 2 work packages: chat on the agent engine, behind a per-account switch

- Date: 2026-11-09. Branch `feature/hermes-phase2`, stacked on `feature/hermes-phase1` (PR #291).
- Plan: `docs/plans/2026-11-08-timely-agent-from-hermes.md` (called "the plan"), section 13 "Phase 2" and the sections it cites (2, 3.4, 5.1-5.8 incl. 5.5b, 6.x, 9b "learning writes off", 10.4 f tests 6 and 18, 12). ADRs 0007, 0008, 0009, 0020, 0026.
- Phase 1 facts: `apps/agent/AGENTS.md`, `apps/agent/PROTOCOL.md`, `apps/agent/timely_agent/README.md`, `apps/api/internal/agenthost`.
- Status (2026-11-09): all seven packages built and committed on `feature/hermes-phase2` (21 commits after this document's, 0213be94). The `verify` wave ran every suite green, resynced the TLA+ model and ran the end-to-end proof; the record is plan section 13, "Phase 2 status". Open: the 84-scenario parity run with a real model (pending the owner's key) and the flagged items below.
- Update (2026-11-11): the owner chose Claude Code + Sonnet for the parity run, so no key is needed. The CLI model gateway of plan 5.7 was built for it (`provider/gateway.go`), and `AgentModel` now gives Claude Code and Codex runs a gateway endpoint; `ErrAgentEngineUnsupported` remains only for when the gateway is not running. Review rounds 1 and 2 and their fixes are in plan section 13, "Phase 2 status". Where this document says the live run waits for the owner's key, read: it runs on Claude Code.

## Binding owner answers used here

| Answer | Effect on phase 2 |
|---|---|
| Q-2.1 | The scope line "Stay within Timely ... decline writing code" is dropped **only for host-allowed accounts** (phase 2 source: `TIMELY_AGENT_HOST_ACCOUNTS`; Settings → Server arrives in phase 5). Every other account keeps it, on both engines. |
| Q-2.2 | Per-account Settings switch **Classic / New**, default **Classic**, on web and phone. |
| Q-2.3 | **No turn or time cap of Timely's own** on agent-engine chat runs (Hermes' defaults apply). Stop always ends a run. Classic keeps 12 turns / 10 minutes. |
| Q-2.4 | Keep **end-turn-then-apply**: `propose_changes` records the plan, the turn ends, Go applies or holds after `run.done`. No TLA+ change for that. |
| Q-2.5 | **Stream reply text** in web and mobile. |
| Q-2.6 | Persona name **"Timely"** (`SOUL.md`). |
| Q-P1 | New chats **Supervised**, bots **Auto**, Full Access allowed on **this desktop only** by default. |
| Q-7.12 | The combined Assistant tab is **phase 6**, not now. Phase 2 puts the Engine and Permissions cards on the existing Settings → Agent page. |

## Waves

```
wave 1:  agent-catalog   worker   agenthost          (no deps; parallel)
wave 2:  chat-core       (deps: agent-catalog, worker)
wave 3:  engine          (deps: chat-core, agenthost, worker, agent-catalog)
         web-ui          (deps: chat-core)
         mobile-ui       (deps: chat-core)
wave 4:  verify          (deps: all seven)
```

A package starts only when every dependency is committed on `feature/hermes-phase2`. In wave 3, `engine`, `web-ui` and `mobile-ui` take turns on the worktree dev servers (API 8081, web 4002, Expo web 8082): only one package runs dev servers at a time (owner rule), each with its own `DB_SCHEMA`.

## File ownership (disjoint)

| Package | Owns (only this package edits these) |
|---|---|
| `agent-catalog` | `apps/api/internal/features/agent/authority.go`, new `agent/specs.go`, `agent/permission.go`, `agent/inverse.go`, `agent/outside.go` and their `*_test.go` |
| `worker` | `apps/agent/**` except the vendored `apps/agent/hermes/**` (byte-identical, zero patch points): `timely_agent/**`, `tests/**`, `PROTOCOL.md`, `AGENTS.md`, `.hermes-sync/**` policy files, `timely_agent/README.md` |
| `agenthost` | `apps/api/internal/agenthost/**` (incl. new `agenthost/agenthosttest/`), new `apps/api/internal/features/provider/agentrun.go` + `agentrun_test.go`, `.env.example` |
| `chat-core` | `apps/api/internal/features/chat/` existing non-engine files it changes (`runner.go`, `service.go`, `model.go`, `policy.go`, `proposal.go`, `bot_tags.go`, `failure.go`, `i18n.go`, every existing `*_test.go`), new `chat/toolcall.go`, `chat/engine.go`, `chat/permission_mode.go`, `chat/undo.go`, `chat/prefs.go` (+ tests), `apps/api/migrations/**` (new files), `packages/contract/src/agentChat.ts`, `packages/contract/package.json`, `packages/contract/src/index.ts`, new `scripts/agent-chat.test.mjs`, root `Makefile` |
| `engine` | new `apps/api/internal/features/chat/engine_*.go` (+ `engine_*_test.go`), `apps/api/internal/features/chat/testdata/agent/**`, `apps/api/cmd/main.go`, new `apps/api/cmd/agent_engine.go` |
| `web-ui` | `apps/web/app/_components/chat/**`, `apps/web/app/_components/settings/agentSettings.tsx` and new `settings/agentEngine*.tsx` / `settings/agentPermissions*.tsx`, `apps/web/app/utils/api/chat.ts`, `apps/web/app/utils/api/chatStream.ts`, `apps/web/app/utils/hooks/chat.ts`, `apps/web/app/_store/chatStore.ts`, `scripts/chat-stream.test.mjs`, `docs/design-system.md` |
| `mobile-ui` | `apps/mobile/components/chat/**`, `apps/mobile/lib/chat/**`, `apps/mobile/lib/api/chat.ts`, new `apps/mobile/lib/api/chatStream.ts`, `apps/mobile/lib/hooks.ts`, `apps/mobile/app/(app)/settings/agent.tsx`, new `apps/mobile/components/settings/{EngineCard,PermissionsCard}.tsx`, `scripts/mobile-assistant.test.mjs` |
| `verify` | `.agents/skills/verify-agent-runs/**`, new `apps/api/scripts/agentqa/**`, `docs/plans/2026-11-08-timely-agent-from-hermes.md`, this file, `docs/adr/**`, `CONTEXT.md`, `.github/workflows/ci.yml` |

Shared files have exactly one owner: the Makefile (`chat-core`, which also adds the targets later packages call), the migrations folder (`chat-core`), `ci.yml` (`verify`), the contract package (`chat-core`), chat route registration (`chat-core`, through `chat.Service.Routes`), API wiring `cmd/main.go` (`engine`), `PROTOCOL.md` (`worker`).

## Shared contracts every package follows

### 1. Worker protocol additions (protocol stays version 1; fields are additive)

`worker` writes them into `apps/agent/PROTOCOL.md`; `agenthost` and `engine` implement the Go side from this list.

- `hello` gains `timely_tools: {catalog_version, tools: [{name, description, parameters, outside}]}`. Missing means no Timely tools. `catalog_version` is the sha256 of the canonical tools JSON. A changed version means the account's worker is restarted once idle (never mid-run).
- `run.start` gains `permission` (`"supervised"`, `"auto"`, `"full"`) and `flags.learning_writes` (always `false` in phase 2). `budgets` is `{}` for chat (Q-2.3: the worker uses Hermes' own default turn limit). `system_text`/`system_hash` stay the Timely block. Which Hermes argument carries it (`run_conversation(system_message=...)` or `ephemeral_system_prompt`) is the worker's decision, made with contract test 6.
- `tool.call` (worker → Go) carries real `batch_size` and `sibling_tools` (the other tool names in the same assistant message) and the run's `tainted_sources`.
- `tool.result` (Go → worker) gains `end_turn` (bool). Go sets it after a recorded `propose_changes`. The worker then lets the model write one closing sentence and interrupts the turn if the model calls another tool (Q-2.4).
- `taint` (worker → Go) is live in phase 2: `{run, sources: [{kind, tool, host?, session?}]}`, sent for each new outside source the worker sees (a Hermes-side tool the policy file marks as a taint source, or a Timely `tool.result` with `outside: true`). Go merges sources into `agent_conversations.tainted_sources` (append-only, deduplicated).
- `event` `delta`: the worker coalesces stream text and sends at most one `delta` per 50 ms or 200 characters, payload `{text}` (a chunk, never the whole reply).
- `gate.ask` verdicts in phase 2: `block` for every tool outside the worker's local allow list and the `timely` toolset, message "That isn't available in Timely yet". Host tools, web, browser, memory and `skill_manage` writes are off.
- Phase 2 toolsets for a chat run: `["timely", "todo", "skills"]`. `skill_view`/`skills_list` read only. `skill_manage` writes are blocked by `timely_learning` while `learning_writes` is false. `memory` is not offered (`skip_memory=True`).

### 2. Database (`chat-core` writes the migrations with `make migrate-create NAME=...`)

`agent_conversations` new columns:

| Column | Type / default | Meaning |
|---|---|---|
| `engine` | `text not null default ''` | per-chat override: `''` follows the account, `'classic'`, `'agent'` |
| `run_engine` | `text not null default ''` | engine of the current or latest run (set at claim) |
| `permission` | `text not null default 'supervised'`, check `in ('supervised','auto','full')` | the chat's permission mode; existing rows become `supervised` |
| `agent_run_id` | `text not null default ''` | live agent run id; empty when no agent run is live |
| `agent_instance` | `text not null default ''` | worker identity (`<pid>:<start unix ms>`) that runs it |
| `activity` | `jsonb not null default '{}'` | `{run, lines: [ActivityLine], draft}`; written at most once a second per chat |
| `run_reads` | `jsonb not null default '{}'` | the per-run reads store (`recordRead` hashes), persisted because the run lives outside Go |
| `tainted_sources` | `jsonb not null default '[]'` | append-only per chat; cleared only by deleting the chat |

`host_request` and `from_bot_id` (plan 5.4) are **not** added in phase 2; they land with phases 5 and 6. The NOTIFY trigger is not changed (activity checkpoints notify; Go throttles them).

New table `agent_chat_settings`: `user_id text primary key` (removed with the account), `engine text not null default 'classic'` check `in ('classic','agent')`, `chat_permission text not null default 'supervised'`, `bot_permission text not null default 'auto'`, `full_access_allowed_on text not null default 'desktop'` check `in ('desktop','devices')`, `created_at`, `updated_at`. `bot_permission` is stored now and read from phase 6.

### 3. HTTP API (`chat-core`; all signed-in, account-scoped, not-found across accounts)

- `GET /agent/chat-settings` → `{engine, chatPermission, botPermission, fullAccessAllowedOn, engineAvailable, engineReason}`.
- `PATCH /agent/chat-settings` with any of `{engine, chatPermission, botPermission, fullAccessAllowedOn}`.
- `POST /chats` accepts optional `permission` (else the account's `chatPermission`).
- `PATCH /chats/:id` accepts `permission` and `engine` (`""`, `"classic"`, `"agent"`). A looser mode never approves cards already waiting; a stricter mode takes effect at the next tool call. `engine` waits for the current run, like context.
- `POST /chats/:id/steer {text}`: only while an agent run is live; stored as a user message with `kind: "steer"` and passed to the engine. 409 otherwise.
- `POST /chats/:id/undo {revision, messageId}`: undoes a proposal that was applied on its own (Auto or Full Access) by queuing its inverse plan through the normal model-free apply.
- `GET /agent/tool-specs` → `{catalogVersion, tools}`: exactly what the worker receives in `hello` (the "spec endpoint").
- Conversation JSON gains `permission`, `engine`, `runEngine`, `activity`, and on proposal messages `autoApplied`, `undoneAt`, `undoMessageId`. `errorAction` gains `"use_classic"` (the run failed because the agent engine could not start; the apps show "Use classic for this chat", which sends `PATCH {engine:"classic"}` then Retry).

### 4. Live stream (Q-2.5)

`GET /chats/watch` keeps its `changed` events and gains one event:

```
event: delta
data: {"type":"delta","kind":"chat","id":"<conversation id>","document":{"run":"<run id>","offset":<characters before this chunk>,"text":"<chunk>"}}
```

Clients keep a per-run draft: `offset == draft.length` appends; `offset < draft.length` drops the overlap; `offset > draft.length` (a missed chunk) refetches the chat and continues from `activity.draft`. The final reply always arrives as a normal `changed` row; the draft is discarded then. Deltas are published only on the API process that runs the follower; other processes and late joiners see `activity.draft` (throttled to 1 s).

### 5. Go seams inside package `chat` (`chat-core` defines, `engine` implements and calls)

```go
// chat/engine.go (chat-core)
type AgentEngine interface {
    // Available says why this chat cannot use the agent engine now (nil = it can):
    // runtime missing, worktree without DB_SCHEMA, CLI provider, Sensitive, photo phases.
    Available(ctx context.Context, uid string, c *Conversation) error
    // Start sends run.start for a claimed row whose lease the lane holds and returns as soon as
    // the worker accepted it. From then on the engine's follower renews the lease and writes
    // every checkpoint; the lane goes back to claiming (Q-2.3: no Timely cap, so no lane is held).
    Start(ctx context.Context, c *Conversation) error
    // Lost handles a claimed agent row whose lease expired: re-attach when this process still
    // follows the run, else fail it with Try again (plan 5.4 lost-run rule).
    Lost(ctx context.Context, c *Conversation) error
    Stop(uid, cid, runID string)                          // after Stop or Delete committed
    Steer(ctx context.Context, uid, cid, runID, text string) error
    Forget(uid, cid string)                               // after Delete: session.delete
}
func (s *Service) SetAgentEngine(e AgentEngine)
```

Helpers `chat-core` exposes to `engine` (unexported, same package):

- `s.toolCall(ctx, c, run *toolRun, name string, args json.RawMessage, batch int, siblings []string) (result json.RawMessage, outside bool, err error)`: today's per-call branch of `plan()` (authority, Sensitive, answer-only refusal, `fetchGuard`, `maxAsks`, `resolve_target`, outside marking via `agent.OutsideTool`, `localizeTimes`, the 90,000-byte cap, `recordRead`).
- `s.prepareAgentProposal(ctx, c, run, args, batch)` → `pendingProposal` (prepareProposal, rehearsal, review notes, target feedback, previews; refuses when `batch != 1` with today's message). Nothing is written.
- `s.finishTurn(ctx, c, reply string, pending *pendingProposal, run *toolRun)`: the one checkpoint that ends a turn (reply message, or proposal + reply with status from `proposalStatus`), used by classic `plan()` and by the engine after `run.done`.
- `proposalStatus(row, steps, direct, notes) (status string)`: the permission decision (section 6 below).
- `s.turnInput(ctx, c) string` (chips, `get_context`, time notice, notices since the last turn, tag notice) and `instructionFor(hostAllowed bool) string` (the instruction with or without the scope line, byte-identical to today when `false`).
- `s.renewLease(ctx, uid, cid, lease string) bool` (same SQL as `keepLease`).
- `toolRun` with `load(c)`/`save(row)` against `run_reads`.
- `AgentToolSpecs(catalog agent.Catalog) (version string, tools []agent.ToolSpec)`: `agent.ChatReadSpecs` plus `propose_changes` and `resolve_target`.
- i18n keys added by `chat-core` for `engine`: `txtAgentLost` ("This run stopped when the agent restarted. Try again."), `txtAgentUnavailable` ("The new engine could not start: %s"), `txtUndone`, `txtSteered`.

### 6. Permission semantics for Timely data in phase 2 (plan 5.5b)

A recorded proposal is **held** (status `approval`) when any of these is true, otherwise it applies at once through the existing direct path (status `queued`, phase `apply`) and is shown as applied with Undo:

1. the chat is `supervised`;
2. the chat is Sensitive, or `tainted_sources` is non-empty (`ForceReview`, critical item 6), or Jev added review notes, or it edits a recurring series (today's rules);
3. any step is on the critical list (`agent.Critical`), or its tool's authority says `NeedsProposal(args)` (ADR 0007 per-tool floors stay);
4. any step has no inverse (`agent.Inverse`), so Undo could not exist.

`auto` and `full` behave the same for Timely data in phase 2: the model's `direct` flag no longer decides anything. The mode applies on **both engines** (one rule everywhere). Full Access step-up, the "Allowed on" enforcement and host-tool behaviour arrive in phase 5 with the shell token; until then the server stores `full`, the web/desktop picker offers it with a one-time confirmation, the phone shows it disabled ("Turn on from the desktop app"), and its description must not promise "never asks" while critical data changes still ask.

**Critical list** (`agent/permission.go`, Go is the source of truth; one test per item):

1. Deleting or overwriting: Timely deletes (checklist items, calendar blocks, sheet rows/columns/tabs), bulk changes over 10 items, whole-content replacements (`update_doc` body, `update_sheet` arrays); host forms (`rm -r`, overwrite outside the workspace) are classified now and wired in phase 5.
2. Sending the person's data out: email, posts, form submits, uploads, requests to a host not seen in the person's messages, search results or the bot's own hosts.
3. Buying, paying or signing in.
4. Installing software (package managers, `pip`/`npm`/`cargo`, skill dependency installs).
5. Changing settings or permissions (Timely settings, the agent's config, MCP servers, `chmod`/`chown`, the permission mode itself; creating or changing a Bot).
6. Changes after reading outside pages (tainted conversation).

Contract copy (`packages/contract/src/agentChat.ts`, used by both apps): mode names and descriptions, the six "Auto always asks before" rows with their sub-lines as drawn in `Option1Permissions.dc.html`, `applyDelta(draft, event)`, and the types `PermissionMode`, `ChatEngine`, `ActivityLine {id, kind: "tool"|"status", label, state: "running"|"done"|"failed", at}`, `ChatActivity {run, lines, draft}`, `ChatDelta`, `AgentChatSettings`.

### 7. Make targets (`chat-core` adds them; others only call them)

- `test-agent-chat`: `node --experimental-strip-types --test scripts/agent-chat.test.mjs` (contract helpers), added to `make test`.
- `agent-record-fixtures OUT=<dir>`: runs `worker`'s `apps/agent/tests/record_events.py` with the agent venv and the stub model, writes JSONL fixtures to `OUT`.
- `agent-parity ENGINE=classic|agent|both PROVIDER=<id> MODEL=<id> SCENARIOS=<file> OUT=<dir> [ONLY=<ids>]`: `cd apps/api && go run ./scripts/agentqa ...` against `TIMELY_API` (default `http://localhost:8081`); the key comes from `TIMELY_PARITY_KEY` in the caller's environment, never from `.env`. `verify` implements the program to this interface.
- Existing targets used: `test-api`, `test-chat-integration`, `lint-api`, `agent-install`, `agent-test`, `agent-contract`, `agent-lint`, `agent-go-integration`, `agent-go-vet-windows`, `hermes-sync-check`, `typecheck-web`, `typecheck-mobile`, `lint-web`, `test-chat-stream`, `test-mobile-assistant`, `verify-agent-runs`.

### 8. Rules for every package

- Export `GOTMPDIR=$HOME/.cache/gotmp TMPDIR=$HOME/.cache/gotmp UV_CACHE_DIR=$HOME/.cache/uv` (create the folders).
- Never touch `~/.hermes`. Never use ports 8080 or 4001: worktree API 8081 with `DB_SCHEMA=<package name>`, web 4002, Expo web 8082.
- No live AI provider anywhere: tests and app runs use `apps/agent/tests/stub_openai.py` (or the Go fake worker). Never use the OpenRouter key in `.env`; never print or copy `.env` values; never commit `.env`.
- `apps/agent/hermes/**` stays byte-identical (patch-point budget zero, cap five). `make hermes-sync-check` must still pass.
- Commit only your own paths (`git add <paths>`), messages `area: what changed` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; retry on `index.lock`. No push, no PR, never touch `dev`.
- UI packages load the `design:design-system` and `design:design-critique` skills before changing UI, build from the shared kit, keep the only shortcuts Ctrl/Cmd+K and Ctrl/Cmd+Shift+J with no key hints, and attach light **and** dark screenshots that show the behaviour (before and after), not only the end state.
- `make verify-agent-runs` may report DRIFT (exit 3) or MODEL MISMATCH (exit 2) after `chat-core` and `engine`: record it in the result; `verify` updates the model and resyncs. A property violation with all guards present (exit 1) is a bug to report.

---

## Packages

### `agent-catalog`: Timely tool specs, the critical list, inverses (wave 1)

**Owns:** `apps/api/internal/features/agent/authority.go`, new `agent/specs.go`, `agent/permission.go`, `agent/inverse.go`, `agent/outside.go`, and their tests.

**Deliverables**

1. **Spec endpoint, catalog half** (plan 5.2, 5.8 "spec endpoint added"): `type ToolSpec struct{Name, Description string; Parameters any; Outside bool}`; `ChatReadSpecs(c Catalog) []ToolSpec` (every tool whose authority is Read, sorted by name, the same specs classic offers today); `SpecsVersion([]ToolSpec) string` (sha256 of canonical JSON). MCP-only and Write tools never appear.
2. **Outside classification** (plan 5.2, 9b.5): `OutsideTool(name string) bool`, moving today's `outsideReads` set (`chat/bot_tags.go:42`: `preview_bot`, `ask_bot`, `list_bot_findings`, `list_bots`) here and classifying every Read tool explicitly (e.g. a field on the authority declaration). A test enumerates all Read tools and fails when one has no taint classification.
3. **Critical list** (plan 5.5b): `type Mode`, `type Action{Tool string; Args map[string]any; Items int}`, `Critical(a Action) (item int, reason string, ok bool)`, and the host-action form for phase 5 (`HostAction{Kind, Command, Path, URL}`) so items 2-5 are testable now. One test per item (six named tests), plus a test that enumerates every Write tool and fails when one is not classified critical/non-critical.
4. **Inverses for Undo**: `Inverse(tool string, args, result, before json.RawMessage) (steps []InverseStep, ok bool)` for each Write tool where Go can restore the previous state (create → remove the created object through the owning service, update → restore `before` fields, move/schedule → restore). Tools with no safe inverse return `ok=false` (they are then held in Auto). Tests per tool family.

**Tests and commands:** `go test ./internal/features/agent/...`, `make lint-api`, `make test-api`. No database needed except where an existing integration test already uses one.

---

### `worker`: Timely tools, gate, persona and prompt in the worker (wave 1)

**Owns:** `apps/agent/**` except `apps/agent/hermes/**`.

**Deliverables**

1. **`timely_tools` plugin** (plan 5.2): read `hello.timely_tools` before plugins load; `ctx.register_tool` each spec under toolset `timely`; the handler sends `tool.call` through `bridge.ask` with `session_key`, `tool_call_id`, `args`, `tainted_sources`, `batch_size`, `sibling_tools` (found from the assistant message that produced the call; document the seam used), and returns Go's `result`. `outside: true` adds a source to the run's taint list and sends `taint`. `end_turn: true` asks the host to end the turn after this round (one closing sentence allowed; any further tool call interrupts the turn), Q-2.4. Write tools are never registered.
2. **`propose_changes` alone in its batch** (plan 3.4 step 8): `timely_gate`'s `pre_tool_call` blocks `propose_changes` with "Call propose_changes alone, after all read tools finish" when it is not the only call in its assistant message, before any sibling runs. **Contract test 18**: (a) a batch of `propose_changes` + a read is blocked and the read did not run first; (b) after a stub tool the policy marks as a taint source, a `direct=true` proposal's `tool.call` carries non-empty `tainted_sources` (the `web_extract` variant is re-run in phase 3 when web tools exist).
3. **Taint message** (plan 5.2, 9b.2): `timely_learning` `post_tool_call` sends `taint` for each new source from a tool the policy marks as taint source; `run.done` and every `tool.call` carry the full list; a test proves a restarted worker given `tainted_sources` in `run.start` keeps them.
4. **SOUL.md persona** (Q-2.6): the default `soul` in `config_render` becomes Timely's identity named "Timely" (tone from today's instruction, no Hermes branding). Contract test 6 asserts "You are Hermes Agent" is absent and "Timely" is the identity.
5. **Prompt layout 5.3 decision** with **contract test 6** completed: two turns plus a forced rebuild from `state.db`; assert the system prompt prefix (identity + Timely block) is byte-identical across both turns and after the rebuild, for both `run_conversation(system_message=...)` and the constructor's `ephemeral_system_prompt`; pick the one that passes both (a) and (b), make `run_chat.py` use it, record the evidence and the choice in `PROTOCOL.md` and `timely_agent/README.md`.
6. **Learning writes off, host tools off** (plan 9b, phase 2): toolsets `timely`, `todo`, `skills` only; `skip_memory=True`; `timely_learning` blocks every `skill_manage` write while `flags.learning_writes` is false (test); `timely_gate` blocks everything outside the local allow list and the `timely` toolset when Go says `block` (phase 2 Go always does). Accept and store `permission` from `run.start` (not acted on in phase 2).
7. **Q-2.3**: no Timely turn cap. `run_chat.DEFAULT_MAX_ITERATIONS` stops overriding Hermes: with `budgets` empty the agent gets Hermes' own default from config. Test that an empty budget yields Hermes' default.
8. **Streaming** (Q-2.5): coalesce `delta` events (at most one per 50 ms or 200 characters, never dropping text; flush before `run.done`). Test with the stub model streaming many small chunks.
9. **Auxiliary-credential check** (plan 5.7): a contract test with two stub endpoints and two keys proves compression (and any other auxiliary call that can fire in phase 2: vision, learning are off; titles are floored off) uses the run's `base_url`/`api_key`, not the environment. If Hermes reads env instead, make it use the run credentials inside the worker without a vendored edit; if that is impossible, stop and report exactly which env names are needed (the `engine` package would then pass them as `AccountSpec.ToolKeys`).
10. **`tool_search` off vs on measured** (plan 1.4): with the stub model and the full Timely spec list, measure prompt bytes/tokens of turn 1 and turn 2 and whether Timely tools stay directly callable with `tools.tool_search` off vs on; keep the managed floor at the measured decision (expected off); write the numbers in `timely_agent/README.md`.
11. **`context_engine` evaluated** (plan 2): run a long stub conversation with and without the bundled `context_engine` plugin, compare compression behaviour, prompt sizes and side calls; write the evaluation and recommendation in `timely_agent/README.md`. Leave it disabled unless the measurement shows a clear gain; adopting it changes `selftest.EXPECTED_PLUGINS` and the managed floors in this package.
12. **Fixture recorder** for `engine`: `apps/agent/tests/record_events.py --out <dir>` runs the real worker against the stub model with a minimal Go stand-in that answers `tool.call`/`gate.ask`, and writes one JSONL file per scenario (worker → Go lines): plain reply with streamed deltas; read tool then reply; `propose_changes` then closing sentence (`end_turn`); outside Timely read then `direct=true` proposal; Stop mid-stream; steer mid-run; a blocked non-Timely tool.
13. **`PROTOCOL.md`** updated with every addition in "Shared contracts 1".

**Tests and commands:** `make agent-install` (if needed), `make agent-lint`, `make agent-test`, `make agent-contract` (10 runs in a row for tests 6 and 18), `make hermes-sync-check`, `make agent-go-integration` (must still pass with the phase 1 Go side). Confirm `git diff --stat apps/agent/hermes` is empty.

---

### `agenthost`: worker plumbing and agent-run credentials (wave 1)

**Owns:** `apps/api/internal/agenthost/**` (incl. new `agenthost/agenthosttest/`), new `apps/api/internal/features/provider/agentrun.go` + test, `.env.example`.

**Deliverables**

1. **Tool specs in `hello`**: `Config.TimelyTools func(ctx context.Context) (version string, tools json.RawMessage, err error)`; `hello` carries `timely_tools`; `Config.CatalogVersion` comes from it; an idle worker whose catalog version is stale is restarted before its next run (never mid-run). Update `doc.go`.
2. **Engine availability** (plan 6.7, 13 intro): `Available() error` on the supervisor: runtime missing (with the reason), or a worktree API started without `DB_SCHEMA` (detect a git worktree checkout), or the supervisor closed. Errors carry a person-readable reason for Settings and the failed-run card.
3. **Host-allowed fallback** (plan 11.2, Q-2.1): `HostAccounts(getenv) func(uid string) bool` reading `TIMELY_AGENT_HOST_ACCOUNTS` (comma-separated account ids); add it to `.env.example` with a comment that Settings → Server replaces it in phase 5. At most one account is honoured on the local backend (plan 12); a second is ignored with a log line.
4. **Go fake worker kit** (`agenthost/agenthosttest`, phase 2 verification "Go httptest fake worker"): an exported, scriptable fake that speaks protocol 1 without Python, usable from other packages' tests (`chat`): it answers `hello` with a passing `ready`, replays a JSONL fixture for each `run.start` (substituting run ids), waits for `tool.result`/`gate.verdict` where the fixture says so, honours `run.stop` (ends with `run.done {interrupted}`), `run.steer` (ack + recorded), `session.delete`, and can simulate a crash mid-run. It plugs into a real `Supervisor` (re-exec of the test binary or an in-process transport; the kit decides and documents it). Tests in `agenthost` prove each behaviour.
5. **Agent-run credentials** (plan 5.7): `func (s *Service) AgentModel(ctx, uid, provider, model string) (AgentModel, error)` returning `{Provider, Model, BaseURL, APIKey, APIMode, Reasoning}` for every API-key provider in the registry (OpenAI-compatible, Anthropic, Responses-route models, custom URL, Ollama) and **OpenRouter direct** (base URL and key from the account's settings, decrypted). Map Timely routes to Hermes `api_mode` names (read them from the vendored `hermes:` code, cite file:line). CLI providers (`claude`, `codex`) return `ErrAgentEngineUnsupported` ("Claude Code and Codex use the classic engine until a later update"). Selection stays in Go (ADR 0019/0020): no default fallback. Tests with stored stand-in keys and a fake registry; never a live provider.

**Tests and commands:** `go test ./internal/agenthost/... ./internal/features/provider/...`, `make agent-go-vet-windows`, `make lint-api`, `make agent-go-integration` (real worker still passes; it ignores `timely_tools` until `worker` lands, and passes after).

---

### `chat-core`: toolcall extraction, engine seam, permission modes, settings (wave 2; deps `agent-catalog`, `worker`)

**Owns:** see the ownership table (chat files except `engine_*`, migrations, contract module, `scripts/agent-chat.test.mjs`, Makefile).

**Deliverables**

1. **`chat/toolcall.go` extracted, no behaviour change** (plan 5.2, 5.8): move the per-call branch of `plan()` (`runner.go` `plan` lines ~451-610) and the per-turn input pieces into `toolCall`, `prepareAgentProposal`, `finishTurn`, `turnInput`, `toolRun` (Shared contracts 5). Classic `plan()` calls them. Split the `instruction` constant so `instructionFor(false)` is byte-identical to today and `instructionFor(true)` drops only the scope line (Q-2.1). Prove no behaviour change: existing chat unit and integration tests pass unchanged; add a golden test that classic sends byte-identical prompts and tool results before and after for a recorded set of calls (read, outside read, answer-only refusal, write tool called directly, unknown tool, oversize result, `propose_changes` in a batch, `ask_bot` over `maxAsks`).
2. **Bot tags as a verdict** (plan 5.6, 5.8): answer-only stays enforced in `toolCall` for both engines (`answerTools`), `bot_tags.go` reads outside marks from `agent.OutsideTool`.
3. **Engine seam** (Shared contracts 5): `chat/engine.go` (`AgentEngine`, `SetAgentEngine`). In `work()`: resolve the engine at claim (`engine` override, else the account's `agent_chat_settings.engine`; Sensitive chats, image phases `extract`/`receipt_plan`/`receipt_edit` and `apply` always run classic); set `run_engine`; for an agent `plan` run call `Available` (an error fails the run with `errorAction: "use_classic"` and the reason, never a silent switch) then `Start`, with **no 10-minute context** (Q-2.3) and without holding the lane; for a claimed `running` row with an expired lease and a non-empty `agent_run_id` call `Lost`. Classic keeps its 12 turns and 10 minutes. `service.go`: `stop` and `remove` call `Stop`/`Forget` after commit; `retry` clears `agent_run_id`; new `POST /chats/:id/steer`.
4. **Migrations** (Shared contracts 2) with model fields and JSON output; a migration test on a fresh schema.
5. **Account settings** (Q-2.2, Q-P1): `chat/prefs.go` with `GET/PATCH /agent/chat-settings` (validation, defaults Classic / Supervised / Auto / desktop; `engineAvailable`/`engineReason` from `AgentEngine.Available`, or "not available" when no engine is set); `POST /chats` uses `chatPermission`; `PATCH /chats/:id` accepts `permission` and `engine` (rules in Shared contracts 3).
6. **Permission modes for Timely data** (plan 5.5b, Shared contracts 6): `proposalStatus` in `chat/permission_mode.go`, used by `finishTurn` on both engines: Supervised holds every proposal; Auto and Full Access apply non-critical, undoable proposals at once and mark the summary `autoApplied`; `ForceReview` from non-empty `tainted_sources` (and today's `run.outside` on classic, which now also appends to `tainted_sources`). Tests: one per held reason, Supervised holds a `direct=true` single create, Auto applies it, Auto holds each critical item, a looser switch never approves a waiting card, a stricter switch holds the next proposal.
7. **Undo** (`chat/undo.go`, `POST /chats/:id/undo`): builds the inverse plan from `agent.Inverse` over the done steps (reverse order), refuses when an object changed since (snapshot check) or the group was already undone, and queues it as a normal plan through `apply` (model-free, lease-fenced; the TLA+ apply property is unchanged in shape). Integration test: Auto applies a create, Undo removes it, a second Undo is refused.
8. **Spec endpoint, chat half**: `AgentToolSpecs(catalog)` and `GET /agent/tool-specs`.
9. **Contract module** `packages/contract/src/agentChat.ts` (Shared contracts 6) exported from `package.json`, with `scripts/agent-chat.test.mjs` (delta apply, copy present for every mode and critical row).
10. **Makefile targets** (Shared contracts 7).
11. i18n keys for `engine`; `failure.go` action `use_classic`.

**Tests and commands:** `make test-api`, `make test-chat-integration` (uses `.env` DB settings through the Makefile; do not print them), `make lint-api`, `make test-agent-chat`, `make typecheck-web typecheck-mobile` (contract compiles in both apps), `make verify-agent-runs` (record the exit code; DRIFT/MISMATCH expected, handed to `verify`).

---

### `engine`: `chat/engine_agent.go` and its wiring (wave 3; deps `chat-core`, `agenthost`, `worker`, `agent-catalog`)

**Owns:** new `apps/api/internal/features/chat/engine_*.go` and tests, `chat/testdata/agent/**`, `apps/api/cmd/main.go`, new `apps/api/cmd/agent_engine.go`.

**Deliverables**

1. **`AgentEngine` implementation** using `agenthost`:
   - **Run start** (plan 3.4 steps 3-5): fix provider/model at claim (unchanged rule), `AgentModel` credentials, Timely block = `instructionFor(hostAllowed)` + `clientNote` + `replyCards` + write tool schemas + `timely` skill pointer (byte-stable per conversation; hash in `system_hash`), user message = `turnInput`, `run.start` with session key `timely:<uid>:<conversation>`, toolsets `timely,todo,skills`, flags (sensitive false, answer_only from tags, web false, rich_ui, from_bot false, learning_writes false), `permission`, empty budgets (Q-2.3), persisted `tainted_sources`, history seed from Postgres messages only when the worker reports the session missing. Writes `agent_run_id`, `agent_instance`.
   - **Event follower** (plan 3.4 step 6, 5.4): one reader per worker through `Config.Handler`; maps `delta`, `tool.started`, `tool.completed`, `status`, `reasoning` to `activity` and the live stream; renews the lease while the run is live (`renewLease`); a fenced checkpoint failure (Stop, Delete, lease lost) sends `run.stop`.
   - **Activity throttle**: activity-only checkpoints at most once per second per conversation; deltas published to the Hub immediately (Shared contracts 4) and into `activity.draft` at the throttle.
   - **`tool.call` → `toolCall`**, answering within 25 s (`preview_bot` uses the tool timeout path), `tool.result {result, outside, end_turn}`; `propose_changes` → `prepareAgentProposal` (alone-in-batch second line) → `end_turn: true`; `taint` → merge into `tainted_sources`; `gate.ask` → phase 2 verdict `block` for everything (answer-only and web-off are covered by that).
   - **`run.done`** → `finishTurn` (reply, or the recorded proposal held or applied per `proposalStatus`, Q-2.4 end-turn-then-apply); usage recorded; `agent_run_id` cleared.
   - **Stop** (`run.stop`, `interrupted` → today's stopped notice), **steer** (`run.steer`), **Forget** (`session.delete`).
   - **Lost-run rule** (plan 5.4, ADR 0008): `Lost` re-attaches when this process still follows the run; otherwise fails with Try again (`txtAgentLost`). `OnExit` fails every live run of a dead worker the same way.
   - **Available**: `agenthost` availability, `ErrAgentEngineUnsupported` for CLI providers without the gateway (see the 2026-11-11 update), Sensitive and photo phases.
2. **Wiring** in `cmd/main.go` / `cmd/agent_engine.go`: supervisor from `agenthost.ConfigFromEnv` with `TimelyTools` = `chat.AgentToolSpecs`, `Account` = rendered settings (toolsets, timezone, learning off; provider keys in `ToolKeys` only if `worker` reported auxiliary calls need env), `Handler`/`OnExit` to the engine, `Prepare` at start, shutdown before the database closes, `chatService.SetAgentEngine`. The API must start and serve classic exactly as before when the runtime is missing.
3. **Recorded event fixtures**: run `make agent-record-fixtures OUT=apps/api/internal/features/chat/testdata/agent` and commit them.
4. **Go unit tests mapping fixtures to conversation updates** (phase 2 verification): each fixture replayed through the follower yields the expected row (messages, status, activity lines, draft, tainted_sources, proposal held/applied).
5. **Fake-worker integration tests** (named `TestIntegration...` so `make test-chat-integration` runs them without Python), using `agenthosttest`: plain reply with streamed deltas reaching a `/chats/watch` subscriber; read tool round trip; proposal in Supervised ends in `approval` and Approve applies it; the same proposal in Auto applies at once and Undo reverts it; **outside Timely read then a `direct=true` proposal ends in `approval` and Approve then applies it**; Stop mid-run ends the run and no step applies; steer reaches the worker; worker crash → Try again; activity checkpoints ≤ 1 per second under a burst of 200 events; no Timely data changes without a proposal (row counts unchanged across reply-only and refused runs).
6. Run the real worker once end to end (`make agent-go-integration`-style, stub model) through the engine to prove the fixtures match reality.

**Tests and commands:** `make test-api`, `make test-chat-integration`, `make lint-api`, `make agent-go-integration`, `make verify-agent-runs` (record exit code for `verify`).

---

### `web-ui`: Engine, Permissions, chip, streaming and activity on web and desktop (wave 3; deps `chat-core`)

**Owns:** see the ownership table.

**Before building:** load `design:design-system` and `design:design-critique`; read `apps/web/AGENTS.md` (Next.js 16 differs from training data; read `node_modules/next/dist/docs/`), `docs/design-system.md`, `apps/web/app/_components/_ui/groupedList.tsx`; follow `Option1Permissions.dc.html` and the perm chip in `Main.dc.html` (screenshots `Option1Permissions-{light,dark}.png` in the scratchpad `shots/` folder).

**Deliverables**

1. **Settings → Agent → Engine** card (grouped rows): Classic / New, default Classic; when New is chosen but unavailable, a row with `engineReason`.
2. **Settings → Agent → Permissions** card (the drawn "Settings › Assistant" panel, placed on the Agent tab until phase 6): rows New chats (chip, default Supervised) and Bots (chip, default Auto), each opening the three-way picker; the "Auto always asks before" list (six rows from the contract); Full Access group (Turning it on asks for, Allowed on: This desktop, Activity log row hidden until it has content) and the floor note.
3. **Composer permission chip** (green eye Supervised, indigo shield Auto, amber bolt Full Access) opening the **popover picker** (three options with descriptions, footer "Only this chat. New chats start on …" + Change default). Full Access asks a one-time confirmation naming what it lifts, and its copy matches phase 2 behaviour. New chats use the account default.
4. **Streaming reply text** (Q-2.5): `chatStream.ts` passes `delta` events; the open chat renders the draft as it grows (`applyDelta`), replaced by the final message on `changed`; works across tabs (BroadcastChannel path) and after reconnect (refetch on gap).
5. **Activity lines** while a run is live, and the drawn "Ran on its own · Auto" card with **Undo** on auto-applied proposals.
6. **Failure card** action "Use classic for this chat" (`errorAction: "use_classic"`), engine badge where the chat shows its model, and **steer**: sending while an agent run is live posts `/steer` (the message shows as part of the run).
7. Tests in `scripts/chat-stream.test.mjs` for delta handling (append, overlap, gap → refetch, cross-tab relay).

**Proof:** worktree API 8081 (own `DB_SCHEMA`) + web 4002 with the stub model; screenshots light and dark of Settings → Agent (both cards), chip + open picker, Full Access confirmation, a held proposal in Supervised, the same request auto-applied in Auto with Undo (before and after Undo), streaming text mid-reply (two frames) when the `engine` package is committed, otherwise from a scripted SSE in a test page; desktop and narrow widths.

**Tests and commands:** `make typecheck-web`, `make lint-web`, `make test-chat-stream`, `make test-agent-chat`, `make lint-chat`.

---

### `mobile-ui`: the same on the phone (wave 3; deps `chat-core`)

**Owns:** see the ownership table.

**Before building:** load `design:design-system` and `design:design-critique`; read `apps/mobile/AGENTS.md` (Expo SDK 57 docs); build from `components/settings/SettingsList.tsx`; follow `Option1PermissionsPhone.dc.html` (screenshots `Option1PermissionsPhone-{light,dark}.png`). Compact on phone; inputs at the bottom lift themselves (Android does not resize for the keyboard).

**Deliverables**

1. **Settings → Agent**: Engine card (Classic / New) and Permissions card (New chats, Bots, "Auto always asks before" rows, Full Access rows) as grouped rows.
2. **Permission chip in the chat header** (as drawn) opening a **bottom sheet picker** with the three modes and "Default for new chats" row. Full Access shows disabled with "Turn on from the desktop app" in phase 2 (no device-unlock step-up until phase 5).
3. **Streaming reply text**: new `lib/api/chatStream.ts` subscribes to `/chats/watch` (Bearer auth, `readSSE` from `lib/api/watch.ts`) while a chat is open with a live run, applies `delta` events with the contract helper, falls back to the current polling when the stream cannot be read.
4. **Activity lines**, the auto-applied card with **Undo**, "Use classic for this chat", engine label next to the model, and **steer** (sending while an agent run is live).
5. Tests added to `scripts/mobile-assistant.test.mjs` (delta handling, chip/mode mapping, Full Access disabled rule).

**Proof:** Expo web at 390 px on port 8082 against API 8081, light and dark: Settings → Agent, the header chip and open sheet, held vs auto-applied proposal with Undo before/after, streaming mid-reply (when `engine` is committed). If a native check is needed use `make emu-start`/`make emu-stop` only, and never `make install-apk` without the owner's words.

**Tests and commands:** `make typecheck-mobile`, `make test-mobile-assistant`, `make test-agent-chat`.

---

### `verify`: TLA+, parity harness, end-to-end run, docs (wave 4; deps all)

**Owns:** `.agents/skills/verify-agent-runs/**`, `apps/api/scripts/agentqa/**`, `docs/plans/2026-11-08-timely-agent-from-hermes.md`, this file, `docs/adr/**`, `CONTEXT.md`, `.github/workflows/ci.yml`.

**Deliverables**

1. **TLA+** (plan 5.5b, 5.8, phase 2 exit "TLA+ coverage resynced"): update `AgentRunApply.tla` for the new claim (engine choice, agent hand-off without a lane, follower lease renewal, `Lost`) and the new `service.go` functions; add constant `Mode` and property **SupervisedHolds**: "a proposal recorded in Supervised never applies without Approve", with a guard anchored on `proposalStatus` and a mutant that removes it. Update anchors in `tools/coverage.go`, cover the follower's lease renewal and `finishTurn`, run `make verify-agent-runs ARGS=--mutants`, commit, then `--resync`. Q-2.4 needs no apply change.
2. **Parity harness entry point** (the 84-scenario live run itself is OUT until the owner provides a key): `apps/api/scripts/agentqa/` implementing `make agent-parity` (Shared contracts 7): a scenario file with 84 scenarios recreated from the 2026-10-02 categories (create/edit tasks, reminders, events, recurring edits, sheets, docs, bulk edits, bots, questions, out-of-scope declines, stale data, timezone), a runner that signs up a disposable account on the worktree API, sets the provider from `PROVIDER`/`MODEL`/`TIMELY_PARITY_KEY` (environment only), switches the engine per run, sends each scenario, approves where the scenario says, records reply, proposal, plan, status and tool trace, and writes a per-engine JSON plus a side-by-side Markdown report with pass/fail per scenario. Smoke it against the stub model on a handful of scenarios on both engines.
3. **`verify-timely` run** (phase 2 verification): API 8081 + web 4002 with `DB_SCHEMA`, stub model as the account's provider: sign up, switch Settings → Agent → Engine to New, create tasks via chat on the new engine (streamed reply visible), approve a proposal (Supervised), Auto apply + Undo, Stop mid-run; screenshots light and dark, ARIA snapshots and API reads as proof. Check the phone at 390 px Expo web for the same flows.
4. **Exit checks**: "no data written outside proposals" (a DB audit across the integration and the live run); TLA+ resynced; all suites green; record that parity is pending the live key.
5. **Docs**: plan section 13 phase 2 status (what ran, counts), section 5.3 decision (`system_message` vs `ephemeral_system_prompt`), tool_search and context_engine results, Full Access phase-2 behaviour; ADR 0007/0008 amendment notes if the wording changed (permission modes on Timely data, lost-run rule); `CONTEXT.md` terms (Engine, Permission mode, Critical list); CI: make sure `test-chat-integration` with the fake worker and `test-agent-chat` run in CI.

**Tests and commands:** `make test`, `make test-chat-integration`, `make lint`, `make typecheck`, `make agent-contract`, `make hermes-sync-check`, `make agent-go-integration`, `make verify-agent-runs ARGS=--mutants`, `make agent-parity ENGINE=both PROVIDER=<stub> ONLY=<5 ids>`, the `verify-timely` skill.

---

## Coverage: every phase 2 item in plan section 13, in exactly one package

Items that span the stack are split into atomic parts; each part has exactly one package.

| # | Section 13 item (part) | Package |
|---|---|---|
| 1 | `chat/toolcall.go` extracted, classic uses it, no behaviour change | chat-core |
| 2 | Spec endpoint, catalog half: Read-tool specs, outside flags, version | agent-catalog |
| 3 | Spec endpoint, chat half: `AgentToolSpecs` and `GET /agent/tool-specs` | chat-core |
| 4 | Specs delivered to the worker in `hello`, restart on a new catalog version | agenthost |
| 5 | `timely_tools` plugin | worker |
| 6 | `chat/engine_agent.go`: run start, event follower, checkpoints, Stop, steer, lost-run rule | engine |
| 7 | Engine seam in `work()`/`service.go` (claim, hand-off, Stop/Delete/Retry hooks, steer route) | chat-core |
| 8 | Migrations on `agent_conversations` (+ `agent_chat_settings`) | chat-core |
| 9 | Engine setting API (Classic / New, default Classic) | chat-core |
| 10 | Settings → Agent → Engine on web | web-ui |
| 11 | Settings → Agent → Engine on phone | mobile-ui |
| 12 | Providers: API-key providers and OpenRouter direct (`AgentModel`) | agenthost |
| 13 | Auxiliary-credential check | worker |
| 14 | `SOUL.md` Timely persona ("Timely", Q-2.6) | worker |
| 15 | `system_message` vs `ephemeral_system_prompt` decision with contract test 6 | worker |
| 16 | Prompt layout 5.3 in Go: stable Timely block, per-turn user message | engine |
| 17 | `tainted_sources` column and `ForceReview` from it | chat-core |
| 18 | `taint` message from the worker | worker |
| 19 | Go merges `taint` / outside results into `tainted_sources` | engine |
| 20 | `propose_changes` alone in its batch, contract test 18 | worker |
| 21 | Activity throttle in Go | engine |
| 22 | No host tools, no learning writes (memory and skill tools off) | worker |
| 23 | tool_search off vs on measured | worker |
| 24 | `context_engine` plugin evaluated | worker |
| 25 | Permission modes: `permission` on conversations and the account defaults | chat-core |
| 26 | Settings → Assistant → Permissions on web (on the Agent tab until phase 6) | web-ui |
| 27 | Settings → Assistant → Permissions on phone | mobile-ui |
| 28 | Composer chip and picker on web | web-ui |
| 29 | Chip and picker on phone | mobile-ui |
| 30 | Supervised holds every proposal; Auto and Full Access apply non-critical proposals directly with Undo | chat-core |
| 31 | Inverses that make Undo possible | agent-catalog |
| 32 | Go's critical list with one test per item | agent-catalog |
| 33 | TLA+ property for Supervised | verify |
| 34 | Q-2.1 scope line split (`instructionFor`) | chat-core |
| 35 | Q-2.1 host-allowed source (`TIMELY_AGENT_HOST_ACCOUNTS`) | agenthost |
| 36 | Q-2.1 applied to agent-engine runs | engine |
| 37 | Q-2.3 no Timely cap in Go (no 10-minute context, no lane held) | chat-core |
| 38 | Q-2.3 Hermes' own turn default in the worker | worker |
| 39 | Q-2.5 worker delta coalescing | worker |
| 40 | Q-2.5 Go relay to `/chats/watch` and `activity.draft` | engine |
| 41 | Q-2.5 streaming rendered on web | web-ui |
| 42 | Q-2.5 streaming rendered on phone | mobile-ui |
| 43 | Verification: Go unit tests mapping recorded event fixtures to conversation updates | engine |
| 44 | Verification: fixture recorder | worker |
| 45 | Verification: Go fake worker kit | agenthost |
| 46 | Verification: `make test-chat-integration` covers the engine without Python | engine |
| 47 | Verification: outside Timely read before a `direct=true` proposal ends in `approval`, then Approve applies | engine |
| 48 | Verification: 84-scenario parity on both engines | OUT (needs the owner's key) |
| 49 | Harness entry point for the parity run (`make agent-parity`) | verify |
| 50 | Verification: `verify-timely` run (sign up, tasks via chat on the new engine, approve, Stop mid-run) | verify |
| 51 | Exit: no data written outside proposals (audit) | verify |
| 52 | Exit: TLA+ coverage resynced | verify |

## Flagged for the coordinator or the owner

1. **Backup mode (Q-1.1) is not in this decomposition.** The plan's Q-1.1 answer says backup mode (Hermes api_server inside the same worker, switched by `agenthost` after a failed self-test or two startup crashes) "lands in phase 2 with the engine bridge", but section 13's phase 2 list does not name it. Building it needs edits to files owned by `agenthost` and `worker` after the engine exists. Recommendation: a phase 2b with two packages (Go transport and switch in `agenthost`; api_server start mode and contract tests in both modes in `worker`/`hermes-sync-check`) once this phase is committed.
2. **The permission mode applies to classic chats too.** Existing chats migrate to Supervised, so a small `direct=true` change on classic now waits for Approve unless the person picks Auto. This follows Q-P1 (new chats Supervised) and is the safer reading; the owner may prefer existing chats to start on Auto.
3. **Full Access in phase 2** behaves like Auto for Timely data (critical changes still ask) and is offered only in the web/desktop picker; the phone shows it disabled. Server-side step-up and "Allowed on" enforcement need the phase 5 shell token.
4. **Per-account chat settings are not in backups yet** (`agent_chat_settings`); backup schema 3 is phase 3.
5. **The 84 scenarios are recreated**, not recovered: the 2026-10-02 harness lived in `/tmp/agentqa` and is gone.

### Where each flag stands after the verify wave (2026-11-09)

1. Backup mode: still not built; the phase 2b recommendation stands.
2. Existing chats on Supervised: shipped that way. On both web and phone, small edits in old chats now wait for Approve; the owner may still prefer Auto for existing chats.
3. Full Access: behaves as Auto for Timely data. The web and desktop pickers offer it after one confirmation (the plain web browser offers it as well, which the contract did not ask for), the phone shows it disabled, and "Allowed on" is shown read-only (plan 5.5b, phase 2 behaviour).
4. `agent_chat_settings` in backups: still phase 3.
5. Scenarios: 84 recreated in `apps/api/scripts/agentqa/scenarios.json`, with a smoke run on the stub model (5/5 on each engine). The live run waits for the owner's key.
