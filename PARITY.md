# Web ↔ Mobile parity

Last inventoried **17 Sep 2026** from `apps/web`, `apps/mobile`, and `apps/api/internal/routes/routes.go`, then updated the same day with product decisions below. Phase A P0 work from this file landed the same day: universal appearance on `PUT /config`, a Home tab for Today / Inbox / Notifications, Today rebuilt from `GET /today`, pull-to-refresh, honest offline empty states, and no auto-schedule on inbox create. This is a work plan, not a product proposal. It lists what already matches, what is thinner on one surface, and the concrete work required to close each remaining gap.

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
| Native (`apps/mobile`, Expo SDK 57) | Daily capture + **Home/Today** + calendar + task cards + editors + settings. Extra: Expo push, local reminder scheduling, offline mutation queue, native share |
| API (`apps/api`) | Shared source of truth. Appearance lives on user config. Most remaining gaps below are **UI work**, not a missing endpoint |

Auth, CRUD, search, auto-schedule preview/apply/undo, working hours, backups, API keys, a TipTap docs editor, sheet formulas, inbox capture, and task detail are present on both. Theme is **universal** (`appearance` on `GET`/`PUT /config`). Docs slash/toolbars, sheet formatting, task markdown create/detail, Kinetic Dark Velocity chrome (80), **saved task views (18)**, week calendar + waiting rail, blocked-by / series split / block delete, sessions, status/label edit, **nested docs**, **sheet CSV/tabs/filter**, project color/create, report sections, **kanban columns**, extra Filters sheet, and event extras shipped on native. Remaining work is Phase E polish (P2) plus the persisted-cache leftover of 72.

---

## 1. Capability matrix

