# Timely — Next Phase Plan

## 1. Product direction

Timely is a **multi-account, single-user personal management application**. Multiple people may register separate accounts, but every account is private and independent. It is not a collaboration product and should never evolve into one.

The next phase should make the existing calendar, tasks, projects, scheduling engine, notes, sheets, and Hermes integration feel like one dependable system. The product already has enough breadth; the highest-value work now is to close incomplete workflows, improve scheduling quality, and make the app safe and reliable for daily use.

### Permanent scope decisions

The following are intentionally **out of scope**, not future backlog items:

- Team workspaces, members, invitations, roles, guests, or resource ACLs
- Shared docs/sheets, public links, collaborative editing, or multiplayer presence
- Team reporting, assignments, approvals, or organization administration
- Per-seat billing or other collaboration-driven billing features
- SSO intended for organization account management
- User directories, account discovery, or any way to assign content to another user

Each registered user can have multiple personal workspaces such as Work, Personal, Learning, and Health, and can sign in on multiple devices. “Single user” means that a user can access and manage only their own data; it does not mean the whole installation is limited to one account.

### Cross-platform delivery requirement

Every feature and correction in this roadmap must affect both the **desktop web app** and the **native Expo mobile app for Android and iOS**, unless a phase explicitly says that a capability is platform-specific. A phase is not complete when only the desktop implementation ships.

- Backend models, validation, permissions, and API behavior must be shared by both clients.
- Native mobile must provide the same essential capability, even when its interaction design is adapted for a smaller touch screen.
- Mobile acceptance tests must be included alongside desktop and API tests.
- There is no mobile-web product. The former `/m` shell was removed; phones use the native Expo app. Legacy `/m` URLs redirect to `/calendar`.

---

## 2. What should happen next

The recommended order is:

1. Establish strict per-user data isolation and fix security/data inconsistencies.
2. Expose valuable backend capabilities that currently have incomplete UI.
3. Complete the task/project execution workflow.
4. Make auto-scheduling trustworthy enough for daily use.
5. Add awareness through background jobs and notifications.
6. Add resilience, data portability, and platform polish.

Do not start with new content modules, collaboration, advanced spreadsheet features, or visual customization. They would increase surface area without improving the main productivity loop.

---

## 3. Phase 0 — Account isolation and stabilization

**Priority:** Immediate  
**Goal:** Make the current product secure, internally consistent, and explicit that every account is an isolated personal environment.

### 3.1 Enforce private, independent accounts

- Keep the `users` table and ownership foreign keys. Every user-owned row must remain associated with exactly one account.
- Allow new account registration from the logged-out state at any time.
- Never expose another account’s workspaces, projects, tasks, events, docs, sheets, settings, search results, activity, or calendar data.
- Enforce ownership in backend queries and service methods, not only in client-side filtering.
- Return not-found for cross-account resource IDs so the API does not reveal whether another user’s resource exists.
- Scope API keys, semantic-search indexes, background jobs, notifications, and Hermes context to the authenticated user.
- Keep account email addresses unique and normalize them consistently during registration and login.
- Retain authentication because each user may use desktop, native mobile, and remote access.
- Remove demo credentials and “Sign In Demo” from production builds.
- Add a secure account-recovery flow. If email delivery is intentionally avoided, provide per-account recovery codes or a documented local administration command.

### 3.2 Fix authentication and onboarding gaps

- Send the entered name during signup and persist it.
- Make onboarding behavior identical on desktop and native.
- Protect docs, sheets, and every other private route consistently.
- Prevent the calendar from flashing before an onboarding redirect.
- Decide on session renewal for multi-device use. Short-lived access tokens plus revocable device sessions are preferred over an unrenewable 24-hour token.
- Add a “log out this device” action. A full team-style administration screen is unnecessary.

### 3.3 Resolve model and UI inconsistencies

- Define one canonical priority enum and casing across Go, web, native, database, and MCP. Decide whether `Critical` remains; do not leave it surface-specific.
- Expose boolean custom fields everywhere they are supported.
- Fix `blockingId` being accepted and ignored, or remove it from create input and use only `blockedById`.
- Remove or formally deprecate legacy `schedules` / `scheduleId` after a safe data migration.
- Define consistent archive semantics for docs and sheets.
- Align native working hours with desktop multi-window working hours.
- Make timezone selection and display consistent across every client.
- Remove the mobile-web behavior that silently substitutes demo data after an API timeout. Show an offline/error state and retry action instead.

