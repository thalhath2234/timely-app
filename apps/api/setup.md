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

`make setup` copies the root `.env.example` to the ignored root `.env` if
needed. Check its database settings and replace `JWT_SECRET` and
`TIMELY_BACKUP_KEY` before using a nonlocal installation. The API applies
pending schema migrations at startup. Embedding search needs an
`OPENROUTER_API_KEY`; keyword search works without it.

For this worktree, use `make dev-worktree-api` to run on port 8081. To run both
API and web on the worktree ports, use `make dev-worktree`. Leave ports 8080 and
4001 for the main checkout.

## Database and maintenance

The API reads the root `.env`; the root Makefile reads the same file for Goose
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


## In-app agent

Chat uses the server's `OPENROUTER_API_KEY` and defaults to
`OPENROUTER_CHAT_MODEL=z-ai/glm-5.3-flash`, with low reasoning effort for interactive tool use. The key is never returned to the web or
Electron renderer. Startup migrations create conversation storage and enable
agent notifications. Agent execution runs separately from reminder jobs. Model
requests allow up to four minutes and retry one transient timeout or truncated
response within the ten-minute run limit. Worker heartbeats keep long requests
leased and cancel them when stopped. Domain writes are never retried by the
provider adapter.

Open Chat in the sidebar or use Ctrl/Cmd+Shift+J from another screen. Proposed
multi-step changes wait for Apply; navigation does not stop a run. See the
[feature design](../../docs/ai-agent-design.md) for behavior and checks.

Chat image uploads use an account-scoped temporary directory, by default
`$TMPDIR/timely-chat-images` (or `/tmp/timely-chat-images`). `CHAT_IMAGE_DIR` can
point to a dedicated private directory shared by API workers on the same server.
Keep it outside backups and public/static file serving. Uploaded images are not
stored in PostgreSQL; do not place unrelated files in this directory. Access expires
24 hours after upload; cleanup runs on startup and every minute. Confirming or
Discarding a review removes the images immediately. An unavailable temporary file
requires re-uploading, but extracted drafts and completed writes remain in chat.

OpenRouter receipt/image requests enforce ZDR-only routing. Leave OpenRouter's
optional input/output logging and data-sharing settings disabled. Provider availability
is checked by the real request; the app reports a retryable error rather than falling
back to a retaining provider. Private image chats do not use web search.
