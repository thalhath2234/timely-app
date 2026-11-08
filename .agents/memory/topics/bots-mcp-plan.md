---
name: bots-mcp-plan
description: Bots Part I (2026-11-06) - bots use any remote MCP server, token or OAuth sign-in; Timely is the MCP client; written in the bots doc, nothing built, 4 questions answered yes 2026-11-06
metadata:
  type: project
  modified: 2026-11-06T17:23:48.517Z
---

2026-11-06 user: "bot should be able to access any MCP. if it require auth i should be able to setup that too. with auth token or sign in. ponder on this". Written as "Part I: bots that use other apps through MCP" in the bots doc (https://claude.ai/artifact/UKMDCSdYWygy9i9dnHekUy), between Part G and "Safety, limits and AI costs". Sketches (light+dark): /mnt/project-files/bots-plan/sketches/mcp/ (desktop-integrations, desktop-add-signin with mismatch warning, desktop-add-tools, phone-service; source/ has HTML).

Recommendation: I1 + I3 first, then I4 + I5 + I6, then I2.
- I1 Timely is the MCP client (go-sdk v1.8.0 client, Streamable HTTP). Bots use a "Tool watch" (B8): one fixed call + args picked in the bot editor, plain code diffs, C2 judge reads result as quoted data. No model reads tool text in phase 1.
- I3 paste token (header choice, sealed in Secure Store with TIMELY_VAULT_KEY, write-only, no redirects).
- I4 OAuth sign-in: CIMD/DCR, PKCE S256 checked via auth.GetAuthServerMetadata, system browser, loopback callback on API 127.0.0.1 (/oauth/mcp/callback, cookie + one-use state). Sign-in-server-not-service-domain warning. Timely's own refresher with Postgres row lock; unattended runs never sign in.
- I5 your own OAuth app (Asana V2, Google need it). I6 checked Popular list (~12, pinned issuers), registry search phase 4.
- I2 AI picks reads (phase 3) with egress rule: after reading Timely data or another service result, MCP calls become approval cards in chat, refused in research bots. Ask me first tools only in chat.
- Tool choices Can use / Ask me first / Off; unchecked services start all Off; fingerprints pin full definitions; refuse tk_ tokens + serverInfo "timely" + own ports; shared netguard from linkpreview.
- Settings > Integrations: "Apps Timely can use" above "Apps that use Timely". Phone: status/Off/review only; adds and sign-ins on PC at first.
- I7 stdio programs = phase 5 desktop only (was parked); I8 CLI mcp config, I9 gateway-only, I10 mcp-remote, I11 bots changing other apps alone: rejected.
- Phases: docs/ADR -> shared vault+netguard step (with Part F) -> P1 tokens+Tool watches (~3 wk) -> P2 sign-in (~2-3 wk) -> P3 AI reads -> P4 reach.

Owner answered YES to all 4 on 2026-11-06 (applied in doc): stdio programs = phase 5, desktop only; host CIMD JSON on GitHub Pages (phase 2; small public repo while main repo private, Pages on private needs paid plan); server/Docker installs get tokens+sign-ins in phase 4 with TIMELY_VAULT_KEY + https address (callback on that address, DCR or own app since CIMD lists loopback only); bots may PROPOSE changes in other apps from phase 4 (user applies, 7-day expiry, never auto-applied). Still open: overall picks for Parts A-G and I.

**Why:** a later thread building MCP access starts here. **How to apply:** build only after the user picks; see [autonomous-bots-plan](autonomous-bots-plan.md), [bots-secure-signin-plan](bots-secure-signin-plan.md), [pr-confirm-rule](pr-confirm-rule.md), [model-key-for-tests](model-key-for-tests.md).
