# .hermes-sync

Timely-owned records for the Hermes copy in `apps/agent/hermes/`. Plan: `docs/plans/2026-11-08-timely-agent-from-hermes.md` sections 4 and 10.

| File | What | Written by |
| --- | --- | --- |
| `filter` | which upstream paths are copied | hand; commit before syncing |
| `tags.json` | every tag Timely imported and the commit it pointed at; a known tag that moves is refused | `make hermes-sync` |
| `patches.md` | patch points in vendored files (none yet; cap five) | hand |
| `tools.json`, `skills.json`, `seams.json` | runtime dumps of the snapshot (tools by name and owner with schema hashes, skill trees, seam source hashes) | `make hermes-tools-dump`; compared by `make hermes-sync-check` |
| `policy/tools.yaml`, `policy/skills-reviewed.json`, `policy/skill-body.yaml` | tool dispositions per run kind, reviewed skill trees, skill-body tokens | hand (`make hermes-skills-review NAME=<skill>` records a reviewed tree) |
| `extras.txt` | Hermes extras the runtime installs (`make agent-install`, later `stage-agent.mjs`) | hand |

## How `make hermes-sync` works

`scripts/sync-hermes.sh`, with stdlib helpers `scripts/hermes-sync/snapshot.py` and `report.py`:

