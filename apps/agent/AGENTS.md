# apps/agent: Timely's agent, built on a copy of Hermes Agent

`hermes/` is a filtered, byte-identical copy of [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT). Timely runs it in per-account Python workers that the Go API spawns (ADR 0026). Everything else in this folder is Timely's. The design is `docs/plans/2026-11-08-timely-agent-from-hermes.md`; read its section 4 before changing how the copy is used.

## Where code goes

- **Timely code** lives beside the copy: `timely_agent/` (worker, adapters, plugins, tests), `skills/` (Timely skills; `skills/overrides/<name>/` replaces an upstream skill of that name; the folder arrives in phase 2 with the `timely` skill, and until then `prepare` stages an empty read-only copy on purpose), `.hermes-sync/` (filter, sync records, policy files).
- **Behaviour changes to Hermes** go through runtime seams first: `AIAgent` constructor arguments and callbacks, plugin hooks (`pre_tool_call`, `post_tool_call`, `register_tool`), per-home `config.yaml` and `SOUL.md`, the approval bridge, and the write-approval, skill-ledger and skills-sync APIs.
- **Patch points** are the last resort: a one-line call into `timely_agent` inside a vendored file, marked `# TIMELY(Pn)` and listed in `.hermes-sync/patches.md`. Budget: zero today, hard cap five. Fixes that belong upstream go upstream.

## The copy is read-only

`hermes/` changes only through `make hermes-sync`. Treat every file under it as upstream's: edit, rename, move, reformat or delete one only at a listed patch point. That includes `hermes/pyproject.toml`, `hermes/uv.lock` and `hermes/HERMES_UPSTREAM.json`. To turn a Hermes feature off, disable it by config or by the tool policy; a deleted vendored file conflicts on every later sync.

Hermes' own `AGENTS.md` files (`hermes/AGENTS.hermes.md`, `hermes/<pkg>/AGENTS.md`) describe its architecture and are worth reading. Their workflow rules (rebase onto main, `scripts/run_tests.sh`, `hermes pm lock`, `hermes update`) are upstream's process and do not apply here.

Any Hermes process you start, test or script gets fresh `HERMES_HOME` and `HERMES_RUNTIME_DIR` folders under a temp dir such as `$HOME/.cache/timely-agent-test/`. Your own `~/.hermes` stays untouched: never read, write or point anything at it.

## Running and testing the worker

The Go API spawns one worker per account (`apps/api/internal/agenthost`); the wire contract is `PROTOCOL.md`. Commands, all from the repo root (export `TMPDIR=$HOME/.cache/gotmp` first when `/tmp` is a small tmpfs):

| Command | What it does |
| --- | --- |
| `make agent-install` | builds `apps/agent/.venv` from Hermes' own `uv.lock` (uv-managed CPython 3.14.9, extras in `.hermes-sync/extras.txt`). Without uv it prints a notice and exits 0. `make install` runs it. |
| `make agent-lint` | ruff on `timely_agent/` and `tests/`. |
| `make agent-test` | worker unit and process tests (`tests/`, not `tests/contract`). `ARGS=...` passes pytest arguments. |
| `make agent-contract` | the contract tests of plan 10.4 f (`tests/contract/test_contract.py`, numbered `test_cNN_*`), against real workers and the stub model. `ARGS="-k c19"` picks some. |
| `make agent-go-integration` | the Go supervisor with the real worker: prepare, render-account, spawn, `hello`, `ready`, `run.start` on a Go stub model, `run.done`, `shutdown`. |
| `make agent-go-vet-windows` | vets the Windows spawn path (Job Object) from any OS. |
| `make hermes-sync-check` | the post-sync checks: plan 10.4 a-f and the agent half of g (`agent-test`, `agent-contract`). The Go half, `make test-api`, runs in CI's api job; run it yourself after a sync. |

Rules for tests and experiments:

