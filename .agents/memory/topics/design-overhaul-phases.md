---
name: design-overhaul-phases
description: Design overhaul #228 (premium look): report link, picks taken and still open, what each phase 0-5 added, help screenshots #229
metadata:
  type: project
---
Moved out of MEMORY.md on 2026-10-19. Related: [premium-look-report](premium-look-report.md), [week-in-review-video](week-in-review-video.md).

## Design overhaul (merged as #228; thread "Premium look report for the app", Fable) [premium-look-report](premium-look-report.md)
- Report: https://claude.ai/code/artifact/6ba4b068-cb04-4438-b9b6-6c94c1665441; full-page PNGs in /mnt/project-files/premium-look/ (phase0/ to phase5/, before/after). Findings: gap is composition and motion, not colour.
- Taken: A1 main + 300-340 px rail, B1 light four-step ladder, C1 film-style stat cards. OPEN PICKS (user has not chosen): D task detail modal vs rail, E phone FAB vs bottom-bar add.
- Phases 0-2: motion defaults, tokens/shell (frameless 56 px rail, 26 px titles), PageWithRail kit (_ui/pageWithRail.tsx; rails on Today, Projects, Notifications, Files, Settings, Docs). Phase 3 density per screen. Phase 4 motion catalogue web (_ui/motion.tsx etc.) + phone (components/ui/motionKit.tsx); Reanimated 4 has no shared-element transition. Phase 5 Remotion Players: 5a empty-state 4 s loops, 5b 15 s post-sign-up tour, 5c auto-schedule "Show me" replay dialog, 5d help articles open with a film frame (`make film-render-stills`).
- Help screenshots (#229): 23 desktop + 5 phone retaken dark (contact sheet /mnt/project-files/premium-look/help-screenshots/contact-sheet.png); the two Server tab shots stay old (desktop-only tab).
