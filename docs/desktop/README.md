# Timely desktop bundle

How the packaged desktop app hosts the backend and how the phone pairs with it.
Decision record: [ADR 0011](../adr/0011-desktop-hosts-the-backend.md).
Tracking issue: #61.

## Layout of a packaged app

```
<resources>/
  api/timely-api[.exe]        Go API, cross-compiled per target (electron/stage-api.mjs)
  postgres/{bin,lib,share}    PostgreSQL 17 from zonky embedded-postgres (electron/stage-postgres.mjs)
  next-server/                Next.js standalone output (electron/stage-next.mjs), plus timely-guard.cjs (electron/next-guard.cjs)
  agent/                      the agent runtime (electron/stage-agent.mjs; see Agent staging details), started by the API, never written
    boot.py                   entry point: python -I agent/boot.py <command> (apps/agent/packaging/boot.py)
    python/                   CPython 3.14.9 (python-build-standalone, trimmed): bin/python3, python.exe on Windows
    app/hermes/               the vendored Hermes copy: shipped skills only, English locale only
    app/timely_agent/         Timely's worker (apps/agent/timely_agent)
    app/skills/               Timely's own skills, read-only (empty until the timely skill ships)
    app/site-packages/        Python dependencies from Hermes' uv.lock and .hermes-sync/extras.txt
    app/.hermes-sync/policy/  reviewed and denied skill lists, the skill-body rules, tools.yaml
    NOTICE, THIRD_PARTY_LICENSES, MANIFEST.json

<userData>/                   app.getPath("userData"): ~/.config/Timely, ~/Library/Application Support/Timely, %APPDATA%\Timely ("Timely Dev" for local builds, see Local builds)
  config.json                 non-secret settings + sealed secrets (see Config)
  postgres/data               PGDATA (initdb on first run)
  data/backups/<account>/     encrypted account backups written by the API (TIMELY_BACKUP_DIR)
  data/chat-images/           chat uploads (CHAT_IMAGE_DIR)
  data/agent/                 the agent's folder: accounts/account-<id>/ is each account's home (memory, learned skills, chat sessions);
                              seed/<hash>/ and the read-only timely-skills/<hash>/ are made from resources/agent at each API start (prepare)
  backups/pre-upgrade-*/      folder copy of PGDATA taken before the first run of a new version (last 3 kept)
  backups/manual-*/           folder copies from "Back up now" (the API and PostgreSQL pause for a moment, so chats and agent runs stop until they are back)
  backups/<name>.agent/       beside each folder copy: the agent homes' kept parts (memories, skills, pending, .timely, state.db with the chat sessions, and the skill ledger's blobs)
  logs/                       sidecar logs
```

### Restoring a folder backup

There is no restore button yet. A folder backup is two folders that belong together: the
database copy (`backups/<name>/`) and, from phase 3 on, the agent homes beside it
(`backups/<name>.agent/`). Restoring only the database leaves today's memory, skills and
chat sessions next to the backup's learning rows and skill lists. Quit Timely from the
tray, then put both back as `restoreDataDir` (`electron/supervisor/backup.ts`) does: the
database copy replaces `postgres/data`, and each account home under `data/agent/accounts/`
gets the backup's kept parts (a home the backup lacks loses its own). Config, sign-ins and
the workspace stay; config is rendered again when the account's worker next starts. Then
start Timely. An older backup without a `.agent` folder leaves the homes as they are.

## Boot order

Postgres → API → Next → window. A small HTML status page (not Next) shows progress and
errors while sidecars start. Closing the window hides it to the tray; sidecars keep
running. "Quit Timely" in the tray stops Next, then the API, then Postgres.

Each sidecar restarts on crash with exponential backoff (1 s → 30 s, 5 attempts, counter
resets after 60 s of healthy running).

### Sidecars never outlive the app

A clean quit stops every sidecar, but the app can also die without one: a crash, an OOM
kill, or the display server going away (a Hyprland/X crash or logout ends Electron without
running its quit handlers). Up to v0.3.2 the Next server and PostgreSQL then kept running
on their own, and each launch after that started another Next server on a new port. Four
layers now stop that (`electron/supervisor/lifetime.ts`):

