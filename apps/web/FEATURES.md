# Timely — Current Feature Inventory

Snapshot of what the application **already does**, across desktop web, the native Expo app, the Go API, and Hermes/MCP. Use this to decide what to build next. Nothing here is a proposal; gaps are called out separately at the end.

Last audited **2 Oct 2026** (commit `3b624bf`) against the `apps/web`, `apps/mobile`, and `apps/api` source in this monorepo. Domain terms (Capture, Clarify, Work, Block, Placement, Rank, Missed, …) follow `CONTEXT.md` and `docs/adr/`. This is a code inventory, not a production deployment check. The former mobile-web shell (`/m`) was removed; phones use the native app. Old `/m` bookmarks redirect to `/calendar`.

---

## Product at a glance

Timely is a **multi-account, single-user personal productivity system**. Multiple people may register, but every account is private and independent. There is no team, sharing, email, or two-way calendar sync.

| Surface | What it is |
| --- | --- |
| **Desktop web / Electron** | Full product: sidebar, AI Chat, Today, Inbox, saved task views, week calendar, auto-schedule, project hub, settings, reports, rich editors, command palette; the same web app also has an Electron shell with native chat notifications |
| **Native app** | Expo Android/iOS: Home, Calendar, Tasks, Search (command palette), Files tabs; pinch-to-open AI assistant with camera/receipt capture; Inbox/Today, local reminder notifications (permission on first launch), working hours, API keys, export |
| **API** | Email/password JWT + refresh tokens, CRUD, calendar engine, semantic search, SSE for docs, Postgres job queue, in-app agent runner with OpenRouter / Claude Code / Codex providers |
| **Hermes / MCP** | 147 tools on `/mcp` with a personal API key — the agent can do almost everything the UI can, including export/backup/restore and sheet templates |

Ownership is always “this user owns this row.” No members, roles, invites, or resource ACLs.

---

## 1. Account, auth, onboarding

**What exists**

- Email + password **register** and **login**. Signup sends **name** and lands on **onboarding**.
- Password hashed with bcrypt. Short-lived access JWT (cookie `session` on web; SecureStore on native) plus a **refresh token**. Native refreshes via `POST /auth/refresh`.
- **Logout** clears cookie/token and revokes that device session (only for tokens this server signed with HS256; expired tokens are still accepted for logout). Web logout also clears the query cache.
- **Profile:** name, email, change password (needs current password).
- **Device sessions:** Settings → Account lists sessions and can **log out a device** (`GET /sessions`, `DELETE /sessions/:id`).
- **Onboarding:** create a workspace, mark complete, land on Calendar. Unauthenticated private routes redirect to login; unfinished onboarding redirects to `/onboarding`.
- Landing `/` with Sign In / Register / Get Started. **No “Sign In Demo”.** Seed credentials (`thalhathva2@gmail.com` / `12341234`) appear on login **only in development**.
- Password recovery is a **local administration command** (`timely-api/scripts/reset_password.go`), not email.

**Protected routes (web proxy)**

`/chat`, `/calendar`, `/today`, `/inbox`, `/tasks`, `/projects`, `/report`, `/settings`, `/docs`, `/sheets`, `/notifications`, plus `/onboarding` when logged out. Requests to `/m` or `/m/*` redirect to `/calendar`.

**What does not exist**

- OAuth, Google, SSO, magic links, 2FA, biometrics, password-reset email.

---

## 2. Workspaces (personal “spaces”)

A user can have **multiple personal workspaces**. Everything work-related hangs off a workspace.

### Create / rename / delete

- Create from onboarding, sidebar +, Add modal, Settings, native workspace settings.
- Rename in Settings.
- Delete is allowed except the last workspace, on desktop and in native workspace settings (“Danger zone”). MCP requires `confirm=true`.

### Each workspace has taxonomy

**Statuses** (name + color + default flag)

- New workspaces get: **Backlog, Todo (default), In Progress, Blocked, Completed, Canceled**.
- Full CRUD in Settings (and MCP).
- Completing a task can auto-set `completedAt` when the status name looks like done/complete.

**Labels** (name + color)

- CRUD in Settings.
- Multi-select on tasks. Can create a label inline from the Add Task modal.

**Custom fields** (per workspace; apply to tasks; projects also store values)

- Types: **text, number, date, url, select, multi_select, boolean (Yes / No)**. Settings and Add Task both expose boolean.
- Select / multi-select have colored options.
- Can be created inline from Add Task.
- Can be used as **task-list group-by** and **columns**.

**Not implemented:** members, invites, roles, workspace sharing, icons/avatars for workspaces, workspace archive.

---

## 3. Projects

Projects are containers for work inside a workspace. There is a dedicated **Projects hub**.

### Desktop `/projects`

- Card list: workspace, status, priority, description, progress bar, open/done counts, start and deadline. Workspace and project colors distinguish cards and related tasks.
- Create from the page or the sidebar + menu.

### Desktop `/projects/[id]`

- Tabs: **Overview**, **Tasks**, **Stages**, **Activity**.
- Overview: title, description, status, priority, **shared date picker** for start and deadline (same control as the rest of the app, not a native `<input type="date">`).
- Stages: create, rename, delete, reorder, and choose a color; unstaged vs staged task board. Tasks can be moved between stages.
- Duplicate and mark complete from the header.

### Native

- Projects list under More, with create.
- Project detail: title, description, status, priority, start/deadline via date sheets, stages, open-tasks link.

### Fields

Title, rich description, workspace, status, priority, start date, deadline, completedAt, color (hex), `doesHaveStages` flag, custom field values, timestamps.

### Stages

- API + MCP + **UI**: create / rename / delete / reorder.
- Tasks have `stageId`. Desktop list can group by stage. Task create/detail can pick a stage when the project has one.

### Actions

- Create, complete, delete (cascades tasks), duplicate.
- Shown on Tasks as synthetic `project-` rows when data mode is Projects.

---

## 4. Tasks (core work items)

Work tasks require `duration > 0`, `kind=task`, and a workspace; an explicit zero Work duration is rejected. Duration is minutes of work the scheduler can place. Title-only capture is `kind=inbox` and is **not** auto-scheduled until clarified. Reminders are `kind=reminder` (timed pings). Checklist items are lightweight completion text on the task and are not scheduled. `actualMinutes` is focused time, separate from estimated `duration`.

### Fields

| Field | Behavior |
| --- | --- |
| Name | Required, 2–100 chars on create |
| Description | TipTap rich text on desktop; native is closer to plain notes |
| Duration | Minutes; `> 0` = schedulable work. Hidden for reminders |
| Start date, deadline | Shared date picker |
| Scheduled on | Reminder **Notify at** ping, or mirror of earliest block |
| Completed at | Toggle complete / reopen |
| Workspace, project, status | Required on work tasks; inbox items and standalone reminders may omit workspace until clarified |
| Priority | **Low, Medium, High, Urgent**. Legacy `Critical` normalizes to Urgent |
| Labels | Multi |
| Custom fields | Per workspace, including boolean |
| Blocked by | This task waits on another. Dependents (“blocking”) are a read-only list |
| Stage | Project board; Hermes `move_task_to_stage` |
| Recurrence | RFC 5545 series |
| Blocks | Manual or engine time chunks on the calendar |
| Kind | `task`, `reminder`, or `inbox` — kind is the source of truth |
| Checklist | `{id, title, completedAt, order}` items; not scheduled |
| Actual minutes | Focused time from start/pause/stop focus |
| Focus | `focusStartedAt` while focusing, `focusPausedAt` while paused; one session at a time |
| Today focus | Optional `todayFocusOn` date; max 7 per day |
| Placement hints | `earliestStartAt` and `preferredWindows`, accepted on create and update |

