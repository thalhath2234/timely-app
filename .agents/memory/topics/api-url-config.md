---
name: api-url-config
description: How web, desktop and phone find the API, and the runtime API_ORIGIN fix on fix/api-origin-runtime-qlabsa (thread "API URL in the frontend", 2026-10-23)
metadata:
  type: project
  modified: 2026-10-23T15:05:28.959Z
---

User asked (2026-10-23) whether the API URL is hardcoded in the frontend. Answer: no for shipped apps; only dev fallbacks. Full breakdown with file:line in /mnt/project-files/api-url/where-the-api-url-comes-from.md.

- Web: browser calls same-origin `/api-proxy`. On dev the Next rewrite (next.config.ts) was BAKED AT `next build` (routes-manifest.json), so `next start`/Docker ignored a runtime API_ORIGIN. Desktop builds already used the runtime route handler app/api-proxy/[...path]/route.ts.
- Desktop: always runs its own API (127.0.0.1:48080 release / 48090 local builds); no way to point it at another Timely server.
- Phone: release picks server at runtime (QR / pasted URL, SecureStore); dev builds fall back to EXPO_PUBLIC_API_URL, 10.0.2.2:8080 or localhost:8080.
- User picked "Read API_ORIGIN at runtime everywhere" (2026-10-23 14:36). Branch fix/api-origin-runtime-qlabsa pushed (2 commits): rewrite dropped, route handler for every build, https Origin -> X-Forwarded-Proto (API marks cookies Secure from it), Dockerfile copies patches/ + packages/contract and starts next directly, `make test-web-api-proxy`. User opened PR #248 from the Claude Code UI; MERGED into dev 2026-10-23 15:19 on the user's "merge it" (merge commit 70ea89e). Evidence in /mnt/project-files/api-url/ (test-results.txt, before/after PNGs).
- Docker web image on dev did not build at all (missing patches/, packages/contract).

**Why:** a later thread touching Docker, self-hosting or the desktop-phone bridge [desktop-phone-bridge](desktop-phone-bridge.md) needs this without re-asking.
**How to apply:** since #248, /api-proxy is the runtime route handler in every build; never re-add a next.config rewrite for it. Cloud Docker tips are in [cloud-env-testing](cloud-env-testing.md).
