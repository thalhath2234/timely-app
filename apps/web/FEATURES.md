# Timely — Current Feature Inventory

Snapshot of what the application **already does**, across desktop web, the native Expo app, the Go API, and Hermes/MCP. Use this to decide what to build next. Nothing here is a proposal; gaps are called out separately at the end.

Last inventoried **13 Sep 2026** from `timely`, `timely-api`, and `timely-mobile`. The former mobile-web shell (`/m`) was removed; phones use the native app. Old `/m` bookmarks redirect to `/calendar`.

---

## Product at a glance

Timely is a **multi-account, single-user personal productivity system**. Multiple people may register, but every account is private and independent. There is no team, sharing, email, or two-way calendar sync.

| Surface | What it is |
| --- | --- |
| **Desktop web** | Full product: sidebar, Today, Inbox, saved task views, week calendar, auto-schedule, project hub, settings, reports, rich editors |
| **Native app** | Expo Android/iOS: tabs, Inbox/Today, local reminder notifications (permission on first launch), search, working hours, API keys, export |
| **API** | Email/password JWT + refresh tokens, CRUD, calendar engine, semantic search, SSE for docs, Postgres job queue |
| **Hermes / MCP** | 119 tools on `/mcp` with a personal API key — the agent can do almost everything the UI can through Phase 4 |

Ownership is always “this user owns this row.” No members, roles, invites, or resource ACLs.

---

## 1. Account, auth, onboarding

**What exists**

- Email + password **register** and **login**. Signup sends **name** and lands on **onboarding**.
- Password hashed with bcrypt. Short-lived access JWT (cookie `session` on web; SecureStore on native) plus a **refresh token**. Native refreshes via `POST /auth/refresh`.
- **Logout** clears cookie/token.
- **Profile:** name, email, change password (needs current password).
- **Device sessions:** Settings → Account lists sessions and can **log out a device** (`GET /sessions`, `DELETE /sessions/:id`).
- **Onboarding:** create a workspace, mark complete, land on Calendar. Unauthenticated private routes redirect to login; unfinished onboarding redirects to `/onboarding`.
- Landing `/` with Sign In / Register / Get Started. **No “Sign In Demo”.** Seed credentials (`thalhathva2@gmail.com` / `12341234`) appear on login **only in development**.
- Password recovery is a **local administration command** (`timely-api/scripts/reset_password.go`), not email.

**Protected routes (web proxy)**

`/calendar`, `/today`, `/inbox`, `/tasks`, `/projects`, `/report`, `/settings`, `/docs`, `/sheets`, `/notifications`, plus `/onboarding` when logged out. Requests to `/m` or `/m/*` redirect to `/calendar`.

**What does not exist**

- OAuth, Google, SSO, magic links, 2FA, biometrics, password-reset email.

---

## 2. Workspaces (personal “spaces”)

A user can have **multiple personal workspaces**. Everything work-related hangs off a workspace.

### Create / rename / delete

- Create from onboarding, sidebar +, Add modal, Settings, native workspace settings.
- Rename in Settings.
- Delete is allowed except the last workspace (agent requires `confirm=true`).

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

- Card list: workspace, status, priority, description, progress bar, open/done counts, start and deadline.
- Create from the page or the sidebar + menu.

### Desktop `/projects/[id]`

- Tabs: **Overview**, **Tasks**, **Stages**, **Activity**.
- Overview: title, description, status, priority, **shared date picker** for start and deadline (same control as the rest of the app, not a native `<input type="date">`).
- Stages: create, rename, delete, reorder; unstaged vs staged task lists.
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

Work tasks require `duration > 0`, `kind=task`, and a workspace. Duration is minutes of work the scheduler can place. Title-only capture is `kind=inbox` and is **not** auto-scheduled until clarified. Reminders are `kind=reminder` (timed pings). Checklist items are lightweight completion text on the task and are not scheduled. `actualMinutes` is focused time, separate from estimated `duration`.

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
| Actual minutes | Focused time from start/stop focus |
| Today focus | Optional `todayFocusOn` date; max 7 per day |

### List / board / gantt (desktop only, persisted)

Saved **task views** live in user config (`taskViews` + `activeTaskViewId`). Create / rename / delete / switch. Hermes can manage them too.

