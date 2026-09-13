# Timely — Current Feature Inventory

Snapshot of what the application **already does**, across desktop web, mobile web (`/m`), the native Expo app, the Go API, and Hermes/MCP. Use this to decide what to build next. Nothing here is a proposal; gaps are called out separately at the end.

Last inventoried from the three repos: `timely`, `timely-api`, `timely-mobile`.

---

## Product at a glance

Timely is a **single-user personal productivity system**: calendar + tasks + auto-schedule + notes + spreadsheets + search, with an AI agent (Hermes) that can operate the same data over MCP. There is no team, sharing, email, or calendar sync.

| Surface | What it is |
| --- | --- |
| **Desktop web** | Full product: sidebar, saved task views, week calendar, auto-schedule, settings, reports, rich editors |
| **Mobile web** (`/m`) | Phone-shell prototype of calendar/tasks/docs/sheets; settings/report open desktop routes; demo fallback if API is slow |
| **Native app** | Expo Android/iOS client with tabs, server push (local reminder fallback), search tab, working hours and API keys |
| **API** | Email/password JWT, CRUD for everything, calendar engine, semantic search, SSE for docs, Postgres job queue |
| **Hermes / MCP** | 121 tools on `/mcp` with a personal API key — the agent can do almost everything the UI can through Phase 4 |

Ownership is always “this user owns this row.” No members, roles, invites, or resource ACLs.

---

## 1. Account, auth, onboarding

**What exists**

- Email + password **register** and **login**.
- Password hashed with bcrypt. Session is a JWT (HS256) returned in JSON **and** stored as an HttpOnly `session` cookie (24h, configurable). Native stores the same JWT in SecureStore and sends `Authorization: Bearer`.
- **Logout** clears cookie/token.
- **Profile:** name, email, change password (needs current password).
- **Onboarding flag** on user config. First-run flow: create a workspace, then mark onboarding complete and land on Calendar.
- Landing page at `/` with Sign In / Register, “Get Started Free”, “Sign In Demo”, and marketing cards (calendar, task boards, reports). Demo credentials are shown on login (`user@example.com` / `password123`).

**What does not exist**

- OAuth, Google, SSO, magic links, refresh tokens, 2FA, biometrics, password reset email, session list, multi-device management.

**Quirks useful for planning**

- Signup UI collects a name but does not send it to `/register`.
- Web signup currently goes to `/calendar` and can skip the onboarding check.
- Desktop middleware protects calendar/tasks/report/settings/onboarding; docs, sheets, and `/m/*` are not in that list.

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

- Types: **text, number, date, url, select, multi_select**, and **boolean** in the type system.
- Select / multi-select have colored options.
- Settings dropdown currently omits boolean even though the control exists elsewhere.
- Can be created inline from Add Task.
- Can be used as **task-list group-by** and **columns**.

**Not implemented:** members, invites, roles, workspace sharing, icons/avatars for workspaces, workspace archive.

---

## 3. Projects

Projects are containers for work inside a workspace. There is **no dedicated Projects page**; they show up as rows on Tasks, in pickers, search, reports, and mentions.

### Fields

Title, rich description, workspace, status, priority, start date, deadline, completedAt, color (hex), `doesHaveStages` flag, custom field values, timestamps.

### Stages (partial)

- API + MCP: create / rename / delete / reorder stages on a project.
- Tasks have `stageId`. Desktop list can group by stage.
- Desktop project form has a stages **toggle**.
- **No UI** to define the stage catalog or assign a stage on a task. Native can add a project from workspace settings but has **no project editor**.

### Actions

- Create (desktop Add modal; native from workspace settings).
- Complete (set `completedAt`) via API/MCP.
- Delete cascades tasks.
- Shown on Tasks as synthetic `project-` rows when data mode is Projects.

---

## 4. Tasks (core work items)

