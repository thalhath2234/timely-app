# Worker protocol (Go API ↔ agent worker), version 1

The contract between `apps/api/internal/agenthost` (Go) and `apps/agent/timely_agent` (one Python worker per account). Design: plan section 5.1 of `docs/plans/2026-11-08-timely-agent-from-hermes.md`. Where the plan left a name open, this file fixes it; the worker implements exactly what is written here (`timely_agent/protocol.py`, `worker.py`), and `apps/agent/tests/test_worker.py` drives it over real pipes.

## 1. Before spawning

Go runs two helper commands with the runtime interpreter. Each reads one optional JSON object on stdin and prints exactly one JSON object on stdout (exit 0), or `{"ok": false, "error": "..."}` (exit 1). Logs go to stderr.

```
<venv>/bin/python -I apps/agent/timely_agent/boot.py prepare        --agent-dir <TIMELY_DATA_DIR>/agent
<venv>/bin/python -I apps/agent/timely_agent/boot.py render-account --agent-dir <TIMELY_DATA_DIR>/agent --account <uid>
```

On Windows the interpreter is `<venv>\Scripts\python.exe`.

**`prepare`** (API start). Input: `{"browser_executable": "<path to Chrome/Edge or empty>"}`. Creates the layout of plan 6.1, writes `instance.json` (`layout_version`; it keeps keys Go adds), the read-only Timely skills copy and the skill seed tree (plan 9.1), `managed/config.yaml` (plan 6.3), and checks the managed file through Hermes' own loader (canary). Output:

| Field | Meaning |
| --- | --- |
| `ok` | true |
| `managed_config`, `managed_sha256` | the managed file and its hash |
| `timely_skills_dir` | `<agent>/timely-skills/<hash>`, the only `skills.external_dirs` entry |
| `seed_skills_dir` | `<agent>/seed/<hash>/skills` |
| `seed` | counts: `seeded`, `unreviewed`, `overridden`, `override_only`, `essential_off`, `default_off` |
| `env` | `HERMES_MANAGED_DIR`, `HERMES_RUNTIME_DIR`, `HERMES_GATEWAY_LOCK_DIR`, `XDG_STATE_HOME`, `HERMES_BUNDLED_SKILLS` for every worker |

The managed file pins `plugins.enabled` to the four Timely plugins and lists in `plugins.disabled` every bundled `kind: platform` plugin (messaging adapters, a2a) plus `image_gen/*`, `video_gen/*` and `dashboard_auth/*`, read from the snapshot's manifests: Hermes auto-loads bundled backends and registers bundled platforms whatever `plugins.enabled` says, and only `plugins.disabled` overrides that. Web search and browser backends and `delegation/default` stay loaded for later phases.

`prepare` also writes `<agent>/runtime/prepared.json`; `render-account` and the worker read it, so `prepare` must have run once per API start before either.

**`render-account`** (before each spawn). Input: the account settings (all optional):

| Setting | Type | Effect |
| --- | --- | --- |
| `model` | `{default, provider, base_url, api_mode}` | account model defaults |
| `toolsets` | `[string]` | account default toolsets (never-offered ones are dropped) |
| `skills_disabled` / `skills_enabled` | `[string]` | skill names off / turned on (reviewed bundled skills marked `default: off` stay off unless listed in `skills_enabled`) |
| `learning` | `{memory: bool, user_profile: bool}` | memory toggles (phase 3) |
| `curator` | bool | curator on/off |
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

- One JSON object per line, UTF-8, terminated by `\n` (`\r\n` accepted). A line over 32 MiB is refused (`bad_message`). The worker escapes non-ASCII as `\uXXXX`, so its lines are ASCII; a lone surrogate (a model stream split inside an emoji) arrives as an escape Go decodes to U+FFFD.
- Every message has `type` and `account`. The worker pins the account from `hello`; any later message for another account gets `wrong_account` and is ignored. Every worker message after `hello` carries the worker's account.
- Requests carry `id`; the reply to a request carries the same `id`. Go's ids start with `go-`; the worker's ids start with `w-`.
- Run-scoped messages carry `run` (the run id Go chose).
- The worker never writes anything but protocol lines to stdout: before Hermes is imported, `boot.py` duplicates the pipes to private, non-inheritable descriptors, points fd 0 at the null device and fd 1 at stderr, so prints and child-process output go to the log stream.

## 4. Messages, Go → worker

