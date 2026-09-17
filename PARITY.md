# Web ↔ Mobile parity

Last inventoried **17 Sep 2026** from `apps/web`, `apps/mobile`, and `apps/api/internal/routes/routes.go`, then updated the same day with product decisions below. This is a work plan, not a product proposal. It lists what already matches, what is thinner on one surface, and the concrete work required to close each gap.

Related docs:

- `apps/web/FEATURES.md` — current feature inventory (slightly stale; this file is the gap list)
- `apps/web/NextPhase.md` — product direction. It already requires that a phase is not complete until **both** desktop web and native Expo ship the capability
- `.stitch/metadata.json` — existing Google Stitch project **Timely** (`3890227041261643615`), design system **Kinetic Dark Velocity**

---

## How to read this

**Parity means same essential capability, not the same UI.** Desktop can keep a sidebar, saved views, keyboard shortcuts, and drag-and-drop. Mobile should keep tabs, sheets, long-press, and native share. A user who lives on both should be able to capture, triage, schedule, execute, write, and export without discovering that a whole workflow only exists on one device.

Each gap is tagged:

| Tag | Meaning |
| --- | --- |
| **P0** | Daily loop is blocked or misleading on one surface |
| **P1** | Feature exists on the other surface and users will miss it |
| **P2** | Depth / polish; ship after the daily loop matches |
| **Keep** | Platform-specific on purpose; do not copy blindly |
| **Both missing** | Neither client exposes it; not a web-vs-mobile gap |

Effort is a rough size for one engineer who already knows the codebase: **S** (hours), **M** (1–3 days), **L** (a week), **XL** (multi-week).

---

## Follow-up product decisions (17 Sep 2026)

These override earlier “P2 polish / do not copy desktop chrome” notes in this file.

1. **Theme is universal.** Light / dark / system and the same accent tokens must look the same on web and mobile, and must follow the account — not a per-device preference. Changing appearance on one surface updates the other after refresh.
2. **Docs and sheets get the full toolbar** on mobile, not a subset. Formatting, table, formula, and structure controls that exist on web must be reachable on the phone (touch-adapted, horizontally scrollable). Print is the only desktop-only skip (use share/export).
3. **Docs slash commands are complete.** `/` on mobile must offer every web command, including **Link** and **Page** (nested subpage) on document bodies.
4. **Creating a task includes real markdown / rich text**, not a plain `TextInput`. Quick Add and the task composer must write `description` + `descriptionRich` the same way the web Add Item modal does.
5. **Mobile gets a Stitch-led visual overhaul** using the existing Timely Stitch project (Kinetic Dark Velocity). The Stitch MCP server is configured in **local** Cursor MCP (`~/.cursor/mcp.json`). The key is **not** in the git repo. Restart the agent/IDE so `mcp_stitch_*` tools load. See §22.
6. **Motion is a product requirement.** Mobile must feel as fluid as web: native stack push (view-transition equivalent), tab cross-fade, spring sheets, press scale, list enter. Reduce Motion must disable all of it.

---

## Snapshot

Timely is a **multi-account, single-user** personal productivity system. Web is the full product. Mobile covers the same objects (tasks, events, projects, docs, sheets, schedule, settings) but several planning and knowledge workflows are still desktop-shaped.

| Surface | Role today |
| --- | --- |
| Desktop web (`apps/web`, Next.js + Electron shell) | Full product: saved task views, week calendar, waiting-for-slot rail, project hub, nested docs, spreadsheet-lite, Today shutdown, device sessions, accent theme |
| Native (`apps/mobile`, Expo SDK 57) | Daily capture + calendar + task cards + editors + settings. Extra: Expo push, local reminder scheduling, offline mutation queue, native share |
| API (`apps/api`) | Shared source of truth. Almost every gap below is **UI work**, not a missing endpoint |

Auth, CRUD, search, auto-schedule preview/apply/undo, working hours, backups, API keys, a TipTap docs editor, sheet formulas, inbox capture, and task detail are present on both. Theme is **not** universal yet (per-device, incomplete on mobile). Docs slash/toolbars and sheet formatting are thinner on mobile. Task create on mobile cannot take markdown. The remaining work is depth, a synced appearance config, editor chrome, a Stitch visual pass, and wiring APIs that mobile already imports but never calls.

---

## 1. Capability matrix

