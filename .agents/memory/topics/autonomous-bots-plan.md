---
name: autonomous-bots-plan
description: Thread "Design autonomous user-made bots" (2026-11-02) - plan doc options A-G + I for user-made bots; user picked ALL RECOMMENDED 2026-11-06 and said start building
metadata:
  type: project
  modified: 2026-11-04T00:03:05.396Z
---

Doc: "Timely bots: how to build user-made autonomous bots" https://claude.ai/artifact/UKMDCSdYWygy9i9dnHekUy. Sketches: /mnt/project-files/bots-plan/sketches/.

Recommended set (PICKED 2026-11-06, "pick recommended and start building"): A1+A2 (bots in the API job queue, `bot_check` lane; Electron start at login + catch-up), B1-B3 (page/feed/price watches via linkpreview's SSRF-safe fetcher), C2 (rules spot change, AI judge only on change, no tools), D1+D2+D4 (chat proposal card; Bots page; D4 @-tag a bot in chat/docs/task comments), E1 then E2. Teaching T1-T3 (Useful/Not useful lessons max 20). Bots ADR = 0021.

User answers 2026-11-03: start at login ON by default; keep 25-bot cap; phone Bots gets its OWN BOTTOM TAB.

Facts: no EAS projectId (Expo push needs maintainer Firebase); PA-API unusable.

Part F (sign-ins): redone 2026-11-05 as Secure Store + agent signs in + live view: [bots-secure-signin-plan](bots-secure-signin-plan.md).

Part G: G1 findings board, G2 brief, G3 Pass to, G4 one alert per thing; G9 free-text delegation REJECTED.

Part H (PC harness) parked 2026-11-04: [pc-harness-plan](pc-harness-plan.md).

User 2026-11-04: name "Bots" OK; Amazon B4 kept (signed out, read-only, <=6 h). Owner answers 2026-11-04 to the 4 questions: findings in 08:00 digest AND separate Brief bot; AI unavailable -> send marked "Not checked by AI", re-judge later, follow up only if verdict changes; start at login ON for upgraders with one-time notice; any LLM may read signed-in pages, small notice when any cloud model (not local Ollama) reads them, confirmed.

Part I (any MCP server, token or sign-in): [bots-mcp-plan](bots-mcp-plan.md).

**Why:** later threads start from these picks.
**How to apply:** once the user picks, build on fresh feature/ branches from dev, one PR per phase, only after the user confirms each PR [pr-confirm-rule](pr-confirm-rule.md); AI tests Haiku only [model-key-for-tests](model-key-for-tests.md).


BUILD STARTED 2026-11-06: branch 1 feature/bots-adr = PR #281 (ADRs 0021-0023, CONTEXT words); branch 2 feature/bot-engine = PR #282 (engine, REST, MCP tools, alerts; proof /mnt/project-files/bots-plan/engine-proof/). Opened 2026-11-07 after "Yes and continue"; both CI green, owner merges.
Owner 2026-11-06 23:13: price sources HONOUR robots.txt (Yahoo + CoinGecko disallow) -> crypto via Coinbase spot (no key), stocks via Finnhub with optional free key; recorded in ADR 0021. G2-G4 moved to branch 4 (need Bots page).
Bots page design pass 2026-11-07: 3 options in /mnt/project-files/bots-plan/design-options/ (options.md). OWNER PICKED OPTION 2 "Board of cards" 2026-11-07 (not my rec 1): board grouped Needs you/Watching/Paused, live cards with logo, value, sparkline/check strip, Fix/Turn on on cards; wide slide-in panel of grouped rows; phone 7th icon tab Bots between Tasks and Search with count badge. Branch 3 feature/bots-page (stacked on #282) BUILT 2026-11-07: 32 commits, gates green, proof gallery https://claude.ai/artifact/1RVvvKVG39H18ye1Rjshrs + /mnt/project-files/bots-plan/branch3-proof/; PR #283 OPENED 2026-11-07 (base feature/bot-engine; retarget to dev after #282). Branch 4 feature/bots-ai (AI judge C2, T1-T3, G2-G4, leftovers) BUILT + pushed 2026-11-07, proof https://claude.ai/artifact/3oj2q96kY9Y1zRWtMPR7qv; PR #284 OPENED 2026-11-07 (base feature/bots-page). Owner 2026-11-07: "open pr and continue . complete everything" = build the rest in order, one stacked PR each, opened when done: branch 5 feature/bots-always-on = PR #285 OPENED 2026-11-08 (proof https://claude.ai/artifact/PVxvSWKcBmj5CpG9qQ6QeZ; open Q: hide text for reminder pushes too?), then Part F F1 sign-ins (feature/bots-signin), then Part I. USER SAID "Stop" 2026-11-08 06:20: sign-ins build stopped after 3 local unpushed commits; resume only if asked.
