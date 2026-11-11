# Worker protocol (Go API ↔ agent worker), version 1

The contract between `apps/api/internal/agenthost` (Go) and `apps/agent/timely_agent` (one Python worker per account). Design: plan section 5.1 of `docs/plans/2026-11-08-timely-agent-from-hermes.md`. Where the plan left a name open, this file fixes it; the worker implements exactly what is written here (`timely_agent/protocol.py`, `worker.py`), and `apps/agent/tests/test_worker.py` drives it over real pipes.

## 1. Before spawning

Go runs two helper commands with the runtime interpreter. Each reads one optional JSON object on stdin and prints exactly one JSON object on stdout (exit 0), or `{"ok": false, "error": "..."}` (exit 1). Logs go to stderr.

```
<venv>/bin/python -I apps/agent/timely_agent/boot.py prepare        --agent-dir <TIMELY_DATA_DIR>/agent
<venv>/bin/python -I apps/agent/timely_agent/boot.py render-account --agent-dir <TIMELY_DATA_DIR>/agent --account <uid> --prepared <json>
```

On Windows the interpreter is `<venv>\Scripts\python.exe`.

**`prepare`** (API start). Input: `{"browser_executable": "<path to Chrome/Edge or empty>"}`. Creates the layout of plan 6.1, writes `instance.json` (`layout_version`; it keeps keys Go adds), the read-only Timely skills copy and the skill seed tree (plan 9.1), `managed/config.yaml` (plan 6.3), and checks the managed file through Hermes' own loader (canary). Output:

| Field | Meaning |
| --- | --- |
| `ok` | true |
| `managed_config`, `managed_sha256` | the managed file and its hash (Go keeps the hash, refuses to spawn when the file no longer matches it, and sends it in `hello`) |
| `browser_executable` | the input echoed (sent in `hello`) |
| `timely_skills_dir` | `<agent>/timely-skills/<hash>`, the only `skills.external_dirs` entry (sent in `hello`) |
| `seed_skills_dir` | `<agent>/seed/<hash>/skills` |
| `skills_default_off` | names of the seeded skills whose reviewed entry says `default: off` (sent in `hello` and `render-account --prepared`); every account keeps them in `skills.disabled` unless its settings list them in `skills_enabled` |
| `seed` | counts: `seeded`, `unreviewed`, `overridden`, `override_only`, `essential_off`, `default_off` |
| `env` | `HERMES_MANAGED_DIR`, `HERMES_RUNTIME_DIR`, `HERMES_GATEWAY_LOCK_DIR`, `XDG_STATE_HOME`, `HERMES_BUNDLED_SKILLS` for every worker |

The managed file pins `plugins.enabled` to the Timely plugins (every folder under `timely_agent/plugins/` with a `register`) and lists in `plugins.disabled` every bundled `kind: platform` plugin (messaging adapters, a2a) plus `image_gen/*`, `video_gen/*` and `dashboard_auth/*`, read from the snapshot's manifests: Hermes auto-loads bundled backends and registers bundled platforms whatever `plugins.enabled` says, and only `plugins.disabled` overrides that. Web search and browser backends and `delegation/default` stay loaded for later phases.

`prepare` also writes `<agent>/runtime/prepared.json`, a copy of its answer for people reading the folder. Nothing reads it back: it sits in the same writable folder, and its values are policy. Go keeps the answer in memory, so `prepare` must have run once per API start before any `render-account` or spawn; `render-account` takes it as `--prepared` (a JSON object with `timely_skills_dir`, `seed_skills_dir`, `browser_executable` and `skills_default_off`, all required) and the worker from `hello`.

**`render-account`** (before each spawn). Input: the account settings (all optional):

| Setting | Type | Effect |
| --- | --- | --- |
| `model` | `{default, provider, base_url, api_mode}` | account model defaults |
| `toolsets` | `[string]` | account default toolsets (never-offered ones are dropped) |
| `skills_disabled` / `skills_enabled` | `[string]` | skill names off / turned on (reviewed bundled skills marked `default: off` stay off unless listed in `skills_enabled`) |
| `learning` | `{memory: bool, user_profile: bool}` | memory toggles (default on; section 10.6) |
| `curator` | `{enabled: bool, auto_archive: false}` or bool | curator on/off; it never archives (section 10.6) |
| `web` | `{search_backend, extract_backend}` | `timely` (Go runs it) or a keyed backend id (section 10.6) |
| `timezone` | string | IANA zone |
| `approval_timeout_s` | number | Hermes approval timeout (default 600) |
| `terminal_home_mode` | string | default `profile` |
| `mcp_servers` | `{name: entry}` | Hermes MCP entries; see below |
| `host_allowed` | bool | account may run host commands (plan 12) |
| `approved_mcp_hashes` | `[sha256]` | approved stdio MCP entries |
| `soul` | string | `SOUL.md` text (default: a short Timely identity) |

MCP rule: an entry with `command` is kept only when `host_allowed` is true and the sha256 of the entry's canonical JSON (keys sorted, separators `,` and `:`, UTF-8) is in `approved_mcp_hashes`. An entry with `url` is dropped when the host is a literal private, loopback, link-local, reserved or 100.64.0.0/10 address or `localhost` (Go still resolves names before each render, plan 8.2). Dropped entries are listed in the output.