### 3.4 Reliability baseline

- Add integration tests for auth, ownership filtering, onboarding, task CRUD, recurrence exceptions, calendar expansion, and schedule preview/apply.
- Add migration tests using a production-like Postgres database.
- Add structured API logs, request IDs, job logs, and client error reporting.
- Make embedding indexing retryable instead of fire-and-forget only.
- Validate all destructive cascades, especially workspace/project deletion.

### Exit criteria

- A logged-out person can register a new account even when other accounts already exist.
- Each new account receives its own onboarding flow and private initial workspace.
- Automated isolation tests prove that one account cannot read, search, update, delete, schedule, or receive notifications for another account’s data through either HTTP or MCP.
- Every private route rejects unauthenticated access.
- Priorities, custom fields, working hours, and timezones round-trip without client-specific changes.
- API failures never produce fake user data.
- Critical calendar, recurrence, and scheduling paths have automated coverage.

---

## 4. Phase 1 — Finish existing workflows

**Priority:** High  
**Goal:** Turn partially exposed backend features into complete user-facing workflows before building new backend domains.

### 4.1 Project hub and stages

Create a dedicated Projects area with:

- Project list with status, priority, dates, progress, and open-task count
- Project detail page with description, tasks, stages, activity, and schedule summary
- Stage catalog create, rename, delete, and drag-reorder UI
- Task stage picker on create and detail screens
- Stage-based task board inside a project
- Proper handling of `?projectId=` deep links on all relevant clients
- Native project edit support, not only project creation

### 4.2 Task list interaction

- Kanban drag-to-change-status with optimistic update and rollback
- Multi-select and bulk actions using the existing bulk endpoint
- Bulk status, priority, project, labels, dates, complete/reopen, and delete
- Gantt drag/move/resize only after date rules are clearly defined
- Saved-view filters for project, priority, labels, stage, completion, overdue, scheduled, recurring, and reminders
- A visible “Reminders” view instead of hiding reminders from the main task experience

### 4.3 Archive and spreadsheet parity

- Archive, unarchive, and archived-items screens for docs and sheets
- Confirmation and descendant preview when deleting docs
- Column-type selection on desktop sheets
- Consistent typed-cell validation and formula behavior across desktop and native
- Keep advanced sheet views, charts, linked records, and Airtable-like databases out of this phase

### 4.4 Small UX completion items

- Consistent autosave state: Saving, Saved, Failed, Retry
- Unsaved-change protection where explicit saves still exist
- Unified empty, loading, offline, and error states
- Keyboard shortcuts for quick task creation, complete, schedule, and navigation
- Undo toast for reversible actions such as complete, archive, and moving a Kanban card

### Exit criteria

- A project can be created, organized into stages, worked, and completed without using MCP or Settings.
- Common changes to several tasks require one bulk action, not repeated edits.
- Kanban movement reliably updates status.
- Archive/unarchive is fully usable in the UI.
- Every backend capability claimed in this phase has equivalent desktop UI and an intentional native behavior.

---

## 5. Phase 2 — Complete the personal execution model

**Priority:** High  
**Goal:** Support the way one person breaks down, chooses, and completes work.

### 5.1 Add true subtasks and checklists

Add both concepts, with different purposes:

- **Subtask:** a real task with its own status, dates, duration, schedule blocks, and recurrence rules
- **Checklist item:** lightweight completion text inside a task with no independent scheduling

Rules to define before implementation:

- Parent completion behavior when children remain open
- Whether parent duration includes child duration; recommended default is that schedulable subtasks replace the parent’s schedulable duration
- Maximum nesting depth; one level is sufficient for the first release
- Progress calculation and display
- Recurrence behavior for subtasks

### 5.2 Add an Inbox and fast capture

- Add a first-class Inbox for thoughts/tasks that have not been organized.
- Allow task capture with only a title; workspace, duration, dates, and project can be assigned later.
- Add a global Quick Add shortcut and natural-language date parsing as an optional enhancement.
- Add an Inbox review flow: assign type, duration, project/workspace, priority, and schedule.

This requires relaxing the current rule that every work task must immediately have a workspace and positive duration. “Unprocessed inbox item” must be a valid state and must not be auto-scheduled until clarified.

### 5.3 Daily planning and focus

- Create a Today view combining scheduled blocks, reminders, events, overdue items, and chosen priorities.
- Let the user choose a small “Today focus” set independent of deadlines.
- Add a focus mode for the current task with start/stop, elapsed time, next block, and complete/reschedule actions.
- Record actual focused time separately from estimated duration.
- Add a short end-of-day review: completed, unfinished, moved, and tomorrow’s priorities.

