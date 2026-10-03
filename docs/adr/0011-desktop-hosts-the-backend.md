# The desktop app hosts the backend; the phone pairs over Tailscale

- Status: Accepted
- Date: 2026-10-03

Timely desktop is a self-contained install. The Electron main process supervises three sidecars: a bundled PostgreSQL 17 server, the Go API, and the Next.js server. They boot in that order before the window opens, keep running while the window is hidden, and stop in reverse order on Quit. A person installs one desktop file and one mobile file and is done; no Docker, no terminal, no `.env`.

**Reachability is Tailscale-only.** The API binds `127.0.0.1` and, when the person enables it in Settings → Server, the host's Tailscale IPv4 and IPv6 addresses (`API_BIND`). Nothing is exposed to the LAN or the internet. The phone scans a QR code from Settings → Server that lists the Tailscale address first and the loopback address second, and tries them in order on every launch. HTTP inside the WireGuard tunnel is acceptable; the mobile connect screen says so.

**pgvector is dropped.** Embeddings are stored as `real[]`; cosine similarity runs in Go over a per-account in-memory cache that is invalidated on upsert, delete, and reindex. Brute force is fine at personal scale (ADR 0001: one person per account) and removes the only per-platform native database build. Any PostgreSQL 17 works, including the plain `postgres:17` image.

**Secrets are generated, not configured.** The JWT secret, backup key and database password are created on first run and kept in the Electron user-data directory (`config.json`, secrets sealed with `safeStorage`). The root `.env` remains a developer convenience only; a packaged app never reads it. `TIMELY_DATA_DIR` roots the backup and chat-image directories so every file the API writes lives next to the database.

**Upgrades back up first.** When the installed version differs from the stored one, the supervisor copies the whole PostgreSQL data folder to `backups/` before PostgreSQL starts and the new API applies migrations, and keeps the last three pre-upgrade copies. The bundled PostgreSQL ships only `initdb`, `pg_ctl` and `postgres` (no `pg_dump`), and a cold folder copy is a complete, restorable backup: quit Timely, swap the folder back, start again. "Back up now" takes the same copy after pausing the database for a moment; per-account encrypted backups through the API remain the everyday export.

**ADR 0009 holds.** The UI never supplies a CLI path. The desktop resolves the login-shell `PATH` and `HOME` on macOS and Linux and passes them to the API sidecar so `claude` and `codex` are found the same way a terminal would find them. Settings → Agent gains a "Re-scan" button and install links, not a path field.

## Considered Options

- **Hosted relay or cloud backend**: rejected; Timely stores private planning data and the project runs no infrastructure.
- **LAN exposure with a toggle**: rejected; a LAN listener needs TLS, a firewall story and a threat model for coffee-shop networks. Tailscale gives authenticated, encrypted reachability from anywhere with one install.
- **Keep pgvector and ship per-platform builds**: rejected; it would make the Postgres sidecar a custom build for four targets to save milliseconds on a few thousand vectors.
- **Docker Desktop as the runtime**: rejected; it is a second install with its own licence prompts and does not exist on most phones' owners' laptops.
- **Run the backend as a system service that outlives the app**: out of scope; closing the window keeps the sidecars alive, quitting the app stops them.