Each view stores:

- **Render mode:** List, Kanban, Gantt
- **Data mode:** Tasks **or** Projects (project rows aggregated from tasks)
- **Group by** up to 3 fields, drag-reorder: workspace, project, stage, status, priority, or a custom field
- Group value order (drag-sortable) and group sort asc/desc
- **Filters:** multi workspace, multi status, project, priority, labels, stage, show completed, overdue, scheduled, recurring, reminders
- **Sort:** name, deadline, startDate, createdAt, priority, status, project × asc/desc
- **Column order** (drag headers): built-ins + custom fields

Reminders and inbox items are **hidden from the main board** unless the view’s `showReminders` filter is on. Inbox has its own `/inbox` page.

**Kanban:** columns = workspace statuses (+ “No status”). Drag a card to change status. Cards open detail.

**Gantt:** bars from start→deadline (with fallbacks). Click opens detail. **No drag-resize.** Saved view “My Deadlines” currently switches layout; it does not yet encode “has a deadline or next block.”

Deep links: `?taskId=`, `?projectId=`.

### Detail, activity, comments (desktop + native)

- Autosave title/properties; description often needs explicit save on desktop.
- **Work | Reminder** type toggle on create and detail (not Inbox).
- Complete toggle, delete, Escape closes the panel.
- **Activity feed:** created / updated / commented, with field diffs. Actor is the user or `"Hermes"` for MCP.
- Comments via `Ctrl/Cmd+Enter`. **No comment delete** in the UI.
- Native has activity + comments; notes are not the full rich editor.

**Bulk update** exists on the API (`PATCH /tasks/bulk`), as MCP `bulk_update_tasks`, and in the desktop/native task list (complete/reopen, status, priority, project, label, deadline, delete).

**Checklists** are items on the task, not nested tasks. Completing a task does not auto-complete its checklist.

### Inbox and Today

- **Inbox** (`/inbox`, native Inbox): title-only capture (`kind=inbox`). Review later to assign workspace, duration, and schedule.
- **Today** (`/today`, native Today): focusing task, today’s calendar items, reminders, inbox count, Today-focus list, start/stop focus.

### Filters on API (also used by agent)

workspace(s), project(s), status(es), label(s), priority, stage, completed, overdue, dueBefore/After, scheduled, recurring, reminders, kind, inbox, text `q`, sort, limit/offset (default 200).

### Native task UX

Saved **native task views** are stored only on the device (`native-task-views-{userId}.json`). They do **not** write `taskViews` / `activeTaskViewId`, so desktop web layouts stay unchanged.

The Tasks tab is a view switcher (create / rename / delete). **View** opens the customizer: list or board, tasks / reminders / projects, group by (up to 3, including custom fields), sort, and the same filters as desktop (workspace, project, status, priority, labels, stage, completed, overdue, scheduled, recurring, dated).

Default native views: Task List, My Deadlines, Overview, Board. Gantt stays desktop-only.

---

## 5. Reminders (`kind=reminder`)

A reminder is a **first-class timed ping**, not a work block and not a duration-0 work task.

- Create and detail use a **Work | Reminder** control. Reminder sets `kind=reminder`, `duration=0`, and requires **Notify at** (next round hour if unset). A reminder without a ping time is invalid.
- Workspace / project / status / labels / custom fields / blocked-by / duration / engine chunks are hidden on a reminder.
- Recurring reminders are allowed (time of day + repeat rule).
- Calendar draws them as short chips; they **do not occupy busy time** for auto-schedule.
- Native Quick Add has Reminder as its own kind (alongside Inbox, Task, Event, Doc, Sheet).

**Awareness**

- Due reminders are claimed by a Postgres job (`send_reminder`) even when the UI is closed.
- Desktop and native have an in-app notification center (read/unread, clear all, snooze 15m / 1h / tomorrow). Snooze updates `scheduledOn` or a moved occurrence and enqueues the next ping.
- Settings control category prefs, quiet hours (in-app still writes; push is delayed), digest times, and timezone.
- **Native local OS schedules are the device ping.** Permission is requested after the first interactive frame (Android 13+ `POST_NOTIFICATIONS`). Local schedules keep running even if Expo push token registration succeeds. Horizon 60 days, max 60 scheduled, Android channel `reminders`.
- Exact-alarm access on Android 14+ may still need a system Settings grant; that deep-link is not in the UI yet.