| Capability | Web | Mobile | Gap |
| --- | --- | --- | --- |
| Login / signup / onboarding | Yes | Yes | Match |
| Device sessions (list / revoke) | Yes | No UI | Mobile P1 |
| Forgot password / OAuth / 2FA / biometrics | No | No | Both missing (out of NextPhase scope except recovery) |
| Today dashboard | Full (focus picker, agenda, shutdown, join-call) | Thin list | Mobile P0 |
| Inbox capture | Full + shortcuts | Title capture | Mobile P1 |
| Task list | Saved views, group, columns | Card list + filters | Mobile P0 |
| Kanban | Drag to status | “Board” groups by status name | Mobile P1 |
| Gantt | Drop-to-date (no bar resize) | None | Mobile P2 |
| Bulk task actions | Yes (list) | Yes (long-press) | Match |
| Task detail | Rich notes, blocked-by, occurrence split, clear/delete blocks | Plain notes; several APIs unused | Mobile P0–P1 |
| Calendar D/W/M/Agenda | All four | Day / Month / Agenda | Mobile P1 (week) |
| Waiting-for-slot rail | Yes + drag onto grid | No | Mobile P1 |
| Drag-drop calendar | Yes | Reschedule via sheet | Keep (touch-adapted) + P1 empty-slot create |
| Auto-schedule preview/apply/undo | Yes | Yes | Match |
| Auto-schedule after every create | No | Yes (including inbox) | Mobile P0 bug |
| Events this/future/all | Yes | Yes | Match |
| Task occurrence split | Yes | Hook unused | Mobile P1 |
| Projects hub + stages | Tabs, drag board, activity, color, rich desc | List + long-press move | Mobile P1 |
| Docs tree / favorites / archive | Nested sidebar | Flat Favorites + Recent | Mobile P1 |
| Docs editor (slash, @, SSE watch) | Yes | Yes (WebView) | Slash/toolbar incomplete — **P0** |
| Docs slash commands | Text, H1–H3, lists, todo, quote, code, table, divider, link, mention, page | Same except **Link** and **Page** missing | Mobile **P0** |
| Docs / sheets toolbar | Full format + table (docs); full format + formula (sheets) | Docs: partial format bar; sheets: row/col only | Mobile **P0** |
| Task create markdown | RichTextEditor in Add Item | Plain description field | Mobile **P0** |
| Sheets formulas | Yes | Yes (same function set) | Match |
| Sheets workbook tabs, CSV, charts, format | Yes | Single grid, no CSV, no format toolbar | Mobile P0–P1 |
| Sheet duplicate | Yes | No client function | Mobile P1 |
| Report | Full (priority, mentions, projects) | Stats + overdue/upcoming | Mobile P1 |
| Search | Modal ⌘K | Tab | Match (IA differs) |
| Notifications list + snooze | Yes + sidebar badge | Yes, **no badge** | Mobile P1 |
| Notification settings + jobs | Yes | Yes + OS permission | Match |
| Working hours + engine freeze | Yes, timezone picker | Yes, timezone text field | Mobile P2 |
| Workspace statuses/labels/fields | Full CRUD | Add/delete; **no rename/recolor** status/label | Mobile P1 |
| Delete workspace | API + MCP only | API unused | Both missing |
| Account profile | Yes | Yes | Match |
| Appearance | System / light / dark + accent, **this device only** | Light / dark, **this device only**, no accent | **P0 universal theme** (API + both clients) |
| Accent color | Presets + custom hex | Hardcoded violet | Part of universal theme |
| Data export / backup / restore | Yes | Yes + share sheet | Match |
| API keys | Yes | Yes | Match |
| Keyboard shortcuts | Full | None | Keep |
| Motion / view transitions | `<ViewTransition>` + motion.react | Native stack push, tab fade, spring sheets, press scale, list enter | **Baseline shipped** (81); Stitch still restyles |
| Push + local reminder alarms | No | Yes | Keep |
| Offline mutation queue | Banner only | Narrow queue | Keep + P2 widen |
| Pull-to-refresh | n/a | Copied, **not implemented** | Mobile P0 polish |
| Electron window / native menus | Yes | n/a | Keep |

---

## 2. Navigation and information architecture

Web sidebar (always visible unless auto-hidden): **Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications, Settings**.

Mobile tabs: **Calendar, Tasks, Search, Files, Settings**. Today, Inbox, Notifications, Projects, Report, Workspaces, Data, and API keys live under the Settings tab (`more.tsx`). Sheets are a hidden tab (`href: null`) and a segment inside Files.

This is the largest *perceived* parity hole. A user switching from desktop cannot find Today, Inbox, or Projects without opening Settings.

### Work

1. **P0 — Promote daily destinations on mobile.** Today, Inbox, and Notifications must be one tap from the home surface. Options (pick one and commit):
   - Add a “Home” tab that hosts Today + inbox count + upcoming, **or**
   - Replace the Files tab with a “More” hub that is clearly labeled as destinations (not settings), and keep appearance/account under a nested Settings row, **or**
   - Add a header overflow on Calendar/Tasks with Today / Inbox / Projects.
2. **P1 — Projects as a first-class destination.** Same discoverability as Tasks. Linking from Settings-only is not enough.
3. **P2 — Collapse the duplicate settings hubs.** `/(app)/(tabs)/more` and `/(app)/settings` overlap. Keep one hub. Theme belongs with Appearance, not only on the tab.
4. **Keep — Search as a tab.** Desktop uses a modal; a dedicated mobile tab is the right adaptation. Do not add ⌘K.
5. **Keep — Docs + Sheets under Files.** Fine if the segment control stays obvious. The hidden `sheets` route should either become the Files sheets segment’s canonical list or be removed to avoid two list implementations.

---

## 3. Auth, account, sessions

| Item | Web | Mobile |
| --- | --- | --- |
| Email/password login + signup | Yes | Yes |
| Onboarding = create first workspace | Yes (“Step 1 of 1”) | Yes |
| Profile name/email/password | Yes | Yes |
| Device sessions | List, revoke one, sign out everywhere else | **Missing** |
| Push token unregister on logout | n/a | `unregisterPushDevice` never called |

### Work

6. **P1 — Mobile device sessions.** Port Settings → Account sessions UI. Add `listSessions` / `revokeSession` / `revokeOtherSessions` to `apps/mobile/lib/api/auth.ts` (or a `user.ts`) and a list under Account. Current-device badge should match web (“This device”).
7. **P1 — Unregister push on logout.** Call `unregisterPushDevice` in the mobile logout path so a signed-out phone stops receiving Expo pushes.
8. **Both missing — Workspace delete in UI.** `DELETE /workspaces/:id` exists; only MCP `delete_workspace` uses it. Add a guarded delete (not last workspace) on **both** Settings → Workspaces screens.
9. **Keep — No OAuth / biometrics / 2FA** unless NextPhase reopens recovery. Password reset remains the local `apps/api/scripts/reset_password.go` command.

---

## 4. Today

Web `/today` is a dense home: Today Focus (max 7, star picker **P**), live focus timer, scheduled agenda with now-line, **Join call** for Meet/Zoom/Teams URLs, reminders, overdue + reschedule, inbox triage bar, **End of day shutdown** (moves unfinished to tomorrow’s focus, undo), Plan Tomorrow.

Mobile `/(app)/today` is a thin list: focusing card, today-focus rows with Start, scheduled items (reminders filtered out), overdue, unfinished with a Tomorrow chip. Empty copy says “Pull to retry” but there is no `RefreshControl` anywhere in the app.

