---
name: hosting-options
description: Ways to host Timely on dev as of 2026-10-30 (desktop app, docker compose, bare binaries, make dev) and the gaps found; thread "Find ways to host Timely"
metadata:
  type: project
  modified: 2026-10-30T11:06:04.906Z
---

2026-10-30, thread "Find ways to host Timely": user asked how they can host the app with the current setup. Answer (from dev e25f1a2):

1. Desktop app (ADR 0011): own Postgres + API + Next; phone via QR + Tailscale. Next sidecar is loopback-only, so no other computer gets the web UI. Release builds Windows x64 + Linux x64 only.
2. `docker compose up --build -d` (db + api :8080 + web :4001) on any always-on box; needs root .env with JWT_SECRET, TIMELY_BACKUP_KEY, DB_PASSWORD. Phone pastes the API URL (Settings > Server/QR is desktop-only in web).
3. `make build` binaries + `next start` + own Postgres 15+ (no make target or systemd unit for it).
4. `make dev` (dev only).

Gaps found (offered as a follow-up, no answer yet): no published Docker images, compose has no `restart:` policy, publishes 8080/4001 on all interfaces over plain HTTP, no TLS/Caddy service, local agent CLIs (Claude Code/Codex) not in the API image. Untested ideas mentioned: Tailscale Funnel (public https ts.net address, no domain), Cloudflare Tunnel or Caddy on a VPS (needs a domain; DuckDNS is free).

**Why:** a later thread on self-hosting, Docker or the bridge [desktop-phone-bridge](desktop-phone-bridge.md) should not re-research this.
**How to apply:** check the gaps above are still true before proposing fixes; API URL details in [api-url-config](api-url-config.md).
