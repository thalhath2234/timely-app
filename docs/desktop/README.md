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

<userData>/                   app.getPath("userData"): ~/.config/Timely, ~/Library/Application Support/Timely, %APPDATA%\Timely ("Timely Dev" for local builds, see Local builds)
  config.json                 non-secret settings + sealed secrets (see Config)
  postgres/data               PGDATA (initdb on first run)
  data/backups/<account>/     encrypted account backups written by the API (TIMELY_BACKUP_DIR)
  data/chat-images/           chat uploads (CHAT_IMAGE_DIR)
  backups/pre-upgrade-*/      folder copy of PGDATA taken before the first run of a new version (last 3 kept)
  backups/manual-*/           folder copies from "Back up now" (the database pauses for a moment)
  logs/                       sidecar logs
```

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
timelyDesktop.instance.setSetting("tailscaleEnabled" | "tailscaleHttps" | "allowRegistration", boolean): Promise<DesktopInstance>
timelyDesktop.instance.action("restartApi" | "backupNow" | "openDataFolder" | "openLogs" | "checkForUpdates" | "copyAddress"): Promise<DesktopActionResult>
```

`setSetting("tailscaleEnabled", …)` rebinds the API by restarting only the API sidecar.
`setSetting("allowRegistration", …)` also restarts only the API sidecar.
`setSetting("tailscaleHttps", …)` changes Tailscale Serve and leaves the API running.

Confirm dialogs move the mouse pointer onto their Cancel button when they open, like
Windows' "Snap To" setting. The page passes the button's centre in CSS pixels; the main
process converts it to screen coordinates and moves the pointer only while the window is
focused and the point is inside it (`electron/pointer.ts`, through the koffi FFI module):
SetCursorPos on Windows and XWarpPointer on Linux under X11. Wayland sessions don't let
apps move the pointer, and macOS isn't supported, so there it does nothing.

```ts
timelyDesktop.snapPointer(x: number, y: number): void
```

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
`make build-desktop` / `make dist-desktop` stage the API and Postgres for the host platform
first. `TIMELY_TARGETS=linux-x64,darwin-arm64` stages several targets for CI.

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
then three staging steps, then electron-builder.

| Step | Script | Output | Source |
| --- | --- | --- | --- |
| Next | `electron/stage-next.mjs` | `.electron-next/` | `.next/standalone` + `.next/static` + `public` |
| API | `electron/stage-api.mjs` | `.electron-api/<os>-<arch>/timely-api[.exe]` | `go build` of `apps/api/cmd`, `CGO_ENABLED=0 -trimpath -ldflags "-s -w -X main.version=<package.json version>"` |
| Postgres | `electron/stage-postgres.mjs` | `.electron-postgres/<os>-<arch>/{bin,lib,share}` | zonky `embedded-postgres-binaries-<classifier>-17.11.0.jar` from Maven Central |

`<os>-<arch>` is electron-builder's `${os}-${arch}` (`linux-x64`, `linux-arm64`, `mac-x64`,
`mac-arm64`, `win-x64`), so the static `extraResources` in `electron-builder.yml` copies the right
staged tree into `resources/api` and `resources/postgres` for whatever platform/arch is being built.

### Targets

The target table lives in `electron/targets.mjs`, keyed `linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`, `win32-x64` (`process.platform`-`process.arch`). Each entry carries the Go
`GOOS/GOARCH`, the zonky Maven classifier, the name of the `.txz` inside the jar and the jar's
SHA-256.

- Default: the host target.
- `TIMELY_TARGETS=linux-x64,darwin-arm64` stages several targets (any script, any OS; Go cross-compiles and the zonky jars are plain downloads).
- `node electron/pack.mjs --target darwin-x64,darwin-arm64` stages those targets and adds the matching electron-builder flags (`--mac --x64 --arm64`). One OS per run; electron-builder expands `${os}` once per platform. Every other argument is passed to electron-builder (`--dir`, `--publish never`, ...).
- `TIMELY_SKIP_NEXT=1` reuses the existing `.next` build while iterating on packaging.

Both stage scripts can be run on their own: `node electron/stage-api.mjs`,
`node electron/stage-postgres.mjs`.

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

`.electron-api/`, `.electron-postgres/` and `.cache/` are git-ignored (`apps/web/.gitignore`).

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
ESLint, `tsc` for web and mobile, and the Node test scripts behind `make test`. No database.

`.github/workflows/release.yml` runs on tags `v*` and on `workflow_dispatch`:

1. `prepare` checks that the tag equals `v<apps/web/package.json version>` and creates the
   GitHub Release (`gh release create --generate-notes`) so the matrix jobs never race to create it.
2. `desktop` matrix: `ubuntu-latest` → `linux-x64`; `windows-latest` → `win32-x64`. Releases
   do not include macOS; a mac build is still possible locally with `make dist-desktop` on a Mac.
   Each runs `node electron/pack.mjs --target <targets> --publish always|never` and electron-builder
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