### Work

10. **P0 — Rebuild mobile Today around the same data as `GET /today`.** Required sections:
    - Today Focus with add/remove (enforce max 7 in UI, not only copy)
    - Complete-from-list with undo
    - Live elapsed timer while focusing
    - Scheduled agenda including reminders
    - Overdue + reschedule into calendar/task sheet
    - Inbox count that deep-links to Inbox
    - End-of-day: push unfinished to tomorrow’s focus with undo
11. **P1 — Star picker on mobile.** Search open work (exclude inbox, reminders, subtasks, already starred) and add to today.
12. **P2 — Join-call affordance** when a calendar item URL matches Meet/Zoom/Teams (`Linking.openURL`).
13. **P2 — Tappable events.** Scheduled rows without `taskId` should open `/(app)/events/[id]`, not do nothing.
14. **P0 polish — Pull-to-refresh** on Today, Tasks, Inbox, Calendar, Files, Notifications. Remove or honor the “pull to retry” copy.

---

## 5. Inbox

Both capture a title as `kind: "inbox"`. Web has **C** focus, flash “Captured”, and copy that inbox is never auto-scheduled. Mobile capture is the same, but `useCreateTask` always fires `applySchedule({})` afterwards — including inbox.

### Work

15. **P0 — Stop auto-applying the engine on inbox (and probably every) create.** Gate `useAutoScheduleAfterCreate` to work tasks with `duration > 0` and a workspace, or remove the side effect and keep explicit Auto-schedule. Desktop does not auto-apply on create.
16. **P1 — Inbox list actions.** Swipe or overflow: Review, delete, convert to reminder, complete. Today users must open the full task screen for every triage.
17. **P2 — Capture feedback.** Toast “Captured” and keep the field focused for rapid capture.

---

## 6. Tasks

This is the largest functional gap.

### 6.1 List, views, filters

Web `/tasks` persists **saved views** in user config (`taskViews` + `activeTaskViewId`): list / kanban / gantt, Tasks vs Projects vs Reminders, up to 3 group-bys (including custom fields), sort, filters, column order. Deep links `?taskId=` / `?projectId=`.

Mobile is a card list grouped by project, with chips: All, Today, Overdue, Upcoming, No date, Done, Reminders, Board. Board only regroups by **status name**. `TaskRenderMode` exists in `lib/types.ts` and is unused. Saved views from desktop are ignored.

### Work

18. **P0 — Honor desktop saved views on mobile.** Read `config.taskViews` / `activeTaskViewId`. At minimum: switch views, apply their filters and data mode (tasks / reminders / projects). Creating/renaming views can wait; consuming them cannot, or a view built on desktop is invisible on the phone.
19. **P1 — Mobile kanban.** Horizontal status columns, drag or long-press → change status (same completing-status → `completedAt` rule as web). Reuse the Board filter as the entry point.
20. **P2 — Mobile gantt.** Compact bars from start/blocks/deadline; tap opens detail; drop or sheet to set dates. Bar resize is not required (web does not have it either).
21. **P1 — Filter depth.** Workspace is there if there are multiple spaces. Add status, priority, labels, stage, overdue, scheduled, recurring, only-dated to match `taskFilters.ts`. A single “Filters” sheet is enough; do not clone the desktop toolbar.
22. **P2 — Group-by.** Project grouping is hardcoded. Allow group by status / priority / stage when a saved view asks for it.

### 6.2 Task detail

Web overlay: autosave properties, **explicit Save** for TipTap description, Work | Reminder, blocked-by, recurrence, calendar blocks (add / pin / nudge / clear / delete), contiguous + chunks + preferred windows, Focus **⌘F**, Today Focus, duplicate, subtasks, checklist, activity + comments.

Mobile `/(app)/tasks/[id]` is close on metadata, recurrence, labels, custom fields, focus, today, duplicate, subtasks, checklist, comments. Gaps:

| Missing on mobile | Notes |
| --- | --- |
| Rich description | Plain `TextInput`; no slash/mentions. `toRichContent(undefined, note)` stores a single paragraph, so markdown typed in the box is **not** parsed. |
| Create-time markdown | `QuickAddSheet` description is a plain `Field`. Web `addItem.tsx` uses `RichTextEditor` and writes `descriptionRich`. |
| Checklist title edit | Toggle + long-press delete only; API supports `title` |
| Blocked-by | Field on payload, no picker |
| Split series | `useSplitTaskSeries` never used; events already have this/future/all |
| Clear / delete blocks | `clearTaskBlocks` / `deleteBlock` unused; can add and pin only |
| Preferred windows | First `HH:mm`–`HH:mm` pair, no weekday chips |
| Capacity | `getCapacity` unused |

### Work

23. **P0 — Rich task notes on detail.** Reuse `components/editor/RichTextEditor` (already used by docs) for description, with Save + autosave policy matching web (properties autosave, body explicit or debounce). Slash, mentions, and the same toolbar as docs.
75. **P0 — Markdown on task create.** Quick Add (and any other composer) must accept proper markdown / rich text for work tasks and reminders:
    - Embed the docs editor (compact variant) or a markdown field that runs `fromMarkdown()` in `lib/markdown.ts` before save.
    - Persist both `description` (plain) and `descriptionRich` (TipTap JSON), same payload as web Add Item.
    - Preview headings, lists, checkboxes, links, and code — not a single escaped paragraph.
    - Paste of markdown should round-trip (`## Title` becomes a heading, `- item` a bullet).
