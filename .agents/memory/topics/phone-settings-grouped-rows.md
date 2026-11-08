---
name: phone-settings-grouped-rows
description: Phone Settings Schedule/Account/Notifications/Data rebuilt as grouped rows (PR #216, 2026-10-17), follow-up to the view sheet redesign
metadata:
  type: project
---

After #214 the user asked which other screens fit the grouped layout and picked "All four": phone Settings > Working hours (schedule.tsx), Account, Notifications, Data & backups.

- PR #216 (merged 2026-10-17; feature/settings-grouped-rows -> dev): all four on `components/settings/SettingsList.tsx` (ListGroup/ListRow/GroupLabel) plus new GroupHint, ListSwitch (drawn switch, never native Switch), SwitchRow; `TimeField compact` pill; `Select trigger="row"`; `SegmentedControl size="sm"` (same hunk as #214). Pattern noted in docs/design-system.md.
- Critique + shots: /mnt/project-files/view-filter-phone/settings-critique.md, settings-after/, settings-before-after.png. Real-phone check pending.
- Related: [phone-view-sheet-redesign](phone-view-sheet-redesign.md), [design-system](design-system.md).