| Layer | Covers | How |
| --- | --- | --- |
| Lifeline | API, Next; every OS | stdin is a pipe the app never writes to. When the app exits the OS closes it and the server exits on EOF (`TIMELY_LIFELINE=stdin`; `apps/api/internal/lifeline`, `electron/next-guard.cjs`). |
| Death signal | all three; Linux | each sidecar runs under `setpriv --pdeathsig` (util-linux), so the kernel signals it when the app's process ends: Next `KILL`, API `TERM`, PostgreSQL `INT` (fast shutdown). Skipped, with a log line, when `setpriv` is missing. |
| Job object | all three; Windows | libuv puts every child it spawns in a kill-on-close job, so Windows ends them with the app. Their own children (the API's agent CLIs) may break away from the job and are not covered. |
| Boot sweep | API, Next; Linux | before ports are checked, servers left by an earlier run (any version) are found through `/proc` and stopped (SIGTERM, then SIGKILL after 5 s). A leftover postmaster is stopped through `postmaster.pid`. |

The sweep matches the program and our identity together: the API is a `timely-api`
executable carrying our `JWT_SECRET` or running in our data folder; Next names itself
`next-server`, runs as Electron's Node with `API_ORIGIN` and `PORT`, and carries our
`JWT_SECRET`. Agent CLIs inherit the API's environment, so the secret alone is not enough.
The single-instance lock means no other live copy uses this user-data folder, so a match
that is not our child is a leftover. "Timely Dev" has its own folder and secret, so the
release never touches its servers or the other way round.

The Next server also has memory limits: `--max-old-space-size=1024` (Electron's default
allows a 4 GB heap) and two checks every 30 s in `next-guard.cjs`: resident memory above
1.5 GB, or the heap above 85 % of its cap on two checks in a row. Either makes it exit with
code 75 ("timely-guard: …" in `next.log`), and the supervisor starts a fresh one. Before
exiting it stops taking new connections and lets running requests finish (up to 10 s;
event streams are not waited for). In the gap of a few seconds, the window retries a page
that fails to load, and `apiFetch` retries GET, PUT and DELETE requests
(`app/utils/api/retry.ts`); POST and PATCH (creating things, sending a chat message) are
never repeated. Agent runs live in the API and are not affected. It normally uses
150-300 MB.

Guard rails before anything starts:
- Windows: refuse to run elevated (Postgres refuses to start as Administrator).
- Linux: refuse to run as root.
- Both show a plain-language dialog and quit.

## Config (`userData/config.json`)

```json
{
  "version": "0.1.0",
  "postgresPort": 54329,
  "apiPort": 48080,
  "webPort": 44001,
  "tailscaleEnabled": false,
  "tailscaleHttps": false,
  "allowRegistration": false,
  "setupDone": false,
  "startAtLogin": true,
  "loginNoticePending": false,
  "secrets": {
    "jwtSecret": "<safeStorage sealed, base64>",
    "backupKey": "<safeStorage sealed, base64>",
    "dbPassword": "<safeStorage sealed, base64>"
  }
}
```

`tailscaleHttps` turns on Tailscale Serve (see "HTTPS with Tailscale Serve"); it only takes
effect while `tailscaleEnabled` is on. `tailscaleServeTarget` records the Serve target Timely
set up last, so a moved API port replaces Timely's own route and nothing else.

`startAtLogin` (default `true`) starts Timely hidden in the tray when the person signs in (see
"Start at login"). A file without the key predates the feature: it is read as an upgrade, so
`startAtLogin` becomes `true` and `loginNoticePending` `true`, and the supervisor saves both at
once. `loginNoticePending` means the app still owes the one-time notice; `dismissLoginNotice`
clears it. A new install, an explicit `false` and a corrupt file owe no notice.

Secrets are generated on first run (32 random bytes, base64url). A sealed value that can no
longer be unsealed (the OS keyring changed) is replaced, and the old sealed value is moved to
`lostSecrets` in the same file so a restored keyring can recover it. When
`safeStorage.isEncryptionAvailable()` is false (Linux without a keyring), the values are
stored with the `plain:` prefix and the file is created with mode 0600.

## Environment passed to the API sidecar

| Variable | Value |
| --- | --- |
| `API_PORT` | `apiPort` |
| `API_BIND` | `127.0.0.1` plus Tailscale IPv4/IPv6 when `tailscaleEnabled` and detected |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_SSLMODE` | `127.0.0.1`, `postgresPort`, `timely`, sealed password, `timely`, `disable` |
| `JWT_SECRET`, `TIMELY_BACKUP_KEY` | generated secrets |
| `TIMELY_DATA_DIR` | `<userData>/data` |
| `ALLOW_REGISTRATION` | `allowRegistration` |
| `PATH`, `HOME` | login-shell PATH on macOS/Linux; process env on Windows |
| `TIMELY_LIFELINE` | `stdin` (exit when the app's stdin pipe closes; see Boot order). The API unsets it at start so the programs it runs do not inherit it. |
| `TIMELY_AGENT_RUNTIME` | Packaged: always `<resources>/agent` (`paths.ts` `agentRuntime`), even when a damaged install lacks `boot.py`: the API then reports the runtime missing instead of searching for an `apps/agent` above its data folder. Unpackaged hosted runs: the staged `.electron-agent/<os>-<arch>` when it holds `boot.py`, otherwise unset so the API finds the checkout's `apps/agent`. A value inherited from the shell is always dropped, so a packaged app never runs a developer's runtime. The API starts `<agent>/python/bin/python3 -I <agent>/boot.py` (`python\python.exe` on Windows) with `PYTHONDONTWRITEBYTECODE=1`. The `boot: resources` line in `supervisor.log` ends with `agent=<dir>`. |

`TIMELY_SHELL_TOKEN` (plan section 12: the desktop window's proof for `PUT /instance/host-accounts`)
is not passed yet. It comes with phase 5, together with the host-allowed account setting that
reads it.

Agent CLIs the API starts (Claude Code, Codex and others) get this environment without the
server's own settings (`JWT_*`, `DB_*`, `TIMELY_*`, `API_*`, `ALLOW_REGISTRATION`,
`CORS_ORIGINS`): they reach Timely only through tool calls the API runs, so they never see
the JWT secret, the database password or the backup key.

The Next sidecar gets `PORT=webPort`, `HOSTNAME=127.0.0.1`, `API_ORIGIN=http://127.0.0.1:<apiPort>`, `JWT_SECRET`,
`TIMELY_LIFELINE=stdin`, `TIMELY_WEB_RSS_LIMIT_MB` and `TIMELY_WEB_HEAP_LIMIT_MB`.

## API contract (Phase 1)

`GET /health` (public, no auth):

```json
{
  "status": "ok",
  "instanceId": "5be7a0c7-1ad1-47e8-a11c-03838acd2082",
  "version": "0.1.0",
  "db": "ok",
  "migrations": { "version": 20261002130631, "pending": 0 },
  "registrationOpen": true,
  "uptimeSeconds": 42
}
```

Returns 503 with `"status": "degraded"` and `"db": "<error>"` when the database ping fails.

`instanceId` is this server's id (the one row of `server_identity`, made by its migration). A
phone pins it when it pairs and sends nothing to an address that answers with a different id,
or with none. It is missing while the database is down. `GET /instance` returns it too.

`GET /instance` (authenticated):

```json
{
  "version": "0.1.0",
  "platform": "linux/amd64",
  "startedAt": "2026-10-03T10:00:00Z",
  "port": 48080,
  "bind": ["127.0.0.1", "100.101.102.103"],
  "listening": ["127.0.0.1:48080", "100.101.102.103:48080"],
  "dataDir": "/home/me/.config/Timely/data",
  "backupDir": "/home/me/.config/Timely/data/backups",
  "allowRegistration": true,
  "registrationOpen": true,
  "localCli": true
}
```

`POST /register` returns 403 `{"message": "New accounts are turned off on this server"}` when
`ALLOW_REGISTRATION` is not `true` and at least one account exists. Sign-ups after the first
account are off by default.

`DELETE /me` (authenticated, body `{"password": "..."}`) permanently deletes the signed-in
account, every row it owns and its backup files, and signs out all of its devices. A wrong
password returns 403. The answer is `{"registrationOpen": bool, "lastAccount": bool}`: the
desktop app (Settings → Account, shown only there) then opens sign-up or sign-in, and sets
`setupDone` back to false when no account is left so the first-run setup runs again.

`POST /pairing-codes` (authenticated) returns `{"code": "pair_…", "expiresAt": "<RFC 3339>"}`:
a one-time code, good for 5 minutes, that the desktop adds to its pairing QR on request.
`POST /auth/pair` (public, body `{"code": "pair_…"}`) spends the code and answers like
`/login` with a new session for the person who made it. An unknown, used or expired code
returns 401. Only a SHA-256 of each code is stored (`pairing_codes`).

`/login`, `/register`, `/auth/refresh`, `/auth/pair` and `DELETE /me` are rate limited: 20 requests per minute per IP and 8 per
minute per account (email; `DELETE /me` and `/auth/pair` by IP only). Over the limit returns 429 with `Retry-After`.

`POST /agent/providers/rescan` (authenticated) drops the cached CLI detection so the next
`GET /agent/providers` runs detection again.

## Desktop bridge (`window.timelyDesktop`)

Typed in `apps/web/electron-env.d.ts`. The renderer only sees it inside the desktop app.

```ts
timelyDesktop.instance.get(): Promise<DesktopInstance>
timelyDesktop.instance.subscribe((instance) => void): () => void
timelyDesktop.instance.setSetting("tailscaleEnabled" | "tailscaleHttps" | "allowRegistration" | "startAtLogin", boolean): Promise<DesktopInstance>
timelyDesktop.instance.action("restartApi" | "backupNow" | "openDataFolder" | "openLogs" | "checkForUpdates" | "copyAddress" | "dismissLoginNotice"): Promise<DesktopActionResult>
```

`setSetting("tailscaleEnabled", …)` rebinds the API by restarting only the API sidecar.
`setSetting("allowRegistration", …)` also restarts only the API sidecar.
`setSetting("tailscaleHttps", …)` changes Tailscale Serve and leaves the API running.
`setSetting("startAtLogin", …)` writes the login item (the person's own switch, so it also turns
an entry the system turned off back on) and leaves the API running.

`DesktopInstance.loginItem` is `{ supported, blockedBySystem, notice }`: `supported` is false
outside the installed app; `blockedBySystem` is true when `startAtLogin` is on but Windows
(Startup apps) or the desktop turned the entry off, so the switch shows Off; `notice` is true
while the upgrader notice is owed. `action("dismissLoginNotice")` answers `{ ok: true, cleared }`:
the check and the write are synchronous in the main process, so of several windows or reloads
exactly one caller gets `cleared: true`, and only that one shows the notice.

Confirm dialogs move the mouse pointer onto their Cancel button when they open, like
Windows' "Snap To" setting. The page passes the button's centre in CSS pixels; the main
process converts it to screen coordinates and moves the pointer only while the window is
focused and the point is inside it (`electron/pointer.ts`, through the koffi FFI module):
SetCursorPos on Windows and XWarpPointer on Linux under X11. Wayland sessions don't let
apps move the pointer, and macOS isn't supported, so there it does nothing.

```ts
timelyDesktop.snapPointer(x: number, y: number): void
```

## Start at login

On by default for new installs and for upgraders (who get a one-time in-app notice), so bots
keep watching after a reboot. `electron/supervisor/loginItem.ts` holds every platform's code,
with Electron's login API, the file system and the environment injected
(`scripts/electron-login-item.test.mjs` runs all three platforms on Linux).

- **Windows:** `app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: ["--hidden"],
  name: <app id>, enabled: true })`. The Run value under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` is named after the app id
  (`app.timely.desktop`, or `app.timely.desktop.dev` for local builds), because Electron reads
  `openAtLogin` from the value named after the AppUserModelId. The path is always this
  executable, never a value from the environment. Per-user install, never elevated.
- **Linux:** Electron's login item does nothing there, so Timely writes
  `$XDG_CONFIG_HOME/autostart/timely.desktop` (`timely-dev.desktop` for local builds;
  `~/.config` when `XDG_CONFIG_HOME` is unset or relative). `Exec` and `TryExec` name the
  AppImage file (`$APPIMAGE`) only when this process runs from inside it (`$APPDIR`), else
  `process.execPath` (the pacman and AUR installs), escaped per the Desktop Entry spec; `Exec`
  ends in `--hidden`. A launch path with a control character is refused and nothing is written.
- **macOS** (not shipped): `setLoginItemSettings({ openAtLogin })`; `wasOpenedAtLogin` counts as
  a hidden start.

**Hidden start.** A login start passes `--hidden`: no boot screen, no window, just the tray; the
boot screen closes itself once the app is ready, and opening Timely shows the window. Opening it
while still booting (tray click, Open Timely, the Start menu or a shortcut) shows the boot screen
at once and the window when ready. A boot failure shows the boot screen anyway, and a hidden
start before first-run setup is finished shows the window as usual. A second `--hidden` start
(a second sign-in entry) does nothing. `supervisor.log` says `boot: started hidden at login`.
Smoke test (staged build, `TIMELY_DEV_LOGIN_ITEM=1`): start it with `--hidden`, click the tray
icon before the boot finishes, and check the boot screen appears and then the window.

**Turned off by the system.** At boot Timely only adds a missing entry or repairs one that points
elsewhere. It never re-enables one that Windows turned off (Task Manager › Startup apps, reported
as the launch item's `enabled: false`) or that the desktop turned off (`Hidden=true` or
`X-GNOME-Autostart-enabled=false`); Settings then shows the switch Off with a hint, and only
turning it on there writes the entry again. Using the switch also clears the upgraders' notice,
and the notice is not shown while the system has the entry turned off.

**Known limit (Windows).** `getLoginItemSettings` lists only Run values whose program is this
executable. A value named after the app id that points at another exe (a reinstall into another
folder) therefore reads as missing, and boot replaces it; Electron then writes its
StartupApproved state as on, so a Task Manager "Disabled" on the old copy is not carried over.

**AppImage updates.** The AppImage's file name carries the version and `electron-updater` renames
it on quit (`appimage-filename-updated`); the autostart entry is rewritten with the new path at
once, synchronously. An entry the desktop turned off gets only its `TryExec` and `Exec` lines
rewritten, so it stays off but names the live file if it is turned back on.

**Development.** Login items work only in packaged builds, so a dev run never registers
`node_modules/electron`. `TIMELY_DEV_LOGIN_ITEM=1` turns them on for a smoke test of a staged
build; otherwise Settings shows the switch disabled ("Works in the installed app.").

**Uninstall.** The NSIS uninstaller (`electron/nsis/uninstall.nsh`, `nsis.include`) deletes the
Run and `Explorer\StartupApproved\Run` values named `${APP_ID}`, except during an update
(`${isUpdated}`), which keeps them. On Linux the autostart file stays after removing the app;
`TryExec` makes the desktop skip it once the executable is gone.

## Pairing payload

The QR code in Settings → Server encodes JSON:

```json
{
  "v": 1,
  "name": "my-laptop",
  "id": "5be7a0c7-1ad1-47e8-a11c-03838acd2082",
  "urls": ["https://my-laptop.tail1234.ts.net", "http://100.101.102.103:48080", "http://127.0.0.1:48080"],
  "code": "pair_…"
}
```

`urls` lists the Tailscale Serve address first when HTTPS is on, then the Tailscale IPs, then
loopback. `id` is the API's `instanceId`. `code` is there only while the person has pressed
"Sign the phone in too" and the code has not expired; the phone then signs in with
`POST /auth/pair` instead of asking for a password.

The phone also accepts a bare URL pasted by hand. It calls `GET /health` on each URL in order,
stores the whole list and the id in SecureStore (never the code), and remembers the first one
that answered. A bare URL pins the id of the server that answers it.

The phone checks again when it starts, when it comes back to the foreground, when the network
changes (turning Tailscale on counts) and every 15 s while nothing answers, trying the
remembered URL first. Requests wait for the check at start, so a session token never goes to an
address that now answers as a different server. While nothing answers, the phone counts as
offline: changes queue and the banner says the desktop can't be reached.

### HTTPS with Tailscale Serve

With `tailscaleHttps` on, the supervisor runs
`tailscale serve --bg --https=443 http://127.0.0.1:<apiPort>`, so the API answers at
`https://<MagicDNS name>/` with a certificate Tailscale manages. Before that it reads
`tailscale serve status --json` and refuses to replace anything else on port 443 of that name.
Then it waits until `https://<name>/health` answers with this API's `instanceId` before it
puts the address in the QR. MagicDNS and HTTPS certificates must be on for the tailnet. On
Linux the user may need `sudo tailscale set --operator=$USER` once. Turning the setting off
runs `tailscale serve --https=443 off`, but only while the route is still Timely's. Quitting
the app leaves the route in place, so the phone falls back to the next address until Timely
runs again.

## Development

`make dev-desktop` is unchanged: it uses the dev servers on 8080/4001 and no sidecars.
`make build-desktop` / `make dist-desktop` stage the API, Postgres and the agent runtime for the
host platform first. `TIMELY_TARGETS=linux-x64,darwin-arm64` stages several targets of the API
and Postgres for CI; the agent runtime stages only for the host (see Agent staging details).

### Local builds ("Timely Dev")

Only the release workflow builds "Timely": it sets `TIMELY_RELEASE=1`. Every other build
(`make build-desktop`, `make dist-desktop`, `make dev-desktop`, `make dev-desktop-hosted`) is
"Timely Dev", so it can run while an installed release is open without touching its data.
`electron/flavor.ts` holds the switch; `electron/build.mjs` bakes it into `main.js` and
`electron/pack.mjs` packs with `electron-builder.local.yml` instead of `electron-builder.yml`.

| | Release (`TIMELY_RELEASE=1`) | Local build |
| --- | --- | --- |
| Name, window title | Timely | Timely Dev, title ends in "(Dev)" |
| App id | `app.timely.desktop` | `app.timely.desktop.dev` |
| Executable | `Timely`, `Timely.exe` | `timely-dev`, `timely-dev.exe` |
| userData | `<appData>/Timely` | `<appData>/Timely Dev` (`~/.config/Timely Dev` on Linux) |
| Single-instance lock | in its userData | in its own userData, so it never hands over to the release |
| Default ports (Postgres, API, web) | 54329, 48080, 44001 | 54339, 48090, 44011 |
| Updates | electron-updater | off, so it can't update itself into the release |

Run the unpacked Linux build with `apps/web/release/linux-unpacked/timely-dev`
(`win-unpacked\timely-dev.exe`, `mac*/Timely Dev.app`). Its first launch creates a fresh
database. `TIMELY_RELEASE=1 make dist-desktop` builds an installer
identical to the released one.

## Build and release

`node electron/pack.mjs` (from `apps/web`; `make build-desktop` / `make dist-desktop`)
runs, in order: `next build` with `ELECTRON_BUILD=1`, esbuild for `main.ts`/`preload.ts`,
then four staging steps, then electron-builder, whose `afterPack` hook
(`electron/verify-pack.cjs`) checks the packed agent runtime before any installer is written.

| Step | Script | Output | Source |
| --- | --- | --- | --- |
| Next | `electron/stage-next.mjs` | `.electron-next/` | `.next/standalone` + `.next/static` + `public` |
| API | `electron/stage-api.mjs` | `.electron-api/<os>-<arch>/timely-api[.exe]` | `go build` of `apps/api/cmd`, `CGO_ENABLED=0 -trimpath -ldflags "-s -w -X main.version=<package.json version>"` |
| Postgres | `electron/stage-postgres.mjs` | `.electron-postgres/<os>-<arch>/{bin,lib,share}` | zonky `embedded-postgres-binaries-<classifier>-17.11.0.jar` from Maven Central |
| Agent | `electron/stage-agent.mjs` | `.electron-agent/<os>-<arch>/{boot.py,python,app,...}` | python-build-standalone from `apps/agent/hermes/pm/lock.json`, `uv pip install --target` from Hermes' `uv.lock`, `apps/agent/{hermes,timely_agent,skills,packaging}` |

`<os>-<arch>` is electron-builder's `${os}-${arch}` (`linux-x64`, `linux-arm64`, `mac-x64`,
`mac-arm64`, `win-x64`), so the static `extraResources` in `electron-builder.yml` copies the right
staged tree into `resources/api`, `resources/postgres` and `resources/agent` for whatever platform/arch is being built.

