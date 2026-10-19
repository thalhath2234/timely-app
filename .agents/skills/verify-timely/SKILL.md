---
name: verify-timely
description: >-
  Launch an isolated Timely stack (Go API on :8081 in its own Postgres schema,
  Next.js web on :4002) from a scratch worktree of the current checkout, drive
  the web app in headless Chromium the way a user does (sign up, capture to the
  Inbox, create tasks, events and docs), and save screenshots, ARIA snapshots
  and API reads as proof. Use when you need to prove a Timely web/API change
  works in the real app, reproduce a UI bug, or check a feature end to end.
  Never touches the user's :8080 API or :4001 web server.
---

# Verify Timely (web + API)

The primary surface is the desktop web app (`apps/web`, Next.js 16) backed by the Go API (`apps/api`). This skill runs both on the worktree ports from `AGENTS.md` and drives them through a headless Playwright Chromium that keeps its pages between commands. Secondary surfaces (Electron, mobile) are at the end; this skill does not prove them.

Everything here is run from the root of the checkout under test. Set these once per shell:

```bash
V=.agents/skills/verify-timely/scripts/verify-timely.sh
B="node .agents/skills/verify-timely/scripts/browser.mjs"
```

## Hard rules

- Never stop, restart or send requests that change data to `:8080` or `:4001`. Those are the user's own `make dev` servers. The script refuses those ports.
- The verify instance is API `:8081` and web `:4002` only. If something you did not start holds either port, `up` stops it (the listener, plus its `air` or `next dev` parent), as `AGENTS.md` says.
- The API always runs with `DB_SCHEMA=verify_timely` (`VERIFY_TIMELY_SCHEMA` overrides it), so it never claims the main checkout's chat runs or jobs. It also runs with `ALLOW_REGISTRATION=true`, so every run can sign up a fresh account.
- Configuration comes from the root `.env`. The scratch worktree gets a copy of the source checkout's root `.env`, which is what `make setup-env` does. Never create a per-app `.env`.
- Kill only what this skill started. `down` kills the sessions it recorded. Never `pkill -f` on `apps/api/tmp/main`, because that pattern also matches the user's API.
- Don't run the Android emulator, Gradle or `expo run:android` for this skill.
- Only one verify stack can run per machine, because the ports are fixed and all checkouts share the default state dir `~/.cache/verify-timely`. Running `up` from another checkout or worktree replaces the stack that is running. When teammates share the machine, only one of them runs `up` at a time.

## Launch

```bash
$V up
```

What `up` does, in order:

1. Stops a previous verify stack. Frees `:8081`, `:4002` and the browser port `:9339`.
2. Creates or refreshes a detached git worktree at `~/.cache/verify-timely/wt` (`VERIFY_TIMELY_STATE` moves it). The worktree is set to the source checkout's `HEAD`, the source's uncommitted diff is applied, and its untracked files are copied in. A separate tree is needed because `next dev` holds a lock on `apps/web/.next/dev`, so a second dev server can't run from the checkout that serves `:4001`. The worktree lives on disk, not on `/tmp` (tmpfs), because `node_modules` is about 3.7 GB.
3. Runs `pnpm install --frozen-lockfile --prefer-offline` in the worktree. This takes a few seconds once the store is warm, and about 45 s cold.
4. In the worktree, runs `make dev-worktree-api DB_SCHEMA=verify_timely ALLOW_REGISTRATION=true` (air, `API_PORT=8081`) in its own session. Goose migrations run on start into the empty schema.
5. Waits until `GET http://127.0.0.1:8081/health` returns `"status":"ok"` (db ok, migrations read).
6. In the worktree, runs `make dev-worktree-web` (`next dev -p 4002`, `API_ORIGIN=http://localhost:8081`) in its own session. Then waits until `/signup` returns 200 **and** `/api-proxy/health` returns ok through the proxy. Without that second check, Next can answer while the proxy is still broken.
7. Starts headless Playwright Chromium with CDP on `127.0.0.1:9339` and a fresh profile, so the browser is signed out.
8. Runs `doctor`.