---

## 6. Recurrence (tasks and events)

RFC 5545 RRULE with `dtstart` + IANA timezone. Occurrences are **expanded on read**, not stored as rows. Exceptions: skip / move / complete.

**Presets:** none, daily, weekly (that weekday), weekdays, monthly (date), yearly, custom.

**Custom editor:** interval; DAILY / WEEKLY / MONTHLY / YEARLY; BYDAY chips; monthly day-of-month or nth weekday; yearly months; end never / count / until date.

**Occurrence actions:** this / this+future (split series) / all. Complete, uncomplete, skip, restore, move.

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
- **Week / Day:** hour grid; click empty slot → schedule dialog; overlapping layout; all-day row; reminders as chips.
- **Agenda:** grouped by day plus an **Overdue** section; reminders filtered out of day groups.

### Events

Standalone calendar items, optionally linked to a workspace / project / task.

Fields: title, description, start/end, allDay, color, recurrence.

Create from Add modal, schedule-dialog “New event” tab, native Quick Add. Edit/delete; occurrence scope same as tasks.

### Schedule dialog (desktop)

Tabs: **Schedule an existing unscheduled task** (search) | **New event**. Duration override; recurrence for events.

### Native calendar

Day / Agenda / Month (**no Week**). Horizontal date strip with busy dots. Item sheet: type badge, complete, reschedule (block / reminder time / one-off event), skip/restore occurrence. Auto-schedule from the header.

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

- Places incomplete **work** into **free working hours minus busy time** (events + existing **incomplete** blocks). Completed tasks are not candidates, do not appear in the change list, and do not consume free capacity. Inbox items and reminders are skipped.
- Recurring work is scheduled as blocks on the parent task with `occurrenceStart`. One occurrence failing to fit does not change later ones. Skip/move/complete exceptions are respected.
- Shared ranking with `what_next`: deadline slack, duration, priority, Today focus, dependency readiness, partial progress. Scores are ordering hints, never presented as certainty.
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

- Desktop: auto-schedule dialog (changes, skip messages, capacity, risks, undo) + floating toast. Settings → Schedule has hours + engine controls.
- Native: sparkles header → sheet (preview/apply/undo/capacity/skip messages) + activity banner. Settings → Schedule has hours + engine. Task detail has pin/chunk/contiguous/earliest/windows.

---

## 9. Overdue

A task is overdue when it is incomplete, not a reminder, and:

- deadline is before today, **or**
- (one-off only) last block / scheduledOn ended before today.

Recurring: deadline only; missed occurrences are handled separately.

Shown in: Agenda Overdue section, Report, native “Overdue” filter, agent `get_agenda` / `what_next`.

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

**Native:** flat list with favorites; editor without tree. Files tab is Docs | Sheets. Editor is a WebView with the same schema, code Copy, auto-cap, and mentions.

**Not implemented:** sharing, permissions, version history, comments on docs, attachments/images, publish.

---

## 11. Spreadsheets

Lightweight grids, not Airtable.

**Fields:** title, emoji icon, columns, rows, workspace, project, favorite, archivedAt.

Default new sheet: columns A–D + empty rows.

### Grid (desktop + native)

- Formula bar; Enter/F2 to edit; type-to-edit; arrows/Tab; Delete/Backspace clear; column resize (72–640px); rename headers; add/delete rows and columns; min 1 row/column; autosave.
- Desktop and native expose column types: text / number / date / boolean. MCP `add_sheet_column` / `update_sheet_column` / `update_sheet_cells` use the same types; cells are coerced server-side.
- **Archive / unarchive** and **show archived** on the list, same pattern as docs.

### Formulas (client-side)

- Operators: `+ - * / ^ & = <> < > <= >=`
- Ranges `A1:B2`, TRUE/FALSE, percents
- Functions: SUM, AVERAGE/AVG, MIN, MAX, PRODUCT, COUNT, COUNTA, ABS, SQRT, ROUND, FLOOR, CEILING, POWER, IF, AND, OR, NOT, CONCAT/CONCATENATE, LEN, UPPER, LOWER, TRIM
- Errors: `#VALUE!`, `#DIV/0!`, `#NUM!`, `#NAME?`, `#PARSE!`, etc.