### Targets

The target table lives in `electron/targets.mjs`, keyed `linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`, `win32-x64` (`process.platform`-`process.arch`). Each entry carries the Go
`GOOS/GOARCH`, the zonky Maven classifier, the name of the `.txz` inside the jar and the jar's
SHA-256.

- Default: the host target.
- `TIMELY_TARGETS=linux-x64,darwin-arm64` stages the API and Postgres for several targets (`stage-api.mjs`, `stage-postgres.mjs`, any OS; Go cross-compiles and the zonky jars are plain downloads). The agent runtime is host-only: `make stage-desktop` and `pnpm electron:stage` stage it for the host whatever `TIMELY_TARGETS` says (`stage-agent.mjs --host`), and `stage-agent.mjs` refuses a list that names another target before staging anything.
- `node electron/pack.mjs --target <host key>` adds the matching electron-builder flags (`--linux --x64`). Every installer ships the agent runtime, so pack refuses any other target before the Next build: a multi-target mac build (`--target darwin-x64,darwin-arm64`) is no longer possible, and each arch builds on its own runner. Every other argument is passed to electron-builder (`--dir`, `--publish never`, ...).
- `TIMELY_SKIP_NEXT=1` reuses the existing `.next` build while iterating on packaging.
- `TIMELY_AGENT_STAGED=1` packs the agent runtime already in `.electron-agent/<os>-<arch>/` instead of staging it again (release.yml sets it, so the installer holds the stage its smoke step checked); the stage must have finished for that target (`MANIFEST.json` and its `.staged-<hash>` marker) and come from the checkout as it is now: the same uv.lock, extras and Python pin (the marker), the same Hermes tag and the same tracked `apps/agent` files. A stage left from before a Hermes sync or a source edit is refused with "stage it again".