24. **P1 — Blocked-by picker.** Search tasks in the same workspace; show dependents as read-only.
25. **P1 — Recurring task occurrence scope.** Same this / this and following / entire series flow the event screen already has. Wire `editTaskOccurrence` + `splitTaskSeries` from a confirm sheet when the task has recurrence.
26. **P1 — Block management.** Per-block pin, reschedule, delete; “Clear all time”; unschedule. Match `taskScheduleSection.tsx`.
27. **P2 — Checklist rename.** Long-press → edit title via `updateChecklistItem`.
28. **P2 — Preferred windows.** Multiple windows + weekday chips, same model as web.
29. **P2 — Duration / actual minutes.** Show focused time; keep start/stop.

---

## 7. Calendar and scheduling

Web: Day / Week / Month / Agenda, waiting-for-slot rail, drag tasks and blocks, click empty slot → schedule dialog, auto-schedule dialog with skip reasons and capacity, occurrence skip/restore.

Mobile: Day / Month / Agenda (`CALENDAR_VIEWS` includes week but the screen’s `CalView` type omits it). Reschedule via `CalendarItemSheet`. No empty-slot create, no waiting rail, no drag. Auto-schedule sheet exists and is solid.

### Work

30. **P1 — Week view.** 7-day compact grid or agenda-by-day pager for the selected week. Types already include `"week"`.
31. **P1 — Waiting-for-slot.** Surface ranked unscheduled work (`waiting` from calendar range / schedule rank). Actions: Schedule this, open task, drag is optional. Without this, auto-schedule is a black box on the phone.
32. **P1 — Create from an empty slot.** Tap a day/hour → Quick Add or schedule sheet prefilled with that start (task vs event), matching desktop `scheduleDialog`.
33. **P1 — Event extras.** Color, optional project, notes on create/edit. Payload fields already exist; Quick Add and event detail ignore them.
34. **P2 — Auto-schedule copy.** Port skip reasons, partial placement, past-deadline warnings, and a link to Schedule settings from the desktop dialog so preview/apply/undo is equally explainable.
35. **Keep — No native drag-drop on the grid** until week view exists. Datetime sheet reschedule is the touch equivalent of drag-move.
36. **P2 — Capacity strip.** `GET /schedule/capacity` is implemented; show a simple hours-free vs hours-placed hint on day/week.

---

## 8. Projects

Web `/projects` cards + `/projects/[id]` with **Overview / Tasks / Stages / Activity**. Tasks tab reuses list/kanban/gantt scoped via `projectTaskViews`. Stage board is drag-and-drop. Color + rich description. Activity feed (explicitly missing: project field edits).

Mobile list + detail: plain description, status, priority, dates, complete, duplicate, delete, stages add/rename/delete/reorder, vertical lists + long-press move. No color picker, no rich description, no activity tab, no in-project task views, no create-task-from-board. `getProjectActivity` is **missing from the mobile API client**.

### Work

37. **P1 — Project activity.** Add `getProjectActivity` to `lib/api/projects.ts` and an Activity section. Same honesty as web: “Edits to the project’s own title, dates and description are not recorded yet.”
38. **P1 — In-project task list.** “Open tasks” already links with `?projectId=`. Add New task (prefill project) and the same filters as the Tasks tab.
39. **P1 — Color + description.** Color chip and, once task notes use the rich editor, project description too.
40. **P2 — Stage board UX.** Horizontal pager per stage is enough; keep long-press move. Drag-and-drop is optional.
41. **P2 — Custom field values on projects.** Payload supports them; neither surface is equally complete (web detail panel is also light). If web grows this, mobile must follow in the same phase.

---

## 9. Docs

Both have TipTap (web native editor, mobile WebView), a slash menu, @ mentions, autosave, SSE watch, favorite, archive, Markdown import/export, delete with subpage warning.

Web has a nested tree, search, add subpage, move to top level, open in new window, emoji icons, word count, a **fixed full toolbar** on the page editor, and a floating selection toolbar + table toolbar.

Mobile list is **flat Favorites + Recent**, parent can be set on the editor, `order` is unused, `projectId` unused, `RichDoc.tsx` is dead code. The WebView already implements most `cmd()`s; the React slash list and format bar do not expose all of them.

### Slash commands — required set

Source of truth: `apps/web/app/_components/editor/slashMenu.tsx` `createSlashItems()`. Mobile list: `SLASH` in `apps/mobile/components/editor/RichTextEditor.tsx`.

| Command | Web | Mobile `/` menu | Mobile `cmd()` |
| --- | --- | --- | --- |
| Text (paragraph) | Yes | Yes | `paragraph` |
| Heading 1 / 2 / 3 | Yes | Yes | `h1` `h2` `h3` |
| Bulleted list | Yes | Yes | `bullet` |
| Numbered list | Yes | Yes | `ordered` |
| To-do list | Yes | Yes | `task` |
| Quote | Yes | Yes | `quote` |
| Code block | Yes | Yes | `code` |
| Table 3×3 | Yes | Yes | `table` |
| Divider | Yes | Yes | `hr` |
| **Link** | Yes (opens link popover) | **Missing** | **Missing** (`setLink` / URL sheet) |
| Mention | Yes | Yes | `mentionChar` |
| **Page** (nested subpage + link) | Yes on `/docs/[id]` | **Missing** | **Missing** (`onCreateSubpage`) |

### Docs toolbar — required set

Web fixed toolbar (`richTextEditor.tsx`): Bold, Italic, Strikethrough, **Inline code**, Highlight, H1–H3, bulleted / numbered / to-do, Quote, Code block, Mention, **Link**.

Web table toolbar when the caret is in a table: add/delete column, add/delete row, **header row**, **header column**, **merge cells**, **split cell**, delete table.

Mobile `FORMAT_TOOLS` already has bold/italic/strike/highlight/H1–H3/lists/todo/quote/code/table/divider/mention. Mobile `TABLE_TOOLS` has add/delete row/col and delete table only.

### Work

