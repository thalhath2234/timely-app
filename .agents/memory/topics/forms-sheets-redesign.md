---
name: forms-sheets-redesign
description: 2026-10-14 forms + pop-up sheets redesign (PR #183, option 1 "chips + bar") on phone BottomSheet and the web add-item dialog
metadata:
  type: project
  modified: 2026-10-14T05:06:05.508Z
---

Thread "Redesign all the input forms, popup sheet" (2026-10-14). Four numbered options were mocked up on a design canvas (https://claude.ai/artifact/8XNX6AU6nWBjBmfDfvU3qa): 1 chips + bar, 2 grouped list, 3 composer on keyboard, 4 preview + tabs. Option 1 was recommended and built while the user hadn't picked yet. Switch the build if they pick 2-4.

PR #183 (branch feature/forms-sheets-redesign-fmwazi, into dev) covers both apps:
- Phone: `BottomSheet` gives every sheet a grabber (pull down to close), a header with a `leading` slot and subtitle, and a footer that docks on the keyboard via `useKeyboardCover` (copied verbatim from #181). A sheet rendered inside an open sheet becomes an in-place page with a back arrow (`SheetStackContext`); `presentation="modal"` opts out. Quick add is rebuilt: kind chip, large title, `PropertyChip` row, a "Repeat, schedule, labels" More chip, and a summary + Create footer.
- Web: `CreateDialogShell`/`CreateDialogFooter` (entityModal.tsx) replace `EntityModalShell` in addItem only. Kind chip switches mode in place and carries the title. `variant="chip"` on Select/DatePicker/TimeField/ColorPicker. `RichTextEditor toolbar="focus"`.
- Spec: docs/design-system.md "Sheets and create forms".

MERGED into dev 2026-10-15 (merge commit e0edd49) after merging dev in twice; Quick add's Inbox kind now renders #181's `InboxCapture` (no footer, toast on capture) and keeps #179's `openMentions={false}`. Desktop label composer is a dashed "New label" chip with a dot colour picker (user asked for it to match). Follow-ups go on a fresh branch + new PR.

Not done yet: the other 11 hand-built web dialogs (confirm, event, schedule, …) still use OverlayPanel directly.

Screens + scripts: /mnt/project-files/forms-sheets-redesign/ (critique.md, before/, after/, scripts/). Real-phone checks are listed in the PR. Related: [design-system](design-system.md), [help-me-write](help-me-write.md).