Output: `ok`, `home` (the account's `HERMES_HOME`), `account_dir` (`account-` + hex of the first 12 bytes of sha256(uid), the same name as `portability/service.go`), `config_sha256`, `mcp_dropped`, and `env`: `HERMES_HOME`, `HOME` (`<home>/home`), `HERMES_MANAGED_DIR`, `HERMES_RUNTIME_DIR`, `HERMES_GATEWAY_LOCK_DIR`, `XDG_STATE_HOME`, `HERMES_BUNDLED_SKILLS`, `TERMINAL_CWD` (`<home>/workspace`), `PYTHONNOUSERSITE=1`.

## 2. Spawning

`python -I apps/agent/timely_agent/boot.py worker`, stdin and stdout as pipes, stderr as the log stream. No extra descriptors. Working directory: anything (the worker never relies on it).

**Environment** (plan 6.4), built from scratch: the `env` values from `prepare` and `render-account`, plus `PATH`, `LANG`, `TZ`, `TMPDIR`, `HERMES_REAL_HOME` (the OS user's real home) and, on Windows, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`; plus the account's tool keys under their Hermes names (`*_API_KEY`, `*_TOKEN`). The worker refuses to start (an `error` with `code: "refused"`, then exit code 3, before Hermes is imported) when:

- any of `HERMES_HOME`, `HERMES_MANAGED_DIR`, `HERMES_RUNTIME_DIR`, `HERMES_GATEWAY_LOCK_DIR`, `XDG_STATE_HOME`, `HOME` is missing;
- `HERMES_HOME` is not absolute, not `<agent>/accounts/<dir>`, missing, or inside the real home's `.hermes`;
- `HOME` is not `<HERMES_HOME>/home`, or `HERMES_MANAGED_DIR` is inside the account home;
- any of these is present: `JWT_SECRET`, `DATABASE_URL`, `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `HERMES_YOLO`, `HERMES_SAFE_MODE`, `HERMES_CRON_SESSION`, `HERMES_ENABLE_PROJECT_PLUGINS`, `HERMES_CONFIG_BACKEND`, `HERMES_LANGUAGE`, `HERMES_BUNDLED_LOCALES`, `HERMES_MANAGED`, `HERMES_ACCEPT_HOOKS`, `HERMES_PROFILE`, `HERMES_YOLO_MODE`, `HERMES_ALLOW_PRIVATE_URLS`, `HERMES_ACP_AUTO_APPROVE`, any other `HERMES_*` name (only the ones named in this section, `HERMES_OPTIONAL_SKILLS` and `HERMES_EXEC_ASK` are allowed), or any name starting with `DB_`, `TIMELY_`, `API_`, `POSTGRES`, `PG`, or a messaging platform prefix (`TELEGRAM_`, `DISCORD_`, `SLACK_`, `WHATSAPP_`, `SIGNAL_`, `MATRIX_`, `MATTERMOST_`, `FEISHU_`, `LARK_`, `WECOM_`, `WEIXIN_`, `DINGTALK_`, `TEAMS_`, `MSGRAPH_`, `TWILIO_`, `IMESSAGE_`, `BLUEBUBBLES_`, `PHOTON_`, `LINE_`, `EMAIL_`, `SMTP_`, `IMAP_`, `QQ_`).

Other unknown names are logged as warnings. `HERMES_EXEC_ASK` is allowed when the host sets it.

## 3. Framing

- One JSON object per line, UTF-8, terminated by `\n` (`\r\n` accepted). A line over 32 MiB is refused (`bad_message`). The worker escapes non-ASCII as `\uXXXX`, so its lines are ASCII; a lone surrogate (a model stream split inside an emoji) arrives as an escape Go decodes to U+FFFD. Strict JSON only: a NaN or Infinity (model-made tool arguments can hold them) is sent as `null`, because Go refuses those tokens and a line it cannot parse stops the worker.
- Every message has `type` and `account`. The worker pins the account from `hello`; any later message for another account gets `wrong_account` and is ignored. Every worker message after `hello` carries the worker's account.
- Requests carry `id`; the reply to a request carries the same `id`. Go's ids start with `go-`; the worker's ids start with `w-`.
- Run-scoped messages carry `run` (the run id Go chose).
- The worker never writes anything but protocol lines to stdout: before Hermes is imported, `boot.py` duplicates the pipes to private, non-inheritable descriptors, points fd 0 at the null device and fd 1 at stderr, so prints and child-process output go to the log stream.

## 4. Messages, Go → worker

| Type | Fields | Answer |
| --- | --- | --- |
| `hello` | `id`, `protocol` (1), `home` (the account's `HERMES_HOME`), `settings_hash` (the `config_sha256` from `render-account`), `catalog_version`, `timely_skills_dir`, `managed_sha256`, `browser_executable` and `skills_default_off` (from `prepare`'s answer), optional `settings` (section 6), optional `timely_tools` (phase 2, section 9) | `ready` or `error` |
| `ping` | `id` | `pong` |
| `run.start` | `id` (Go's `Send` gives each start an id starting `start-`), `run`, `conversation_id`, `session_key` (`timely:<uid>:<conversation>`), `user_message`, `system_hash`, `system_text` (the Timely block, section 9.2), `model` `{provider, model, base_url, api_key, api_mode, reasoning}` (for Claude Code and Codex: `provider: "custom"`, the Go loopback gateway's `base_url` and a gateway secret for this account, provider and model as `api_key`; plan 5.7), `toolsets` (explicit list, required, may be empty; chat in phase 2: `["timely", "todo", "skills"]`), `flags` `{sensitive, answer_only, web, rich_ui, from_bot, learning_writes}`, `budgets` `{max_iterations}` (`{}` for chat: Hermes' own limit, section 9.3), `permission` (`supervised`, `auto` or `full`; default `supervised`), `tainted_sources` `[{kind, tool, host?, session?}]`, `pre_approved` `{tool, args_hash}` or null, `history` (a seed for a session `state.db` lacks, section 9.6), `reseed` (bool: replace the session's stored messages with `history`, section 9.6) | `event`s, then `run.done` with the same `id`; or `error` with the same `id` and `run` |
| `run.stop` | `id`, `run`, `reason` | the run's `run.done` with `interrupted: true`; `error` (`unknown_run`) if no such run. A stop that arrives as the turn is finishing acts on that run only: it never carries over to the conversation's next turn |
| `run.steer` | `id`, `run`, `text` | `ack` |
| `approval.answer` | `id`, `run`, `request_id`, `choice` (`once` or `deny`) | `ack` (`ok: false` when that request is no longer pending); `error` (`bad_message`) when `request_id` is missing or empty: the worker resolves only the request it names, never the session's oldest |
| `tool.result` | `id` (the worker's `tool.call` id), `result` (any JSON; a string reaches the model as is), `outside` (bool: the result carries third-party text, section 9.4), `end_turn` (bool, phase 2: set after a recorded `propose_changes`, section 9.5) | none |
| `gate.verdict` | `id` (the worker's `gate.ask` id), `verdict` (`allow`, `block`, `approve`), `message`. Phase 2: Go answers `block` with "That isn't available in Timely yet" for every tool (section 9.7) | none |
| `session.delete` | `id`, `conversation_id` | `ack` (`busy` error while the conversation has a live run) |
| `shutdown` | `grace` (seconds, default 5) | none: the worker waits up to `grace` for live runs, interrupts the rest (up to 2 s more), and exits 0. Go sends its own stop budget minus 3 s, so a worker following this exits before Go sends SIGTERM. The worker keeps reading during the grace (a live run may still need `tool.result`, `gate.verdict` or `approval.answer`, and `run.stop` still works) and refuses new work with `not_ready`; Go keeps stdin open and writes only those replies and run controls until the worker exits or the grace ends |
| `learning.*`, `settings.update` | section 10.3 | `learning.result` or `error` |
| `bot.run` | phase 6 | `error` `unsupported` |

Every `run.start` the worker accepts ends in exactly one `run.done`, whatever fails inside the run (a failure outside the turn itself arrives as `run.done` with `completed: false` and `error`). An `error` that carries `run` and the `id` of that run's own `run.start` (a refusal: `busy`, `refused`, `bad_message`, `not_ready`, `internal`) ends that run: no `run.done` follows. Go stops counting the run as live and hands the error to the run's owner. `duplicate_run` does not end the run (the first start is still running), and neither does an error answering `run.stop`, `run.steer` or `approval.answer`, even though it carries `run`. Go never sends a line over 32 MiB: it refuses such a `run.start` before marking the run live, because the worker's `bad_message` for an oversized line cannot name the run.

`args_hash` is the sha256 of the tool arguments' canonical JSON (keys sorted, separators `,` and `:`, non-ASCII kept as UTF-8).

Closing the worker's stdin is the lifeline: the worker interrupts live runs and exits 0 within about two seconds.

## 5. Messages, worker → Go

| Type | Fields |
| --- | --- |
| `ready` | `id` (the hello's), `protocol` (1), `hermes_tag` (e.g. `v0.23.0`), `tools` (tool names that resolve for every toolset a Timely run may enable, the Timely tools included), `plugins_loaded` (enabled plugin keys, including `timely_gate`, `timely_tools`, `timely_learning`, `timely_bot`), `self_test` `{ok, failures: ["<check>: <detail>"], checks: [{name, ok, detail}]}`, `config_sha256`, `catalog_version` (echo), `timely_tools` `{catalog_version, registered}` (the echoed `hello.timely_tools.catalog_version`, empty without it, and the sorted names registered under toolset `timely`), `skills_sync` (Hermes' `sync_skills` counts), `boot_ms`, `pid` (the interpreter's own process id: Go refuses the worker when it is outside the process group or, on Windows, the Job Object, since a venv launcher can stand between Go's child and the interpreter) |
| `pong` | `id` (the ping's), `busy` |
| `heartbeat` | `busy`; sent every 10 s after `ready` |
| `event` | `run`, `kind`, `payload` (below) |
| `tool.call` | `id`, `run`, `session_key`, `tool_call_id`, `name`, `args`, `tainted_sources` (the run's whole list), `batch_size` (calls in the assistant message this one came in), `sibling_tools` (the other tool names of that message, in order) (section 9.4) |
| `gate.ask` | `id`, `run`, `tool_call_id`, `tool`, `args`, `tainted_sources`, `run_kind` (`chat` or `bot`) |
| `taint` | `run`, `sources` (the new ones only, `[{kind, tool, host?, session?}]`; phase 2, section 9.4) |
| `run.done` | `id` (the run.start's), `run`, `final_response`, `completed`, `interrupted`, `turn_exit_reason`, `tokens` `{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens}` (this turn only), `estimated_cost_usd` (this turn, or null), `turn_id`, `tainted_sources`, `history_seeded` (bool: this run wrote `run.start.history` into `state.db`), `pending_steer` (the `run.steer` text no tool batch took in, because it arrived while the last reply streamed; "" when none. Go makes it the person's next turn), optional `error` (the turn failed; `final_response` may be empty). `turn_exit_reason` is `end_turn` when the turn ended on a tool call after `end_turn` (section 9.5); that is not a Stop: `interrupted` is false |
| `ack` | `id`, `ok` (bool) |
| `learning` | `event` (section 10.2): one learned, staged or blocked change; not run-scoped |
| `learning.result` | `id` (the request's), `ok`, `data` (section 10.3) |
| `log` | `level`, `text` |
| `error` | optional `id` (the request it answers), optional `run`, `code`, `message` |

`busy` is `{runs, learning, children}`: live runs, a learning pass or curator pass in progress (phase 3), tracked child processes (`children` counts the background processes in Hermes' process registry). A busy worker must not be reaped.

**Event kinds** (`event.payload`):

| Kind | Payload |
| --- | --- |
| `delta` | `{text}`: streamed reply text, a chunk (never the whole reply so far). Coalesced: at most one per 50 ms, or sooner once 200 characters wait; text is never dropped or reordered, and every `delta` comes before the next other event, a Timely `tool.call` and `run.done` |
| `reasoning` | `{text}` |
| `tool.started` | `{tool_call_id, tool, args}` |
| `tool.completed` | `{tool_call_id, tool, result}` (long values are cut at 4,000 characters) |
| `status` | `{kind, message}`: Hermes lifecycle notes (compaction, retries) |
| `approval.request` | Hermes' approval data: `request_id`, `pattern_key`, `description`, `timeout_s` and the other scalar fields; answer with `approval.answer` |
| `subagent` | phase 4 (learning changes are the top-level `learning` message, section 10.2) |

**Gate.** Every tool call passes `timely_gate`. Messaging and never-offered tools are blocked locally; after `end_turn` every tool call is blocked (section 9.5); `propose_changes` is blocked unless it is the only call of its assistant message (section 9.4); `todo_list`, `skills_list`, `skill_view`, `skill_manage`, `memory`, `session_search` and the `timely` toolset run without asking (other plugins can still block them: `timely_learning` blocks every `skill_manage` write to a Timely-shipped skill, decides every `skill_manage` and `memory` write (section 10.4), and refuses `session_search` without `flags.search_history`); everything else sends `gate.ask`. Go must answer within 25 s (Hermes' hook timeout is 30 s and fails closed); no answer means block. `approve` makes Hermes raise its approval gate (rule key `timely:<tool_call_id>`), which arrives as an `approval.request` event.

## 6. Hello

The worker checks, in order, and answers `error` (with the hello's `id` and `account`) on the first failure:

1. `protocol` is 1 (`protocol_mismatch`).
2. `home` resolves to the worker's `HERMES_HOME` (`home_mismatch`).
3. The home folder is `account-<hash of account>` (`wrong_account`).
4. `timely_skills_dir` and `managed_sha256` are non-empty strings, `skills_default_off` is a list of names, and the skills folder is inside the agent folder (`bad_message`). `timely_tools`, when present, has the shape of section 9.1 (`bad_message`).
5. Config: when `settings` (an object, same shape as the `render-account` input) is present, the worker renders `config.yaml` from it itself (a file that no longer matched `settings_hash` is logged as edited and overwritten); otherwise `config.yaml`'s sha256 must equal `settings_hash` (`config_mismatch`: run `render-account` again and respawn).

Then it imports Hermes, bridges the account's `terminal.*` config into the `TERMINAL_*` process environment (Hermes' own `apply_terminal_config_to_env`, plus `TERMINAL_HOME_MODE`, which that bridge leaves out), loads the plugins, seeds bundled skills into the home (`sync_skills`) and runs the self-test. A failed `hello` leaves the worker waiting for a correct one; a second `hello` after `ready` is `bad_message`.

**Self-test checks** (`self_test.checks[].name`): `plugins` (every Timely plugin (each folder under `timely_agent/plugins/` with a `register`) loaded without errors from Timely's own entry points, and the enabled set equal to `selftest.EXPECTED_PLUGINS`), `user_plugins` (`$HERMES_HOME/plugins` is empty and project plugins are off: a folder there replaces an entry-point plugin with the same key), `gate_hook` (`pre_tool_call` holds timely_gate's and timely_learning's own functions, compared by identity), `dotenv` (no `.env` Hermes would load exists: the worker sets `<home>/.env` and `<home>/.op.env` aside as `*.timely-disabled` before importing Hermes; `<agent>/hermes/.env` and `$HERMES_MANAGED_DIR/.env` only fail the check), `env_drift` (no environment name changed after the start check, besides the `TERMINAL_*` names the terminal bridge sets from the account config), `home` (Hermes resolves the expected `HERMES_HOME`), `no_messaging` (no messaging tool resolves, no platform plugin is enabled, no platform adapter module is imported), `managed_config` (the managed file is byte-for-byte the floors rendered from `hello`'s `timely_skills_dir` and `browser_executable` and hashes to `managed_sha256`, so an added key fails as well as a loosened one; every floor reads back through Hermes' loaders: managed file, merged `load_config()`, and the raw reader skill discovery uses, which must see only the Timely skills folder), `essential_skills` (Hermes' non-disableable skill list matches Timely's copy), `install_guard` (runtime installs blocked), `dotenv_guard` (Hermes' dotenv loader is a no-op after start, runtime override R2), `mcp` (no unapproved stdio MCP server), `timely_tools` (toolset `timely` holds exactly the specs of `hello.timely_tools`, each with `timely_tools`' own handler; a name Hermes already uses fails here), and when `hello` carried `settings`, `skills_default_off` (every name in `hello.skills_default_off`, less the settings' `skills_enabled`, is in the effective `skills.disabled`). When `self_test.ok` is false the worker answers every `run.start` with `error` `refused` and Go should stop it and show "The agent could not start" with `self_test.failures`.

Each run binds Hermes' per-turn terminal policy from `config.yaml` and the managed floors (`tools.terminal_scope.install_profile_terminal_scope`, as Hermes' gateway does): local backend, `cwd` = `<home>/workspace`, `home_mode: profile`, so terminal children get `HOME=<home>/home`, never the OS user's home. An unreadable config installs Hermes' refusal scope and terminal tools fail closed.

## 7. Errors

| `code` | When |
| --- | --- |
| `bad_json` | the line is not JSON |
| `bad_message` | not an object, no `type` or `account`, missing required fields, a `run.start` field of the wrong shape (`tainted_sources`, `history`, `toolsets` not lists; `pre_approved`, `budgets`, `flags`, `model` not objects; `permission` not one of `supervised`, `auto`, `full`; `flags.learning_writes` not a bool), a `hello.timely_tools` of the wrong shape (section 9.1), a `run.start` `toolsets` entry that is never offered (`config_render.NEVER_TOOLSETS`) or a Hermes platform bundle (`hermes-*`), oversized line, second `hello` |
| `unknown_type` | a type this protocol does not define |
| `wrong_account` | the message names another account, or the home belongs to another account |
| `protocol_mismatch` | `hello.protocol` is not 1 |
| `home_mismatch` | `hello.home` is not the worker's `HERMES_HOME` |
| `config_mismatch` | `config.yaml` does not match `settings_hash` |
| `not_ready` | a message other than `hello`/`ping` before `ready`, or during shutdown |
| `refused` | environment refused at start (no `id`, worker exits 3), or self-test failed |
| `busy` | the account already has 3 live runs, or the conversation already has one |
| `duplicate_run` | `run.start` with a run id that is live |
| `unknown_run` | `run.stop`, `run.steer`, `approval.answer` for no live run |
| `unsupported` | a later-phase message (`bot.run`), or `learning.upstream` before `timely_agent.skills_admin` exists |
| `not_found` | a `learning.*` request names a skill, history entry or staged write that does not exist |
| `internal` | an unexpected worker failure while handling the message |

## 8. Timeouts Go applies (plan 5.1)

- `ready` within 20 s of `hello` (a cold first start imports Hermes and seeds skills; about 1-4 s on a warm machine).
- Any line, `heartbeat` or `pong` at least every 30 s; otherwise kill the process group.
- `gate.ask` answers within 25 s (a hook: Hermes fails it closed at 30 s). `tool.call` answers within 25 s too; a Timely tool is a registered tool, not a hook, so a slow one (`preview_bot`) may take up to 180 s before the worker gives up and tells the model Timely did not answer. `run.stop` ends a wait at once.

## 9. Phase 2: chat on the agent engine

What the worker does with the phase-2 fields. Protocol version stays 1; every field is additive and optional for an older Go.

### 9.1 Timely tools (`hello.timely_tools`)

`{catalog_version, tools: [{name, description, parameters, outside}]}`: the chat-visible specs, the same list as Go's `GET /agent/tool-specs` (Read tools, `propose_changes`, `resolve_target`). Missing means no Timely tools. `catalog_version` is the sha256 of Go's canonical tools JSON; the worker echoes it in `ready.timely_tools` and does not recompute it. Go restarts an idle worker whose version is stale, never one mid-run. Shape: `name` matches `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`, is unique and is not a messaging or never-offered name; `description` a string, `parameters` an object, `outside` a bool (all optional but `name`). The worker keeps the specs before Hermes discovers plugins, and `timely_tools` registers each under toolset `timely`. Write tools are never sent and never registered: their schemas travel in the Timely block and reach Go only inside `propose_changes`.

### 9.2 The Timely block (contract test 6)

`system_text` goes in as `AIAgent(ephemeral_system_prompt=...)`, not `run_conversation(system_message=...)`. Hermes appends it to its own system prompt (identity from `SOUL.md`, guidance, skills index) at API-call time. Contract test 6 ran both: each keeps the prompt byte-identical across two turns and after the agent is rebuilt from `state.db` in a fresh worker; only `ephemeral_system_prompt` lets a changed block reach the next turn, because `system_message` is baked into the prompt Hermes stores on the first turn and restored verbatim afterwards. The agent cache key includes the block's own hash, so a changed block builds a new agent. Go keeps the block byte-stable per conversation (the cache prefix); per-turn content goes in `user_message`.

The default `SOUL.md` makes the identity "Timely" (Q-2.6). Hermes still adds one unconditional pointer to its own documentation ("For help with Hermes Agent itself..."); removing it would need a patch point.

### 9.3 Turn limit (Q-2.3)

`budgets: {}` (chat): no Timely cap. The agent gets Hermes' own `agent.max_turns` from config (`resolve_turn_limit`, unlimited by default). A positive `budgets.max_iterations` still caps a run (bots, later). Stop always ends a run.

### 9.4 Batches, `propose_changes` and taint

- `batch_size` and `sibling_tools` come from the assistant message that produced the call. `timely_tools` records each model response's calls from Hermes' `post_api_request` hook (`assistant_message`), which fires before any tool of that response runs; a call id Hermes renamed because the conversation already used it (`call_1` -> `call_1_d2`) is matched to the latest response.
- `propose_changes` that is not the only call of its message is blocked by `timely_gate` with "Call propose_changes alone, after all read tools finish" and never reaches Go (contract test 18a). The decision rests on the recorded message, so it never depends on whether a sibling ran first. Go keeps the same check on `batch_size` as a second line.
- Taint: each `tool.result` with `outside: true` adds `{kind: "timely", tool}`; each call that ran (was not blocked) of a Hermes tool the worker's policy marks as a taint source adds `{kind, tool, host?}` (`timely_agent/policy.py` `TAINT_SOURCES`: web, browser, MCP, file, terminal, code, vision, delegation; phase 2 offers none of them). Phase 3: a `session_search` hit from a conversation in `run.start.tainted_conversations` adds `{kind: "session", tool: "session_search", session: <id>}` (section 10.4). The list starts from `run.start.tainted_sources`, is append-only and deduplicated, and each new source is sent once as `taint`. Every `tool.call` and `run.done` carries the whole list (contract test 18b).

### 9.5 End of turn after a proposal (Q-2.4)

Go answers a recorded `propose_changes` with `end_turn: true`. The model may then write one closing sentence, which ends the turn normally. If it calls any tool instead, `timely_gate` blocks that call (it never reaches Go) and ends the turn; `run.done` has `turn_exit_reason: "end_turn"`, `completed: true`, `interrupted: false` and `final_response` = the closing text the model wrote after the proposal (may be empty). Go applies or holds the proposal after `run.done`.

### 9.6 History seed

`state.db` is the working transcript. When it has no messages for the session and `run.start.history` is set, the worker writes the seed's `user` and `assistant` messages into `state.db` before the turn (Hermes stores only a turn's new messages) and answers `history_seeded: true`. When `state.db` already has messages, a seed is ignored. So Go may send the seed whenever it is not sure the worker's `state.db` has the session (after a restore or on a new machine); it is never duplicated. With `run.start.reseed: true` the seed replaces the stored messages (they are soft-archived, as Hermes' rewind does; an empty `history` clears them) and the answer is `history_seeded: true`. Go sends it when the chat's latest finished turn came from the classic engine, so the session has not seen it, and after an agent run that ended without its turn saved in the chat (failed, stopped, lost), so the session holds a turn the chat doesn't.

### 9.7 Learning writes off, host tools off, permission

- Chat toolsets in phase 2: `timely`, `todo`, `skills`. `skip_memory=True`; `skill_view` and `skills_list` read; every `skill_manage` action and every `memory` call is blocked while `flags.learning_writes` is not exactly true (phase 2 always sends false), and outside a run. Phase 3 turns learning on per run: section 10.
- Tools outside the local allow list and the `timely` toolset reach Go as `gate.ask`; phase 2 Go answers `block` ("That isn't available in Timely yet"), and the worker passes the message to the model. A tool that is not in the run's toolsets never gets that far: Hermes answers that it does not exist.
- `permission` is stored on the run and not acted on by the worker in phase 2 (Go applies it to proposals; host tools follow it from phase 5).

### 9.8 Auxiliary calls (plan 5.7, contract test 20)

The only auxiliary call that can fire in a phase 2 chat run is context compression (titles are floored off; vision and learning are not offered). It uses the run's `base_url` and `api_key`: with `OPENAI_BASE_URL` and `OPENAI_API_KEY` pointing at a second endpoint in the worker environment, every request, the summary calls included, went to the run's endpoint with the run's key. So Go needs no provider keys in the worker environment for phase 2.

## 10. Phase 3: learning, past-chat search, web, backups

Version stays 1; every field is additive and optional for an older peer. Plan section 9b, the owner's answers Q-3.1 to Q-3.8, and `docs/plans/2026-11-11-phase3-work-packages.md` contract 1.

### 10.1 `run.start` additions

| Field | Type | Meaning |
| --- | --- | --- |
| `toolsets` | `[string]` | chat: `["timely", "todo", "skills"]` plus `memory` when `flags.learning_writes`, `session_search` when `flags.search_history`, `web` when `flags.web`. Never-offered toolsets are still refused (`bad_message`) |
| `flags.learning_writes` | bool | account learning on, chat not Sensitive, not "Don't learn from this chat", not answer-only. True builds the agent with memory and Hermes' learning pass (`skip_memory` and `skip_background_review` are its negation). False: no memory in the prompt, no pass, every `memory` and `skill_manage` call blocked |
| `flags.search_history` | bool | "Search my past chats" (Q-3.5, default on) and `learning_writes`. False: `session_search` is refused in the worker |
| `flags.web` | bool | the chat's web toggle, not Sensitive, not answer-only (Go's gate decides; worker-web) |
| `flags.from_bot` | bool | the chat was opened from a bot (false until phase 6): every learning write stages from the first turn |
| `tainted_conversations` | `[conversation id]` | the account's chats with non-empty `tainted_sources`: a `session_search` hit from one taints this session |
| `search_exclude` | `[conversation id]` | the account's "Don't learn from this chat" chats: never returned by `session_search` |
| `person_hosts` | `[host]` | hosts the person typed in this chat (the exfiltration rule allows them after taint; worker-web) |

The worker validates each: a flag that is present must be a bool, each list a list of strings (`bad_message` otherwise). Taint starts from `run.start.tainted_sources`, merged into what the worker already holds for the conversation (append-only), so a chat resumed in a new worker still stages.

### 10.2 `learning` (worker → Go)

`{type: "learning", event: LearningEventW}`, not run-scoped (a learning pass that ends after `run.done` still reports). Every field is always present:

| Field | Values |
| --- | --- |
| `id` | worker uuid (32 hex); Go dedupes by it |
| `kind` | `skill`, `memory` (MEMORY.md, the agent's notes), `user` (USER.md, About you) |
| `action` | `created`, `patched`, `edited`, `deleted`, `added`, `replaced`, `removed`, `archived`, `restored`, `stale` |
| `subject` | the skill name, or `memory`/`user` |
| `before`, `after` | text, each cut at 20,000 characters (`""` when not applicable) |
| `origin` | `chat` (the turn), `review` (the learning pass), `bot`, `user` (a `learning.*` request), `curator`, `sync`, `restore` |
| `conversation_id`, `run_id`, `bot_id` | where it came from (`""` when unknown) |
| `tainted_sources` | the conversation's taint when it happened |
| `status` | `applied` (silent, with Undo), `staged` (waits for Keep/Discard), `blocked` (threat scan; nothing saved) |
| `ledger_entry_id` | the skill-ledger entry of an applied skill change (Undo = `learning.rollback`) |
| `pending_id` | a staged write's id (`learning.pending`) |
| `summary` | one line |

When they are sent: a `staged` or `blocked` event at the moment `timely_learning` decides; `applied` events after the run (after the last `delta`, before `run.done`) and again when a learning pass ends; `stale` from the curator. Each change is reported once: the worker keeps a baseline of the home's ledger ids, memory entries and staged ids from `ready` on, and every diff moves it.

### 10.3 Go → worker requests

Each is answered by `learning.result {id, ok, data}`, or `error` with the request's `id` (`bad_message` for a wrong shape, `not_found`, `unsupported`, `not_ready`, `internal`). `ok: false` means a valid request that did not succeed; `data.message` says why. Handled on a worker thread, after `ready`.

| Type | Fields | `data` |
| --- | --- | --- |
| `learning.list` | `what`: `skills` / `memory` / `pending` | skills: `{skills: [{name, category, source: "learned"\|"edited"\|"bundled"\|"timely"\|"optional", enabled, locked, archived, stale, restored, last_used, created_by_event}]}`; memory: `{memory: {entries, used, limit}, user: {entries, used, limit}}` (limits 2,200 and 1,375); pending: `{pending: [{pending_id, kind, subject, action, diff, origin, conversation_id, summary, created_at}]}` |
| `learning.skill` | `name`, optional `entry` | `{name, content, history: [{id, ts, actor, action, skill, evidence}], diff}` (`diff`, a unified diff, only with `entry`) |
| `learning.rollback` | `ledger_entry_id` | `{ok, message}` (Hermes' `rollback_entry`, actor `user`); Go marks the event undone, no `learning` event |
| `learning.edit` | `name`, `content` | `{entry, events}`: the ledger entry (actor `user`); a `learning` event (`edited`, origin `user`) is also sent. A Timely skill answers `ok: false` (read-only) |
| `learning.skill_state` | `name`, `state`: `lock`/`unlock`/`archive`/`restore`/`delete` | `{name, state, message, locked, archived, events}`; archive, restore and delete also send `learning` events (origin `user`) |
| `learning.memory` | `target`: `memory`/`user`, `action`: `add`/`replace`/`remove`, `content`, `old` | `{target, entries, used, limit, events}`; sends the events (origin `user`). Hermes' scan refuses an injection (`ok: false`) |
| `learning.pending` | `pending_id`, `choice`: `keep`/`discard` | keep: `{pending_id, event, events}` (the applied change, `status: applied`, no separate `learning` message: Go marks the staged event kept); discard: `{pending_id, discarded: true}` |
| `learning.export` | - | `{zip_b64, files, size}`: learned and edited skills plus `memories/`, at most 16 MB (`ok: false` above it) |
| `learning.upstream` | `action`: `list`/`compare`/`keep_mine`/`use_new`, `name` | handled by `timely_agent.skills_admin.handle` (worker-skills-backup); `error` `unsupported` while that module is missing |
| `settings.update` | `settings` (the `render-account` shape) | `{config_sha256}`: `config.yaml` re-rendered in place (skills on/off, web backends, learning); cached agents of idle chats are rebuilt on their next turn (counters kept) |

### 10.4 What `timely_learning` decides (plan 9b.2, Q-3.1, Q-3.7)

For `memory` and `skill_manage`, in the turn and in Hermes' learning pass (which has no run; the hook finds the conversation by the hook's `session_id`, and `bridge.session_state` outlives the run):

1. A `skill_manage` target or a `write_file`/`patch` path under the Timely skills folder: blocked (read-only).
2. `flags.learning_writes` not true, or no run and no session: blocked ("Timely is not saving skills or memory yet").
3. A strict threat-scan hit in any text the write carries: blocked, `learning` event `status: blocked`.
4. Staged (Hermes' pending store, `learning` event `status: staged` with `pending_id`; the model reads "Saved for the person to confirm in Timely; do not retry."): the conversation is tainted; `flags.from_bot`, or a `bot`/`bot_review` run; an unattended memory `patch`/`remove` in the learning pass; or the text matches the skill-body rule (`.hermes-sync/policy/skill-body.yaml`: a tool name the chat policy approves or blocks, as a whole token, or an authority phrase, case-insensitive). After staging in the turn the agent's review counter for that tool is reset.
5. Otherwise applied silently; the feed reports it (`applied`, with the ledger entry for Undo). An edit to a bundled skill changes the account's own copy (copy-on-write).

`session_search` runs only with `flags.search_history`: the worker adds `search_exclude` to `exclude_session_ids`, refuses to read an excluded chat by id or another profile's store, drops excluded chats from any result, and taints the session for each hit in `tainted_conversations`. Bot ticks never reach the search store (phase 6: `bot.run` without a session store).

### 10.5 `ready` and `busy` additions

`ready.web_backends` (`[backend id]`, from `timely_agent.web_backends.available()`, `[]` while that module is missing) and `ready.skills_upstream` (int, from `skills_admin.upstream_count()`, 0 while missing). `busy.learning` is true while a learning pass or the curator runs.

### 10.6 `render-account` / `hello.settings` keys

- `learning: {memory, user_profile}` (default on): renders `memory.memory_enabled`/`user_profile_enabled`, `write_approval: false` (the policy stages, not Hermes' gate), limits 2,200 and 1,375, `nudge_interval: 10`, `skills.creation_nudge_interval: 10`, `skills.ledger: true`. No `auxiliary.background_review`: the learning pass uses the run's provider, model, `base_url` and key (Q-3.2).
- `curator: {enabled, auto_archive: false}` (a bool is read as `enabled`): `consolidate: false`, `interval_hours: 24`, `stale_after_days: 14`, `archive_after_days: 36500`. Hermes has no switch to stop archiving; with that cutoff nothing archives (Q-3.6). The worker's maintenance tick (every 10 minutes, only while no run is live) calls Hermes' `maybe_run_curator`; each skill that turns stale is a `learning` event (`stale`, origin `curator`).
- `web: {search_backend, extract_backend}`: `timely` (default) or a keyed backend id.
- `skills_disabled`: also the learned skills the person turned off and restored ones (Go adds them).
- The Timely plugin set (`plugins.enabled`, the self-test's expected set) is every package folder under `timely_agent/plugins/` whose `__init__.py` defines `register`.

### 10.7 The `timely_web` backend's calls (worker-web)

The model calls Hermes' `web_search`/`web_extract`; with backend `timely` the provider sends `tool.call` through `RunContext.tool_call`: `name: "web_search"`, `args: {query, limit}` → `tool.result {result: {answer, results: [{url, title, description}]}, outside: true}`; `name: "web_extract"`, `args: {urls: [url]}` → `{result: {pages: [{url, title, content, error}]}, outside: true}`; or `{result: {error}}`. `batch_size` is 1 and `sibling_tools` empty (the call is the backend's, not the model's).

The exfiltration rule (plan 9.4, BLOCK in phase 3) runs in `timely_gate`'s `pre_tool_call` before Go is asked: once the session is tainted, a `web_extract` (or `browser_*` URL) to a host neither in `person_hosts` nor returned by a `web_search` of this conversation, a URL carrying text from a Timely read or memory, and a `web_search` query carrying such text are refused in the worker; Go sees no `gate.ask` and no `tool.call`. `timely_gate`'s `post_tool_call` also adds `{kind: web, tool: web_extract, host}` to the session's taint for each host a `web_extract` read, with any backend. Matching rules: `timely_agent/plugins/timely_web/README.md`.

### 10.8 Helper commands (worker-skills-backup)

Same rules as `prepare`: one JSON object on stdout, logs on stderr.

- `boot.py agent-export --agent-dir <root> --account <uid> --out <zip>` → `{ok, format: "timely-agent-state", version: 1, sha256, size, files}`. Included: `memories/`, `skills/` minus pristine bundled copies, `skills/.usage.json`, the ledger and `.curator_backups/blobs`, `pending/`, a WAL-safe `state.db` snapshot, `.timely/`. Excluded: `config.yaml`, `.env*`, `auth.json`, `mcp-tokens/`, `SOUL.md`, `scripts/`, `hooks/`, `plugins/`, `home/`, `workspace/`, checkpoints, caches, logs, runtime.
- `boot.py agent-import --agent-dir <root> --account <uid> --zip <path>` → `{ok, staged_dir, restored_skills, dropped, blocked}`: extracts to `accounts/.restore-<dir>-<ts>/`, drops never-restore paths, threat-scans skills (a hit is dropped and listed in `blocked`), rewrites the ledger's absolute paths, writes `.timely/restored.json`.
- `boot.py agent-reconcile --agent-dir <root>` (also run by `prepare`): a `.restore-*` folder holding a `COMMITTED` marker is swapped in; one without it is deleted.

### 10.9 Files the worker keeps in the account home

- `.timely/counters.json`: `{version: 1, conversations: {<id>: {iters_since_skill, turns_since_memory, updated}}}`, written after every turn, when an agent leaves the cache and at shutdown, and read when an agent is built, so the review fires across turns, cache evictions and worker restarts.
- `.timely/pending/<pending_id>.json`: the Timely context of a staged write (conversation, run, origin, taint, why it was staged).