### List / board / gantt (desktop only, persisted)

Saved **task views** live in user config (`taskViews` + `activeTaskViewId`). Create / rename / delete / switch. Hermes can manage them too.

Each view stores:

- **Render mode:** List, Kanban, Gantt
- **Data mode:** Tasks **or** Projects (project rows aggregated from tasks)
- **Group by** up to 3 fields, drag-reorder: workspace, project, stage, status, priority, or a custom field
- Group value order (drag-sortable) and group sort asc/desc
- **Filters:** multi workspace, multi status, project, priority, labels, stage, show completed, overdue, scheduled, recurring, dated, reminders
- **Sort:** name, deadline, startDate, createdAt, priority, status, project × asc/desc
- **Column order** (drag headers): built-ins + custom fields

Inbox items are always hidden from task views and have their own `/inbox` page. Reminders appear only when a view's `showReminders` filter is on; that mode shows reminders instead of work tasks.

**Kanban:** columns merge same-named workspace statuses (+ “No status”). Drag a card to change status. Cards show the task's next date or block and open detail.

**Gantt:** task bars use start dates, scheduled blocks, recurrence anchors, and deadlines where available; undated tasks appear separately and can be dragged onto the timeline to set dates. Project bars use project dates. Click opens detail. **No bar drag-resize.** Saved view “My Deadlines” filters to work with a deadline, reserved time, or recurrence, and excludes completed tasks by default.

Deep links: `?taskId=`, `?projectId=`.

### Detail, activity, comments (desktop + native)

- Autosave title/properties; description often needs explicit save on desktop.
- **Work | Reminder** type toggle on create and detail (not Inbox).
- Complete toggle, delete, Escape closes the panel.
- **Activity feed:** created / updated / commented, with field diffs. Actor is the user or `"Hermes"` for MCP.
- Comments via `Ctrl/Cmd+Enter`. **No comment delete** in the UI.
- Native has activity + comments; notes are not the full rich editor.

**Bulk update** exists on the API (`PATCH /tasks/bulk`), as MCP `bulk_update_tasks`, and in the desktop/native task list (complete/reopen, status, priority, project, label, deadline, delete).

**Checklists** are items on the task, not nested tasks. Completing a task does not auto-complete its checklist. `parentTaskId` is rejected on create/update (REST and MCP); nested-task creation has no replacement. Sheet `description` is also rejected.

### Inbox and Today

- **Capture** (`POST /inbox`; `/inbox`, native Inbox): title-only (`kind=inbox`). Capture clears workspace, project, status, stage, labels, priority, and dates. Native Inbox rows also have a delete button.
- **Clarify** (`POST /inbox/:id/clarify`, ADR 0002/0003): creates **new** Work or a new Reminder and consumes the Inbox item (the id changes). Work needs a workspace and duration > 0; an optional `scheduledOn` becomes a Manual block. On desktop, clicking an Inbox row opens the Add modal titled **Clarify**, prefilled with the title (30-minute default). Native still clarifies by editing the item in task detail; the native `clarifyInbox()` helper exists but is unused.
- **Today** (`/today`, native Today/Home): focusing or paused task, today’s calendar items, reminders, inbox count, Today-focus list, start/stop focus. `GET /today` also returns `pausedFocus` and `unscheduled` Work.
- **Focus pause/resume** (API, MCP `pause_focus`, native): pausing adds elapsed time to `actualMinutes`; starting again resumes. Native Home shows a “FOCUS PAUSED” state, and task detail reads Start / Stop / Resume focus. **Desktop web has only start/stop.**

### Filters on API (also used by agent)

workspace(s), project(s), status(es), label(s), priority, stage, completed, overdue, dueBefore/After, scheduled, recurring, reminders, kind, inbox, text `q`, sort, limit/offset (default 200).

### Native task UX

Saved **native task views** are stored only on the device (`native-task-views-{userId}.json`). They do **not** write `taskViews` / `activeTaskViewId`, so desktop web layouts stay unchanged.

The Tasks tab is a view switcher (create / rename / delete). **View** opens the customizer: list or board, tasks / reminders / projects, group by (up to 3, including custom fields), sort, and the same filters as desktop (workspace, project, status, priority, labels, stage, completed, overdue, scheduled, recurring, dated).

Default native views: Task List, My Deadlines (dated, open work), Overview, Board. Gantt stays desktop-only. Native Kanban cards can be dragged between status columns. Bulk actions sit in a horizontally scrolling bar.

Native Home's “Add to today” picker is multi-select, grouped by project/workspace (Inbox items included), with an “n slots left” count. Native task detail has a **Smart Schedule** section (Add Time Slot, per-task Auto-Schedule) and a rich **Description** card. Native Quick Add has a Work | Reminder control, an auto-growing title, and Earliest start / Prefer from–to fields (one preferred window).

---

## 5. Reminders (`kind=reminder`)

A reminder is a **first-class timed ping**, not a work block and not a duration-0 work task.

- Create and detail use a **Work | Reminder** control. Reminder sets `kind=reminder`, `duration=0`, and requires **Notify at** (next round hour if unset). A reminder without a ping time is invalid.
- Workspace / project / status / labels / custom fields / blocked-by / duration / engine chunks are hidden on a reminder.
- Recurring reminders are allowed (time of day + repeat rule).
- Calendar draws them as short chips; they **do not occupy busy time** for auto-schedule.
- Native Quick Add has Reminder as its own kind (alongside Inbox, Task, Event, Doc, Sheet).
- Placement writes the ping time (`PlacePing`); reminders never get Blocks.

**Awareness**

- Due reminders are claimed by a Postgres job (`send_reminder`) even when the UI is closed. Past-deadline work can also produce a deduplicated `overdue_task` alert.
- **Start soon:** a sweep enqueues `start_soon` 10 minutes before a Work Block (“Starting in 10 minutes.”). **Missed:** `missed_block` fires when a Block ends and the Work is still open. Both follow the Reminders preference and are dropped if the Block has since moved.
- Desktop and native have an in-app notification center (read/unread, clear all, snooze 15m / 1h / tomorrow). Snooze updates `scheduledOn` or a moved occurrence and enqueues the next ping.
- Settings control category prefs, quiet hours (in-app still writes; push is delayed), digest times, and timezone.
- **Native local OS schedules are the device ping.** Permission is requested after the first interactive frame (Android 13+ `POST_NOTIFICATIONS`). Local schedules keep running even if Expo push token registration succeeds. Horizon 60 days, max 60 scheduled, Android channel `reminders` (assistant pushes use channel `agent`).
- Exact-alarm access on Android 14+ may still need a system Settings grant; that deep-link is not in the UI yet.

---

## 6. Recurrence (tasks and events)

RFC 5545 RRULE with `dtstart` + IANA timezone. Occurrences are **expanded on read**, not stored as rows. Exceptions: skip / move / complete.

**Presets:** none, daily, weekly (that weekday), weekdays, monthly (date), yearly, custom.

**Custom editor:** interval; DAILY / WEEKLY / MONTHLY / YEARLY; BYDAY chips; monthly day-of-month or nth weekday; yearly months; end never / count / until date.

**Occurrence actions:** this / this+future (split series) / all. Complete, uncomplete, skip, restore, move. Splitting keeps future exceptions, and moved occurrences still show if the new rule drops their weekday.

Auto-schedule places recurring **work** as blocks tagged with `occurrenceStart`. Recurring **reminders** stay on their ping rule and are not placed as work.