The stage scripts can be run on their own: `node electron/stage-api.mjs`,
`node electron/stage-postgres.mjs`, `node electron/stage-agent.mjs` (`make stage-desktop` runs all three).
The agent runtime is the exception to cross-staging: its native wheels and interpreter belong to the
running OS, so `stage-agent.mjs` and `pack.mjs` refuse a target that is not the host ("stage win32-x64
on a Windows runner") before anything is staged or built.

### Postgres staging details

- Jars are cached in `apps/web/.cache/postgres/` and verified against the SHA-256 in
  `targets.mjs` before extraction; a mismatch deletes the cached file and fails the build.
- The jar is a zip with one `postgres-<os>-<arch>.txz`; it is read with `unzip -p` when
  available, otherwise with a built-in zip reader (`TIMELY_ZIP_READER=node` forces it), then
  unpacked with `tar -xf` (GNU tar + xz on Linux, bsdtar on macOS and Windows 10+).
- A `.staged-17.11.0` marker in the output directory makes re-runs no-ops. Delete the directory
  (or bump `POSTGRES_VERSION`) to restage.
- Pruned: static/import libraries (`*.a`, `*.lib`), `pgxs/`, `include/`, `share/doc`, the
  plperl/plpython/pltcl modules (no interpreter is bundled), and on Windows the wxWidgets DLLs.
  On macOS the archive ships each dylib three times under versioned names; the copies are
  turned into symlinks (the same layout Linux already uses). Everything else is kept.
- **zonky ships only `initdb`, `pg_ctl` and `postgres`.** There is no `pg_dump`, `pg_restore`,
  `psql` or `pg_isready` in `resources/postgres/bin`.
- Staged size: about 55 MB (Linux), 85 MB (Windows), 130 MB (macOS), before installer compression.

`.electron-api/`, `.electron-postgres/`, `.electron-agent/` and `.cache/` are git-ignored (`apps/web/.gitignore`).

### Agent staging details

`electron/stage-agent.mjs` (`make stage-agent`) builds `.electron-agent/<os>-<arch>/` for the host
target. It uses only `node:` builtins, so CI runners and the Docker build run it without `pnpm
install`; it needs `uv` on `PATH` and a system `tar` (bsdtar from `System32` on Windows).

- **Pins.** The interpreter is the python-build-standalone `install_only` build Hermes pins in
  `apps/agent/hermes/pm/lock.json` (`packages.python`, 3.14.9+20261021; the lock's keys are the
  `targets.mjs` keys). Staging fails when that version does not start with the Makefile's
  `AGENT_PYTHON_VERSION`. Dependencies come from `uv export --frozen --no-dev` of Hermes' `uv.lock`
  with the extras in `apps/agent/.hermes-sync/extras.txt` (the list `make agent-install` uses),
  installed with `uv pip install --target app/site-packages --no-deps --require-hashes --no-build`:
  a dependency without a wheel for the target fails the stage rather than compiling on a release
  runner. `site-packages/bin` and `Scripts/` are deleted (their console scripts carry absolute
  shebangs).
- **glibc floor (Linux).** The Linux runtime needs glibc 2.28 or newer (Debian 10, RHEL 8, Ubuntu
  20.04): staging passes `--python-platform x86_64-manylinux_2_28` (`aarch64-` on linux-arm64), so
  the wheels do not follow the build machine's glibc. Without it a host with glibc 2.34+ picked
  cryptography's `manylinux_2_34` wheel, and an older distribution failed only when a feature
  imported it. The interpreter itself needs 2.17. Measured on the linux-x64 stage: the highest
  `GLIBC_` symbol in any shipped `.so` is 2.28.
- **Cache.** The interpreter archive is cached in `apps/web/.cache/agent/` and checked against the
  lock's sha256 before use; a mismatch deletes it and fails. uv's own cache holds the wheels.
- **Marker.** `.staged-<hash>` (sha256 of `STAGE_FORMAT`, the lock's python entry, `uv.lock`, the
  extras, the target, the trim rules and the `uv pip install` flags) skips the download, trim and install on a re-run. The source copy, the seed check,
  compileall and the checks always run, so a re-stage after a source change takes about 10-15 s.
  `make clean-agent-stage` deletes every stage and keeps the download cache.
- **Trims.** `include/`, `share/`, `idlelib`, `tkinter`, `turtledemo`, `ensurepip`, Tcl/Tk, `_dbm` on Linux, the
  interpreter's own `pip` and the `pydoc`/`idle`/`-config` scripts, and on Linux `lib/libpython3*.so*`
  (131 MiB: the interpreter is linked statically and never loads it; the interpreter check below runs
  the trimmed interpreter), and on Windows every debug symbol (`python*.pdb`, `DLLs/*.pdb`,
  `Lib/venv/scripts/nt/*.pdb`: 43 files, 90.3 MiB; electron-builder's own pdb exclusion skips `extraResources`): 155 MiB on linux-x64 in all. The stdlib
  `test` package is dropped when nothing staged imports it (python-build-standalone 3.14.9 ships
  none). The CPython licence stays.
- **What of the source ships.** In a git checkout only files git tracks are copied
  (`git ls-files`), so an untracked or ignored `.env`, credential or virtualenv in the working tree
  never reaches the stage; the log names what was left out. The Docker build has no `.git` and copies
  the folders as they are (its build context leaves out every `.env`). `app/hermes/skills/` holds only the seed set (reviewed in
  `skills-reviewed.json`, not in `skills-denied.json`, no symlinks) and `optional-skills/` only the
  offered ones; `locales/` only `en.yaml` (owner answer Q-1.4); `plugin-catalog/` is kept; no
  `__pycache__` from the checkout. On linux-x64 at Hermes v0.23.0: 30 bundled skills, 78 optional
  skills, 66 denied, 12 not offered. `app/skills/` is 0444 files in 0555 folders.
- **Seed check.** The staged `boot.py prepare` runs once against a scratch folder
  (`~/.cache/timely-agent-stage/<checkout id>`, one per checkout, so `make clean-agent-stage` in one
  worktree leaves another worktree's run alone) and must build the seed tree and the read-only Timely skills copy
  with nothing unreviewed. At API start `prepare` still makes those copies in `data/agent/`: the
  per-user nsis install folder is writable by the same user, so the read-only copy the agent sees
  (plan 9.1) lives in the data folder.
- **Bytecode.** `compileall -j0 --invalidation-mode unchecked-hash` over `app/` and the stdlib.
  Installers do not keep source mtimes, and the packaged worker never writes bytecode (the
  `boot.py` shim sets `sys.dont_write_bytecode`, since `-I` ignores `PYTHONDONTWRITEBYTECODE`).
  A `.pyc` whose path would pass the 150-character rule below is deleted again and its module
  imports from source (one file of `anthropic` 0.125.0 at Hermes v0.23.0; the stage log names each).
- **Checks** (any failure lists every problem and writes no `MANIFEST.json`): no symlink with an
  absolute target or one that resolves outside the root; no path over 150 characters relative to
  the agent root, counted after compileall (and after over-long bytecode is dropped); no staged text file containing the absolute stage path
  (the v0.1.1 class of bug); no browser (`playwright`, `pyppeteer`, Chromium or a Chrome binary:
  Timely never bundles Chromium and uses the installed Chrome or Edge, ADR 0022); no dotenv file
  (other than `.env.example`), `.op.env`, `auth.json`, `mcp-tokens/` or virtualenv (`.venv*`) under
  `app/` outside `site-packages`; every installed distribution has a licence text (a licence file in
  its wheel, or one recorded in `apps/agent/packaging/licenses/dists.json`); every crate and C
  library linked into a native module is recorded (`licenses/static/`, below); the interpreter starts and reports the
  expected platform; the staged interpreter imports `mcp` and `mcp.client.stdio` through `boot.py`'s
  `sys.path`, and on Windows `pywintypes`, `win32api`, `win32con`, `win32job` and `portalocker` too.
- **`.pth` files.** `app/site-packages` is a plain folder, not a venv, so site.py under `-I` never
  reads its `.pth` files. `boot.py` registers it with `site.addsitedir`, which runs them: pywin32
  (the MCP SDK's Windows dependency) lives in `win32/` and `win32/lib/` and is importable only after
  `pywin32.pth` ran. `sys.path` is then `hermes/`, `app/`, `site-packages/`, the folders the `.pth`
  files add, the stdlib.
- **Licences.** `THIRD_PARTY_LICENSES` holds, in order:
  - CPython's licence;
  - the libraries python-build-standalone links into the interpreter (OpenSSL, libffi, mpdecimal,
    expat, SQLite, zstd, xz, bzip2, zlib, libedit/ncurses, ...), with the modules that use each.
    The `install_only` archive carries none of their texts, so `make agent-python-licenses` takes
    them once from the matching `full` archive (sha256-checked against the release's `SHA256SUMS`,
    which must also list the lock's `install_only` sha256) into
    `apps/agent/packaging/python-licenses/<lock version>/<target>.json` and `texts/`. Staging fails
    when the pinned version has no record for the target, so run it after a Hermes sync that moves
    the Python pin and commit the result;
  - Hermes' MIT licence and `apps/agent/NOTICE`;
  - each distribution's name, version, licence metadata and licence files. A licence name alone is
    not enough (MIT and BSD require the copyright notice): a wheel without a licence file takes the
    text recorded in `apps/agent/packaging/licenses/dists.json` (fetch-use, firecrawl-anydoc, and on
    Windows pywin32 and the winrt packages), and one with neither fails the stage;
  - the code wheels link statically into their native modules, which their dist-info does not
    name: every crate a Rust extension module was built from and the Rust standard library
    (pydantic-core, jiter, rpds-py, watchfiles, cryptography, nemo-relay, resvg-py,
    firecrawl-anydoc, and on Windows pywinpty: about 250 crates, among them ring's BoringSSL and
    OpenSSL/SSLeay terms, AWS-LC and tiny-skia), and the C libraries listed by hand in
    `apps/agent/packaging/licenses/static/components.json` (cryptography's OpenSSL, cffi's libffi,
    ruamel.yaml.clib's libyaml). `make agent-static-licenses` installs the uv.lock wheels for every
    desktop target, reads the crate paths rustc leaves in each binary, downloads each crate from
    crates.io (sha256 checked against the index) and records its licence files, or the standard
    SPDX text under its authors' names when it ships none, in
    `apps/agent/packaging/licenses/static/<dist>-<version>.json` and `texts/`. Each text appears
    once in `THIRD_PARTY_LICENSES`, under an id the crate lines name. Staging fails when a binary
    links a crate its record lacks, or a distribution that links Rust code or is in
    `components.json` has no record for its exact version, so a Hermes sync that moves one of
    these wheels is reviewed (run the target, read the diff, commit);
  - the GPL and LGPL libraries shipped in binary form, where to get their complete source, and the
    full GPL-2.0, GPL-3.0, LGPL-3.0 and GCC runtime exception texts. A distribution that ships GPL
    or LGPL code (its metadata licence, or a `License: ...GPL` line in a licence file) must be
    reviewed in `apps/agent/packaging/licenses/copyleft.json` at its exact version, or the stage
    fails. Today that is pillow-heif 1.8.1 (libx265 GPLv2, libheif and libde265 LGPLv3, and on
    Windows the MinGW-w64 runtime), a base dependency of hermes-agent and browser-harness.

  On Linux `_dbm` is trimmed: it links Berkeley DB, whose Sleepycat licence asks every binary
  redistribution to say how to get the complete DB source, and nothing staged uses `dbm.ndbm`.
- **`MANIFEST.json`** lists every regular file with its size and every symlink. electron-builder's
  `afterPack` hook (`electron/verify-pack.cjs`) compares the packed `resources/agent` with it (same
  files, same sizes, nothing extra, no absolute symlink), because electron-builder drops some
  folders of an `extraResources` tree without a word. Empty folders are not compared:
  electron-builder drops them, and the runtime does not need them. With Windows signing configured
  (`WIN_CSC_LINK`), electron-builder signs every `.exe` of `extraResources` while copying it, before
  the hook runs (`python.exe`, `pythonw.exe`, the venv launchers, winpty's and pywin32's
  executables), so on win32 a `.exe` whose size differs passes when it is the staged file plus an
  Authenticode certificate table and nothing else changed.

Measured on linux-x64 (2026-11-13, Hermes v0.23.0, without `libpython` and `_dbm`): 21,395 files,
461 MB unpacked (439.5 MiB in the stage log, which counts in MiB; app/
360 MB: site-packages 220 MB, hermes 138 MB, timely_agent 1 MB; python/ 101 MB), 106 MB as an xz
tarball and 156 MB under gzip. MB here is 10^6 bytes. Plan 11.4 estimated 420-460 MB unpacked and
+105 MB compressed (owner answer Q-11.1: +~105 MB per installer).

Installer growth, measured on linux-x64 with Timely Dev 0.3.5: the AppImage is 512.8 MB with the
runtime and 348.4 MB built `--prepackaged` from the same unpacked app without `resources/agent`, so
**+164 MB**. electron-builder sets no AppImage compression, and mksquashfs then uses gzip;
`appImage: { compression: xz }` would bring it near the xz figure, at the cost of slower start-up,
and is the owner's call. pacman packages with xz (about +106 MB expected; not buildable on the host
that measured, whose fpm lacks `libcrypt.so.1`). nsis (7z/LZMA) is not measured yet. `bin/python3.14` (75 MB) still carries debug info; stripping it is not done (the lock pins
the `install_only` build, and the Docker build has no `strip`). Windows and macOS sizes are not
measured yet.

**Smoke test.** `node electron/smoke-agent.mjs [--root <agent dir>] [--read-only]`
(`make smoke-agent`, `AGENT_ROOT=`, `READ_ONLY=1`) runs `python -I boot.py` (usage, exit 2), `boot.py
prepare` into a scratch folder, the import check above, then the Go real-worker test (`TestIntegrationRealWorker` with
`TIMELY_AGENT_TEST_RUNTIME=<root>`: prepare, render-account, spawn, hello, ready with the self-test, a
run on the test's stub model, run.done, shutdown). It needs Go on `PATH`; no AI provider is called.

**Read-only install folder, locally.** The packaged runtime must work where the user cannot write
(a root-owned `/opt/Timely`, a locked-down Windows install):

```bash
make stage-agent
make smoke-agent READ_ONLY=1        # chmod a-w on every entry (Windows: an icacls deny-write ACE for Everyone),
                                    # every step, then fails on any file created, removed or changed
make smoke-agent AGENT_ROOT=$PWD/apps/web/release/linux-unpacked/resources/agent READ_ONLY=1   # the packed copy
make clean-agent-stage
```

Permissions are restored afterwards in every case. On this Linux machine the read-only smoke took
about 4 s (prepare 0.2 s, the Go worker test 3.1 s).

**The whole app from a read-only install, locally** (how phase 3b's exit was checked, 2026-11-13).
Build the release flavour unpacked (`TIMELY_RELEASE=1 make build-desktop`), copy
`apps/web/release/linux-unpacked` elsewhere and `chmod -R a-w` the copy, then start its `Timely`
binary with `env -i` and only what a person's desktop session has: a throwaway `HOME`, a `PATH`
that holds nothing but the CLIs you want the app to find (no `node`, `python`, `uv` or `go`), a
`SHELL` that does not exist (so the login-shell `PATH` lookup falls back to that `PATH`),
`--user-data-dir=<throwaway>` with a `config.json` that sets `postgresPort`, `apiPort` and
`webPort` off the ports anything else uses, and `--password-store=basic`. Without Xvfb, a headless
compositor works: `kwin_wayland --virtual --socket <name>` and `--ozone-platform=wayland`
(Electron 44's `--ozone-platform=headless` crashes). Compare a listing of the install copy (path,
size, mtime, mode) before and after: nothing in it may change. The supervisor's boot line in
`logs/supervisor.log` names `agent=<resources>/agent`, and the worker shows in the process list as
`<resources>/agent/python/bin/python3 -I <resources>/agent/boot.py worker`.

Account homes stay owner-writable even then: the seed tree is made owner-writable after it is
copied from the install (Hermes copies it into each home keeping the modes), and "Back up now"
renames its partial copies into place and can prune and restore homes that hold read-only
folders.

### Signing and notarization

electron-builder handles signing from environment variables; nothing is configured per machine.

| Platform | Variables | Without them |
| --- | --- | --- |
| macOS | `CSC_LINK` (Developer ID Application `.p12`, base64), `CSC_KEY_PASSWORD`; `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization | unsigned, not notarized (`CSC_IDENTITY_AUTO_DISCOVERY=false` keeps electron-builder from searching the keychain) |
| Windows | `WIN_CSC_LINK` (`.pfx`, base64), `WIN_CSC_KEY_PASSWORD` | unsigned |
| Linux | none | AppImage is never signed |

macOS builds use the hardened runtime with `electron/resources/entitlements.mac.plist`
(JIT, unsigned executable memory, dyld environment variables, library validation off,
network client/server). The same file is the inherit entitlements, so the sidecars in
`resources/` are signed with it as well.

### GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes to `dev`: `go vet` / `go test`,
ESLint, `tsc` for web and mobile, and the Node test scripts behind `make test` (including
`make test-stage-agent`). For the agent runtime it adds:

- `agent-stage` (matrix `ubuntu-latest`, `windows-latest`, every PR and push to `dev`, so Windows
  staging is checked without a tag): `node apps/web/electron/stage-agent.mjs`, then
  `node apps/web/electron/smoke-agent.mjs --read-only`, and the staged size per folder in the job
  summary. No `pnpm install`.
- `docker` (pushes to `dev`, and PRs that touch `apps/api` (the Dockerfile, the Go builder's
  sources, the API's agent start-up the smoke checks), `.dockerignore`, the `Makefile`, `apps/agent`,
  the stage scripts, `docker-compose.yml`, `scripts/docker-agent-smoke.sh` or `ci.yml` itself):
  `make docker-agent-smoke` (linux/amd64, in a throwaway BuildKit builder it removes afterwards).

Both use `astral-sh/setup-uv` (pinned SHA, cache keyed on `apps/agent/hermes/uv.lock`) where they
stage, and `agent-stage` caches `apps/web/.cache/agent` under
`agent-python-${{ runner.os }}-${{ hashFiles('apps/agent/hermes/pm/lock.json') }}` (cache keys cannot
hold commas, so they name `runner.os`, never the target list).

`.github/workflows/release.yml` runs on tags `v*` and on `workflow_dispatch`:

1. `prepare` checks that the tag equals `v<apps/web/package.json version>` and creates the
   GitHub Release (`gh release create --generate-notes`) so the matrix jobs never race to create it.
2. `desktop` matrix: `ubuntu-latest` → `linux-x64`; `windows-latest` → `win32-x64`. Releases
   do not include macOS; a mac build is still possible locally with `make dist-desktop` on a Mac.
   Before packing, each stages the agent runtime for its own target
   (`node electron/stage-agent.mjs --target <target>`, with setup-uv and the same
   `agent-python-<runner.os>-<lock hash>` cache as CI) and runs
   `node electron/smoke-agent.mjs --read-only`, so a broken runtime fails before anything is
   published. Then `node electron/pack.mjs --target <target> --publish always|never` with
   `TIMELY_AGENT_STAGED=1` packs that same smoked stage without staging again, `verify-pack.cjs`
   checks the packed copy against its `MANIFEST.json`, and electron-builder
   uploads the installers and `latest*.yml` to the release with `GH_TOKEN`
   (`secrets.GITHUB_TOKEN`). The same files are kept as workflow artifacts.
3. `android` runs `expo prebuild` and `gradlew app:assembleRelease` (arm64-v8a), attaches
   `Timely-<version>-android-arm64.apk` to the release. The mobile app needs no API URL at build
   time; the phone pairs with the desktop at runtime.

`workflow_dispatch` runs build everything with `--publish never` and only produce artifacts.

Secrets (all optional; builds are unsigned without them):

| Secret | Used by |
| --- | --- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | APK release signing (debug key otherwise) |

`GITHUB_TOKEN` is provided by Actions; the workflow asks for `contents: write`.

### First-release caveats (unsigned builds)

- **Windows**: SmartScreen shows "Windows protected your PC". Click *More info* → *Run anyway*.
  The warning goes away once the installer is signed with a certificate that has built reputation.
- **Linux**: `chmod +x Timely-*.AppImage` and run it; AppImage needs FUSE 2 on some distros
  (`libfuse2`), or run with `--appimage-extract-and-run`.
- **Android**: an APK signed with the debug key must be uninstalled before a keystore-signed
  one can be installed (signature mismatch).

### Updates

The desktop app checks GitHub Releases through `electron-updater`, which reads the
`latest.yml` (Windows) and `latest-linux.yml` (AppImage and Arch `.pacman`) assets that
electron-builder uploads next to the installers (plus the `.blockmap` files for differential
downloads). Every tag `v*` therefore has to be published through `release.yml` — an installer
attached by hand without the manifests is invisible to the updater. The `publish` block in
`electron-builder.yml` (`provider: github`, `owner: thalhath2234`, `repo: timely-app`) is what
the updater reads at runtime; `releaseType: release` means electron-builder uploads to the
published release rather than a draft. Releases have no macOS build, so a locally built mac
app finds no `latest-mac.yml` to update from.

The AUR package (`packaging/aur/timely-bin`) extracts the AppImage into `/opt/timely-bin`, so
there is no `$APPIMAGE` and `electron-updater` cannot update it (it would answer "up to date"
forever). Such an install shows "Updated by your package manager" in Settings → Server
instead of the Check for updates button; it is updated with pacman or an AUR helper.

The Arch package on the release (`Timely-X.Y.Z-linux-x64.pacman`, installed with
`sudo pacman -U`) is pacman package `timely` in `/opt/Timely`. It carries `resources/package-type`,
so it is not "managed": `electron-updater` picks its pacman updater, downloads the next `.pacman`
listed in `latest-linux.yml` and runs `pacman -U` through pkexec, which asks for the user's
password. `timely-bin` declares `conflicts=('timely')`, so pacman offers to swap one for the other
instead of installing both. Local builds name theirs `timely-dev` (`electron-builder.local.yml`).

A package upgrade replaces the files under a copy that is still running in the tray. That
copy's Next server keeps the old build manifest in memory but serves `_next/static` from disk,
so its pages point at CSS/JS chunks that no longer exist (an unstyled or white window).
`main.ts` records an install fingerprint at boot (the Next `BUILD_ID` plus the executable's
inode, size and mtime, `supervisor/install.ts`). When it changes, opening Timely (launcher,
tray, a second instance) restarts into the new files, and a check every minute adds
"Restart to finish updating" to the tray with one notification.
