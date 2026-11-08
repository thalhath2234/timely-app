---
name: dev-review-brief
description: Claude Doc "Dev vs main: review brief" (2026-10-10) lists all 24 PRs on dev not in main with expected behaviour, for a separate reviewing agent
metadata:
  type: project
  modified: 2026-10-10T15:05:35.284Z
---
On 2026-10-10 the user asked for a doc explaining everything on dev not yet in main (after 0.2.1), written as a brief for another agent to review. Result: Claude Doc https://claude.ai/code/artifact/60ed36ee-5a0e-42fb-b6f8-605a7a515cf9 (thread "Dev vs main review brief"). Scope origin/main..origin/dev at 8a7119d = PRs #107-#131 (24 PRs, 8 migrations). The brief tells the reviewer to save its report to /mnt/project-files/dev-review/.

Notable points in it: the 9 extra Dashboard cards are only on unmerged branch feature/dashboard-cards (not dev); web Clarify may flash "Getting suggestions…" with no key (flagged for the reviewer); alert-kind muting is a rolling 3-days-in-14 window, not a fixed 2-week mute. The review itself was not started; the user hands the doc to another agent.

2026-10-10 a separate agent ran the review on the user's PC (Tokyo TZ; report kept uncommitted in the user's checkout under docs/qa/2026-10-10-dev-review/). No product bugs; 2 failures: Expo web crash "this.validatePath is not a function" (pre-existing since 2026-10-03, module-level expo-file-system File in offlineQueue/pomodoroStore; blocks all phone checks in the browser) and a TZ-dependent series integration test. Both fixed in PR #132 (fix/expo-web-startup -> dev) via lib/textFile.ts + textFile.web.ts. Phone part of the review still needs a rerun after #132.

2026-10-10 phone review of all Jev phases (thread same): PR #133 fix/mobile-jev-review -> dev (contains #132; merge #132 first). ~40 phone findings fixed plus API: label names now unique per workspace (migration 20261010150000), addtime keeps ended block, chat move keeps client, 25P02 retried, stage order on copy. Expo web gaps fixed (secure store shim lib/secureStore.web.ts, notifications off on web, autoGrow loop). Screens /mnt/project-files/dev-review/phone/. Needs real phone: toast stacking, native editor Add link / Link to an item. Gotcha: background Bash defaults to 30 min, so start Expo/API with a long timeout.

Related: [jev-review](jev-review.md) [release-flow](release-flow.md)