| Capability | Web | Mobile | Gap |
| --- | --- | --- | --- |
| Login / signup / onboarding | Yes | Yes | Match |
| Device sessions (list / revoke) | Yes | Yes (This device badge) | **Match (6 shipped)** |
| Forgot password / OAuth / 2FA / biometrics | No | No | Both missing (out of NextPhase scope except recovery) |
| Today dashboard | Full (focus picker, agenda, shutdown, join-call) | Home tab from `GET /today` | Match on loop; star picker is simple list |
| Inbox capture | Full + shortcuts | Title capture; not auto-scheduled | Mobile P1 list actions |
| Task list | Saved views, group, columns | Card list + **saved views** + Filters sheet + chips | **Match (18, 21 shipped)**; create/rename views waits |
| Kanban | Drag to status | Horizontal columns; long-press → change status | **Match (19 shipped)** |
| Gantt | Drop-to-date (no bar resize) | None | Mobile P2 |
| Bulk task actions | Yes (list) | Yes (long-press) | Match |
| Task detail | Rich notes, blocked-by, occurrence split, clear/delete blocks | Same | **Match (23–26 shipped)** |
| Calendar D/W/M/Agenda | All four | Day / **Week** / Month / Agenda | **Match (30 shipped)** |
| Waiting-for-slot rail | Yes + drag onto grid | Ranked list + Schedule this | **Match (31 shipped)**; drag Keep |
| Drag-drop calendar | Yes | Reschedule via sheet; empty-slot create | Keep + **32 shipped** |
| Auto-schedule preview/apply/undo | Yes | Yes | Match |
| Auto-schedule after every create | No | No (gated: work tasks with duration + workspace) | Match |
| Events this/future/all | Yes | Yes | Match |
| Task occurrence split | Yes | This / following / series | **Match (25 shipped)** |
| Projects hub + stages | Tabs, drag board, activity, color, rich desc | List + color + rich desc + in-project create + activity | **Match (37–39 shipped)**; stage drag P2 |
| Sheet duplicate | Yes | Editor More → Duplicate | **Match (46 shipped)** |
| Workspace statuses/labels/fields | Full CRUD | Add / **rename+recolor** / delete | **Match (64 shipped)** |
| Docs tree / favorites / archive | Nested sidebar | Nested list + favorites; long-press add/move | **Match (42 shipped)** |
| Docs editor (slash, @, SSE watch) | Yes | Yes (WebView) | Match |
| Docs slash commands | Text, H1–H3, lists, todo, quote, code, table, divider, link, mention, page | Same including **Link** and **Page** | **Match (76 shipped)** |
| Docs / sheets toolbar | Full format + table (docs); full format + formula (sheets) | Docs: full format + table merge/split/headers; sheets: format ribbon | **Match (50, 77 shipped)** |
| Task create markdown | RichTextEditor in Add Item | Compact RichTextEditor writes `descriptionRich` | **Match (75 shipped)** |
| Sheets formulas | Yes | Yes (same function set) | Match |
| Sheets workbook tabs, CSV, charts, format | Yes | Format ribbon + merge + **CSV** + **tabs** + sort + **row filter**; no charts | **Match (47–49 shipped)**; charts P2 |
| Sheet duplicate | Yes | Editor More → Duplicate | **Match (46 shipped)** |
| Report | Full (priority, mentions, projects) | Same sections, tappable recent | **Match (57, 58 shipped)** |
| Search | Modal ⌘K | Tab | Match (IA differs) |
| Notifications list + snooze | Yes + sidebar badge | Yes + Home badge | Match |
| Notification settings + jobs | Yes | Yes + OS permission | Match |
| Working hours + engine freeze | Yes, timezone picker | Yes, timezone text field | Mobile P2 |
| Workspace statuses/labels/fields | Full CRUD | Add / **rename+recolor** / delete | **Match (64 shipped)** |
| Delete workspace | API + MCP only | API unused | Both missing |
| Account profile | Yes | Yes | Match |
| Appearance | System / light / dark + accent, **account config** | Same controls + tokens | **Match (79 shipped)** |
| Accent color | Presets + custom hex | Presets + custom hex | Match |
| Data export / backup / restore | Yes | Yes + share sheet | Match |
| API keys | Yes | Yes | Match |
| Keyboard shortcuts | Full | None | Keep |
| Motion / view transitions | `<ViewTransition>` + motion.react | Native stack push, tab fade, spring sheets, press scale, list enter | **Match (81)**; Stitch chrome keeps springs |
| Push + local reminder alarms | No | Yes | Keep |
| Offline mutation queue | Banner only | Narrow queue | Keep + P2 widen |
| Pull-to-refresh | n/a | Today, Tasks, Inbox, Calendar agenda, Files, Notifications | Match |
| Electron window / native menus | Yes | n/a | Keep |

---

## 2. Navigation and information architecture

Web sidebar (always visible unless auto-hidden): **Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications, Settings**.

Mobile tabs: **Home, Calendar, Tasks, Search, Files**. Settings is a gear on Home (`(tabs)/more`, `href: null`). Inbox and Notifications are one tap from Home. Projects, Report, Workspaces, Data, and API keys live under Settings. Sheets are a hidden tab (`href: null`) and a segment inside Files.

### Work

1. **Shipped — Home tab.** Today, inbox count, and notifications badge are on Home. Settings is nested, not a fifth “destinations mixed with chrome” tab.
2. **P1 — Projects as a first-class destination.** Same discoverability as Tasks. Linking from Settings-only is not enough.
3. **P2 — Collapse the duplicate settings hubs.** `/(app)/(tabs)/more` and `/(app)/settings` overlap. Keep one hub. Appearance is on the Settings hub.
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

6. **Shipped — Mobile device sessions.** Settings → Account lists devices, “This device”, revoke one, sign out everywhere else.
7. **Shipped — Unregister push on logout.** `unregisterServerPush` runs before `/logout`.
8. **Both missing — Workspace delete in UI.** `DELETE /workspaces/:id` exists; only MCP `delete_workspace` uses it. Add a guarded delete (not last workspace) on **both** Settings → Workspaces screens.
9. **Keep — No OAuth / biometrics / 2FA** unless NextPhase reopens recovery. Password reset remains the local `apps/api/scripts/reset_password.go` command.

