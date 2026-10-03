# Desktop bundle verification (issue #61, Phase 7)

Automated checks run with `make check`. The checks below need a machine per OS and are
recorded here with their status; update the table when a run happens.

## Automated

| Target | What it proves |
| --- | --- |
| `make test-api` | `/health`, `/instance`, `ALLOW_REGISTRATION`, rate limits, `real[]` vector round-trip and cosine ranking, data-dir resolution |
| `make test-electron-supervisor` | config and secret generation, port allocation, Tailscale address classification, restart backoff, stale `postmaster.pid` handling, pairing order |
| `make test-mobile-server-config` | QR payload parsing, server preference order, reachability probe ordering and timeouts |
| `make test-desktop-instance` | Settings → Server helpers |
| `make test-electron-guards` | window-open origin policy (unchanged) |

## Manual, per operating system

Run on a fresh machine (or VM) with only Tailscale installed. Fill in the date and build.

| Step | Linux x64 | macOS arm64 | macOS x64 | Windows x64 |
| --- | --- | --- | --- | --- |
| Install from the release asset and launch | | | | |
| First run: boot screen shows Database → Server → App, then the login page | | | | |
| Create the first account; setup wizard appears; skip Tailscale, skip key, Re-scan shows CLI state | | | | |
| Settings → Server shows local address, data folder, versions, QR | | | | |
| Turn on Tailscale access; Tailscale address appears; API restarts in a few seconds | | | | |
| Phone on the same tailnet: install APK, scan QR, sign in, create a task, it appears on the desktop | | | | |
| Close the desktop window; the phone still loads the task list | | | | |
| Reopen from the tray; Quit Timely; the phone shows the offline banner | | | | |
| Upgrade: install N+1 over N; a `backups/pre-upgrade-*` folder exists; data intact | | | | |
| Crash: kill `postgres` and `timely-api` from a task manager; Settings → Server shows "restarting" then "running" | | | | |
| Elevated/root launch is refused with a plain-language message | | | | |

## Linux run on the development machine (2026-10-03)

Hosted mode from the checkout (`make dev-desktop-hosted` under Xvfb, throwaway user-data
directory, staged linux-x64 sidecars), driven over the Chrome DevTools protocol.

| Check | Result |
| --- | --- |
| First run: secrets generated, `initdb`, `timely` database created in single-user mode, Postgres → API → Next ready in about 2 s, all three bound to 127.0.0.1 only | pass |
| `GET /health` 200 with migration state; `POST /register`; `GET /instance` with a bearer token matches the contract | pass |
| Web proxy: `/api-proxy/login` through the packaged Next server reaches the app's own API and sets both cookies (runtime proxy route, not the baked rewrite) | pass |
| Sign in → onboarding → setup wizard (4 steps) → Finish sets `setupDone` → calendar | pass |
| Settings → Server: status cards, connection check, addresses, QR, toggles, maintenance buttons render with live data | pass |
| "Back up now": Postgres pauses, `backups/manual-*` folder copy written, Postgres back in under a second, API recovers | pass |
| Crash: `kill -9` on the API pid → restarted after 1 s (attempt 1/5), `/health` answers again | pass |
| Upgrade: config version 0.0.9 with app 0.1.0 → `backups/pre-upgrade-0.0.9-0.1.0-*` copied before Postgres started; data intact (login still works) | pass |
| SIGTERM to Electron: Next → API → Postgres stopped in order, ports released, no orphan processes | pass |
| Settings → Agent: Claude Code found through the login-shell PATH, Re-scan and install links present | pass |
| Tailscale access on: the API binds 127.0.0.1 plus the host's Tailscale IPv4 and IPv6 addresses on the same port; off again drops them (AppImage run, `tailscale status` on the host) | pass |
| Physical phone (Android, Redmi 12 5G on the same tailnet): release APK installed, QR scanned from Settings → Server, sign-in and chat over `http://100.76.98.105:48080` | pass (needed the cleartext config plugin) |
| Agent runs started from the phone: the "lookup failed twice" and "proposal step isn't available" replies came from Claude Code calling Timely tools natively (`No such tool available`), not from the network path; the provider now runs those rejected calls | pass after fix |
| Android release APK: `make build-apk` without `API_URL`, fresh `expo prebuild` with the camera module, release bundle check (no dev URLs, `/connect` present) | pass |
| macOS, Windows, code signing (whether electron-builder signs the sidecar binaries under resources/ is unverified), electron-updater against a real release | open |
