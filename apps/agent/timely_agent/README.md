# timely_agent

Timely's host package around the vendored Hermes copy in `../hermes` (plan `docs/plans/2026-11-08-timely-agent-from-hermes.md`, sections 3.2-3.4, 4.4, 5.1, 6, 9.1). The Go API runs it; the wire contract is `../PROTOCOL.md`.

| Module | Job |
| --- | --- |
| `boot.py` | Entry point (`python -I boot.py worker|prepare|render-account`). Moves the protocol to private descriptors before any Hermes import, sets `sys.path = [hermes, apps/agent, site-packages]`. |
| `worker.py` | The per-account worker: hello/ready, runs, ping/heartbeat, shutdown, stdin-EOF lifeline. |
| `protocol.py` | Line framing, message validation, account check, error codes, worker-to-Go request waits. |
| `env_check.py` | The environment allowlist and refusals (plan 6.4); runs before Hermes is imported. |
| `paths.py` | The `<data>/agent` layout (plan 6.1) and the account folder name. |
| `cli.py` | `prepare` (API start) and `render-account` (before each spawn). |
| `config_render.py` | Managed floors, account `config.yaml`, `SOUL.md`, MCP entry rules, the canary. |
| `seed.py` | Seed tree of reviewed bundled skills plus overrides, and the read-only Timely skills copy (plan 9.1). Stdlib git tree ids. |
| `install_guard.py` | Runtime override R1: no package installs in a worker (`../.hermes-sync/patches.md`). |
| `plugin_dist.py` | Serves the Timely plugins to Hermes' `hermes_agent.plugins` entry-point group. |
| `plugins/` | `timely_gate`, `timely_tools`, `timely_learning`, `timely_bot`. |
| `selftest.py` | The checks in `ready.self_test`. |
| `run_chat.py` | One chat turn on `AIAgent.run_conversation`, callbacks as events, a per-conversation agent cache. |
| `bridge.py`, `policy.py` | Run context shared with the plugins; phase-1 tool name lists. |

Tests: `../tests` (`make agent-test`); they start real workers against a stub OpenAI-compatible model.

## Phase 1 decisions and findings (Hermes v0.23.0)

- **Plugin loading (plan 4.3).** Entry points, not plugin folders: `plugin_dist.py` registers an in-memory distribution on `sys.meta_path` whose `entry_points.txt` names `timely_agent.plugins.<name>:register` in the `hermes_agent.plugins` group. Nothing is copied into account homes or pip-installed, and `plugins.enabled` in the managed config still decides what loads. The plugins live in `timely_agent/plugins/`, not `apps/agent/plugins/`: a top-level `plugins` package beside `hermes/` would collide with Hermes' own `plugins` package on `sys.path`.
- **Managed overlay is not seen by every reader (plan 6.3).** `load_config()` deep-merges `HERMES_MANAGED_DIR/config.yaml` on top, but `agent.skill_utils` reads `config.yaml` raw for `skills.external_dirs` and `skills.disabled`. So the account `config.yaml` repeats every managed floor, and the canary checks the managed file, the merged config and the raw skill reader.
- **Floor keys as v0.23.0 names them** (`config_render.managed_floors()`). `plugins.enabled` (the four Timely plugins), `plugins.disabled` (every bundled `kind: platform` manifest plus `image_gen/*`, `video_gen/*` and `dashboard_auth/*`, read from the snapshot), `plugins.isolation: in_process`, `plugins.auto_apply: false`, `plugins.auto_update_check_hours: 0`, `plugins.entries.timely_bot.allow_tool_override`, `security.allow_private_urls: false`, `security.fake_ip_ranges: []`, `security.allow_lazy_installs: false`, `security.redact_secrets/protected_instruction_files: true`, `telemetry.shared_metrics.enabled/send: false`, `approvals.mode: manual` (a valid mode), `approvals.cron_mode/unattended_mode/single_query_mode: deny`, `skills.inline_shell: false`, `skills.guard_agent_created: true`, `skills.project_discovery: false`, `skills.trusted_project_dirs: []`, `skills.external_dirs`, `skills.create_dir: ''`, `web.keyless_fallback/keyless_rescue: false`, `browser.executable_path`, `browser.use_real_profile: false`, `browser.auto_local_for_private_urls: false`, `lsp.install_strategy: manual` (no `go install` / `npm install` of a language server), `memory.provider: ''`, `display.language: en`, `auth.adopt_external_logins: false` (Hermes would otherwise borrow the host user's Codex and Claude Code logins), `cron.allow_agent_scheduling: false`, `hooks_auto_accept: false`, `tools.tool_search.enabled: off` (until the phase 2 measurement), `tools.connectors.enabled: false`, `agent.disabled_toolsets` (`NEVER_TOOLSETS`; AIAgent does not read this key, so `run_chat.build_agent` passes the same list as `disabled_toolsets` and `run.start` refuses those toolsets and `hermes-*` bundles), `auxiliary.title_generation.enabled: false` and `command_allowlist: []` (no config can pre-approve a call). There is no browser "auto-download" key: Chromium arrives through Hermes' package manager, which the install guard and `allow_lazy_installs: false` block. Bundled platform plugins register whatever `plugins.enabled` says, and only `plugins.disabled` wins, so the managed config lists each one there; the self-test fails on any enabled platform plugin or imported adapter module, the worker never starts the gateway and the environment carries no platform tokens.
- **Locales.** `display.language: en` is pinned and `HERMES_LANGUAGE` / `HERMES_BUNDLED_LOCALES` are refused, so the English-only copy is enough (sync finding 6).
- **Account folder name.** `account-` + hex of the first 12 bytes of sha256(uid), 24 hex characters, exactly as `portability/service.go`; the plan's `sha256(uid)[:12]` means bytes.
- **Essential skills.** Hermes never lets `hermes-agent` be disabled (`ESSENTIAL_SKILLS`), and `skills-reviewed.json` marks it `default: off`, so the seed tree leaves it out entirely; other `default: off` skills are seeded and listed in `skills.disabled`. The self-test fails if Hermes' essential list changes.
- **Gate ordering.** Hermes applies every plugin's `block`, whatever the order, so `timely_gate` lets `skill_manage` through without asking Go and `timely_learning` owns its policy.
- **Python.** uv-managed CPython 3.14.9 (the build Hermes pins in `pm/lock.json`), installed from Hermes' own `uv.lock` with `--no-install-project`.
- **Cost (this machine, warm).** Spawn to `ready` 1.0-1.2 s, including the Hermes import, plugin discovery, seeding 43 skills into a fresh home and the self-test.