---

## 4. Today

Web `/today` is a dense home: Today Focus (max 7, star picker **P**), live focus timer, scheduled agenda with now-line, **Join call** for Meet/Zoom/Teams URLs, reminders, overdue + reschedule, inbox triage bar, **End of day shutdown** (moves unfinished to tomorrow’s focus, undo), Plan Tomorrow.

Mobile `/(app)/(tabs)/home` (and `/(app)/today` redirect) is rebuilt from `GET /today`: focus picker, elapsed timer, complete-from-list with undo, scheduled agenda including reminders, overdue, inbox count, end-of-day shutdown with undo, pull-to-refresh, join-call, tappable events.

### Work

10. **Shipped — Rebuild mobile Today around the same data as `GET /today`.** Remaining polish: reschedule overdue into a calendar/task sheet (still opens task detail).
11. **Shipped (simple) — Star picker on mobile.** Open work list, exclude inbox/reminders/subtasks/already starred. Full search can wait.
12. **Shipped — Join-call affordance** when a calendar item URL matches Meet/Zoom/Teams (`Linking.openURL`).
13. **Shipped — Tappable events.** Scheduled rows without `taskId` open `/(app)/events/[id]`.
14. **Shipped — Pull-to-refresh** on Today, Tasks, Inbox, Calendar (agenda), Files, Notifications.

---

## 5. Inbox

Both capture a title as `kind: "inbox"`. Web has **C** focus, flash “Captured”, and copy that inbox is never auto-scheduled. Mobile capture is the same. `useCreateTask` only auto-applies the engine for work tasks with `duration > 0` and a workspace.

### Work

15. **Shipped — Stop auto-applying the engine on inbox (and event) create.** Gated to work tasks with `duration > 0` and a workspace.
16. **P1 — Inbox list actions.** Swipe or overflow: Review, delete, convert to reminder, complete. Today users must open the full task screen for every triage.
17. **P2 — Capture feedback.** Toast “Captured” and keep the field focused for rapid capture.

---

## 6. Tasks

This is the largest functional gap.

### 6.1 List, views, filters

Web `/tasks` persists **saved views** in user config (`taskViews` + `activeTaskViewId`): list / kanban / gantt, Tasks vs Projects vs Reminders, up to 3 group-bys (including custom fields), sort, filters, column order. Deep links `?taskId=` / `?projectId=`.

Mobile is a card list that **consumes desktop saved views** (filters, data mode, group field, sort). Without views, chips remain: All, Today, Overdue, Upcoming, No date, Done, Reminders, Board. Extra Filters sheet overlays status, priority, labels, stage, overdue, scheduled, recurring, and only-dated. Board is always available even when saved views exist.

### Work

18. **Shipped — Honor desktop saved views on mobile.** Reads `config.taskViews` / `activeTaskViewId`, switches views (persists active id), applies filters and data mode (tasks / reminders / projects). Creating/renaming views still waits.
19. **Shipped — Mobile kanban.** Horizontal status columns (Board chip or a saved kanban view). Long-press a card → Move to status, using the same completing-status → `completedAt` rule as web.
20. **P2 — Mobile gantt.** Compact bars from start/blocks/deadline; tap opens detail; drop or sheet to set dates. Bar resize is not required (web does not have it either).
21. **Shipped — Filter depth.** Filters sheet: status, priority, labels, stage, overdue, scheduled, recurring, only-dated. Workspace Select remains when there are multiple spaces.
22. **Shipped — Group-by.** Saved views group by the first `groupFields` entry (project / status / priority / workspace / stage). Kanban render mode groups by status.

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