42. **P1 — Nested list.** Indent by `parentId`, expand/collapse, add subpage, move to top level. Do not port “open in new window”.
43. **P2 — List search and archive toggle** already exist; add a simple tree filter so nested pages are findable.
44. **P2 — Remove or use `RichDoc.tsx`.** Dead renderer; either wire it as a read-only preview or delete it.
45. **Keep — WebView editor.** Matching slash/mention/table is more important than swapping engines. Keep the 12s load overlay; add a retry.
76. **P0 — Complete slash menu.** Add **Link** (prompt for URL, `setLink` / unset) and **Page** (create child doc, insert page mention — same as web `onCreateSubpage`). Filter, keywords, and order must match `createSlashItems()`. Keep markdown shortcuts (`#`, `##`, `###`, `.` / `*`, `1.`, `[]`, `>`, `-` for hr).
77. **P0 — Full docs toolbar.** Pin a horizontally scrollable bar (plus table bar when `inTable`):
    - Marks: bold, italic, strike, **inline code**, highlight, **link**
    - Blocks: H1–H3, bullet, numbered, todo, quote, code block, divider, mention, table
    - Table: add/delete row/col, **header row**, **header column**, **merge**, **split**, delete table
    - Active-state highlighting like web (`isActive`)
    - Theme tokens from the universal palette (the WebView CSS is currently hardcoded dark `#1a1b22`)

---

## 10. Sheets

Formula engines are aligned (`SUM`, `AVERAGE`/`AVG`, `MIN`, `MAX`, `PRODUCT`, `COUNT`, `COUNTA`, `ABS`, `SQRT`, `ROUND`, `FLOOR`, `CEILING`, `POWER`, `IF`, `AND`, `OR`, `NOT`, `CONCAT`/`CONCATENATE`, `LEN`, `UPPER`, `LOWER`, `TRIM`).

Web additionally: **workbook tabs**, CSV import on the list + CSV export of evaluated values, duplicate, fill-down with relative refs, merge, undo/redo, print, paint format, zoom, number formats, fonts, colors, borders, align, wrap, rotation, links, notes, **charts**, filter, sort, column types.

Mobile: single grid, in-cell + formula bar, add/delete rows/cols, rename columns, column types, clear, checkbox columns. No `duplicateSheet` in `lib/api/sheets.ts`. No CSV. Description is plain text. Dedicated sheets tab is hidden. The format ribbon on web is **not** optional polish anymore — it is required on mobile (touch-adapted).

### Sheets toolbar — required set

Web ribbon in `sheetGrid.tsx` (port all except Print):

| Group | Controls |
| --- | --- |
| History | Undo, Redo |
| View | Zoom (optional compact: pinch + a % chip). **Skip Print** — use share/export. |
| Number | Currency, percent, fewer/more decimals, number-format menu (automatic, plain, number, percent, scientific, currency) |
| Font | Default / serif / mono, size, bold, italic, underline, strike, text color, fill color |
| Align | Horizontal, vertical, wrap, rotation |
| Structure | Merge / unmerge, borders, paint format |
| Insert | Rows/cols before/after, delete row/col (mobile already has these) |
| Formula | `fx` bar (mobile has this) + insert `SUM AVERAGE COUNT MAX MIN COUNTA PRODUCT IF CONCAT ROUND` |
| Data | Sort A→Z / Z→A, filter, column type, clear, cut/copy/paste |

### Work

46. **P1 — Duplicate sheet.** Add `POST /sheets/:id/duplicate` to the mobile client and a list/editor action.
47. **P1 — CSV import / export.** List: import CSV (web already has the parser in `sheetCsv.ts` — port or share). Editor: export evaluated CSV via share sheet.
48. **P1 — Workbook tabs.** `tabsFromSheet` / `workbookPayload` live on web (`sheetWorkbook.ts`). Port the tab bar; the API already stores extra sheets in the document payload.
49. **P1 — Sort / filter.** Sort A→Z/Z→A and a simple filter matching web. Column types already exist.
50. **P0 — Full sheets toolbar.** Implement the table above as one or two wrapping / paging toolbars above the grid. Persist the same `SheetCellFormat` / merge / number-format fields the web grid already writes so a sheet opened on desktop keeps formatting. Charts remain P2.
51. **P2 — Rich sheet description + mentions** to match docs/web.

---

## 11. Search, notifications, report

### Search

Both call `GET /search` with `mode=semantic` and fall back to keyword on 503. Hits: task, project, doc, sheet, event. Mobile is a tab; web is a modal. Fine.

52. **P2 — Navigate events to a date.** Web dumps events on `/calendar` without the occurrence. Pass a date query on both so the right day opens.
53. **P2 — Empty/error states.** Show semantic-unavailable vs no hits.

### Notifications

Web sidebar badge uses `unreadNotificationCount`. Mobile hook exists and is **never rendered**. Snooze 15m / 1h / Tomorrow 9:00 matches. Non-task entities often cannot navigate.

54. **P1 — Unread badge** on the Notifications row (and whatever tab/hub hosts it).
55. **P1 — Deep links.** If `taskId` is absent, route by entity type to project/doc/event.
56. **P2 — `reschedule` API** (`POST /notifications/:id/reschedule`) is unused on both; only add if snooze is insufficient.

### Report

`buildReportData` on mobile already computes `priorities`, `byProject`, and `mentions` and **does not render them**. Settings copy says “focus time”; there is no focus-minutes UI on either surface.

57. **P1 — Render remaining report sections** (priority bars, projects with open work, mention graph as a simple list of links).
58. **P1 — Tappable recent items.**
59. **P2 — Align stats with web** (inbox/reminders excluded from “work”, per-source error banners so a failed feed is not shown as zero).
60. **Both missing — Focus-time chart.** Either ship it on both or drop the marketing copy.

---

## 12. Settings

