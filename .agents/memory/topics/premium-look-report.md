---
name: premium-look-report
description: 2026-10-18 design overhaul ("premium look"): report link, decisions taken, what each phase changed on redesign/design-overhaul, what is left
metadata:
  type: project
  modified: 2026-10-18T16:36:24.484Z
---

Thread "Premium look report for the app" (Fable). Report = Claude Doc https://claude.ai/code/artifact/6ba4b068-cb04-4438-b9b6-6c94c1665441; figures in /mnt/project-files/premium-look/ (README.md lists phases; DARK figures only, user said "always send dark theme screenshots").

Findings: gap vs the landing film is composition and motion, not colour. Decisions taken by the user ("looks good, start working"): A1 main + 300-340 px rail, B1 light four-step ladder, C1 film stat cards. Open: D task detail modal vs rail, E phone FAB vs bottom-bar add, F first Remotion piece (rec: empty states). Phone gets pre-rendered WebP + Reanimated (no Remotion in RN).

**Branch:** `redesign/design-overhaul` carried every phase. Phases 0-2 done: motion defaults, designTokens.motion + surface ladder + frameless rail + 26 px titles, PageWithRail kit (app/_components/_ui/pageWithRail.tsx, docs/design-system.md#page-with-rail) on Today/Projects/Notifications/Files/Settings/Docs.

**Phase 3 (density per screen) done 2026-10-18:** one commit per screen; details in /mnt/project-files/premium-look/phase3/.

**Phase 4 (motion catalogue) done 2026-10-18:** web b2e8e3d (kit _ui/motion.tsx, _ui/dataMotion.tsx, _ui/taskCheck.tsx, _ui/skeleton.tsx), phone e0941c2 (components/ui/motionKit.tsx). Left on purpose: done-task hold-then-collapse, calendar state line typing, phone shared-element project open (Reanimated 4 has none).

**Phase 5a (empty-state loops) done 2026-10-18 (1fdd7ee):** film/loops/*.tsx + loopPlayer.tsx, EmptyState `loop` prop on web and phone (phone: expo-image WebP from `make film-render-loops`, needs ffmpeg libwebp). Empty account: empty@timely.local / [password removed].

**Phase 5b (first-run tour) done 2026-10-18 (2575ffc):** web auth/firstRunTour.tsx after "Create workspace" (film/tour.tsx); phone app/(app)/tour.tsx pager with WebP loops. Test accounts tour@/tourphone@timely.local ([password removed]), onboarded.

**Phase 5c (auto-schedule replay) done 2026-10-18 (c4c3545):** film/replay/plan.ts (`replayFromSchedule(SchedulePlan)` -> ReplayPlan, SAMPLE_REPLAY) + replay/replay.tsx (ScheduleReplay 960x600, `replayFrames(plan)`), film/replayPlayer.tsx (plays once, `moveToBeginningWhenEnded={false}`, "Play again"), calendarView/scheduleReplay.tsx dialog (data-testid schedule-replay) opened by "Show me" (data-testid schedule-show-me) on the applied toast and the waiting rail; scheduleActivityStore keeps the applied `plan`. Phone: MobileWeek/MobileDay animate arrivals with Reanimated (firstIds skip the initial render).

**Phase 5d (help stills) done 2026-10-18 (c48be64):** film/stills.ts table + scripts/renderStills.mjs (`make film-render-stills`, node --experimental-strip-types) -> public/help/film/*.webp; help kit `Still` component; nine articles use film frames, Auto-schedule article documents "Show me". Spike: phase5/week-in-review-spike.md recommends @remotion/web-renderer in the renderer process.

**MERGED:** PR #228 (redesign/design-overhaul -> dev, merge 12cb41f, 2026-10-18, user "merge this and continue next"). Follow-up branch `fix/help-screenshots-redesign` (e82d52d): all 28 stale help screenshots retaken dark on the merged layout (review PNGs + contact-sheet.png in /mnt/project-files/premium-look/help-screenshots/); settings-server*.webp stay old (desktop-only tab). MERGED as PR #229 (1e9a924, 2026-10-19). Blur flicker fix merged as #231: [overlay-view-transitions](overlay-view-transitions.md). Still open: picks D/E. Week-in-review video built 2026-10-19 on feature/week-in-review: [week-in-review-video](week-in-review-video.md).

**How to apply:** read the report before touching these screens; standing rules apply (grouped layout, dark screenshots, no PR without confirmation). Related: [landing-and-help-center](landing-and-help-center.md), [design-system](design-system.md), [grouped-layout-rule](grouped-layout-rule.md).