Work tasks require `duration > 0` and a workspace. Duration is minutes of work the scheduler can place. Title-only capture is `kind=inbox` and is **not** auto-scheduled until clarified. Reminders are `kind=reminder` (timed pings). Subtasks nest one level (`parentTaskId`); schedulable children replace the parent in the engine. Checklist items are lightweight completion text on the parent. `actualMinutes` is focused time, separate from estimated `duration`.

### Fields

| Field | Behavior |
| --- | --- |
| Name | Required, 2–100 chars on create |
| Description | TipTap rich text on desktop; native is closer to plain notes |
| Duration | Minutes; `> 0` = schedulable work |
| Start date, deadline | Date pickers |
| Scheduled on | Reminder ping time, or mirror of earliest block |
| Completed at | Toggle complete / reopen |
| Workspace, project, status | Required on work tasks; inbox items and standalone reminders may omit workspace until clarified |
| Priority | Low, Medium, High, Urgent; **Critical** exists on desktop detail only. Native Quick Add uses lowercase low/medium/high/urgent |
| Labels | Multi |
| Custom fields | Per workspace |
| Blocked by | This task waits on another. Dependents (“blocking”) are a read-only list |
| Stage | Project board; Hermes `move_task_to_stage` |
| Recurrence | RFC 5545 series |
| Blocks | Manual or engine time chunks on the calendar |
| Kind | `task`, `reminder`, or `inbox` |
| Parent | One-level subtask (`parentTaskId`) |
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

List columns include: Task, Description, Duration, Start, Deadline, Scheduled On, Completed, Created, Updated, Project, Workspace, Blocked By, Priority, Stage ID, Schedule ID, Status, Labels, custom fields.

Reminders (`kind=reminder`, typically duration 0) and inbox items are **hidden from the main board** unless the view’s `showReminders` filter is on. Inbox has its own `/inbox` page.

**Kanban:** columns = workspace statuses (+ “No status”). Drag a card to change status. Cards open detail.

**Gantt:** bars from start→deadline (with fallbacks). Click opens detail. **No drag-resize.**

Deep links: `?taskId=`, `?projectId=` (native search can pass `projectId`, but the tasks screen does not consume it yet).

### Detail, activity, comments (desktop + native)

- Autosave title/properties; description often needs explicit save on desktop.
- Complete toggle, delete, Escape closes the panel.
- **Activity feed:** created / updated / commented, with field diffs (name, description, duration, dates, schedule, complete, priority, status, project, stage, blockedBy, labels, custom fields, occurrences). Actor is the user or `"Hermes"` for MCP.
- Comments via `Ctrl/Cmd+Enter`.
- Native has activity + comments; notes are not the full rich editor.

**Bulk update** exists on the API (`PATCH /tasks/bulk`), as MCP `bulk_update_tasks`, and in the desktop/native task list (complete/reopen, status, priority, project, label, deadline, delete).

**No nested subtasks beyond one level.** Completing a parent does not auto-complete children; `openSubtaskCount` is shown on the parent.

### Filters on API (also used by agent)

workspace(s), project(s), status(es), label(s), priority, stage, completed, overdue, dueBefore/After, scheduled, recurring, reminders, kind, inbox, parentId, includeSubtasks, text `q`, sort, limit/offset (default 200).

### Mobile web / native task UX

Filters: All, Today, Overdue, Upcoming (14 days), No date, Done; workspace chips; search by name; grouped by project; card complete checkbox; dedicated detail screen.

---

## 5. Reminders (duration = 0)

A reminder is a **timed ping**, not a work block.