| Type | Fields | Answer |
| --- | --- | --- |
| `hello` | `id`, `protocol` (1), `home` (the account's `HERMES_HOME`), `settings_hash` (the `config_sha256` from `render-account`), `catalog_version`, optional `settings` (section 6) | `ready` or `error` |
| `ping` | `id` | `pong` |
| `run.start` | `id` (Go's `Send` gives each start an id starting `start-`), `run`, `conversation_id`, `session_key` (`timely:<uid>:<conversation>`), `user_message`, `system_hash`, `system_text`, `model` `{provider, model, base_url, api_key, api_mode, reasoning}`, `toolsets` (explicit list, required, may be empty), `flags` `{sensitive, answer_only, web, rich_ui, from_bot}`, `budgets` `{max_iterations}`, `tainted_sources` `[{kind, tool, host?, session?}]`, `pre_approved` `{tool, args_hash}` or null, `history` (only when `state.db` lacks the session) | `event`s, then `run.done` with the same `id`; or `error` with the same `id` and `run` |
| `run.stop` | `id`, `run`, `reason` | the run's `run.done` with `interrupted: true`; `error` (`unknown_run`) if no such run |
| `run.steer` | `id`, `run`, `text` | `ack` |
| `approval.answer` | `id`, `run`, `request_id`, `choice` (`once` or `deny`) | `ack` |
| `tool.result` | `id` (the worker's `tool.call` id), `result`, `outside` (bool) | none |
| `gate.verdict` | `id` (the worker's `gate.ask` id), `verdict` (`allow`, `block`, `approve`), `message` | none |
| `session.delete` | `id`, `conversation_id` | `ack` (`busy` error while the conversation has a live run) |
| `shutdown` | `grace` (seconds, default 5) | none: the worker waits up to `grace` for live runs, interrupts the rest (up to 2 s more), and exits 0. Go sends its own stop budget minus 3 s, so a worker following this exits before Go sends SIGTERM |
| `bot.run`, `learning.*` | later phases | `error` `unsupported` in phase 1 |

An `error` that carries `run` and the `id` of that run's own `run.start` (a refusal: `busy`, `refused`, `bad_message`, `not_ready`, `internal`) ends that run: no `run.done` follows. Go stops counting the run as live and hands the error to the run's owner. `duplicate_run` does not end the run (the first start is still running), and neither does an error answering `run.stop`, `run.steer` or `approval.answer`, even though it carries `run`. Go never sends a line over 32 MiB: it refuses such a `run.start` before marking the run live, because the worker's `bad_message` for an oversized line cannot name the run.

`args_hash` is the sha256 of the tool arguments' canonical JSON (keys sorted, separators `,` and `:`, non-ASCII kept as UTF-8).

Closing the worker's stdin is the lifeline: the worker interrupts live runs and exits 0 within about two seconds.

## 5. Messages, worker → Go

| Type | Fields |
| --- | --- |
| `ready` | `id` (the hello's), `protocol` (1), `hermes_tag` (e.g. `v0.23.0`), `tools` (tool names that resolve for every toolset a Timely run may enable), `plugins_loaded` (enabled plugin keys, including `timely_gate`, `timely_tools`, `timely_learning`, `timely_bot`), `self_test` `{ok, failures: ["<check>: <detail>"], checks: [{name, ok, detail}]}`, `config_sha256`, `catalog_version` (echo), `skills_sync` (Hermes' `sync_skills` counts), `boot_ms` |
| `pong` | `id` (the ping's), `busy` |
| `heartbeat` | `busy`; sent every 10 s after `ready` |
| `event` | `run`, `kind`, `payload` (below) |
| `tool.call` | `id`, `run`, `session_key`, `tool_call_id`, `name`, `args`, `tainted_sources`, `batch_size`, `sibling_tools` (phase 2) |
| `gate.ask` | `id`, `run`, `tool_call_id`, `tool`, `args`, `tainted_sources`, `run_kind` (`chat` or `bot`) |
| `taint` | `run`, `sources` (phase 3) |
| `run.done` | `id` (the run.start's), `run`, `final_response`, `completed`, `interrupted`, `turn_exit_reason`, `tokens` `{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens}` (this turn only), `estimated_cost_usd` (this turn, or null), `turn_id`, `tainted_sources`, optional `error` (the turn failed; `final_response` may be empty) |
| `ack` | `id`, `ok` (bool) |
| `log` | `level`, `text` |
| `error` | optional `id` (the request it answers), optional `run`, `code`, `message` |

`busy` is `{runs, learning, children}`: live runs, a learning pass in progress, tracked child processes (`children` counts the background processes in Hermes' process registry; phase 1 always reports `learning: false`). A busy worker must not be reaped.

**Event kinds** (`event.payload`):

| Kind | Payload |
| --- | --- |
| `delta` | `{text}`: streamed reply text |
| `reasoning` | `{text}` |
| `tool.started` | `{tool_call_id, tool, args}` |
| `tool.completed` | `{tool_call_id, tool, result}` (long values are cut at 4,000 characters) |
| `status` | `{kind, message}`: Hermes lifecycle notes (compaction, retries) |
| `approval.request` | Hermes' approval data: `request_id`, `pattern_key`, `description`, `timeout_s` and the other scalar fields; answer with `approval.answer` |
| `learning`, `subagent` | later phases |

**Gate.** Every tool call passes `timely_gate`. Messaging and never-offered tools are blocked locally; `todo_list`, `skills_list`, `skill_view`, `skill_manage` and the `timely` toolset run without asking (other plugins can still block them: `timely_learning` blocks every `skill_manage` write to a Timely-shipped skill); everything else sends `gate.ask`. Go must answer within 25 s (Hermes' hook timeout is 30 s and fails closed); no answer means block. `approve` makes Hermes raise its approval gate (rule key `timely:<tool_call_id>`), which arrives as an `approval.request` event.

## 6. Hello

The worker checks, in order, and answers `error` (with the hello's `id` and `account`) on the first failure:

1. `protocol` is 1 (`protocol_mismatch`).
2. `home` resolves to the worker's `HERMES_HOME` (`home_mismatch`).
3. The home folder is `account-<hash of account>` (`wrong_account`).
4. Config: when `settings` (an object, same shape as the `render-account` input) is present, the worker renders `config.yaml` from it itself (a file that no longer matched `settings_hash` is logged as edited and overwritten); otherwise `config.yaml`'s sha256 must equal `settings_hash` (`config_mismatch`: run `render-account` again and respawn).

Then it imports Hermes, bridges the account's `terminal.*` config into the `TERMINAL_*` process environment (Hermes' own `apply_terminal_config_to_env`, plus `TERMINAL_HOME_MODE`, which that bridge leaves out), loads the plugins, seeds bundled skills into the home (`sync_skills`) and runs the self-test. A failed `hello` leaves the worker waiting for a correct one; a second `hello` after `ready` is `bad_message`.

**Self-test checks** (`self_test.checks[].name`): `plugins` (the four Timely plugins loaded without errors from Timely's own entry points, and the enabled set equal to `selftest.EXPECTED_PLUGINS`), `user_plugins` (`$HERMES_HOME/plugins` is empty and project plugins are off: a folder there replaces an entry-point plugin with the same key), `gate_hook` (`pre_tool_call` holds timely_gate's and timely_learning's own functions, compared by identity), `dotenv` (no `.env` Hermes would load exists: the worker sets `<home>/.env` and `<home>/.op.env` aside as `*.timely-disabled` before importing Hermes; `<agent>/hermes/.env` and `$HERMES_MANAGED_DIR/.env` only fail the check), `env_drift` (no environment name changed after the start check, besides the `TERMINAL_*` names the terminal bridge sets from the account config), `home` (Hermes resolves the expected `HERMES_HOME`), `no_messaging` (no messaging tool resolves, no platform plugin is enabled, no platform adapter module is imported), `managed_config` (the managed floors read back through Hermes' loaders: managed file, merged `load_config()`, and the raw reader skill discovery uses), `essential_skills` (Hermes' non-disableable skill list matches Timely's copy), `install_guard` (runtime installs blocked), `mcp` (no unapproved stdio MCP server). When `self_test.ok` is false the worker answers every `run.start` with `error` `refused` and Go should stop it and show "The agent could not start" with `self_test.failures`.

Each run binds Hermes' per-turn terminal policy from `config.yaml` and the managed floors (`tools.terminal_scope.install_profile_terminal_scope`, as Hermes' gateway does): local backend, `cwd` = `<home>/workspace`, `home_mode: profile`, so terminal children get `HOME=<home>/home`, never the OS user's home. An unreadable config installs Hermes' refusal scope and terminal tools fail closed.

## 7. Errors

| `code` | When |
| --- | --- |
| `bad_json` | the line is not JSON |
| `bad_message` | not an object, no `type` or `account`, missing required fields, oversized line, second `hello` |
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
| `unsupported` | a later-phase message (`bot.run`, `learning.*`) |
| `internal` | an unexpected worker failure while handling the message |

## 8. Timeouts Go applies (plan 5.1)

- `ready` within 20 s of `hello` (a cold first start imports Hermes and seeds skills; about 1-4 s on a warm machine).
- Any line, `heartbeat` or `pong` at least every 30 s; otherwise kill the process group.
- `gate.ask` and `tool.call` answers within 25 s.