No saved sheet views, filters, sorts, or charts. HTTP is whole-sheet CRUD; row/column helpers are MCP-first.

---

## 12. Search

**Desktop:** command palette, sidebar Search or **Ctrl/Cmd+K**. Semantic `/search?mode=semantic`, fallback to keyword if 503. Hits: task, project, doc, sheet, event → deep links (events → calendar). Duplicate hits are collapsed by `kind:id`.

**Native:** dedicated Search tab, 250ms debounce, same semantic+fallback and dedupe.

**Backend**

- Keyword: ILIKE across those five kinds.
- Semantic: OpenRouter embeddings (default `openai/text-embedding-3-small`, 1536 dims) → pgvector cosine. Optional `kinds=` filter. Index writes enqueue an `index_entity` job (goroutine fallback if the queue is unset); `POST /search/reindex`; auto-reindex if empty. Disabled without `OPENROUTER_API_KEY`.

---

## 13. Reports

Client-computed snapshot (not a separate analytics API). Desktop `/report`; native has a thinner screen under Settings.

Computed from live tasks/projects/docs/sheets:

- Completion % and done/open counts
- Open tasks, Overdue, Projects, Docs & sheets
- Overdue list (≤10)
- Open by priority bars
- Due in next 14 days (≤10) — currently deadline-based; next engine block is not counted yet
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

Picker → Name / Statuses / Labels / Custom fields (including Yes/No).

### Appearance

- Theme: system / light / dark on desktop; light / dark on native.
- Accent color presets and custom hex on desktop.
- Auto-hide sidebar: reveal when the pointer is at the left edge.

### Data & privacy

- Full JSON backup, tasks CSV, calendar ICS.
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

Desktop `/notifications` (sidebar Bell, `g` then `n`) and native Notifications screen: in-app center with read/unread, clear all, and reminder snooze. Settings → Notifications: category prefs, quiet hours, digest times, failed-job retry. Native also registers Expo push and always keeps local reminder schedules.

**No** language picker, billing, or connected-account screens.

---

## 15. AI agent (Hermes via MCP)

**No in-app chat.** The product surface is: mint an API key → point Hermes/MCP at `/mcp`.

Activity from the agent is attributed to `"Hermes"`.

### Intelligence tools

- `get_context` — user, workspaces (with statuses/labels/fields), projects (stages, open/done/progress), working hours, saved views, now/timezone. Intended first call.
- `search` / `semantic_search` / `reindex_search`
- `get_agenda` — items + overdue + unscheduled for a day/week
- `get_free_time` — working-hour gaps
- `what_next` — ranks open work with the same scoring policy as the engine. Returns `reasons[]`; scores are ordering hints, not certainty. Inbox and reminders are excluded.

### Then full CRUD

Workspaces, statuses, labels, custom fields (including boolean), projects, stages, tasks (including bulk, labels, custom fields, dependency, comments, activity, recurrence, occurrences, split, kanban status, project-stage moves, schedule lock/chunks), events, calendar, working hours, schedule settings, capacity, auto-schedule preview/apply/undo, pins, manual blocks, docs (markdown, append, archive), sheets (column types, typed cells, archive), saved task views, profile (name only), notifications, jobs.

Destructive deletes of a workspace, project, or document require `confirm=true`. Prefer `archive_doc` / `archive_sheet` over delete. Deleting a document does not cascade to subpages.

### Complete MCP tool list (119)

**Context / intelligence:** `get_context`, `search`, `semantic_search`, `reindex_search`, `get_agenda`, `get_free_time`, `what_next`

**Workspaces / taxonomy:** `list_workspaces`, `get_workspace`, `create_workspace`, `rename_workspace`, `delete_workspace`, `create_status`, `update_status`, `delete_status`, `create_label`, `update_label`, `delete_label`, `create_custom_field`, `update_custom_field`, `delete_custom_field`

**Projects:** `list_projects`, `get_project`, `create_project`, `update_project`, `complete_project`, `reopen_project`, `delete_project`, `create_stage`, `update_stage`, `delete_stage`, `reorder_stages`, `duplicate_project`