### 5.4 Templates

- Task templates with duration, priority, labels, checklist, recurrence, and relative dates
- Project templates with stages, tasks, and offsets from project start/deadline
- Duplicate task/project as the simplest entry point before a full template manager

### Exit criteria

- A user can capture an idea in seconds without inventing metadata.
- A large task can be decomposed without abusing blocker relationships.
- Today clearly answers “what am I doing now and next?”
- Estimated and actual effort are stored separately.

---

## 6. Phase 3 — Scheduling engine v2

**Priority:** High  
**Goal:** Make auto-scheduling predictable, explainable, and safe to trust.

### 6.1 Scheduling controls

- Per-task minimum and preferred chunk size
- Splittable vs must-run-contiguously option
- Earliest start time and “do not schedule before” support
- Optional task-level preferred time windows
- Configurable transition/buffer time rather than a fixed hidden five-minute gap
- Schedule lock/pin for blocks the engine must never move
- Freeze window, such as “do not automatically change the next 24 hours”
- Per-workspace scheduling inclusion/exclusion

### 6.2 Better preview and explainability

- Show proposed moves, additions, removals, and unchanged pins before apply.
- Explain why each task was placed or skipped in plain language.
- Highlight deadline risk and insufficient capacity before changing data.
- Add one-click undo for the last schedule application by storing a schedule revision.
- Make schedule operations idempotent and safe against concurrent apply requests.

### 6.3 Recurring work

- Support auto-scheduling recurring work occurrences without converting the entire series into stored task rows.
- Schedule occurrences only within the active planning horizon.
- Respect skipped, moved, and completed occurrence exceptions.
- Prevent duplicate blocks when the horizon advances or the engine reruns.
- Define what happens when one recurring occurrence cannot fit without changing future occurrences.

### 6.4 Capacity and ranking

- Upgrade `what_next` and scheduling priority to share one documented scoring policy.
- Consider deadline slack, duration, priority, manual focus choice, dependency readiness, and existing partial progress.
- Add capacity views by day and week: available, scheduled, over capacity, and at risk.
- Never present a score as certainty; provide the reason behind a recommendation.

### Exit criteria

- Preview exactly matches apply.
- Running apply twice produces no duplicate blocks.
- A user can pin near-term plans and safely replan the future.
- Recurring work is scheduled correctly through horizon changes and exceptions.
- Every skipped task has an actionable reason.
- The last schedule application can be undone.

---

## 7. Phase 4 — Background jobs and awareness

**Priority:** Medium-high  
**Goal:** Ensure reminders and important planning events happen even when the UI is closed.

### 7.1 Durable job foundation

- Add a persistent job queue backed by Postgres or a dedicated queue service.
- Use it for reminder dispatch, semantic indexing, digest generation, and scheduled backups.
- Add retries with backoff, deduplication keys, failure visibility, and job health metrics.
- Ensure jobs are timezone-aware and safe to run on more than one API instance.

### 7.2 Notifications

- Server-driven native push notifications
- In-app notification center with read/unread state
- Snooze reminder and reschedule actions
- Notification preferences by category and quiet hours
- Optional daily planning and end-of-day digest
- Local notifications may remain as an offline fallback, but must not duplicate server push

Email notifications are optional and should only be added if the product should take on an SMTP or email-provider dependency.

### Exit criteria

- Reminders arrive when the app is closed.
- Retries do not create duplicate notifications.
- Snoozing updates the underlying reminder consistently.
- Failed jobs are visible and recoverable.

---

## 8. Phase 5 — Resilience, portability, and polish

**Priority:** Medium after the core loop is stable

### 8.1 Backup and portability

This is especially important for a personal system where each user relies on Timely as the source of their own data.

- Full export of tasks, projects, calendar, docs, sheets, settings, and relationships
- Human-readable JSON/Markdown/CSV where practical
- Full backup and tested restore flow
- Scheduled encrypted backups with retention settings
- ICS export for events and scheduled task blocks
- PDF/Markdown export for individual docs

### 8.2 Offline behavior

- Add a network-status banner and explicit stale-data indication first.
- Queue safe native mutations while offline and sync them later.
- Define conflict resolution before enabling offline doc/sheet editing.
- Prefer native offline support over building a PWA unless there is a clear need for installable mobile web.

### 8.3 Accessibility and personalization