23. **Shipped — Rich task notes on detail.** Compact `RichTextEditor` writes `description` + `descriptionRich`, with explicit Save matching web.
75. **Shipped — Markdown on task create.** Quick Add uses a compact `RichTextEditor` and persists `description` + `descriptionRich`.
24. **Shipped — Blocked-by picker.** Search tasks in the same workspace; dependents listed read-only.
25. **Shipped — Recurring task occurrence scope.** This / this and following / entire series. Following splits via `splitTaskSeries`.
26. **Shipped — Block management.** Per-block pin and delete; “Clear all time”.
27. **P2 — Checklist rename.** Long-press → edit title via `updateChecklistItem`.
28. **P2 — Preferred windows.** Multiple windows + weekday chips, same model as web.
29. **P2 — Duration / actual minutes.** Show focused time; keep start/stop.

---

## 7. Calendar and scheduling

Web: Day / Week / Month / Agenda, waiting-for-slot rail, drag tasks and blocks, click empty slot → schedule dialog, auto-schedule dialog with skip reasons and capacity, occurrence skip/restore.

Mobile: Day / Week / Month / Agenda. Waiting-for-slot list + Schedule this. Empty-slot create via Quick Add. Reschedule via `CalendarItemSheet`. No drag (Keep). Auto-schedule sheet exists and is solid.

### Work

30. **Shipped — Week view.** Compact 7-day agenda with stacked chips; long-press a day to create.
31. **Shipped — Waiting-for-slot.** Ranked unscheduled work with Schedule this (datetime sheet → `addTaskBlock`) and open task. Drag stays Keep.
32. **Shipped — Create from an empty slot.** Tap a day hour (or long-press a week day) → Task / Event / Reminder Quick Add prefilled with that start.
33. **Shipped — Event extras.** Color chips, optional project, and notes on Quick Add and event detail.
34. **P2 — Auto-schedule copy.** Port skip reasons, partial placement, past-deadline warnings, and a link to Schedule settings from the desktop dialog so preview/apply/undo is equally explainable.
35. **Keep — No native drag-drop on the grid** until week view exists. Datetime sheet reschedule is the touch equivalent of drag-move.
36. **P2 — Capacity strip.** `GET /schedule/capacity` is implemented; show a simple hours-free vs hours-placed hint on day/week.

---

## 8. Projects

Web `/projects` cards + `/projects/[id]` with **Overview / Tasks / Stages / Activity**. Tasks tab reuses list/kanban/gantt scoped via `projectTaskViews`. Stage board is drag-and-drop. Color + rich description. Activity feed (explicitly missing: project field edits).

Mobile list + detail: color chip, rich description, status, priority, dates, complete, duplicate, delete, stages add/rename/delete/reorder, in-project create, vertical lists + long-press move, **activity feed**.

### Work

37. **Shipped — Project activity.** `getProjectActivity` + Activity section. Same honesty copy as web.
38. **Shipped — In-project task list.** New task composer + full Quick Add preset + “Open tasks” with `?projectId=` (same Tasks tab filters).
39. **Shipped — Color + description.** Entity color chips and compact `RichTextEditor` with explicit Save.
40. **P2 — Stage board UX.** Horizontal pager per stage is enough; keep long-press move. Drag-and-drop is optional.
41. **P2 — Custom field values on projects.** Payload supports them; neither surface is equally complete (web detail panel is also light). If web grows this, mobile must follow in the same phase.

---

## 9. Docs

Both have TipTap (web native editor, mobile WebView), a slash menu, @ mentions, autosave, SSE watch, favorite, archive, Markdown import/export, delete with subpage warning.

Web has a nested tree, search, add subpage, move to top level, open in new window, emoji icons, word count, a **fixed full toolbar** on the page editor, and a floating selection toolbar + table toolbar.

Mobile list is a **nested tree** (indent, expand/collapse, long-press add subpage / move to top) plus Favorites. Parent can also be set on the editor. `order` is used for tree sort, `projectId` unused, `RichDoc.tsx` is dead code.

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

