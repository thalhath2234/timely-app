---
name: grouped-layout-rule
description: User rule (2026-10-17) - every UI change uses the grouped layout (cards of rows), web and phone
metadata:
  type: feedback
---

User said "Remember to use grouped layout whenever changing ui" after approving #214 (view sheet) and #216 (phone Settings).

**Why:** The user prefers compact grouped cards of rows over loose forms with big gaps; it matched Workspaces/project settings and cut scroll height ~60%.
**How to apply:** For any UI change, group related settings/controls into cards with hairline-divided rows, a small GroupLabel above and GroupHint below; label left, value/control right (bare field, time pill, sm segmented, drawn switch); summary rows that open a page instead of chip walls. Phone kit: apps/mobile/components/settings/SettingsList.tsx (see docs/design-system.md "Sheets and create forms"). Brief threads doing UI work with this. Related: [phone-settings-grouped-rows](phone-settings-grouped-rows.md), [phone-view-sheet-redesign](phone-view-sheet-redesign.md), [design-system](design-system.md).
