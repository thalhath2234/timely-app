# Timely desktop bundle

How the packaged desktop app hosts the backend and how the phone pairs with it.
Decision record: [ADR 0011](../adr/0011-desktop-hosts-the-backend.md).
Tracking issue: #61.

## Layout of a packaged app

```
<resources>/
  api/timely-api[.exe]        Go API, cross-compiled per target (electron/stage-api.mjs)
  postgres/{bin,lib,share}    PostgreSQL 17 from zonky embedded-postgres (electron/stage-postgres.mjs)
  next-server/                Next.js standalone output (electron/stage-next.mjs)

<userData>/                   app.getPath("userData"): ~/.config/Timely, ~/Library/Application Support/Timely, %APPDATA%\Timely
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
  "allowRegistration": true,
  "setupDone": false,
  "secrets": {
    "jwtSecret": "<safeStorage sealed, base64>",
    "backupKey": "<safeStorage sealed, base64>",
    "dbPassword": "<safeStorage sealed, base64>"
  }
}
```

Secrets are generated on first run (32 random bytes, base64url). When
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

The Next sidecar gets `PORT=webPort`, `HOSTNAME=127.0.0.1`, `API_ORIGIN=http://127.0.0.1:<apiPort>`, `JWT_SECRET`.

## API contract (Phase 1)

`GET /health` (public, no auth):

```json
{
  "status": "ok",
  "version": "0.1.0",
  "db": "ok",
  "migrations": { "version": 20261002130631, "pending": 0 },
  "registrationOpen": true,
  "uptimeSeconds": 42
}
```

Returns 503 with `"status": "degraded"` and `"db": "<error>"` when the database ping fails.

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
`ALLOW_REGISTRATION=false` and at least one account exists.

`/login`, `/register`, `/auth/refresh` are rate limited: 20 requests per minute per IP and 8 per
minute per account (email). Over the limit returns 429 with `Retry-After`.

`POST /agent/providers/rescan` (authenticated) drops the cached CLI detection so the next
`GET /agent/providers` runs detection again.

## Desktop bridge (`window.timelyDesktop`)

Typed in `apps/web/electron-env.d.ts`. The renderer only sees it inside the desktop app.

```ts
timelyDesktop.instance.get(): Promise<DesktopInstance>
timelyDesktop.instance.subscribe((instance) => void): () => void
timelyDesktop.instance.setSetting("tailscaleEnabled" | "allowRegistration", boolean): Promise<DesktopInstance>
timelyDesktop.instance.action("restartApi" | "backupNow" | "openDataFolder" | "openLogs" | "checkForUpdates" | "copyAddress"): Promise<DesktopActionResult>
```

`setSetting("tailscaleEnabled", …)` rebinds the API by restarting only the API sidecar.
`setSetting("allowRegistration", …)` also restarts only the API sidecar.

## Pairing payload

The QR code in Settings → Server encodes JSON:

```json
{ "v": 1, "name": "my-laptop", "urls": ["http://100.101.102.103:48080", "http://127.0.0.1:48080"] }
```

The phone also accepts a bare URL pasted by hand. It calls `GET /health` on each URL in order,
stores the whole list in SecureStore, and remembers the first one that answered. On every
cold start it re-checks, trying the remembered URL first.

## Development

`make dev-desktop` is unchanged: it uses the dev servers on 8080/4001 and no sidecars.
`make build-desktop` / `make dist-desktop` stage the API and Postgres for the host platform
first. `TIMELY_TARGETS=linux-x64,darwin-arm64` stages several targets for CI.

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
2. `desktop` matrix: `ubuntu-latest` → `linux-x64`; `macos-14` → `darwin-x64,darwin-arm64` in
   one job (so one `latest-mac.yml` lists both architectures); `windows-latest` → `win32-x64`.
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
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS code signing |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | APK release signing (debug key otherwise) |

`GITHUB_TOKEN` is provided by Actions; the workflow asks for `contents: write`.

### First-release caveats (unsigned builds)

- **Windows**: SmartScreen shows "Windows protected your PC". Click *More info* → *Run anyway*.
  The warning goes away once the installer is signed with a certificate that has built reputation.
- **macOS**: Gatekeeper refuses an unsigned, un-notarized app. Either right-click the app →
  *Open* → *Open*, or run `xattr -dr com.apple.quarantine /Applications/Timely.app`.
  With `CSC_LINK` + `APPLE_*` set, the DMG is signed and notarized and opens normally.
- **Linux**: `chmod +x Timely-*.AppImage` and run it; AppImage needs FUSE 2 on some distros
  (`libfuse2`), or run with `--appimage-extract-and-run`.
- **Android**: an APK signed with the debug key must be uninstalled before a keystore-signed
  one can be installed (signature mismatch).

### Updates

The desktop app checks GitHub Releases through `electron-updater`, which reads the
`latest.yml` (Windows), `latest-mac.yml` (macOS) and `latest-linux.yml` (AppImage) assets that
electron-builder uploads next to the installers (plus the `.blockmap` files for differential
downloads). Every tag `v*` therefore has to be published through `release.yml` — an installer
attached by hand without the manifests is invisible to the updater. The `publish` block in
`electron-builder.yml` (`provider: github`, `owner: thalhath2234`, `repo: timely-app`) is what
the updater reads at runtime; `releaseType: release` means electron-builder uploads to the
published release rather than a draft. On macOS, update installation requires a signed app;
unsigned builds can detect a new version but cannot replace themselves.
