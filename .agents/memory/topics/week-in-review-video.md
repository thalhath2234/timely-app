---
name: week-in-review-video
description: 2026-10-19 "Week in review" video on Today (branch feature/week-in-review, Fable): how it renders in the browser, codec fallback, how to test it headless, what is pending
metadata:
  type: project
---

Thread "Premium look report for the app" (Fable), user said "start now" after the phase 5 spike. Branch `feature/week-in-review` off dev (after #232). Composition `apps/web/app/_components/film/review/` (plan.ts pure data from tasks/calendar/focus sessions/docs/sheets, review.tsx = WeekInReview 1280x720 30 fps 450 frames, three chapters: stat cards + finished-by-day strip, week grid with blocks arriving in time order, shipped list + "Up next" open tasks + docs/sheets chips). Dialog `today/weekReview.tsx` opened by the "Week in review" button in Today's End of day card (testids today-week-review, week-review, review-save).

"Save as video" uses `@remotion/web-renderer` (WebCodecs in the page, no server). Format fallback in `film/reviewPlayer.tsx`: MP4/H.264, else WebM/VP9, else WebM/VP8; the button hides where none encodes (Firefox). Headless Chromium in the cloud container has NO H.264 encoder, so tests there produce WebM (VP9, ~1.4 MB, ~45 s to render); real Chrome/Electron should give MP4. Licence note in package.md (Remotion free for individuals/<=3 employees).

Headless test: scratchpad review-test.mjs (login demo account, /today, click button, wait 15 s, click Save, Playwright download event; showSaveFilePicker falls through to the download link). Verify with ffprobe. Stills: `pnpm exec remotion still WeekInReview --frame=N --props=<json>`.

**Why:** web-renderer paints the DOM itself (inline styles, DOM order, no backdrop blur, no z-index), so review scenes must stay inside that subset. Text with `fontVariantNumeric: tabular-nums` rendered with a gap inside the saved video ("10 :00") although the Player showed it right; drop tabular-nums on short labels. Figures: /mnt/project-files/premium-look/week-in-review/.
**How to apply:** PR #234 (feature/week-in-review -> dev) opened by the user from the Claude Code UI 2026-10-19 12:21; thread watches CI. The user has not yet confirmed the MP4 path on their PC (untested outside headless). Related: [premium-look-report](premium-look-report.md).