---

## 7. Calendar and events

Unified calendar (`GET /calendar?from=&to=`, max 400 days) mixes:

- task blocks
- task occurrences
- events
- event occurrences
- reminders

Each item can have: allDay, color, blockId, source (`manual` | `engine`), chunk index/count (“Part x of y”), seriesId, originalStart, moved, completedAt, reminder flag.

### Desktop views

Day, Week, Month, Agenda (`?view=` synced). Prev/next, Today, header label, GMT offset, color legend, counts “on calendar” vs “waiting” (unscheduled).

- **Month:** day cells; click opens Day; overflow “+N”.
- **Week / Day:** hour grid; click empty slot → schedule dialog; overlapping layout; all-day row; reminders as chips. Drag waiting tasks onto the grid; move or edge-resize eligible work blocks, with collision-aware server validation.
- **Waiting rail:** ordered by the server's **Rank** (`GET /schedule/rank?timezone=`), not client-side scoring. Rank covers open Work that is Unscheduled or Overdue.
- **Agenda:** grouped by day plus an **Overdue** section; reminders filtered out of day groups.

### Events

Standalone calendar items, optionally linked to a workspace / project / task.

Fields: title, description, start/end, **duration**, allDay, color, recurrence.

Event time model (ADR 0005):

- **Timed one-off events** store a duration and get at least one Manual block of exactly that length (existing events were backfilled). Duration ≤ 0 is rejected on update. MCP derives duration from start/end.
- **All-day events** have duration 0 and fill that date's Working hours (09:00–17:00 if the day has none). They are drawn as those windows and **count as busy** for auto-schedule and free time.
- **Repeating events** expand on read with no stored Blocks. Auto-schedule never places events.

Create from Add modal, schedule-dialog “New event” tab, native Quick Add. Edit/delete; occurrence scope same as tasks.

### Schedule dialog (desktop)

Tabs: **Schedule an existing unscheduled task** (search) | **New event**. Duration override; recurrence for events.

### Native calendar

Day / Week / Agenda / Month. **Week is a 7-day list** (up to 6 items per day; long-press a day for its empty-day action), not an hour grid. Horizontal date strip with busy dots. Header: Prev / Today / Next plus auto-schedule. Space and project filters are searchable bottom sheets with counts and create links. The waiting list uses the server Rank. Item sheet: type badge, complete, reschedule (block / reminder time / one-off event), skip/restore occurrence.

---

## 8. Scheduling engine (auto-schedule)

This is one of the product’s distinctive features.

### Working hours (Settings → Schedule)

- IANA timezone.
- Per weekday: day off, or one or more start–end windows (desktop can split a day into multiple windows; native is simpler: on/off + one window).
- Validation: both times, end after start, no overlap.
- Desktop: copy Monday → Tue–Fri, weekly hours summary.
- Default if empty: Mon–Fri 09:00–17:00.

### Engine controls

- Configurable buffer between blocks (`breakMinutes`, default 5, range 1–60).
- Freeze window (`freezeHours`, 0–168): near-term engine blocks are kept; 0 leaves every hour movable.
- Per-workspace include/exclude (`excludedWorkspaceIds`).
- Per-task: min/preferred chunk, contiguous vs splittable, earliest start, preferred time windows, `scheduleLocked`.
- Pin a single block (`locked`); locking turns an engine block into a manual pin.

### Engine behavior

- **Placement is the only Block writer** (ADR 0004): manual work blocks, reminder pings, event blocks, and the rewrite of future all-day windows when Working hours change all go through one service.
- “Today” comes from one **DayLocation** resolver: saved Working hours timezone, then the client's timezone, then UTC. Auto-schedule, free time, and Rank share it.
- Places incomplete **work** into **free working hours minus busy time** (events, including all-day events, + existing **incomplete** blocks). Auto-schedule uses its own busy list, separate from calendar items (ADR 0006). Completed tasks are not candidates, do not appear in the change list, and do not consume free capacity. Inbox items and reminders are skipped.
- Recurring work is scheduled as blocks on the parent task with `occurrenceStart`. One occurrence failing to fit does not change later ones. Skip/move/complete exceptions are respected.
- Shared ranking with `what_next` and `GET /schedule/rank`: deadline slack, duration, priority, Today focus, dependency readiness, partial progress. Scores are ordering hints, never presented as certainty.
- Blockers are hoisted. Earliest fit respects min/preferred chunk, contiguous single-slot, preferred-window intersection, and freeze.
- Horizon default **14 days**, max **90**.
- Skip reasons include: `no_capacity`, `blocked`, `manual`, `no_duration`, `reminder`, `recurring` (repeating **reminders**), `completed`, `inbox`, `locked`, `frozen`, `workspace_excluded`, `contiguous_no_fit`, `before_earliest`. Each skip has a plain-language `message`.
- Optional include-manual. Deadline-risk and capacity flags (`overCapacity`, `atRisk`) appear before apply.
- Preview change rows use **task titles**, never raw `tsk_…` ids.

### Preview vs apply

- Preview does not write. It returns proposals, skip messages, change list (add/move/remove/pin), capacity by day, and risks.
- Apply rewrites **engine** blocks in the horizon (manual, locked, and frozen pins stay unless include-manual). Concurrent apply is serialized with an advisory lock. Apply twice does not duplicate blocks.
- Last apply can be undone (`POST /schedule/undo`) via a schedule revision snapshot (last 5 kept).
- `POST /schedule/reschedule` is an alias of apply.

### Manual blocks

- Add / move / delete / clear per task.
- Pin vs engine source; task-level lock and per-block pin.
- Desktop task schedule section; calendar click-to-schedule; native reschedule + engine controls.

### UI

- Desktop: auto-schedule dialog (changes, skip messages, capacity, risks, undo) + floating toast. Calendar also has a waiting-for-slot rail for direct drag scheduling. Settings → Schedule has hours + engine controls.
- Native: sparkles header → sheet (preview/apply/undo/capacity/skip messages) + activity banner. Settings → Schedule has hours + engine. Task detail has pin/chunk/contiguous/earliest/windows.

---

## 9. Overdue

**Overdue is deadline-only:** open Work (not a reminder or inbox item) whose deadline date is before today. A Block that already ended does **not** make Work overdue. That case is **Missed** and produces a `missed_block` notification instead. **Unscheduled** means open Work with no Block or ping today. Web, native, and API all use these rules.

Shown in: Agenda Overdue section, Report, native “Overdue” filter, agent `get_agenda` / `what_next`.

For open schedulable work with a past **deadline**, the notification worker creates one deduplicated overdue alert per task and deadline when reminder notifications are enabled. Desktop shows the alert in the notification center. Native offers **Reschedule urgently** from the notification: the API sets priority to Urgent, applies the schedule, marks the alert read, and restores the old priority if scheduling fails. The same urgent reschedule is available to MCP as `reschedule_urgent`; desktop does not have the button yet.

---

## 10. Documents

Nested notes (parentId + order), Notion-like.

**Fields:** title, emoji icon, TipTap/ProseMirror JSON content, plainText, parentId, workspaceId, projectId, favorite, archivedAt, order.

### Desktop

- Home: recently edited (12), **Import .md**, New doc.
- Tree sidebar: expand/collapse, auto-expand ancestors, add subpage, local search, favorites, **show archived**, import Markdown, delete with descendant count.
- Full editor. **Archive / unarchive** from the doc header.

### Editor

