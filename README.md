# Timely

Personal time/task management: a Go API, a Next.js web app (also wrapped in Electron), and an Expo mobile app in one pnpm + Make monorepo.

```
timely/
├── apps/
│   ├── api/        Go 1.25 · Echo v5 · GORM · goose migrations · Postgres (pgvector)   :8080
│   ├── web/        Next.js 16 · React 19 · Tailwind 4 · Electron desktop shell          :4001
│   └── mobile/     Expo SDK 57 · expo-router · React Native 0.86
├── scripts/        Repo-level shell helpers (build-apk.sh)
├── .agents/ .cursor/   Agent skills (memory-capped Android build)
├── Makefile        Single entry point for every dev/build/test/db task
├── package.json    Workspace root (scripts alias to make)
├── pnpm-workspace.yaml · pnpm-lock.yaml
└── docker-compose.yml  Postgres + API + web
```

## Prerequisites

- Node ≥ 22 and pnpm 11 (`corepack enable` or `npm i -g pnpm`)
- Go 1.25+
- PostgreSQL 14+ with the `vector` extension (or `docker compose up db`)
- For mobile: Android SDK, JDK 17 (`~/.local/jdk-17`), Expo Go or an emulator

## Quick start

```bash
make setup            # pnpm install, go mod download, install air + goose, create .env files from examples
make dev              # API (:8080, live reload) + web (:4001) together
make dev-desktop      # API + web + Electron window
make dev-mobile       # Expo/Metro dev server
```

Edit `apps/api/.env` (DB credentials, JWT secret), `apps/web/.env`, and `apps/mobile/.env` (`EXPO_PUBLIC_API_URL`) as needed. Migrations run automatically when the API starts.

## Common tasks

| Command                                 | What it does                                                   |
| --------------------------------------- | -------------------------------------------------------------- |
| `make dev-api` / `dev-web` / `dev-mobile` / `dev-desktop` | Run a single app, or the Electron desktop shell |
| `make build`                            | Build the API binary and the web app                           |
| `make build-desktop`                    | Unpacked Electron app for this OS                              |
| `make dist-desktop`                     | Electron installer (AppImage / dmg / nsis)                     |
| `make build-apk [API_URL=https://…]`    | Android release APK, detached under a 12 GB memory cap         |
| `make apk-status`                       | Status/log of the detached APK build                           |
| `make check`                            | `lint` + `typecheck` + `test` across apps                      |
| `make migrate-status` / `migrate-down`  | Inspect / roll back goose migrations                           |
| `make migrate-create NAME=add_thing`    | New SQL migration in `apps/api/migrations`                     |
| `make migrate-seed`                     | Load mock data from `apps/api/migrations/seeds`                |
| `make reset-password EMAIL=… PASSWORD=…`| Local account recovery (Timely sends no email)                 |
| `make help`                             | Full list                                                      |

`pnpm dev`, `pnpm lint`, etc. at the root are thin aliases to the same `make` targets.

## Per-app docs

- API: [`apps/api/setup.md`](apps/api/setup.md), [`apps/api/MIGRATIONS.md`](apps/api/MIGRATIONS.md), Postman/Bruno collection in `apps/api/api-collections.json`
- Web: [`apps/web/FEATURES.md`](apps/web/FEATURES.md), [`apps/web/NextPhase.md`](apps/web/NextPhase.md)
- Mobile: [`apps/mobile/README.md`](apps/mobile/README.md) (API URL, emulator networking)

## Docker

```bash
docker compose up db          # Postgres 17 + pgvector on :5432
docker compose up --build     # db + api (:8080) + web (:4001)
```

## Notes on the workspace

- pnpm uses isolated `node_modules` (its default). Expo ≥ 54 supports this; if a React Native library ever fails to resolve, set `nodeLinker: hoisted` in `pnpm-workspace.yaml` and reinstall.
- `apps/mobile/android` is generated (`npx expo prebuild`) and git-ignored; the APK script requires it to exist.
- Git history of the three original repositories (`timely`, `timely-api`, `timely-mobile`) is preserved via subtree merges.
