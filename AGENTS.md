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
- **Env file:** one `.env` at the repo root (git-ignored) next to a committed `.env.example`, shared by all three apps, the Makefile and docker-compose. Never add a per-app `.env`. Restart the dev servers after editing it.
- **Go module** is `timely-api` (import paths are `timely-api/internal/...`); run Go commands from `apps/api` or via `make`.
- **Migrations** live in `apps/api/migrations` and run automatically on API start. Use `make migrate-create NAME=...` for new ones.
- **Android builds:** never run Gradle/`expo run:android` directly — use `make build-apk` or `make install-apk` (see `.agents/skills/build-mobile-apk/SKILL.md`).
- **Android emulator:** never run `emulator`/`qemu` directly — use `make emu-start` / `make emu-stop` (3G cgroup cap; see `.agents/skills/android-emulator/SKILL.md`). Stop the emulator when the check is done.
- **UI changes:** load the Design skill (the `design:*` skills, e.g. `design:design-system`, `design:design-critique`) before changing any web or mobile UI.
- **Animations:** build them with the Remotion skill (`remotion:remotion-best-practices` routes to the rest).
- **Releases:** when merging `dev` into `main` for a new release, title the merge commit `Release vX.Y.Z` (e.g. `gh pr merge <n> --merge --subject "Release v0.3.5"`).
- **Worktree development testing: ** Always run the frontend server on 4002 and API on 8081 if a process is already using these ports, stop the process and run the dev server. Never touch 8080 and 4001. Set `DB_SCHEMA=<name>` on the worktree API when it must not share chat runs and jobs with the main checkout (both poll the same tables otherwise).

## App-specific guidance

Each app has its own `AGENTS.md` with framework caveats — read it before editing that app:

- `apps/web/AGENTS.md` — this Next.js version has breaking changes vs. training data; read `node_modules/next/dist/docs/`. Electron lives in `apps/web/electron` and is started with `make dev-desktop`.
- `apps/mobile/AGENTS.md` — Expo has changed; read the versioned docs for SDK 57.
- `apps/api/setup.md` and `apps/api/MIGRATIONS.md` — API setup and migration workflow.

## Project memory

`.agents/memory/` is the memory every agent shares, whatever tool it runs in: the owner's standing rules, how they want work done, hard-won gotchas, and the state of unfinished work. `MEMORY.md` is the index; each `topics/<name>.md` holds one subject. Use it in place of any per-tool private memory (such as Claude Code's auto memory) for this project.

- **Read** `.agents/memory/MEMORY.md` at the start of every task, then the topic notes for what the task touches. Index links miss some notes: `grep -ril <word> .agents/memory/topics` finds the rest. Its rules bind like this file. Status lines are snapshots, so confirm them against code, git and GitHub before acting on one.
- **Write** when you learn something the next agent would otherwise rediscover the hard way: a rule or preference the owner states, a correction, a non-obvious gotcha, a decision and its reason, the state of work you leave unfinished. Code, git history and docs already record the rest.
- **Update** the closest existing note first. A new note is `topics/<kebab-name>.md` with frontmatter `name`, `description` (one line, used to judge relevance), `metadata.type` (`user`, `feedback`, `project` or `reference`) and `metadata.modified`; `feedback` and `project` notes end with **Why:** and **How to apply:** lines. Then add or edit its one line in `MEMORY.md` under the fitting heading, keeping the index to one line per entry. Write absolute dates. Fix or delete notes that prove wrong, and mark finished work done.
- **Commit** memory edits on the branch whose work they describe.
- **Public:** this repo is public. Name the env var or file that holds a secret; the value, passwords, tokens and auth headers stay out.