- Keyboard navigation and visible focus states across all desktop interactions
- Screen-reader labels and contrast audit
- Reduced-motion support
- Light/system theme only after components use shared design tokens
- Internationalization infrastructure before translating; timezone and locale formatting should not be hard-coded to `en-US`

### Exit criteria

- A complete backup can be restored into a clean installation.
- Temporary loss of connectivity does not create fake data or silent data loss.
- Core workflows pass keyboard and accessibility checks.

---

## 9. Suggested release slices

| Release | Included work | Why it belongs together |
| --- | --- | --- |
| **R1 — Trustworthy Base** | Cross-account isolation, route protection, onboarding fixes, canonical enums, remove demo fallback, critical tests | Establishes privacy, safety, and a dependable data model |
| **R2 — Complete Projects** | Project hub, stage UI, task stage assignment, project deep links, native project editing | Unlocks backend functionality already built |
| **R3 — Faster Task Control** | Kanban drag, bulk actions, expanded filters, archive UI, autosave/error polish | Removes daily interaction friction |
| **R4 — Capture and Execute** | Inbox, quick capture, subtasks/checklists, Today, focus tracking | Completes the personal task lifecycle |
| **R5 — Scheduler v2** | Scheduling controls, explainable preview, revisions/undo, recurring work, capacity | Strengthens the product’s main differentiator |
| **R6 — Awareness** | Durable jobs, push, notification center, snooze, digest | Makes the product useful while closed |
| **R7 — Durable Personal Data** | Export, backup/restore, offline baseline, accessibility, theming/i18n foundation | Protects long-term daily use |
| **R8 — Daily-use polish** | Reminder type, native push permission, docs markdown import, completed-task scheduling, saved-view intent, digest/timezone honesty | Makes the shipped modules match what people actually try to do |

Each release should be independently usable and should ship across the API, desktop web app, and native Android/iOS app with migration, UI, and regression tests. Avoid developing all phases in parallel.

---

## 10. Architecture work that supports the roadmap

### Shared domain services

Move important rules into shared backend services used by HTTP and MCP:

- Task validation and lifecycle
- Project/stage lifecycle
- Recurrence expansion and exceptions
- Schedule preview/apply/revision
- Notification scheduling
- Archive/delete behavior

This prevents the UI, API handlers, and Hermes tools from behaving differently.

### API contracts

- Generate or maintain an OpenAPI contract for the HTTP API.
- Generate typed clients or validate shared schemas for web and native.
- Version breaking API changes.
- Standardize pagination, errors, timestamps, enum casing, and idempotency keys.
- Add optimistic-concurrency fields to high-conflict records such as docs, sheets, working hours, and schedule revisions.

### Client strategy

- Treat desktop web and native as the supported product surfaces. Mobile web (`/m`) was removed.
- Implement every roadmap capability on both desktop and native mobile. Platform-specific layouts are expected, but omitting the native implementation is not considered completion.
- Share domain types, validation, API client behavior, and formula tests where practical, without forcing UI code sharing.

---

## 11. Features to defer

These may be useful eventually, but should not interrupt the phases above:

- In-app Hermes chat, assistant planning, and assistant-driven actions. The existing external Hermes/MCP integration may be maintained, but expanding it inside Timely is deferred.
- External calendar awareness and synchronization, including ICS, Google Calendar, and Outlook. This should be planned separately later.
- Advanced spreadsheet databases, linked records, charts, and multiple sheet views
- Gantt dependency arrows and advanced resource planning
- Travel time and conference-link generation
- Widgets, share sheet, camera, and attachments
- Doc version history and comments
- Advanced analytics and historical reporting
- Full two-way calendar editing
- Theme customization beyond light/dark/system

Attachments deserve a separate storage, security, quota, backup, and mobile-upload design; they should not be added as a small field-level feature.

---

## 12. First implementation backlog

Start with these items in order:

1. Write an architecture decision record declaring Timely a multi-account but non-collaborative personal application.
2. Audit every database query, HTTP handler, MCP tool, search/indexing path, calendar query, and background operation for authenticated-user scoping.
3. Expand route/API authorization tests and protect all app routes.
4. Add automated cross-account isolation tests for every user-owned resource and MCP operation.
5. Confirm that signup remains available after logout and give every new account its own onboarding state.
6. Fix signup name and onboarding redirects across clients.
7. Remove production demo login (already limited to development). The mobile-web fake-data fallback was deleted with `/m`.
8. Canonicalize priority, boolean custom fields, dependency input, and working-hour representation.
9. Audit/remove legacy `scheduleId` safely.
10. Build the Projects list/detail routes.
11. Build stage management and task stage selection.
12. Add Kanban status drag and optimistic rollback.
13. Add task selection and bulk actions.
14. Add doc/sheet archive UI and desktop sheet column types.
15. Design the Inbox/subtask schema and scheduler invariants before migrating data.
16. Add schedule revision storage before expanding scheduler behavior.
17. Introduce the durable job system before server notifications and reliable indexing.

