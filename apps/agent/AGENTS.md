# apps/agent: Timely's agent, built on a copy of Hermes Agent

`hermes/` is a filtered, byte-identical copy of [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT). Timely runs it in per-account Python workers that the Go API spawns (ADR 0026). Everything else in this folder is Timely's. The design is `docs/plans/2026-11-08-timely-agent-from-hermes.md`; read its section 4 before changing how the copy is used.

## Where code goes

- **Timely code** lives beside the copy: `timely_agent/` (worker, adapters, plugins, tests), `skills/` (Timely skills; `skills/overrides/<name>/` replaces an upstream skill of that name), `.hermes-sync/` (filter, sync records, policy files).
- **Behaviour changes to Hermes** go through runtime seams first: `AIAgent` constructor arguments and callbacks, plugin hooks (`pre_tool_call`, `post_tool_call`, `register_tool`), per-home `config.yaml` and `SOUL.md`, the approval bridge, and the write-approval, skill-ledger and skills-sync APIs.
- **Patch points** are the last resort: a one-line call into `timely_agent` inside a vendored file, marked `# TIMELY(Pn)` and listed in `.hermes-sync/patches.md`. Budget: zero today, hard cap five. Fixes that belong upstream go upstream.

## The copy is read-only

`hermes/` changes only through `make hermes-sync`. Treat every file under it as upstream's: edit, rename, move, reformat or delete one only at a listed patch point. That includes `hermes/pyproject.toml`, `hermes/uv.lock` and `hermes/HERMES_UPSTREAM.json`. To turn a Hermes feature off, disable it by config or by the tool policy; a deleted vendored file conflicts on every later sync.

Hermes' own `AGENTS.md` files (`hermes/AGENTS.hermes.md`, `hermes/<pkg>/AGENTS.md`) describe its architecture and are worth reading. Their workflow rules (rebase onto main, `scripts/run_tests.sh`, `hermes pm lock`, `hermes update`) are upstream's process and do not apply here.

Any Hermes process you start, test or script gets fresh `HERMES_HOME` and `HERMES_RUNTIME_DIR` folders under a temp dir such as `$HOME/.cache/timely-agent-test/`. Your own `~/.hermes` stays untouched: never read, write or point anything at it.

## Syncing Hermes

1. `make hermes-sync` (newest stable `vX.Y.Z`) or `make hermes-sync HERMES_REF=v0.23.1`. On `dev` it first creates `fix/hermes-sync-<tag>`. Cadence: a tagged release every one to two weeks, a security fix at once.
2. Read the report at `.git/hermes-sync-report.md` (it is the PR body): classify new tools in the policy file, review changed skills, check dependencies, config and seams.
3. Resolve conflicts:
   - content conflict at a patch point: take upstream, re-apply the change from `patches.md`, keep the marker; if upstream now offers a seam, move the logic into `timely_agent` and drop the patch point.
   - modify/delete: restore the file, then disable it by config or policy.
   - rename/modify: check the marker moved with the file.
   - `hermes/HERMES_UPSTREAM.json`: always theirs.
4. `make hermes-sync-check`; commit the regenerated dumps and policy changes on the sync branch.
5. Open the PR with the report as its body and merge it with a **merge commit**. A squash or rebase cuts the link to the snapshot and the next sync refuses to run (recovery: `git merge -s ours <lost snapshot>`).

How the script works, the filter and the verification records: `.hermes-sync/README.md`.