- Workspace / project / status / labels / custom fields / blocked-by are hidden or optional.
- Can convert reminder ↔ duration on desktop/native detail.
- Calendar draws them as short chips; they **do not occupy busy time** for auto-schedule.
- Recurring reminders are allowed.
- Native Quick Add has Reminder as a first-class kind.
- **Awareness:** due reminders are claimed by a Postgres job (`send_reminder`) even when the UI is closed. Native registers an Expo push token when possible; local OS schedules remain only as a fallback and are cancelled once server push is registered so they do not duplicate. Desktop and native have an in-app notification center (read/unread, snooze 15m/1h/tomorrow). Snooze updates the underlying reminder (`scheduledOn` or a moved occurrence) and enqueues the next ping. Settings control category prefs, quiet hours (in-app still writes; push is delayed), and morning/evening digests.

---

## 6. Recurrence (tasks and events)

RFC 5545 RRULE with `dtstart` + IANA timezone. Occurrences are **expanded on read**, not stored as rows. Exceptions: skip / move / complete.

**Presets:** none, daily, weekly (that weekday), weekdays, monthly (date), yearly, custom.

**Custom editor:** interval; DAILY / WEEKLY / MONTHLY / YEARLY; BYDAY chips; monthly day-of-month or nth weekday; yearly months; end never / count / until date.

**Occurrence actions:** this / this+future (split series) / all. Complete, uncomplete, skip, restore, move.

Auto-schedule **skips** recurring tasks (they are not placed as work blocks).

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

### Mobile web / native calendar

Day / Agenda / Month (**no Week**). Horizontal date strip with busy dots. Item sheet: type badge, complete, reschedule (block / reminder time / one-off event), skip/restore occurrence. Native also has auto-schedule from the header.

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

- Configurable buffer between blocks (`breakMinutes`, default 5, range 1–60). Not a hidden gap.
- Freeze window (`freezeHours`, 0–168): near-term engine blocks are kept; 0 leaves every hour movable.
- Per-workspace include/exclude (`excludedWorkspaceIds`).
- Per-task: min/preferred chunk, contiguous vs splittable, earliest start, preferred time windows, `scheduleLocked`.
- Pin a single block (`locked`); locking turns an engine block into a manual pin.

### Engine behavior

- Places incomplete work (including recurring **work** occurrences inside the horizon) into **free working hours minus busy time** (events + existing blocks). Inbox items, reminders, and parents with schedulable subtasks are skipped.
- Recurring work is scheduled as blocks on the parent task with `occurrenceStart`; it does not create extra task rows. One occurrence failing to fit does not change later ones. Skip/move/complete exceptions are respected. Reminders still expand as pings and do not occupy busy time.
- Shared ranking with `what_next`: deadline slack, duration, priority, Today focus, dependency readiness, partial progress. Scores are ordering hints, never presented as certainty.
- Blockers are hoisted. Earliest fit respects min/preferred chunk, contiguous single-slot, preferred-window intersection, and freeze.
- Horizon default **14 days**, max **90**.
- Skip reasons include: `no_capacity`, `blocked`, `manual`, `no_duration`, `reminder`, `recurring` (repeating **reminders**), `completed`, `inbox`, `parent_has_subtasks`, `locked`, `frozen`, `workspace_excluded`, `contiguous_no_fit`, `before_earliest`. Each skip has a plain-language `message`.
- Optional include-manual. Deadline-risk and capacity flags (`overCapacity`, `atRisk`) appear before apply.

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

- Desktop: auto-schedule dialog (changes, skip messages, capacity, risks, undo) + floating toast (running / done / error). Settings → Schedule has hours + engine controls.
- Native: sparkles header → sheet (preview/apply/undo/capacity/skip messages) + activity banner. Settings → Schedule has hours + engine. Task detail has pin/chunk/contiguous/earliest/windows.
- Mobile web: toast can appear; no full planner UI.

---

## 9. Overdue

A task is overdue when it is incomplete, not a reminder, and:

- deadline is before today, **or**
- (one-off only) last block / scheduledOn ended before today.

Recurring: deadline only; missed occurrences are handled separately.

Shown in: Agenda Overdue section, Report, mobile “Overdue” filter, agent `get_agenda` / `what_next`.

---