**Tasks:** `list_tasks`, `get_task`, `create_task`, `update_task`, `bulk_update_tasks`, `complete_task`, `reopen_task`, `move_task_to_status`, `move_task_to_stage`, `delete_task`, `set_task_labels`, `set_task_custom_field`, `set_task_dependency`, `add_task_comment`, `list_task_activity`, `set_task_recurrence`, `clear_task_recurrence`, `edit_task_occurrence`, `split_task_series`, `capture_inbox_item`, `list_inbox`, `clarify_inbox_item`, `add_checklist_item`, `toggle_checklist_item`, `delete_checklist_item`, `start_focus`, `stop_focus`, `get_today`, `set_today_focus`, `duplicate_task`

**Events:** `list_events`, `get_event`, `create_event`, `update_event`, `delete_event`, `edit_event_occurrence`, `split_event_series`

**Calendar / schedule:** `get_calendar`, `get_working_hours`, `update_working_hours`, `get_schedule_settings`, `update_schedule_settings`, `get_capacity`, `auto_schedule_preview`, `auto_schedule_apply`, `undo_schedule`, `pin_task`, `pin_block`, `schedule_task`, `move_block`, `delete_block`, `clear_task_blocks`

**Docs:** `list_docs`, `get_doc`, `create_doc`, `update_doc`, `append_to_doc`, `archive_doc`, `delete_doc`

**Sheets:** `list_sheets`, `get_sheet`, `create_sheet`, `update_sheet`, `archive_sheet`, `add_sheet_column`, `update_sheet_column`, `delete_sheet_column`, `add_sheet_rows`, `update_sheet_cells`, `delete_sheet_rows`, `delete_sheet`

**Saved views / profile:** `list_task_views`, `create_task_view`, `update_task_view`, `delete_task_view`, `set_active_task_view`, `get_profile`, `update_profile`

**Notifications / jobs:** `list_notifications`, `mark_notification_read`, `clear_notifications`, `snooze_reminder`, `get_notification_settings`, `update_notification_settings`, `list_jobs`, `retry_job`, `get_job_health`

---

## 16. Create / navigation UX

**Desktop sidebar:** + menu (Task, Event, Workspace, Project, Doc, Sheet), Search, Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications, Settings, Logout. `g` then `y`/`i`/`n` jumps to Today/Inbox/Notifications. Settings → Appearance can auto-hide the rail until the pointer is at the left edge.

**Add Item modal:** per-type forms. Tasks open with a **Work | Reminder** toggle first. Reminder uses Notify at (date and time). Work uses duration, workspace, project, stage, labels, custom fields. Rich description for task/project. Recurrence for task/event. Labels/custom fields with inline create. Events all-day/duration/workspace.

**Native FAB** on Calendar/Tasks/Files: Inbox, Task, Reminder, Event, Doc, Sheet. Workspace/Project also from settings. Reminder create uses Notify at.

### Keyboard (desktop)

- Ctrl/Cmd+K search
- Escape close
- Ctrl/Cmd+Enter comment
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
| Colors | Status/label/project/event colors; calendar legend |
| Realtime | Docs SSE only, in-process hub (won’t fan out across multiple API instances) |
| Offline | Desktop/native show an explicit offline + stale-data banner. Native persists and replays safe idempotent task completion, checklist, Today-focus, and recurrence actions per account. Doc/sheet editing remains online-only |
| PWA | None |
| Attachments / files / camera | None except Markdown file import for docs. Content is JSON/markdown/text |
| Email / SMTP | None. Push is Expo HTTP; no mailer |
| Background jobs | Postgres `jobs` table with `FOR UPDATE SKIP LOCKED`, retries/backoff, dedupe keys, `/jobs` health + retry. Worker runs in the API process. Kinds: `send_reminder`, `index_entity`, `daily_digest`, `send_push`, `create_backup`. Scheduled backups use AES-256-GCM encryption and retention |
| External calendars | None (no Google Calendar, ICS import two-way, Slack, GitHub). ICS **export** exists |
| Collaboration | Single user per account. Multiple independent accounts may exist on one install |
| IDs | Typed prefixes (`tsk_`, `pr_`, `doc_`, …) |
| CORS | Allowlist includes localhost:4001 and hardcoded ngrok origins |

---

## 18. Native-only extras

