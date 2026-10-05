# Timely

Personal time/task management: a Go API, a Next.js web app (also wrapped in Electron), and an Expo mobile app in one pnpm + Make monorepo.

```
timely/
├── apps/
│   ├── api/        Go 1.25 · Echo v5 · GORM · goose migrations · Postgres 15+          :8080
│   ├── web/        Next.js 16 · React 19 · Tailwind 4 · Electron desktop shell          :4001
│   └── mobile/     Expo SDK 57 · expo-router · React Native 0.86
├── packages/
│   └── contract/   Shared TypeScript contract used by web and mobile
├── packaging/aur/  Arch Linux AUR package (timely-bin) for the AppImage
├── scripts/        Repo-level helpers and Node test scripts (build-apk.sh, setup-env.sh, *.test.mjs)
├── docs/           ADRs, desktop bundle docs, QA notes
├── .agents/        Agent skills for Android build and emulator
├── .github/workflows/  ci.yml (PR checks) and release.yml (tagged releases)
├── Makefile        Single entry point for every dev/build/test/db task
├── package.json    Workspace root (scripts alias to make)
├── pnpm-workspace.yaml · pnpm-lock.yaml
└── docker-compose.yml  Postgres + API + web
```

## Install (no programming needed)

Timely runs on your own computer. Two downloads, nothing else:

1. **Timely desktop** from the [latest release](https://github.com/thalhath2234/timely-app/releases/latest): `.exe` installer (Windows), `.AppImage` (Linux; on Arch, the `timely-bin` AUR package), or `.dmg` (macOS). On first launch it creates its own database, starts its server, and opens the app. Create your account; the setup steps that follow are optional.
2. **Timely on your phone** (Android `.apk` from the same release). Open it, tap *Scan QR code*, and scan the code in the desktop app under **Settings → Server**. Sign in with the same account.

To use the phone away from home, install [Tailscale](https://tailscale.com/download) on both devices and sign them into the same tailnet, then turn on *Allow my Tailscale devices to connect* in **Settings → Server**. Nothing is exposed to your Wi‑Fi or the internet; the phone reaches the computer only through the tailnet. Closing the desktop window keeps the server running in the tray; *Quit Timely* stops it. Updating the desktop app keeps your data and takes a backup first.

On Linux the AppImage needs FUSE (`libfuse2` on Debian/Ubuntu, `fuse2` on Arch); without it, run it as `./Timely-*.AppImage --appimage-extract-and-run`. The first Windows and macOS releases are not code-signed: Windows shows a SmartScreen prompt (*More info → Run anyway*); macOS needs right-click → *Open* once. Details: [`docs/desktop/README.md`](docs/desktop/README.md).

## Prerequisites (developers)

- Node ≥ 22 and pnpm 11 (`corepack enable` picks up the pinned `pnpm@11.15.1` from `package.json`)
- Go 1.25.7+ (see `apps/api/go.mod`); `make setup` installs `air` and `goose` into your Go bin, so keep `$(go env GOPATH)/bin` on `PATH`
- PostgreSQL 15 or newer, 17 recommended (or Docker, for `docker compose up -d db`)
- GNU Make and Bash (on Windows use WSL or Git Bash)
- For mobile: Android SDK, JDK 17 (`~/.local/jdk-17`), Expo Go or an emulator

## Quick start

```bash
git clone https://github.com/thalhath2234/timely-app.git && cd timely-app
make setup                 # pnpm install, go mod download, install air + goose, create .env from .env.example
docker compose up -d db    # Postgres 17 on :5432 (skip if you run your own PostgreSQL 15+)
make dev                   # API (:8080, live reload) + web (:4001) together
```

Then open http://localhost:4001 and create an account. Other ways to run it:

```bash
make dev-desktop      # API + web + Electron window
make dev-mobile       # Expo/Metro dev server (:8082) for Expo Go or an emulator
make check            # lint + typecheck + tests, the same checks CI runs on PRs
```

`make dev` uses ports 8080 and 4001. In a second checkout or git worktree, use
`make dev-worktree` for API 8081 and web 4002; those targets set the ports and
the web server's API origin together. Leave 8080 and 4001 for the main checkout,
and set `DB_SCHEMA=<name>` in that worktree's `.env` if its API must not share
chat runs and jobs with the main one.

All three apps read one `.env` at the repository root: DB credentials, the
JWT secret, and the mobile `EXPO_PUBLIC_API_URL`. Before first use, replace
`JWT_SECRET` and `TIMELY_BACKUP_KEY` with random values (`openssl rand -base64 32`);
`OPENROUTER_API_KEY` is optional and enables semantic search and the in-app
chat model. Edit it as needed and restart the dev servers afterwards. The file is copied into compatible managed
worktrees via `.worktreeinclude`; run `make setup-env` to seed it explicitly.
Migrations run automatically when the API starts.

## Common tasks

| Command                                 | What it does                                                   |
| --------------------------------------- | -------------------------------------------------------------- |
| `make dev-api` / `dev-web` / `dev-mobile` / `dev-desktop` | Run a single app, or the Electron desktop shell |
| `make dev-worktree`                   | API on 8081 and web on 4002 in this worktree                |
| `make build`                            | Build the API binary and the web app                           |
| `make build-desktop`                    | Unpacked Electron app for this OS, with the API and Postgres sidecars |
| `make dev-desktop-hosted`               | Electron in hosted mode (own Postgres + API) against a throwaway data dir |
| `make dist-desktop`                     | Electron installer (AppImage / dmg / nsis)                     |
| `make build-apk`                        | Android release APK under a 12 GB memory cap; waits for the detached build. The phone pairs at runtime; `API_URL=…` only sets a dev default |
| `make apk-status`                       | Status/log of the detached APK build                           |
| `make emu-start` / `emu-stop`           | Android emulator under a 3G cgroup cap (1536 MB guest)         |
| `make check`                            | `lint` + `typecheck` + `test` across apps                      |
| `make migrate-status` / `migrate-down`  | Inspect / roll back goose migrations                           |
| `make migrate-create NAME=add_thing`    | New SQL migration in `apps/api/migrations`                     |
| `make migrate-seed`                     | Load mock data from `apps/api/migrations/seeds`                |
| `make reset-password EMAIL=… PASSWORD=…`| Local account recovery (Timely sends no email)                 |
| `make help`                             | Full list                                                      |

`pnpm dev`, `pnpm lint`, etc. at the root are thin aliases to the same `make` targets.

## Releases

Releases are built by GitHub Actions when a `vX.Y.Z` tag is pushed on `main`:
Windows `.exe`, Linux AppImage, macOS `.dmg`/`.zip` and the Android APK, all on
one GitHub Release. The version lives in `apps/web/package.json`. Step by step,
including the AUR update and signing secrets: [`package.md`](package.md).

## Per-app docs

- API: [`apps/api/setup.md`](apps/api/setup.md), [`apps/api/MIGRATIONS.md`](apps/api/MIGRATIONS.md), Postman/Bruno collection in `apps/api/api-collections.json`
- Web: [`apps/web/FEATURES.md`](apps/web/FEATURES.md)
- Mobile: [`apps/mobile/README.md`](apps/mobile/README.md) (API URL, emulator networking)
- Domain language: [`CONTEXT.md`](CONTEXT.md); decisions: [`docs/adr/`](docs/adr/)
- Desktop bundle (sidecars, pairing, release): [`docs/desktop/README.md`](docs/desktop/README.md)

## Docker

```bash
docker compose up db          # Postgres 17 on :5432
docker compose up --build     # db + api (:8080) + web (:4001)
```

## Notes on the workspace

- pnpm uses isolated `node_modules` (its default). Expo ≥ 54 supports this; if a React Native library ever fails to resolve, set `nodeLinker: hoisted` in `pnpm-workspace.yaml` and reinstall.
- `apps/mobile/android` is generated (`npx expo prebuild`) and git-ignored; the APK script requires it to exist.
- Git history of the three original repositories (`timely`, `timely-api`, `timely-mobile`) is preserved via subtree merges.