## 10. Documents

Nested notes (parentId + order), Notion-like.

**Fields:** title, emoji icon, TipTap/ProseMirror JSON content, plainText, parentId, workspaceId, projectId, favorite, archivedAt, order.

### Desktop

- Home: recently edited (12), empty state, New doc.
- Tree sidebar: expand/collapse, auto-expand ancestors, add subpage, local search, favorites, delete with descendant count.
- Full editor.

### Editor

- Slash `/`: Text, H1–H3, bullets, numbered, to-do list, quote, code block, 3×3 table, divider, link, mention.
- Markdown-ish: `.`+space → bullet; `-`+space → divider.
- Marks: bold, italic, strike, inline code, highlight.
- `@` mentions: doc, sheet, task, project (client navigation).
- Tables: resizable, merge/split, delete-table toolbar.
- Link popover, word count, floating/fixed toolbar.
- Autosave. **SSE watch** (`/docs/:id/watch`) last-write-wins; skip remote while focused/unsaved. Poll fallback on native.
- Agent speaks **markdown** (create/update/append/get as markdown).

**Mobile web / native:** flat list with favorites section; editor without tree. Native Files tab is Docs | Sheets.

**Archive:** API flag + lists hide archived items. **No Archive button in UI.** Delete only.

**Not implemented:** sharing, permissions, version history, comments on docs, attachments/images, publish/export.

---

## 11. Spreadsheets

Lightweight grids, not Airtable.

**Fields:** title, emoji icon, rich description, columns, rows, workspace, project, favorite, archivedAt.

Default new sheet: columns A–D + empty rows.

### Grid (desktop + native)

- Formula bar; Enter/F2 to edit; type-to-edit; arrows/Tab; Delete/Backspace clear; column resize (72–640px); rename headers; add/delete rows and columns; min 1 row/column; autosave.
- Desktop and native expose column types: text / number / date / boolean. MCP `add_sheet_column` / `update_sheet_column` / `update_sheet_cells` use the same types; cells are coerced server-side.

### Formulas (client-side)

- Operators: `+ - * / ^ & = <> < > <= >=`
- Ranges `A1:B2`, TRUE/FALSE, percents
- Functions: SUM, AVERAGE/AVG, MIN, MAX, PRODUCT, COUNT, COUNTA, ABS, SQRT, ROUND, FLOOR, CEILING, POWER, IF, AND, OR, NOT, CONCAT/CONCATENATE, LEN, UPPER, LOWER, TRIM
- Errors: `#VALUE!`, `#DIV/0!`, `#NUM!`, `#NAME?`, `#PARSE!`, etc.

No saved sheet views, filters, sorts, or charts. HTTP is whole-sheet CRUD; row/column helpers are MCP-first.

Archive: same as docs — filtered, no UI action.

---

## 12. Search

**Desktop:** command palette, sidebar Search or **Ctrl/Cmd+K**. Semantic `/search?mode=semantic`, fallback to keyword if 503. Hits: task, project, doc, sheet, event → deep links (events → calendar).

**Native:** dedicated Search tab, 250ms debounce, same semantic+fallback.

**Mobile web:** local task-name search only; sidebar search on docs/sheets lists.

**Backend**

- Keyword: ILIKE across those five kinds.
- Semantic: OpenRouter embeddings (default `openai/text-embedding-3-small`, 1536 dims) → pgvector cosine. Optional `kinds=` filter. Index writes enqueue an `index_entity` job (goroutine fallback if the queue is unset); `POST /search/reindex`; auto-reindex if empty. Disabled without `OPENROUTER_API_KEY`.

---

## 13. Reports

Client-computed snapshot (not a separate analytics API). Desktop `/report`; native has a thinner screen under Settings; mobile web links out to desktop.

Computed from live tasks/projects/docs/sheets:

- Completion % and done/open counts
- Open tasks, Overdue, Projects, Docs & sheets
- Overdue list (≤10)
- Open by priority bars
- Due in next 14 days (≤10)
- Projects with open work (≤8) and by-workspace counts
- Mentions graph from `@` links in rich text (≤16) — native computes this but barely shows it
- Recent activity (≤12)

Empty states per section. No date-range picker, no export, no stored historical reports.

---

## 14. Settings

### Account

Name, email, current password, new password, Save.

### Schedule

Working hours as above. Used only by auto-schedule (and reminder timezone context).

### Workspaces

Picker → Name / Statuses / Labels / Custom fields.

### Integrations (desktop) / API keys (native)

- Create key (name, default “Hermes”).
- Secret shown **once**.
- Hermes MCP YAML snippet + copy (`localhost:8080/mcp`).
- List: prefix, created, last used.
- Revoke with confirm.
- Keys are `tk_…`, stored as prefix + SHA-256. Used **only** for MCP, not for the JWT app session.

### Notifications

Desktop `/notifications` (sidebar Bell, `g` then `n`) and native Notifications screen: in-app center with read/unread and reminder snooze. Settings → Notifications: category prefs, quiet hours, digest times, failed-job retry. Native also registers Expo push and keeps local schedules only if registration fails.

**No** theme toggle, language, privacy, billing, or connected-account screens.

---

## 15. AI agent (Hermes via MCP)

**No in-app chat.** The product surface is: mint an API key → point Hermes/MCP at `/mcp`.

Activity from the agent is attributed to `"Hermes"`.

### Intelligence tools

- `get_context` — user, workspaces (with statuses/labels/fields), projects (stages, open/done/progress), working hours, saved views, now/timezone. Intended first call.
- `search` / `semantic_search` / `reindex_search`
- `get_agenda` — items + overdue + unscheduled for a day/week
- `get_free_time` — working-hour gaps
- `what_next` — ranks open work with the same scoring policy as the engine (deadline slack, duration, priority, Today focus, dependency, partial progress). Returns `reasons[]`; scores are ordering hints, not certainty. Inbox and reminders are excluded.

### Then full CRUD

Workspaces, statuses, labels, custom fields (including boolean), projects, stages, tasks (including bulk, labels, custom fields, dependency, comments, activity, recurrence, occurrences, split, kanban status, project-stage moves, schedule lock/chunks), events, calendar, working hours, schedule settings, capacity, auto-schedule preview/apply/undo, pins, manual blocks, docs (markdown, append, archive), sheets (column types, typed cells, archive), saved task views (including Phase 1 filters), profile (name only).

Destructive deletes of a workspace, project, or document require `confirm=true`. Prefer `archive_doc` / `archive_sheet` over delete. Deleting a document does not cascade to subpages.

### Complete MCP tool list (121)

**Context / intelligence:** `get_context`, `search`, `semantic_search`, `reindex_search`, `get_agenda`, `get_free_time`, `what_next`

**Workspaces / taxonomy:** `list_workspaces`, `get_workspace`, `create_workspace`, `rename_workspace`, `delete_workspace`, `create_status`, `update_status`, `delete_status`, `create_label`, `update_label`, `delete_label`, `create_custom_field`, `update_custom_field`, `delete_custom_field`

**Projects:** `list_projects`, `get_project`, `create_project`, `update_project`, `complete_project`, `reopen_project`, `delete_project`, `create_stage`, `update_stage`, `delete_stage`, `reorder_stages`, `duplicate_project`

**Tasks:** `list_tasks`, `get_task`, `create_task`, `update_task`, `bulk_update_tasks`, `complete_task`, `reopen_task`, `move_task_to_status`, `move_task_to_stage`, `delete_task`, `set_task_labels`, `set_task_custom_field`, `set_task_dependency`, `add_task_comment`, `list_task_activity`, `set_task_recurrence`, `clear_task_recurrence`, `edit_task_occurrence`, `split_task_series`, `capture_inbox_item`, `list_inbox`, `clarify_inbox_item`, `list_subtasks`, `create_subtask`, `add_checklist_item`, `toggle_checklist_item`, `delete_checklist_item`, `start_focus`, `stop_focus`, `get_today`, `set_today_focus`, `duplicate_task`