| Area | Web | Mobile | Work |
| --- | --- | --- | --- |
| Account | Profile + sessions | Profile only | §3 |
| Appearance | System / light / dark, accent, **localStorage only**; copy says “Changes stay on this device.” | Light / dark in SecureStore; no system, no accent | **79 — universal theme** |
| Schedule | Weekday windows, timezone select, buffer, freeze, exclude workspaces | Same, timezone is free text | 63 |
| Notifications | Prefs + failed jobs | Prefs + permission + jobs | Match |
| Workspaces | Full status/label/field CRUD | Create workspace; **cannot updateStatus / updateLabel** | 64 |
| Data | JSON, CSV, ICS, encrypted backups, restore | Same + share | Match |
| API keys | Hermes YAML snippet | Create/list/revoke | 65 |

### Work

61. **Superseded by 79.** Do not ship a mobile-only local theme that disagrees with web.
62. **Superseded by 79.**
63. **P2 — Timezone picker.** Replace the IANA text field with a searchable list (`apps/web/app/utils/timezones.ts` or `Intl.supportedValuesOf('timeZone')`).
79. **P0 — Universal theme (API + web + mobile).** One appearance for the account:
    1. Add `appearance: { theme: "system" \| "light" \| "dark", accent: "default" \| "#RRGGBB" }` on user config (`PUT /config` already exists; `models.Config` has no theme field today). Migration + default `system` / violet `#6E56CF`.
    2. **Same token set on both clients.** Reuse web presets from `apps/web/app/utils/theme.ts` (`ACCENT_PRESETS`, `DEFAULT_ACCENT_HEX`). Mobile `lib/theme.ts` must derive `primary` / `ring` / `accent` from that hex, including light and dark ramps. Docs WebView CSS (`editorHtml.ts`) currently hardcodes dark colors — it must follow the live theme.
    3. **Same controls:** System / Light / Dark + accent swatches + custom hex on **both** Settings → Appearance. Sidebar auto-hide stays web-only.
    4. **Sync:** reading config on launch applies theme; writing from either client updates the other after refetch. Keep a short local cache so the splash is not wrong before `/config` returns.
    5. Stop telling users “Changes stay on this device” on web (`appearanceSettings.tsx`).
    6. Auth/landing pages may still force a look, but the signed-in app must not.
64. **P1 — Edit statuses and labels.** Wire existing `updateStatus` / `updateLabel` (name + color). Users who set up taxonomy on desktop cannot fix a typo on the phone.
65. **P2 — Hermes YAML snippet** after creating a key, for copy/share. Optional on mobile.
66. **P2 — Notification timezone.** Persist the working-hours timezone onto notification settings (called out in FEATURES.md).

---

## 13. API client gaps (mobile)

Functions the API already serves, web uses, and mobile either lacks or never calls from a screen:

| Function | In mobile client? | Used in UI? | Needed for |
| --- | --- | --- | --- |
| `listSessions` / `revokeSession` / `revokeOtherSessions` | No | No | Account |
| `duplicateSheet` | No | No | Sheets |
| `getProjectActivity` | No | No | Projects |
| `updateTaskViewsConfig` / `getConfig` for views | `getConfig` yes | Views unused | Task views |
| `splitTaskSeries` | Yes | No | Recurring tasks |
| `clearTaskBlocks` / `deleteBlock` | Yes | No | Schedule section |
| `getCapacity` | Yes | No | Calendar |
| `unreadNotificationCount` | Yes | No | Badge |
| `updateStatus` / `updateLabel` | Yes | No | Workspace editor |
| `unregisterPushDevice` | Yes | No | Logout |
| `getEvents` | Yes | No | Fine (range endpoint is enough) |

### Work

67. **P1 — Close the client holes** in one pass (`sessions`, `duplicateSheet`, `getProjectActivity`, optionally `deleteWorkspace`) so screens are not blocked on wrapper work later.

Web-only client notes (not mobile gaps): `watchDoc` exists on both; sheets have no SSE on either; `POST /search/reindex` is unused in both UIs.

---

## 14. Shared logic that should not be forked twice

Several modules are already copy-pasted (`overdue.ts`, `status.ts`, `entityColor.ts`, `priority.ts`, `recurrence.ts`, `sheetFormula.ts`, `report.ts`, `markdown.ts`, `richText.ts`). Parity work will make this worse unless the implementations stay aligned.

### Work

68. **P2 — Treat formula/report/recurrence as shared contracts.** When you change `sheetFormula` or `buildReportData` on one app, change the other in the same PR. A future `packages/shared` is optional; dual-edit in one commit is mandatory until then.
69. **P1 — Task filter helpers.** Port `apps/web/app/utils/taskFilters.ts` (`isInboxTask`, `isReminderTask`, dated/scheduled) to mobile so Board/Reminders/Inbox cannot drift (mobile currently uses `duration <= 0` as a reminder proxy).

---

## 15. Reliability and copy bugs (parity-adjacent)

70. **P0 — Pull-to-refresh** (§4). Empty states lie today.
71. **P0 — Inbox auto-schedule side effect** (§5).
72. **P1 — Connectivity vs stale data.** Web: “Offline · showing saved data…”. Mobile banner is good; React Query `staleTime: 15s` with no persisted cache means a cold start offline is empty. Decide: persisted query cache (P2) or honest “needs network” empty states (P0).
73. **P2 — Offline queue coverage.** Only complete / today-focus / lock / some occurrence and checklist toggles queue. Title edits, captures, and calendar moves still fail offline. Widen only after the queue has tests; do not silently queue creates without conflict UI.
74. **P2 — Reduce Expo template leftovers** (`EditScreenInfo`, `StyledText`, unused `constants/Colors.ts`) so the mobile tree matches what the product actually is.

---

## 16. What not to copy

These are **not** parity work:

| Web-only / desktop-shaped | Why |
| --- | --- |
| Keyboard shortcuts (`G then T`, `C`, `/`, `⌘K`) | No hardware keyboard requirement. Optional later for iPad/keyboard. |
| Right-click context menus | Long-press / overflow is the mobile equivalent (already used on tasks). |
| Auto-hide sidebar | No sidebar. |
| Electron menus, window size, `window.timelyDesktop` | Shell only; unused by React. |
| View Transitions API | Web CSS. Mobile equivalent is native stack `ios_from_right` / `slide_from_right`, tab fade, and Reanimated sheets — **not** a DOM ViewTransition. Baseline is in `apps/mobile/lib/motion.ts`. |
| Print on sheets | Use share / export on mobile. Zoom/paint-format **are** now required (item 50). |
| Command palette | Search is not one on either surface; don’t invent it for mobile. |

| Mobile-only extras | Why |
| --- | --- |
| Expo push + `ReminderNotifications` local schedule | Desktop has no OS notification permission UI on purpose. |
| SecureStore session | Cookie/sessionStorage on web. |
| Native share / document picker | Web uses `<a download>` and `<input type=file>`. |
| FAB Quick Add | Desktop uses sidebar +. |
| ConnectivityBanner + mutation file | Web only needs the offline banner. |

---

## 17. Shared product gaps (both surfaces)

Do not track these as web-vs-mobile debt. From FEATURES.md / NextPhase.md:

- Team/sharing/ACL (permanently out of scope)
- Google/Outlook two-way sync
- Comment edit/delete
- Project field-level activity
- Gantt bar resize
- Doc/sheet version history, images, attachments
- In-app Hermes chat (MCP-only)
- Email notifications
- Billing, i18n
- Password-reset email

If any of these are built later, **both** clients ship in the same phase (`NextPhase.md` §1).

---

## 18. Suggested delivery order

Order follows the daily loop, then planning depth, then knowledge, then polish. Each phase must land on **mobile and any web glue it needs**, not mobile-only hacks.

### Phase A — Stop lying, make the loop findable (P0)

- Navigation: Today / Inbox / Notifications one tap away
- Today rebuilt from `GET /today` (focus, complete, shutdown, agenda)
- Pull-to-refresh
- Stop `applySchedule` on inbox create
- Honest offline empty states
- **Universal theme (79)** so later UI is not restyled twice

**Exit:** A phone-only user can capture, see today, start focus, and shut down the day without opening Settings. Appearance matches desktop.

### Phase B — Editors and capture (P0)

- Complete docs slash commands (76) and full docs toolbar (77)
- Full sheets toolbar (50)
- Markdown / rich text on task **create** (75) and task **detail** (23)
- Stitch mobile visual overhaul (80) against Kinetic Dark Velocity — after theme tokens exist
- Motion baseline (81) is already in the app; Stitch restyle must keep stack/sheet springs

**Exit:** Writing a doc, a sheet, or a task description on the phone is not a downgrade from desktop.

### Phase C — Tasks and calendar depth (P0–P1)

- Consume saved task views
- Recurrence split + block delete/clear
- Blocked-by
- Week view + waiting-for-slot + empty-slot create
- Unread notification badge + entity deep links
- Status/label edit in workspace settings
- Sessions UI + push unregister

**Exit:** A view, recurring series, or unscheduled pile created on desktop is usable on the phone.

### Phase D — Projects, docs tree, sheets portability (P1)

- Project activity, color, in-project create
- Nested docs list
- Sheet duplicate, CSV, workbook tabs
- Report sections that are already computed
- API wrappers from §13

**Exit:** Knowledge and projects are not “desktop only.”

### Phase E — Polish (P2)

- Kanban columns / optional gantt
- Preferred windows, capacity, join-call
- Timezone picker, Hermes YAML share
- Shared filter helpers, dead-code cleanup
- Optional persisted offline cache
- Sheet charts

---

## 19. Acceptance checklist

A gap is done when:

1. The same user action is possible on web and native (or explicitly **Keep**).
2. The native interaction is touch-native (sheet, long-press, share), not a squeezed desktop toolbar.
3. API behavior is unchanged or shared (no mobile-only field semantics).
4. Empty, error, and offline states tell the truth.
5. If config is persisted on one client (task views, **appearance**, workspace taxonomy, working hours), the other client **reads and applies** it.
6. Docs `/` menu and toolbars, and the sheets ribbon, have the same commands as web (Link, Page, inline code, table merge/split/headers, sheet number/font/align/merge — Print excluded).
7. A newly created task can carry markdown / rich text, not only a title.

---

## 20. File map for implementers

| Area | Web | Mobile |
| --- | --- | --- |
| Nav | `apps/web/app/_components/_layout/sidebar.tsx` | `apps/mobile/app/(app)/(tabs)/_layout.tsx`, `more.tsx` |
| Today | `apps/web/app/_components/today/todayDashboard.tsx` | `apps/mobile/app/(app)/today.tsx` |
| Inbox | `apps/web/app/(pages)/(nav_pages)/inbox/page.tsx` | `apps/mobile/app/(app)/inbox.tsx` |
| Tasks | `apps/web/app/(pages)/(nav_pages)/tasks/page.tsx`, `_components/_ui/tasks/*` | `apps/mobile/app/(app)/(tabs)/tasks.tsx`, `tasks/[id].tsx` |
| Saved views | `apps/web/app/utils/hooks/taskViews.ts` | types only in `lib/types.ts` |
| Calendar | `apps/web/app/(pages)/(nav_pages)/calendar/page.tsx`, `calendarView/*` | `apps/mobile/app/(app)/(tabs)/calendar.tsx`, `components/calendar/*` |
| Projects | `apps/web/app/(pages)/(nav_pages)/projects/*`, `stageBoard.tsx` | `apps/mobile/app/(app)/projects/*` |
| Docs | `apps/web/app/(pages)/(nav_pages)/docs/*`, `editor/slashMenu.tsx`, `editor/richTextEditor.tsx` | `apps/mobile/app/(app)/(tabs)/docs.tsx`, `docs/[id].tsx`, `components/editor/*` |
| Sheets | `apps/web/app/_components/sheets/sheetGrid.tsx`, `utils/sheet*.ts` | `apps/mobile/components/sheets/SheetGrid.tsx`, `lib/sheet*.ts` |
| Task create | `apps/web/app/_components/_ui/modal/addItem.tsx` | `apps/mobile/components/ui/QuickAddSheet.tsx` |
| Theme | `apps/web/app/utils/theme.ts`, `settings/appearanceSettings.tsx` | `apps/mobile/lib/theme.ts`, `(tabs)/more.tsx` |
| Motion | `apps/web/app/_components/_ui/motion.tsx`, `utils/viewTransition.ts` | `apps/mobile/lib/motion.ts`, stack/tab layouts, `AnimatedPressable`, `ListEnter` |
| Stitch | `.stitch/metadata.json`, `.stitch/designs/` | Same project, mobile device type; MCP in `~/.cursor/mcp.json` |
| Report | `apps/web/app/(pages)/(nav_pages)/report/page.tsx` | `apps/mobile/app/(app)/report.tsx`, `lib/report.ts` |
| Settings | `apps/web/app/_components/settings/*` | `apps/mobile/app/(app)/settings/*` |
| API | `apps/web/app/utils/api/*` | `apps/mobile/lib/api/*` |
| Routes | — | — (shared) `apps/api/internal/routes/routes.go` |

