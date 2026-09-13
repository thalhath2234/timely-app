# Timely monorepo

Three apps, one repo. Run everything from the repo root via `make` (see `make help`).

| Path | What | Stack | Dev port |
| ------------- | ----------------------------- | --------------------------------------- | -------- |
| `apps/api` | REST + MCP backend | Go 1.25, Echo v5, GORM, goose, Postgres | 8080 |
| `apps/web` | Desktop web app + Electron shell | Next.js 16, React 19, Tailwind 4, Electron 44 | 4001 |
| `apps/mobile` | Android/iOS app | Expo SDK 57, expo-router, RN 0.86 | Metro |

## Rules that apply everywhere

- **Package manager:** pnpm workspace (`pnpm-workspace.yaml`), single root `pnpm-lock.yaml`. Never add a per-app lockfile. Run `pnpm install` from the root.
- **Task runner:** the root `Makefile` is the single source of truth for dev/build/lint/test/migrate commands. Add new commands there, not as ad-hoc shell in docs.
- **Env files:** each app has its own `.env` (git-ignored) next to a committed `.env.example`.
- **Go module** is `timely-api` (import paths are `timely-api/internal/...`); run Go commands from `apps/api` or via `make`.
- **Migrations** live in `apps/api/migrations` and run automatically on API start. Use `make migrate-create NAME=...` for new ones.
- **Android builds:** never run Gradle/`expo run:android` directly — use `make build-apk` (see `.agents/skills/build-mobile-apk/SKILL.md`).

## App-specific guidance

Each app has its own `AGENTS.md` with framework caveats — read it before editing that app:

- `apps/web/AGENTS.md` — this Next.js version has breaking changes vs. training data; read `node_modules/next/dist/docs/`. Electron lives in `apps/web/electron` and is started with `make dev-desktop`.
- `apps/mobile/AGENTS.md` — Expo has changed; read the versioned docs for SDK 57.
- `apps/api/setup.md` and `apps/api/MIGRATIONS.md` — API setup and migration workflow.