**Events:** `list_events`, `get_event`, `create_event`, `update_event`, `delete_event`, `edit_event_occurrence`, `split_event_series`

**Calendar / schedule:** `get_calendar`, `get_working_hours`, `update_working_hours`, `get_schedule_settings`, `update_schedule_settings`, `get_capacity`, `auto_schedule_preview`, `auto_schedule_apply`, `undo_schedule`, `pin_task`, `pin_block`, `schedule_task`, `move_block`, `delete_block`, `clear_task_blocks`

**Docs:** `list_docs`, `get_doc`, `create_doc`, `update_doc`, `append_to_doc`, `archive_doc`, `delete_doc`

**Sheets:** `list_sheets`, `get_sheet`, `create_sheet`, `update_sheet`, `archive_sheet`, `add_sheet_column`, `update_sheet_column`, `delete_sheet_column`, `add_sheet_rows`, `update_sheet_cells`, `delete_sheet_rows`, `delete_sheet`

**Saved views / profile:** `list_task_views`, `create_task_view`, `update_task_view`, `delete_task_view`, `set_active_task_view`, `get_profile`, `update_profile`

**Notifications / jobs:** `list_notifications`, `mark_notification_read`, `snooze_reminder`, `get_notification_settings`, `update_notification_settings`, `list_jobs`, `retry_job`, `get_job_health`

---

## 16. Create / navigation UX

**Desktop sidebar:** + menu (Task, Event, Workspace, Project, Doc, Sheet), Search, Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications, Settings, Logout. `g` then `y`/`i`/`n` jumps to Today/Inbox/Notifications.

**Add Item modal:** per-type forms, property sidebar, rich description for task/project, recurrence for task/event, labels/custom fields with inline create, reminder mode (duration 0), events all-day/duration/workspace.

**Native FAB** on Calendar/Tasks/Files: Task, Reminder, Event, Doc, Sheet. Workspace/Project created in settings instead.

**Mobile web FAB:** Task, Event, Doc, Sheet. Can invent local demo tasks if API fails.

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
| Theme | Desktop supports system/light/dark; native selects light/dark from the OS at startup through shared color tokens. |
| Language | English copy with locale-aware date/time formatting; no translation catalog yet. |
| Timezones | Browser TZ + editable working-hours IANA zone; tzdata embedded in API |
| Mentions | `@` links between docs, sheets, tasks, projects |
| Colors | Status/label/project/event colors; calendar legend |
| Realtime | Docs SSE only, in-process hub (won’t fan out across multiple API instances) |
| Offline | Desktop/native show an explicit offline + stale-data banner. Native persists and replays safe idempotent task completion, checklist, Today-focus, and recurrence actions per account. Doc/sheet editing remains online-only pending conflict semantics. Mobile web shows real loading/error states and never substitutes demo records. |
| PWA | None |
| Attachments / files / camera | None. Content is JSON/markdown/text |
| Email / SMTP | None. Push is Expo HTTP; no mailer |
| Background jobs | Postgres `jobs` table with `FOR UPDATE SKIP LOCKED`, retries/backoff, dedupe keys, `/jobs` health + retry. Worker runs in the API process. Kinds: `send_reminder`, `index_entity`, `daily_digest`, `send_push`, `create_backup`. Scheduled backups use AES-256-GCM encryption and retention. |
| External calendars | None (no Google Calendar, ICS, Slack, GitHub) |
| Collaboration | Single user. “Secure Cookie Sessions” is auth, not multiplayer |
| IDs | Typed prefixes (workspace, status, etc.) |
| CORS | Allowlist includes localhost:4001 and hardcoded ngrok origins |

