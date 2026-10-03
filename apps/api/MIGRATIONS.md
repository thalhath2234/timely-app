# Database migrations

Schema migrations live in [`apps/api/migrations`](migrations) and use Goose.
The API applies pending migrations when it starts. GORM handles data access;
schema changes belong in SQL migrations.

Run every command below from the repository root. The Makefile loads database
settings from the root `.env`; command-line `DB_*` values override them. See
[setup.md](setup.md) for PostgreSQL and environment setup.

| Command | Effect |
| --- | --- |
| `make migrate-status` | Show applied and pending schema versions. |
| `make migrate-create NAME=add_thing` | Create a timestamped SQL migration. |
| `make migrate-up` | Start the API, which applies pending migrations and keeps serving until stopped. |
| `make migrate-down` | Roll back the latest schema migration. |
| `make migrate-seed` | Apply optional mock data from `migrations/seeds`. |
| `make migrate-unseed` | Roll back the latest seed migration. |

`make migrate-up` is a long-running server command. For ordinary development,
`make dev-api` also applies pending migrations and provides live reload. Use
`make migrate-status` to inspect the result.

## Write a migration

```bash
make migrate-create NAME=add_user_role
```

Edit the generated file under `apps/api/migrations`. Add `-- +goose Up` and
`-- +goose Down` sections. Keep each migration focused and make its Down
section reverse the Up section when reversal is possible. Check the existing
files for the project's schema and naming conventions.

Migrations are embedded in the API binary (`migrations/embed.go`), so the
packaged app applies them from any working directory; the `goose` CLI targets
read the same files from disk. No PostgreSQL extension is required: any
PostgreSQL 15 or newer works (17 recommended). Embeddings are stored as
`real[]`; a database created before that change is converted by
`20261003070129_drop_pgvector.sql` on the next start, and the unused `vector`
extension can then be dropped by hand if nothing else uses it.

## Recovery commands

`make migrate-down` changes the database; check its target and version first.
`make migrate-reset` drops all schema data after an interactive confirmation,
then starts the API to reapply migrations. Use it only on disposable data.
