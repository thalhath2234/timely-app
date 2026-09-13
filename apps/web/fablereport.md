# Fable follow-up on the Astra web audit

Date: **13 September 2026**. Scope: every finding in [AstraReport.md](AstraReport.md) (A01–A20), fixed across the web app (`timely`) and the API (`timely-api`). This file records what changed, how it was verified, and what I think is still missing or worth changing in the UI beyond the audit's scope.

Verification baseline after the changes: `pnpm exec tsc --noEmit` clean, `pnpm lint` **0 errors** (1 informational warning, see A20), `go build ./... && go test ./...` green, API restarted on :8080, and a browser pass over Tasks / My Deadlines / Kanban / Today / Report / Inbox / Settings / Auto-schedule against the running dev app.

## 1. What was fixed, by finding

| # | Fix | Where | Verified |
|---|---|---|---|
| A01 | Task loader now pages through `/tasks?limit=500&offset=N` until a short page and dedupes across page boundaries. No client sees a silent 200 cap. | `app/utils/api/tasks.ts` | contract: `limit=500` returns full set; UI count matches |
| A02 | Removed `useAutoScheduleAfterChange` from create / bulk-update / event-create. Deleted the hook. Explicit **Apply schedule** in the dialog now feeds the floating status toast instead. | `hooks/tasks.ts`, `hooks/calendar.ts`, `autoScheduleDialog.tsx` | UI: capture produced only `POST /tasks`, no "Placed N tasks" toast |
| A03 | Engine `place()` returns `(blocks, shortfallMinutes)` instead of silently zeroing a leftover `< minChunk`. Proposals carry `requiredMinutes / placedMinutes / shortfallMinutes / partial`; a `partial_placement` risk is emitted; dialog shows "Xm of Ym" and a red "Partially placed" line. Leftover chunks are trimmed so totals land exactly on the estimate (no 2h05m for a 2h task). | `schedule/engine.go`, `schedule/service.go`, `autoScheduleDialog.tsx`, `types.ts` | unit tests `TestPlanReportsPartialPlacement`, `TestPlanBooksLeftoverOnNextDay`, `TestPlanLeftoverNeverOvershoots` |
| A04 | `currentEngineBlocks` now uses the same predicate as `DeleteEngineBlocksInRange`: candidate tasks only, engine source, not locked, not inside the freeze window. Scoped previews no longer list removals Apply never performs. | `schedule/service_helpers.go` | contract: `preview {taskIds:[A]}` → `[pin A]`; B keeps its block after scoped apply; unit test `TestCurrentEngineBlocksMatchesApplyPredicate` |
| A05 | New `LoadError` / `LoadErrorBanner` / `QueryFailure` components. Tasks, Inbox, Projects, Docs list, Sheets list, Report, Today, Calendar and Devices show an explicit failure with **Retry**; stale data stays visible under a banner when present. Report shows one banner per failed feed and never renders "0 open" for a failed task fetch. | `_ui/loadError.tsx` + each page | UI review |
| A06 | Reminder invariant enforced in the service on create **and** update (type conversion, clearing `scheduledOn`, removing a recurrence). | `task/service.go`, `task/validation.go` | contract: `{kind:reminder,duration:0}` → **400**; unit test `TestAssertReminderPing` |
| A07 | Indirect dependency cycles rejected by walking the `blockedBy` chain. | `task/validation.go` | contract: A←B then B←A → **400** with actionable message; unit test |
| A08 | `applyKindUpdate` assigns the workspace default status when an inbox item becomes work. Web: `useUpdateTask` evicts converted items from the Inbox cache and refreshes Today immediately; clarify panel shows a confirmation toast, error text, and a note that the task is not scheduled until asked. | `task/phase2.go`, `hooks/tasks.ts`, `taskExecution.tsx` | UI: item left Inbox instantly, status **Todo**, activity "changed status from None to Todo" |
| A09 | New shared date model `app/utils/taskDates.ts` (deadline → next block → scheduledOn → recurrence anchor → start date). **My Deadlines** now means "open tasks with a deadline or reserved time" via a new `onlyDated` view flag (API default view + `Has date` checkbox). Kanban cards show "Next block: …" when there is no deadline. Gantt uses start/blocks/deadline only and lists undated rows separately instead of drawing bars from `createdAt`. Report `Overdue` uses the same rule as Calendar/Today and `Upcoming` counts deadline **or** next block. Report also ignores inbox items and reminders so its counts match the board. | `taskDates.ts`, `taskFilters.ts`, `tasks/page.tsx`, `kanbanView.tsx`, `report.ts`, `models/config.go`, `agent/tools_views.go` | UI: My Deadlines 15 dated open tasks (was 189 of everything); Report "10 upcoming" (was 0) |
| A10 | Today rewritten: event rows open the calendar's `EventDialog`, reminder rows open the task, focusing panel has a live `m:ss` timer, estimate/over-estimate hint, **Done** and **Reschedule**; focus rows and overdue rows have complete / reschedule actions. | `today/page.tsx` | UI: "AUDIT event" opened the event dialog |
| A11 | Markdown import parses links mid-line and keeps inner marks; fence language aliases normalised (`js`→`javascript`, `py`→`python`, …); code block selector shows unknown languages instead of collapsing to "plain". | `utils/markdown.ts`, `codeBlockView.tsx` | script: `Visit [the **docs**](…)` → link + bold marks; ```` ```js ```` → `javascript` |
| A12 | Service-level validation: trimmed non-blank titles (rune-counted ≤ 200, rejected not truncated), duration `0..9600` minutes, `startDate ≤ deadline` on create and on merged updates, preferred windows must parse and end after start. | `task/validation.go`, `task/service.go` | contract: whitespace name / 100M minutes / inverted dates → **400**; unit tests |
| A13 | Removed the no-op ⋯ and **Create Dashboard**; header now has a real **New task**. "Hide options" actually toggles the options bar. | `tasks/page.tsx` | UI |
| A14 | New `GET /projects/:id/activity`: task activity rows joined to the project's tasks plus a synthetic "created this project" entry. Activity tab shows actor, message, field, old→new; "Recently updated tasks" kept as a secondary list. Header states plainly that project-field edits are not journaled. | `project/repository.go`, `service.go`, `handler.go`, `routes.go`, `projects/[id]/page.tsx` | contract: 5 entries including status / priority / project moves |
| A15 | `GET/PUT /notifications/settings` returns the **effective** timezone (explicit → working hours → UTC); invalid explicit zones are rejected. Evening recap now says "Unfinished from today's plan: N" so it is no longer confused with Report's open count. Settings field explains the fallback. | `notify/service.go`, `notificationSettings.tsx` | contract: fresh account returns `"timezone":"UTC"` instead of `""` |
| A16 | Bulk bar snapshots each selected task's previous values for the fields being changed (status+completedAt, priority, project, labels, deadline) and Undo restores per task. Keyboard `x` complete/undo also restores the task's own status. | `bulkActionBar.tsx`, `keyboardShortcuts.tsx` | code review; mixed selections now round-trip |
| A17 | Postfix `%` in formulas: `=50%` → 0.5, `=200*10%` → 20, `=A2%%` → A2/10000; binds tighter than `^`, looser than unary minus. | `utils/sheetFormula.ts` | script matrix |
| A18 | Icon buttons in the view bar have `aria-label`s and `type="button"`; search input and inbox capture have labels; bulk date input labelled. Inbox "Press C" now works: on `/inbox`, `C` focuses quick capture (elsewhere it still opens the task modal, as documented). | various | UI |
| A19 | Devices list shows "Chrome on Linux", "Python script", etc. with relative last-used time, a **This device** badge, and the raw user agent under an expandable "Technical details". | `utils/deviceLabel.ts`, `accountSettings.tsx` | UI |
| A20 | `pnpm lint` passes with 0 errors. Fixed: setState-in-effect in calendar (now `useSyncExternalStore`), docs page (remote apply moved into the SSE handler), search modal (query state lives inside the mounted panel), auto-schedule dialog (declaration order), Today/Inbox clarify (derived state); ref-in-render in editor and `useDocWatch`; unused vars; memo deps. | many | `pnpm lint` |

Two lint items were handled by policy rather than refactor, and are called out honestly:

- `tasks/page.tsx`: the two "mirror config into local state" effects are wrapped in a scoped `eslint-disable react-hooks/set-state-in-effect` with a comment. The proper fix is the refactor in §3.1.
- `addItem.tsx`: React Compiler's informational warning about react-hook-form's `watch()` remains; converting the modal to `useWatch` is a self-contained follow-up.

## 2. Things I found while working that the audit did not list

- **`formatRelative` on Report** rounded by elapsed hours, so a block at 09:00 tomorrow read "today" at 23:30. Now compares calendar days.
- **Bare `scheduledOn` without a block row** (legacy rows, reminders) was ignored by every "is this scheduled" check except the overdue helper. `taskDates.ts` treats it as a slot when no blocks exist.
- **`useUpdateTask` never added a newly-clarified inbox item to the board cache**, so the task board only saw it after a background refetch. It now inserts the row.
- **`setCurrentDate` in `calendarStore`** ignored its argument and always set `new Date()`. Fixed; nothing currently relied on the bug.
- Astra's fixture rows (`AUDIT capture item`, `AUDIT work task`, `AUDIT event`) are still in the primary account. I left them; my own smoke rows were deleted. Two disposable smoke accounts (`fable-smoke-*@example.com`) exist in the dev DB with no data.

## 3. Missing features and UI changes I recommend

Ordered by how much they would change day-to-day trust in the product.

### 3.1 Tasks page state model (engineering debt that shows in the UI)

The page holds ~20 `useState`s mirrored from the active saved view, hydrates them in an effect, then writes them back with a debounce and a "hydrating" ref to avoid loops. Symptoms users can see: the List/Kanban/Gantt toggle briefly highlights the wrong mode when switching views, and any new filter (like `onlyDated`) has to be threaded through six places. Recommend deriving filter state directly from `activeTaskView` and writing edits straight into the view object (one reducer), then dropping the eslint disables.

### 3.2 Unscheduled work is invisible on the calendar

Calendar's empty-state text says "Deadlines alone do not appear here." That is the documented design, but it means the most important planning question — *what still needs a slot?* — has no surface. Recommend a collapsible **"Waiting for a slot"** rail on the Calendar (count is already computed as `unscheduledCount`) listing open work with no block, sorted by the same ranking the engine uses, with drag-to-place and a one-click "Schedule this" that runs a scoped preview.

### 3.3 Partial placements need a next step, not just a warning

A03 now reports "45m of 60m placed". The dialog should offer the obvious remedies inline: **extend horizon**, **allow splitting** (turn off contiguous / lower min chunk), or **push the deadline**. Today the user reads the risk and has nowhere to click.

### 3.4 Report is a snapshot, not a report

`Report` recomputes from the live task list on every visit; there is no history, so "completion 42%" cannot be compared with last week. Recommend a nightly `report_snapshots` row per user (open / done / overdue / planned minutes) written by the existing job worker, and a small 4-week trend strip at the top of the page. This also gives the evening digest real numbers to compare against.

### 3.5 Project-level activity is still not journaled

A14 shows task changes inside a project. Edits to the project's own title, dates, status, stages and description still leave no trace (the tab says so). Add `project_activities` (same shape as `task_activities`) and record from `projectService.Update`, stage create/rename/reorder/delete, and duplicate. Then the tab can stop apologising.

### 3.6 Bulk undo should be server-side

The bulk bar now snapshots previous values from the client cache, which is correct only for tasks that were loaded. A `PATCH /tasks/bulk` that returns a revision id, plus `POST /tasks/bulk/undo/:revision`, would make Undo exact regardless of cache state and would also cover mixed failures mid-batch (today the loop stops at the first failing id and earlier updates stay applied).

### 3.7 Today needs a "plan tomorrow" moment

End-of-day shows counts and a per-task "Move to tomorrow". Missing: a **Review** action that walks the unfinished list once (keep / move to tomorrow / drop from focus / reschedule), and a morning equivalent that proposes the day's focus from the engine's ranking. That is what makes Today an execution surface instead of a summary.

### 3.8 Smaller UI items

- Kanban cards show "Next block" but not the time-of-day when a card is overdue; use the same red treatment the Report rows use.
- Gantt's "without dates" list would be more useful as a drag source into the timeline (set start / deadline by drop).
- The "Has date" filter label should read **"Dated only"** with a tooltip; "Has date" reads oddly next to "Overdue / Scheduled / Recurring".
- Devices: add a **Sign out everywhere else** button; the list now makes it obvious when stale sessions exist.
- Notification settings: the timezone input is free text with a datalist; a proper zone picker (grouped by region) would prevent the invalid-zone 400 the API now returns.
- Inbox: quick-capture should accept `Enter` to capture and keep focus for rapid entry (it does capture on Enter via form submit, but the toast/confirmation is silent — a subtle inline "Captured" flash would help).
- Auto-schedule dialog: "Also move blocks I placed by hand" resets the applied state; when it is toggled after an apply, show a small note that the preview is now different from what was applied.
- Markdown export splits a link with mixed inner marks into two adjacent links (`[the ](url)**[docs](url)**`). Renders correctly but is ugly; render inner marks inside a single link.

### 3.9 Test coverage I would add next

- API integration tests for: reminder invariant on every mutation path (create, update, bulk, MCP), cycle detection under concurrent edits, `onlyDated` default view seeding for new users.
- Engine property test: for any candidate set, `Σ placedMinutes + Σ shortfall == Σ required` and no block shorter than `minChunk`.
- Web: a Playwright flow that injects a 500 on `/tasks` and asserts the Retry state (the A05 regression), and one for Inbox capture → Make task → row gone from Inbox / present on board.

## 4. Files touched

Web (`timely`): `app/utils/api/tasks.ts`, `app/utils/api/projects.ts`, `app/utils/hooks/{tasks,calendar,docs,projects}.ts`, `app/utils/{taskDates,taskFilters,report,markdown,sheetFormula,deviceLabel,dal}.ts`, `app/_types/types.ts`, `app/_store/calendarStore.ts`, `app/_components/_ui/{loadError,keyboardShortcuts}.tsx`, `app/_components/_ui/modal/search.tsx`, `app/_components/_ui/tasks/{bulkActionBar,kanbanView,taskExecution,tasktable}.tsx`, `app/_components/calendarView/{autoScheduleDialog,autoScheduleIndicator}.tsx`, `app/_components/editor/{richTextEditor,codeBlockView}.tsx`, `app/_components/docs/docList.tsx`, `app/_components/settings/{accountSettings,notificationSettings}.tsx`, pages `tasks`, `today`, `inbox`, `report`, `calendar`, `projects`, `projects/[id]`, `sheets`, `docs/[id]`. Deleted `app/utils/hooks/autoSchedule.ts`.

API (`timely-api`): `internal/features/task/{validation.go,validation_test.go,service.go,phase2.go}`, `internal/features/schedule/{engine.go,engine_test.go,service.go,service_helpers.go}`, `internal/features/project/{repository.go,service.go,handler.go,isolation_test.go}`, `internal/features/notify/service.go`, `internal/features/agent/{tools_views.go,server.go}`, `internal/models/config.go`, `internal/utils/utils.go`, `internal/routes/routes.go`.

Nothing was committed; all changes sit in the working trees alongside the pre-existing uncommitted work.