1. Refuses a dirty tree, a merge in progress, detached HEAD and `main`. On `dev` it creates `fix/hermes-sync-<tag>` (only once there is something to merge).
2. Picks `HERMES_REF` or the newest tag matching `^v[0-9]{1,3}\.[0-9]+\.[0-9]+$`.
3. Shallow-fetches the tag into the persistent bare cache `${XDG_CACHE_HOME:-$HOME/.cache}/timely/hermes-upstream.git` (`HERMES_CACHE` overrides; 113 MiB cold for one tag, about 6 MiB per later tag).
4. Verifies the tag, which upstream does not sign: the GitHub release (`gh api repos/NousResearch/hermes-agent/releases/tags/<tag>`) must be published, not a prerelease, and target the same commit; the commit in the tag body's JSON must match; `tags.json` must not record a different commit for the tag; the commit must descend from the last import (`git merge-base --is-ancestor`, deepening the cache with `--shallow-since` when needed). `HERMES_ALLOW_NON_DESCENDANT=1` and `HERMES_SKIP_RELEASE_API=1` override the last two, and the report says so.
5. Finds the previous snapshot (`hermes: snapshot` commit with a `Hermes-Commit:` trailer) and refuses if HEAD's `HERMES_UPSTREAM.json` differs from it (a squash cut the link), or if that commit is not a real snapshot: files outside `apps/agent/hermes/` in its tree or a parent that is not a snapshot (a rebase replayed it onto a Timely commit; `check_lib.py verify-snapshot`, which `check.sh` runs too). Recover with `git merge -s ours --allow-unrelated-histories <snapshot>` (the snapshot is the second parent of the `hermes: sync` merge, or `refs/hermes/vendor` where the sync ran). Refuses any branch but `dev` (it then makes `fix/hermes-sync-<tag>`) or a `feature/` or `fix/` branch.
6. `snapshot.py` lists the tag's tree, applies the filter, copies the missing blobs from the cache into Timely's object store (`pack-objects | index-pack`, byte-identical, no checkout), adds `HERMES_UPSTREAM.json` (repo, tag, commit, commit date, filter blob id, stats) and writes the tree with a temp index. Same tree as the previous snapshot: "already up to date", exit 0, nothing written.
7. `commit-tree -p <previous snapshot>` with message `hermes: snapshot <tag>` and trailers `Hermes-Tag`, `Hermes-Commit`, `Filter-Sha1`; moves the local ref `refs/hermes/vendor` (outside `refs/heads`, so it is never a branch).
8. Writes the report to `.git/hermes-sync-report.md` (in a worktree, that worktree's git dir).
9. `git merge --no-ff --no-commit` (plus `--allow-unrelated-histories` on the first import), records the tag in `tags.json` in the same merge, commits `hermes: sync <tag>`. Conflicts: exit 2 with the resolution steps; `tags.json` is already staged.

Exit codes: 0 merged or up to date, 1 refused, 2 conflicts.

### Hash conventions (for the later policy files)

- Skill tree hash: the git tree id of the skill folder in the snapshot, `git rev-parse <snapshot>:apps/agent/hermes/skills/<category>/<name>`. `report.py` compares `policy/skills-reviewed.json` entries (`{"<path>": "<tree id>"}` or `{"<path>": {"tree": "<tree id>"}}`, optionally under a top-level `skills` key) against it.
- Seam source hash: sha256 of the definition's exact source text (`ast.get_source_segment`). `report.py` keeps a static seam list (`SEAMS`) and reads `seams.json` entries as `{"<label>": {"sha256": ...}}` when present.

## Filter decisions

- Owner answer Q-1.4: `plugin-catalog/` and the optional skills are copied; non-English locales are not (`skip locales/*`, `keep locales/en.yaml`).
- `hermes` at the upstream root is the CLI launcher script, not a package, and there is no `hermes_agent/` directory (that name is only the plugin entry-point group), so the plan's `dir hermes` and `dir hermes_agent` lines were dropped. The launcher is copied as a root file and is never on a worker's `PATH`.
- Beyond the plan's list, the filter also skips `*pnpm-lock.yaml`, `*yarn.lock`, `*.env` and `*.env.*` anywhere, the same set `make hermes-sync-check` forbids.

## Phase 1 verification (v0.23.0, 2026-11-09)

**Copy size.** 5,340 files, 74,217,605 bytes (70.8 MiB) plus `HERMES_UPSTREAM.json`. Dropped by top-level folder: apps 4,910, tests 7,766, contributors 2,317, website 791 (one file kept: `website/static/api/model-catalog.json`), ui-tui 661, web 261, evals 236, .github 81, tests-js 46, locales 34, root files 30, docker 26, nix 25, scripts 14 (`whatsapp-bridge`), plugins 8 (`photon/sidecar`), native 5. No symlinks, no submodules, no case-colliding paths; the longest path is 150 characters with the `apps/agent/hermes/` prefix (none over 200, relevant for the Windows runners). 17 licence files are kept (root `LICENSE`, `plugins/security-guidance/{LICENSE,NOTICE}` Apache-2.0, `plugins/hermes-achievements/LICENSE`, 13 in skill folders).

**(a) Non-English locales.** Every Python read of `locales/` at v0.23.0:

- `agent/i18n.py` `_load_bundled(lang)` reads `locales/<lang>.yaml` only for the active language (`lang=` argument, `HERMES_LANGUAGE`, then `display.language`, default `en`). A missing file is logged at debug level and falls back to English; it never raises. `surface_catalog` reads `locales/<lang>.tui.yaml` / `.desktop.yaml` for the TUI and desktop front ends, which the worker never runs.
- `hermes_cli/observability/shared_metrics_catalog.py` `display_languages()` lists the `.yaml` stems for a telemetry enum; with English only, a non-English language would be reported as unknown. Workers keep telemetry off (config render), so nothing changes.
- `hermes_cli/plugin_validate_locales.py` reads `locales/_keys.{tui,desktop}.json` to validate plugin language packs (`hermes plugins validate`, a developer command the worker never runs).

No runtime path the worker uses needs a non-English locale, provided the worker pins `display.language: en` in the managed config and keeps `HERMES_LANGUAGE` and `HERMES_BUNDLED_LOCALES` out of the worker environment allowlist. Both are asserted: `display.language: en` is a managed canary key the worker self-test reads back, and contract test 12c (`apps/agent/tests/contract`) shows the worker refusing to start with either variable set. `plugin-catalog/` is copied (Q-1.4), so its readers (`hermes_cli/plugin_catalog.py`, `plugin_catalog_presence.py`, `memory_provider_migration.py`) find their data.

**(b) Root files.** v0.22.7 and v0.23.0 have the same root entries. Every root `skip` matches a v0.23.0 file except `pnpm-*.yaml` and `install*.sh`, kept as guards. Copied root files: the Python root modules (`run_agent.py`, `model_tools.py`, `toolsets.py`, `cli.py`, `hermes_state*.py`, `hermes_constants*.py` and the rest), the `hermes` launcher, `pyproject.toml`, `setup.py`, `uv.lock`, `.python-version` (3.14), `ruff.toml`, `ruff.pre-commit.toml`, `cli-config.yaml.example`, `LICENSE`, `SOUL.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.gitignore`, `.gitattributes`, and `AGENTS.md` renamed to `AGENTS.hermes.md`. No `package*.json`, `pnpm-lock.yaml`, `yarn.lock` or `.env*` file is left anywhere in the copy (`uv.lock` twice and `pm/lock.json` are expected).

Two copied root files act on Timely's checkout: `hermes/.gitattributes` forces LF (CRLF for `*.ps1`) inside the copy, the same as upstream, and `hermes/.gitignore` hides untracked files such as `data/`, `tmp/`, `logs/`, `.venv/` and `export*` inside `apps/agent/hermes/` only. Neither affects tracked files; a file added to the copy by hand under an ignored name needs `git add -f`.

**Merge proof** (throwaway clone, persistent cache warm unless noted):

| Run | Result | Time |
| --- | --- | --- |
| first import v0.22.7, cold cache | 5,248 files, 70.4 MiB, merged | 12.1 s (113 MiB fetched) |
| first import v0.22.7, warm cache | merged | 5.8 s |
| v0.22.7 to v0.23.0 (+102 / -10 / ~263 files) | merged, 0 conflicts; ancestry verified | 14.9 s (16.0 s with the fetch) |
| same tag again | "already up to date", no commit | 1.6 s |
| filter change on the same tag (plugin-catalog dropped as a test) | merged cleanly, 1,052 files removed | 8.0 s |
| on `dev` | created `fix/hermes-sync-v0.23.0`, merged | 11.2 s |
| v0.22.7 to v0.23.0 with synthetic Timely edits | exit 2: content conflict at the patch point in `tools/terminal_tool.py`, modify/delete for the deleted `tools/vision_tools.py`; a mid-file edit in `run_agent.py` merged cleanly; report section 7 named both conflicting files in advance | 12.1 s |
| refusals | dirty tree, canary tag, downgrade to v0.22.7 (not a descendant), moved tag in `tags.json`, squashed import with no snapshot in history: each exit 1 with the reason | under 0.1 s to 2 s |
