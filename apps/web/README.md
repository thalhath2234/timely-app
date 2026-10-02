# Timely Web (Next.js)

Desktop web client for the Go API in [`apps/api`](../api). Part of the `timely` monorepo — see the root [README](../../README.md) for setup. The same Next.js app is also the renderer for the Electron desktop shell in [`electron/`](electron/).

## Run

```bash
make dev-web          # from the repo root → http://localhost:4001
make dev              # API + web together
make dev-desktop      # API + web + Electron window
make dev-worktree     # API :8081 + web :4002 in this worktree
```

## Electron

The main process (`electron/main.ts`) loads the Next.js app over HTTP so server components, session cookies, and `/api-proxy` rewrites keep working.

| Command | What it does |
| --- | --- |
| `make dev-desktop` | API + Next.js on :4001 + Electron |
| `make build-desktop` | Unpacked app in `apps/web/release/<platform>-unpacked` |
| `make dist-desktop` | Installer for this OS (AppImage / dmg / nsis) |

A packaged build embeds a Next.js standalone server. It still talks to the Go API (`API_ORIGIN`, default `http://127.0.0.1:8080`). Put `JWT_SECRET` and `API_ORIGIN` in the root `.env` for development, or in the app user-data `.env` / `ELECTRON_RENDERER_URL` to point at an already-running web server.

## Configuration

The web app reads the repository-root `.env` (loaded in `next.config.ts`), so `JWT_SECRET` is the same value the API uses. `API_ORIGIN` (default `http://localhost:8080`) is where `/api-proxy/*` requests are rewritten to (see `next.config.ts`).

`make dev-worktree` sets `API_ORIGIN=http://localhost:8081` for its web server.

## Docs

- [`FEATURES.md`](FEATURES.md) — feature inventory across web, API and mobile
- [`NextPhase.md`](NextPhase.md) — roadmap
- [`docs/adr`](docs/adr) — architecture decisions (canonical copies live in `apps/api/docs/adr`)
