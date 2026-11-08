---
name: landing-variations
description: 2026-10-11 the user compared five landing + help designs and kept the current one; the four others (Ask, Board, Sheet, Dashboard) are rejected, PR #154 closed
metadata:
  type: project
  modified: 2026-10-11T15:34:21.192Z
---

Thread "Five landing and help page designs" (2026-10-11): branch `feature/landing-help-variations-kcs017`, PR #154 into dev. OUTCOME: the user said "keep the /1 and remove the rest", so the live `/` and `/help` stay the day-in-Timely design; PR #154 was closed unmerged and the branch left on origin (threads can't delete remote branches).

- `/1` + `/1/help`: the current "day in Timely" design (components `app/_components/landing/dayLanding.tsx`, `app/_components/help/helpHome.tsx`, both take `base`).
- `/2` Ask: site as a chat with the assistant (change cards, Approve). `/3` Board: kanban Inbox → Clarified → Scheduled → Done, help as snap-scrolling lanes. `/4` Sheet: spreadsheet grid, formula bar, help as a table. `/5` Dashboard: the app's dashboard cards with live numbers.
- Code: `apps/web/app/_components/variations/` (shell.tsx with `--v-*` tokens + DesignSwitcher pill, content.ts shared copy, vN/ per design), routes `apps/web/app/N/`. Shell CSS sits in Tailwind's components layer so utilities win.
- Rejected earlier (don't re-propose): ink and paper, command line, Swiss kinetic week, focus mode, sticky-note desk.
- Screenshots + critiques: /mnt/project-files/landing-variations/ (critique.md, N-landing/help-desktop/phone.png).

**How to apply:** do not re-propose Ask (chat transcript), Board (kanban), Sheet (spreadsheet grid) or Dashboard (card bento) as landing directions; with ink and paper, command line, Swiss kinetic week, focus and sticky-note desk that makes nine rejected ideas. The variation code only exists on the closed branch if ever wanted. See [landing-and-help-center](landing-and-help-center.md).