42. **Shipped — Nested list.** Indent by `parentId`, expand/collapse, add subpage, move to top level. “Open in new window” stays Keep.
43. **P2 — List search and archive toggle** already exist; add a simple tree filter so nested pages are findable.
44. **P2 — Remove or use `RichDoc.tsx`.** Dead renderer; either wire it as a read-only preview or delete it.
45. **Keep — WebView editor.** Matching slash/mention/table is more important than swapping engines. Keep the 12s load overlay; add a retry.
76. **Shipped — Complete slash menu.** Link (URL sheet, `setLink` / unset) and Page (create child doc, page mention). Markdown shortcuts unchanged.
77. **Shipped — Full docs toolbar.** Format bar includes inline code and link with active-state highlighting; table bar adds header row/column, merge, and split. WebView CSS uses account theme tokens.

---

## 10. Sheets

Formula engines are aligned (`SUM`, `AVERAGE`/`AVG`, `MIN`, `MAX`, `PRODUCT`, `COUNT`, `COUNTA`, `ABS`, `SQRT`, `ROUND`, `FLOOR`, `CEILING`, `POWER`, `IF`, `AND`, `OR`, `NOT`, `CONCAT`/`CONCATENATE`, `LEN`, `UPPER`, `LOWER`, `TRIM`).

Web additionally: **workbook tabs**, CSV import on the list + CSV export of evaluated values, duplicate, fill-down with relative refs, merge, undo/redo, print, paint format, zoom, number formats, fonts, colors, borders, align, wrap, rotation, links, notes, **charts**, filter, sort, column types.

Mobile: grid with format ribbon, workbook tabs, CSV import on the Files list + CSV export via share, duplicate, sort A→Z/Z→A, row filter matching web `filterQuery`. Description is still plain text. Dedicated sheets tab is hidden. Charts remain P2.

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

46. **Shipped — Duplicate sheet.** `POST /sheets/:id/duplicate` and editor More → Duplicate.
47. **Shipped — CSV import / export.** Files → Sheets: Import CSV. Editor More → Export CSV (evaluated values, share sheet).
48. **Shipped — Workbook tabs.** Tab bar under the grid; add / rename / delete; persists via `tabs` on the sheet payload.
49. **Shipped — Sort + filter.** Column menu Sort A→Z / Z→A. Ribbon Filter + “Filter rows…” matches web `filterQuery` (row text haystack).
50. **Shipped — Full sheets toolbar.** Undo/redo, bold/italic/underline, align, number/currency/percent, fill, merge. Persists `SheetCellFormat` and `merges`. Charts remain P2.
51. **P2 — Rich sheet description + mentions** to match docs/web.

---

## 11. Search, notifications, report

### Search

Both call `GET /search` with `mode=semantic` and fall back to keyword on 503. Hits: task, project, doc, sheet, event. Mobile is a tab; web is a modal. Fine.

52. **P2 — Navigate events to a date.** Web dumps events on `/calendar` without the occurrence. Pass a date query on both so the right day opens.
53. **P2 — Empty/error states.** Show semantic-unavailable vs no hits.

### Notifications

Web sidebar badge uses `unreadNotificationCount`. Mobile hook exists and is **never rendered**. Snooze 15m / 1h / Tomorrow 9:00 matches. Non-task entities often cannot navigate.

54. **Shipped — Unread badge** on Home notifications.
55. **Shipped — Deep links.** Route by `entityType` / `entityId` (and data ids) to task/project/doc/sheet/event.
56. **P2 — `reschedule` API** (`POST /notifications/:id/reschedule`) is unused on both; only add if snooze is insufficient.

### Report

`buildReportData` on mobile computes `priorities`, `byProject`, and `mentions` and **renders them**. Settings copy says “focus time”; there is no focus-minutes UI on either surface.

57. **Shipped — Remaining report sections** (priority bars, projects with open work, mention list of links).
58. **Shipped — Tappable recent items.**
59. **P2 — Align stats with web** (inbox/reminders excluded from “work”, per-source error banners so a failed feed is not shown as zero).
60. **Both missing — Focus-time chart.** Either ship it on both or drop the marketing copy.