- JWT + refresh token in SecureStore
- Notification permission on first launch; Android `POST_NOTIFICATIONS`, reminder channel, exact-alarm permissions declared
- Local reminder schedules (horizon 60 days, max 60) plus optional Expo push registration — locals are **not** cancelled when push registers
- In-app notification center, clear all, and snooze
- Dedicated Search tab
- Combined Files tab (Docs | Sheets) with Markdown import
- Hidden sheets route (duplicate of Files → Sheets)
- Android cleartext HTTP for LAN API; API URL baked into production APK (`updates.enabled: false`, so URL changes need a rebuild)
- Deep link scheme `timelymobile` exists; no custom handlers beyond router paths
- Portrait, light/dark theme picker, splash, tablet flag on iOS

Export uses the native share sheet; network state, stale data, and queued safe mutations are persisted and visible. No widgets, camera, biometrics, or offline doc/sheet database.

---

## 19. Routes

### Public / marketing (desktop web)

| Route | What it does |
| --- | --- |
| `/` | Landing |
| `/login` | Email/password login |
| `/signup` | Register (sends name) |
| `/onboarding` | Create first workspace |

### Desktop app

| Route | What it does |
| --- | --- |
| `/today` | Focus, today’s plan, reminders, inbox |
| `/inbox` | Title-only capture |
| `/calendar` | Day / Week / Month / Agenda |
| `/tasks` | Saved views, List / Kanban / Gantt |
| `/projects` | Project hub |
| `/projects/[id]` | Overview, tasks, stages, activity |
| `/docs` | Docs home + Markdown import |
| `/docs/[id]` | Doc editor |
| `/sheets` | Sheets home |
| `/sheets/[id]` | Spreadsheet |
| `/report` | Productivity snapshot |
| `/notifications` | In-app notification center |
| `/settings` | Account (incl. devices), Appearance, Schedule, Notifications, Workspaces, Data & privacy, Integrations (`?tab=`) |
| `/m`, `/m/*` | Redirect to `/calendar` (legacy mobile-web bookmarks) |

### Native app

| Route | Role |
| --- | --- |
| `/login`, `/signup`, `/onboarding` | Auth gate |
| `/(app)/(tabs)/calendar` | Default tab |
| `/(app)/(tabs)/tasks` | Task list |
| `/(app)/(tabs)/search` | Global search |
| `/(app)/(tabs)/docs` | Files (Docs \| Sheets) |
| `/(app)/(tabs)/more` | Settings tab |
| `/(app)/today` | Today |
| `/(app)/inbox` | Inbox capture |
| `/(app)/tasks/[id]` | Task / reminder detail (Work \| Reminder) |
| `/(app)/events/[id]` | Event detail |
| `/(app)/projects` | Project list |
| `/(app)/projects/[id]` | Project detail + stages |
| `/(app)/docs/[id]` | Doc editor |
| `/(app)/sheets/[id]` | Sheet editor |
| `/(app)/report` | Report |
| `/(app)/settings/*` | Account, notifications, schedule, workspaces, API keys |
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

**Tasks:** CRUD, bulk patch, activity, comments, occurrence edit, recurrence split, inbox, focus, checklist, today-focus

**Events:** CRUD, occurrence edit, recurrence split

**Calendar / schedule:** `GET /calendar`, working hours get/put, schedule preview/apply/reschedule/undo, task blocks CRUD

**Projects:** CRUD, stages CRUD + reorder, duplicate

**Workspaces:** CRUD, labels, statuses, custom fields, `GET/PUT /config`

**Docs / sheets:** CRUD; archive flag; `GET /docs/:id/watch` (SSE); doc export `?format=markdown` (PDF still accepted by the exporter, unused in UI)

**API keys / search / notifications:** list/create/revoke keys; `GET /search`; `POST /search/reindex`; notifications list/read/clear/snooze; `PUT/DELETE /devices/push`; `GET/PUT /notifications/settings`; jobs list/health/retry

**Portability:** full versioned JSON export + replace-mode transactional restore; task CSV; calendar ICS; document Markdown; encrypted server backup create/list/download/delete; backup schedule + retention settings

---

## 21. What the API can do that the UI barely/never exposes

These are already in the backend — useful if choosing “build UI” vs “build new capability”:

- Sheet granular row/cell APIs (grid UI is whole-sheet)
- Legacy `scheduleId` still on the task JSON (unused by the engine)
- Semantic reindex endpoint
- Agent markdown append-to-doc
- `what_next` / `get_free_time` / `get_agenda` (agent-only intelligence)
- Document PDF bytes (no download button)
- Split recurring series (hooks exist; native task UI is thinner than events)

---

## 22. Explicit gaps (not built)

Grouped so you can pick from real holes, not imagined ones. See also `NextPhase.md` §14 (R8).

### People and access

- Team workspaces, invites, roles, sharing, guest links
- OAuth / SSO / password-reset **email** / 2FA / biometrics
- Per-doc or per-sheet permissions

### Work model

- Saved views that encode intent (My Deadlines = has deadline **or** next block)
- Kanban/Gantt/report using next scheduled block when dates are empty
- Inbox **Make task** still needs to write duration, default status, and stay off the board until clarified
- Stop auto-applying the engine on every task create
- Comment delete; richer project activity (not only recently updated tasks)
- Gantt drag-resize
- Full task/project template manager (duplicate is the current entry point)

### Calendar

- Week view on mobile
- Google / Outlook / ICS two-way sync
- Time-zone per event, travel time, conference links
- Drag-drop on native calendar

### Knowledge

- Doc/sheet sharing, comments, version history, images/files
- Databases/views on sheets (filters, sorts, linked records)

### Awareness

- Email notifications (intentionally no SMTP)
- In-app Hermes chat (today MCP-only)
- Android 14+ exact-alarm Settings deep-link if the OS denied it
- Digest open-count matching Report; persist notification timezone from working hours

### Platform

- Translation catalogs and runtime language selection
- Offline doc/sheet editing, a full offline database, and PWA
- Billing
- Attachments (beyond `.md` import)
- Multi-instance realtime for docs (SSE hub is in-process)
- Humanized device session names

---

## 23. Surface matrix

| Capability | Desktop | Native | MCP |
| --- | --- | --- | --- |
| Auth / onboarding / refresh | Yes | Yes | Profile name |
| Device sessions | Yes | Via refresh token | No |
| Calendar D/W/M/Agenda | D W M A | D M A | Range + agenda |
| Auto-schedule (skip completed) | Full preview/apply/undo | Preview/apply/undo | Full |
| Manual blocks | Full | Reschedule + pin/chunk | Full |
| Task list/kanban/gantt + saved views | Yes | Native-only saved views (list/board; no gantt) | Views CRUD + filters |
| Task comments/activity | Yes | Yes | Yes |
| Inbox / Today / focus | Yes | Yes | Yes |
| Checklists | Yes | Yes | Yes |
| Reminders as a type | Work \| Reminder + Notify at | Kind + segmented control + local push | Yes + snooze |
| Notification center / prefs | Yes | Yes + OS permission | Yes |
| Working hours / engine | Multi-window + freeze | Hours + freeze | Yes |
| Recurrence | Yes | Yes | Yes |
| Projects hub + stages | Yes | List + detail | Full + stages + board |
| Docs tree + editor | Yes | Flat + editor | Markdown + archive |
| Markdown import / MD export | Yes | Yes | Markdown in/out |
| Code Copy + IDE colors | Yes | Yes | — |
| Sheets + formulas | Yes | Yes + types | Granular + archive |
| Archive docs/sheets | Yes | Yes | Yes |
| Report | Full | Thinner | No |
| Global search | Cmd+K | Tab | Keyword + semantic |
| API keys / Hermes | Yes | Yes | Auth itself |
| Export / backup / restore | Full | Full + share sheet | No |
| Workspace taxonomy | Yes | Yes | Yes |
| Theme | System/light/dark | Light/dark | No |

---

## Summary

The current product is a **personal, multi-account, English** workspace where you capture inbox items, turn work and reminders into distinct types, put work on a calendar (manually or with an explainable engine that ignores completed tasks), run projects with stages, write nested docs (including Markdown import and IDE-like code blocks), keep small spreadsheets, export and protect your data, search by text or meaning, glance at a live report, and optionally let Hermes drive the same objects through MCP. Desktop and native make connectivity state explicit; native asks for notification permission on launch and schedules reminder pings on the device.
