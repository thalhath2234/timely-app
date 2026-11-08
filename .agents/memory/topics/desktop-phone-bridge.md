---
name: desktop-phone-bridge
description: Research on connecting phone to desktop Timely without Tailscale (Clerk, Cloudflare tunnel, own relay); constraint that users may not own a domain
metadata:
  type: project
  modified: 2026-10-15T09:22:56.038Z
---

2026-10-15, thread "Desktop to phone without Tailscale": user wants Timely to make its own bridge instead of needing the Tailscale app. Report /mnt/project-files/desktop-phone-bridge/report.md.

- Clerk rejected: auth only, carries no traffic; QR pairing already stores the address.
- User constraint: Timely is open source and some users can't afford domains, so per-user domain options (bring-your-own Cloudflare named tunnel) are advanced-only.
- Ruled out: Cloudflare Quick Tunnels (no SSE, address changes), ngrok free (20k req/month), P2P iroh/Hyperswarm (MCP clients can't use them).
- Recommended: project-run "Timely Relay" (SniTun/Nabu Casa style SNI pass-through, end-to-end TLS, Let's Encrypt cert on each desktop, free subdomain per desktop, self-hostable). Needs ADR 0011 revision. Then user asked about paying only for a domain: added option B2 (project domain on Cloudflare + free Worker mints a tunnel per desktop; no server; Cloudflare reads traffic; ~200 desktops on a free zone created after 2024-09-01). Now suggested B2 first, Relay as later upgrade. No pick yet.