---

## 12. Settings

| Area | Web | Mobile | Work |
| --- | --- | --- | --- |
| Account | Profile + sessions | Profile only | §3 |
| Appearance | System / light / dark, accent, **account `appearance`**; sidebar auto-hide stays local | System / light / dark, accent, **account `appearance`** | **79 shipped** |
| Schedule | Weekday windows, timezone select, buffer, freeze, exclude workspaces | Same, timezone is free text | 63 |
| Notifications | Prefs + failed jobs | Prefs + permission + jobs | Match |
| Workspaces | Full status/label/field CRUD | Create workspace; **cannot updateStatus / updateLabel** | 64 |
| Data | JSON, CSV, ICS, encrypted backups, restore | Same + share | Match |
| API keys | Hermes YAML snippet | Create/list/revoke | 65 |

### Work

61. **Shipped in 79.**
62. **Shipped in 79.**
63. **P2 — Timezone picker.** Replace the IANA text field with a searchable list (`apps/web/app/utils/timezones.ts` or `Intl.supportedValuesOf('timeZone')`).
79. **Shipped — Universal theme (API + web + mobile).** `appearance: { theme, accent }` on user config. Migration `20260917180000_add_appearance_to_config.sql`. Defaults `system` / `default` (violet `#6E56CF`). Both Settings → Appearance screens write the same field; local cache covers splash. Docs WebView CSS follows the live palette. Sidebar auto-hide stays web-only.
64. **Shipped — Edit statuses and labels.** Name + color via existing `updateStatus` / `updateLabel`.
65. **P2 — Hermes YAML snippet** after creating a key, for copy/share. Optional on mobile.
66. **P2 — Notification timezone.** Persist the working-hours timezone onto notification settings (called out in FEATURES.md).

---

## 13. API client gaps (mobile)

Functions the API already serves, web uses, and mobile either lacks or never calls from a screen:

| Function | In mobile client? | Used in UI? | Needed for |
| --- | --- | --- | --- |
| `listSessions` / `revokeSession` / `revokeOtherSessions` | Yes | Yes | Account |
| `duplicateSheet` | Yes | Yes | Sheets |
| `getProjectActivity` | Yes | Yes | Projects |
| `updateTaskViewsConfig` / `getConfig` for views | Yes | Yes | Task views |
| `splitTaskSeries` | Yes | Yes | Recurring tasks |
| `clearTaskBlocks` / `deleteBlock` | Yes | Yes | Schedule section |
| `getCapacity` | Yes | No | Calendar |
| `unreadNotificationCount` | Yes | Yes | Badge |
| `updateStatus` / `updateLabel` | Yes | Yes | Workspace editor |
| `unregisterPushDevice` | Yes | Yes | Logout |
| `getEvents` | Yes | No | Fine (range endpoint is enough) |

### Work

67. **Shipped — Close the client holes** (`sessions`, `duplicateSheet`, `getProjectActivity`, `updateTaskViewsConfig`). `deleteWorkspace` still unused (both missing UI).

Web-only client notes (not mobile gaps): `watchDoc` exists on both; sheets have no SSE on either; `POST /search/reindex` is unused in both UIs.

---

## 14. Shared logic that should not be forked twice

Several modules are already copy-pasted (`overdue.ts`, `status.ts`, `entityColor.ts`, `priority.ts`, `recurrence.ts`, `sheetFormula.ts`, `report.ts`, `markdown.ts`, `richText.ts`). Parity work will make this worse unless the implementations stay aligned.

### Work

68. **P2 — Treat formula/report/recurrence as shared contracts.** When you change `sheetFormula` or `buildReportData` on one app, change the other in the same PR. A future `packages/shared` is optional; dual-edit in one commit is mandatory until then.
69. **Shipped — Task filter helpers.** `apps/mobile/lib/taskFilters.ts` ports `isInboxTask`, `isReminderTask`, and saved-view predicates.

