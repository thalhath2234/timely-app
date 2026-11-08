# Hermes tools and skills in Timely: implementation plan

> **Superseded** by [`2026-11-08-timely-agent-from-hermes.md`](2026-11-08-timely-agent-from-hermes.md). The owner chose a Timely-owned Python copy of Hermes that runs Timely's agent and bots, not a pinned package called from the Go runner. Section 1.3 of the new plan lists what this plan still contributes (the Claude CLI `--system-prompt-file` fix in 4.10, one worker per account, verified Hermes facts).

- Date: 2026-11-08
- Status: Plan, checked against the code by six investigators (overlap-web, overlap-agent, hermes-embed, hermes-skills-packaging, timely-runner, timely-platform-sync), then revised after two reviews (feasibility, security-completeness). Section 15 lists every review finding and what changed.
- Hermes checked at: v0.23.0 (commit `2bd378ed`) and main `334f66b8` (2026-11-07)
- **Pin vs. checked commit.** The plan pins v0.23.0 (`2bd378ed`), but the 73-tool registry dump, most `hermes:` line citations and the investigators' first lock and import runs used the local main checkout `334f66b8`, which is 444 commits past a canary tag (`git describe` = `v0.23.0+canary.20261107T064357Z-444-g334f66b835`). Entry points spot-checked at v0.23.0 exist (`get_tool_definitions(…, skip_tool_search_assembly)` at `model_tools.py:227`, `handle_function_call` at :886, the `HERMES_NIX_BUILD` guard, `HERMES_DISABLE_FILE_STATE_GUARD`). Tool lists, schemas and private helpers are **not** shown to match the pin. Phase 1 starts by re-running the registry dump, the contract probes (8.6 #8-14 and #16-22) and the lock against the pin (section 12).

## How to read this

**Citations.** `chat/runner.go:595` means `apps/api/internal/features/chat/runner.go`, line 595. The same short form is used for `agent/`, `provider/`, `bots/`, `docfile/` and `linkpreview/` under `apps/api/internal/features/`. `cmd/` means `apps/api/cmd/`. Other Timely paths are given from the repo root. A path that starts with `hermes:` is in `/home/thalhath/Dev/hermes-agent`.

**Evidence labels.** *(ran)* means an investigator ran it in a scratch environment. *(read)* means it was read in the code. *(inferred)* means it is a judgement, not a checked fact. Claims without a label come from reading.

**Terms used throughout.**

- **Tool host**: the new Python process (`apps/tools`) that runs Hermes tools for Timely. The owner-facing word is "tool host"; avoid "sidecar" or "plugin" in UI copy.
- **Worker**: a child process of the tool host that serves one Timely account.
- **Host tool**: a Hermes tool that Timely exposes to its Agent through the tool host.
- **Agent run, Agent proposal, Agent provider, Desktop host**: existing Timely terms from `CONTEXT.md:68-92, 156-172`. An Agent proposal is the editable plan card the person approves (ADR 0007).
- **Catalog**: `agent.Catalog`, the map of Go tools the chat runner can use (`agent/catalog.go:16-30`).
- **Runner tool**: a tool the runner adds itself, outside the catalog: `web_search`, `propose_changes`, `resolve_target` (`chat/runner.go:356-376`, `chat/target_jev.go:25`).
- **Skill**: a Markdown instruction file (`SKILL.md`, agentskills.io-style) the Agent can read on demand.
- **HERMES_HOME**: the directory Hermes keeps all its state in. Without it, Hermes writes to the owner's live `~/.hermes`.
- **task_id / session key**: the two ids Hermes uses to keep terminal shells, processes, kernels and file-read tracking apart.

---

## 1. Summary

Timely gets a new local Python process, the **tool host**, that installs Hermes Agent as a pinned package and runs a small, reviewed subset of its tools on the API host for the accounts the host allows: skills, and, behind an Agent proposal the person approves, workspace-confined file reads, terminal, file writes, later code execution and, if ADR 0025 keeps them, the browser. The Go runner keeps the tool loop (ADR 0009). It sees host tools as ordinary catalog entries whose specs are generated at sync time and compiled into the API, and whose calls go over loopback HTTP with a shared secret. Where Timely already has a Go tool for the same job (web search, page reading, image reading, scheduled watching), the Hermes tool stays hidden and the Go tool is improved using what Hermes does better. A `make hermes-sync` command re-pins Hermes, re-copies its skills, regenerates a manifest and the Go specs, lands new upstream tools as `pending` (hidden), and writes a report for the owner to review.

### The owner's three decisions (binding)

1. **Hermes code stays a pinned package, not vendored source.** The plan installs `hermes-agent` from a git commit through uv. Skills are the one thing copied as files, because the package does not contain them (section 3.1, 5.1).
2. **Terminal, file and browser tools run on the API host with user approval.** Every host tool step, file reads included, is an Agent proposal step with `Reviewed` authority by default. Unapproved, workspace-confined reads are an option only if the owner picks it in phase 0 (open question 3). Hermes' own approval layer is kept only as a second floor (section 3.6). Host tools are available only to the accounts the host allows (section 4.2, "Host-level gate"), never by an account's own switch alone.
3. **Where Timely already has a Go tool doing the same job, compare both and improve the Go one.** Hermes `web_search`, `web_extract`, `x_search`, `vision_analyze`, `video_analyze` and `cronjob_manage` are not exposed. Section 7 lists the concrete Go improvements taken from them.

### What changed from the draft plan (short version)

| Draft | Now | Why |
|---|---|---|
| Plain git pin in pyproject | Pinned Hermes package (git commit, or a GitHub archive URL of the same commit if the git clone is too heavy) plus `HERMES_NIX_BUILD=1` build variable, copied uv overrides, CPython-only `environments`, and constraints generated from upstream `uv.lock` | Plain pin fails to lock and to build *(ran)*; constraints without a CPython-only environment fail on a PyPy/win32 split *(ran)*; see 3.1 |
| ~44 tools | 73 registered tools at main `334f66b8`, plus 3 meta-tools; to be re-dumped at the pin | Registry dump *(ran, at main)*; section 6 lists all |
| `web_search`, `web_extract`, `vision_analyze`, `video_analyze` read-only immediate | All hidden; Go owns them | Duplicate tool names, privacy gates, third-party vendors by default, decision 3 |
| `read_file`/`search_files` read-only immediate | Approval-gated by default (decision 2) and confined to a per-account workspace; unapproved confined reads only if the owner chooses that in phase 0 | They read any host path and send it to a model provider |
| Host tools per account | A host-level gate (allowed accounts, set in desktop Settings → Server or `TIMELY_TOOLS_ACCOUNTS`) enforced in the API and the tool host | ADR 0001 has no owner role; a per-account switch would let any account run commands as the owner's OS user |
| pytools client adds tools to the per-run catalog | Specs generated at sync, compiled into `agent.NewCatalog` | Chat policy reads a static catalog (`agent/authority.go:171-183`) |
| Call proxies over HTTP | Host steps run in `Prepare`, outside the apply transaction, after a fenced `started` checkpoint that also re-checks reads; idempotency key per attempt; a dedicated host lane | Apply transaction retries up to 5 times (`chat/runner.go:1136-1150`); the in-transaction `readsChanged` would see the step's own write (`chat/runner.go:964-985`); only 3 chat lanes (`chat/runner.go:84-91`) |
| Chat run id as Hermes `task_id` | Conversation id as `task_id`, plus a bound Hermes session key | Timely has no run id; `task_id` alone does not isolate shells *(ran)* |
| One HERMES_HOME per account in one process | One worker process per account | Process-global state in Hermes; see 3.3 |
| Authority values read/immediate/approval/skip/pending | read/approval/pending/skip | No Hermes write is a "clear single edit" of Timely data |
| Skills: `timely/` overrides `hermes/` via two external dirs | Override applied at sync time; the two trees never share a name | Two external dirs with one name are refused as ambiguous *(ran)* |
| Committed `SYNC_REPORT.md`, `make tools-test` | Git-ignored report, `make test-tool-host` | Report repeats the PR body; `make tools` already exists |
| Bundled Chromium on desktop | The person's installed Chrome/Edge | ADR 0022 on `feature/bots-adr`; owner to confirm |
| Phase 6 "map cronjob to bots" | A separate Go track (Track B) that can start now | Hermes' agent-loop tools cannot run through the tool host at all |

---

## 2. Architecture

```
  Phone / web / Electron window
          │  HTTPS (Tailscale on desktop, ADR 0011)
          ▼
┌──────────────────────── Timely Go API (:8080 / desktop 48080) ────────────────────────┐
│ chat runner: tool loop, proposals, apply (chat/runner.go)                              │
│   ├─ Go catalog tools (agent.NewCatalog, ~183 tools)                                   │
│   │    └─ host tools  (agent/tools_host.go, specs from pytools/tools.gen.json)         │
│   ├─ runner tools: web_search, propose_changes, resolve_target                         │
│   └─ pytools.Client ─────────────────────────────────────────────┐                     │
└──────────────────────────────────────────────────────────────────┼─────────────────────┘
                                   HTTP 127.0.0.1:8090 (desktop 48082), Bearer token
                                                                   ▼
┌──────────────────── Tool host front: python -I -m timely_tools ───────────────────────┐
│ token + Host + Origin checks · routing by uid · worker spawn/reap · /health            │
└───────────┬───────────────────────────────────────────────┬───────────────────────────┘
            │ JSON lines over a private pipe (not fd 1)      │
            ▼                                                ▼
   worker (account A)                               worker (account B)   ← spawned on first use,
   HERMES_HOME=<root>/profiles/A                    HERMES_HOME=…/B         reaped when idle
   import model_tools                                                    
   handle_function_call(name, args, task_id=<conversation id>)          
     ├─ bash -lic shells, background reaper threads                     
     ├─ execute_code kernels (AF_UNIX socket in TMPDIR)                 
     ├─ browser (installed Chrome via CDP)                              
     └─ calls.sqlite (idempotency store)                                
```

### Components

| Component | Where | Job |
|---|---|---|
| `apps/tools` | new | Python 3.14 uv project. Pins Hermes, holds copied skills, `tools.yaml`, `skills.yaml`, `manifest.json`, the `timely_tools` package (front, worker, manifest generator) |
| `scripts/sync-hermes.sh` | new | Re-pins Hermes and regenerates everything derived from it (section 8) |
| `pytools` Go package | new, `apps/api/internal/features/pytools` | Embedded tool specs, HTTP client, result handling, context helpers |
| `agent/tools_host.go` | new | Turns each embedded spec into an `agent.Tool` inside `agent.NewCatalog` |
| chat runner changes | `chat/runner.go`, `chat/proposal.go`, `chat/model.go`, `chat/policy.go`, `chat/bot_tags.go` | Step ids, a `started` step status, prepare-then-apply for host writes, outside-data rules, prompt text, continuation after host steps |
| Review cards | `packages/contract/src/changeReview.ts`, web and mobile `ChangeCards` | A `host` card kind: command, diff, code, result |
| Electron supervisor | `apps/web/electron/supervisor/*` | A 4th, non-fatal sidecar for the tool host (phase 5) |

### Data flow: one read call (`skill_view`)

1. The runner builds read specs from the catalog. `skill_view` is there because `agent.NewCatalog` registered it from `pytools/tools.gen.json`, with `Read` authority, and the account passes the host-level gate (4.2). Chat policy finds it through `agent.AuthorityOf` like any Go tool (`chat/policy.go:17-25`).
2. The model calls `skill_view {"name":"arxiv"}`. The runner treats it as a read tool (`chat/runner.go:576`) and calls `Tool.Call(ctx, uid, raw)`.
3. `Call` validates the arguments against the schema (the `check` built in `agent/tools_host.go`), reads the conversation id from `ctx` (`pytools.ConversationFrom`), and POSTs `/tools/skill_view/call` with `{uid, conversation_id, args, deadline_ms}`.
4. The front routes to account A's worker, spawning it if needed (about 1 s warm, 4-10 s cold; section 3.3). The worker binds the Hermes session key, calls `model_tools.handle_function_call("skill_view", args, task_id=conversation_id, session_id=conversation_id)` in a thread pool, and returns the JSON string.
5. `pytools` decodes the JSON string into `json.RawMessage`, truncates over about 60 KB with a note (the runner turns results over 90,000 bytes into an error, `chat/runner.go:595`), and returns it. If the tool is an outside-data tool (section 4.7) it wraps it with the outside-data marker.

### Data flow: one approval-gated call (`terminal`)

1. The model sees `terminal`'s schema as text under "Write tool schemas" in the system prompt; write tools are never provider tools (`chat/runner.go:326-356, 380-390`). It calls `propose_changes` with a step `{tool:"terminal", arguments:{command:"pytest -q", workdir:"…"}}`.
2. `prepareProposal` checks the step is a write tool, validates its arguments (`chat/proposal.go:148-247`), gives the step a new `ID`, and rehearses the plan (`chat/proposal.go:343-376`). In rehearsal the host tool is a stand-in: it POSTs `/tools/terminal/check`, which runs schema checks, the workspace rule and Hermes' danger detection, and returns `{"rehearsed":true, "danger":[…]}`. Nothing runs.
3. Because the authority is `Reviewed`, `needsApproval` is true even for one step (`chat/policy.go:31-40`). The run goes to status `approval`. Web and phone show a `host` card: command in monospace, working directory, timeout, and Hermes' danger reason ("pipe to shell").
4. The person approves (`chat/service.go:405-459`). Because the plan has host steps, the conversation is queued on the host lane (4.8), and the host lane's apply run claims it.
5. For the step: the runner commits a fenced checkpoint that re-checks every snapshot (`readsChanged`; a change archives and replans as today, before anything runs) and sets the step to `started`. Then it calls the tool's `Prepare`. `Prepare` POSTs `/tools/terminal/call` with `call_key = <conversation id>:<step id>:<attempt>`, on a context that is not cancelled by `runCtx` (4.6 item 6). The worker writes `running` to its idempotency store, runs the command, stores the result, and returns it.
6. The runner opens the SERIALIZABLE step transaction (`chat/runner.go:949-1046`). For a host step it skips `readsChanged` (already checked in step 5, and the host effect has happened), `Call` returns the prepared result without touching the network, the step is saved `done`, and snapshots are recomputed as today. A serialization retry reuses the prepared result.
7. Because the plan had host steps, the runner continues into a plan run (section 4.9) so the model reads the output and proposes the next step, which again needs approval.

---

## 3. The tool host

### 3.1 Installing Hermes as a pinned package

A plain `hermes-agent @ git+…@<sha>` dependency does not work. Two separate failures were reproduced *(ran)*:

- **Lock fails.** `browser-harness 0.1.13` pins `pillow==12.3.0`; Hermes pins `Pillow==13.0.0`. Hermes resolves only through its own `[tool.uv] override-dependencies` (`hermes:pyproject.toml:640-689`), which uv does not apply when Hermes is a dependency.
- **Build fails.** `hermes:setup.py:49, 66` (`_GuardedSdist`, `_GuardedBdistWheel`) raise "Building wheels or sdists for hermes-agent is not supported" unless `HERMES_NIX_BUILD=1`.

What works *(ran, uv 0.13.6, CPython 3.14.7/3.14.8)*: set the build variable through `[tool.uv.extra-build-variables]`, copy the upstream overrides, and the lock resolves 79 packages; `uv lock` took 1 m 32 s cold and `uv sync` 6 s. The resulting venv is 207-235 MB. **Caveat:** those runs used `git+file://` of the local main checkout (`334f66b8`) and no `constraint-dependencies`, so they did not test the block below as written.

Three more facts shape the pyproject:

- **The consumer lock drifts from upstream's tested lock.** 13-15 shared packages resolve differently, including `python-dateutil 4.0.0` vs `2.9.0.post0` and `fastapi 0.162.2` vs `0.133.1` *(ran)*. Fix: `sync-hermes.sh` generates `constraint-dependencies` from `uv export --frozen` of upstream `uv.lock` at the pinned commit.
- **Constraints need a CPython-only environment.** With the exported constraints and `environments = ["python_version >= '3.14' and sys_platform != 'android'"]`, `uv lock` fails on the split `platform_python_implementation == 'PyPy' and sys_platform == 'win32'`, because `pywin32==311` has no PyPy wheels *(ran by the feasibility review: `review-feasibility/projA`, `lockA.log`)*. Adding `and platform_python_implementation == 'CPython'` resolves 79 packages, matching upstream for fastapi 0.133.1, python-dateutil 2.9.0.post0, starlette 1.9.0 *(ran: `projC`, against a `file://` archive of v0.23.0)*. The export also emits URL and git requirements (`kittentts @ https…whl`, `misaki @ git+https…`, psutil's Android git pin), which uv accepted.
- **Upstream policy is not inherited**: `exclude-newer = "3 days"` and `exclude-newer-package = { certifi = false }` (`hermes:pyproject.toml:679-680` at v0.23.0), `environments`, `default-groups = []`. Copy them. `environments` that excludes Android also stops `uv lock` from cloning psutil's Android-only git pin.

**Cost of the git pin (not yet measured).** uv keeps a full, non-shallow clone of a git dependency in its cache: the investigators' uv cache held one Hermes db repo with a 1.14 GiB pack, `is-shallow-repository false`, and the local `.git` is 1.4 GB *(ran by the feasibility review)*. The "6 s sync" above came from `git+file` of the local clone. Every fresh `install-tool-host`, CI cache miss, weekly sync job and desktop staging (its `uv export` holds the same URL) would fetch that history from GitHub. Phase 1 measures a cold `git+https` sync. The alternative is to pin a GitHub archive of the same commit: `hermes-agent @ https://github.com/NousResearch/hermes-agent/archive/<sha>.tar.gz`. It is still a pinned package (decision 1), `uv.lock` records its hash, nothing is cloned, and it still needs `HERMES_NIX_BUILD=1` for the sdist → wheel build. Its risk is that GitHub has changed archive bytes in the past, which would break `uv sync --frozen` on a hash mismatch; the sync's `test-tool-host` re-downloads and would catch it. **Recommendation: use the archive URL if a cold `git+https` fetch is above ~200 MB, else the git URL.** Either way, size the CI uv cache for it.

Upstream calls library installs unsupported (`hermes:website/docs/getting-started/platform-support.md`) and uses a fixed version string `0.0.0` even at tags. The ADR must record that Timely bypasses an upstream build guard on purpose. The supported alternative is a git-ignored checkout at the pinned commit used as an editable path dependency. It also keeps Hermes a pinned package and brings skills and locales with it, but it adds a clone step to every setup and to desktop staging. **Recommendation: the pinned package (git or archive URL) with the build variable.** It keeps `uv.lock` the single pin, and the sync refuses to proceed when the `setup.py` guard text or the upstream overrides change (section 8.3), so a human looks at it. Before the block below is called verified, phase 1 re-runs it exactly as written (constraints, CPython environment, the real `https` pin at `2bd378ed`) and records the result in `hermes.lock.json`.

`apps/tools/pyproject.toml`:

```toml
[project]
name = "timely-tools"
version = "0"
requires-python = ">=3.14,<3.15"
dependencies = [
  # Extras are added per tool as tools are enabled; none are needed for phases 1-3.
  "hermes-agent @ git+https://github.com/NousResearch/hermes-agent@2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19",
  # or: "hermes-agent @ https://github.com/NousResearch/hermes-agent/archive/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19.tar.gz"
]

# timely_tools is installed into the venv (editable), so `python -I -m timely_tools`
# works: -I implies -P, which drops the current directory from sys.path.
[build-system]
requires = ["uv_build>=0.9,<0.14"]
build-backend = "uv_build"

[tool.uv.build-backend]
module-name = "timely_tools"
module-root = ""

# BEGIN hermes-sync  (generated by scripts/sync-hermes.sh from Hermes v0.23.0; do not edit)
[tool.uv]
package = true
required-version = ">=0.13.6"
default-groups = []
exclude-newer = "3 days"
exclude-newer-package = { certifi = false }
environments = ["python_version >= '3.14' and sys_platform != 'android' and platform_python_implementation == 'CPython'"]
override-dependencies = [
  "pynacl>=1.6,<1.7",
  "cryptography==50.0.2",
  "Pillow==13.0.0",
  # …copied verbatim from upstream [tool.uv] override-dependencies
]
constraint-dependencies = [
  "fastapi==0.133.1",
  "python-dateutil==2.9.0.post0",
  "starlette==1.9.0",
  # …every package from `uv export --frozen --no-dev --no-emit-project --no-hashes --all-extras` of upstream uv.lock
]

[tool.uv.extra-build-variables]
hermes-agent = { HERMES_NIX_BUILD = "1" }
# END hermes-sync
```

Notes:

- Upstream overrides change between releases (`cryptography==50.0.1` at v0.22.5, `50.0.2` at v0.23.0) *(ran)*, so the block is regenerated on every sync.
- `--all-extras` on the export is *(inferred)*: constraints only apply to packages that are installed, so pinning every extra costs nothing and keeps later extras on upstream's versions.
- **Package name and install.** The Hermes wheel installs top-level modules named `tools`, `agent`, `utils`, `plugins`, `providers`, `gateway`, `cron`, `pm` and about 86 root modules (`hermes:setup.py:84-99`). Timely's package is `timely_tools`, in `apps/tools/timely_tools/`. It is an installable project (`uv_build`, `module-root = ""`), because the draft's `package = false` left it out of the venv and `python -I -m timely_tools` then fails with "No module named timely_tools" (`-I` implies `-P`) *(ran by the feasibility review)*. With the build backend above, `uv sync` installs it editable and `python -I -m timely_tools` works from any directory *(ran: uv 0.13.6, scratch project `revise/pkg`)*. `[tool.uv]` may appear only once in TOML, so `package = true` lives inside the generated block; the generator always writes it.
- **No runtime installs.** Hermes' `pm.ensure_import(extra)` installs missing extras into the running venv (`hermes:pm/extras.py:17-70, 187-218`; callers `hermes:tools/read_extract.py:81`, `hermes:tools/vision_tools.py:416`, `hermes:tools/tts_tool_lifecycle.py:127`), and `skill_view` calls `pm.ensure(dep)` for a skill's `deps:` (`hermes:tools/skills_tool.py:686`). `ensure_import` does `from pm.client import sync_venv` inside the function (`hermes:pm/extras.py:217`), so patching `pm.extras.sync_venv` would do nothing. The worker, before importing any tool module, replaces `pm.client.sync_venv`, `pm.install.sync_venv` (`hermes:pm/install.py:927`), `pm.client.ensure` (`hermes:pm/client.py:190`), `pm.install.ensure` (:563), `pm.ensure` and the other install entries in `pm`'s lazy export table (`ensure_environment`, `ensure_project_environment`, `ensure_python_tool`; `hermes:pm/__init__.py:28-34`) with functions that raise `InstallError`, and wraps `pm.extras.ensure_import` to raise when `available(extra)` is false. A missing extra then makes the tool report unavailable instead of changing the environment. A test asserts that each enabled tool's `check_fn`, and `skill_view` on a skill with `deps:`, attempt no install (8.6 #14).
- **Skills and locales are not in the wheel** (`hermes:pyproject.toml:700-754`) *(ran)*. Skills are copied (section 5). `locales/en.yaml` is copied to `apps/tools/hermes-assets/locales/` and `HERMES_BUNDLED_LOCALES` points at it, because `hermes:tools/approval*.py` use `agent.i18n.t()`, which falls back to bare keys without it (`hermes:agent/i18n.py:75-86, 247-259`).

### 3.2 Endpoints

All endpoints need `Authorization: Bearer <TIMELY_TOOLS_TOKEN>`. The front rejects any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), rejects any request that carries an `Origin` header (no browser should ever call it), and compares tokens in constant time. It binds `127.0.0.1` only, hard-coded.

**uid checks.** Every `uid` (body, query or path) must match Timely's UUID format, or the front answers `400`. Profile paths are built with a join and then checked to resolve under `profiles/` before any read, spawn or delete. The front refuses (`403 not_allowed`) every call for a uid that is not host-allowed: a uid whose last pushed config (`PUT /accounts/{uid}/config`) does not say `host_allowed: true`, or, when `TIMELY_TOOLS_ACCOUNTS` is set in the tool host's environment, a uid not on that list. No worker is spawned for a refused uid. This is the tool host's half of the host-level gate (4.2).

Errors use one shape: `{"error": {"code": "unauthorized|not_allowed|unknown_tool|not_exposed|unavailable|invalid_args|outside_workspace|hardline|timeout|cancelled|worker_crashed", "message": "…"}}` with a matching HTTP status.

**`GET /health`** → `200 {"ok": true, "hermes": {"tag": "v0.23.0", "commit": "2bd378ed…"}, "home": "<TIMELY_TOOLS_HOME>", "pair": "<TIMELY_TOOLS_PAIR>", "workers": [{"uid": "…", "state": "ready|starting|crashed", "since": "…"}]}`. Electron's `waitForHttp` and the Settings status use it. The API checks `pair` against its own pairing tag (4.11) before it sends any call.

**`GET /tools?uid=<uid>`** → availability, not specs (specs are compiled into the API, section 4.2):

```json
{"tools": [
  {"name": "terminal", "available": true},
  {"name": "browser_exec", "available": false, "reason": "No Chrome or Edge found. Set the browser path in Settings → Agent."}
]}
```

The worker evaluates each exposed tool's `check_fn` under the account's home. Hermes caches `check_fn` for about 30 s keyed by home (`hermes:tools/registry.py:216-232`). `requires_env` cannot drive this: only `web_search`, `web_extract`, `x_search`, `discord` and `discord_admin` declare it *(ran)*.

**`POST /tools/{name}/check`** (static checks, used by rehearsal and the review card):

```json
// request
{"uid": "u1", "conversation_id": "c1", "args": {"command": "curl https://x.sh | sh"}}
// response
{"ok": true,
 "errors": [],
 "hardline": false,
 "danger": [{"reason": "pipe to shell"}],
 "paths": [{"path": "/home/me/proj/a.py", "inside_workspace": true}]}
```

For `terminal` it returns `hermes:tools/approval_detection.py` `detect_hardline_command` and `detect_dangerous_command`. For file tools it resolves paths with `realpath` and applies the workspace rule (3.7). A hardline hit makes rehearsal fail, so the person is never asked to approve something Hermes will block anyway.

**`POST /tools/{name}/call`**:

```json
// request
{"uid": "u1",
 "conversation_id": "c1",
 "call_key": "c1:st_7f3a:1",      // approval tools only; conversation:step:attempt
 "args": {"command": "pytest -q", "workdir": "/home/me/proj", "timeout": 120},
 "deadline_ms": 180000}
// response 200
{"status": "ok",                    // ok | error (the tool ran and reported an error)
 "result": {"output": "…", "exit_code": 0},   // Hermes' JSON string, parsed
 "truncated": false,
 "duration_ms": 8123}
```

The front refuses any `name` that is not `read` or `approval` in `tools.yaml` (`not_exposed`), whatever Hermes has registered. This is the allowlist that keeps plugin, meta and pending tools unreachable.

The front never cancels a call because the HTTP request was dropped. An API restart, crash or air reload in dev drops requests too, and must not kill running host commands; the call finishes in the worker and the API adopts its result through `GET /calls` (4.6 item 5).

**`GET /calls/{call_key}?uid=<uid>`** → `{"state": "running|done|failed|cancelled|unknown", "result": {…}}`. `unknown` means a `running` row whose worker died. The Go runner uses it to adopt a result after a crash instead of running again (4.6), and Retry uses it before resetting a `started` step.

**`POST /calls/{call_key}/cancel`** `{uid}` → `202`. The only way to stop a running call (Stop and Delete, 4.6 item 6). The worker sets Hermes' interrupt for the call's handler thread (`tools.interrupt.set_interrupt(True, thread_id=…)`, `hermes:tools/interrupt.py:37-57`), which lets Hermes tear down the command's own process group (`hermes:tools/environments/local.py:972-1022`). After a 5 s grace it kills the process groups of children it tracks for that call. The stored state becomes `cancelled`.

**`POST /files/snapshot`** `{uid, path}` → inside the workspace or an owner-chosen readable folder: `{"exists": true, "sha256": "…", "size": 1234, "inside": true, "text": "…≤64 KB…"}`. Anywhere else, or on a path Hermes' read denylist covers (`hermes:agent/file_safety.py:342-424`), or a credential path (`~/.ssh`, `~/.gnupg`, the Timely data dir, `TIMELY_TOOLS_HOME`, Electron `userData`): `{"exists": true, "sha256": "…", "size": 1234, "inside": false}` with **no text**. Paths are resolved the same way as read paths (3.7). Backs the Go `host_file_snapshot` tool, which gives `write_file` and `patch` a before-state, a change check and, inside the workspace, a diff (4.6 item 8). It runs before approval, which is why it never returns outside text.

**`POST /conversations/{conversation_id}/close`** `{uid}` → `204`. Cleans up the conversation's processes, shell, browser, kernels and read tracking (3.5).

**`GET /skills?uid=<uid>`** → `{"revision": 7, "skills": [{name, category, description}]}`: the account's own skills (created by `skill_manage`). The front answers it from the profile's `skills/` directory without spawning a worker, and bumps `revision` whenever a `skill_manage` call or a delete from Settings changes that directory. Shipped skills are in the compiled index (section 5).

**`PUT /accounts/{uid}/config`** `{host_allowed, settings: {...}, secrets: {...}}` → the front stores this copy, writes the account's `config.yaml` and `.env` from it (3.4) and restarts the account's worker. The front rewrites `config.yaml` from its stored copy before every worker spawn (3.4). **`DELETE /accounts/{uid}`** stops the worker and deletes its profile dir; the API calls it when an account is deleted.

### 3.3 Process model: one worker per account

Hermes can serve several homes from one process, but only with four bindings per call, and some state still leaks. Facts *(ran unless noted)*:

- `HERMES_HOME` is read per call through a context-variable override (`hermes:hermes_constants.py:32-50, 194-202`). With `set_hermes_home_override`, `set_secret_scope(build_profile_secret_scope(home))` and `scoped_session_key(...)` inside `contextvars.copy_context().run`, two accounts called from 4 concurrent threads each saw their own home, secrets, skills and `approvals.deny`.
- Hermes' own binder does a fourth thing, `install_and_reset_profile_terminal_scope`, because `terminal_tool` otherwise copies config into process-global `TERMINAL_*` environment variables, first writer wins (`hermes:gateway/run.py:1795-1827`, `hermes:tools/terminal_tool.py:703`, Hermes bug #68559). That helper is private.
- Some state lands in the launch home whatever the binding: `spawn-ledger.json` and `cache/browser-use/lightpanda`. `_last_resolved_tool_names` (used by `execute_code`'s sandbox) and `process_registry` are process-global *(read)*.
- Hermes' web-search memo is process-global and keyed without the home (`hermes:tools/web_result_cache.py:85-110`) *(read)*.

**Decision: one front process plus one worker process per account.** The front does not import Hermes. It spawns a worker for an account on first use with `HERMES_HOME=<TIMELY_TOOLS_HOME>/profiles/<uid>` and a scrubbed environment, and reaps it after 30 minutes idle (but never while a call or a background child is running). Cost per worker: about 97 MB RSS after import, about 125 MB after a terminal call, about 1 s warm start *(ran)*. For a personal app with one or two accounts this is cheap, and it removes the private binder, the `TERMINAL_*` leak and the shared memo.

Inside a worker, each call still binds `scoped_session_key(f"timely:{uid}:{conversation_id}")` (3.5), because the session key is what separates shells, not the home.

Worker protocol: JSON lines over a private pipe pair, one request id per call. **Not stdout:** Hermes prints to stdout. `get_tool_definitions` prints toolset banners unless `quiet_mode=True` *(ran by the feasibility review: "✅ Enabled toolset 'file': …", "🛠️ Final tool selection (7 tools): …"; `hermes:model_tools.py:326-330, 535`)*, and approval and sudo prompts print too (`hermes:tools/approval_prompt.py:159-181`, `hermes:tools/terminal_tool_sudo.py:212-249`). The front spawns the worker with the protocol on fds 3 (requests) and 4 (responses) via `pass_fds`. Before importing Hermes, the worker points fd 1 and `sys.stdout` at stderr (`os.dup2(2, 1)`), so stray prints land in the tool host log. The worker runs `handle_function_call` in a thread pool through `contextvars.copy_context()` (registry handlers are synchronous; `model_tools._run_async` spawns its own loop thread when it sees a running loop) and records each call's handler thread id. A `{"cancel": id}` line sets Hermes' interrupt for that thread and, after a grace period, kills the child process groups the worker tracks for the call (Stop, 4.6 item 6). Hermes starts each command in its own session (`start_new_session=True`, `hermes:tools/environments/local.py:1162-1167`), so "the worker's process group" alone would miss it. The worker exits when fd 3 closes (lifeline). No extra ports. A test runs a terminal call that prints to stdout and asserts the protocol survives (8.6 #16).

Worker startup:

- `get_tool_definitions(enabled_toolsets=[explicit list from tools.yaml], quiet_mode=True, skip_tool_search_assembly=True)` so nothing prints and the `tool_search`/`tool_describe`/`tool_call` bridge and its main-model resolution never run (`hermes:model_tools.py:227-270, 522-563`) *(ran: default call returns 20 schemas including the bridge)*.
- Worker cwd is the account's `workspace/`; `TERMINAL_CWD` is set to it (3.7).
- Import `model_tools` once: 9.7 s cold (bytecode compile), 0.76-1.1 s warm, 1,119 modules *(ran)*. Desktop precompiles (section 10).
- Expect stderr noise "Auxiliary Nous client unavailable" on import *(ran)*. Filter it from the tool host log; none of the exposed tools need Hermes' auxiliary model.

### 3.4 HERMES_HOME layout

```
<TIMELY_TOOLS_HOME>/                      dev: apps/api/data/hermes   desktop: <userData>/data/hermes
  _host/                                  HERMES_HOME of the front; never an account home
  runtime/                                HERMES_RUNTIME_DIR: shared PM tool store (node, ripgrep, …)
  profiles/
    <uid>/                                HERMES_HOME of account <uid>'s worker
      config.yaml                         written by Timely only (see below)
      .env                                tool keys, mode 0600, written by Timely only
      skills/                             skills this account's agent created
      workspace/                          default terminal cwd and file-tool root
      home/                               HOME for terminal shells (see 3.7)
      timely/calls.sqlite                 idempotency store
      (Hermes creates: audio_cache, cache, cron, hooks, image_cache, logs, memories,
       pairing, sessions, SOUL.md, processes.json, spawn-ledger.json …)
```

Why `profiles/<uid>` and an explicit `HERMES_RUNTIME_DIR`: Hermes' PM tool store defaults to the Hermes root, which for a home outside `~/.hermes` is the home itself, unless the home is `<root>/profiles/<name>` (`hermes:pm/environments.py:220-260`, `hermes:pm/paths.py:41-75`, `hermes:hermes_constants.py:99-107, 302-314`). Without this, each account would download its own copy of every PM tool. Setting `HERMES_RUNTIME_DIR` as well makes it explicit.

`TIMELY_TOOLS_HOME` is required. The tool host refuses to start without it and sets the front's `HERMES_HOME` to `_host`. Overriding `HOME` alone does not protect `~/.hermes`: Hermes reads the account home from the password database (`hermes:hermes_constants.py:46-80`).

`config.yaml`, written by the tool host from Timely settings on `PUT /accounts/{uid}/config`:

```yaml
approvals:
  deny: ["git push*", "sudo *", "rm -rf ~*"]   # from Settings; defaults are an open question (14)
skills:
  external_dirs: ["<apps/tools>/skills/timely", "<apps/tools>/skills/hermes/skills", "<apps/tools>/skills/hermes/optional-skills"]
  inline_shell: false
  disabled: [<generated: skills.yaml deny ∪ (optional skills − skills.yaml allow)>]   # 5.5
  guard_agent_created: true
curator: {enabled: false}            # no background LLM review in the tool host
tool_search: {enabled: off}
telemetry: {shared_metrics: {enabled: false, send: false}}
web: {keyless_fallback: false, keyless_rescue: false}   # defence in depth; web tools are not exposed
terminal: {lifetime_seconds: 300}
mcp_servers: {}                      # no MCP-client tools registered at run time
plugins: {enabled: [], disabled: [<every non-bundled plugin name>]}
browser: {executable_path: "<host-level setting or auto-detected Chrome/Edge>", use_real_profile: false}   # no cloud provider, no cdp_url
```

Hermes refuses agent writes to `<home>/config.yaml` ("Agent cannot modify security-sensitive configuration") and to an unread `<home>/.env` *(ran)*. Exact config key names for `curator`, `tool_search`, `web.keyless_rescue`, `plugins` and `browser` come from reading (`hermes:hermes_cli/config_defaults.py:1695, 2311-2324`, `hermes:agent/web_search_registry.py:145-151`, `hermes:tools/web_tools_rescue.py:21-31`); the contract test (8.6 #13) asserts each one takes effect.

**Config tampering.** Hermes' file tools refuse `config.yaml`, but an approved terminal command can still edit it: enable a plugin, empty `approvals.deny`, set `skills.inline_shell`, add an `mcp_servers` entry (Hermes registers MCP-client tools at run time, `hermes:tools/mcp_tool_registration.py:384`, and plugins register tools through `ctx.register_tool`, `hermes:hermes_cli/plugins_context.py:292`; user plugins under `<profile>/plugins` load when `plugins.enabled` lists them, `hermes:hermes_cli/plugins_discovery.py:312-324`). So the front keeps its own copy of each account's config, rewrites `config.yaml` from it immediately before every worker spawn, and verifies the file's hash after writing it. It refuses to start a worker when `<profile>/plugins` is non-empty. After start, the worker compares the registry against the manifest and refuses any call while a tool not in the manifest is registered (8.6 #13). Bundled backend plugins still auto-load (the browser backends need them).

### 3.5 task_id, session key and cleanup

- **task_id = session_id = conversation id** for approved tools; `read:<conversation id>` for read tools (3.7). Timely has no run id: each claim (plan, apply, retry, lease re-claim) gets a fresh lease (`chat/runner.go:129-133`, `chat/model.go:71-110`). Hermes keys cwd, processes and the file read tracker on `task_id` (`hermes:tools/file_tools.py:385-389`). A per-claim id would split one conversation's terminal state (cwd, kernel) across runs. Hermes' staleness guard is off (3.7), so the read/write split costs nothing.
- **Session key = `timely:{uid}:{conversation_id}`, bound on every call.** `task_id` alone does not isolate the local shell: with no session key every task shares the `default` environment, and `export FOO=bar` under one task showed up under another *(ran)* (`hermes:tools/terminal_tool.py:517-565, 106-111`). With the key bound, the env key becomes `home:<HERMES_HOME>:session:<key>` and nothing leaks *(ran)*.

**Cleanup (`POST /conversations/{id}/close`)**, inside the conversation's scope, in Hermes' own teardown order (`hermes:agent/client_lifecycle.py:102-137`):

1. Kill each process in `process_registry` whose `owner_task_id` equals the conversation id.
2. `tools.terminal_tool_lifecycle.cleanup_vm(tools.terminal_tool._resolve_container_task_id(conversation_id))`. It is not on `tools.terminal_tool` (AttributeError) *(ran)*.
3. `tools.browser_session_lifecycle.cleanup_browser(conversation_id)` *(read, not run)*.
4. `tools.approval.clear_session(session_key)`, which also disposes `execute_code` kernels (`hermes:tools/code_kernel.py:392, 409-415`) *(ran)*.
5. `tools.file_tools.clear_file_ops_cache(conversation_id)` *(read, not run)*. It also drops Hermes' read-before-write baseline for the task (`hermes:tools/file_tools.py:376-398`), which is one reason the worker turns that guard off (3.7).

Steps 1, 2 and 4 were confirmed by the child process disappearing *(ran)*.

**When the Go API calls it.** Runs outlive chat views (ADR 0008), so the trigger is the run, not the view: on Stop (`chat/service.go:461-472`), Delete (`chat/service.go:576-597`), discard/reject, and when a run ends `done` or `failed` with no remaining batch. A later message starts with a fresh shell, which is acceptable.

**Backstops.** Hermes reaps idle terminal environments after `terminal.lifetime_seconds` (default 300). The worker reaps kernels idle for 15 minutes and, on shutdown, calls `cleanup_all_environments()` and `shutdown_all_kernels()`. Hermes checkpoints background processes in `<home>/processes.json` and may "recover" them after a restart; since Timely drops background mode (4.8), the worker clears that file on start *(inferred: confirm no other writer)*.

Hermes leaves daemon threads (`_cleanup_thread_worker`, `hermes-lsp-loop`, `owner-death-supervisor-waiter`, `hermes-kernel-idle-reaper`) and a persistent `/bin/sh process_supervisor.sh` child per worker *(ran)*. That is fine inside a worker; killing the worker's process group on shutdown covers them.

### 3.6 Hermes' own approval layer

With no CLI, gateway or ask flag present, Hermes **auto-approves** dangerous-pattern commands and only logs a warning. `curl … | sh` and `chmod -R 777` ran *(ran)* (`hermes:tools/approval.py:1238-1276`, `:1013-1045`). These still block, even in yolo mode *(ran)*: hardline patterns (`mkfs` → "BLOCKED (hardline)", `hermes:tools/approval_detection.py:124-157`), deleting the runtime's own venv, the `sudo -S` guard, and per-home `approvals.deny` globs (`hermes:tools/approval.py:1151-1174`). File-write guards also run regardless: `write_file` refused `~/.ssh/authorized_keys`, `<home>/config.yaml` and an unread `.env` *(ran)*.

**Decision: keep Hermes' "no human present" path.** Timely's Agent proposal is the human gate. Hermes' floors stay as a second layer. Specifically:

- Do not set `approvals.mode: off` (changes nothing the floors don't).
- Do not set any variable that turns the gate into a prompt nobody answers or a deny: `HERMES_INTERACTIVE`, `HERMES_GATEWAY_SESSION`, `HERMES_EXEC_ASK`, `HERMES_SESSION_PLATFORM` (`api_server`/`webhook` turn on deny mode), `HERMES_CRON_SESSION` (`hermes:tools/approval_context.py:167-186, 223-239`). Also never set `HERMES_YOLO_MODE` (frozen at import, `hermes:tools/approval.py:47`), `HERMES_SAFE_MODE` (skips all plugin discovery, which also removes the bundled browser backends, `hermes:hermes_cli/plugins.py:408-411`) or `HERMES_ENABLE_PROJECT_PLUGINS`.
- Start workers with an allowlisted environment only: `PATH`, `LANG`, `TZ`, `TMPDIR`, `HOME` (3.7), `HERMES_HOME`, `HERMES_RUNTIME_DIR`, `HERMES_BUNDLED_SKILLS`, `HERMES_OPTIONAL_SKILLS`, `HERMES_BUNDLED_LOCALES`, `TERMINAL_CWD=<workspace>`, `TERMINAL_MAX_FOREGROUND_TIMEOUT=240` (4.8; read once at import, `hermes:tools/terminal_tool.py:78`), `HERMES_DISABLE_FILE_STATE_GUARD=1` (3.7), `PYTHONDONTWRITEBYTECODE=1`, `PYTHONNOUSERSITE=1`. A test on the env builder asserts that exactly these names are present, and that `JWT_SECRET`, `DB_*`, `TIMELY_BACKUP_KEY`, `TIMELY_VAULT_KEY`, `TIMELY_TOOLS_TOKEN`, provider keys and every `HERMES_*` flag above are absent.
- Show Hermes' danger reasons on the card through `/check`, and fail rehearsal on hardline hits.

The risk this leaves: if a Timely bug lets a host write through without review (wrong authority, a `pending` tool exposed), Hermes adds no gate beyond the floors. Section 8.6 and 12 add tests for exactly that.

### 3.7 Workspace, HOME and file confinement

Hermes' read denylist covers `.env` files and its own credential stores, not `~/.ssh`, Timely's data dir, Postgres data, Electron `userData`, or other accounts' profiles (`hermes:agent/file_safety.py:342-424`). `vision_analyze` and the file tools accept any host path (`hermes:tools/image_source.py:78-89, 198-208`). On a multi-account host (ADR 0001) that lets one account read another's chat images (`chat/images.go:42-45`).

- **Read tools (`read_file`, `search_files`) are confined, whether or not they need approval** (open question 3). Hermes resolves a relative path against the task's recorded workspace root or terminal cwd and falls back to the process cwd, and expands `~` against the worker's `HOME` (`hermes:tools/file_tools_paths.py:264-279, 307-314`; `hermes:tools/file_tools.py:222-238, 281-284, 624`). An approved `cd /` in the conversation's terminal moves that base. So the worker never lets Hermes resolve a read path: it rejects `~` and any relative path that is not plainly inside the workspace, rewrites accepted relative paths to absolute paths under `workspace/`, defaults `search_files`' path to the workspace root, then applies `realpath` and refuses anything outside `workspace/` plus the host-level extra readable folders (section 11). Read tools also run under their own Hermes task id, `read:<conversation id>`, so an approved terminal step's `cd`, `export` or shell state never reaches them (Hermes runs file reads through the task's terminal environment, `ShellFileOperations` on a `bash -lic` shell, `hermes:tools/file_operations.py:207-221`, `hermes:tools/file_tools.py:370`). With the real-home switch on, that read shell still sources the person's rc files; phase 2 checks whether the local backend can run file reads without a login shell (`login` flag in `hermes:tools/environments/local.py:1155-1158`) and uses it if so. Phase 2 tests cover symlinks, `..`, `~`, and a relative path and `search_files('.')` after an approved `cd /` (12).
- **Approved writes and commands are not confined** (decision 2). `/check` still reports paths outside the workspace on the card, in red. `/files/snapshot` returns no file text outside the workspace (3.2).
- **Hermes' read-before-write guard is off.** Hermes refuses to overwrite an existing file unless the same task id has fully read it in the same process (`hermes:tools/file_tools_write_guards.py:560-597`). That baseline lives in memory, so it is lost when the worker is reaped, restarted or crashes, and when cleanup calls `clear_file_ops_cache`; and files outside the workspace can never be read first. An approved `write_file` to an existing file then fails *(ran by the feasibility review: "Refusing to overwrite … this task has not seen its full current content" in a fresh process; written after `read_file` in the same process, or with `HERMES_DISABLE_FILE_STATE_GUARD=1`)*. The worker sets `HERMES_DISABLE_FILE_STATE_GUARD=1` (`hermes:tools/file_state.py:30-38`; its only consumer is the staleness check, `hermes:tools/file_tools_write_guards.py:571`, so the protected-path guards stay on). Timely's own `host_file_snapshot` hash, checked in the `started` checkpoint (4.6), replaces it. A contract test pins this (8.6 #17).
- **Terminal HOME.** Hermes runs `bash -lic`, a login interactive shell, so the user's rc files run whenever `HOME` is real *(ran)*. 28 skills tell the model to run `hermes …` commands and 64 mention `~/.hermes` *(ran)*; with the real HOME such a command could act on the owner's live Hermes. **Recommendation: `HOME=<profile>/home` by default**, with a Settings switch "Use my real home folder in the terminal" for owners who want their `gh`, git and SSH setup. Open question 4.

---

## 4. Go integration

### 4.1 Why the draft's "add tools to the catalog at runtime" fails

- Chat policy never reads the run's catalog. `isReadTool`, `isWriteTool`, `needsApproval`, the `Showing` lookup and `prepareStep` call `agent.AuthorityOf` / `agent.Prepares`, which read `sync.OnceValue(func() Catalog { return NewCatalog(Deps{}) })` (`agent/authority.go:171-183`; `chat/policy.go:17-40`; `chat/runner.go:825, 1083`; `chat/proposal.go:173`; also `provider/describe_tools.go:200`). A tool added only to the per-run catalog is neither read nor write and falls through to "Unknown tool" (`chat/runner.go:587`).
- The authority builders (`reads`, `writes`, `.reviewed()`, `.destroys()`, `.showingFor()`) and `validate()` are unexported (`agent/authority.go:14-77, 154-169`), and only `registerTool[I,O]` builds the unexported `check` (`agent/catalog.go:40-100`).
- The catalog factory is `func(*gorm.DB) agent.Catalog` with no user id, rebuilt on every plan run and inside every apply step transaction (`chat/service.go:26, 42`; `chat/runner.go:323, 973, 1087`). A `GET /tools` there would run once per step transaction.

### 4.2 Decision: specs generated at sync time and compiled into `agent.NewCatalog`

`sync-hermes.sh` writes `apps/api/internal/features/pytools/tools.gen.json`: one entry per tool whose `tools.yaml` authority is `read` or `approval`, with the schema after Timely's overrides (4.8). The Go package embeds it with `go:embed`. `agent.NewCatalog` registers these entries like any Go tool, so `AuthorityOf`, `Prepares`, the proposal step check, describe tools and triage all see them with no change to chat policy. The tool host is only needed at call time.

This is a third option next to the two the runner investigator gave (thread the catalog through policy, or a process-wide `RegisterRemote`). It is smaller than both and keeps the tool list static, which also keeps the prompt cache stable.

`tools.gen.json` entry:

```json
{"name": "terminal",
 "description": "Execute shell commands on the Timely host…",
 "parameters": {"type": "object", "properties": {"command": {"type": "string"}, "workdir": {"type": "string"}, "timeout": {"type": "integer", "maximum": 240}}, "required": ["command"]},
 "authority": "approval",
 "destroys": true,
 "shows": "",
 "outside": true,
 "result_cap_bytes": 60000,
 "hermes_schema_sha256": "3f2a…"}
```

**Files and types.**

`apps/api/internal/features/pytools/`:

- `specs.go`: `//go:embed tools.gen.json`; `type Spec struct { Name, Description string; Parameters json.RawMessage; Authority string; Destroys bool; Shows string; Outside bool; ResultCapBytes int }`; `func Specs() []Spec` (sorted by name).
- `client.go`: `type Client struct { base, token string; http *http.Client }` with no fixed `Timeout` (deadline from `ctx`). Methods `Call(ctx, uid, name string, args json.RawMessage, callKey string) (json.RawMessage, error)`, `Check(...)`, `CallState(ctx, uid, key)`, `Snapshot(ctx, uid, path)`, `Close(ctx, uid, conversationID)`, `Available(ctx, uid) (map[string]Availability, error)` with a 30 s cache. `New(url, token string) *Client` returns nil when either is empty, and a nil client answers every call with "The tool host is not set up on this server."
- `ctx.go`: `WithConversation(ctx, id)`, `ConversationFrom(ctx)`, `WithCallKey(ctx, key)`, `CallKeyFrom(ctx)`. Today the only context keys are completer, noRetry, timezone, liveProgram and client.
- `result.go`: decode Hermes' JSON-string result; truncate to `ResultCapBytes` with `"truncated": true` and `"totalBytes"`; map a `{"_multimodal": true, …}` envelope to its text summary or refuse it (`hermes:tools/vision_tools.py:594-616`); for `Outside` tools, wrap with the outside-data marker and defang look-alike delimiters (4.7).

`apps/api/internal/features/agent/tools_host.go`: `func registerHostTools(c Catalog, d Deps)`. For each `pytools.Spec` it unmarshals `Parameters` into `*jsonschema.Schema`, resolves it, builds the same `check` that `registerTool` builds (uid check plus `Validate`), builds the `Authority` with the unexported builders, and runs `authority.validate(name)`. Keeping this inside package `agent` avoids exporting the builders. `Deps` gains `Host HostCaller` (interface over `pytools.Client`; nil in `NewCatalog(Deps{})`, which is fine because the static catalog only needs authorities) and `HostRehearsal bool`.

`cmd/agent_deps.go`: `chatCatalog` passes the live client; `rehearsalCatalog` passes the same client with `HostRehearsal: true` (4.6). Keep host tools out of `agent.New`, the MCP server (`agent/server.go`): the owner's Hermes already uses Timely's MCP server as a client (`agent/server.go:34, 364-376`; `apikey/service.go:77`), and it must not get its own tools back. `registerHostTools` never takes or touches the `*mcp.Server`; it adds to the catalog only, the way chat-only tools are registered with a nil server today (`agent/tools_bots.go:59-60`, `agent/catalog.go:40-45`).

**`host_file_snapshot` is internal, not `MCPOnly`.** In Timely, `MCPOnly` means "served to external MCP clients, never offered to chat" (`agent/authority.go:17`), the opposite of what the draft wanted: it would have given any MCP client with an API key an unapproved host-file reader. Instead it is registered chat-only (nil MCP server) with `Access: Read` and a new `Internal: true` flag on `Authority`. `isReadTool` (`chat/policy.go:17-20`) returns false for internal tools, so the runner never offers it as a provider tool (`chat/runner.go:337, 344`) and refuses it if the model names it (`chat/runner.go:576`). `snapshots()` and `readSnapshot` call `catalog[...]` directly (`chat/runner.go:825-835, 935-938`), so they still reach it. `TestReviewShowsCurrentState` (`agent/authority_test.go:326-345`) requires the shown read to have `Access == Read`; it stays true, and the test gains the `write_file`/`patch` rows. A new test asserts that the MCP server's tool list (`agent.New`) contains no host tool and no `host_file_snapshot`.

**Agent tests.** `TestEveryToolDeclaresAuthority` and `TestMCPServerServesTheCatalog` (`agent/authority_test.go:74-139`) enumerate every catalog name. Host tool names come from a generated file that changes with each sync, so these tests derive the host-tool expectations from `pytools.Specs()` (authority from each spec; MCP count `len(catalog) - len(chatOnly) - len(Specs()) - 1`) instead of hand-kept lists.

**Host-level gate.** ADR 0001 has no owner or admin role ("roles … administration" are permanently out of scope), and registration can be opened (desktop `allowRegistration`, `apps/web/electron/supervisor/config.ts:27, 92, 138`; `auth/handler.go:51-57`). A per-account "Host tools on" switch would let any account on a shared install approve commands that run as the owner's OS user and read every other account's data. So host tools (and skills, which run in the same per-account worker) are allowed only for accounts the host allows, following the precedent of host-level switches for host-reaching features (`.env.example:74-78` `CHAT_LOCAL_CLI=off`; :85-87 Ollama address rules while registration is open):

- The allowed uids are a host setting: desktop Settings → Server (stored in the supervisor config, passed to the API and the tool host as `TIMELY_TOOLS_ACCOUNTS`), or the `TIMELY_TOOLS_ACCOUNTS` env var on dev and servers.
- When the list is empty, the default is: allowed only while registration is closed and exactly one account exists. With registration open or a second account, host tools are refused until a uid is listed.
- Accounts cannot change this from their own Settings. "Extra readable folders", "Use my real home folder", the browser path and the workspace folder are host-level for the same reason (they widen what runs or is read without approval); see section 11.

**Per-account availability and enforcement.** The factory has no uid, so offering is filtered in `plan()` through a new hook `s.hostTools(ctx, uid) map[string]bool`: the account passes the host-level gate, has host tools on (Settings), and the tool is not switched off. Unavailable host tools are dropped from the read specs and the write-schema text for that account. This changes the prompt prefix only when a setting changes. Hiding is not enforcement, because `prepareProposal` accepts any write tool in the static catalog that has a `Call` (`chat/proposal.go:172`), so a step from an old transcript, a prompt injection or a skill that mentions `terminal` would otherwise reach approval. Enforcement is in three places:

1. `prepareProposal` refuses a host step whose tool is not in `s.hostTools(ctx, uid)` ("Host tools are off for this account"), before rehearsal.
2. Host tools' `Prepare` and read `Call` re-check through a `HostGate` interface in `agent.Deps` (implemented in `cmd/agent_deps.go` over the same settings), since `Call` receives only `(ctx, uid)`.
3. The tool host front refuses a uid that is not host-allowed (3.2).

A policy test asserts that an account with host tools off, or not on the host list, cannot get a host step to approval, and that a read host tool called by name answers "Host tools are off for this account".

**Sidecar down.** Specs do not depend on the tool host, so a down tool host never changes the offered tool list or the cache prefix. `Call` fails with "The tool host is not running" and the run continues. `readSnapshot` (`chat/runner.go:1123-1131`) must return a distinct "unreachable" error for `host_file_snapshot` that fails the run with Retry instead of returning `true`, which would archive and replan in a loop.

### 4.3 Authority mapping

| `tools.yaml` | Go Authority | Offered as | Example |
|---|---|---|---|
| `read` | `reads` (Access Read, Effect ReadOnly) | provider tool spec | `skills_list`, `skill_view`; `read_file`, `search_files` only if the owner picks unapproved reads (open question 3) |
| `approval` | `writes.reviewed()`, plus `.destroys()` when `destroys: true`, plus `.showingFor(shows)` when set | step inside `propose_changes`, always reviewed | `read_file`, `search_files` (default), `terminal`, `write_file`, `patch`, `skill_manage`; later `execute_code`, `browser_*` |
| `pending` | not registered | hidden | new upstream tools until reviewed |
| `skip` | not registered | hidden | agent-loop tools, desktop UI, Go-owned tools |

There is no `immediate` value. ADR 0007 lets "clear single edits" run without a proposal, but every Hermes write touches the host, not Timely data.

`Reviewed` makes `needsApproval` true for a single step (`chat/policy.go:31-40`), so a host step always stops at status `approval` (`chat/runner.go:497-529`). A policy test asserts this for every `approval` spec.

### 4.4 Provider compatibility and schema sanitizing

- Hermes schemas parse, resolve and validate with `jsonschema-go`: all 35 definitions from `get_tool_definitions` (every toolset, isolated home) *(ran)*. Keywords used: `type`, `required`, `description`, `items`, `enum`, `default`, `additionalProperties`, `minimum`, `maximum`, `maxItems`, `minItems`, `anyOf` (terminal.notify, skill_manage, manage_connections), `pattern`, `maxLength`. No `$ref`, `$defs`, `oneOf`, type arrays or `nullable`.
- How each provider gets tools: OpenAI-compatible endpoints (Gemini, DeepSeek, xAI, Mistral, Z.ai, OpenRouter) and Ollama as-is (`provider/compat.go:54-55`, `provider/ollama.go:98-99`); Anthropic rebuilds `input_schema` (`provider/anthropic.go:415-456`); Responses flattens and forces `strict:false` (`provider/responses.go:156-180`); the Claude Code and Codex CLIs get the tool list as JSON in the system prompt (`provider/cli.go:22-35, 129-181`).
- Write schemas go into the prompt as text, so only read specs reach a provider's schema validator.

**Rule:** the generator allows only `type, properties, required, description, items, enum, minimum, maximum, minItems, maxItems, maxLength, additionalProperties` in `read` tool schemas. It strips `default` and `pattern` (moving defaults into the description) and fails generation on `anyOf`, `oneOf`, `$ref`. Whether Gemini or some Ollama models reject `anyOf`/`default`/`pattern` is not verified against live endpoints; stripping is cheap insurance. The current read candidates use only simple keywords. Add a provider test that sends a Hermes schema with `anyOf` and `default` through `anthropicTool` and `responsesTools`.

Pin descriptions and parameters from the synced manifest, never from live `get_tool_definitions`: `browser_exec` has a dynamic description and parameters (`hermes:tools/browser_use_cli.py:971-1043`), which would churn the prompt cache. The manifest therefore stores each tool's full description and schema (8.4), not only their hashes, and `make gen-tool-specs` rebuilds `tools.gen.json` from manifest + `tools.yaml` without importing Hermes (8.1).

### 4.5 Name-collision rule

None of the 73 Hermes names collides with the current catalog (183 tools) *(ran)*, but Hermes registers `web_search`, which the runner reserves. The rule:

- Reserved: `web_search`, `propose_changes`, `resolve_target`, `host_file_snapshot`, and every name in `agent.NewCatalog(Deps{})` built without host tools.
- `sync-hermes.sh` refuses to give a reserved name `read` or `approval`; `go test ./internal/features/agent` fails if `registerHostTools` would overwrite a name; `SYNC_REPORT.md` lists any collision.
- A colliding upstream tool must stay `skip` (or be renamed through a `tools.yaml` `expose_as:` key, which the tool host maps back).

### 4.6 Host writes: proposal, rehearsal, preview and idempotency

**The run invariants these tools must respect.** The verify-agent-runs TLA+ model promises at most one write per step and no write after Stop, and assumes every write goes through the `chatCatalog(tx)` transaction. It says outright that "a tool that writes through another handle, a goroutine or an external service breaks at-most-once; review new write tools for this" (`.agents/skills/verify-agent-runs/SKILL.md`; guards StepFenced, WritesInStepTx, ApplySkipsDone, RetryKeepsDone, CheckpointFenced). Apply runs each step in a SERIALIZABLE transaction with a row lock that `retrySerializable` reruns up to 5 times, and the step's `done` commits after the call (`chat/runner.go:949-1046, 1136-1150`). A host side effect inside that transaction would repeat on every retry, hold the row lock for the whole command, and still happen after Stop.

**The product promise for host steps is restated as: no host step starts after Stop, and no host step runs twice without an explicit Retry.** A command already running when Stop arrives is killed, but its effects cannot be undone.

**Design.**

1. **Step identity and attempt.** Add `ID string \`json:"id"\`` and `Attempt int \`json:"attempt"\`` to `chat.Step` (`chat/model.go:47-65`). `ID` is set in `prepareProposal`; `Attempt` starts at 1 and only Retry bumps it (item 5). Add both to `ReviewStep` in `packages/contract/src/changeReview.ts`. Call key = `conversationID + ":" + step.ID + ":" + attempt`. The worker never re-runs a known key, so a new attempt is what lets an explicit Retry run a command again.
2. **`started` checkpoint, with the read check moved in front of the host effect.** Before calling the tool host, the apply loop commits a fenced checkpoint (row lock, lease and `status=running`) that first runs `readsChanged` and then sets the step to `started`. A changed read archives the plan and replans exactly as the step transaction does today (`chat/runner.go:964-985`), so nothing runs. A refused checkpoint (Stop, Delete, lost lease) means the host step never starts. This ordering is required: today `readsChanged` runs inside the step transaction after `Prepare` (`chat/runner.go:957-958` then `:964`), and the step's own `host_file_snapshot` is one of the snapshots it re-reads (`chat/runner.go:825-835`, `:1123-1131`). Once `write_file` or `patch` has run, that hash can never match, so every approved write to an existing file would archive the plan, set `ForceReview` and queue a replan, and the step would never be saved `done` although the write happened. `prepareStep`'s own early `readsChanged` (`chat/runner.go:1102-1104`) is read-only and outside any lock, so it does not replace the checkpoint.
3. **Run in `Prepare`; the step transaction skips `readsChanged` for host steps.** Host `approval` tools have a `Prepare` that makes the tool host call outside the transaction with the call key from `ctx`, and returns a `ctx` carrying the result. `Prepare` runs once before the transaction and the serialization reruns reuse its context (`chat/runner.go:1081-1120`). In the step transaction, a host step skips `readsChanged` (checked in item 2; the effect has happened and a replan cannot undo it), `Call` returns the prepared result (or errors "host step was not prepared"), the step is saved `done`, and snapshots are recomputed as the code already does after `done` (`chat/runner.go:1021-1026`), which re-reads the files later steps will change. Any other read that changed meanwhile is caught by the next step's checkpoint.
4. **Idempotency in the worker.** `calls.sqlite` in the account home keeps `{call_key, state, pid, pgids, started_at, result ≤ 256 KB}`. The worker writes `running` before invoking Hermes and `done`/`failed`/`cancelled` after. A repeated `call` with a known key returns the stored result (or waits on the running call) and never re-runs.
5. **Re-claim and Retry.**
   - Apply finds a step `started` (lease expiry, API crash or restart): it asks `GET /calls/{key}`. `done` → save the step `done` with the result (skipping its own snapshot, item 3). `failed`/`cancelled` → mark the step `failed` with the stored error. `running` → poll until the step's deadline. `unknown` or missing → mark the step `failed` with "This may have run. Check before retrying."
   - Retry (`chat/service.go:599-648`) today resets every step that is not `done` or `discarded` to `pending`, which would erase `started` and reuse the same key. For host steps it changes: before its transaction, Retry asks `GET /calls/{key}` for each host step in `started`; `done` → the step becomes `done` with that result; `running` → Retry answers 409 "A host step is still running"; `failed`, `cancelled`, `unknown` or missing → `pending` with `Attempt + 1`. A host step in `failed` also goes to `pending` with `Attempt + 1`. A step whose last state was `unknown` keeps a `mayHaveRun` flag, shown on the card as "This may already have run" until it is approved again.
6. **Stop.** Cancellation is explicit, never a dropped request. Host calls use a context derived with `context.WithoutCancel(runCtx)` plus the step's own deadline, so an API shutdown, crash or air reload in dev does not cancel them; the call finishes in the worker and item 5 adopts it. Stop (`chat/service.go:461-472`) and Delete (`chat/service.go:576-597`), after their transaction commits, send `POST /calls/{key}/cancel` for every host step in `started`. As a backstop, when `keepLease` cancels `runCtx` (`chat/runner.go:256-273`) during a host call, the runner reads the row and sends the cancel only if the row is `stopped` or gone, not when the lease merely moved to another claimer. The worker cancels through Hermes' interrupt and then kills the tracked process groups (3.2, 3.3).
7. **Rehearsal never executes.** With `HostRehearsal`, host tools validate, POST `/check`, and return `{"rehearsed": true}`. The precedent is `liveBlockRehearsal` (`cmd/agent_deps.go:55-57, 80-87`) and its test (`cmd/agent_tools_test.go:239-285`). `$N` references into a host step's result are refused at proposal time, because the stand-in cannot produce the real shape.
8. **File preview.** The internal Go tool `host_file_snapshot` (4.2) calls `POST /files/snapshot`. `write_file` and `patch` declare `.showingFor("host_file_snapshot")` with step arguments, so `snapshots()` stores the before-state and hash, and the checkpoint in item 2 replans if the file changed between review and apply. The snapshot runs while the proposal is prepared, before approval (`chat/proposal.go:226`), and `Before` is saved in Postgres and survives reject and archive in the message history (`chat/service.go:316-331, 535-570`). So: outside the workspace and the host's readable folders, or on a credential path, the snapshot holds only `{exists, size, sha256, inside:false}` and the card says "Outside your workspace: the current file (N bytes) is not shown"; inside, `text` is capped at 64 KB and the card renders a diff. `promptSteps` (`chat/runner.go:642-654`, which today keeps `Before` whole for the latest proposal) drops `Before` for host steps in every record, so file text from a snapshot never goes to a model provider. A test proposes `write_file` to a path outside the workspace and asserts that no file text is stored in the conversation row or sent in the next prompt.
9. **Model checking.** Extend `AgentRunApply.tla` with a `HostCall` action: the `started` checkpoint (with the read check) → external effect keyed by `(step, attempt)` → done, plus `Cancel` from Stop/Delete, adoption on re-claim, and Retry bumping the attempt. Properties: at most one effect per `(step, attempt)`; no effect starts after Stop; no new attempt without an explicit Retry. Re-sync the coverage anchors (`chatCatalog` in `cmd/agent_deps.go` is fingerprinted). Run `make verify-agent-runs`.

**Tests** (phase 3 exit criteria): `TestRehearsedHostToolNeverCallsSidecar`; integration `TestIntegrationProposedTerminalRunsOnce` with a counting `httptest` tool host: 0 calls in rehearsal; 1 on apply; still 1 after a forced serialization retry; adopt-not-rerun after a simulated crash between call and commit; 0 after Stop before start; Stop during a call sends exactly one cancel; an API context cancelled by shutdown sends none; Stop → Retry → approve runs attempt 2 once; crash → Retry adopts a `done` result instead of re-running. `TestIntegrationApprovedWriteFileIsDone`: apply `write_file` to an existing file and expect the step `done`, not a replan; and change the file between approval and apply and expect a replan with no write. A policy test that every `approval` spec needs a proposal, and the host-gate policy test (4.2).

**Editable proposals.** ADR 0007 calls proposals editable, but today only a chat message replans (there is no endpoint to edit a step's arguments; `chat/service.go:59-79`). Recommended for phase 3: `POST /chats/:id/steps/:index {revision, arguments}`, revision-checked, which re-validates, re-snapshots and re-rehearses, so the person can fix a command before approving. Open question 7.

### 4.7 Untrusted content

- `model_tools.handle_function_call` does not wrap results; only Hermes' agent loop does (`hermes:agent/tool_dispatch_helpers.py:448-480, 484-597`). So results arrive raw.
- Mark as outside data (`outside: true`): `read_file`, `search_files`, `terminal`, `execute_code`, `browser_*`, and `skill_view` when it returns an account-local (agent-created) skill. `pytools/result.go` adds Timely's outside-data marker (today the `outsideData` const in `agent/tools_bots.go:25`; move it to a shared file in package `agent`) and replaces forged closing delimiters.
- Add the outside host read tools to chat's `outsideReads` (`chat/bot_tags.go:39-42, 263-275`) so `ForceReview` applies (`chat/runner.go:503-506`). This matters for **Timely** edits that follow a host read (a `create_task` that would otherwise apply directly). It adds nothing for host steps, which are always reviewed (`ForceReview` only flips an approval that would not otherwise be required, `chat/runner.go:503-506, 523`).
- **Provenance on host cards.** Each host step records which outside data the run read before proposing it (terminal output, file X, page Y, an account-local skill). The card shows "Proposed after reading: …" in a distinct style when any outside data preceded the proposal. A host step that `Destroys` and follows outside data cannot be approved from a notification action, only from the opened card (if the phone's notification categories offer approve actions, `apps/mobile/lib/notifications.ts:109-112`).
- **Continuation is a loop through outside data.** After host steps, the runner feeds terminal and file output back and asks for the next step (4.9), so injected output can draft the next command; only the person's reading of the card stands in the way. Provenance above, plus a cap of 5 consecutive host-step continuations before the run stops and says so (each still needs approval), keep it visible.
- Shipped skills (`skill_view`, `skills_list` on copied skills) are not outside data: the owner reviews every skill change in the sync PR, and the sync runs Hermes' strict threat scan over them (8.3). Account-local skills are outside data everywhere they appear, including the "Your skills" index rows (5.6).

### 4.8 Terminal and time limits

- Hermes' foreground terminal maximum is 600 s (`hermes:tools/terminal_tool.py:78`), equal to Timely's whole-run `runCtx` of 10 minutes (`chat/runner.go:142`). `browser_exec` defaults to 300 s, max 1800 s (`hermes:tools/browser_use_cli.py:94-96`).
- `terminal`'s `background`, `notify`, `heartbeat` and `persist_on_release` report back through Hermes' agent loop and gateway, which Timely does not have (`hermes:tools/terminal_tool.py:1617-1670`).
- `tools.yaml` overrides for `terminal`: drop `background`, `notify`, `heartbeat`, `persist_on_release`, `pty`; cap `timeout` at 240. The worker sets `TERMINAL_MAX_FOREGROUND_TIMEOUT=240`. `browser_exec` `timeout_s` capped at 240. Because background mode is gone, `process_manage` stays `pending`.
- Apply runs that contain host steps get `runCtx = 10 min + sum(step timeouts)`, capped at 30 minutes, and each step's `deadline_ms` comes from the remaining budget. Open question 8.
- **Lanes.** The API has 3 chat run lanes, shared by every account and conversation (`chat/runner.go:84-91`), and each runs one conversation to completion, apply included (`chat/runner.go:98-180`). Three 30-minute host applies would stall every other chat, phone included. So host applies get their own lane: a conversation whose approved plan contains host steps is queued with `lane = 'host'` (new column, set by approve and Retry, cleared when the apply ends); the 3 general lanes claim `lane = ''` only, and one dedicated host lane claims `lane = 'host'` only. One host apply runs at a time per API; others wait in `queued`, and the card says "Waiting for another host step to finish". The continuation plan run after a host apply goes back to the general lanes. The ADR states this limit. An asynchronous design (release the lane after `started`, adopt through `GET /calls` on a later claim) was considered and rejected for now: it needs a new run status and a larger TLA+ change.

### 4.9 Prompt, continuation and triage

- **Prompt.** The base instruction says to decline writing code and that the model "cannot export files or run code" (`chat/runner.go:29, 43, 46`); the CLI protocol says "You have no shell, file, or code tools" (`provider/cli.go:29, 178`). Add a constant block `hostToolsOn` (like `webSearchOn`) used only when the account has host tools: it replaces those lines, says host actions are proposals the person approves, and that their output arrives on the next turn.
- **Continuation.** Today the model sees apply results only when the person writes again (`chat/runner.go:1047-1079`). Use the existing `remaining` continuation (`chat/runner.go:358-361`; up to 10 batches near `chat/runner.go:1170`): after an apply that contained host steps, always continue into a plan run, with step results capped, at most 5 host continuations in a row (4.7). Each new host step still needs approval, and its card shows what outside data preceded it. Without this, "run the tests and fix what fails" cannot work. Open question 6.
- **Triage.** Add an area to `chat/jev.go` `areaTools`, e.g. `"host": skills_list, skill_view` (plus `read_file`, `search_files` if they are read tools), so triage does not hide them (`chat/jev.go:65-77, 313-328`).

### 4.10 Prerequisite: move the Claude Code system prompt off argv

The Claude Code CLI provider passes the whole system prompt as one argv element (`provider/claude.go:40-41`). Linux caps one argument at 131,072 bytes; exactly 131,072 failed with "Argument list too long" *(ran)*. Today's Claude CLI system prompt is about 119 KB (instruction 11.3 KB, system 93.4 KB of which 73.2 KB are write-tool schemas, plus 24 KB of read specs) *(ran)*. Headroom is about 12 KB, before any skills index or Hermes schema (`terminal` 2.6 KB, `execute_code` 2.9 KB, `browser_exec` 3.2 KB, `skill_manage` 3.6 KB). Windows' command-line limit is 32,767 characters, so the argv path is suspect there already *(not verified on Windows)*.

**Fix (before phase 1 adds anything): write the system prompt to a temp file and pass `--system-prompt-file <path>`.**

Verified on 2026-11-08 with Claude Code 2.1.319 on the owner's machine:

- A 140 KB `--system-prompt` value fails before the CLI starts: `bash: …/claude: Argument list too long` *(ran)*. `getconf ARG_MAX` is 2 MB, but that is the total for all arguments; the kernel caps one argument at 128 KB (`MAX_ARG_STRLEN`).
- `--system-prompt-file` is not listed in `claude --help`'s flag table, but the help text names it ("`--system-prompt[-file]`"). It works with Timely's exact flag set (`-p --strict-mcp-config --setting-sources "" --no-session-persistence --disable-slash-commands --input-format stream-json --output-format stream-json --verbose --tools ""`). A system file saying "reply with exactly PINEAPPLE" returned `success 'PINEAPPLE'` *(ran)*.

Change in `provider/claude.go` `Complete`, before `args` is built:

```go
promptFile, err := os.CreateTemp(scratchDir(), "system-*.txt") // 0600, inside the 0700 timely-agent-cli dir
if err != nil {
	return chat.WireMessage{}, fmt.Errorf("Claude could not start: %w", err)
}
defer os.Remove(promptFile.Name())
_, err = promptFile.WriteString(system)
if closeErr := promptFile.Close(); err == nil {
	err = closeErr
}
if err != nil {
	return chat.WireMessage{}, fmt.Errorf("Claude could not start: %w", err)
}
```

Then in `args`, replace `"--system-prompt", system` with `"--system-prompt-file", promptFile.Name()`.

Why this fix:

- **No size limit.** The CLI reads the file itself, so the skills index and Hermes schemas can be added without a new limit.
- **Fixes Windows too.** The 32,767-character command-line limit stops mattering.
- **Same privacy as today.** `os.CreateTemp` creates the file 0600 inside `scratchDir()`, which `provider/cli.go:448-455` creates 0700. The file is deleted when `Complete` returns, including on timeout. The prompt held the same text on argv before, where any local user could read it via `/proc/<pid>/cmdline`, so the file is an improvement.
- **Same behaviour.** The transcript and images still go over stdin as stream-json. The text is still a real system prompt, so prompt caching is unchanged.
- **Alternative rejected:** putting the system text into the stdin user message would turn it into user content and change caching. Codex can send everything on stdin (`provider/codex.go:66-70`) only because `codex exec` has no separate system-prompt channel.

Tests:

1. A fake `claude` binary test (a script that records its argv and the named file's contents). It asserts that `--system-prompt` is absent, that `--system-prompt-file` points to a file whose contents equal the rendered system prompt, and that the file is gone after `Complete` returns, both on success and when the context times out.
2. A budget test that renders the largest configuration (genui + target + search + host tools + skills index) for every CLI provider. It fails if any provider puts more than 120 KB into a single argv element, so the argv path cannot come back unnoticed.

### 4.11 Worktrees

The main checkout and every worktree poll the same `agent_conversations` table unless `DB_SCHEMA` is set (`AGENTS.md`). A worktree API could claim a main-checkout conversation and run a host command against the worktree's tool host. `make dev-worktree` passes `TIMELY_TOOLS_URL` only when `DB_SCHEMA` is set, and prints why otherwise.

That alone is not enough: the Go API loads the repo-root `.env` itself and fills any variable that is not already set (`cmd/main.go:83-85`). If `TIMELY_TOOLS_URL=http://127.0.0.1:8090` were in `.env`, a worktree API would get the main checkout's tool host whatever `DB_SCHEMA` says, and could run commands in the main tool host's profiles. So:

- `TIMELY_TOOLS_URL`, `TIMELY_TOOLS_TOKEN` and `TIMELY_TOOLS_PAIR` are never read from `.env`. `.env.example` says that make and the desktop supervisor set them. The API checks whether a value came from the process environment or from `.env` (read `.env` with `godotenv.Read` and compare) and ignores the `.env` value with a warning.
- The API refuses a `TIMELY_TOOLS_URL` whose port is not `API_PORT`'s pair (8080↔8090, 8081↔8091, 48080↔48082, 48090↔48092) unless `TIMELY_TOOLS_ALLOW_ANY_PORT=1`.
- Make and the supervisor pass the same `TIMELY_TOOLS_PAIR` tag to the API and the tool host (`<checkout path>|<DB_SCHEMA or public>`). The tool host reports it on `/health` (3.2); the API sends no call when it differs.

---

## 5. Skills

### 5.1 What exists upstream

- 185 `SKILL.md` files: 44 in `skills/` (active by default), 141 in `optional-skills/` (opt-in installs) *(ran)*. On Linux the index shows 39 and 180, because 4 are macOS-only.
- 109 skills ship extra files and 51 have `scripts/`; 3.5 MB + 13 MB in 1,128 files *(ran)*.
- Every description is 60 characters or fewer; every name matches the agentskills.io pattern. Compatibility is partial: metadata nests non-string values under `metadata.hermes.*` *(ran)*.
- Licences: 176 MIT, 9 Apache-2.0 (the 7 Anthropic-adapted finance skills `3-statement-model, comps-analysis, dcf-model, excel-author, lbo-model, merger-model, pptx-author`, plus `hyperframes`, `impeccable`); 13 skill dirs carry their own LICENSE naming a third-party holder *(ran)*. (platform-sync counted 177 MIT; the difference does not matter.)
- Tool names referenced by skill bodies, by skill count: terminal 60, web_extract 31, read_file 28, write_file 25, browser_exec 21, delegate_task 21, web_search 18, vision_analyze 17, image_generate 11, search_files 11, skill_view 11, patch 10, cronjob 10, execute_code 9, clarify 8 *(ran)*.

### 5.2 Copy layout

```
apps/tools/skills/
  hermes/                      copied by make hermes-sync; never edited by hand
    skills/                    upstream skills/ minus skills/AGENTS.md and skills/index-cache/
    optional-skills/           upstream optional-skills/
    LICENSE                    upstream root LICENSE (MIT)
    NOTICE.md                  the 9 Apache-2.0 skills with author and upstream
    UPSTREAM.md                source commit, tag, what was left out
  timely/                      Timely-authored skills (hand-edited, reviewed like code)
apps/tools/hermes-assets/locales/en.yaml
```

`skills/AGENTS.md` is left out because coding agents working in the Timely repo would read it as instructions; `skills/index-cache/` holds Skills Hub index JSON, not skills. Per-skill LICENSE files are kept untouched.

### 5.3 Override rule

Two `skills.external_dirs` entries that contain the same skill name do not override each other: both are the external tier, so `skill_view` refuses ("Ambiguous skill name … refusing to guess") and the name drops out of `skills_list` *(ran)* (`hermes:agent/skill_utils.py:340-366, 402-406, 452-463`).

**Rule: the override happens at sync time.** `sync-hermes.sh` leaves out of `skills/hermes/` any upstream skill whose name or directory name exists in `skills/timely/`, and records it in `UPSTREAM.md` and the report. `make test-tool-host` fails if any name appears in two trees. After that, all three dirs can be `external_dirs` safely.

### 5.4 Pointing Hermes at them

Hermes reads skills only from: trusted project dirs > `HERMES_HOME/skills` > `skills.create_dir` > `skills.external_dirs` (`hermes:agent/skill_utils.py:399-424`). The repo's `skills/` is never read at runtime; it is only a seed for the `hermes` CLI's sync (`hermes:tools/skills_sync.py:1-7, 75-80`). Writing `skills.external_dirs` into each account's `config.yaml` works with no patching: `skills_list` returned 39 or 180 skills and `skill_view('arxiv')` resolved to the external copy *(ran)*. Also set `HERMES_BUNDLED_SKILLS` and `HERMES_OPTIONAL_SKILLS` to the copied trees (`hermes:hermes_constants.py:483-495`), so no code path looks for a missing seed.

### 5.5 What is exposed

`skills.yaml` has two lists:

**How the lists reach Hermes.** The draft's config wrote only `disabled: [deny list]` while listing `optional-skills` as an external dir, so all 141 optional skills would reach `skills_list` and `skill_view`. The generated `config.yaml` instead sets `disabled = deny ∪ (optional − allow)` (3.4). One exception: `hermes-agent` is an essential skill. `get_disabled_skill_names` subtracts it (`hermes:agent/skill_utils.py:278, 293`), so `skills_list` keeps listing it even when denied, while `skill_view` refuses it with its own check (`hermes:tools/skills_tool.py:198-215, 650-652`). The sync therefore never copies any skill in `ESSENTIAL_SKILLS` (recorded in `UPSTREAM.md`), and `test-tool-host` asserts that `skills_list` returns exactly the exposed set. Desktop staging copies only exposed skills (section 10).

**Phase 1 deliverable: a disposition table.** The sync writes `apps/tools/skills.disposition.md` (generated, committed): all 185 skills with `exposed`, `denied: <reason>` or `optional-hidden`, the flags behind it, licence and threat-scan result. The owner reviews it once to produce the phase 1 `skills.yaml`; later syncs show only the rows that changed. The example below is not the full list.

```yaml
# Bundled skills (skills/) are exposed unless denied. Optional skills are hidden unless allowed.
deny:
  apple-notes: macOS only
  apple-reminders: macOS only
  findmy: macOS only
  imessage: macOS only
  hermes-agent: Hermes internals
  hermes-agent-skill-authoring: tells the model to use hermes CLI / skill_manage patch flow
  computer-use: computer_use tool is skipped
  kanban-video-orchestrator: kanban tools are skipped
  product-price-monitor: needs cronjob_manage; Timely bots do this (section 7)
  competitor-news-monitor: needs cronjob_manage
  # …
allow:
  # optional-skills, one by one, after reading them
  humanizer: model-only
```

Excluded groups and why (the classification is a heuristic over frontmatter and tool references, *(inferred)*; the sync recomputes the flags each time):

| Group | Count | Why |
|---|---|---|
| macOS-only | 4 | `platforms` gate; desktop targets are Linux and Windows today |
| GPU/ML training and gaming (axolotl, unsloth, vllm, …) | 25 | Not a personal-assistant job; heavy deps; mostly in optional-skills |
| Hermes-internal, desktop, kanban or unsafe (hermes-agent, hermes-agent-skill-authoring, hermes-s6-container-supervision, inspecting-hermes-desktop-dom, sdlc-review, kanban-video-orchestrator, agent-merge-conflict-arbiter, property-listings, computer-use, godmode, telephony, teams-meeting-pipeline, actual-setup, mcp-oauth-remote-gateway) | 14 | Depend on skipped tools or Hermes' own runtime |
| Need `cronjob_manage` (competitor-news-monitor, product-price-monitor, rss-feeds, live-dashboard, dynamic-workflow, research-paper-writing, unbroker) | 7 | No scheduler through the tool host; Timely bots cover watching |
| Need `delegate_task` (systematic-debugging, test-driven-development, spike, simplify-code, requesting-code-review, subagent-driven-development, grill-me, …) | 14 | Agent-loop tool, refused by `handle_function_call` |
| Clarify-heavy (baoyu-*, pixel-art, anatomy, impeccable) | 6 | Need the multi-question `clarify` tool |
| Mention `hermes <subcommand>` | 28 | Would run Hermes CLI through the terminal; deny or override |

About 45 skills are model-only or read-only and are useful from phase 1 (humanizer, one-three-one-rule, decision-questionnaire, meeting-action-items, email-inbox-triage, weekly-review-planning, llm-wiki, design skills). About 70 need the approval-gated terminal or a CLI on the host (gh, himalaya, google-workspace, youtube-content) and become useful in phase 3. First candidates for Timely overrides in `skills/timely/`: `weekly-review-planning`, `meeting-action-items`, `document-to-action-items`, `email-inbox-triage`, rewritten to use Timely's task and event tools.

### 5.6 Index in the system prompt

Index size as Hermes renders it: `skills/` only 4,330 chars (~1.1k tokens); both trees 15,226 chars (~3.8-4k tokens) *(ran, 4 chars per token estimate)*.

Hermes' own `build_skills_system_prompt` also gates on `requires_toolsets`, `fallback_for_*` and platform (`hermes:agent/prompt_builder.py:1168-1187, 1233-1265`), but its header says "you MUST load it with skill_view", "fix it with skill_manage(action='patch')" and "offer to save as a skill", which contradict Timely's approval model, and it writes a snapshot into the home (`hermes:agent/prompt_builder.py:1295-1459`).

**Decision.**

- The sync writes the shipped index rows into `pytools/tools.gen.json` (`skills: [{name, category, description, requires_tools}]`), after applying `skills.yaml`, platform gates and tool requirements against the exposed tool set.
- Go renders the index with its own short header ("Skills are instructions you can read with skill_view when a request matches. Read one before following it."). Rows sorted by category then name, `- name: description`. It is appended at a fixed spot in the system prompt, before "Write tool schemas" (`chat/runner.go:376-394`), only when the account has skills on.
- Account-local skills (created by `skill_manage`) are appended as a separate, sorted "Your skills" list **inside an outside-data block**, each description capped at 120 characters, because one approved `skill_manage` create would otherwise plant persistent instructions in every later system prompt for that account. The API caches the rows per account with the tool host's `revision` (3.2), refreshes them when a `skill_manage` step completes or Settings deletes a skill, and otherwise asks `GET /skills?uid=` at most once a minute with a 2 s timeout; on timeout or error the run uses the cached rows, or the shipped index alone. `GET /skills` never spawns a worker, so a reaped worker does not slow the first message. This changes the prefix only when the account's skills change.
- **Token budget: 1.5k tokens (~6 KB) target; `make test-tool-host` fails above 2.5k tokens (~10 KB).** `skills/` minus the deny list fits; optional skills are added by allowlist with the budget in mind.

There is no "built once per conversation" store: the system prompt is rebuilt every run, and cache hits only need a byte-identical prefix (`chat/runner.go:380-390`).

### 5.7 `skill_view` side effects

`skill_view` is not purely read-only (`hermes:tools/skills_tool.py:470-524, 613-735, 758-781`): it bumps `.usage.json`, can prompt to capture secrets for `required_environment_variables`, registers env passthrough for terminal/`execute_code`, substitutes `${HERMES_SKILL_DIR}` (3 skills use it), and for a future skill with `deps:` calls `pm.ensure`. Inline shell expansion runs only when `skills.inline_shell` is true (default false, set explicitly) (`hermes:agent/skill_preprocessing.py:36-46, 142-156`). The worker disables the secret-capture callback, relies on the install block (3.1) for `deps:`, and replaces `tools.env_passthrough.register_env_passthrough` (called from `hermes:tools/skills_tool.py:492-493`, defined in `hermes:tools/env_passthrough.py:68`) with a no-op, so viewing a skill can never bring a profile `.env` key back into terminal or `execute_code` environments. Usage counters in the account home are harmless.

### 5.8 `skill_manage`

`skill_manage` creates skills in `HERMES_HOME/skills`, but edits, patches and file writes change an existing skill in place wherever it lives, including `external_dirs` (`hermes:tools/skill_manager_tool.py:212-221, 252-306, 407-431`). In dev that would rewrite git-tracked files; on desktop it would fail on the read-only bundle; and the next sync would overwrite it. Agent-created skills sit in the local tier, which outranks external dirs, so a same-named agent skill would silently shadow a shipped one.

**Decision (phase 3, `approval`):** the worker wraps `skill_manage`. `create`, `edit` and `patch` run Hermes' strict threat scan (`hermes:tools/threat_patterns.py`) over the new content and refuse on a hit; the card shows the full skill text. `create` is allowed only with a name that no shipped skill uses. `edit`, `patch`, `write_file` and `remove_file` are allowed only on the account's own skills; on a shipped skill they are refused with "Shipped skills are read-only. Create a new skill with a different name." Settings lists the account's own skills with a delete button. Copy-on-write editing of shipped skills is an open question (12).

### 5.9 Threat scan

The sync runs Hermes' own strict-scope scanner (`hermes:tools/threat_patterns.py:19-162`) over every exposed skill and lists hits in the report; a hit on an exposed skill fails `test-tool-host` until it is denied or accepted in `skills.yaml`. A Go port of the scanner is part of the agent-notes work in Track B (section 7).

---

## 6. Tool-by-tool table

All 73 tools registered at main `334f66b8` *(ran)*, plus the 3 meta-tools; phase 1 re-dumps the registry at the pin and corrects this table. "Phase" is when it becomes `read`/`approval`; everything else stays `pending` or `skip`. Extras and keys are those needed by Timely's use; core dependencies already include `browser-harness`, `firecrawl-anydoc`, Pillow and websockets.

| Tool | Toolset | `tools.yaml` | Timely authority | Keys / extras | Phase | Notes |
|---|---|---|---|---|---|---|
| `skills_list` | skills | read | Read | none | 1 | Shipped skills reviewed at sync |
| `skill_view` | skills | read | Read | none | 1 | Secret capture off (5.7); outside data only for account-local skills |
| `skill_manage` | skills | approval | Write, Reviewed | none | 3 | Wrapped: own skills only (5.8) |
| `read_file` | file | approval (read only if OQ3 says so) | Write, Reviewed, outside | none | 3 (2 if unapproved) | Confined to workspace in both modes; own task id `read:<conversation>` (3.7) |
| `search_files` | file | approval (read only if OQ3 says so) | Write, Reviewed, outside | none (ripgrep via PM store) | 3 (2 if unapproved) | Confined to workspace; path defaults to the workspace root |
| `write_file` | file | approval | Write, Reviewed, Destroys, shows `host_file_snapshot` | none | 3 | Diff on card inside the workspace only; protected-path guards stay on; read-before-write guard off (3.7) |
| `patch` | file | approval | Write, Reviewed, Destroys, shows `host_file_snapshot` | none | 3 | Same |
| `terminal` | terminal | approval | Write, Reviewed, Destroys, outside | Git Bash on Windows | 3 | Overrides: no background/notify/heartbeat/persist/pty, timeout ≤ 240 (4.8) |
| `process_manage` | terminal | pending | - | - | - | Only useful with background processes, which Timely drops |
| `execute_code` | code_execution | pending → approval | Write, Reviewed, Destroys, outside | none | 3, only after its exit test | Persistent kernel per session. Stays `pending` until a phase 3 test calls a `pending` tool from inside `execute_code` and gets a refusal (R6) |
| `browser_exec` | browser-use | pending | (Write, Reviewed, outside) | installed Chrome/Edge | 6, if ADR 0025 allows | Runs Python against the browser, which ADR 0022 forbids on signed-in pages (7.9). Dropped by Hermes unless `terminal` is enabled (`model_tools._rewrite_browser_exec`); dynamic schema pinned from manifest |
| `browser_cdp` | browser-cdp | pending | (Write, Reviewed, outside) | installed Chrome/Edge | 6, if ADR 0025 allows | Raw CDP (`Runtime.evaluate`): same ADR 0022 conflict (7.9) |
| `browser_dialog` | browser-cdp | pending | (Write, Reviewed) | installed Chrome/Edge | 6, if ADR 0025 allows | |
| `browser_vault` | browser | skip | - | - | - | Stores credentials; ADR 0022's Secure Store is the Timely answer |
| `web_search` | web | skip | Go-owned | - | - | Runner `web_search`; duplicate name; keyless vendors by default (7.1) |
| `web_extract` | web | skip | Go-owned | - | - | Go `read_page` (7.2) |
| `x_search` | x_search | skip | Go-owned | - | - | Port to Go with the account's xAI key (7.3) |
| `vision_analyze` | vision | skip | Go-owned | - | - | Go `look_at_image` (7.4); Hermes needs its own aux model, reads any host path, returns `_multimodal` |
| `video_analyze` | video | skip | - | - | - | No Timely video path; same aux-model and path problems |
| `image_generate` | image_gen | pending | - | `fal` extra, FAL_KEY | - | No chat media surface; without FAL_KEY uses Nous' managed gateway (`hermes:tools/image_generation_tool.py:59-73, 553-559`) |
| `video_generate` | video_gen | pending | - | - | - | No media surface |
| `xai_video_edit` | video_gen | pending | - | xAI key | - | No media surface |
| `xai_video_extend` | video_gen | pending | - | xAI key | - | No media surface |
| `text_to_speech` | tts | pending | - | `edge-tts` or premium extras | - | No audio surface; providers filtered out of model lists today (`provider/registry.go:145-148`) |
| `cronjob_manage` | cronjob | skip | Timely bots | - | - | Needs Hermes' gateway ticker, delivers to Hermes platforms (`hermes:tools/cronjob_tools.py:150-210`) |
| `todo_list` | todo | skip | Timely proposals and task tools (7.7) | - | - | Agent-loop tool, refused by `handle_function_call` (`hermes:model_tools.py:629, 963-964`) |
| `memory` | memory | skip | Go agent notes (Track B) | - | - | Agent-loop tool |
| `session_search` | session_search | skip | Go `semantic_search` extended to conversations (B26) | - | - | Agent-loop tool; searches Hermes' state.db |
| `delegate_task` | delegation | skip | `ask_bot`, proposal batches (7.7) | - | - | Agent-loop tool |
| `clarify` | clarify | skip | genui Choices | - | - | Needs a platform callback (`hermes:tools/clarify_tool.py:121-122`). Unrelated to Timely's `clarify_inbox_item` (ADR 0002) |
| `computer_use` | computer_use | skip | - | - | - | Desktop control of the host |
| `desktop_project` | project | skip | - | - | - | Hermes desktop app |
| `setup_beat` | onboarding | skip | - | - | - | Hermes onboarding |
| `manage_catalog` | catalog | skip | - | - | - | Hermes catalog management |
| `manage_connections` | connections | skip | - | - | - | Hermes connector management; ADR 0023 Connected services is the Timely concept |
| `discord`, `discord_admin` | discord, discord_admin | skip | - | DISCORD_BOT_TOKEN | - | Messaging platform |
| desktop_ui (11): `annotate_preview`, `close_terminal`, `desktop_preview`, `drive_preview`, `focus_pane`, `gui_tour`, `react_to_message`, `read_terminal`, `read_window_below`, `set_theme`, `show_tip` | desktop_ui | skip | - | - | - | Drive the Hermes desktop app's panes; `read_terminal`/`close_terminal` are not host-terminal tools |
| kanban (15): `kanban_attach`, `kanban_attach_url`, `kanban_attachments`, `kanban_block`, `kanban_comment`, `kanban_complete`, `kanban_create`, `kanban_heartbeat`, `kanban_link`, `kanban_list`, `kanban_request_changes`, `kanban_request_review`, `kanban_schedule`, `kanban_show`, `kanban_unblock` | kanban | skip | - | - | - | Multi-agent worker orchestration over kanban.db (`hermes:tools/kanban_tools.py:1-7`), not a personal board |
| feishu (5): `feishu_doc_read`, `feishu_drive_add_comment`, `feishu_drive_list_comment_replies`, `feishu_drive_list_comments`, `feishu_drive_reply_comment` | feishu_doc, feishu_drive | skip | - | - | - | Feishu platform |
| a2a (5): `a2a_call`, `a2a_discover`, `a2a_history`, `a2a_list`, `a2a_orchestrate` | a2a (bundled plugin) | skip | - | - | - | Plugin-sourced; agent-to-agent |
| meta: `tool_search`, `tool_describe`, `tool_call` | (synthetic) | always skip | - | - | - | Not registry entries; `tool_call` could reach any tool by name. Never assembled (`skip_tool_search_assembly=True`) |

Tool names have been stable since v0.22.0, but schema text changes in most releases *(ran)*, which is why `tools.yaml` stores a reviewed schema hash (8.4).

---

## 7. Overlaps: comparison verdicts and Go improvements (Track B)

Per decision 3, each overlap was compared. None of these needs the tool host, so they form **Track B**, which can run in parallel with phases 0-6. Effort: S ≈ a day, M ≈ a few days, L ≈ a week or more *(inferred)*.

### 7.1 Web search

**Verdict: keep Go `web_search`; port Hermes' backends, cache, contract and wrapping.**

- Timely: a runner tool that makes a nested call to the run's own provider with search on (`chat/runner.go:365-368, 532-561`), capped at 6 searches and 2 failures (`chat/runner.go:58-63`), off in Sensitive chats and answer-only turns, refused on OpenRouter with private images (`chat/provider.go:368-370`). Only Anthropic, OpenRouter, Claude Code and Codex can search; Compat, Responses and Ollama refuse (`provider/compat.go:30-37`, `provider/responses.go:27-31`, `provider/ollama.go:47-51`; ADR 0009 lines 48-49). So 10 of 13 providers have no search.
- Hermes: calls search vendors directly and returns raw rows `{title, url, description, position}` (`hermes:tools/web_tools.py:302-347, 515-535`), a 20-minute memo with single-flight (`hermes:tools/web_result_cache.py`), a one-shot annotated rescue (`hermes:tools/web_tools_rescue.py:93-121`), and untrusted wrapping in the agent loop. With no keys, it silently sends queries to keyless vendors (Keenable, Exa, Parallel, Firecrawl) *(ran: keyless Keenable timed out after 30 s)*, which breaks ADR 0009's "providers never switch silently" (lines 17-21).
- Also a hard technical reason: the runner always adds its own `web_search` spec (`chat/runner.go:366-369`) and would send two tools with one name.

| # | Change | Files | Effort |
|---|---|---|---|
| B1 | Mark `web_search` results as outside data; defang delimiter look-alikes. It is the one outside-data tool without the marker | `chat/runner.go:560`; move `outsideData` from `agent/tools_bots.go:25` to a shared file | S |
| B2 | Per-account in-memory cache with single-flight: 20-min TTL, key (userID, backend, normalized query, limit bucket), successes only, cache hits not counted against `maxSearches`. `golang.org/x/sync/singleflight` is already an indirect dependency | new `websearch/cache.go` (or `chat/search_cache.go`); `chat/runner.go:532-561` | S |
| B3 | Better contract: optional `limit` (1-10), mention `site:`, `"exact"`, `-term`, point at `read_page`; prepend today's date in the account timezone to the nested call (never location) | `chat/runner.go:367, 550` | S |
| B4 | Native search for OpenAI Responses (`tools:[{type:'web_search'}]`) and xAI via its Responses endpoint; parse `url_citation` into `WireMessage.Annotations`; `CanSearch` true | `provider/responses.go:27-31`; `provider/registry.go:205-213`; `provider/compat.go` | M |
| B5 | Provider-independent search backends (Brave, Tavily, Exa, SearXNG URL; ddgs/keyless only as explicit opt-ins), chosen in Settings → Agent, key stored encrypted like bot source keys; with a backend there is no nested LLM call. SearXNG on the owner's own host needs a client without netguard, which blocks 100.64/10 and private ranges (`internal/netguard/netguard.go:38-47`). Amend ADR 0009:48-49 | new `websearch/{websearch,brave,tavily,exa,searxng}.go`; `chat/runner.go:365-368, 532-561`; `chat/provider.go:117-121, 178-184`; key storage modeled on `bots/keys.go:57-68, 101`; migration; web Settings | L |
| B6 | One annotated failover: if a configured backend fails, retry once on native search (or the reverse) with `backend_error` in the result | `chat/runner.go:538-560`; websearch | S |

### 7.2 Page reading (replaces Hermes `web_extract`)

**Verdict: build Go `read_page` on `bots/fetch` + `bots/extract`; leave the approval-gated browser as the fallback for hostile pages.**

- Timely has no general read tool. `preview_bot` returns 600 characters (`bots/preview.go:34`, `agent/tools_bots.go:698`) and is gated by `fetchGuard`: only hosts and query strings the person typed, or URLs a bot already watches (`chat/bot_fetch.go:11, 69-86`). The fetcher is polite and private: robots.txt on every hop, 10 s per-site spacing, netguard at connect time, captcha detection, typed errors, 5 MB cap (`bots/fetch/fetch.go:189-306`, `bots/fetch/captcha.go:10-40`, `bots/fetch/errors.go:15-103`).
- Hermes never fetches itself: it sends up to 5 URLs to a scraping vendor (keyless by default), adds SSRF and secret-URL checks, a redirect re-check, 15k head+tail truncation with the full text stored in the home (`hermes:tools/web_tools_extract.py`, `hermes:tools/web_tools_truncate.py:19, 86-133`). It has no check for a vendor returning the wrong page.
- Probe *(ran)*: Timely's user agent fetched the correct Amazon product pages (`amazon.com/dp/B0D1XD1ZV3` → 200 with the right title; a messy amazon.in URL → 200; an invalid ASIN → 404). Firecrawl's final URL carried `plpRedirect=mhFallback`, so Amazon serves scrapers fallback redirects. The homepage failure the owner saw was not reproducible.

| # | Change | Files | Effort |
|---|---|---|---|
| B7 | `read_page(urls ≤ 3, focus?, offset?)`: `bots/fetch` (WantPage) plus a link-preserving `extract.TextWithLinks`; returns `{url, finalUrl, title, text, truncated, totalChars}` as outside data. Widen `fetchGuard` so URLs returned by `web_search` in this conversation are allowed exactly as returned. Read authority | new `agent/tools_web.go`; `bots/extract/text.go:46`; `chat/bot_fetch.go:19-86`; `chat/runner.go:532-561`; `cmd/agent_deps.go` | M |
| B8 | Head+tail truncation: 15k chars, ~75/25, line-snapped, footer with `totalChars` and next `offset`; clean text kept in a per-run memory map (Amazon pages give ~48 KB of text *(ran)*) | `agent/tools_web.go`; clip helper in `bots/extract` | S |
| B9 | `ErrLandedElsewhere`: the requested path is deeper than `/` but the final URL is the site root, another site, a known fallback (`plpRedirect=`), or rel=canonical points at the root. Bots treat it as a strike, not a change (today `bots/check.go:671` only compares FinalURL for ETag handling) | `bots/fetch/fetch.go:255-283`, `bots/fetch/errors.go`, `bots/fetch/captcha.go`, `bots/check.go:671` | S |
| B10 | `ErrNeedsBrowser`: under ~200 chars of text but many `<script>` tags or a `<noscript>` "enable JavaScript" notice | `bots/extract/text.go`, `bots/fetch/errors.go`, `agent/tools_web.go` | S |
| B11 | PDFs: `WantDocument` (`application/pdf`, `%PDF-` sniff), larger cap, a pure-Go PDF library (no cgo, for Electron packaging) | `bots/fetch/fetch.go:141-152, 520-560`; new `bots/extract/pdf.go`; `go.mod` | M |
| B12 | 20-min per-account cache keyed (userID, URL); hits still pass `fetchGuard` and netguard | `agent/tools_web.go` | S |
| B13 | Optional, off by default: a scraping vendor (Firecrawl or Keenable, key in Settings) used only after `ErrCaptcha`/`ErrNeedsBrowser`/`ErrLandedElsewhere`, labelled "read via <vendor>" | new `websearch/scrape.go`; Settings | M |

Policy decision: `bots/fetch` follows robots.txt even for reads the person asked for (`bots/fetch/fetch.go:200-209`), and several Amazon subpaths are disallowed. Open question 22.

### 7.3 X search

**Verdict: port `x_search` to Go.** No Timely tool exists, so decision 3 does not strictly apply, but the only dependency is the xAI key Timely already stores per account (`provider/registry.go:205-213`, `provider/apikeys.go:25-36`), and it should obey the same web-search, Sensitive and budget gates.

| # | Change | Files | Effort |
|---|---|---|---|
| B14 | Read tool offered when the account has an xAI key and the chat has web search on (not Sensitive): same request body as `hermes:tools/x_search_tool.py:213-280`, local date/handle validation (`:102-117`), two retries on 5xx/timeouts, citation parsing, the `degraded` flag (`:256`), outside data, counts against `maxSearches` | new `websearch/xsearch.go`; `chat/runner.go:365-368` or `agent/tools_web.go`; key lookup from `provider/apikeys.go` | M |

### 7.4 Image reading (replaces `vision_analyze`)

**Verdict: keep Timely's image path; add a Go `look_at_image` tool.** Timely keeps private images on the chosen provider (ZDR on OpenRouter, `chat/provider.go:130-137, 350-372`), strips metadata and orients images (`chat/imagefit.go:18-69, 138-242`), and scopes storage per account (`chat/images.go:84-129`). But the model cannot look at an image on its own (tool results are text only, `chat/runner.go:599`). Hermes' version needs its own aux vision key, reads any host path across accounts, and returns a `_multimodal` envelope Timely cannot carry.

| # | Change | Files | Effort |
|---|---|---|---|
| B15 | `look_at_image {url \| docFileId \| imageId, question, region?}`: http(s) through the netguard client, or an account-owned doc/image row (never a host path); `prepareImage`; one sensitive one-shot call on the run's completer (the `extractReceipt` pattern); text result as outside data; refuses when `!readsImages(ctx)` | new `chat/look_image.go`; reuse `chat/imagefit.go`, `bots/fetch/fetch.go:103-111, 476`, `docfile/docfile.go`; register in `cmd/agent_deps.go` | M |
| B16 | Region crop before downscale, with a scale note | `chat/imagefit.go` (before `fitWithin` at :43) | S |
| B17 | Same image at most 3 times per run | `chat/look_image.go` (run-scoped map like `target_jev.go:71`) | S |
| B18 | Accept WebP and GIF first frame, re-encoded to JPEG | `chat/images.go:68-71`, `chat/imagefit.go:37-41` | S |
| B19 | Fold the two EXIF orientation implementations into one package | `chat/imagefit.go:138-242`, `docfile/orient.go:9-80` → `internal/imageprep` | S |

### 7.5 Scheduled watching (replaces `cronjob_manage` and the price-watch skill)

**Verdict: bots are the stricter implementation; port the missing ideas from `product-price-monitor`.** Bots decide with code-first rules and use the AI judge only on what fired (ADR 0024); a failed fetch never overwrites last-good state (`bots/check.go:233-235, 362-375`). Probe *(ran)*: the real Flipkart Pixel 10 Pro (Obsidian, 256 GB) page returned 200 with JSON-LD `{price: 109999, priceCurrency: INR, availability: OutOfStock}`; Timely reads the price but ignores `OutOfStock`, so the seeded "under ₹90,000" bot (`scripts/bots.test.mjs:244-269`) could alert on an unbuyable price.

| # | Change | Files | Effort |
|---|---|---|---|
| B20 | Read offer `availability` into `Price.Availability`/`Reading.Availability`; rule kind `in_stock`; option `onlyInStock` (default true for product_price); show it in preview, list and the judge's data block | `bots/extract/price.go:18-23, 341-363`; `bots/rules.go:15-21, 73-86`; `bots/check.go:310-316`; `bots/validate.go`; `agent/tools_bots.go:99-107`; `bots/judge.go` (~341) | M |
| B21 | Variant pinning: optional `variant` that picks the matching Offer/hasVariant by sku/name/color; preview lists variants seen | `bots/extract/price.go:296-300, 327-338`; `bots/models.go`; `agent/tools_bots.go` | M |
| B22 | Drop marketplace tracking keys (Flipkart `lid, iid, ssid, srno, otracker, …`) or key product things on JSON-LD url / rel=canonical | `bots/things.go:36-60` | S |
| B23 | Give the judge a capped unified diff for page watches (first check what `buildJudgeInput` passes today; not verified) | `bots/judge.go` (341-410) | S |

General scheduled agent prompts ("every Monday summarise X") have no Timely equivalent; that would be a new feature with its own ADR, not a Hermes port. Note: ADR 0024 refers to ADR 0021, but 0021-0023 exist only on `origin/feature/bots-adr` (commit `d838a71a`).

### 7.6 Memory and past conversations

**Verdict: build both in Go (B24 new; B26 extends `semantic_search`).** Hermes' `memory` and `session_search` are agent-loop tools refused by `handle_function_call` (`hermes:model_tools.py:629, 963-964`), and `session_search` searches Hermes' state.db, which never holds Timely chats.

| # | Change | Files | Effort |
|---|---|---|---|
| B24 | Agent notes: `agent_notes` table ("about you" ≤ 1,375 runes, "notes" ≤ 2,200), edited in Settings → Agent, rendered before the cache mark; a `remember` tool with atomic add/patch/remove against the final budget; refused in Sensitive chats and after outside reads unless the person asked | migration; new `agent/tools_notes.go`; `chat/runner.go` prompt assembly; web Settings | M |
| B25 | Go port of `hermes:tools/threat_patterns.py` (162 lines; one lookahead at :103 needs an RE2 rewrite), applied to agent notes | new `internal/safety/threats.go` + tests | S |
| B26 | Extend the existing hybrid `semantic_search` (`agent/server.go:172`; keyword + embeddings over tasks, projects, docs, sheets, events) to conversations instead of adding a parallel FTS tool: index conversation titles and messages per account, never Sensitive chats (no embeddings for them, as ADR 0022 also requires), add a `kinds` filter and a read-window follow-up (`get_conversation_excerpt`). Decide whether MCP clients may see conversation hits (semantic_search is also an MCP tool); default: chat only | search indexer and migration; `agent/server.go`; `cmd/agent_deps.go` | M |

### 7.7 Questions, todo, delegation, media

- **clarify → genui Choices.** B27 (S): add `multi: true` and `other: true` to Choices (`packages/contract/src/genui.ts:82-100, 307-316`), regenerate with `make gen-genui-prompt`, cover in `make test-genui`.
- **todo_list vs Timely tasks and proposals.** Verdict: keep Timely. Hermes' `todo_list` is the agent's private scratch checklist inside one agent-loop turn, refused by `handle_function_call`; it never reaches the person. Timely already has the person-facing equivalents: task tools for real to-dos and Agent proposals with `remaining` batches for multi-step work (`chat/runner.go:36, 358-361`). Go improvement taken from it (B28, S): when a proposal is one of several batches, show the remaining batch list on the card ("Next: …"), which is what `todo_list` gives Hermes' own UI *(inferred)*.
- **delegate_task vs ask_bot.** Verdict: keep Timely. `delegate_task` spawns sub-agents with their own tool loop; `ask_bot` answers from one Bot's readings. Timely has no sub-agent loop and ADR 0009 keeps one runner loop, so nothing to port now; a general sub-agent would need its own ADR. No Go change.
- **image_generate, video_generate, xai_video_*, text_to_speech**: no Go counterpart, so decision 3 does not apply. Keep `pending` until Timely has a chat media-attachment surface (its own small ADR); keys then go in Settings.

### 7.8 Suggested Track B order

B1, B3, B2 (a day or two, immediate safety and cost wins) → B7-B10, B12 (`read_page`; the browser fallback in phase 6 depends on B10) → B20, B22 (bots availability, the Pixel case) → B4, then B5-B6 (search for the other 10 providers; ADR 0009 amendment) → B15-B19 → B24-B26 → B11, B13, B14, B21, B23, B27, B28.

### 7.9 Browser (ADR 0022)

**Verdict: undecided; ADR 0025 must settle it before phase 6.** ADR 0022 (on `origin/feature/bots-adr`, `docs/adr/0022-the-agent-signs-in-from-a-secure-store.md`) already plans a Timely-owned headless browser on the person's own Edge/Chrome (lines 5-9), says "the model never gets a way to run script in the page, because a password field is readable from script" (38-40), and makes signed-in pages GET-only with "Allow this request?" for anything else (45-49). Hermes' `browser_exec` (Python against the browser) and `browser_cdp` (raw CDP, e.g. `Runtime.evaluate`) give the model exactly that script access, and they would be a second browser stack for the same job, which decision 3 says to resolve by improving the Timely one. Options for ADR 0025:

1. **Drop `browser_exec` and `browser_cdp`; build ADR 0022's Go browser**, using Hermes' browser tools only as a reference (numbered-element page text, dialog handling). Recommended by this plan, because it follows decision 3 and ADR 0022 without carve-outs.
2. **Allow them only in a throwaway profile** that never holds Secure Store sessions or the person's real profile (`use_real_profile: false`, a fresh `--user-data-dir` per conversation, deleted on close), with CDP `Runtime`/`Network` domains refused on any site that has a saved login.

Until ADR 0025 decides, the three browser tools stay `pending` (section 6), and phase 6 is blocked.

---

## 8. The sync mechanism

### 8.1 Make targets

`make tools` already exists ("Install Go CLI tools (air, goose)", `Makefile:49, 59-65`) and the repo names test targets `test-<thing>` (`Makefile:215-218`). So no target starts with `tools`.

| Target | Does |
|---|---|
| `hermes-sync` | `scripts/sync-hermes.sh`. Variables: `HERMES_REF=<tag\|sha>` (default latest release), `HERMES_SRC=<local clone>`, `DRY_RUN=1`, `FORCE=1`, `NO_TEST=1` |
| `test-tool-host` | All checks in 8.6 |
| `gen-tool-specs` | Rebuild `pytools/tools.gen.json` (and the skills index rows in it) from `manifest.json` + `tools.yaml` + `skills.yaml`, without importing Hermes. Run after editing `tools.yaml` or `skills.yaml` (8.7) |
| `install-tool-host` | `cd apps/tools && uv sync --frozen` |
| `dev-tool-host`, `dev-worktree-tool-host` | Section 9 |

Each gets a `## description` so `make help` lists it (`Makefile:44-47`), under a new `##@ Tool host` section, and goes in `.PHONY`.

### 8.2 Resolving the ref

Hermes has two tag schemes: 36 CalVer `v2026.9.x` and 11 SemVer `v0.x.y`, plus `+canary` and `rc.*`/`abandoned-rc.*` tags. `sort -V` wrongly picks `v2026.9.24` *(ran)*. Tags are annotated, so the commit is on the peeled line. Default resolution:

1. `gh api repos/NousResearch/hermes-agent/releases/latest --jq .tag_name` (returns `v0.23.0` today *(ran)*);
2. else unauthenticated `curl` of the same endpoint;
3. else `git ls-remote --tags` filtered to `^refs/tags/v0\.[0-9]+\.[0-9]+$`, newest by version.

Then the commit from `refs/tags/<tag>^{}` (or `git rev-parse <tag>^{commit}`). A 40-hex SHA is accepted as is. The scheduled Action tracks the latest release, never `main` (main moves ~400 commits a day; 808-5,518 commits between releases *(ran)*).

### 8.3 `scripts/sync-hermes.sh` steps

Conventions from `scripts/sync-pstack.sh:1-50`: `set -euo pipefail`, `REPO_ROOT`, temp dir with `trap`, `UPSTREAM.md`, a final echo.

0. Parse `HERMES_REF`, `HERMES_SRC`, `DRY_RUN`, `FORCE`, `NO_TEST`, `FORCE_UNSANDBOXED`. Require `git`, `uv` (≥ 0.13.6), `curl`, `python3`, and `bwrap` (or a container runtime). Refuse if `git status --porcelain apps/tools apps/api/internal/features/pytools` is dirty, unless `FORCE=1`.
   **Sandbox (required).** Every step that executes upstream code (the `hermes-agent` build backend during `uv lock`/`uv sync`, the manifest import, the threat scan, the contract tests that spawn real shells) runs under `bwrap` with a fake `HOME` and a tmpfs over `~/.hermes`, the repo `.env`, `~/.ssh`, `~/.config` and `apps/api/data`, the repo bind-mounted read-only except `$tmp/work`, and network limited to what uv needs (PyPI and GitHub; enforced by running uv steps with a proxy allowlist, and the import/test steps with `--unshare-net`). The script refuses to run without a sandbox unless `FORCE_UNSANDBOXED=1`. CI (8.8) is the default place a sync runs; local runs are for `DRY_RUN` and for testing the script.
1. Resolve the ref to `{tag, commit}` (8.2). Refuse a release published less than 3 days ago (GitHub release `published_at`), unless `FORCE=1`. uv's `exclude-newer` quarantines PyPI packages, not the Hermes pin itself.
2. Copy `apps/tools` and `pytools/tools.gen.json` into `$tmp/work`. Every later write happens there.
3. Get the source at that commit with `git archive`, never a working tree:
   - with `HERMES_SRC`: `git -C "$HERMES_SRC" rev-parse --verify "$REF^{commit}"` and `git -C "$HERMES_SRC" archive "$SHA"`. Never `fetch`, `checkout` or `stash` there (the owner's clone may be dirty and its refs must not change);
   - without: `git init` a temp dir, `git fetch --depth 1 https://github.com/NousResearch/hermes-agent.git "$SHA"`, `git archive FETCH_HEAD`.
4. If `hermes.lock.json` already has this commit and the same tree hashes, print "already at <tag> (<sha7>)" and exit 0, unless `FORCE=1`. (Regenerating specs after a `tools.yaml` edit does not need a sync: `make gen-tool-specs`.)
5. **Install-path guards.** Hash the `setup.py` guard block and the upstream `[tool.uv]` table. If the guard changed (e.g. the variable renamed), stop with a pointer to `setup.py`. If upstream `requires-python` no longer admits 3.14, stop.
6. Read upstream `[tool.uv]` with `tomllib`; run `uv export --frozen --no-dev --no-emit-project --no-hashes --all-extras` in the archived source; rewrite the `# BEGIN hermes-sync` block of `pyproject.toml` (3.1).
7. Set the pin to `git+https://github.com/NousResearch/hermes-agent@$SHA`. If the commit is not on GitHub (`git ls-remote` or `gh api …/commits/$SHA` → 404), use `git+file://$HERMES_SRC` with a loud warning; `test-tool-host` and CI reject `file://` pins, so such a sync cannot be merged.
8. `uv lock`, then `uv sync --frozen`, in `$tmp/work`, in the sandbox. A failed lock stops the sync with uv's message in the report (this step is covered by `test-tool-host` #7 and by the phase 1 check in 3.1).
9. Skills: replace `skills/hermes/{skills,optional-skills}` from the archive, excluding `skills/AGENTS.md`, `skills/index-cache/`, and any skill whose name exists in `skills/timely/` (5.3). Copy `LICENSE`; regenerate `NOTICE.md` from frontmatter; write `UPSTREAM.md`: "Copied verbatim from https://github.com/NousResearch/hermes-agent/tree/$SHA (Hermes $TAG, MIT, see LICENSE; some skills carry their own Apache-2.0 LICENSE). Update with `make hermes-sync`; never edit by hand. Left out: …". Copy `locales/en.yaml` to `hermes-assets/locales/`.
10. Generate `manifest.json` with `env -i PATH=$PATH HOME=$tmp/home HERMES_HOME=$tmp/hermes-home uv run --frozen python -I -m timely_tools.manifest`, in the sandbox: no developer keys, never `~/.hermes`, sorted keys, no timestamps. (`-I` works because `timely_tools` is installed into the venv, 3.1.)
11. Append each new manifest tool to `tools.yaml` as `pending` with a comment; auto-add newly flagged skills (macOS-only, `hermes` CLI, needs a skipped tool) to `skills.yaml` `deny` with the flag as the reason.
12. Run the skills threat scan (5.9).
13. Generate `apps/api/internal/features/pytools/tools.gen.json` from manifest + `tools.yaml` + overrides + skills index (4.2, 5.6), with the same code as `make gen-tool-specs`. Regenerate `skills.disposition.md` (5.5).
14. Diff old vs new manifest and `uv export` lists; write `apps/tools/.sync/SYNC_REPORT.md` (8.5).
15. Unless `NO_TEST=1`, run `make test-tool-host` against `$tmp/work`.
16. Only when every step succeeded, copy changed files back (with `DRY_RUN=1`, print the report and copy nothing). A failure anywhere leaves the repo untouched. Print the report path.

### 8.4 File formats

**`apps/tools/hermes.lock.json`** (deterministic; `syncedAt` is the only clock field):

```json
{
  "repo": "https://github.com/NousResearch/hermes-agent",
  "ref": "v0.23.0",
  "commit": "2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19",
  "tagObject": "df1774294af26285ae758c6114f3f2f60e2a602d",
  "committedAt": "2026-11-05T11:57:38-08:00",
  "syncedAt": "2026-11-08T10:00:00Z",
  "uvVersion": "0.13.6",
  "trees": {
    "skills": "<git rev-parse SHA:skills>",
    "optional-skills": "<tree sha>",
    "locales/en.yaml": "<blob sha>"
  },
  "upstream": {
    "pyprojectSha256": "…",
    "uvLockSha256": "…",
    "setupGuardSha256": "…",
    "requiresPython": ">=3.11,<3.15",
    "uvOverrides": ["pynacl>=1.6,<1.7", "cryptography==50.0.2", "Pillow==13.0.0"]
  }
}
```

**`apps/tools/manifest.json`** (generated from `registry.get_all_entries()` / `ToolEntry`, `hermes:tools/registry.py:214-233`):

```json
{
  "hermes": {"tag": "v0.23.0", "commit": "2bd378ed…"},
  "tools": [
    {"name": "terminal", "toolset": "terminal", "source": "core",
     "schema_sha256": "3f2a…", "description_chars": 2410,
     "description": "Execute shell commands on …", "parameters": {"type": "object", "…": "…"},
     "requires_env": [], "has_check_fn": true, "is_async": false,
     "max_result_size_chars": null, "dynamic_schema": false, "execution_timeout": null},
    {"name": "a2a_call", "toolset": "a2a", "source": "plugin:hermes_plugins.a2a", "…": "…"}
  ],
  "meta_tools": ["tool_search", "tool_describe", "tool_call"],
  "skills": [
    {"name": "arxiv", "tree": "skills", "path": "research/arxiv", "category": "research",
     "license": "MIT", "author": "…", "platforms": ["linux", "macos", "windows"],
     "sha256": "<over sorted file list and contents of the whole dir>",
     "requires_toolsets": [], "prerequisites_commands": [], "required_env": [],
     "flags": {"hermes_cli": false, "hermes_home_paths": false, "tools_used": ["web_search", "web_extract"]}}
  ]
}
```

`schema_sha256` is the full 64-hex sha256 of `json.dumps(schema, sort_keys=True)`. The manifest stores each tool's full upstream `description` and `parameters` (as Hermes registers them, before Timely's overrides), so `make gen-tool-specs` can build `tools.gen.json` and the review diff can show schema text, not just a hash. The sample at `/tmp/claude-1000/-home-thalhath-Dev-timely-app/aaec29ed-c10f-408c-8aa5-b417a2f93d36/scratchpad/devtooling-sync/manifest.json` (generator probe `manifest_probe.py` beside it) is an early probe, not this format: a bare list of `{name, toolset, schema_sha256 (16 hex), requires_env, has_check_fn, module}` with no skills.

**`apps/tools/tools.yaml`** (hand-edited, one entry per manifest tool):

```yaml
# authority: read | approval | pending | skip
# reviewed: schema_sha256 the owner last reviewed (required for read and approval)
skill_view:
  authority: read
  reviewed: 9c1e…
terminal:
  authority: approval
  destroys: true
  outside: true
  reviewed: 3f2a…
  overrides:
    drop: [background, notify, heartbeat, persist_on_release, pty]
    max: {timeout: 240}
write_file:
  authority: approval
  destroys: true
  shows: host_file_snapshot
  reviewed: 77ab…
web_search:
  authority: skip
  go: web_search            # Go owns this job (decision 3); see plan section 7.1
memory:
  authority: skip
  reason: agent-loop tool; handle_function_call refuses it
kanban_schedule:
  authority: pending        # added by hermes-sync v0.23.0
```

**`apps/tools/skills.yaml`**: section 5.5.

### 8.5 `SYNC_REPORT.md` format

```markdown
# Hermes v0.22.7 (a1b2c3d) → v0.23.0 (2bd378e)
Compare: https://github.com/NousResearch/hermes-agent/compare/a1b2c3d...2bd378e

## Tools added (landed as pending)
| Tool | Toolset | Source | requires_env |

## Tools removed (still in tools.yaml: delete the entry)

## Tool schemas changed
| Tool | Authority | Note |   ← read/approval rows are marked REVIEW: test-tool-host fails until `reviewed` is updated

## Skills
- Added (exposed by default / hidden: optional / auto-denied: <flag>)
- Removed
- Changed (scripts changed are listed separately)
- Apache-2.0 skills changed
- Threat-scan hits

## Dependencies
| Package | Old | New |
- override-dependencies changes
- requires-python change
- Config defaults: diff of the telemetry and web sections of hermes_cli/config_defaults.py

## Next steps
- [ ] Decide authority for each pending tool (check section 7 overlaps first)
- [ ] Review changed schemas in pytools/tools.gen.json; bump `reviewed`
- [ ] Delete removed tools from tools.yaml
- [ ] Check new skills; deny or override
- [ ] make test-tool-host && make test-api
```

The report is git-ignored (`apps/tools/.sync/`): committing it would change on every sync and repeat the PR body. The Action uses it as `--body-file`. Committed: `hermes.lock.json`, `manifest.json`, `pyproject.toml`, `uv.lock`, `tools.yaml`, `skills.yaml`, skills trees, `UPSTREAM.md`, `NOTICE.md`, locales, `pytools/tools.gen.json`.

### 8.6 `make test-tool-host` checks

Runs in a temp `HERMES_HOME` and fake `HOME`, inside the required sandbox of 8.3 step 0 (bubblewrap with `~/.hermes`, the repo `.env`, `~/.ssh` and `apps/api/data` masked; refuses to run unsandboxed unless `FORCE_UNSANDBOXED=1`).

Coverage and policy:

1. Every manifest tool is in `tools.yaml`; no `tools.yaml` entry is missing from the manifest; every authority value is valid.
2. Every `read`/`approval` tool's `reviewed` matches its current `schema_sha256`.
3. Agent-loop tools (`todo_list`, `memory`, `session_search`, `delegate_task`), `clarify`, `cronjob_manage`, desktop_ui, kanban, a2a, meta-tools and every plugin-sourced tool are `skip`/`pending`.
4. No reserved name (4.5) is `read`/`approval`.
5. `pytools/tools.gen.json` matches a fresh generation; `read` schemas use only allowed keywords (4.4).
6. Skills: no name in two trees; every `skills.yaml` name exists; no `ESSENTIAL_SKILLS` member copied; `skills_list` in a worker returns exactly the exposed set; rendered index ≤ 2.5k tokens; platform gates honoured for desktop targets; no unaccepted threat-scan hit on an exposed skill; `skills.disposition.md` matches a fresh generation.
7. Lock: no `git+file://` pin; installed versions equal upstream `uv.lock` for every shared package.

Hermes internals contract (these break quietly on upstream refactors; Hermes' own AGENTS.md says internal paths are not API):

8. `HERMES_SESSION_KEY` isolation: the `export FOO=bar` leak test across two conversation ids.
9. Two account homes: secrets and skills isolated.
10. Hardline floor blocks `mkfs`; `approvals.deny` blocks.
11. Cleanup (3.5) leaves no child processes.
12. Helpers still exist: `terminal_tool_lifecycle.cleanup_vm`, `terminal_tool._resolve_container_task_id`, `approval.clear_session`, `gateway.session_context.scoped_session_key`, `browser_session_lifecycle.cleanup_browser`, `file_tools.clear_file_ops_cache`, `approval_detection.detect_hardline_command`/`detect_dangerous_command`, the `ToolEntry` fields.
13. Each config key in 3.4 takes effect (telemetry off, keyless off, curator off, tool_search off, `mcp_servers` empty, no user plugin loaded, browser not in a cloud or real-profile mode). The front rewrites a tampered `config.yaml` (an added `mcp_servers` entry, an enabled plugin, an emptied `approvals.deny`, `skills.inline_shell: true`) before the next spawn; a non-empty `<profile>/plugins` blocks the spawn; a registry with a tool not in the manifest refuses calls.
14. Calling each exposed tool's `check_fn`, and `skill_view` on a skill with `deps:`, attempts no `pm` install; nothing is written under the fake `HOME`.
16. Protocol survives stdout: a terminal call whose command prints to stdout, and a forced `get_tool_definitions(quiet_mode=False)` banner, leave the fd 3/4 JSON-lines channel intact.
17. File guard: in a fresh worker, an approved-path `write_file` to an existing file succeeds without a prior `read_file` (`HERMES_DISABLE_FILE_STATE_GUARD=1`), while `~/.ssh/authorized_keys` and `<home>/config.yaml` are still refused.
18. Cancel: `POST /calls/{key}/cancel` on `sleep 60` leaves no process from that call (checked by pgid), and the stored state is `cancelled`; dropping the HTTP request without a cancel lets the call finish and `GET /calls` returns `done`.
19. Read confinement after an approved `cd /` in the same conversation: `read_file("etc/passwd")`, `read_file("~/.bashrc")` and `search_files(".")` are refused or rewritten into the workspace; symlink and `..` escapes are refused.
20. `/files/snapshot` returns no `text` for a path outside the workspace or under Hermes' read denylist.
21. No outbound traffic: a worker started in a network namespace (`unshare -n`, with an egress log) runs `skills_list`, `skill_view`, `read_file` and a terminal `true` with zero outbound connection attempts.
22. Worker env: exactly the allowlist of 3.6; skill env passthrough is a no-op after `skill_view` of a skill with `required_environment_variables`.

HTTP contract:

15. Missing or wrong token → 401; wrong `Host` → 421; any `Origin` → 403; a uid that is not a UUID → 400; a uid that is not host-allowed → 403 `not_allowed` and no worker spawned; `pending` tool → `not_exposed`; repeated `call_key` returns the stored result without re-running; a new attempt key runs again; workspace confinement for `read_file`.

Go side (in `make test-api`): `pytools` spec parsing, collision test, policy test for `approval` specs, host-gate policy test (4.2), MCP server serves no host tool and no `host_file_snapshot`, agent catalog tests derived from `pytools.Specs()`, the 4.6 integration tests, `.env`-sourced `TIMELY_TOOLS_URL` ignored and port-pair check (4.11).

### 8.7 The owner's update workflow

1. Run `make hermes-sync` (or open the weekly PR).
2. Read `apps/tools/.sync/SYNC_REPORT.md`.
3. **New tool** (landed `pending`): check section 7 and `agent.NewCatalog` for an existing Go tool doing the job (decision 3). If Go owns it, set `skip` with `go:`. If not, decide `read` or `approval`, set `reviewed`, add `destroys`/`shows`/`outside`/`overrides`, and, for `approval`, make sure the `host` review card renders its arguments well. Add it to `chat/jev.go` areas if it is a read tool. Then `make gen-tool-specs`.
4. **Changed schema** on an exposed tool: read the diff in `manifest.json` and `pytools/tools.gen.json`, then bump `reviewed` and run `make gen-tool-specs`.
5. **Removed tool**: delete its `tools.yaml` entry.
6. **New skill**: bundled ones are exposed unless auto-denied; read them, deny or write a Timely override. Optional ones stay hidden unless you add them to `allow`.
7. **Dependencies**: skim the table; anything with a major bump or a new native wheel needs a desktop staging run (section 10).
8. `make test-tool-host && make test-api`, then the verify-timely run from section 12.
9. Commit and open the PR. Never auto-merge.

### 8.8 Optional scheduled Action

`.github/workflows/hermes-sync.yml`:

- `on: schedule: [{cron: '17 6 * * 1'}]` and `workflow_dispatch` with input `ref`. Top-level `permissions: contents: read`. Actions pinned by full SHA with a `# vN` comment, like `ci.yml`.
- Job `sync` (read-only): checkout with `persist-credentials: false`; `astral-sh/setup-uv` with cache keyed on `apps/tools/uv.lock`; `uv python install 3.14`; `make hermes-sync HERMES_REF=${{ inputs.ref }}`; `make test-tool-host`; upload the patch and `SYNC_REPORT.md` as artifacts. This job runs untrusted upstream code and has no write token, following release.yml's split between write jobs and untrusted installs (`.github/workflows/release.yml:176-191`).
- Job `open-pr` (`needs: sync`; `contents: write`, `pull-requests: write`; never runs uv): **checks the patch before applying it.** The patch came from a job that ran upstream code, and `ci.yml` runs on `pull_request` (`.github/workflows/ci.yml:6-8`) in a same-repo branch, where a modified workflow could reach secrets (`release.yml:105-106, 147-150` define signing keys). So `open-pr` parses the patch (`git apply --numstat --summary`) and fails unless every path is under an allowlist: `apps/tools/**` (except any `Makefile`, `.github/` directory or `AGENTS.md`), plus `apps/api/internal/features/pytools/tools.gen.json`. It also fails on symlinks, mode changes, renames out of the allowlist, binary patches outside `apps/tools/skills/hermes/**`, and any path under `.github/`. Then it applies the patch to the fixed branch `bot/hermes-sync`, force-pushes, and runs `gh pr create --base dev --body-file SYNC_REPORT.md` or `gh pr edit` if the PR exists. Never `gh pr merge` or `--auto`.
- PRs opened with `GITHUB_TOKEN` do not trigger `pull_request` workflows, so `ci.yml` will not run on them. Either use a fine-grained PAT or GitHub App token secret (`HERMES_SYNC_TOKEN`) scoped to this repo with **contents and pull-requests only, never workflows** (GitHub refuses pushes that touch `.github/workflows` without that scope, a second barrier), or push a commit to the branch yourself. The repo setting "Allow GitHub Actions to create and approve pull requests" must be on. Open question 19.
- The sync job refuses a release published less than 3 days ago (8.3 step 1).

`ci.yml` gains a `tool-host` job: checkout, setup-uv (pinned), `uv python install 3.14`, `make test-tool-host`, and a check that `apps/tools/uv.lock` has no `git+file` pin.

---

## 9. Dev setup

### 9.1 Ports and env vars

| Process | Main checkout | Worktree | Desktop release / local build |
|---|---|---|---|
| Go API | 8080 | 8081 | 48080 / 48090 |
| Web | 4001 | 4002 | 44001 / 44011 |
| Tool host | 8090 | 8091 | 48082 / 48092 |

8090/8091 appear nowhere in the repo and were free *(ran)*. Worktree rule in `AGENTS.md` extends to "tool host on 8091; never touch 8090".

API side (tools are off unless URL and token are set; never default the URL; none of these are read from `.env`, 4.11):

- `TIMELY_TOOLS_URL` (e.g. `http://127.0.0.1:8090`; must be `API_PORT`'s pair)
- `TIMELY_TOOLS_TOKEN_FILE` (path to the token; preferred) or `TIMELY_TOOLS_TOKEN`
- `TIMELY_TOOLS_PAIR` (pairing tag, 4.11)
- `TIMELY_TOOLS_ACCOUNTS` (host-allowed uids, 4.2; desktop sets it from Settings → Server)

Tool host side: `TIMELY_TOOLS_PORT`, `TIMELY_TOOLS_TOKEN_FILE` (or `TIMELY_TOOLS_TOKEN`), `TIMELY_TOOLS_HOME`, `TIMELY_TOOLS_PAIR`, `TIMELY_TOOLS_ACCOUNTS` (optional), `TIMELY_LIFELINE=stdin` (desktop). The tool host sets `HERMES_HOME`, `HERMES_RUNTIME_DIR`, `HERMES_BUNDLED_SKILLS`, `HERMES_OPTIONAL_SKILLS`, `HERMES_BUNDLED_LOCALES` for itself and its workers.

The `TIMELY_` prefix means `provider/cli.go:376` already strips these from agent CLI environments. `.env.example` gets a `---- Tool host (apps/tools) ----` note that says these are set by make and the desktop supervisor and are ignored in `.env` (4.11); only `TIMELY_TOOLS_ACCOUNTS` may be set there for a server install. These are infrastructure values; per-account choices (keys, deny globs) live in Settings (section 11), and host-wide ones in desktop Settings → Server.

### 9.2 Makefile

The Makefile loads `.env` with `-include .env` and does not export it (`Makefile:20`), so recipe processes do not see `.env` values unless passed on the command line; the Go API loads `.env` itself without overriding set variables (`cmd/main.go:85`).

```make
##@ Tool host
TOOL_HOST := apps/tools
TOOL_HOST_TOKEN_FILE := $(CURDIR)/$(API)/data/tool-host-token
$(TOOL_HOST_TOKEN_FILE):
	@umask 077; mkdir -p $(dir $@); openssl rand -hex 32 > $@

install-tool-host: ## Install the Hermes tool host (uv sync --frozen)
dev-tool-host: $(TOOL_HOST_TOKEN_FILE) ## Run the Hermes tool host on :8090 (needs uv)
	@command -v uv >/dev/null || { echo "uv not found: Hermes tools are off"; exit 0; }
	cd $(TOOL_HOST) && TIMELY_TOOLS_PORT=8090 TIMELY_TOOLS_TOKEN_FILE=$(TOOL_HOST_TOKEN_FILE) \
	  TIMELY_TOOLS_HOME=$(CURDIR)/$(API)/data/hermes TIMELY_TOOLS_PAIR='$(CURDIR)|public' \
	  uv run --frozen python -I -m timely_tools --reload-dir timely_tools
dev-worktree-tool-host: ## Run the tool host on :8091 for a worktree (needs DB_SCHEMA)
test-tool-host: ## Check tools.yaml, skills.yaml, generated specs and the HTTP contract
hermes-sync: ## Re-pin Hermes and re-copy its skills (HERMES_REF, HERMES_SRC, DRY_RUN=1)
```

Changes to existing targets:

- `dev` becomes `-j3` with `dev-tool-host` (`Makefile:69-76`); `dev-api` adds `TIMELY_TOOLS_URL=http://127.0.0.1:8090 TIMELY_TOOLS_TOKEN_FILE=$(TOOL_HOST_TOKEN_FILE) TIMELY_TOOLS_PAIR='$(CURDIR)|public'`. The token itself never appears in a recipe's argv (readable by other local users via `/proc`); both processes read the file (mode 0600).
- `dev-worktree` becomes `-j3` (`Makefile:90-97`), passing `:8091` and `TIMELY_TOOLS_PAIR='$(CURDIR)|$(DB_SCHEMA)'` only when `DB_SCHEMA` is set (4.11).
- `dev-desktop` becomes `-j4` (`Makefile:142-147`); `stage-desktop` adds `node $(WEB)/electron/stage-tools.mjs` (`Makefile:166-174`); `clean` removes `$(WEB)/.electron-tools`; `install` runs a uv-guarded `install-tool-host`.
- `.gitignore`: `apps/api/data/hermes/`, `apps/api/data/tool-host-token`, `apps/tools/.sync/`, `apps/web/.electron-tools/`, `apps/web/.cache/python/`. Today only `apps/api/data/backups/` is ignored (`.gitignore:38`).

`dev-tool-host` prints a notice and exits 0 when uv is missing, so `make dev` keeps working on a machine without uv. Uvicorn reload is limited to `timely_tools/`, so skill churn does not restart it. FastAPI and uvicorn are already Hermes core dependencies.

### 9.3 Repo docs and layout

```
apps/tools/
  AGENTS.md            never edit skills/hermes or the generated pyproject block; always set HERMES_HOME; run through make
  pyproject.toml  .python-version (3.14)  uv.lock
  hermes.lock.json  manifest.json  tools.yaml  skills.yaml
  timely_tools/  __main__.py  front.py  worker.py  scope.py  manifest.py  generate.py  sync_report.py  lifeline.py
  tests/
  skills/{hermes,timely}/   hermes-assets/locales/en.yaml   .sync/ (git-ignored)
```

`pnpm-workspace.yaml` lists apps explicitly, so pnpm ignores `apps/tools`. Add the `apps/tools` row to the root `AGENTS.md` table, a line saying that generated secret files under `apps/api/data` (the tool host token) are git-ignored and are not a second `.env`, the "tool host on 8091; never touch 8090" worktree rule, and update `.agents/skills/verify-timely` to optionally start `dev-worktree-tool-host` on 8091.

### 9.4 docker-compose

`docker-compose.yml` is the server install (db, api on 8080, web on 4001). Not in phases 1-5. Later: an opt-in `profiles: [tools]` service with `TIMELY_TOOLS_URL=http://tools:8090`, no published port. Terminal and file tools would then run inside that container, not on the host, which changes what decision 2 means for server installs. Open question 20.

---

## 10. Desktop packaging (phase 5)

Today the Electron supervisor runs exactly three sidecars, boots postgres → api → web, and any failure is a fatal `BootError` (`apps/web/electron/supervisor/index.ts:57, 163-186, 229-339`).

**Python runtime.** A uv venv cannot be moved: `bin/python` is an absolute symlink and `pyvenv.cfg` holds an absolute `home` *(ran)*, the same trap as the v0.1.1 absolute-symlink failure. Ship a python-build-standalone prefix instead. Verified *(ran)*: install locked deps into the prefix's own site-packages with `HERMES_NIX_BUILD=1 uv pip install --python <prefix>/bin/python3 --break-system-packages --no-deps -r <uv export>`, run `compileall`, move the tree, make it read-only, and `python -I -c 'import model_tools'` still works in 1.33 s. Untrimmed size 439 MB, relative symlinks only.

**Staging (`apps/web/electron/stage-tools.mjs`, new):**

1. `targets.mjs` gains `PYTHON_VERSION` and per-target `install_only_stripped` URL + sha256 (x86_64-unknown-linux-gnu, x86_64-pc-windows-msvc, aarch64/x86_64-apple-darwin), mirroring the Postgres entries.
2. Download and verify into `.cache/python`; extract to `.electron-tools/<os-arch>/python`; delete `include/`, `test/`, `idlelib/`, `tkinter/`, `turtledemo/`, `ensurepip/`, `share/`.
3. `uv export --frozen --no-emit-project` in `apps/tools`, then the install above. Copy `timely_tools` into site-packages so `python -I -m timely_tools` works.
4. Copy to `.electron-tools/<os-arch>/app`: exposed skills only (not all 16.5 MB), `hermes-assets/`, `tools.yaml`, `skills.yaml`, `manifest.json`.
5. `python -I -m compileall -q -j0` over the whole prefix (AppImage and `/opt` installs are read-only, and a cold import costs 4-10 s).
6. Write `THIRD_PARTY_LICENSES` from dist-info files, plus Hermes' MIT notice and `NOTICE.md`; show them in the desktop About/licences screen.
7. Fail on any absolute symlink, on any path longer than ~150 characters relative to `resources/` (Windows MAX_PATH; the longest site-packages file is already 134 characters), and when the target OS differs from the host OS (`make dist-desktop TIMELY_TARGETS=…` cross-builds Go but cannot cross-build a Python prefix). Use a `copyTree` with a filter (the Windows `cpSync` abort, `electron/stage-next.mjs:20-26`).

**Builder and scripts.** `electron-builder.yml` and `electron-builder.local.yml`: `- from: .electron-tools/${os}-${arch}` / `to: tools`, and `"!.electron-tools/**"` in `files`. `pack.mjs` calls `stageTools` after `stagePostgres` (`apps/web/electron/pack.mjs:65-102`). `hosted.mjs` symlinks the tools dir, but a missing stage means "tools off", not exit 1.

**Supervisor.**

- `paths.ts`: `ResourceDirs.tools` (packaged `<resources>/tools`, `TIMELY_RESOURCES_DIR/tools`, staged `.electron-tools/<os-arch>`) (`supervisor/paths.ts:306-340`).
- New `supervisor/tools.ts` `ToolHostManager`: launch with `withDeathSignal(python, ['-I','-m','timely_tools'], 'TERM', setpriv)`; environment built from scratch (login-shell `PATH`/`HOME` from `resolveShellEnv`, the vars in 9.1, nothing from `ELECTRON_*`, no JWT/DB/backup secrets); ready = `waitForHttp('/health')`; shutdown = SIGTERM, 10 s grace while the front kills its workers' process trees, then SIGKILL; on Windows `taskkill /pid /t /f`.
- `index.ts`: a 4th sidecar `tools`, booted **after web and non-fatal**: a failure sets its state to crashed, logs it, shows it in Settings → Server, never throws `BootError` and never delays the window. `apiEnv` passes `TIMELY_TOOLS_URL` and `TIMELY_TOOLS_TOKEN`. Shutdown web → tools → api → postgres (15 s cap today). `killAllNow` covers it. `getInstance` exposes `tools` state; add a `restartTools` action.
- `config.ts`: `toolsPort` (release 48082, local 48092), `isPort`, `reconcilePorts` settle (`supervisor/config.ts:165-188`, `supervisor/ports.ts:409-450`); `toolsAccounts` (host-allowed uids), `toolsReadableFolders`, `toolsRealHome`, `toolsBrowserPath` (host-level settings, 4.2 and 11), changeable only from the desktop window over IPC, never over HTTP. `apiEnv` and the tool host env carry `TIMELY_TOOLS_ACCOUNTS` and `TIMELY_TOOLS_PAIR`.
- `lifetime.ts`: `OrphanKind` `'tools'` (exe realpath under the resources tools dir and `TIMELY_TOOLS_HOME` equal to ours) (`supervisor/lifetime.ts:29-117`).
- `electron-env.d.ts`: `DesktopInstance.tools`.
- Tests in `scripts/electron-supervisor.test.mjs`; update `docs/desktop/README.md` (layout, boot order, env table).

**Token.** An ephemeral per-boot token (`crypto.randomBytes(32)`) held in supervisor memory, reused across API restarts. No `SecretKey` change, since both processes are recreated every launch. If the owner wants it persisted, add `toolsToken` to `SecretKey`/`SECRET_KEYS` and `ensureSecrets` creates it on upgrade (`supervisor/config.ts:8-15`). Open question 16.

**Browser.** Only relevant if ADR 0025 keeps Hermes' browser tools at all (7.9). ADR 0022 on `feature/bots-adr` says the browser is the person's own Edge, Chrome or Chromium and Timely never bundles one. Hermes would otherwise auto-download Chrome for Testing 145 (~170 MB) from `cdn.playwright.dev` on first use (`hermes:tools/browser_launcher.py:133-185`, `hermes:pm/lock.json`), which also fails offline. **Recommendation: follow ADR 0022.** Set `browser.executable_path` per account to a detected Chrome/Edge (editable in Settings), and treat "no browser found" as `available: false`. Open question 13.

**Windows.** The terminal tool runs through Git Bash, which must be installed (`hermes:tools/environments/local.py:173-190`). `check_fn` reports it unavailable otherwise. The release matrix has no macOS today (`.github/workflows/release.yml:55-117`).

**Size.** About +250-350 MB unpacked per platform after trimming (core site-packages ~207 MB without `.pyc`, plus the interpreter) *(inferred from measured parts)*. Open question 15: every installer, or a separate flavour.

`release.yml` desktop job: add setup-uv and an `actions/cache` for `apps/web/.cache/python` with key `pbs-${{ runner.os }}-${{ hashFiles('apps/web/electron/targets.mjs') }}` (no commas in cache keys).

---

## 11. Settings UI

Settings → Agent gains a **Host tools** section, per account, shown only to host-allowed accounts (4.2); other accounts see one line: "Host tools are not enabled for this account on this computer." Go is the source of truth; values are stored in Postgres (secrets encrypted like `agent_api_keys`, `provider/apikeys.go:25-36`), and the API pushes them to the tool host with `PUT /accounts/{uid}/config` whenever they change and when a worker starts.

**Security-relevant changes need a password re-check.** The API is reachable from every signed-in device over Tailscale (ADR 0011), so a stolen or borrowed signed-in phone could otherwise widen reads, clear the deny list and approve commands. Turning Host tools on, removing a blocked-command pattern, and switching a tool to "Can use" ask for the account password again (a new `POST /auth/recheck` that returns a 5-minute token; `apps/api/internal/features/auth/` has no such endpoint today). Settings that widen what runs or is read without approval are host-level and live in desktop Settings → Server, changeable only from the desktop window over the supervisor's IPC (section 10), never from the phone. Open question 25 is decided in phase 0 with this as the default.

Per account (Settings → Agent):

| Setting | Default | Notes |
|---|---|---|
| Host tools on | off | Explains that commands run on this computer as the computer's user, each after your approval. Turning on needs the password re-check |
| Skills on | on for host-allowed accounts | Toggles the index and `skill_view` |
| Blocked commands | proposed defaults (open question 9) | Written to `approvals.deny`; removing a pattern needs the password re-check |
| Per-tool switches | all exposed tools "Ask me first" | Use ADR 0023's Tool choice labels (Can use / Ask me first / Off) once `feature/bots-adr` merges; "Can use" only for read tools and only if open question 3 allows unapproved reads |
| Status | live | From `GET /tools?uid=` and `/health`: which tools are available and why not ("Git Bash not found", "No browser found") |
| My skills | list | Account-local skills with view and delete |
| Tool keys | none needed today | Only `pending` tools need keys (FAL, xAI video, TTS). The section appears when such a tool is enabled |

Host-wide (desktop Settings → Server; `TIMELY_TOOLS_*` env fallbacks on dev and servers):

| Setting | Default | Notes |
|---|---|---|
| Accounts allowed to use host tools | empty = the only account, while registration is closed (4.2) | Lists accounts by email, stores uids |
| Workspace folder | `<profile>/workspace` per account | Root for `read_file`/`search_files` and the terminal's default cwd |
| Extra readable folders | none | Added to the read confinement; refuses `/`, the home folder itself, the Timely data dir and `TIMELY_TOOLS_HOME` |
| Use my real home folder in the terminal | off | 3.7 |
| Browser path | auto-detected Chrome/Edge | Phase 6, only if ADR 0025 keeps browser tools (7.9). Chosen from detected Chrome/Edge/Chromium binaries, not free text |
| Tool host state | live | Sidecar state and a Restart button |

Keys reach Hermes through `<profile>/.env` (mode 0600), because Hermes' secret scope reads only `.env` plus secret sources, and it scrubs `.env` secrets from the terminal environment *(ran: XAI key unset in the terminal)*. `skill_view`'s env passthrough could bring such a key back into terminal environments; the worker disables it (5.7). Process environment variables would not be scrubbed the same way *(inferred)*, so keys are never passed as worker env.

Copy rules from `CONTEXT.md`: say "tool host" and "skill"; do not say "Connect" for tool keys (reserved for CLI providers); say "Agent proposal", not "plan".

---

## 12. Phased rollout

Every phase ends with tests green (`make check`, `make test-tool-host` once it exists) and a verify-timely run: a scratch worktree with API on 8081 in its own `DB_SCHEMA`, web on 4002, and (from phase 1) the tool host on 8091, driven in headless Chromium, with screenshots and API reads saved as proof. Phase 3 also needs `make verify-agent-runs`.

### Phase 0: decisions and prerequisites

Deliverables:

- `docs/adr/0025-the-agent-uses-hermes-tools-through-a-loopback-tool-host.md` in house format (title as a sentence, Status/Date bullets, bold lead sentences, Considered Options: vendored source, editable checkout, venv bundle, single process with scope binding, API-supervised tool host). It states its relation to ADR 0007 (host writes are always reviewed; "no host step starts after Stop"), 0008 (cleanup on run end), 0009 (runner keeps the loop; Hermes web tools not used), 0011 (4th non-fatal sidecar, no `.env` in the package), 0001 (the host-level gate: host tools only for accounts the host allows, since there is no owner role; 4.2), and 0022/0023 on `feature/bots-adr` (the browser verdict of 7.9: whether Hermes' script-capable browser tools are dropped in favour of ADR 0022's browser or confined to a throwaway profile; reviewed schema hashes like 0023's tool fingerprints). It records the bypassed `setup.py` guard, that the terminal runs as the host user, the restated promise ("no host step starts after Stop; none runs twice without an explicit Retry"), and the concurrency limit (one host apply at a time, its own lane; 4.8). Number 0025, since 0021-0023 are taken on `feature/bots-adr`.
- `CONTEXT.md`: **Tool host** and **Skill** terms under Agent assistance.
- Answers to the open questions marked *(phase 0)* in section 14, in particular 2 (host-level gate), 3 (are reads approval-gated; decides whether phase 2 exists) and 25 (password re-check and host-level settings).
- **Claude CLI system prompt off argv** plus the 120 KB budget test (4.10).
- Track B items B1-B3 can start now.

Exit: ADR accepted, including the 7.9 browser verdict and the answers to open questions 2, 3 and 25; argv change merged with its test.

### Phase 1: skeleton, sync, skills (read-only)

Entry check (first task): re-run the registry dump, the contract probes (8.6 #8-14, #16-22) and the pyproject block of 3.1 exactly as written against the pin `2bd378ed` (real `https` pin, constraints, CPython environment), and measure a cold `git+https` sync against the archive URL (3.1). Correct section 6 and every `hermes:` citation that moved. If the pin and main differ in anything the plan relies on, pin the commit that was tested instead.

Deliverables:

- `apps/tools` (layout 9.3) as an installable project with the generated pyproject block; `scripts/sync-hermes.sh` with the required sandbox; `hermes.lock.json`, `manifest.json` (full schemas), `tools.yaml` (every tool `pending`/`skip` except `skills_list` and `skill_view`), `skills.yaml` from the reviewed `skills.disposition.md`; `make gen-tool-specs`.
- Tool host front and per-account workers (3.2-3.6) with `/health`, `/tools`, `/tools/{name}/check`, `/tools/{name}/call`, `/conversations/{id}/close`, `/skills`, `PUT`/`DELETE /accounts/{uid}`; private-pipe worker protocol; uid validation; host-allowed uid check; config rewrite before spawn.
- The host-level gate (4.2): `TIMELY_TOOLS_ACCOUNTS`, the single-account default, enforcement in `plan()`, the tool host and read `Call`; the `.env`-ignore and port-pair checks for `TIMELY_TOOLS_URL` (4.11).
- Make targets, `.env.example`, `.gitignore`, `AGENTS.md` rows, `apps/tools/AGENTS.md`, CI `tool-host` job.
- Go: `pytools` package, `tools.gen.json`, `agent/tools_host.go`, `chatCatalog`/`rehearsalCatalog` wiring, context helper set in `runner.work`, the `hostTools` hook, the skills index in the system prompt, a minimal Settings "Skills on" switch.

Verification:

- `make hermes-sync HERMES_SRC=/home/thalhath/Dev/hermes-agent DRY_RUN=1` runs in the sandbox, prints a report and changes nothing; a real run is idempotent (second run says "already at"); without `bwrap` it refuses unless `FORCE_UNSANDBOXED=1`.
- A second account (registration open, not on the host list) gets no skills index and no worker; `GET /tools?uid=<it>` answers `not_allowed`.
- `make test-tool-host` (all of 8.6 that applies) and `make test-api`.
- `git status` in `/home/thalhath/Dev/hermes-agent` unchanged; `~/.hermes` mtime unchanged.
- verify-timely: ask the Agent "how would I summarise an arxiv paper?"; the trace shows `skill_view` called and the answer follows the skill. Stop the tool host; the chat still works and the tool answers "The tool host is not running".

Exit: skills usable in chat on web and phone; the tool host can be absent without breaking anything.

### Phase 2: confined host reads (only if open question 3 allows unapproved reads)

Decision 2 says file tools run with approval, so by default `read_file` and `search_files` ship in phase 3 as approval steps and this phase is skipped. It exists only if the owner answers open question 3 with "unapproved, workspace-confined reads" in phase 0.

Deliverables: `read_file`, `search_files` as `read` with workspace confinement and the `read:<conversation>` task id (3.7); outside-data marking and `outsideReads` (4.7); `jev.go` area; cleanup triggers from the runner (3.5); the host-level workspace folder setting.

Verification: tests that a path outside the workspace is refused, including via symlink, `..`, `~`, and a relative path and `search_files('.')` after an approved `cd /` in the same conversation (8.6 #19); that reading a file sets `ForceReview` on a following Timely edit; verify-timely: put a file in the workspace, ask the Agent about it.

Exit: reads work and cannot leave the workspace.

### Phase 3: approval-gated host tools

Deliverables:

- Step `ID` and `Attempt`, the `started` checkpoint with `readsChanged` moved in front of the host effect, prepare-then-apply with no in-transaction read check for host steps, `calls.sqlite`, `GET /calls/{key}`, Retry that adopts or bumps the attempt, explicit `POST /calls/{key}/cancel` from Stop/Delete through Hermes' interrupt (4.6).
- The dedicated host lane (4.8).
- Rehearsal stand-ins; internal `host_file_snapshot` (no MCP) and confined `/files/snapshot`; `promptSteps` drops `Before` for host steps; `/check` danger reasons.
- `read_file` and `search_files` as approval steps (unless phase 2 shipped them), `terminal`, `write_file`, `patch`, then `skill_manage` (wrapped, threat-scanned, 5.8), with `tools.yaml` overrides and the run budget (4.8). `execute_code` only after its exit test: calling a `pending` tool from inside `execute_code` is refused (R6); until then it stays `pending`.
- Provenance on host cards and the continuation cap (4.7).
- `hostToolsOn` prompt block and CLI protocol fix; continuation after host steps (4.9).
- `host` review card kind in `packages/contract/src/changeReview.ts`, `apps/web/app/_components/chat/changeCards.tsx`, `apps/mobile/components/chat/ChangeCards.tsx`: terminal (monospace multi-line command, workdir, timeout), file (path and unified diff, "new file" or "overwrites N bytes"), code (code block), and the result after apply (exit code, truncated stdout/stderr with expand); removal styling for Destroys. Today unknown tools render as a generic "Change" with one-line key/value rows (`packages/contract/src/changeReview.ts:46-56, 1264-1346`; `apps/web/app/_components/chat/changeCards.tsx:624-660`).
- Optional: editable steps endpoint (4.6).
- Settings: Host tools on and blocked-command removal behind the password re-check (11); host-level real-home switch and readable folders in desktop Settings → Server (dev: env).
- TLA+ `HostCall` action and coverage re-sync.

Verification:

- The tests listed in 4.6, plus a policy test for every `approval` spec.
- `make verify-agent-runs` passes with the extended model.
- verify-timely: "create hello.txt in my workspace with the text hi, then show me its contents": a host card with a diff appears; nothing exists before approval; after approval the file exists once and the step is `done` (no replan); the continuation reads it back. Edit an existing file through `write_file` after the worker was restarted: it succeeds. Stop during `sleep 60` kills the process (check with `ps`), then Retry and approve runs it again once (attempt 2). Restart the API during `sleep 30`: the command keeps running and the step is adopted `done`. Kill the tool host between call and commit (test hook) and confirm the step shows "may have run". While a host step runs, a second conversation's plain chat still answers (host lane).
- `write_file` proposed for `~/.ssh/id_ed25519`: the card says the current file is not shown, and the conversation row and the next prompt hold no text from it.
- A `curl … | sh` proposal shows Hermes' danger reason; `mkfs` fails at proposal time.

Exit: host writes are always reviewed, run at most once, and never start after Stop.

### Phase 4: Settings UI complete

Deliverables: everything in section 11, including per-tool switches, status, My skills, and the config push. Account deletion calls `DELETE /accounts/{uid}`.

Verification: changing a setting rewrites `config.yaml` and restarts only that account's worker; a second account sees none of the first account's skills or settings; verify-timely screenshots of the section on web and phone.

### Phase 5: desktop packaging

Deliverables: section 10.

Verification: `make dist-desktop` on Linux and in the Windows release job; install the AppImage, start it, confirm the tool host starts after the window, `/health` answers on 48082 from loopback only (`ss -ltnp`), not on the Tailscale address; kill the Python process and confirm the app keeps running and Settings shows it crashed; quit and confirm no orphan Python or bash processes; `make test-electron-supervisor`.

Exit: a desktop install runs skills and approved host tools with no `.env`, no uv and no network download.

### Phase 6: browser tools

Blocked on the 7.9 verdict in ADR 0025. If ADR 0025 picks option 1 (recommended), this phase is replaced by ADR 0022's Go browser work, and Hermes' browser tools stay `skip`. If it picks option 2:

Deliverables: `browser_exec`, `browser_cdp`, `browser_dialog` as `approval`, using the installed Chrome/Edge in a throwaway per-conversation profile that never holds Secure Store sessions, with CDP `Runtime`/`Network` refused on sites with saved logins; card kind for browser (Python code block, session). Depends on B10 (`ErrNeedsBrowser`) so the model reaches for the browser deliberately when `read_page` fails.

Verification: a JavaScript-only page fails in `read_page` with "needs the browser", the model proposes a browser step, the card shows it, approval reads the page; no Chromium download happens (`HERMES_RUNTIME_DIR` stays without `chromium`).

### Track B (parallel)

Section 7.8. Each item ships with its own tests; the web search and image items need a verify-timely run on at least one provider that searches and one that does not.

---

## 13. Security model

**What is being protected.** The owner's machine and files, Timely's own secrets (JWT secret, DB password, backup key) and data, other accounts' data on a multi-account install, and the owner's live `~/.hermes`.

**Reachability.** The desktop API is reachable from the phone over Tailscale (ADR 0011). The tool host binds `127.0.0.1` only, hard-coded, so the phone never talks to it directly. Loopback is not a security boundary for a terminal endpoint (any local process or a DNS-rebinding page can reach it), so it also requires the Bearer token, rejects foreign `Host` and any `Origin`, and compares tokens in constant time. The token never appears in a URL or cookie.

**Who can run a host command.** Only a signed-in Timely account that the host allows (4.2: desktop Settings → Server or `TIMELY_TOOLS_ACCOUNTS`; by default only the single account while registration is closed) and that has Host tools switched on, through an Agent proposal step the person approved on any of their signed-in devices. The gate is enforced in `prepareProposal`, in the host tools' `Prepare`/`Call`, and in the tool host front, not only by hiding specs. A host step can never be immediate: authority is always `Reviewed`, and a policy test enforces it. Approving from the phone runs a command on the desktop; that is the intended feature, but it means a stolen, signed-in phone can approve commands. Mitigations: settings that widen unapproved reads are host-level and desktop-only, turning host tools on or removing a blocked pattern needs a password re-check (11), and a `Destroys` host step after outside data cannot be approved from a notification (4.7). Open question 25 decides whether approving any host step from the phone needs more.

**Hermes as a second layer.** Hardline floors, `approvals.deny`, protected-path write guards. Not a sandbox: Hermes calls its own denylist "defense-in-depth, not a security boundary". Approved commands run as the API host's OS user with that user's file access (decision 2). The ADR states this.

**Reads.** Approval-gated by default (decision 2) and confined to the workspace and host-chosen folders in both modes, because their output goes to a model provider. The worker resolves read paths itself, never through Hermes' session cwd, and runs reads under their own task id (3.7). `/files/snapshot`, which runs before approval, returns no file text outside the workspace, and snapshot text never goes back to the model (4.6 item 8).

**Accounts.** One worker per account gives separate homes, secrets, skills and Hermes state, but no OS isolation: an approved terminal command in account A can read account B's files, the Postgres data dir and the desktop config. ADR 0001 has no owner role to restrict this, so the host-level gate (4.2) is what restricts it: accounts the host has not allowed never reach the tool host at all. Open question 2 confirms the default.

**Untrusted content.** File contents, terminal output, browser pages and account-local skills (including their "Your skills" index rows, capped and inside an outside-data block) are outside data: marked and delimiters defanged (4.7). `ForceReview` protects Timely edits that follow them; it adds nothing for host steps, which are always reviewed. For host steps the defences are provenance on the card, no notification approval for a `Destroys` step after outside data, the continuation cap, and the threat scan on `skill_manage` (4.7, 5.8). Continuation after host steps is a loop through outside data; the person's reading of each card is the gate. Hermes web tools are not exposed, so no model-chosen URL goes to a third-party vendor. `read_page` (Track B) keeps `fetchGuard`'s rule, widened only to URLs that `web_search` returned. Shipped skills are reviewed in the sync PR and threat-scanned.

**Secrets.**

- Workers get an allowlisted environment (3.6); a test asserts JWT/DB/backup/vault/provider keys are absent. Terminal children inherit the worker environment, so this is what keeps Timely's secrets out of commands.
- Tool keys live encrypted in Postgres and in `<profile>/.env` (0600); Hermes scrubs `.env` secrets from terminal environments *(ran)*, and the worker disables `skill_view`'s env passthrough (5.7), but an approved `cat` can still read the file.
- The `TIMELY_TOOLS_*` variables are stripped from agent CLIs by the existing scrubber (`provider/cli.go:376`).
- `HERMES_HOME` is always set; nothing touches `~/.hermes`.

**Outbound traffic.** Telemetry is opt-in and off by default (`hermes:hermes_cli/config_defaults.py:2311-2324`) and is written off explicitly; keyless web tiers are off; `mcp_servers` is empty and user plugins never load (3.4); no Chromium download on desktop. Config keys alone are not proof: 32 bundled backend plugins auto-load and plugin-catalog checks may use a cached live copy (`hermes:hermes_cli/plugins_discovery.py:312-330`), and `image_generate` falls back to Nous' managed gateway. So a contract test runs a worker in a network namespace with an egress log and asserts zero outbound connections for the exposed read tools and a terminal `true` (8.6 #21). The sync report diffs the telemetry and web sections of Hermes' config defaults so a changed default is seen.

**Supply chain.** Each sync brings dependency bumps and up to 176 upstream skill scripts. The pin is a commit, constraints follow upstream's tested lock and 3-day quarantine, a release must be at least 3 days old before it is synced, every step that runs upstream code runs in a required sandbox (locally and in CI; 8.3 step 0), the sync job that runs upstream code has no write token, the write job applies only patches confined to an allowlist of paths (no workflows, no Makefile, no symlinks or mode changes), its token has no workflows scope, and nothing auto-merges (8.8).

**Worktrees.** No tool host URL on a worktree API without `DB_SCHEMA`; `TIMELY_TOOLS_URL` is ignored when it comes from `.env`, must be the API port's pair, and the pairing tag on `/health` must match (4.11).

---

## 14. Risks and open questions

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The install bypasses an upstream build guard; upstream may tighten it or change the wheel layout | Sync stops when the guard or overrides change; contract tests; the editable-checkout fallback |
| R2 | Internal-API churn: the tool host relies on private Hermes helpers, and releases come every 1-10 days with thousands of commits | Contract tests 8.6 #8-14 on every sync; pin releases, not main |
| R3 | Headless Hermes auto-approves; a Timely authority bug would leave only Hermes' floors | Authority policy tests; front allowlist refuses non-exposed tools; `pending` default for new tools |
| R4 | Host side effects are weaker than DB writes: "unknown" after a crash; Stop cannot undo a running command | `started` checkpoint with the read check before the effect, idempotency store keyed by attempt, adoption on re-claim and Retry, explicit cancel (never on disconnect), restated promise in the ADR |
| R5 | No OS isolation between accounts | Host-level gate enforced in the API and the tool host (4.2); ADR 0001 has no owner role |
| R6 | `execute_code` scripts may call other Hermes tools through the kernel's RPC (`_last_resolved_tool_names` is the sandbox tool list) *(inferred from hermes-embed's note)*; until disproved, the front allowlist is not the only path to a tool | `execute_code` stays `pending` until a phase 3 exit test calls a `pending` tool from inside it and gets a refusal |
| R7 | Claude CLI argv limit | Phase 0 prerequisite (4.10) |
| R8 | Prompt-cache churn from dynamic descriptions or per-account changes | Specs pinned at sync; filtering only on setting changes |
| R9 | Run budget: a 240 s command times out a 10-minute run with several host steps; long applies hold a chat lane | Budget sized per plan; a dedicated host lane, one host apply at a time (4.8) |
| R10 | Desktop size +250-350 MB; Windows MAX_PATH; read-only installs | Trim, precompile, path-length check; flavour question |
| R11 | Skills that drive Hermes CLI or `~/.hermes` | Auto-deny flag; dedicated terminal HOME |
| R12 | Sync PRs without CI | PAT/App token, or the sync job runs the tests itself |
| R13 | Hermes' terminal runs `bash -lic`; rc files run, and background processes outlive runs if cleanup is missed | Dedicated HOME by default; cleanup triggers; worker clears `processes.json` |
| R14 | Some providers may reject `default`/`pattern`/`anyOf` in read schemas (not verified live) | Generator strips them from read schemas |
| R15 | The plan's Hermes facts were checked at main `334f66b8`, not the pin `2bd378ed` | Phase 1 entry check re-runs the dump, probes and lock at the pin (12) |
| R16 | The git pin clones ~1.1-1.4 GB of Hermes history into every cold uv cache | Measure in phase 1; GitHub archive URL pin (3.1) |
| R17 | Sync runs unreviewed upstream code (build backend, imports, shells) before the owner reads the report | Required sandbox; CI as the default place to sync (8.3) |
| R18 | Prompt injection through terminal/file output drafts the next host command in the continuation loop | Provenance on cards, continuation cap, no notification approval for `Destroys` after outside data (4.7) |
| R19 | Hermes' browser tools give the model script access that ADR 0022 forbids | Browser tools `pending` until ADR 0025 decides (7.9) |

### Open questions for the owner

Phase 0 (needed before building):

1. **Process model**: confirm one worker per account (recommended), rather than one process with per-call scope binding.
2. **Multi-account**: host tools (and skills) only for accounts the host allows, listed in desktop Settings → Server or `TIMELY_TOOLS_ACCOUNTS`; with an empty list, only the single account while registration is closed (recommended). Should skills, which are read-only and reviewed, later open to every account?
3. **Reads**: decision 2 says file tools run with approval, so the default is that `read_file`/`search_files` are approval steps (confined to the workspace as well). Do you want unapproved, workspace-confined reads instead (adds phase 2)?
4. **Terminal HOME**: dedicated `<profile>/home` by default with a "use my real home" switch (recommended), or real HOME always?
5. **Crash semantics**: a host step that may have run becomes "failed: may have run" and only runs again on an explicit Retry, as a new attempt (recommended). An API restart does not kill running commands; the result is adopted. Or should a crash re-run it?
6. **Continuation**: after host steps are applied, should the Agent automatically read the output and propose the next step (recommended; each step still needs approval)?
7. **Editable steps**: build the endpoint to edit a proposed command or file before approving, or is replying in chat enough?
8. **Time limits**: 240 s per host step, a 30-minute cap per apply run, and one host apply at a time on its own lane?
9. **Default blocked commands**: ship `git push*`, `sudo *`, `rm -rf ~*` as editable defaults?
10. **Install mode**: pinned package with `HERMES_NIX_BUILD=1`, as a git URL or a GitHub archive URL of the same commit depending on the phase 1 measurement (recommended), or a git-ignored pinned checkout used as an editable path?
26. **Browser (phase 0, for ADR 0025)**: drop Hermes' `browser_exec`/`browser_cdp` and build ADR 0022's Go browser (recommended), or allow them in a throwaway profile (7.9)?
27. **Local syncs**: require a sandbox (`bwrap`) for `make hermes-sync`, with CI as the default place to run it (recommended)?

Later:

11. Optional skills: none by default, then allow-listed one by one (recommended)?
12. `skill_manage`: own skills only (recommended), or copy-on-write edits of shipped skills?
13. Browser: if Hermes browser tools are kept (26), confirm ADR 0022's installed Chrome/Edge, never bundled.
14. Windows: is the terminal a target there (needs Git for Windows)?
15. Desktop: ship the tool host in every installer, or as a separate flavour?
16. Desktop token: ephemeral per boot (recommended) or sealed in `config.json`?
17. Schema changes: keep the "reviewed hash fails the test" gate (recommended), or auto-demote changed tools to `pending` like ADR 0023?
18. `make dev` without uv: notice and continue (recommended), or require uv?
19. Sync PRs: add a fine-grained PAT or App token so CI runs on them?
20. Server installs (docker-compose): add an opt-in tools profile later, where commands run inside the container?
21. Alternative: should the Go API supervise the tool host itself (no port/token plumbing in Makefile and Electron, works on servers), at the cost of air reloads killing running commands in dev? The plan picks Electron + make.
22. `read_page`: obey robots.txt for reads you asked for, or relax it for person-requested reads?
23. Search backends (B5): which vendors, and amend ADR 0009 to allow a person-chosen search backend?
24. Hermes' auxiliary LLM: the plan never configures it (vision and video stay off, Go `look_at_image` instead). Agree?
25. *(phase 0)* Phone approvals and settings: the plan makes host-widening settings desktop-only and puts turning host tools on and removing blocked patterns behind a password re-check (11). Should approving a host step from the phone also need device unlock or the password?

---

## 15. Review findings and what changed

Two reviews (feasibility, security-completeness) raised 36 findings (5 BLOCK, 17 MAJOR, 14 MINOR). Each was checked against the code before the plan was changed; none was rejected. "Checked" says how.

| # | Sev. | Finding | Checked | Change |
|---|---|---|---|---|
| F1 | BLOCK | In-transaction `readsChanged` sees the step's own `write_file`/`patch` and replans forever | Read `chat/runner.go:957-985, 825-835, 1123-1131, 1021-1026` | 4.6 items 2-3: read check moves into the fenced `started` checkpoint; host steps skip it in the step transaction; integration test |
| F2 | BLOCK | `/files/snapshot` leaks host files into `Before`, Postgres and the next prompt before approval | Read `chat/proposal.go:226`, `chat/runner.go:642-654, 825-835`, `chat/service.go:316-331` | 3.2: no text outside the workspace or on credential paths; 4.6 item 8: `promptSteps` drops `Before` for host steps; tests 8.6 #20, phase 3 |
| F3 | BLOCK | pyproject with constraints fails to lock (PyPy/win32 `pywin32`); `exclude-newer-package` missing; "ran" claims did not test the block | Read the reviewer's `projA`/`projC` logs; `git show v0.23.0:pyproject.toml` lines 630-680 | 3.1: CPython-only `environments`, `exclude-newer-package`, caveat on what ran, phase 1 re-run at the real pin |
| F4 | MAJOR | `python -I -m timely_tools` fails with `package = false` | Ran: `uv_build` project with `module-root = ""` + `python -I -m` works (`revise/pkg`) | 3.1: installable project; 8.3 step 10 note |
| F5 | MAJOR | Fixed call key + Retry resetting `started` makes Retry return the stored failure forever | Read `chat/service.go:599-648` | 4.6 items 1, 5: `Attempt` in the key; Retry adopts or bumps; tests |
| F6 | MAJOR | Hermes' read-before-write guard fails approved writes after a reap or outside the workspace | Read `hermes:tools/file_state.py:30-38`, `file_tools_write_guards.py:560-597`, `file_tools.py:376-398`; only consumer at :571 | 3.6/3.7: `HERMES_DISABLE_FILE_STATE_GUARD=1`, Timely's snapshot hash replaces it; test 8.6 #17 |
| F7 | MAJOR | Hermes prints to stdout and would corrupt a stdout JSON protocol | Read `hermes:model_tools.py:320-331, 530-536` | 3.3: `quiet_mode=True`, protocol on fds 3/4, fd 1 → stderr; test 8.6 #16 |
| F8 | MAJOR | Stop via dropped request kills commands on every API restart; Hermes commands run in their own session | Read `hermes:tools/environments/local.py:1155-1167`, `tools/interrupt.py:37-57`, `chat/runner.go:256-273`, `chat/service.go:461-472` | 3.2 `POST /calls/{key}/cancel`; 3.3; 4.6 item 6 (detached context, explicit cancel from Stop/Delete) |
| F9 | MAJOR | 3 shared chat lanes; 30-minute host applies stall all chats | Read `chat/runner.go:84-91, 98-180` | 4.8: dedicated host lane, one host apply at a time; ADR states it |
| F10 | MAJOR | Host-tools-off enforced only by hiding specs | Read `chat/proposal.go:172`, `chat/policy.go:17-25` | 4.2: enforcement in `prepareProposal`, `Prepare`/`Call` via `HostGate`, and the tool host; policy test |
| F11 | MAJOR | Git pin cost unmeasured (~1.1-1.4 GB clone per cold cache) | Not re-run (disk quota); took the reviewer's cache measurement | 3.1: measure in phase 1; archive URL alternative; R16 |
| F12 | MINOR | Manifest cannot build `tools.gen.json`; no regenerate target; sample is a different format | Read `devtooling-sync/manifest.json` | 8.4 full schema + description; `make gen-tool-specs` (8.1, 8.3, 8.7) |
| F13 | MINOR | Wrong `pm` patch point | Read `hermes:pm/extras.py:187-218`, `pm/__init__.py:28-34`, `skills_tool.py:680-686` | 3.1: patch `pm.client`/`pm.install` `sync_venv`/`ensure`, `pm.ensure` and the other install entries |
| F14 | MINOR | Skills config exposes all optional skills; `hermes-agent` is essential | Read `hermes:agent/skill_utils.py:278-293` | 3.4 generated `disabled`; 5.5 essential skills never copied; test 8.6 #6 |
| F15 | MINOR | `host_file_snapshot` as `MCPOnly` breaks agent tests; hand-kept lists churn | Read `agent/authority_test.go:74-139, 326-345` | 4.2: internal Read tool, tests derived from `pytools.Specs()` |
| F16 | MINOR | Read confinement underspecified; env allowlist incomplete | Read `hermes:tools/file_tools_paths.py:264-314`, `terminal_tool.py:78`, `terminal_tool_config.py:87` | 3.7 path rules and `read:` task id; 3.6 allowlist adds `TERMINAL_CWD`, `TERMINAL_MAX_FOREGROUND_TIMEOUT`, the guard switch |
| F17 | MINOR | Pinned commit ≠ checked commit | Read header facts; `git describe` per the reviewer | Header caveat; phase 1 entry check; R15 |
| F18 | MINOR | `GET /skills` per run wakes a reaped worker | Plan text | 3.2 front answers it without a worker, with `revision`; 5.6 cache, 2 s timeout, fallback |
| S1 | BLOCK | Per-account self-service host tools break ADR 0001 on multi-account hosts | Read ADR 0001, `supervisor/config.ts:27, 92, 138`, `auth/handler.go:48-57`, `.env.example:74-87` | 4.2 host-level gate (Settings → Server / `TIMELY_TOOLS_ACCOUNTS`, single-account default), enforced in API and tool host; 11; 13; ADR 0025 |
| S2 | BLOCK | `MCPOnly` would serve `host_file_snapshot` to MCP clients | Read `agent/authority.go:17`, `agent/catalog.go:40-45`, `agent/tools_bots.go:59-60` | 4.2: chat-only internal tool, never on MCP; test that MCP lists no host tool |
| S3 | MAJOR | Snapshot before approval reads `~/.ssh` etc. into Postgres | Same as F2 | Same as F2, plus Hermes' denylist and credential paths in 3.2 |
| S4 | MAJOR | Relative paths and `~` resolve against Hermes' session cwd, bypassing confinement | Read `hermes:tools/file_tools.py:222-238, 281-284, 624` | 3.7 (worker resolves paths itself, own task id); test 8.6 #19; phase 2 |
| S5 | MAJOR | Unapproved reads contradict binding decision 2 | Plan vs decision text | Reads approval-gated by default (1, 4.3, 6, 12 phase 2 conditional, OQ3 in phase 0) |
| S6 | MAJOR | `.env` `TIMELY_TOOLS_URL` defeats the worktree guard | Read `cmd/main.go:83-85` | 4.11: ignore `.env` value, port pair check, `/health` pairing tag; 9.1 |
| S7 | MAJOR | Hermes browser tools conflict with ADR 0022 and duplicate its browser | Read ADR 0022 on `origin/feature/bots-adr` lines 1-55 | 7.9 verdict options; browser tools `pending`; phase 6 blocked on ADR 0025; OQ26; R19 |
| S8 | MAJOR | Prompt-injection defences overstated (`ForceReview`, continuation loop, local skills in the prompt) | Read `chat/runner.go:503-506, 523` | 4.7 provenance, continuation cap, notification rule; 5.6 outside-data block and cap; 5.8 threat scan; 13 rewritten |
| S9 | MAJOR | Security settings changeable from any signed-in device | Plan text; no re-auth endpoint in `auth/` (grep) | 11: host-level desktop-only settings, password re-check, browser path from detected binaries; OQ25 to phase 0 |
| S10 | MAJOR | `open-pr` applies an unrestricted patch from an untrusted job | Read `ci.yml:6-8`, `release.yml:105-106, 147-150` | 8.8 path allowlist, no symlinks/modes, token without workflows scope, 3-day release age |
| S11 | MAJOR | Local sync runs unreviewed upstream code unsandboxed | Plan text | 8.3 step 0 required sandbox, `FORCE_UNSANDBOXED`, CI default; 8.6; R17; OQ27 |
| S12 | MINOR | Run-time MCP/plugin tools and config tampering | Read `hermes:hermes_cli/config_defaults.py:526, 1695` | 3.4 `mcp_servers: {}`, plugins, rewrite before spawn, registry check; 8.6 #13 |
| S13 | MINOR | Outbound-traffic claims untested | Plan text | 8.6 #21 network-namespace test; 13 |
| S14 | MINOR | `execute_code` RPC bypasses the allowlist | Plan text (R6 inferred) | `execute_code` `pending` until its exit test (6, 12, R6) |
| S15 | MINOR | `todo_list`, `delegate_task` dismissed without comparison; B26 parallel search | Read `agent/server.go:171-172` | 7.7 verdict rows, B28; B26 extends `semantic_search` |
| S16 | MINOR | uid used as a path without validation | Plan text | 3.2 uid checks; 8.6 #15 |
| S17 | MINOR | Dev token in recipe argv; separate secret file vs one-`.env` rule | Plan text, `AGENTS.md` | 9.1/9.2 `TIMELY_TOOLS_TOKEN_FILE`; 9.3 `AGENTS.md` line |
| S18 | MINOR | Skills defaults, incomplete deny list, env passthrough | Read `hermes:tools/skills_tool.py:492-493`, `env_passthrough.py:68` | 5.5 disposition table (phase 1); 11 skills on only for host-allowed accounts; 5.7 passthrough no-op; 8.6 #22 |