---

## 18. Native-only extras

- JWT in SecureStore
- Expo push token registration + local reminder fallback (horizon 60 days, max 60 scheduled, Android channel `reminders`)
- In-app notification center and snooze
- Dedicated Search tab
- Combined Files tab (Docs | Sheets)
- Hidden sheets route (duplicate of Files → Sheets)
- Android cleartext HTTP for LAN API; API URL baked into production APK (`updates.enabled: false`, so URL changes need a rebuild)
- Deep link scheme `timelymobile` exists; no custom handlers beyond router paths
- Portrait, system light/dark, splash, tablet flag on iOS

Export uses the native share sheet; network state, stale data, and queued safe mutations are persisted and visible. No widgets, camera, biometrics, or offline doc/sheet database.

---

## 19. Routes

### Public / marketing (desktop web)

| Route | What it does |
| --- | --- |
| `/` | Landing |
| `/login` | Email/password login |
| `/signup` | Register |
| `/onboarding` | Create first workspace |

### Desktop app

| Route | What it does |
| --- | --- |
| `/calendar` | Day / Week / Month / Agenda |
| `/tasks` | Saved views, List / Kanban / Gantt |
| `/docs` | Docs home |
| `/docs/[id]` | Doc editor |
| `/sheets` | Sheets home |
| `/sheets/[id]` | Spreadsheet |
| `/report` | Productivity snapshot |
| `/notifications` | In-app notification center |
| `/settings` | Account, Schedule, Notifications, Workspaces, Data & Appearance, Integrations (`?tab=`) |

### Mobile web

| Route | What it does |
| --- | --- |
| `/m` | Redirects to `/m/calendar` |
| `/m/calendar` | Day / Agenda / Month |
| `/m/tasks` | Card list + filters |
| `/m/tasks/[id]` | Task detail |
| `/m/docs` | Flat list |
| `/m/docs/[id]` | Editor |
| `/m/sheets` | Flat list |
| `/m/sheets/[id]` | Grid |
| `/m/more` | Profile, workspaces, links to desktop Report/Settings |

### Native app

| Route | Role |
| --- | --- |
| `/login`, `/signup`, `/onboarding` | Auth gate |
| `/(app)/(tabs)/calendar` | Default tab |
| `/(app)/(tabs)/tasks` | Task list |
| `/(app)/(tabs)/search` | Global search |
| `/(app)/(tabs)/docs` | Files (Docs \| Sheets) |
| `/(app)/(tabs)/more` | Settings tab |
| `/(app)/tasks/[id]` | Task / reminder detail |
| `/(app)/events/[id]` | Event detail |
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
| POST | `/register` | Sign up |
| POST | `/login` | Sign in |
| POST | `/logout` | Clear session cookie |
| ANY | `/mcp` | MCP agent (Bearer API key; not JWT middleware) |

### Authenticated (JWT / session cookie)

**Me:** `GET/PUT /me`

**Tasks:** CRUD, bulk patch, activity, comments, occurrence edit, recurrence split

**Events:** CRUD, occurrence edit, recurrence split

**Calendar / schedule:** `GET /calendar`, working hours get/put, schedule preview/apply/reschedule, task blocks CRUD

**Projects:** CRUD, stages CRUD + reorder

**Workspaces:** CRUD, labels, statuses, custom fields, `GET/PUT /config`

**Docs / sheets:** CRUD; `GET /docs/:id/watch` (SSE)

**API keys / search / notifications:** list/create/revoke keys; `GET /search`; `POST /search/reindex`; notifications CRUD-ish (list, read, snooze); `PUT/DELETE /devices/push`; `GET/PUT /notifications/settings`; jobs list/health/retry

**Portability:** full versioned JSON export + replace-mode transactional restore; task CSV; calendar ICS; individual document Markdown/PDF; encrypted server backup create/list/download/delete; backup schedule + retention settings

