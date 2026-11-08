---
name: grouped-task-forms
description: Thread "grouped task sheets and forms" (2026-10-17) - grouped rows for task details, create forms, calendar dialogs; branch pushed, merged as #218
metadata:
  type: project
  modified: 2026-10-17T05:26:27.873Z
---

Branch feature/grouped-task-sheets-forms-byey96 (commits 42d5f0e + 2c5e985 Repeat form/spacing fixes, pushed 2026-10-17). User opened PR #218 themselves from the Claude Code UI on 2026-10-17 (earlier: "Dont open pr until i confirm"). Merged into dev 2026-10-17 by the user. Real phone (2026-10-18, dev a959c9b) passed except two bugs, fixed below.

What changed: phone task details, Quick add, event details, project properties, Settings > Server; desktop create dialog (all kinds), task details sidebar + checklist, calendar block + "Add to calendar" dialogs. Web grouped kit: apps/web/app/_components/_ui/groupedList.tsx (ListGroup, ListRow, GroupLabel, GroupHint, ListSwitch) and `variant="row"` on Select (`values` = multi-pick), DatePicker/TimeField/DateTimeField, ColorPicker, CustomFieldControl, CreateLabelInline/CreateCustomFieldInline; RecurrenceEditor `row`. Phone shared rows: apps/mobile/components/tasks/TaskMetaRows.tsx. Removed LabelPicker, TaskMetaEditor, PropertyGroup/PropertyRow.

Left alone on purpose: habits/goals editor, Settings > Agent keys (follow-up candidate), pickers/previews/canvas dialogs. Shots and audit: /mnt/project-files/grouped-task-forms/ (critique.md, compare-*.png). Real-phone checks pending. design-sync build already had 54 tsc errors before this work (stale exports), unchanged.

Repeat form: phone page + desktop RecurrenceEditor both show Custom as grouped rows (no `row` prop any more). Suggestions verified with mocked endpoints (model key rejected in cloud): scripts hints-phone.mjs / hints-web.mjs in the shared folder's scripts/.

Follow-up 2026-10-18 (user: group the project sheet, test all on connected phone): branch feature/grouped-project-sheet-byey96, no PR until user OKs. 00bc5cf grouped phone project screen (Tasks card + inline add, stage cards, hold-to-move, Activity, stage sheet) + New project BottomSheet; 8033247 Android fix: `flex:1` on content-sized items gives basis 0 in native Yoga, so sm SegmentedControl collapsed (Expo web looked fine; never use flex on content-sized segments); 30137c9 FocusGroupScrollView adds bottom room for the keyboard-covered part, task comment row in FocusGroup. Then 58e362a project Activity scrolls in its card (user ask), ce649a4 short logs no scroller + bare Field focus underline removed, 303ec35 task activity Text flex:1 (Android measured nested Text narrow with flexShrink). All passed on real phone 2026-10-18; worktree removed, shots ~/Dev/timely-phone-check-2026-10-18/ on user's PC. User opened PR #220 (2026-10-18); merged into dev 2026-10-18 as b766b22 by thread on user "merge it".

Related: [grouped-layout-rule](grouped-layout-rule.md), [forms-sheets-redesign](forms-sheets-redesign.md), [pr-confirm-rule](pr-confirm-rule.md).
