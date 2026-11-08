---
name: ai-edge-cases
description: Thread "Test AI features with real API keys" (2026-10-31) - map of every Claude/OpenRouter/Jev/embedding call, and the routing fix PR #263 MERGED into dev 2026-11-01
metadata:
  type: project
  modified: 2026-10-31T20:27:42.435Z
---

2026-10-31 13:13 user asked: "find all the edge cases where the apis are being used", opus extra effort, ultracode. 13:17 user added TIMELY_LIVE_KEY_ANTHROPIC and asked for "a different thread for both testing" (thread "Live-test AI features with both keys", [ai-live-test-harness](ai-live-test-harness.md)).

Deliverables:
- Claude Doc "Timely AI calls: edge cases" https://claude.ai/artifact/Hyo3wSDn5Zei5kmEAbb7pG ; full map /mnt/project-files/ai-edge-cases/edge-cases.md (+ .json): 15 areas, 161 call sites, 733 edge cases.
- 2026-10-31 20:23 user picked "Fix routing, Haiku default" on the decision card.

Routing fix: branch fix/ai-provider-routing (826132e + review fixes fa3d65e). User said "crete pr" 2026-10-31 21:27: PR #263 opened; CI green; user said "Merge it" 2026-11-01 00:53, MERGED into dev (1a52d5c). API restart needed for the migration [pr-confirm-rule](pr-confirm-rule.md):
- Empty default = automatic: first provider SET UP (API key row, connected CLI, OpenRouter last), read from saved settings only (ADR 0019, handler.go autoProvider). Remove/disconnect of any default (OpenRouter too) empties it. Migration 20261031170000 empties stored 'openrouter' defaults and moves Anthropic rows on claude-opus-5-5 to claude-haiku-5-5 unless the account chose Anthropic.
- Writing features call s.defaultProvider (same as chat); add_live_block uses the run's own model; OpenRouter key save = GET /api/v1/key (refuses spent limit); Anthropic defaults claude-haiku-5-5, claude-haiku-*, claude-sonnet-*; dated/latest suffix matching only; Claude CLI default haiku.
- Balanced, not strict: an OpenRouter-only account still runs chat/writing on OpenRouter. Strict variant offered, no answer yet.
- Accounts that CHOSE Anthropic keep their saved model, including an Opus the old re-key bug swapped in; user told to check Settings → Agent.
- Follow-ups moved to a separate thread at the user's request (2026-10-31 21:22): add_live_block runs twice in a proposal (rehearsal + apply); web/phone settings don't show "automatic" (overview has defaultChosen, clients ignore it; needs design pass + screenshots, stacks on #263). DONE in thread "Finish AI routing follow-ups": PR #264 MERGED into dev 2026-11-01: rehearsal stand-in writer (provider.RehearseLiveBlock), Settings "Default provider" row with Automatic, overview autoProvider. Shots /mnt/project-files/ai-routing-followups/.
- Proof: /mnt/project-files/ai-edge-cases/routing-fix/ (before.txt 13 rule breaks on dev, after.txt 4 = OpenRouter-only accounts or OpenRouter chosen; upgrade.txt; review.md). Harness: keyless recorder copy + scenarios.mjs, patched API builds on :8081 with DB_SCHEMA=routing_dev2.

**Why:** the owner's rules are Claude = Haiku only, OpenRouter only for embeddings and Jev [model-key-for-tests](model-key-for-tests.md).
**How to apply:** follow-up routing work goes on a fresh fix/ branch from dev (#263 is merged); non-routing bugs from the map belong to the live-test thread.