- Slash `/`: Text, H1–H3, bullets, numbered, to-do list, quote, code block, 3×3 table, divider, link, mention, **Page** (docs only: creates a nested page, inserts a title link, and opens the new editor).
- Markdown-ish: `.`+space → bullet; `-`+space → divider.
- Marks: bold, italic, strike, inline code, highlight.
- `@` mentions: doc, sheet, task, project (no required leading space). Native also has a **Mention** toolbar button.
- Tables: resizable, merge/split, delete-table toolbar.
- **Code blocks:** language picker, **Copy**, VS Code Dark+ token colors.
- **Auto-capitalization** after `. ? !` and at the start of a new line (`autocapitalize="sentences"` plus an editor plugin).
- Link popover, word count, floating/fixed toolbar.
- Autosave. Incoming remote content applies only when the source document actually changed (remote watch or Markdown import). Tapping empty space after a save does **not** restore the initially loaded JSON.
- **SSE watch** (`/docs/:id/watch`) last-write-wins; skip remote while focused/unsaved. Poll fallback on native.
- Agent speaks **markdown** (create/update/append/get as markdown).

### Import / export

- **Import Markdown** (`.md` / `.markdown` / plain text) on docs home, sidebar, open-doc header, native Files tab, and native doc menu. A markdown parser turns headings, lists, tasks, quotes, fences, tables, and links into the same TipTap block model.
- **Export Markdown** from the open doc. **PDF download is not in the UI** (the API can still render a simple text PDF).

**Native:** Files tab is Docs | Sheets. Docs is a nested tree (expand/collapse, indent capped at depth 3) with favorites and an archive toggle in the header. Long-press or ⋮ opens a page menu: Open, Add subpage, Add/Remove favorite, Move to top level, Archive/Unarchive, Delete page (with subpages). Editor is a WebView with the same schema, code Copy, auto-cap, and mentions. It reports selected text to the assistant.

**Not implemented:** sharing, permissions, version history, comments on docs, attachments/images, publish.

---

## 11. Spreadsheets

Lightweight grids, not Airtable.

**Fields:** title, emoji icon, columns, rows, merged ranges, workbook tabs, workspace, project, favorite, archivedAt.

Default new sheet: columns A–D + empty rows.

### Grid (desktop + native)

- Formula bar and range selection; Enter/F2 to edit; type-to-edit; arrows/Tab; Delete/Backspace clear; column resize; rename headers; add/delete rows and columns; min 1 row/column; autosave.
- Desktop and native expose column types: text, number, currency, percent, formula, date, boolean/checkbox, and select (dropdown). A select column carries an `options` list; the cell shows a chip and a second click/tap (or Enter on desktop) opens the choices, with "Add option" and "Edit options" entries. Typing or pasting a value that is not an option yet appends it to the column, on the clients and server-side. MCP column and cell tools use the same model (`options` on add/update column); cells are coerced server-side.
- Multi-tab workbooks: add, rename, switch, and delete tabs. Each tab keeps its own grid and merged ranges. Every tab, including the first, keeps its own name (clients always send the full `tabs` array); MCP exposes `add_sheet_tab`, `rename_sheet_tab` (empty `tabId` = first tab) and `delete_sheet_tab`.
- Formula date helpers: `TODAY()`, `DATE(y,m,d)`, `YEAR`, `MONTH`, `DAY`, `WEEKDAY(date[,type])`, `DAYS(end,start)` and `TEXT(value,format)` with `dddd`/`ddd`/`mmmm`/`mmm`/`yyyy`/`mm`/`dd` tokens, so `=TEXT(A1,"dddd")` derives a weekday name from a date cell.
- Toolbar and range tools: undo/redo, copy/paste, fill handle, merged cells, number formats, text and fill colors, typography, alignment, borders, and wrapping. Row filtering and column sorting are available in the editor; they are not saved sheet views.
- Save a whole workbook or one tab as a reusable personal template. The Sheets home lists templates with preview, rename, delete, and create-from-template actions. New tabs can also be made from a template tab. Templates retain formulas, values, formatting, and merges; instances receive fresh row/column/tab IDs.
- Desktop can export the active tab as CSV.
- **Archive / unarchive** and **show archived** on the list, same pattern as docs.

### Formulas (client-side)

- Operators: `+ - * / ^ & = <> < > <= >=`
- Ranges `A1:B2` and open-ended ranges (`A:A`, `1:1`, `A2:A`, `A:C`) sized to the current grid; fill-down shifts them. TRUE/FALSE, percents. No cross-tab references
- Functions: SUM, AVERAGE/AVG, MIN, MAX, PRODUCT, COUNT, COUNTA, ABS, SQRT, ROUND, FLOOR, CEILING, POWER, IF, AND, OR, NOT, CONCAT/CONCATENATE, LEN, UPPER, LOWER, TRIM
- Errors: `#VALUE!`, `#DIV/0!`, `#NUM!`, `#NAME?`, `#PARSE!`, etc.

- Native commits the active cell draft and flushes the save on header or system Back; it asks about unsaved changes only if that save fails.

No persisted sheet views, charts, or database-style linked records. HTTP supports whole-sheet CRUD and template CRUD/materialization; granular row/column helpers, `duplicate_sheet`, and the template tools are on MCP.

---

## 12. Search

**Command palette** (desktop: sidebar Search, **Ctrl/Cmd+K** or `/`; native: Search tab). “Search anything, or run a command…”:

- Category tabs: All, Sheets, Docs, Tasks, Projects, Events.
- Semantic `/search?mode=semantic`, fallback to keyword if 503. Hits → deep links (events → calendar). Duplicate hits are collapsed by `kind:id`; stale results are hidden while a new query debounces (native 250ms).
- **Quick actions:** Create sheet/doc/task/project/event (opens the Add modal / Quick Add) and Go to sheets/docs/tasks/projects/calendar.
- If search fails, commands still work (native offers Retry).

A public demo of the palette with sample data lives at `/demo/command-palette`.

**Backend**

- Keyword: ILIKE across those five kinds.
- Semantic: OpenRouter embeddings (default `openai/text-embedding-3-small`, 1536 dims) → pgvector cosine. Optional `kinds=` filter. Index writes enqueue an `index_entity` job (goroutine fallback if the queue is unset); `POST /search/reindex`; auto-reindex if empty.
- Each account can set its own OpenRouter key and embedding model (Settings → Agent; the model must produce 1536 dims). Changing either enqueues a `reindex_user` job with visible progress. Without a personal key it falls back to the server `OPENROUTER_API_KEY`; with neither, semantic search is off.

---

## 13. Reports

Client-computed snapshot (not a separate analytics API). Desktop `/report`; native has a thinner screen under Settings.

Computed from live tasks/projects/docs/sheets:

- Completion % and done/open counts
- Open tasks, Overdue, Projects, Docs & sheets
- Overdue list (≤10)
- Open by priority bars
- Due or scheduled in the next 14 days (≤10), using the earlier deadline or next reserved block
- Projects with open work (≤8) and by-workspace counts
- Mentions graph from `@` links in rich text (≤16) — native computes this but barely shows it
- Recent activity (≤12)

Empty states per section. No date-range picker, no export, no stored historical reports.

---

## 14. Settings

### Account

Name, email, current password, new password, Save. **Devices** list with log-out-this-device.

### Schedule

Working hours, freeze, break minutes, excluded workspaces. Used by auto-schedule (and reminder timezone context).

### Workspaces

Picker → Name and color / Statuses / Labels / Custom fields (including Yes/No).

### Appearance

- Theme: system / light / dark on desktop; light / dark on native.
- Accent color presets and custom hex on desktop.
- Auto-hide sidebar: reveal when the pointer is at the left edge.