---

## 15. Reliability and copy bugs (parity-adjacent)

70. **Shipped — Pull-to-refresh** (§4).
71. **Shipped — Inbox auto-schedule side effect** (§5).
72. **P0 remaining — Connectivity vs stale data.** Web: “Offline · showing saved data…”. Mobile empty states now say the phone needs network when there is no cached payload. Persisted query cache is still P2.
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

### Phase A — Stop lying, make the loop findable (P0) — **landed 17 Sep 2026**

- Navigation: Home tab; Today / Inbox / Notifications one tap away
- Today rebuilt from `GET /today` (focus, complete, shutdown, agenda)
- Pull-to-refresh
- Stop `applySchedule` on inbox create
- Honest offline empty states
- **Universal theme (79)**

**Exit:** A phone-only user can capture, see today, start focus, and shut down the day without opening Settings. Appearance matches desktop.

### Phase B — Editors and capture (P0) — **landed 17 Sep 2026**

- Complete docs slash commands (76) and full docs toolbar (77): Link, Page, inline code, table merge/split/headers
- Full sheets toolbar (50): undo/redo, bold/italic/underline, align, number/currency/percent, fill, merge
- Markdown / rich text on task **create** (75) and task **detail** (23)
- Stitch mobile visual overhaul (80) against Kinetic Dark Velocity — tokens + chrome restyle applied; `generate(..., "MOBILE")` screens translated into Expo (HTML not pasted)
- Motion baseline (81) is already in the app; Stitch restyle keeps stack/sheet springs

**Exit:** Writing a doc, a sheet, or a task description on the phone is not a downgrade from desktop.

### Phase C — Tasks and calendar depth (P0–P1) — **landed 17 Sep 2026**

- Consume saved task views (18)
- Recurrence split + block delete/clear (25, 26)
- Blocked-by (24)
- Week view + waiting-for-slot + empty-slot create (30–32)
- Unread notification badge + entity deep links (54, 55)
- Status/label edit in workspace settings (64)
- Sessions UI + push unregister (6, 7)

**Exit:** A view, recurring series, or unscheduled pile created on desktop is usable on the phone.

### Phase D — Projects, docs tree, sheets portability (P1) — **landed 17 Sep 2026**

- Project activity, color, in-project create (37–39)
- Nested docs list (42)
- Sheet duplicate, CSV, workbook tabs, column sort (46–49)
- Report sections that are already computed (57, 58)
- API wrappers from §13 (already closed in C)

**Exit:** Knowledge and projects are not “desktop only.”

### Leftover P1 — Kanban, filters, events (P1) — **landed 18 Sep 2026**

- Horizontal kanban columns + long-press change status (19)
- Extra Filters sheet (21)
- Sheet row filter matching web `filterQuery` (49)
- Event color / project / notes on create and edit (33)

**Exit:** Remaining P1 from the matrix is closed.

### Phase E — Polish (P2)

- Optional gantt
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
| Nav | `apps/web/app/_components/_layout/sidebar.tsx` | `apps/mobile/app/(app)/(tabs)/_layout.tsx`, `home.tsx`, `more.tsx` |
| Today | `apps/web/app/_components/today/todayDashboard.tsx` | `apps/mobile/app/(app)/(tabs)/home.tsx` (`today.tsx` redirects) |
| Inbox | `apps/web/app/(pages)/(nav_pages)/inbox/page.tsx` | `apps/mobile/app/(app)/inbox.tsx` |
| Tasks | `apps/web/app/(pages)/(nav_pages)/tasks/page.tsx`, `_components/_ui/tasks/*` | `apps/mobile/app/(app)/(tabs)/tasks.tsx`, `tasks/[id].tsx` |
| Saved views | `apps/web/app/utils/hooks/taskViews.ts` | `lib/taskFilters.ts`, `(tabs)/tasks.tsx` |
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
| P0 | Persisted-cache leftover of **72** | Look |
| P1 | — | Closed 18 Sep 2026 |
| P2 | Gantt, capacity, sheet charts, shared packages, dead code | Polish |
| Keep | Shortcuts, Electron, push, FAB, no grid-drag, sheet Print | Do not copy |
| Both missing | Workspace delete UI, comment delete, focus chart, OAuth | Separate backlog |
| Next | Phase E — polish (timezone picker, persisted cache) | Polish |

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