---

## 13. Product success checks

Track whether the roadmap improves actual personal use rather than only increasing feature count:

- Time from opening Quick Add to captured item
- Percentage of inbox items processed
- Percentage of open work with a realistic duration or explicit unscheduled reason
- Auto-schedule preview acceptance rate
- Number of manual corrections immediately after schedule apply
- Tasks completed from the Today view
- Missed/late reminder rate
- Sync/job failure rate
- Undo rate after bulk, assistant, and scheduling operations
- Crash-free and error-free sessions on desktop and native

No team-engagement or collaboration metrics are needed.

---

## Final recommendation

Build **R1 through R5** before expanding the product horizontally. Those releases will turn the current collection of capable features into a coherent personal operating system. The most important new capabilities are Inbox capture, subtasks/checklists, a strong Today/focus experience, and an explainable scheduler with revisions and undo. Durable jobs should then support notifications and reliable indexing. In-app Hermes and external calendar synchronization remain explicitly deferred for a later roadmap.

The central rule for future decisions should be: **does this help each user privately capture, decide, schedule, execute, or review their own work more reliably?** If not, it should not displace the core roadmap.

---

## 14. R8 — Daily-use polish (from live testing)

R1–R7 already shipped most of the original modules. The remaining work is to make those modules mean what their labels say, and to keep desktop + native in lockstep. This slice is the next implementation backlog after the current reminder/docs/schedule fixes.

### 14.1 Still incomplete from Report.md

- Saved views that encode intent: **My Deadlines** should filter to tasks with a deadline or a next scheduled block, not just switch to Gantt.
- Kanban cards and Gantt bars should show **next scheduled block** when `deadline` / `startDate` are empty.
- Report “due in 14 days” should count deadline **or** next engine block.
- Evening digest open-count must match Report, and notification timezone must persist from working hours.
- Inbox **Make task** must write duration, default status, and stay off the main board until clarified.
- Do not auto-apply the engine on every task/subtask create; wait for explicit Auto-schedule.
- Remove or implement Tasks **Create Dashboard** and the ⋯ header button.
- Humanize device session names; hide demo credentials outside development.
- Comment delete; real project activity (not only recently updated tasks).

### 14.2 Shipped in this polish pass

- Reminders are a first-class type (Work / Reminder), not a duration-0 shortcut. Create and detail require a ping time (`Notify at`). A reminder without a ping time is invalid.
- Native notification permission is requested after the first interactive frame (not during splash, which blocked the system dialog). Local reminder schedules fire even when Expo push registration fails, and they are not cancelled on layout remount.
- Docs import `.md` files with the same block model as the editor. PDF download is removed; Markdown export stays. Code blocks use IDE colors plus Copy. Mentions have a toolbar button on mobile. Empty-area taps after save no longer restore the initially loaded document.
- Auto-schedule ignores completed work: no change rows, no raw ids, and completed blocks do not consume free capacity.
- Project overview dates use the shared picker at the same size as Status / Priority.
- Mobile web (`/m`) was removed. Phones use the native Expo app; old `/m` URLs redirect to `/calendar`.

### 14.3 New product needs still open

- Native reminder toasts while the app is in the foreground should deep-link even if the OS banners are quieted.
- Exact-alarm access on Android 14+ may still need a Settings deep-link if the user denied the special app permission.

### 14.4 Explicitly still deferred

- In-app Hermes chat and external calendar sync (Google/Outlook/ICS two-way)
- Doc version history, comments, and images
- Advanced spreadsheet databases, charts, and Gantt drag-resize
- Password-reset email (local admin recovery remains the path unless SMTP is accepted)

### Exit criteria for R8

- A reminder created from Add, Inbox, or native detail produces a calendar ping and a device notification.
- Auto-schedule preview never lists completed tasks or raw `tsk_` ids.
- Importing a Markdown file round-trips headings, lists, code, and tables on desktop and native.
- Tapping empty space in a saved mobile doc does not revert the editor to the previously loaded version.
