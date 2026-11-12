# Phase 3b work packages: ship the runtime

- Date: 2026-11-13. Branch `feature/hermes-phase3b`, stacked on `feature/hermes-phase3` (PR #293, open). Phases 1 and 2 are merged into `dev`.
- Plan: `docs/plans/2026-11-08-timely-agent-from-hermes.md` ("the plan"), section 13 "Phase 3b: ship the runtime" and what it cites: 4.2 (filter: English locale only, enabled skills), 6.1-6.7 (agent homes, worker lifecycle, folder backups), 9.1 (seed tree, read-only Timely skills copy), 11.1-11.5 (make targets, env, CI, desktop packaging, Docker), 12 (security), and the phase 2/3 status in section 13.
- Desktop traps that bind every package (memory `timely-desktop-bundle-traps`): electron-builder drops the root `node_modules/` of every `extraResources` folder and ships absolute symlinks as they are; Node `cpSync` without a `filter` aborts on Windows (pass `filter: () => true`); `actions/cache` keys cannot contain commas; stage folders are named `linux-x64`, `win-x64`, `mac-arm64`; the unpacked app is tested with `env -u ELECTRON_RUN_AS_NODE` under `xvfb-run`; the AppImage needs FUSE or `--appimage-extract-and-run`.
- This document wrote no product code.
- Status (2026-11-13): all five packages are committed on `feature/hermes-phase3b`, not pushed (`b256315b` go-runtime, `01ef7345` stage-agent, `73c247a7` and `7e9202fd` desktop-pack, `dc66a3db` docker, `766066b7` ci-release-docs), then an integration round (`5afaf5eb`, `8befaeff`, `cda97987`): flag 1 is settled by leaving over-long bytecode uncompiled, Linux drops the unused libpython (442 MB unpacked), account homes stay owner-writable under a read-only install. The exit check passed on Linux (the packaged release app from a read-only install with no developer tooling, Claude Code + Sonnet; and the Docker image). Windows has not run (it needs the owner's push). Results, sizes and open items: the plan's section 13, "Phase 3b status".

## Binding owner answers used here

| Answer | Effect on phase 3b |
|---|---|
| Q-11.1 | Every desktop installer (Linux AppImage and pacman, Windows nsis) ships the agent runtime, about +105 MB compressed. No "lite" installer. |
| Q-11.2 | The Docker image moves from `alpine:3.21` to `debian:bookworm-slim` with the same staged runtime. |
| Q-1.4 | `plugin-catalog/` and optional skills are kept; non-English locales are dropped (the committed filter already copies only `locales/en.yaml`). |
| Q-1.3 | `apps/agent/hermes/**` stays byte-identical. Staging copies it and leaves skills out; it never edits a file. |
| Release | No tag, no push, no PR from these packages. Windows packaged-app runs happen in CI once the owner pushes (see "What cannot be verified locally"). |

## What exists today (mapped 2026-11-13)

- **Desktop staging** (`apps/web/electron`): `pack.mjs` runs `next build` → `build.mjs` (esbuild) → `stage-next.mjs` → `stage-api.mjs` → `stage-postgres.mjs` → electron-builder. `targets.mjs` keys are `${process.platform}-${process.arch}` (`linux-x64`, `win32-x64`, `darwin-arm64`, ...) and map to stage folders `${electronOs}-${electronArch}` (`linux-x64`, `win-x64`, `mac-arm64`). `stage-postgres.mjs` is the pattern to copy: download into `apps/web/.cache/postgres`, sha256 check (a mismatch deletes the file), system bsdtar on Windows, a `.staged-<version>` marker. `targets.mjs` imports only `node:` builtins.
- **electron-builder**: `electron-builder.yml` has `extraResources` for `.electron-next` → `next-server`, `.electron-api/${os}-${arch}` → `api`, `.electron-postgres/${os}-${arch}` → `postgres`, and `files` excludes `.electron-{api,postgres,next}/**`. `electron-builder.local.yml` extends it ("Timely Dev", ports 54339/48090/44011). Linux targets `dir`, `AppImage`, `pacman`; Windows `nsis`, `dir`; per-user nsis install (so the Windows install folder is writable by the user).
- **Supervisor**: `supervisor/paths.ts` `ResourceDirs` has `api`, `postgres`, `next` (packaged `<resources>/...`, `TIMELY_RESOURCES_DIR` override, unpackaged `.electron-*/<stageOs>-<arch>`). `supervisor/api.ts` `buildApiEnv` copies `process.env` minus `ELECTRON_*`, `DB_*`, `API_*`, so an inherited `TIMELY_AGENT_RUNTIME` would leak through today. `supervisor/index.ts:414` builds it. Tests: `scripts/electron-supervisor.test.mjs` (`make test-electron-supervisor`).
- **Folder backups of agent homes: done in phase 3.** `supervisor/backup.ts` copies `<data>/agent/accounts` into `backups/<name>.agent` while the API is stopped (state.db at rest, no Python needed), and `docs/desktop/README.md` documents the layout and restore order. Phase 3b only re-verifies it in the packaged app.
- **Go runtime lookup** (`apps/api/internal/agenthost/runtime.go`): `ResolveRuntime` accepts `apps/agent`, its `timely_agent/` folder, `boot.py` or an interpreter, always with `apps/agent/.venv`. **It does not understand the packaged layout** (`agent/{python/, app/..., boot.py}`): given `<resources>/agent` it takes the "folder holding boot.py" branch and looks for `<resources>/timely_agent/boot.py`. `ConfigFromEnv` (`supervisor.go:162`) reads `TIMELY_AGENT_RUNTIME`; `EnvConfig.Packaged` (adds `PYTHONDONTWRITEBYTECODE=1`) exists but nothing sets it. The Windows Job Object is done (`proc_windows.go`, phase 1); spawning uses only stdin/stdout/stderr.
- **Worker entry**: `apps/agent/timely_agent/boot.py` already handles the packaged layout: `agent_dir()` is the parent of `timely_agent/`, and `_fix_sys_path` adds `<agent_dir>/site-packages` when it exists. `prepare` (API start) builds `<data>/agent/seed/<hash>/skills` and the read-only `<data>/agent/timely-skills/<hash>` (0444/0555, read-only attribute on Windows) from `<agent_dir>/hermes/skills`, `<agent_dir>/skills` and `<agent_dir>/.hermes-sync/policy/{skills-reviewed,skills-denied}.json`; the learning rules read `.hermes-sync/policy/skill-body.yaml`. `apps/agent/skills/` does not exist yet (the `timely` skill does not ship).
- **Interpreter pins**: `apps/agent/hermes/pm/lock.json` `packages.python` (version `3.14.9+20261021`) has url + sha256 per key `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64` (plus musl and bionic variants). The keys match `targets.mjs`, so `stage-agent.mjs` reads the vendored lock directly. Makefile `AGENT_PYTHON_VERSION ?= 3.14.9`; extras in `apps/agent/.hermes-sync/extras.txt` (`mcp anthropic exa firecrawl parallel-web`); `playwright` is only in Hermes' `google-meet` extra, which Timely does not install.
- **Path lengths**: the longest vendored file is 143 characters relative to the agent root (`app/hermes/plugins/config_backends/remote/vendor/conformance/config-resolution/lock-freezes-inherited-value-with-no-value-at-locking-level.json`), so the 150-character rule has 7 characters to spare before `__pycache__` and site-packages are counted.
- **Docker**: `apps/api/Dockerfile` is `golang:1.25-alpine` → `alpine:3.21`, uid 10001 `timely`, `/data` owned by it, `API_BIND=0.0.0.0`. `docker-compose.yml` sets `TIMELY_DATA_DIR=/data` on the `apidata` volume. `.dockerignore` does not exclude `apps/agent/.venv` or `apps/web/.electron-*`. `release.yml` builds no Docker image (desktop on ubuntu and windows, plus the APK), so linux-arm64 is not built by any release.
- **CI**: `ci.yml` has `api`, `chat-integration`, `node`, `agent` (ubuntu, `make agent-install agent-lint agent-test agent-contract` and `agent-go-integration`), `agent-windows` (no GNU make on that runner, so steps are inline bash), `hermes-sync-check`. `release.yml` `desktop` matrix: `ubuntu-latest`/`linux-x64`, `windows-latest`/`win32-x64`; zonky cache key `zonky-postgres-${{ runner.os }}-...`.
- **Tests that take a staged runtime**: `TestIntegrationRealWorker` (`agenthost/integration_test.go`) resolves `TIMELY_AGENT_TEST_RUNTIME` through `ResolveRuntime`, so once the packaged layout resolves it runs prepare → render-account → spawn → hello → ready (self-test) → `run.start` on its own stub model → `run.done` → shutdown against a staged tree, on Linux and Windows.

## Decisions this decomposition makes

1. **`TIMELY_SHELL_TOKEN` waits for phase 5.** Section 12 uses it only for `PUT /instance/host-accounts` from the desktop window (the host-allowed account), and phase 5's deliverables list "`instance_settings` table, shell token and host-allowed account setting". Nothing in phase 3b reads it, and a token nothing checks is dead config. `buildApiEnv` gains `TIMELY_AGENT_RUNTIME` only. The phase 3b status in the plan says so.
2. **Seed tree at packaging = the shipped skill set.** `stage-agent` copies into `app/hermes/skills/` exactly the skills `prepare` would seed (reviewed in `skills-reviewed.json`, not in `skills-denied.json`, no symlinks) and into `app/hermes/optional-skills/` only the offered optional skills, then runs the staged `boot.py prepare` once against a scratch folder to prove the seed tree and the read-only Timely skills copy build from the staged tree (`unreviewed` empty, `seeded` equal to the copied set). At API start `prepare` still copies both into `<data>/agent/` (no product change). Reason: the per-user nsis install folder is writable by the same OS user, so the read-only control of plan 9.1 must stay where `prepare` applies it (the data folder), not in resources.
3. **One entry point**: the packaged root `agent/boot.py` is a small committed shim (`apps/agent/packaging/boot.py`) that removes its own folder from `sys.path` and runs `app/timely_agent/boot.py` as `__main__` (`runpy.run_path`), so Go, CI and people all start `python -I <agent>/boot.py <command>`, the plan 11.4 contract. Go's packaged runtime is `[<agent>/python/bin/python3 | <agent>\python\python.exe] -I <agent>/boot.py`.
4. **Bytecode**: `compileall -j0 --invalidation-mode unchecked-hash`, because installers do not keep source mtimes and the packaged worker runs with `PYTHONDONTWRITEBYTECODE=1` from a read-only folder; timestamp pycs would be recompiled in memory on every start.
5. **No build-machine paths ship**: `uv pip install --target` writes console scripts with absolute shebangs into `site-packages/bin` (or `Scripts/`); staging deletes those folders and then fails if any staged text file contains the absolute stage path. Same class of bug as v0.1.1's absolute symlinks.
6. **Docker stages inside the build** (a `node:22-bookworm-slim` stage with a pinned `uv` binary runs `stage-agent.mjs` for `TARGETARCH`), so `docker build -f apps/api/Dockerfile .` still works from a clean checkout and arm64 builds through buildx without an arm64 host. arm64 stays unverified because no release builds it.
7. **Stage scripts use only `node:` builtins** (like `targets.mjs`), so CI runners and the Docker stage run them without `pnpm install`.

## Waves

```
wave 1:  go-runtime                                    (no deps)
wave 2:  stage-agent        (deps: go-runtime)
wave 3:  desktop-pack       (deps: go-runtime, stage-agent)
         docker             (deps: go-runtime, stage-agent)      parallel with desktop-pack
wave 4:  ci-release-docs    (deps: all four)
```

A package starts only when every dependency is committed on `feature/hermes-phase3b`. Only `desktop-pack` starts an app or a dev server (packaged "Timely Dev" on its own ports 54339/48090/44011, plus the worktree API 8081/web 4002 only if `verify-timely` needs them; never 8080/4001). `docker` publishes nothing on a host port it does not choose explicitly (never 8080). Disk is tight (about 31 GB free on 2026-11-13): each staged runtime is about 450 MB, an unpacked app about 1 GB, the Docker build a few GB; every package deletes what it made once it has recorded its numbers (`make clean-agent-stage`, `docker image rm <its own tag>`), never `docker system prune`, never anything it did not create.

## File ownership (disjoint)

Only the named package edits these paths. A path not listed is not edited in phase 3b; a package that finds it must change one asks the coordinator first.

| Package | Owns |
|---|---|
| `go-runtime` | `apps/api/internal/agenthost/runtime.go`, new `apps/api/internal/agenthost/runtime_packaged_test.go`, `apps/api/internal/agenthost/supervisor.go` (only `ConfigFromEnv`/`applyDefaults`), `apps/api/internal/agenthost/env.go` (only the `Packaged` plumbing), `apps/api/internal/agenthost/integration_test.go` (doc comment for the staged form only), `.env.example` |
| `stage-agent` | new `apps/web/electron/stage-agent.mjs`, new `apps/web/electron/stage-agent-lib.mjs` (pure helpers), new `apps/web/electron/smoke-agent.mjs`, new `apps/agent/packaging/**` (`boot.py` shim, `README.md`), new `scripts/stage-agent.test.mjs`, `apps/web/.gitignore`, root `Makefile` |
| `desktop-pack` | `apps/web/electron-builder.yml`, `apps/web/electron-builder.local.yml`, `apps/web/electron/pack.mjs`, new `apps/web/electron/verify-pack.cjs` (electron-builder `afterPack` hook), `apps/web/electron/supervisor/{paths.ts, api.ts, index.ts}`, `apps/web/electron/main.ts` (only if the resources wiring needs it), `apps/web/package.json` (`electron:stage` script only), `scripts/electron-supervisor.test.mjs` |
| `docker` | `apps/api/Dockerfile`, `.dockerignore`, `docker-compose.yml` (only if the image's defaults are not enough), new `scripts/docker-agent-smoke.sh` |
| `ci-release-docs` | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/desktop/README.md`, root `README.md` (Docker section), `docs/plans/2026-11-08-timely-agent-from-hermes.md`, this file, `docs/adr/0011-desktop-hosts-the-backend.md` (amendment pointer only, if ADR 0026's note is not enough) |

Shared files have exactly one owner: the root `Makefile` (`stage-agent`, which adds every phase 3b target, including the two whose scripts `docker` writes); `ci.yml`, `release.yml`, the electron-builder configs and every doc (as above). `apps/agent/hermes/**` is owned by nobody: byte-identical.

## Shared contracts every package follows

- **Staged layout** (`apps/web/.electron-agent/<stageDir>/`, shipped as `<resources>/agent/`, copied to `/app/agent` in Docker):

```
agent/
  boot.py                    the shim (apps/agent/packaging/boot.py)
  python/                    python-build-standalone 3.14.9 install_only, trimmed
                             (bin/python3 on Linux/macOS, python.exe on Windows)
  app/
    hermes/                  apps/agent/hermes, skills/ = seed set only, optional-skills/ = offered only,
                             locales/en.yaml only, no __pycache__ from the checkout
    timely_agent/            apps/agent/timely_agent
    skills/                  apps/agent/skills (empty folder until the timely skill ships), files 0444, folders 0555
    site-packages/           uv pip install --target, no bin/ or Scripts/
    .hermes-sync/policy/     skills-reviewed.json, skills-denied.json, skill-body.yaml, tools.yaml
  NOTICE                     apps/agent/NOTICE
  THIRD_PARTY_LICENSES       CPython, Hermes (MIT) and every installed distribution
  MANIFEST.json              {target, python, hermesTag, files: [[relpath, size], ...], totals}
  .staged-<hash>             marker: sha256 of the lock's python entry, hermes/uv.lock, extras.txt, target
```

- **Runtime env**: `TIMELY_AGENT_RUNTIME=<agent root>` (desktop: `<resources>/agent`; Docker: `/app/agent`). Go resolves it to `python -I <agent>/boot.py` with `Packaged=true`, which adds `PYTHONDONTWRITEBYTECODE=1` to every worker and helper. Dev (`apps/agent` + `.venv`) is unchanged.
- **Scripts** (Node, `node:` builtins only, runnable without `make` on Windows):
  - `node apps/web/electron/stage-agent.mjs` stages `TIMELY_TARGETS` (default: host). Exports `stageAgent(targets)` for `pack.mjs`. Download cache `apps/web/.cache/agent/`.
  - `node apps/web/electron/smoke-agent.mjs [--root <agent dir>] [--read-only]`: default root `apps/web/.electron-agent/<host stageDir>`. Needs Go on `PATH` (runs the Go real-worker test from `apps/api`).
- **Make targets** (added by `stage-agent`): `stage-agent`, `smoke-agent` (`AGENT_ROOT=`, `READ_ONLY=1`), `test-stage-agent` (added to `test`), `clean-agent-stage`, `stage-desktop` (gains `stage-agent`), `docker-api` (`docker build -f apps/api/Dockerfile -t timely-api:local .`), `docker-agent-smoke` (`bash scripts/docker-agent-smoke.sh`, written by `docker`). `build-desktop`/`dist-desktop` keep calling `pack.mjs`, which stages the agent once `desktop-pack` lands.
- **CI cache key** for the interpreter download: `agent-python-${{ runner.os }}-${{ hashFiles('apps/agent/hermes/pm/lock.json') }}` on `apps/web/.cache/agent` (no commas). uv's own cache through `astral-sh/setup-uv` at the pinned SHA ci.yml already uses, `cache-dependency-glob: apps/agent/hermes/uv.lock`.
- **Environment for every command**: `export GOTMPDIR=$HOME/.cache/gotmp TMPDIR=$HOME/.cache/gotmp UV_CACHE_DIR=$HOME/.cache/uv` first. Never touch `~/.hermes`. Never read or print `.env` values; the OpenRouter key is never used. Models: the Go test's stub, `apps/agent/tests/stub_openai.py`, or `apps/api/scripts/agentqa/ollama_shim.py`; the only live model allowed is Claude Code CLI with Sonnet through the loopback gateway, for an optional end-to-end check.

## Packages

### 1. `go-runtime`: the API finds a packaged runtime

- **Deps**: none.
- **Build**:
  - `ResolveRuntime` recognises the packaged layout: a folder holding `boot.py`, `python/` and `app/timely_agent/boot.py` (or `boot.py` in such a folder) resolves to `Runtime{Program: <agent>/python/bin/python3 (python\python.exe on Windows), Args: [-I, <agent>/boot.py], Packaged: true}`. Missing interpreter or missing `app/timely_agent/boot.py` is `ErrNoRuntime` naming the missing path (the classic engine keeps working). Every existing form resolves exactly as before.
  - `Runtime.Packaged` flows into `Config.Env.Packaged` in `New`/`applyDefaults`, not only in `ConfigFromEnv`, so `TestIntegrationRealWorker` against a staged tree runs with `PYTHONDONTWRITEBYTECODE=1` like production.
  - `.env.example`: the `TIMELY_AGENT_RUNTIME` comment adds the packaged folder form (`<resources>/agent`, `/app/agent`).
  - `TestIntegrationRealWorker`'s doc comment gives the staged form (`TIMELY_AGENT_TEST_RUNTIME=$PWD/../web/.electron-agent/linux-x64`).
- **Verify**: `go test ./internal/agenthost -run 'Runtime|Env' -count=1` with a fake packaged tree for both path styles (table with `GOOS`-specific interpreter names), including "dev layout still wins when `TIMELY_AGENT_RUNTIME` is empty"; `make agent-go-vet-windows`; `make test-api`; `make agent-install agent-go-integration` (dev runtime unchanged).

### 2. `stage-agent`: stage, check and smoke-test the runtime

- **Deps**: `go-runtime` (the smoke runs the Go real-worker test against the staged tree).
- **Build `stage-agent.mjs`** (per target, in this order; every failure names the fix):
  1. Refuse a target whose OS or arch differs from the host (`hostTargetKey()`), because 25 native `.so`/`.pyd` files are installed for the running interpreter: "stage win32-x64 on a Windows runner".
  2. Read `packages.python.artifacts[<target key>]` from `apps/agent/hermes/pm/lock.json`; fail if the lock's version does not start with the Makefile's `AGENT_PYTHON_VERSION` (parsed the way ci.yml's `agent-windows` does). Download to `apps/web/.cache/agent/`, verify sha256 (delete on mismatch), extract with the system tar (bsdtar from `System32` on Windows, as `stage-postgres.mjs` does).
  3. Trim the interpreter: `include/`, `share/`, `idlelib`, `tkinter`, `turtledemo`, `ensurepip`, tcl/tk (`lib/tcl*`, `lib/tk*`, `lib/itcl*`, `_tkinter*`, `tcl/`, `tcl86t.dll`, `tk86t.dll`), the interpreter's own `pip`; measure `lib/python3.14/test` and drop it only if no import in the staged tree needs it. Keep the CPython licence file.
  4. `uv export --frozen --no-dev --no-emit-project --format requirements-txt` with `--extra` per line of `extras.txt` (same parsing as `agent-install`: strip comments and blank lines), run in `apps/agent/hermes`; then `uv pip install --python <staged interpreter> --target app/site-packages --no-deps --require-hashes -r <file>` (try `--no-build`; if a dependency has no wheel for a target, list it for the coordinator instead of compiling). Delete `site-packages/bin` and `site-packages/Scripts`.
  5. Copy the source with `cpSync(..., { filter })` (never filterless): `app/hermes` from `apps/agent/hermes` with `skills/` limited to the seed set and `optional-skills/` to the offered set (plan 9.1/9.3: entries in `skills-reviewed.json`, minus `skills-denied.json`, minus any skill holding a symlink); assert `locales/` holds only `en.yaml`; keep `plugin-catalog/`, `HERMES_UPSTREAM.json`, `pm/lock.json`; skip `__pycache__`. `app/timely_agent`, `app/skills` (0444/0555, created empty when `apps/agent/skills` is missing), `app/.hermes-sync/policy/*`, `boot.py` shim, `NOTICE`.
  6. Seed check: run `<python> -I boot.py prepare --agent-dir <scratch>` (scratch under `$HOME/.cache`, deleted after) and assert `unreviewed` is empty and `seeded` equals the copied skill folders.
  7. `<python> -I -m compileall -q -j0 --invalidation-mode unchecked-hash` over `app/` and the interpreter's stdlib.
  8. Checks over the whole tree: no symlink with an absolute target and none resolving outside the root (relative interpreter links are allowed); no path longer than 150 characters relative to the agent root, counted after compileall; no staged text file containing the absolute stage path; no `playwright`, `chromium` or browser download in `site-packages` (ADR 0022: never bundle Chromium); the interpreter starts and reports the expected `sys.platform`/machine.
  9. Write `THIRD_PARTY_LICENSES` (CPython, Hermes `LICENSE` and `apps/agent/NOTICE`, then every `*.dist-info`: name, version, `License-Expression`/`License`, and the text of its licence files); fail listing any distribution with neither a licence file nor licence metadata. Write `MANIFEST.json` and print file count, unpacked MB and the top 10 folders by size (plan estimate: about 15k files, +420-460 MB unpacked).
  10. Marker: with a matching `.staged-<hash>` skip steps 2-4; steps 5-10 always run (the source changes often and copying it is fast).
- **Build `smoke-agent.mjs`**: (1) `python -I <root>/boot.py` with no command exits 2 with the usage line (imports clean); (2) `prepare --agent-dir <scratch>` exits 0 (Hermes imports for the managed canary; measure the time); (3) with `--read-only`: record a manifest (path, size, mtime), make the root read-only (POSIX `chmod -R a-w`; Windows `icacls <root> /deny *S-1-1-0:(OI)(CI)(W,D,DC)`), run `go test ./internal/agenthost -run 'TestIntegrationRealWorker$' -count=1 -v` from `apps/api` with `TIMELY_AGENT_TEST_RUNTIME=<root>`, re-take the manifest and fail on any created or changed file (no `__pycache__`, no `.pyc`, no cache file inside the runtime), restore permissions in a `finally`. Without `--read-only` step 3 runs the Go test only. A Hermes write into its own folder that this finds is a coordinator question (vendored files cannot change).
- **Build `scripts/stage-agent.test.mjs`** (node test, `make test-stage-agent`): lock lookup per target key and the version check, extras parsing, host/target mismatch, skill selection (reviewed, denied, symlinked, offered optional), the tree checks on a temp fixture (absolute symlink, escaping relative symlink, 151-character path, embedded stage path), licence collection with and without metadata.
- **Makefile**: the targets in "Shared contracts"; `stage-desktop`'s help says it stages the agent too; `test-stage-agent` joins `test`; `apps/web/.gitignore` gains `.electron-agent/`.
- **Verify**: `make test-stage-agent`; `make stage-agent` on linux-x64 passes every check (record files, MB, longest path, seconds); `TIMELY_TARGETS=win32-x64 make stage-agent` on Linux fails with the mismatch message; `make smoke-agent READ_ONLY=1` passes (worker reaches ready with `self_test.ok` and the stub run finishes; no file changed); a second `make stage-agent` skips the download and install; `make agent-lint` still passes; `git status` shows no staged runtime. Leave `.electron-agent/linux-x64` for wave 3 only if both wave-3 packages start right away; otherwise `make clean-agent-stage`.

### 3. `desktop-pack`: the packaged desktop app ships and uses the runtime

- **Deps**: `go-runtime`, `stage-agent`.
- **Build**:
  - `electron-builder.yml`: `extraResources` `from: .electron-agent/${os}-${arch}` `to: agent`; `files` gains `"!.electron-agent/**"`; `afterPack: electron/verify-pack.cjs`. `electron-builder.local.yml` changes only if the extended config does not carry these (check the merged config with `--dir`).
  - `verify-pack.cjs`: for each `appOutDir`, compare `resources/agent` with the staged `MANIFEST.json` (every file present with the same size, nothing extra) and fail on any symlink with an absolute target. This catches electron-builder's silent drops (root `node_modules` today, any other default filter) before an installer is written.
  - `pack.mjs`: `stageAgent(targets)` after `stagePostgres`; header comment lists the step. `apps/web/package.json` `electron:stage` adds `stage-agent.mjs`.
  - `supervisor/paths.ts`: `ResourceDirs.agent` = `<resources>/agent` (packaged), `<TIMELY_RESOURCES_DIR>/agent` (override), `apps/web/.electron-agent/<stageOs>-<arch>` (unpackaged).
  - `supervisor/api.ts`: `ApiEnvInput.agentRuntime?: string`; `buildApiEnv` sets `TIMELY_AGENT_RUNTIME` to it when given and otherwise deletes an inherited value (a packaged app never borrows a developer's runtime). `supervisor/index.ts` passes `resources.agent` when `<agent>/boot.py` exists and logs it in the `boot: resources` line. No `TIMELY_SHELL_TOKEN` (decision 1). No new sidecar: the API spawns workers.
  - `scripts/electron-supervisor.test.mjs`: the three `ResourceDirs.agent` forms; `buildApiEnv` with and without `agentRuntime`, and an inherited `TIMELY_AGENT_RUNTIME` removed.
- **Verify**:
  - `make test-electron-supervisor`, `make typecheck-web`, `make lint-web`.
  - `make build-desktop` on Linux: `release/linux-unpacked/resources/agent` exists and `verify-pack` passed. `make dist-desktop`: record AppImage and pacman sizes against a build of the parent commit or the v0.1.x numbers in the docs (target: about +105 MB compressed); delete the installers after.
  - Read-only install folder, packaged: copy `release/linux-unpacked` under `$HOME/.cache/timely-phase3b/`, `chmod -R a-w` it, then `make smoke-agent AGENT_ROOT=<copy>/resources/agent READ_ONLY=1`.
  - Packaged app end to end (the plan's phase 3b verification): launch the read-only copy under `xvfb-run -a` with `env -u ELECTRON_RUN_AS_NODE`, `--user-data-dir` under `$HOME/.cache/timely-phase3b/userdata`, `--no-sandbox --ozone-platform=x11 --remote-debugging-port=<free port>`; it uses the Timely Dev ports 54339/48090/44011. Confirm the API log shows the runtime resolved from `resources/agent` and no agent folder under `apps/`. Then run the phase 2/3 `verify-timely` scenario against the packaged API on 48090 (sign up, agent engine on for the account, the stub model through `apps/api/scripts/agentqa/ollama_shim.py`): a chat turn reaches ready and `run.done`; scenario (a), a learned skill with its chip and Undo; scenario (b), a fixture page read stages the About you change (Keep / Discard); a "Back up now" folder backup holds `<name>.agent` with the account home's kept parts. Screenshots through CDP in the desktop window. Optional: one turn through Claude Code CLI with Sonnet via the loopback gateway.
  - Stop the app (kill only its own process tree, found by the user-data path, never a pattern in your own command line), then delete `release/`, the copy and the user data.

### 4. `docker`: Debian-slim image with the runtime

- **Deps**: `go-runtime`, `stage-agent`.
- **Build `apps/api/Dockerfile`**:
  - `builder` (Go, unchanged: `CGO_ENABLED=0`, static binary).
  - `agent`: `node:22-bookworm-slim` pinned by digest, `uv` copied from `ghcr.io/astral-sh/uv:<version>` pinned by digest; copies `Makefile` (for `AGENT_PYTHON_VERSION`), `apps/agent/` (without `.venv`) and `apps/web/electron/{stage-agent.mjs, stage-agent-lib.mjs, targets.mjs}`; maps `TARGETARCH` (`amd64` → `linux-x64`, `arm64` → `linux-arm64`) and runs `stage-agent.mjs` with a BuildKit cache mount for uv and the download cache.
  - runtime: `debian:bookworm-slim` pinned by digest; `ca-certificates` (and `tzdata` only if the worker's zoneinfo needs it), user `timely` uid 10001, `/data` owned by it; `COPY --from=agent` the staged tree to `/app/agent` owned by root (read-only to `timely`); `ENV TIMELY_AGENT_RUNTIME=/app/agent TIMELY_DATA_DIR=/data API_BIND=0.0.0.0`; agent state lands in `/data/agent` on the `apidata` volume. Terminal and file tools act inside the container (ADR 0026 states it).
  - `.dockerignore` adds `apps/agent/.venv`, `apps/web/.electron-*`, `apps/web/.cache`, `apps/web/release`, `apps/web/dist-electron`.
  - `docker-compose.yml`: unchanged unless the image defaults are not enough.
- **Build `scripts/docker-agent-smoke.sh`** (`make docker-agent-smoke`): build `timely-api:phase3b-smoke` for linux/amd64; (1) as uid 10001 with `--read-only --tmpfs /tmp` and a throwaway volume on `/data`: `/app/agent/python/bin/python3 -I /app/agent/boot.py prepare --agent-dir /data/agent` exits 0; (2) build the Go test binary on the host (`CGO_ENABLED=0 go test -c ./internal/agenthost`), mount it read-only and run `-test.run 'TestIntegrationRealWorker$'` inside the image as uid 10001 with `TIMELY_AGENT_TEST_RUNTIME=/app/agent`, `HOME=/tmp`, `--read-only`: the worker reaches ready and the stub run finishes inside the real image; (3) a throwaway `postgres:17` container and the API container on a private Docker network, the API published only on a free loopback port that is not 8080: `/health` answers and the API log shows the runtime resolved (no `ErrNoRuntime`). A `trap` removes every container, network, volume and image the script created, and only those.
- **Verify**: `make docker-agent-smoke` passes; record the image size (alpine today vs bookworm-slim with the runtime); `docker compose config` still parses. arm64: not built or verified (no release builds it); say so in the docs.

### 5. `ci-release-docs`: CI on both OSes, release caching, docs and the plan status

- **Deps**: `go-runtime`, `stage-agent`, `desktop-pack`, `docker`.
- **Build `ci.yml`**:
  - New job `agent-stage`, matrix `ubuntu-latest` and `windows-latest`, `shell: bash`: checkout, setup-node 22 (no `pnpm install`), setup-go, setup-uv (pinned SHA, cache glob `apps/agent/hermes/uv.lock`), `actions/cache` with the comma-free key above, `node apps/web/electron/stage-agent.mjs`, `node apps/web/electron/smoke-agent.mjs --read-only` (runs `python -I boot.py`, prepare, and the Go worker reaching ready against the stub model from a read-only folder), and the size summary into `$GITHUB_STEP_SUMMARY`. Runs on every PR and on pushes to `dev`, so Windows staging is verified without a tag.
  - `node` job: `make test-stage-agent`.
  - New job `docker` (ubuntu, PRs that touch `apps/api/Dockerfile`, `.dockerignore`, `apps/agent/**`, `apps/web/electron/stage-agent*.mjs`, and pushes to `dev`): `make docker-agent-smoke`.
  - `hermes-sync-check`'s path list stays as it is (it already covers `Makefile` and `ci.yml`).
- **Build `release.yml`** `desktop` job: setup-uv at the pinned SHA; the interpreter download cache with key `agent-python-${{ runner.os }}-${{ hashFiles('apps/agent/hermes/pm/lock.json') }}`; before "Build and package", `node electron/stage-agent.mjs --target <matrix.target>` and `node electron/smoke-agent.mjs --read-only` (setup-go is already there), so a bad runtime fails before electron-builder publishes; `pack.mjs` then reuses the stage through the marker and `verify-pack` checks the result. No Docker publishing (none exists today).
- **Docs**: `docs/desktop/README.md` layout (`resources/agent/...`), the env table (`TIMELY_AGENT_RUNTIME`; `TIMELY_SHELL_TOKEN` comes with phase 5), the build table row (`electron/stage-agent.mjs` → `.electron-agent/<os>-<arch>`), "Agent staging details" (lock pins, cache folder, marker, trims, checks, licences, measured sizes, never Chromium: Chrome or Edge as installed, ADR 0022), GitHub Actions (setup-uv, cache key, the pre-pack smoke), and the local read-only test recipe. Root `README.md` Docker section: Debian-slim, runtime inside, agent state in the `apidata` volume, terminal tools act inside the container, arm64 unverified. Plan section 13: a "Phase 3b status" block (what was built, suites with exit codes, sizes, what is open), and the 11.4 note that `TIMELY_SHELL_TOKEN` moves to phase 5. This file's status line.
- **Verify**: `actionlint` if installed, otherwise a YAML parse of both workflows; `grep` proves no cache key contains a comma; every `uses:` is pinned to a SHA; `make test` (or `make -k test` with failures explained); `git diff --stat` touches only owned paths. GitHub Actions cannot run from here (no push): the owner pushes, then reads the `agent-stage` (ubuntu and windows) and `docker` jobs, and may run `release` with `workflow_dispatch` (it publishes nothing) to get Windows installers.

## Deliverable and verification coverage

| Item (plan 13 phase 3b, 11.4, 11.5, task list) | Package |
|---|---|
| `stage-agent.mjs`: download, sha256 from `pm/lock.json`, trim, `uv pip install --target` from `uv export --frozen` with extras, seed tree and read-only Timely skills copy, source with enabled skills and English only, compileall, symlink/150-char/OS checks, `THIRD_PARTY_LICENSES` | `stage-agent` |
| Root `boot.py` shim, `MANIFEST.json`, `.electron-agent/` ignore | `stage-agent` |
| Make targets `stage-agent`, `smoke-agent`, `test-stage-agent`, `clean-agent-stage`, `docker-api`, `docker-agent-smoke`; `stage-desktop` wiring | `stage-agent` |
| `build-desktop`/`dist-desktop` stage the agent (through `pack.mjs`) | `desktop-pack` |
| electron-builder changes, `afterPack` manifest check, `ResourceDirs.agent`, `buildApiEnv` passes `TIMELY_AGENT_RUNTIME` | `desktop-pack` |
| `TIMELY_SHELL_TOKEN` | not in 3b: phase 5 (decision 1); recorded by `ci-release-docs` |
| Go: `TIMELY_AGENT_RUNTIME` understands the packaged layout, `Packaged` → `PYTHONDONTWRITEBYTECODE` | `go-runtime` |
| Windows Job Object, stdio-only spawn | done in phase 1; exercised by `agent-stage` on windows-latest (`ci-release-docs`) |
| Folder backups include `agent/accounts` | done in phase 3; re-verified in the packaged app by `desktop-pack` |
| Docker: bookworm-slim, staged runtime (x64; arm64 via `TARGETARCH`, unverified), `TIMELY_AGENT_RUNTIME=/app/agent`, state in `/data` | `docker` |
| Release workflow stages per OS with a comma-free cache key, smoke before packaging | `ci-release-docs` |
| PR CI job staging on ubuntu-latest and windows-latest with `python -I boot.py` and a worker reaching ready on the stub model | `ci-release-docs` (scripts from `stage-agent`) |
| Read-only install folder test | `stage-agent` (`smoke-agent --read-only`, also run by CI), `desktop-pack` (on the packaged copy), `docker` (`--read-only` container) |
| Local `build-desktop`-style build on Linux; install, start, `verify-timely` scenario against the packaged API | `desktop-pack` |
| Same on Windows | CI `agent-stage` (staging + worker smoke); the packaged Windows app only after the owner pushes (`release` `workflow_dispatch`) |
| `docs/desktop/README.md`, root README Docker section, plan status | `ci-release-docs` |

## What cannot be verified locally

- Windows staging, the Windows worker smoke and the Windows installer: this machine is Linux and nothing is pushed. `agent-stage` (windows-latest) and a `release` `workflow_dispatch` run cover them once the owner pushes; until then the plan status says "Windows: not run".
- linux-arm64 Docker image: no release builds it; the Dockerfile supports it through `TARGETARCH`.
- macOS: no release target; `stage-agent` accepts `darwin-*` keys on a Mac host but nobody runs it in 3b.

## Flags for the coordinator

1. **Hit, then settled in the integration round (2026-11-13, `5afaf5eb`):** the limit stays 150 and a `.pyc` over it is deleted after compileall, so its module imports from source (the plan's section 13 open item 1 says how to switch to raising the limit instead). Original note: staging fails at 151 characters on `app/site-packages/anthropic/types/beta/__pycache__/beta_managed_agents_self_hosted_resources_unsupported_deployment_paused_reason_error.cpython-314.pyc`; the Hermes data files were not the problem. The 150-character limit has 7 characters to spare at v0.23.0 before `__pycache__/*.cpython-314.pyc` names and `site-packages` paths are counted. If staging fails it, the choice (exclude Hermes' `plugins/config_backends/remote/vendor/conformance/` data, or raise the limit given Windows' 260-character `MAX_PATH` with a `%LOCALAPPDATA%\Programs\Timely\resources\agent\` prefix of about 60 characters) goes to the owner; `stage-agent` must not change it silently.
2. If the read-only smoke shows Hermes writing inside its own package folder, the fix belongs in `timely_agent` (an env or config floor), which no 3b package owns: ask first.
3. A dependency with no wheel for a target makes `--no-build` fail; building from source on a release runner is a decision, not a default.