### Agent (desktop `?tab=agent`, native `settings/agent`)

- Three provider cards: **OpenRouter**, **Claude Code**, **Codex**. “Use as default” is enabled only once a provider is ready; badges show Default / Ready / Connected.
- OpenRouter: personal API key (add / replace / remove; validated with a test call, stored encrypted, shown only as a hint), searchable chat-model picker (tool-calling models; custom names allowed), and embedding-model picker with reindex progress.
- Claude Code / Codex: CLI found + version + path, signed-in account, Connect / Reconnect (one-word test call) / Disconnect, model picker. Hints point at `CLAUDE_BIN` / `CODEX_BIN` and `claude auth login` / `codex login` on the server. Hidden when the server sets `CHAT_LOCAL_CLI=off`.
- Saving a model runs a test call. Privacy note: zero data retention for private images applies only to OpenRouter. Timely never switches providers silently, and a running chat finishes on the provider it started with.

### Data & privacy

- Full JSON backup, tasks CSV, calendar ICS. Current backups use `schemaVersion` 2. Version 1 restores unless it still contains nested `parent_task_id` rows; export a new backup after upgrading.
- Restore (replace-mode, transactional).
- Encrypted server backups: create, list, download, delete; schedule + retention.

### Integrations (desktop) / API keys (native)

- Create key (name, default “Hermes”).
- Secret shown **once**.
- Hermes MCP YAML snippet + copy (`localhost:8080/mcp`).
- List: prefix, created, last used.
- Revoke with confirm.
- Keys are `tk_…`, stored as prefix + SHA-256. Used **only** for MCP, not for the JWT app session.

### Notifications

Desktop `/notifications` (sidebar Bell, `g` then `n`) and native Notifications screen: in-app center with read/unread, clear all, reminder snooze, overdue / start-soon / missed alerts, and assistant updates (which open the chat). The native overdue alert has a **Reschedule urgently** action. Settings → Notifications: category prefs (reminder, digest, planning, overdue, agent, missed, start), quiet hours, digest times (digests include Unscheduled counts), failed-job retry. Native also registers Expo push and always keeps local reminder schedules.

**No** language picker, billing, or connected-account screens.

---

## 15. AI agent (in-app chat + Hermes via MCP)

There are two agent surfaces over **one tool catalog**: the in-app chat (desktop `/chat` + overlay, native assistant) and external Hermes/MCP with an API key. MCP activity is attributed to `"Hermes"`; in-app chat activity to `"Timely AI"`.

### In-app chat — desktop

- **Page** `/chat` (`?id=` opens a conversation) and an **overlay** from anywhere with **Ctrl/Cmd+Shift+J** (New chat, Open in Chat tab, Close). `g` then `a` goes to `/chat`. Chat is the first sidebar item, with an unread badge (9+ cap).
- **Screen context:** removable chips added automatically: location, the open doc/sheet/project/task, its workspace and project, selected text (≤12,000 chars), sheet tab + selected cells, calendar view and date.
- **History:** grouped Needs you / Today / Yesterday / This week / Earlier; title search; status or relative time per row; inline rename (≤120 chars) and delete (removes history, temporary images, and notifications; applied changes stay). Collapsible; a drawer on narrow widths.
- **Conversation:** status pill (Queued / Working / Applying / Needs your review / Needs attention / Stopped), provider · model subtitle, day separators, notice rows for run events, collapsible archived proposals, inline change cards. Empty state suggests Start a project, Build a budget, Make room to learn, Save a receipt. Finished runs refresh tasks, projects, docs, sheets, calendar, Today, Inbox, and notifications.
- **Composer:** Enter sends, Shift+Enter newline, ≤16,000 chars. JPEG/PNG images by picker, paste, or drag-drop (≤5, 10 MB each). **Web search** toggle (off for image chats: “Private image chat”). Send becomes Stop while busy.
- **Electron:** when the window is unfocused and a chat becomes unread (ready to review, needs attention, new update), an OS notification appears; clicking it opens `/chat?id=`. Background throttling is off so polling continues.

### In-app chat — native

- **Opened by a two-finger pinch** anywhere in the signed-in app (one-time “Meet your assistant” hint; screens can opt out), or from an assistant notification via `/(app)/assistant?chatId=`. It is a full-screen modal, not a tab.
- Header, thread, composer, history (same groups, unread dot and badge, long-press Rename / Delete), and a separate proposal page.
- Attachments: camera, photo library, image files, a screenshot of the current screen, or clipboard. Camera/library photos are re-encoded to JPEG.
- Screen context from Home, Calendar, Tasks, Search, Files, and task/doc/sheet/project/event detail (selection, filters, calendar range, unsaved drafts). “Add current screen as context” in the composer.
- **Recovery:** sends are idempotent (`requestId`). The draft, cached chats, and receipt edits are stored per account and wiped on logout. Cached chats open offline; sending needs a connection.

### Proposals and approval (ADR 0007)

- The model reads with read tools and submits all writes as one `propose_changes` plan (1–30 steps; later steps can reference earlier results).
- Simple single-step changes apply directly. **Approval is required** for multi-step plans; deletes, bulk, recurrence/occurrence/series edits; `auto_schedule_apply` (default range now → +14 days); adding sheet rows or multi-cell / structural sheet edits; column type changes; templated sheets; markdown doc rewrites; any edit to an existing recurring object; and every image chat.
- Proposal panel: Ready for your review → Applying → Changes applied / Some changes did not finish / Stopped. “X of N applied” progress. Per-step Pending / In progress / Done / Failed (with error) / Discarded, expandable “Review details” (sheet rows as a table, existing content), and links to created objects.
- Actions: **Apply changes**, **Discard** (archives the plan; nothing is written), **Stop** (keeps finished steps), **Try again** (resumes from the first unfinished step). Each step runs in its own serializable transaction. If data changed since the plan was made, the plan is archived and a fresh one is proposed.
- Not available to chat at all: whole-object deletes (except sheet rows/columns), settings, backups, restore, notifications, jobs.

### Runs (ADR 0008)

- Runs execute on the server in three dedicated workers (lease 3 min, renewed every 5 s), separate from the job queue. They are capped at 12 model turns and 10 minutes, and **keep running after you leave the chat**. Clients poll (1.5 s while busy; the desktop list every 5 s).
- Limits: 8 context chips, 5 images per message, 150 messages per chat.
- A reply, approval request, completion, or failure marks the chat unread and creates an `agent` notification. Push is private: “Timely assistant” with “needs approval / needs attention / has finished”, never chat content. It follows the Planning preference and quiet hours. Reading the chat or its notification clears both.

### Images and receipts

- Images are re-encoded (EXIF stripped), ≤10 MB / 20 MP, expire after **24 hours** (20 live per account, in `CHAT_IMAGE_DIR`). The UI then shows “Image removed · extracted details kept”. Image chats are marked sensitive: review is forced, web search is blocked, and OpenRouter uses zero-data-retention routing.
- **Receipts:** the model extracts merchant, date, currency, category, subtotal, tax, tip, discount, total, included-tax/discount flags, and up to 300 line items. Totals are reconciled with exact decimal math; if items do not add up, the images are re-checked.
- **Receipt review** (desktop inline, native two steps “Check your receipt” → “Confirm receipt”): edit every field, acknowledge flagged issues, handle duplicates (Skip / Update existing / Add anyway), and choose an existing expense sheet + tab or a new sheet (picked automatically from context). The result is an approval-required sheet change writing Expenses and Items tabs; missing columns are added without retyping existing ones.
- Non-receipt images: confirm or discard the extracted text.

