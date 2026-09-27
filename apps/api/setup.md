# API setup

The Go API lives in `apps/api`. Run `make` commands from the repository root;
the root [README](../../README.md) covers the other apps.

## Prerequisites

- Go 1.25.7 or newer (see [`go.mod`](go.mod)).
- PostgreSQL with the `vector` extension. `docker compose up -d db` starts the
  repository's pgvector image on port 5432.
- `pnpm` and Make for the repository setup commands.

## Start locally

From the repository root:

```bash
make setup               # dependencies, Go tools, and local env files
docker compose up -d db  # if you do not already run compatible PostgreSQL
make dev-api             # API on :8080, with live reload
```

`make setup` copies `apps/api/.env.example` to the ignored `apps/api/.env` if
needed. Check its database settings and replace `JWT_SECRET` and
`TIMELY_BACKUP_KEY` before using a nonlocal installation. The API applies
pending schema migrations at startup. Embedding search needs an
`OPENROUTER_API_KEY`; keyword search works without it.

For this worktree, use `make dev-worktree-api` to run on port 8081. To run both
API and web on the worktree ports, use `make dev-worktree`. Leave ports 8080 and
4001 for the main checkout.

## Database and maintenance

The API reads `apps/api/.env`; the root Makefile reads the same file for Goose
commands. Use `make migrate-status` to inspect schema versions and
`make migrate-create NAME=add_thing` to add a migration. See
[MIGRATIONS.md](MIGRATIONS.md) for the full workflow. Mock seed data is optional
and can be loaded with `make migrate-seed`.

Timely does not send password reset email. For local account recovery, run:

```bash
make reset-password EMAIL=user@example.com PASSWORD='new-password'
```

The [API collection](api-collections.json) contains sample requests. Run
`make test-api` for Go tests or `make check` for the repository's quality checks.
