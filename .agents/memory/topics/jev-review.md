---
name: jev-review
description: Jev Phase 0-9 review PR #131 (2026-10-10) - what it fixed, what is still not built
metadata:
  type: project
---
PR #131 (branch feature/jev-phase4-j1vvw6 -> dev, merged by the user 2026-10-10) came from "check everything from phase 0 to 9, fix bugs and fill gaps".

Done in it:
- The phone "Meet your assistant" hint and pinch are hidden outside the onboarded app.
- Clarify reads dates from the words (suggest/dateparse.go) and Jev names the role (deadline, start or reminder). A start date fills only Start date, never Schedule. Tonight is 19:00, this afternoon is 15:00, and a read time already past pings at the next hour.
- Suggested length: web New Work and phone quick add, via POST /suggestions/estimate.
- Onboarding: suggested workspace names and "Also create" starter workspaces.
- /setup is outside the app shell.
- Phone parity: Test button, deep-work time, task hints fields, Markdown import, Start from, cleanup suggestions.
- Many triage, alerts and briefing fixes. The smart alerts key check runs in the daily job, not the sweep.

Remaining items, built 2026-10-10 in the same PR after the user said "except for the cheap model and checks, do everything else":
- resolve_target agent tool (38/42/77), attachment chips trimmed (76), get_doc focus trims long docs by section (46), POST /suggestions/cell-fit (63).
- Phone doc link-selection and property suggestions.
- Notifications Dismiss (DELETE /notifications/:id, dismissed_at) feeds "not kept" and mutes a kind after dismissals on 3 days.
- Start from restarts repeating series (restartSeries).
- Deliberately NOT built, per the user: cheaper model and checks (74, 81-84).
- Phone link-selection is untested on a real phone (the webview editor doesn't render in Expo web).

Screens: /mnt/project-files/jev-ideas/screens/review/ and review2/. Gallery: https://claude.ai/artifact/PrLLvaSv4b7tFJxEP66HuF. See [jev-phase9](jev-phase9.md).