---

## 21. What the API can do that the UI barely/never exposes

These are already in the backend — useful if choosing “build UI” vs “build new capability”:

- Project **stages** CRUD + reorder
- Bulk task patch
- Archive docs/sheets (`archivedAt`)
- Sheet column types + granular row/cell APIs
- Boolean custom fields
- Task `blockingId` on create is **accepted and ignored**
- Legacy `schedules` / `scheduleId` still on the task model
- Semantic reindex endpoint
- Agent markdown append-to-doc
- `what_next` / `get_free_time` / `get_agenda` (agent-only intelligence)
- Split recurring series (hooks exist; native task UI is thinner than events)

---

## 22. Explicit gaps (not built)

Grouped so you can pick from real holes, not imagined ones.

### People and access

- Team workspaces, invites, roles, sharing, guest links
- OAuth / SSO / password reset / 2FA / biometrics
- Per-doc or per-sheet permissions

### Work model

- Full task/project template manager (duplicate is the current entry point)
- Kanban drag-to-status, Gantt drag-resize (Kanban drag exists; Gantt resize does not)

### Calendar

- Week view on mobile
- Google / Outlook / ICS sync
- Time-zone per event, travel time, conference links
- Drag-drop on native calendar

### Knowledge

- Doc/sheet sharing, comments, version history, images/files (individual docs export as Markdown/PDF)
- Databases/views on sheets (filters, sorts, linked records)

### Awareness

- Email notifications (intentionally no SMTP)
- In-app Hermes chat (today MCP-only)

### Platform

- Translation catalogs and runtime language selection
- Offline doc/sheet editing, a full offline database, and PWA
- Billing
- Attachments
- Multi-instance realtime for docs (SSE hub is in-process)

---

## 23. Surface matrix

| Capability | Desktop | Mobile web | Native | MCP |
| --- | --- | --- | --- | --- |
| Auth / onboarding | Yes | Uses desktop auth | Yes | Profile name |
| Calendar D/W/M/Agenda | D W M A | D M A | D M A | Range + agenda |
| Auto-schedule | Full preview/apply/undo | Toast | Preview/apply/undo | Full |
| Manual blocks | Full | Reschedule | Reschedule + pin/chunk | Full |
| Task list/kanban/gantt + saved views | Yes | Card list | Card list | Views CRUD + filters |
| Task comments/activity | Yes | No feed | Yes | Yes |
| Inbox / Today / focus | Yes | Capture | Yes | Yes |
| Subtasks / checklists | Yes | Via detail | Yes | Yes |
| Reminders | Yes + center | Yes | Yes + push/fallback | Yes + snooze |
| Notification center / prefs | Yes | Via desktop | Yes | Yes |
| Working hours / engine | Multi-window + freeze | Via desktop | Hours + freeze | Yes |
| Recurrence | Yes | Limited | Yes | Yes |
| Projects | Hub + stages | Via tasks | List + detail | Full + stages + board |
| Docs tree + editor | Yes | Flat + editor | Flat + editor | Markdown + archive |
| Sheets + formulas | Yes | Yes | Yes + types | Granular + archive |
| Report | Full | Link | Thinner | No |
| Global search | Cmd+K | Task only | Tab | Keyword + semantic |
| API keys / Hermes | Yes | Via desktop | Yes | Auth itself |
| Export / backup / restore | Full | Via desktop | Full + share sheet | No |
| Workspace taxonomy | Yes | Read-only More | Yes | Yes |

---

## Summary

The current product is a **personal, system-themed, English** workspace where you capture work and reminders, put them on a calendar (manually or with the engine), write nested docs, keep small spreadsheets, export and protect your data, search by text or meaning, glance at a live report, and optionally let Hermes drive the same objects through MCP. Desktop and native make connectivity state explicit; native safely queues a small set of idempotent actions while offline.
