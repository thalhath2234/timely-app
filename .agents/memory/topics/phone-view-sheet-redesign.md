---
name: phone-view-sheet-redesign
description: Phone Tasks "Customize view" sheet redesign (PR #214, 2026-10-16) - grouped rows option 1, user said web filter is fine
metadata:
  type: project
  modified: 2026-10-16T04:45:38.209Z
---

Thread "view filter redesign" (2026-10-16): user said the view filter "page" had too many gaps, then "work on phone only, the web version looks fine". Picked option 1 "Grouped rows" of 3 (2 tight form, 3 tabs).

- PR #214 (merged 2026-10-17; feature/view-filter-redesign-14p8vv -> dev): `apps/mobile/components/tasks/TaskFiltersSheet.tsx` is now cards of rows: Filters, Arrange (Layout/Show/Limit segmented, Group by + Sort open pages), Narrow down (summary rows open pages of SheetOption). Scroll 2962px -> 1158px. `SegmentedControl size="sm"` added (content-width segments; use flexGrow/flexBasis, not flex:0, or RN web collapses them).
- Critique, options.png, before/after shots: /mnt/project-files/view-filter-phone/. Real-phone check pending.
- Related: [natural-language-views](natural-language-views.md), [design-system](design-system.md).