80. **P0 — Mobile visual overhaul via Stitch** (credentials are local; restart the agent). Theme tokens (79) exist:

    1. Confirm MCP (`list_projects` should return `3890227041261643615`).
    2. Generate **mobile** screens (`deviceType: MOBILE`), one route per cycle: login → signup/onboarding → tab shell (Home, Calendar, Tasks, Search, Files) → Today, Inbox, task detail, calendar day/agenda, docs editor (with full toolbar), sheets editor (with full toolbar), Quick Add (markdown), notifications, report.
    3. Translate Stitch HTML/PNG into existing Expo components (`Screen`, `MobileHeader`, `primitives`, `theme.ts`). **Do not paste Stitch HTML into the app.**
    4. Keep Timely identity (violet, Kinetic Dark Velocity) and the same labels/flows; improve hierarchy, type, spacing, and surfaces so mobile does not look like a squeezed desktop or an Expo template.
    5. Verify light **and** dark, and a second accent, because theme is universal.
    6. Keep the motion system in `apps/mobile/lib/motion.ts` (stack push, tab fade, sheet spring, press scale). Stitch must not flatten everything to instant cuts.
    7. Drop notes per route (what changed vs current RN). Prefer a `notes.md` outside git if dumps are large.

    **Shipped 17 Sep 2026.** Kinetic Dark Velocity tokens + chrome (header, floating pill tab bar, squircle FAB, Home cards, login) are in Expo. Emulator screenshots were captured (login, Home, calendar, tasks, search, files, inbox, notifications, docs editor, sheets hub/editor format ribbon, Quick Add). `project.upload()` accepted the PNGs; `edit_screens` rejected screenshot-origin screens (`invalid argument`). Fallback: `project.generate(prompt, "MOBILE")` created:

    | Route | Stitch screen id |
    | --- | --- |
    | login | `edfaec9ae195445db3f114664e865681` |
    | home | `077e5790814140398c31cb6a55fbc6e2` |
    | calendar | `d4de87ec9f4d41e1be4a5266b8664125` |
    | tasks | `38ef622f14314576a05b8da292c49b80` |
    | files | `35c05e8b15f84ddd877207e45d821736` |
    | quickadd | `a06cec7164984ab2a3f1146bd1d7bcf9` |
    | docs-editor | `2caa65bdd112481889b1fcf4f73faba1` |
    | sheets-editor | `cb317c594e6b459a919efabc0099c022` |

    Results were translated into existing `theme.ts` / `Screen` / `MobileHeader` / primitives — **Stitch HTML was not pasted.** Motion springs were kept. Light/dark + accent still flow through account `PUT /config`. SDK notes: upload is `project.upload()`, not `uploadImage`; MCP Stitch tools were not loaded in this session (HTTP/SDK fallback).

81. **P0 — Native motion / view-transition equivalent (baseline shipped 17 Sep 2026).** Web uses `<ViewTransition>` + motion.react. Mobile now uses:
    - Stack: iOS `ios_from_right` / Android `slide_from_right` for detail screens; fade for tabs and hub pages; edge swipe-back
    - Tabs: cross-fade
    - Overlays: Reanimated fade + slide sheets, toast/banner enter
    - Press: spring scale on FAB, primary buttons, chips, task rows
    - Lists: staggered `FadeInDown` on the task list
    - Reduce Motion: native `animation: "none"` and skipped entering transitions
    Remaining: apply `ListEnter` to inbox/notifications/projects; delay-unmount sheets/toasts so exit animations play; shared-element morphs if Stitch specifies them.
