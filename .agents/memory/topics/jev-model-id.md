---
name: jev-model-id
description: Which Jev model ids Timely sends (TypeSafe jev-latest, OpenRouter ~typesafe/jev-latest) and which ids OpenRouter refuses; switched from 1.13 on 2026-11-03
metadata:
  type: project
  modified: 2026-11-03T13:24:27.726Z
---

2026-11-03 user asked "use jev latest instead of jev 1.13". Thread "Switch Jev to the latest model", branch fix/jev-latest-model (commit 0a85b60), PR #276 MERGED into dev 2026-11-03 13:30 (0b6c1e3; API restart, no migration).

- TypeSafe direct was already `jev-latest`; only OpenRouter's fallback (decide/client.go routerModel) was pinned to `typesafe/jev-1.13`. Now `~typesafe/jev-latest`.
- Live OpenRouter Decisions API (POST /api/alpha/decisions) 2026-11-03: `~typesafe/jev-latest` and `typesafe/jev-1.14` -> jev-1.14-20261014; zdr works with the alias; `typesafe/jev-latest` and `typesafe/jev` -> 400 "does not exist". /api/v1/models lists only typesafe/jev-router, not Jev itself.
- Cloud env "timely" now reaches openrouter.ai with TIMELY_LIVE_KEY_OPENROUTER (older note in [jev-ideas](jev-ideas.md) said it could not).
- Proof: /mnt/project-files/jev-latest/.