---

## 21. Count of work items

| Priority | Items | Role |
| --- | --- | --- |
| P0 | Nav 1; Today 10, 14; Inbox 15, 71; views 18; editors **23, 50, 75, 76, 77**; theme **79**; Stitch **80**; empty states 70, 72 | Daily loop + writing + look |
| P1 | Most of §§3–13 (sessions, kanban, week, waiting rail, project activity, docs tree, sheet CSV/tabs, report, badges, taxonomy edit) | Feature completeness |
| P2 | Gantt, capacity, sheet charts, shared packages, dead code | Polish |
| Keep | Shortcuts, Electron, push, FAB, no grid-drag, sheet Print | Do not copy |
| Both missing | Workspace delete UI, comment delete, focus chart, OAuth | Separate backlog |
| Blocked | **80** until the agent is restarted with Stitch MCP | Design overhaul |

Closing parity is **mobile UI + a small config API for appearance**, plus client wrappers. The Stitch overhaul is visual; it does not replace the functional list above. Motion baseline (81) is in the native app.

---

## 22. Stitch credentials and mobile design overhaul

### Credentials — local Cursor MCP only

As of 17 Sep 2026 the Stitch server is configured at **`~/.cursor/mcp.json`** (user-level, outside the repo). `.cursor/mcp.json` is gitignored if anyone copies it into the project.

- Restart Cursor / the agent after adding MCP so `mcp_stitch_*` tools appear.
- **Never commit the API key.** It was provided in chat; rotate it if this transcript is shared.
- This session’s tool list may still lack Stitch until that restart. HTTP fallback: `https://stitch.googleapis.com/mcp` with `X-Goog-Api-Key`. SDK: `@google/stitch-sdk`. Upload screenshots via the SDK upload path, not base64 in a tool payload.

Do not paste keys into `PARITY.md` or any tracked file.

### Existing Stitch project

| | |
| --- | --- |
| Title | Timely |
| Project id | `3890227041261643615` |
| Design system | **Kinetic Dark Velocity** (`assets/22600a2adfbd47709b3b6c2cb46a4ca0`) |
| Screens already in metadata | login, inbox, project overview, docs hub/editor, sheets hub/editor, report, notifications, settings (settings marked “Stitch edit unavailable”) |
| HTML dumps | `.stitch/designs/*-redesign.html` (desktop-oriented) |

| Origin | STITCH, `projectType` TEXT_TO_UI_PRO, **`deviceType: DESKTOP`** (existing screens). Mobile overhaul may need `generate_screen_from_text` with `deviceType: MOBILE`, or a sibling mobile project if Stitch rejects mixed devices. |

### Work

80. **P0 — Mobile visual overhaul via Stitch** (credentials are local; restart the agent). After theme tokens (79) exist:

    1. Confirm MCP (`list_projects` should return `3890227041261643615`).
    2. Generate **mobile** screens (`deviceType: MOBILE`), one route per cycle: login → signup/onboarding → tab shell (Calendar, Tasks, Search, Files, Settings) → Today, Inbox, task detail, calendar day/agenda, docs editor (with full toolbar), sheets editor (with full toolbar), Quick Add (markdown), notifications, report.
    3. Translate Stitch HTML/PNG into existing Expo components (`Screen`, `MobileHeader`, `primitives`, `theme.ts`). **Do not paste Stitch HTML into the app.**
    4. Keep Timely identity (violet, Kinetic Dark Velocity) and the same labels/flows; improve hierarchy, type, spacing, and surfaces so mobile does not look like a squeezed desktop or an Expo template.
    5. Verify light **and** dark, and a second accent, because theme is universal.
    6. Keep the motion system in `apps/mobile/lib/motion.ts` (stack push, tab fade, sheet spring, press scale). Stitch must not flatten everything to instant cuts.
    7. Drop notes per route (what changed vs current RN). Prefer a `notes.md` outside git if dumps are large.

81. **P0 — Native motion / view-transition equivalent (baseline shipped 17 Sep 2026).** Web uses `<ViewTransition>` + motion.react. Mobile now uses:
    - Stack: iOS `ios_from_right` / Android `slide_from_right` for detail screens; fade for tabs and hub pages; edge swipe-back
    - Tabs: cross-fade
    - Overlays: Reanimated fade + slide sheets, toast/banner enter
    - Press: spring scale on FAB, primary buttons, chips, task rows
    - Lists: staggered `FadeInDown` on the task list
    - Reduce Motion: native `animation: "none"` and skipped entering transitions
    Remaining: apply `ListEnter` to inbox/notifications/projects; delay-unmount sheets/toasts so exit animations play; shared-element morphs if Stitch specifies them.
