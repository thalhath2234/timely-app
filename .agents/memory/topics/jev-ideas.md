---
name: jev-ideas
description: JEV model from typesafe means TypeSafe AI's Jev decision model; idea list for Timely written 2026-10-08
metadata:
  type: project
  modified: 2026-10-08T19:02:10.277Z
---

When the user says "JEV model from typesafe" they mean Jev, TypeSafe AI's "System One" model (Sep 2026): no text output, answers typed Choice / Score / yes-no questions with probabilities, ~$0.042/M input tokens, text only. On OpenRouter as typesafe/jev-1.13; TypeSafe paused new console sign-ups 22 Sep 2026. OpenRouter serves it at POST https://openrouter.ai/api/v1/systemone with the same body as TypeSafe (POST https://api.typesafe.ai/v1/systemone).

Thread "Ways to improve Timely with Jev" (2026-10-08) wrote a ranked idea list: /mnt/project-files/jev-ideas/jev-improvements.md (Clarify pre-fill, estimates instead of flat 30 min, receipt decisions, chat triage, search relevance, duplicate Work, docs placement, ranking). Full list: /mnt/project-files/jev-ideas/jev-full-list.md (98 items). 2026-10-08 user asked to implement all working items: TypeSafe API key first, OpenRouter key second (both POST /systemone, same body), no key = app unchanged. Plan doc (Claude Doc): https://claude.ai/code/artifact/22253098-d528-405d-a208-a84e9c926622 with Phase 0 foundation (features/decide) + Phases 1-9. User offered a temporary key for testing; asked them to add it as env var TIMELY_LIVE_KEY_TYPESAFE in a cloud environment or keep it in their .env, never in chat.

**How to apply:** if the user asks to build one, start from that file; keep approvals deterministic and fall back to current behaviour when Jev is off.

2026-10-09: PR #120 (Phase 0+1) opened against dev. API: internal/features/decide (only Jev caller), provider/decisions.go (/agent/decisions settings, TypeSafe key in agent_api_keys provider "typesafe"), internal/features/suggest (/inbox/:id/suggestions, agent Estimate). ADR docs/adr/0012-jev-decisions.md. Screenshots: /mnt/project-files/jev-ideas/screens/. Next phases (2-9) start only after #120 merges. See [test-on-user-dev-server](test-on-user-dev-server.md).

2026-10-09 fix: OpenRouter has no plain `typesafe/jev-latest` id (documented ids: `typesafe/jev-1.13`, alias `~typesafe/jev-latest`). Timely now calls OpenRouter's Decisions API POST https://openrouter.ai/api/alpha/decisions with typesafe/jev-1.13, no provider routing; response nests answers under `answers` like TypeSafe. Jev `state` must be an object. Cloud sessions can't reach openrouter.ai or typesafe.ai (proxy), so live checks need the user's machine: Settings > Agent > Smart suggestions > Test.

2026-10-09: #120 merged into dev (user picked "merge now" on a card). Phase 2 = PR #122 (feature/jev-agent-chat): chat/jev.go triage (area narrows read tools, hints, language, similar chat as Message kind "similar"), reviewNotes after prepareProposal (notes on the proposal message, force review). decide.Resolve/Related from the plan's Phase 0 were never built; resolve_target (38/42/77) needs them.

2026-10-09: told the user how to give cloud sessions live Jev access: add a cloud environment in Project settings with openrouter.ai (and api.typesafe.ai) in Allowed domains and env var TIMELY_LIVE_KEY_OPENROUTER (never pasted in chat). Only threads started afterwards get it. Check `env | grep TIMELY_LIVE_KEY` before assuming cloud can not reach Jev.
2026-10-09 14:47 UTC: user created cloud environment "timely" with full network access and their OpenRouter key (variable name not stated; look for TIMELY_LIVE_KEY_* or OPENROUTER*). Threads started after that should run on it; verify with env and a curl to openrouter.ai before relying on it.
2026-10-09: Phase 3 = PR #123 merged into dev. User chose "Push only" over "Push and merge + start Phase 4", so wait for them to ask before starting Phase 4. The local Chrome session (Remote Control REPL on their PC) refuses to push on a relayed approval; the user must type "push" there.