- The model is always a stub: `tests/stub_openai.py` (Python) or `stubModel` in `agenthost/integration_test.go`, both on 127.0.0.1 with an OS-picked port. Never point a test at a live provider, and never use ports 8080/4001.
- Test agent folders go under `$HOME/.cache/timely-agent-test/run-<pid>` and are removed after the session (`TIMELY_AGENT_KEEP=1` keeps them). Go tests use `$HOME/.cache/timely-agent-test/agenthost-*`.
- Start workers the way Go does: `tests/harness.py` (`Agent` prepares a folder and renders an account; `Worker` spawns `<venv python> -I timely_agent/boot.py worker` with an environment built from scratch; `timely_tools()` gives `hello.timely_tools` from `tests/fixtures/timely_tools.json`; `drive()` plays Go for one run, answering `tool.call` and `gate.ask`). `tests/contract/probe_boot.py` wraps the same boot path for the network probe (test 5), the stdout tool (test 19), the taint-source tool (test 18), the Timely block placement (test 6) and a forced `tool_search` mode (measurements only).
- The stub model takes directives in the user message: `CALL`, `SLOW`, `STREAM`, `LOOP` and `SCRIPT` (several tool calls in one message, multi-step turns); see its docstring. Text containing `STEER` is treated as a steer of the running turn.
- `tests/record_events.py --out <dir>` (`make agent-record-fixtures OUT=<dir>`) records the worker -> Go event fixtures the Go engine replays; `tests/measure_prompt.py` reruns the tool_search and context-engine measurements in `timely_agent/README.md`. Both use only the stub model.
- `tests/fixtures/timely_tools.json` is a snapshot of Go's chat tool specs. When Go's catalog changes a lot, refresh it from `GET /agent/tool-specs` so the measurements stay representative.
- By hand: `boot.py prepare --agent-dir <dir>` once, `boot.py render-account --agent-dir <dir> --account <uid> --prepared <json>` (settings JSON on stdin; `--prepared` holds prepare's `timely_skills_dir`, `seed_skills_dir`, `browser_executable` and `skills_default_off`), then spawn `boot.py worker` with the `env` both print, plus `PATH`, `LANG`, `TMPDIR` and `HERMES_REAL_HOME`. The first stdin line is `hello` with `home` and `settings_hash` from render-account and prepare's values (PROTOCOL.md).
- Hermes is imported only inside worker and helper subprocesses, never into the pytest process.
- A new Hermes symbol imported in `timely_agent` is picked up by contract test 7 automatically; a symbol reached through a module or object attribute goes in its `SYMBOLS` table. A Hermes behaviour Timely depends on goes in `TIMELY_SEAMS` (`scripts/hermes-sync/check_seams.py`), then `make hermes-tools-dump`.

## Parity run: 84 scenarios on both engines

Phase 2's exit needs the 84 agent QA scenarios run on classic and on the agent engine with a real model. It is the one check that calls a live provider. The owner's choice for it is **Claude Code with Sonnet** (`PROVIDER=claude MODEL=sonnet`): the API host's own signed-in `claude` CLI, so no key is handed over. On the agent engine, Claude Code and Codex go through the loopback model gateway (`apps/api/internal/features/provider/gateway.go`, plan 5.7): an OpenAI-compatible server on 127.0.0.1 and an OS-picked port that answers with the same Completer classic uses. An API-key provider needs the owner's key instead. The harness is `apps/api/scripts/agentqa` (its `README.md` has the scoring and scenario format).

1. Start a worktree API on 8081 with its own schema and the agent runtime (`make agent-install` once). Do not use ports 8080 or 4001:
   `DB_SCHEMA=parity ALLOW_REGISTRATION=true TIMELY_DATA_DIR=$HOME/.cache/timely-parity/data make dev-worktree-api`
2. For an API-key provider only: in the same shell that runs the harness, export the key. It is read only from `TIMELY_PARITY_KEY`, and `make` refuses a value that comes from `.env` or the command line. `claude` and `codex` need none: the harness connects the host's CLI.
3. Run both engines:
   `make agent-parity ENGINE=both PROVIDER=claude MODEL=sonnet SCENARIOS=apps/api/scripts/agentqa/scenarios.json OUT=$HOME/.cache/timely-parity/$(date +%Y%m%d-%H%M)`
   - `MODEL` is the id Settings → Agent lists for that provider (`sonnet` for Claude Code).
   - The chats run Supervised, the harness's `-permission` default, so every proposal waits and the scenario approves it.
   - `ONLY=tasks-01,docs` picks scenario ids or whole categories.
   - `TIMELY_API` changes the API, which defaults to `http://localhost:8081`.
   - `TIMELY_PARITY_DSN` (a DSN whose `search_path` is `parity`) adds classic's tool trace.
   - Each engine gets its own throwaway account, `agentqa+<engine>-<n>@example.invalid`, in that schema.
4. Results go to `OUT`:
   - `classic.json` and `agent.json`: per scenario, the engine, status, replies, the proposal (held or applied), what Approve led to, the tool trace, the time, and pass or fail with the reasons.
   - `report.md`: totals per engine and category, plus every scenario side by side with whether the two engines ended the same way.
5. Unset the key afterwards (`unset TIMELY_PARITY_KEY`). Never paste it into a file, commit, PR or reply. Record the totals in the plan's phase 2 status. The margin that counts as parity is still the owner's to set.

To try the harness without a key, run the stub smoke in `apps/api/scripts/agentqa/README.md` ("Against the stub model").

## Syncing Hermes

1. `make hermes-sync` (newest stable `vX.Y.Z`) or `make hermes-sync HERMES_REF=v0.23.1`. On `dev` it first creates `fix/hermes-sync-<tag>`. Cadence: a tagged release every one to two weeks, a security fix at once.
2. Read the report at `.git/hermes-sync-report.md` (it is the PR body): classify new tools in the policy file, review changed skills, check dependencies, config and seams.
3. Resolve conflicts:
   - content conflict at a patch point: take upstream, re-apply the change from `patches.md`, keep the marker; if upstream now offers a seam, move the logic into `timely_agent` and drop the patch point.
   - modify/delete: restore the file, then disable it by config or policy.
   - rename/modify: check the marker moved with the file.
   - `hermes/HERMES_UPSTREAM.json`: always theirs.
4. `make hermes-sync-check`; commit the regenerated dumps and policy changes on the sync branch.
5. Open the PR with the report as its body and merge it with a **merge commit**. A squash or rebase cuts the link to the snapshot and the next sync (and `make hermes-sync-check`) refuses to run. Recovery: find the real snapshot commit whose `apps/agent/hermes/HERMES_UPSTREAM.json` matches HEAD's. `scripts/hermes-sync/snapshot-of.sh <tag>` searches HEAD, every local ref (each sync sets `refs/hermes/snapshots/<tag>`) and every reflog. By hand: the second parent of the `hermes: sync <tag>` merge on the branch that imported it; when a rebase dropped that merge from your own branch, the branch reflog still has it (`git log -g --format='%H %gs' <branch>`, then `<merge>^2`); for a squash-merged PR, `git fetch origin pull/<n>/head` and take it from there. Then `git merge -s ours --allow-unrelated-histories <snapshot>` and re-run `make hermes-sync HERMES_REF=<tag>`. The flag is needed because the first snapshot shares no history with Timely. The re-run finds nothing to import, but when the rebase dropped the `hermes: sync <tag>` merge (the only commit that recorded the tag in `.hermes-sync/tags.json`), it records the tag again in a commit of its own, so `make hermes-sync-check` passes. A replayed snapshot (rebase) or a wrong one merged earlier is skipped as long as its record differs. `refs/hermes/vendor` is only the last snapshot any sync on this clone made (all worktrees share it), so check its tag before using it.

How the script works, the filter and the verification records: `.hermes-sync/README.md`.
