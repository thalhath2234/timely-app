# Timely Web (Next.js)

Desktop web client for the Go API in [`apps/api`](../api). Part of the `timely` monorepo — see the root [README](../../README.md) for setup.

## Run

```bash
make dev-web        # from the repo root → http://localhost:4001
make dev            # API + web together
```

Or directly: `pnpm --filter @timely/web dev`.

## Configuration

Copy `.env.example` to `.env` in this directory. `JWT_SECRET` must match the API's. `API_ORIGIN` (default `http://localhost:8080`) is where `/api-proxy/*` requests are rewritten to (see `next.config.ts`).

## Docs

- [`FEATURES.md`](FEATURES.md) — feature inventory across web, API and mobile
- [`NextPhase.md`](NextPhase.md) — roadmap
- [`docs/adr`](docs/adr) — architecture decisions (canonical copies live in `apps/api/docs/adr`)
