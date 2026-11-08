---
name: phone-board-card-size
description: Phone Board cards stretched to full title height on Android (2026-10-20); cause = flex Text inside StrikeTitle + RN legacy Yoga errata; Expo web can't show it
metadata:
  type: project
  modified: 2026-10-20T02:20:29.360Z
---

Thread "Board card size" (2026-10-20), branch fix/board-card-size-xmupos, PR #240 merged into dev by the thread on the user's "Merge it" (2026-10-20, CI green). Not yet tested on the real phone.

- Symptom (real Android phone only): Board cards a screen tall, tick + grip floating mid-card, next card overlapping, gap between title and badges.
- Cause: e0941c2 (motion catalogue) wrapped TaskCard's title in StrikeTitle (column wrapper, alignSelf flex-start) but the Text kept `flex: 1` from `styles.name`. RN Fabric uses Yoga ErrataAll (legacy stretch flex basis), so the flexing Text grows past numberOfLines and the cell height disagrees with the card height (overlap).
- Fix: flex only on `styles.titleBox` around StrikeTitle; StrikeTitle doc says style is text-only. Also fixes long titles in phone Task List.
- GOTCHA: Expo web (react-native-web = CSS, not Yoga) renders it correctly before and after, so web shots can't prove Android layout bugs. Reproduce with `yoga-layout` npm + `Config.setErrata(ERRATA_ALL)` (sim in /mnt/project-files/board-card-size/), or on the real phone.
- Desktop Kanban unaffected (one-line truncate, 56px cards).
- Shots + critique: /mnt/project-files/board-card-size/. Offered: real-phone check (needs PC, one PC thread at a time), optional wider title on board (duration to meta row, tick column 40dp).

Related: [phone-board-drag](phone-board-drag.md) [design-overhaul-phases](design-overhaul-phases.md) [android-testing-on-user-pc](android-testing-on-user-pc.md)