### Providers (ADR 0009)

- **OpenRouter** (default): personal encrypted key or the server `OPENROUTER_API_KEY`; default chat model `z-ai/glm-5.3-flash` (`OPENROUTER_CHAT_MODEL`). Web search via the `web` plugin.
- **Claude Code CLI**: models fable, opus, sonnet (default), haiku or a full name; runs `claude -p` with every built-in tool disabled.
- **Codex CLI**: `codex exec --ephemeral -s read-only` with the shell disabled; default model from `~/.codex/config.toml`.
- Connect checks the binary, sign-in, and one test call. Disconnecting the default provider resets it to OpenRouter. Provider and model are fixed when a run starts; there is never a silent fallback.
- Env: `OPENROUTER_API_KEY`, `OPENROUTER_CHAT_MODEL`, `OPENROUTER_EMBED_MODEL`, `CHAT_LOCAL_CLI=off`, `CLAUDE_BIN`, `CODEX_BIN`, `CHAT_IMAGE_DIR`; stored keys are encrypted with `TIMELY_BACKUP_KEY` (or `JWT_SECRET`).

### Hermes / MCP

Mint an API key → point Hermes at `/mcp`. The server instructions tell the agent to start with `get_context` and to ask which workspace to use on every Work creation.

**Intelligence tools**

- `get_context` — user, workspaces (with statuses/labels/fields), projects (stages, open/done/progress), working hours, saved views, now/timezone. Intended first call.
- `search` / `semantic_search` / `reindex_search`
- `get_agenda` — items + overdue + unscheduled for a day/week
- `get_free_time` — working-hour gaps
- `what_next` — the same **Rank** as `GET /schedule/rank` (optional `timezone`, top 15). Returns `reasons[]`; scores are ordering hints, not certainty. Inbox and reminders are excluded.

**Task-creation rules:** `create_task` defaults to Work with a 30-minute duration and requires `workspaceId`; an explicit duration ≤ 0 is rejected; `kind=inbox` is refused in favor of `capture_inbox_item` (title only). `clarify_inbox_item` creates new Work or a Reminder and consumes the item.

Destructive actions — `delete_workspace`, `delete_project`, `delete_doc`, `delete_backup`, `restore_account` — require `confirm=true`. Prefer `archive_doc` / `archive_sheet` over delete. Deleting a document does not cascade to subpages.

### Complete MCP tool list (147)

**Context / intelligence (7):** `get_context`, `search`, `semantic_search`, `reindex_search`, `get_agenda`, `get_free_time`, `what_next`

**Workspaces / taxonomy (14):** `list_workspaces`, `get_workspace`, `create_workspace`, `rename_workspace`, `delete_workspace`, `create_status`, `update_status`, `delete_status`, `create_label`, `update_label`, `delete_label`, `create_custom_field`, `update_custom_field`, `delete_custom_field`

**Projects (13):** `list_projects`, `get_project`, `list_project_activity`, `create_project`, `update_project`, `complete_project`, `reopen_project`, `delete_project`, `create_stage`, `update_stage`, `delete_stage`, `reorder_stages`, `duplicate_project`

**Tasks (33):** `list_tasks`, `get_task`, `create_task`, `update_task`, `bulk_update_tasks`, `complete_task`, `reopen_task`, `move_task_to_status`, `move_task_to_stage`, `delete_task`, `set_task_labels`, `set_task_custom_field`, `set_task_dependency`, `add_task_comment`, `list_task_activity`, `set_task_recurrence`, `clear_task_recurrence`, `edit_task_occurrence`, `split_task_series`, `capture_inbox_item`, `list_inbox`, `clarify_inbox_item`, `add_checklist_item`, `update_checklist_item`, `toggle_checklist_item`, `replace_checklist`, `delete_checklist_item`, `start_focus`, `pause_focus`, `stop_focus`, `get_today`, `set_today_focus`, `duplicate_task`

**Events (7):** `list_events`, `get_event`, `create_event`, `update_event`, `delete_event`, `edit_event_occurrence`, `split_event_series`

**Calendar / schedule (15):** `get_calendar`, `get_working_hours`, `update_working_hours`, `get_schedule_settings`, `update_schedule_settings`, `get_capacity`, `auto_schedule_preview`, `auto_schedule_apply`, `undo_schedule`, `pin_task`, `pin_block`, `schedule_task`, `move_block`, `delete_block`, `clear_task_blocks`

**Docs (7):** `list_docs`, `get_doc`, `create_doc`, `update_doc`, `append_to_doc`, `archive_doc`, `delete_doc`

**Sheets (19):** `list_sheets`, `get_sheet`, `create_sheet` (optional `templateId`), `update_sheet`, `archive_sheet`, `add_sheet_column`, `update_sheet_column`, `delete_sheet_column`, `add_sheet_rows`, `update_sheet_cells`, `delete_sheet_rows`, `duplicate_sheet`, `delete_sheet`, `list_sheet_templates`, `get_sheet_template`, `create_sheet_template`, `update_sheet_template`, `delete_sheet_template`, `materialize_sheet_template_tab`

**Saved views / profile / config (10):** `list_task_views`, `create_task_view`, `update_task_view`, `delete_task_view`, `set_active_task_view`, `set_project_task_view`, `get_profile`, `update_profile`, `get_config`, `update_account_config` (onboarding flag, theme, accent)

**Notifications / jobs (11):** `list_notifications`, `unread_notification_count`, `mark_notification_read`, `clear_notifications`, `snooze_reminder`, `reschedule_urgent`, `get_notification_settings`, `update_notification_settings`, `list_jobs`, `retry_job`, `get_job_health`

**Portability (11):** `export_account`, `export_tasks_csv`, `export_calendar`, `export_doc` (markdown, or PDF as base64), `get_backup_settings`, `update_backup_settings` (interval and retention 1–30), `create_backup`, `list_backups`, `download_backup`, `delete_backup`, `restore_account`

`apps/api/scripts/mcp_parity.go` exercises MCP/API parity end to end.

---

## 16. Create / navigation UX

**Desktop sidebar:** + menu (Task, Event, Workspace, Project, Doc, Sheet), Search, Chat (unread badge), Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications, Settings, Logout. Settings → Appearance can auto-hide the rail until the pointer is at the left edge.

**Add Item modal:** per-type forms. Tasks open with a **Work | Reminder** toggle first. Reminder uses Notify at (date and time). Work uses duration, workspace, project, stage, labels, custom fields. Rich description for task/project. Recurrence for task/event. Labels/custom fields with inline create. Events all-day/duration/workspace.

**Clarify modal:** the same Add modal, titled Clarify, opened from an Inbox row.

**Native FAB** on Home/Calendar/Tasks/Files: Inbox, Task, Reminder, Event, Doc, Sheet. Workspace/Project also from settings. Reminder create uses Notify at. A **two-finger pinch** anywhere opens the assistant.

### Keyboard (desktop)

- Ctrl/Cmd+K or `/` command palette
- Ctrl/Cmd+Shift+J chat overlay (new chat with screen context)
- `g` then `a` Chat, `y` Today, `i` Inbox, `c` Calendar, `t` Tasks, `p` Projects, `d` Docs, `s` Sheets, `r` Report, `n` Notifications
- `c` or `n` new task (on `/inbox`, `c` focuses capture)
- On `/tasks`: `x` completes the open task (with Undo), `s` schedules it on the calendar
- Escape close
- Ctrl/Cmd+Enter comment; in chat, Enter sends and Shift+Enter adds a line
- Sheet: arrows, Tab, Enter/F2, Delete, type-to-edit
- `/` slash, `@` mention, `.`/`-` + space in editor