Ready means `up` ends with `doctor: OK - drive http://127.0.0.1:4002`. A cold start takes about 1 to 2 minutes, and the first visit to each route compiles it (5 to 20 s). Logs are in `~/.cache/verify-timely/logs/{install,api,web,browser}.log`. Read them with `$V logs api|web|browser [lines]`.

If the code under test changes after `up`, run `$V up` again. `doctor` fails the "worktree matches the source checkout" check until you do. Inside the worktree, air and Next reload edits, but the source checkout's edits are not synced live.

## Doctor

```bash
$V doctor     # read-only; exit 1 means do not drive this instance
```

Doctor checks each of these:

- `:8081` and `:4002` listeners exist and are in the sessions `up` recorded.
- Each listener's cwd is the scratch worktree.
- The API process env has `DB_SCHEMA=verify_timely` and `API_PORT=8081`.
- `/health` reports status and db ok and `registrationOpen:true`.
- The Next server env has `API_ORIGIN=http://localhost:8081`.
- `/api-proxy/health` is ok.
- The worktree fingerprint (HEAD, diff and untracked list, excluding this skill's dir) matches the source.
- The CDP browser is ours.
- Nothing of ours listens on `:8080` or `:4001`.

Run doctor first whenever anything looks off. `$V status` prints sessions, port owners and paths.

## Drive

`browser.mjs` runs one action per call against the persistent headless Chromium, then disconnects and leaves the page open. A journey is therefore a sequence of shell commands. Each command prints one JSON line `{"ok":true,...,"url":...}`, or prints `{"ok":false,"error":...}` and exits 1. `open` only accepts the verify origin `http://127.0.0.1:4002`.

Locators, from most to least preferred:

- `--role R --name N [--exact]`: accessible role and name. This is the default choice.
- `--label L`, `--placeholder P`, `--text T`, `--testid ID`: other ways to find an element.
- `--css S`: last resort only. The doc body (`.ProseMirror`) is the one place that needs it.
- Scope a locator with `--in-role R --in-name N` (a dialog, a region) or `--in-testid ID`.
- Pick one of several matches with `--nth K` or `--first`.

Commands:

| Command | Effect |
| --- | --- |
| `$B open /inbox` | Navigate to a path (waits for DOMContentLoaded, 120 s budget for first compile). |
| `$B click <locator>` | Click. |
| `$B fill <locator> --value "text"` | Replace the field's text (also works on contenteditable). |
| `$B press --key Enter [<locator>]` | Key press on the locator or the page. |
| `$B wait <locator> [--state hidden] [--timeout ms]` / `$B wait --url-includes /onboarding` | Wait for an element state or URL. |
| `$B expect <locator> [--count N] [--absent]` | Assert; exits 1 when it does not hold. |
| `$B text [<locator>]` | Print innerText (whole page when no locator). |
| `$B snapshot [<locator>] [--path f.aria.yml]` | ARIA snapshot (YAML). Print it to discover roles and names. |
| `$B screenshot --path f.png [--full] [<locator>]` | Screenshot. |
| `$B url` | Current URL. |
| `$B api GET "/tasks?inbox=true" [--body JSON] [--path f.json]` | Same-origin fetch to `/api-proxy<path>` with the page's session (cookie plus bearer token). Use it for read-only second views, and for fixture cleanup only. |
| `$B signup-onboard [--email E] [--password P] [--workspace W]` | Baseline account through the real UI: `/signup`, then onboarding "Skip for now", then name the workspace, then skip the tour. Prints the credentials. It is the same UI path as [account-onboarding](features/account-onboarding.md). |

Set `VERIFY_TIMELY_EVIDENCE=<dir>` and every command, passed or failed, is appended to `<dir>/actions.jsonl` with its locator and result. That file is the action log for the proof.

Feature recipes, with exact handles, are in [`features/README.md`](features/README.md). Read the index, then follow the feature's file.

Example (a slice of [inbox-capture](features/inbox-capture.md)):

```bash
$B signup-onboard
$B open /inbox
$B fill --role textbox --name "What's on your mind?" --value "Book the dentist"
$B press --role textbox --name "What's on your mind?" --key Enter
$B wait --text "Captured. Add the next one."
$B expect --in-testid inbox-up-next --text "Book the dentist"
```

## Evidence

Put each run's proof in `.agents/skills/verify-timely/evidence/<UTC timestamp>-<feature-id>/`. That directory is git-ignored by its own `.gitignore`, and `down` never touches it.

```bash
RUN=.agents/skills/verify-timely/evidence/$(date -u +%Y%m%dT%H%M%SZ)-inbox-capture
mkdir -p "$RUN" && export VERIFY_TIMELY_EVIDENCE="$RUN"
$V doctor > "$RUN/doctor.txt"
```

Proof standards:

- Drive the real user path: visible controls, keyboard and routes. `$B api` is for reading state back and for cleanup. Never use it to perform the action under test.
- Capture the action and the state it produces. Take a snapshot or screenshot before and after, and keep `actions.jsonl`. A final screen alone is not proof.
- Check side effects in a second view: reload the page, open another screen that shows the same data (the Tasks list, the Calendar), and read it back with `$B api GET ...` into a `.json` file.
- Make screenshots show the app identity: the sidebar or page heading must be visible.
- There are no mocks. The API talks to the real Postgres schema `verify_timely`. External AI providers are not configured on a fresh account (see the chat gotcha in the feature map).
- When a journey cannot run, record the attempted command and the unmet precondition. Never report an entry point you did not drive as verified.

## Cleanup

```bash
$B api DELETE /me --body '{"password":"<the run password>"}'   # optional fixture cleanup: drops the run's account
$V down                    # stop browser, web, API sessions; remove the scratch worktree; keep evidence
$V down --keep-worktree    # same, but keep ~/.cache/verify-timely/wt (and its node_modules) for a faster next `up`
```

`down` kills only the sessions it recorded and their descendants. That covers air's `tmp/main.exe` and the Next workers, which run in their own process groups. It then reports any port still held by someone else, and runs `git worktree remove --force` plus `prune` on the scratch tree. The `verify_timely` schema stays in `timely_db` as disposable scratch data, and every run signs up a fresh account in it. To start the schema from empty, use a new `VERIFY_TIMELY_SCHEMA=verify_timely_2`. The host has no `psql` to drop the old one. After `down`, check the proof survived: `ls "$RUN"`.

Run `$V down` after every failed attempt too, so broken attempts don't strand ports.

## Helpers

- `scripts/verify-timely.sh up|doctor|status|browser|logs [api|web|browser|install] [N]|down [--keep-worktree]`. `browser` restarts only Chromium with a fresh, signed-out profile.
- `scripts/browser.mjs <command> ...` is described in the Drive section. It loads `@playwright/test` from the source checkout's root `node_modules`. If Chromium is missing, run `make install-browser`.
- Environment overrides:
  - `VERIFY_TIMELY_STATE`: state dir, default `~/.cache/verify-timely`.
  - `VERIFY_TIMELY_SCHEMA`: API schema.
  - `VERIFY_TIMELY_CDP_PORT`: browser CDP port, default 9339.
  - `VERIFY_TIMELY_TIMEOUT`: action timeout in ms, default 20000.
  - `VERIFY_TIMELY_EVIDENCE`: action log dir.

## Secondary surfaces (not proved by this skill)

- **Electron shell** (`apps/web/electron`). `make audit-desktop AUDIT_PORT=4002` runs Electron under Xvfb against this skill's `:4002` web, with CDP on `127.0.0.1:4061`. It lists a page only once the web answers below 500. Stop it with `pkill -f "[t]imely-design-audit-electron"`. Hosted mode, with its own Postgres and API, is `make dev-desktop-hosted`. Desktop-only UI, such as Settings → Account → Delete account and Settings → Server, appears only inside Electron.
- **Mobile** (`apps/mobile`, Expo SDK 57). Run `CI=1 make dev-mobile EXPO_PUBLIC_API_URL=http://10.0.2.2:8081`, passing the URL as a make argument because the `.env` include otherwise wins. Metro runs on `:8082`. It needs the capped emulator (`make emu-start` / `make emu-stop`) or a USB phone, and APKs only through `make build-apk`. See `.agents/skills/android-emulator` and `.agents/skills/build-mobile-apk`.