---

## 17. Cross-cutting product behavior

| Area | Current behavior |
| --- | --- |
| Theme | Desktop system/light/dark; native light/dark from Settings (persisted). Shared color tokens |
| Language | English copy with locale-aware date/time formatting; no translation catalog yet |
| Timezones | Browser TZ + editable working-hours IANA zone; tzdata embedded in API |
| Mentions | `@` links between docs, sheets, tasks, projects |
| Colors | Workspace/stage/status/label/project/event colors; task cards inherit project color where available; calendar legend |
| Realtime | Docs SSE only, in-process hub (won’t fan out across multiple API instances). Chat uses polling |
| Offline | Desktop/native show an explicit offline + stale-data banner. Native mutations use `networkMode: "always"` and land in a durable per-account queue: task completion, schedule lock, bulk complete, checklist toggle, Today focus, and recurrence occurrence edits (except move). The queue replays one at a time on startup, sign-in, and reconnect (4xx drops an item). Cold starts work offline from a cached session user. Doc/sheet editing and sending chat messages remain online-only |
| PWA | None |
| Attachments / files / camera | Markdown file import for docs, and **temporary** chat images (JPEG/PNG, 24-hour expiry; native camera, library, files, screenshot, clipboard). No persistent attachments |
| Email / SMTP | None. Push is Expo HTTP; no mailer |
| Background jobs | Postgres `jobs` table with `FOR UPDATE SKIP LOCKED`, retries/backoff, dedupe keys, `/jobs` health + retry. Worker runs in the API process. Kinds: `send_reminder`, `overdue_task`, `missed_block`, `start_soon`, `index_entity`, `reindex_user`, `daily_digest`, `send_push`, `create_backup`. Scheduled backups use AES-256-GCM encryption and retention. Chat runs use their own leased workers, not this queue |
| External calendars | None (no Google Calendar, ICS import two-way, Slack, GitHub). ICS **export** exists |
| Collaboration | Single user per account. Multiple independent accounts may exist on one install |
| IDs | Typed prefixes (`tsk_`, `pr_`, `doc_`, …) |
| Electron | Windows and navigation stay in-app only on an exact origin match; other links open in the OS only for `http`, `https`, and `mailto` |
| Isolation | Optional `DB_SCHEMA` runs an API instance in its own Postgres schema (worktree dev) |
| CORS | Allowlist includes localhost:4001 and hardcoded ngrok origins |

---

## 18. Native-only extras

- JWT + refresh token in SecureStore
- Notification permission on first launch; Android `POST_NOTIFICATIONS`, `reminders` and `agent` channels, exact-alarm permissions declared
- Pinch-to-open AI assistant with camera / photo-library permissions (`expo-image-picker`, no microphone), screen capture, and receipt review
- Local reminder schedules (horizon 60 days, max 60) plus optional Expo push registration — locals are **not** cancelled when push registers
- In-app notification center, clear all, and snooze
- Dedicated Search tab (command palette with quick actions)
- Home tab with Today focus, agenda, and Inbox entry; it is the default route after login/onboarding
- Combined Files tab (Docs | Sheets) with a nested doc tree, page menu, and Markdown import
- Sheet templates and multi-tab workbooks, including a template preview route
- Hidden sheets route (duplicate of Files → Sheets)
- Android cleartext HTTP for LAN API; API URL baked into production APK (`updates.enabled: false`, so URL changes need a rebuild). `make build-apk` / `install-apk` take the URL via `--api-url` or `API_URL`
- Deep link scheme `timelymobile` exists; no custom handlers beyond router paths
- Portrait, light/dark theme picker, splash, tablet flag on iOS

Export uses the native share sheet; network state, stale data, and queued safe mutations are persisted and visible. No widgets, biometrics, or offline doc/sheet database.

---

## 19. Routes

### Public / marketing (desktop web)

| Route | What it does |
| --- | --- |
| `/` | Landing |
| `/login` | Email/password login |
| `/signup` | Register (sends name) |
| `/onboarding` | Create first workspace |
| `/demo/command-palette` | Public command-palette demo with sample data |

### Desktop app

| Route | What it does |
| --- | --- |
| `/chat` | AI chat: history + conversation (`?id=`) |
| `/today` | Focus, today’s plan, reminders, inbox |
| `/inbox` | Title-only capture |
| `/calendar` | Day / Week / Month / Agenda |
| `/tasks` | Saved views, List / Kanban / Gantt |
| `/projects` | Project hub |
| `/projects/[id]` | Overview, tasks, stages, activity |
| `/docs` | Docs home + Markdown import |
| `/docs/[id]` | Doc editor |
| `/sheets` | Sheets and template home |
| `/sheets/[id]` | Multi-tab spreadsheet |
| `/sheets/templates/[id]` | Template preview and create-from-template |
| `/report` | Productivity snapshot |
| `/notifications` | In-app notification center |
| `/settings` | Account (incl. devices), Appearance, Schedule, Notifications, Workspaces, Agent, Data & privacy, Integrations (`?tab=`) |
| `/m`, `/m/*` | Redirect to `/calendar` (legacy mobile-web bookmarks) |

### Native app

| Route | Role |
| --- | --- |
| `/login`, `/signup`, `/onboarding` | Auth gate |
| `/(app)/(tabs)/home` | Default Home tab (Today focus, agenda, Inbox entry) |
| `/(app)/(tabs)/calendar` | Calendar tab |
| `/(app)/(tabs)/tasks` | Task list |
| `/(app)/(tabs)/search` | Command palette search |
| `/(app)/(tabs)/docs` | Files (Docs \| Sheets) |
| `/(app)/(tabs)/more` | Hidden; redirects to settings |
| `/(app)/assistant` | Deep-link shim: opens the assistant overlay at `?chatId=` |
| `/(app)/search` | Redirects to the Search tab |
| `/(app)/today` | Today |
| `/(app)/inbox` | Inbox capture |
| `/(app)/tasks/[id]` | Task / reminder detail (Work \| Reminder) |
| `/(app)/events/[id]` | Event detail |
| `/(app)/projects` | Project list |
| `/(app)/projects/[id]` | Project detail + stages |
| `/(app)/docs/[id]` | Doc editor |
| `/(app)/sheets/[id]` | Sheet editor |
| `/(app)/sheets/templates/[id]` | Template preview and create-from-template |
| `/(app)/report` | Report |
| `/(app)/settings/*` | Account, notifications, schedule, workspaces, API keys |
| `/(app)/settings/agent` | AI provider and model settings |
| `/(app)/settings/data` | Portable exports, restore, encrypted backup scheduling and history |
| `/(app)/notifications` | In-app notification center |

---

## 20. HTTP API surface

### Public

| Method | Path | Capability |
| --- | --- | --- |
| GET | `/` | Health/hello |
| POST | `/register` | Sign up (name, email, password) |
| POST | `/login` | Sign in |
| POST | `/logout` | Clear session cookie |
| POST | `/auth/refresh` | Rotate access + refresh tokens |
| ANY | `/mcp` | MCP agent (Bearer API key; not JWT middleware) |

### Authenticated (JWT / session cookie)

**Me:** `GET/PUT /me`

**Sessions:** `GET /sessions`, `DELETE /sessions/:id`

**Tasks:** CRUD, bulk patch, activity, comments, occurrence edit, recurrence split, inbox (`POST /inbox` capture, `POST /inbox/:id/clarify`), focus start/pause/stop, checklist, today-focus

**Events:** CRUD (with `duration`), occurrence edit, recurrence split

**Calendar / schedule:** `GET /calendar`, working hours get/put, schedule preview/apply/reschedule/undo, `GET /schedule/rank?timezone=`, task blocks CRUD

**Projects:** CRUD, stages CRUD + reorder, duplicate

**Workspaces:** CRUD, labels, statuses, custom fields, `GET/PUT /config`

**Docs / sheets:** CRUD; archive flag; `GET /docs/:id/watch` (SSE); doc export `?format=markdown` (PDF still accepted by the exporter, unused in UI); sheet template list/get/create/update/delete and materialize-tab endpoints

**API keys / search / notifications:** list/create/revoke keys; `GET /search`; `POST /search/reindex`; notifications list/read/clear/snooze and overdue-task urgent reschedule; `PUT/DELETE /devices/push`; `GET/PUT /notifications/settings`; jobs list/health/retry

**Chat:** `GET/POST /chats`, `GET/PATCH/DELETE /chats/:id`, `POST /chats/:id/{messages,approve,reject,stop,retry,read,receipt}`, `POST /chats/:id/images/{confirm,discard}`, `POST /chats/images`, `GET/DELETE /chats/images/:imageId`

**Agent providers:** `GET/PATCH /agent/providers`, `GET /agent/providers/:id/models` (`?kind=embed` for OpenRouter), `POST /agent/providers/:id/{connect,disconnect}`, `POST/DELETE /agent/providers/openrouter/key`

**Portability:** full versioned JSON export + replace-mode transactional restore; task CSV; calendar ICS; document Markdown; encrypted server backup create/list/download/delete; backup schedule + retention settings

---

## 21. What the API can do that the UI barely/never exposes

These are already in the backend — useful if choosing “build UI” vs “build new capability”:

- Sheet granular row/cell tools, `duplicate_sheet`, and checklist replace/update in MCP (the HTTP grid API writes whole sheets)
- Legacy `scheduleId` still on the task JSON (unused by the engine)
- Semantic reindex endpoint
- Agent markdown append-to-doc
- `get_free_time` / `get_agenda` (agent-only; Rank is now in the UI via the calendar waiting rail)
- Focus pause (`POST /tasks/:id/focus/pause`): native uses it, desktop web does not
- `POST /inbox/:id/clarify`: desktop uses it, native still clarifies by editing in task detail
- Urgent overdue reschedule: native and MCP only
- Per-project task views (`config.projectTaskViews`) via MCP `set_project_task_view`
- Document PDF bytes (no download button)
- Split recurring series (hooks exist; native task UI is thinner than events)

---

## 22. Explicit gaps (not built)

Grouped so you can pick from current holes. Older planning notes in `NextPhase.md` may describe work that is now implemented.

### People and access

- Team workspaces, invites, roles, sharing, guest links
- OAuth / SSO / password-reset **email** / 2FA / biometrics
- Per-doc or per-sheet permissions

### Work model

- Focus pause/resume on desktop web (API and native have it)
- Native Inbox does not use the Clarify endpoint yet
- Native still auto-applies the scheduling engine after creating eligible work tasks; desktop task creation does not
- Comment delete; richer project activity (not only recently updated tasks)
- Gantt bar move/resize (undated tasks can currently be dropped onto the timeline to set dates)
- Full task/project template manager (duplicate is the current entry point)

### Calendar

- Hour-grid Week view on mobile (native Week is a list)
- Google / Outlook / ICS two-way sync
- Time-zone per event, travel time, conference links
- Drag-drop on native calendar

### Knowledge

- Doc/sheet sharing, comments, version history, images/files
- Persisted sheet views, database-style linked records, and charts (the editors already have transient filter/sort controls)

### Awareness

- Email notifications (intentionally no SMTP)
- One-click overdue reschedule in the desktop notification center (native has the action)
- Android 14+ exact-alarm Settings deep-link if the OS denied it
- Digest open-count matching Report; persist notification timezone from working hours

### Platform

- Translation catalogs and runtime language selection
- Offline doc/sheet editing, a full offline database, and PWA
- Billing
- Persistent attachments (beyond `.md` import and 24-hour chat images)
- Multi-instance realtime for docs (SSE hub is in-process)
- Humanized device session names
- Pushed chat updates (clients poll; runs themselves are multi-instance safe via leases)

---

## 23. Surface matrix

| Capability | Desktop | Native | MCP |
| --- | --- | --- | --- |
| Auth / onboarding / refresh | Yes | Yes | Profile name |
| Device sessions | Yes | Via refresh token | No |
| Calendar D/W/M/Agenda | D W M A | D W(list) M A | Range + agenda |
| Auto-schedule (skip completed) | Full preview/apply/undo | Preview/apply/undo | Full |
| Manual blocks | Full, including calendar move/resize | Reschedule + pin/chunk | Full |
| Task list/kanban/gantt + saved views | Yes | Native-only saved views (list/board; no gantt) | Views CRUD + filters |
| Task comments/activity | Yes | Yes | Yes |
| Inbox / Today / focus | Yes; Clarify modal; no focus pause | Yes; focus pause; clarify via detail | Yes, incl. pause |
| Checklists | Yes | Yes | Yes |
| Reminders as a type | Work \| Reminder + Notify at | Kind + segmented control + local push | Yes + snooze |
| Notification center / prefs | Yes; overdue alert opens task; chat alerts open chat | Yes + OS permission; urgent reschedule action | Yes, incl. `reschedule_urgent` |
| Working hours / engine | Multi-window + freeze | Hours + freeze | Yes |
| Recurrence | Yes | Yes | Yes |
| Projects hub + stages | Yes | List + detail | Full + stages + board |
| Docs tree + editor | Yes | Tree + page menu + editor | Markdown + archive |
| Markdown import / MD export | Yes | Yes | Markdown in/out |
| Code Copy + IDE colors | Yes | Yes | — |
| Sheets + formulas | Tabs, formatting, filters, templates, CSV | Tabs, formatting, filters, templates | Granular + archive + templates + duplicate |
| Archive docs/sheets | Yes | Yes | Yes |
| Report | Full | Thinner | No |
| Global search / command palette | Cmd+K or `/`, quick actions | Tab, quick actions | Keyword + semantic |
| AI chat | `/chat` + Cmd+Shift+J overlay, images, receipts, Electron notifications | Pinch overlay, camera/screenshot, receipts, private push | Is the tool catalog (chat uses an allowlisted subset) |
| AI provider settings | Settings → Agent | Settings → Agent | No |
| API keys / Hermes | Yes | Yes | Auth itself |
| Export / backup / restore | Full | Full + share sheet | Yes (`confirm=true` for restore/delete backup) |
| Workspace taxonomy | Yes | Yes | Yes |
| Theme | System/light/dark | Light/dark | No |

---

## Summary

The current product is a **personal, multi-account, English** workspace where you capture inbox items, turn work and reminders into distinct types, put work on a calendar (manually or with an explainable engine that ignores completed tasks), run projects with stages, write nested docs (including Markdown import and IDE-like code blocks), use multi-tab spreadsheets and templates, export and protect your data, search by text or meaning from a command palette, glance at a live report, ask the in-app AI agent (OpenRouter, Claude Code, or Codex) to propose changes you review before they apply — including turning receipt photos into expense sheets — and optionally let Hermes drive the same objects through MCP. Desktop and native make connectivity state explicit; native asks for notification permission on launch and schedules reminder pings on the device.
