# Timely — feature, page, and component audit

**Scope:** web app and Electron desktop only. Mobile is excluded at your request.  
**Source revision:** `65ae32a5dd97adb83f5badc17b6bc6e7dcee0c89`  
**Audit dates:** September 15–16, 2026, Asia/Tokyo. Capture timestamps are recorded individually. Final artifact verification completed September 16.

## Start here

- **[Browse the searchable screenshot gallery](audit/index.html)** — open locally, filter by feature, then open or download full-resolution PNGs.
- **[Complete page and component inventory](audit/component-inventory.md)** — every page source and every file under `app/_components`, including nested component names and screenshot links.
- **[All PNG screenshots](audit/screenshots)** and **[machine-readable screenshot manifest](audit/manifest.json)**.
- **[Capture method and limitations](audit/README.md)**.

This audit combines source inspection, real browser/Electron screenshots, and exercised user flows. “Captured” means a real rendered state was photographed. It does **not** mean every possible operation, date boundary, or failure case has passed an end-to-end test. Simulated failures and redacted content are identified explicitly.

## 1. Coverage and environment

**Deliverables: 185 PNG screenshots, including 13 component crops, 13 dark-mode views, 13 minimum-size desktop views and 3 real Electron captures.** The gallery includes additional scrolled views and error/interaction states.

The source inventory covers **all 17 page files** and **all 67 component files**, plus the shared layouts and Electron shell. Seven component-directory files implement nonvisual behavior; they are linked to the UI they support rather than represented as imaginary screens.

The main captures use Chromium at **1440 × 1000** in light mode. Additional passes cover dark mode, the Electron minimum content size of **900 × 600**, and the actual Linux Electron renderer. PNG dimensions are authoritative; component crops and internally scrolled views have different dimensions. Electron runtime details are in [electron-runtime.json](audit/evidence/electron-runtime.json).

The app ran from this worktree using the existing PostgreSQL database and a **new, dedicated “Design Audit” account** with a “Design Studio” workspace. Sample data includes a staged project, work tasks, a completed task, an inbox item, reminders, recurring work, a subtask, a checklist, comments, documents, mentions, a sheet, and all seven custom-field types. Existing user work was not edited. Sample data was retained to make the audit reproducible; the temporary API key was revoked.

The development overlay was hidden for clean redesign references. A recoverable hydration error was recorded separately instead of being presented as normal app UI. Screenshots come from a development build, not a packaged production release. No application feature code was changed.

## 2. Complete page audit

### 2.1 Landing page — `/`

**Components:** brand mark, top navigation, security badge, hero headline, explanatory copy, primary and secondary calls to action, three feature cards, copyright footer.

**Behavior:** provides entry points to sign-in and registration. It remains a public page even when authenticated.

**Redesign observations:** the security implementation badge and generic “premium” positioning take space that could explain the user’s actual planning workflow. The feature cards mention focus analysis, but the current Report page primarily shows task counts, dates, priorities and links. Align the promise with the real product.

**Screenshot:** [Landing](audit/screenshots/000-landing.png).

### 2.2 Sign-in, registration, onboarding — `/login`, `/signup`, `/onboarding`

**Components:** centered authentication card, decorative blurred accents, email/password inputs, full-name input on registration, submit buttons, loading/error/success text, cross-links, first-workspace name form.

**Exercised:** registration of the audit account; workspace creation; subsequent sign-in in both Chromium and Electron; blank login validation; access to authenticated pages. Registration has a minimum eight-character password check in source. Onboarding validates workspace-name length.

**Redesign observations:** onboarding is visually much simpler than the auth cards and offers little orientation. Standardize form spacing, inline errors and labels. The development login card exposes a seed-account hint; this is development-only UI and should not be copied into production designs. Authentication inputs have visible labels that are not consistently connected programmatically to the inputs.

**Screenshots:** [Login](audit/screenshots/001-login.png), [validation](audit/screenshots/002-login-validation.png), [signup](audit/screenshots/003-signup.png), [onboarding](audit/screenshots/004-onboarding.png).

### 2.3 Shared application shell

**Components:** narrow icon rail; global Add menu; Search; Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications and Settings links; notification count; sign-out; rounded page container; global detail and creation dialogs; toasts; scheduling status; offline banner; skip link.

**Behavior:** task/project links can open a detail overlay in place. Keyboard shortcuts include `C`/`N` for creation, `/` for search, `G` followed by a page key, and task-specific actions. The Inbox repurposes `C` to focus quick capture. Shortcut behavior is context-sensitive.

**Redesign observations:** icons have accessible names but the rail offers little visible explanation to new users. Add optional labels or useful tooltips. The visual language varies between pill controls, square icon buttons, black buttons and purple buttons. Define common sizes and primary/secondary/destructive roles.

**Screenshots:** [Add menu](audit/screenshots/030-global-add-menu.png), [Search](audit/screenshots/037-search-empty.png), [results](audit/screenshots/038-search-results.png), [no matches](audit/screenshots/039-search-no-results.png), [offline banner](audit/screenshots/102-offline-banner.png).

### 2.4 Today — `/today`

**Components:** date heading, inbox count, star-priority control, Today Focus section and seven-slot picker, completion/remaining-time summary, task focus card, timer/start/stop, schedule timeline and event cards, reminders, overdue list, end-of-day metrics, Plan Tomorrow, Evening Shutdown, floating inbox-review prompt, shortcut hints.

**Exercised:** empty and populated views; a starred task; focus start/stop; focus picker; evening shutdown with no unfinished work; reminder display. Source behavior for shutdown is to move unfinished work to tomorrow’s focus list, with Undo; there is no separate reflection-writing wizard.

**Redesign observations:** this page has the clearest hierarchy in the app but mixes task focus, calendar time, reminders and deadlines. Keep their meanings distinct. Floating bottom prompts can compete with lower-page actions on small windows. “Unfinished” is not the same measure as “open tasks” or “unfinished starred tasks”; explain its scope.

**Screenshots:** [Empty](audit/screenshots/006-today-empty.png), [populated](audit/screenshots/014-today-populated.png), [running focus](audit/screenshots/065-focus-running.png), [shutdown feedback](audit/screenshots/066-evening-shutdown.png), [focus picker](audit/screenshots/067-today-focus-picker.png).

### 2.5 Inbox — `/inbox`

**Components:** explanatory heading, quick-capture text input, Capture button, inbox rows, Review action, empty state and task-list link. Review opens the shared task editor.

**Behavior:** an inbox item has no workspace and is excluded from auto-scheduling. Assigning a workspace makes it work; selecting Reminder changes its intent. The detail editor exposes these choices.

**Redesign observations:** keep capture lightweight, but make the next triage action prominent. A reviewed inbox item currently opens the large editor with execution, subtasks and metadata, which is substantially denser than the inbox itself.

**Screenshots:** [Empty](audit/screenshots/007-inbox-empty.png), [populated](audit/screenshots/015-inbox-populated.png), [review overlay](audit/screenshots/068-inbox-review.png).

### 2.6 Tasks — `/tasks`

**Components and modes:**

- Header totals, options toggle and New task.
- Saved views: Task List, My Deadlines, Overview, Project Timelines; add, rename and delete controls.
- List, Kanban and Gantt renderers; task/project data modes.
- Up to three grouping levels, manual group ordering and group direction.
- Sort field/direction; workspace and status selectors; overdue, completed, scheduled, recurring and dated-only filters; project, priority, label and stage filters.
- Wide table with selection, hierarchy rows, collapse/expand, draggable column order, dates, duration, project/workspace, dependency, priority, stage, status, labels and custom fields.
- Kanban status lanes and draggable cards; Gantt dated and undated work.
- Bulk complete/reopen, metadata changes, move and delete actions with appropriate undo behavior where implemented.
- Footer sync text, result count and shortcut hints.

**Exercised:** all three renderers; grouping and filter panels; saved-view creation and rename mode; row selection; detail opening; successful task creation from the UI and read-back through the API; creation validation; task subtask/checklist/comment creation; scheduling apply and undo. Dragging, all filter combinations, and every bulk-operation permutation are not certified by this audit.

**Redesign observations:** the default table exposes a very large number of columns and several horizontal toolbar rows before the first task. Add a deliberate default column set, a visible column chooser and progressive disclosure. Distinguish persisted view settings from temporary filters. Preserve the useful list/Kanban/Gantt alternatives while aligning their card and metadata styles.

**Screenshots:** [Empty](audit/screenshots/008-tasks-empty.png), [list](audit/screenshots/016-tasks-populated.png), [Kanban](audit/screenshots/046-tasks-kanban.png), [Gantt](audit/screenshots/047-tasks-gantt.png), [grouping](audit/screenshots/049-task-group-menu.png), [group order](audit/screenshots/050-task-group-sort.png), [status filter](audit/screenshots/051-task-status-filter.png), [workspace filter](audit/screenshots/052-task-workspace-filter.png), [bulk bar](audit/screenshots/053-task-bulk-actions.png), [new view](audit/screenshots/054-task-new-view.png), [rename](audit/screenshots/055-task-rename-view.png).

### 2.7 Shared task/project detail and creation components

**Creation modes:** Task, Event, Workspace, Project, Doc and Sheet. Work and Reminder share the task flow. Each has its own appropriate name/title, description and properties.

**Detail composition:** header/breadcrumbs, editable title, author/date, rich-text description, completion, duplicate/copy-link/delete actions, focus controls, Today toggle, subtasks/checklist progress, activity feed/comment composer, property sidebar, autosave state, footer hints.

**Properties:** workspace, project, status, stage, priority, duration presets, start/deadline, recurrence, manual/automatic scheduling, pinned/contiguous work, minimum/preferred chunks, earliest start, preferred windows, labels, custom fields, dependencies. Reminder detail replaces work scheduling with notification timing. Recurrence supports presets and custom interval, weekday/date/month and end conditions.

**Custom fields:** text, number, URL, date, boolean, select and multi-select. Settings and inline creation expose related builders. Screens include the control variants, option lists and builder state.

**Redesign observations:** the large modal and independently scrolling property sidebar hide important controls below the fold. Separate essentials from advanced scheduling. Label the distinction between “saved”, “saving”, “unsaved” and “failed”; a static “Synced with Cloud” caption is not sufficient. Ensure nested menus handle Escape before the parent dialog. Provide a reliable focus trap and accessible modal title.

**Screenshots:** [Task create](audit/screenshots/031-create-task.png), [event create](audit/screenshots/032-create-event.png), [workspace create](audit/screenshots/033-create-workspace.png), [project create](audit/screenshots/034-create-project.png), [doc create](audit/screenshots/035-create-doc.png), [sheet create](audit/screenshots/036-create-sheet.png), [detail crop](audit/screenshots/057-task-detail-component.png), [status select](audit/screenshots/058-status-select.png), [recurrence presets](audit/screenshots/059-recurrence-options.png), [custom recurrence](audit/screenshots/060-recurrence-custom.png), [execution/activity](audit/screenshots/062-task-checklist-subtask-activity.png), [advanced properties](audit/screenshots/063-task-schedule-custom-fields.png), [delete confirmation](audit/screenshots/064-delete-confirmation.png), [reminder](audit/screenshots/069-reminder-detail.png), [inline builder](audit/screenshots/111-inline-custom-field-builder.png), [all field types](audit/screenshots/181-all-custom-field-controls.png).

### 2.8 Calendar — `/calendar`

**Components:** period title and previous/next/today controls, Day/Week/Month/Agenda switcher, status legend/counts, timed grid, month cells and overflow counts, agenda rows, waiting-for-slot rail, Add dialog, event detail, manual task scheduling, date/time picker, recurrence controls, auto-schedule preview and result indicator.

**Auto-schedule UI:** plan horizon, available/planned capacity, per-day capacity disclosure, changes, proposed blocks, deadline/capacity risks, unplaced work, apply/undo and manual-block inclusion. Task-scoped scheduling and advanced constraints also exist.

**Exercised:** all four views; empty/populated states; task/event Add tabs; date/time picker; event editor; preview; Apply schedule; Undo last apply; apply again and resulting calendar blocks. Calendar items came from real API entities and scheduling results.

**Redesign observations:** distinguish events, reminders, reserved work and deadlines consistently. The waiting rail and preview dialog are important recovery tools and should remain prominent. The preview can become a long scroll of proposals; summarize capacity and conflicts before the detailed list. Date-picker Escape currently closes the enclosing calendar dialog as well.

**Screenshots:** [Month](audit/screenshots/021-calendar-month.png), [Week](audit/screenshots/022-calendar-week.png), [Day](audit/screenshots/023-calendar-day.png), [Agenda](audit/screenshots/024-calendar-agenda.png), [manual scheduling](audit/screenshots/025-calendar-add.png), [date/time picker](audit/screenshots/026-date-time-picker.png), [new event](audit/screenshots/027-calendar-new-event.png), [preview](audit/screenshots/028-auto-schedule-preview.png), [event detail](audit/screenshots/029-event-detail.png), [applied](audit/screenshots/114-auto-schedule-applied.png), [undo](audit/screenshots/163-auto-schedule-undone.png), [result indicator](audit/screenshots/164-schedule-result-indicator.png).

### 2.9 Projects — `/projects`, `/projects/[id]`

**Project index:** title, New project, empty state, project cards with workspace/color, priority, description, open/completed totals, start and deadline.

**Project hub:** back link, title/autosave, release-cycle badge, complete/duplicate/delete; Overview, Tasks, Stages and Activity tabs. Overview has description and summary cards, status/priority/date/color fields. Tasks uses the shared toolbar and renderers. Stages includes enable/disable, stage creation, rename/color/delete, progress, stage order and per-stage task creation; the board shows unstaged and staged lanes. Activity shows task changes and recent tasks.

**Exercised:** index; all four tabs; stage rename state. A staged project, stage and associated tasks were created as sample data.

**Confirmed inconsistency:** Overview displayed **1 open / 0% progress**, while Tasks showed **5 tasks** and the stage displayed **1/5 completed (20%)**. The same project index had shown four open tasks. `projectStats()` prefers embedded `project.tasks` when nonempty, whereas the tab uses the separately loaded task collection. Investigate incomplete or inconsistent embedded task payloads before reusing these summary cards.

**Redesign observations:** “Active Release Cycle”, “Release phases”, “future sprints” and raw task/project IDs impose software-release language on a general planning app. Use neutral stage language or make terminology configurable. Align overview counts and stage counts before polishing their visuals.

**Screenshots:** [Index](audit/screenshots/017-projects-populated.png), [Overview](audit/screenshots/070-project-overview.png), [Tasks](audit/screenshots/071-project-tasks.png), [Stages](audit/screenshots/072-project-stages.png), [Activity](audit/screenshots/073-project-activity.png), [rename stage](audit/screenshots/117-stage-rename.png).

### 2.10 Documents — `/docs`, `/docs/[id]`

**Components:** collapsible document tree/list, search, archive visibility, Markdown import, recent cards, document breadcrumb, favorite/archive/delete/export, emoji picker, editable title, word count, save status, rich-text editor and contextual tools.

**Editor inventory:** paragraphs; headings 1–3; bold/italic/strike/inline code/highlight; bullet/numbered/task lists; quote; code block with language selection/copy; divider; tables with row/column/header/merge controls; links; entity mentions; slash-command and mention suggestions. Documents can have child pages. Mention chips link docs, sheets, tasks and projects; Report summarizes cross-links.

**Exercised:** populated parent/child docs; editing and autosave; slash and mention menus; actual mention insertion; table/code/link tool states; favorite; icon selector; collapsed sidebar; delete confirmation; missing-document state. The deletion confirmation includes child-page count.

**Redesign observations:** persistent toolbar, contextual toolbar and slash menu overlap in purpose. Keep shortcuts while making a clear primary editing path. The icon picker stayed open after Escape and while interacting with the editor, unlike other popovers. Destructive document confirmation is an inline popover rather than the shared alert dialog.

**Screenshots:** [Index](audit/screenshots/018-docs-populated.png), [editor](audit/screenshots/080-document-editor.png), [icons](audit/screenshots/081-document-icon-picker.png), [slash menu](audit/screenshots/082-editor-slash-menu.png), [mention menu](audit/screenshots/083-editor-mention-menu.png), [favorite](audit/screenshots/084-document-favorite.png), [delete](audit/screenshots/085-document-delete-confirm.png), [table tools](audit/screenshots/105-editor-table-tools.png), [code block](audit/screenshots/106-editor-code-block.png), [link](audit/screenshots/107-editor-link-popover.png), [mention chip](audit/screenshots/183-mention-chip.png), [missing document](audit/screenshots/104-document-not-found.png).

### 2.11 Sheets — `/sheets`, `/sheets/[id]`

**List/detail shell:** collapsible sheet list, search, archive toggle, recent cards, CSV import, formula examples, breadcrumb, title/icon, favorite, duplicate, CSV export, archive, delete, Share and rich-text description.

**Grid inventory:** editable cells, row/column headers, column naming and types, selection/ranges, formula input, computed values, resize/reorder behaviors, fill handle, add/delete rows/columns, tabs, undo/redo, clipboard shortcuts, formatting, merge, filter/sort, simple chart, print, zoom and selection statistics.

**Formatting:** number/currency/percent, decimal places, font family/size, bold/italic/underline/strike, foreground/background colors, borders, horizontal alignment, wrap, link and note. Types include text, number, currency, percent, formula, date and checkbox. Function chooser covers the supported formula library.

**Exercised:** sample formulas `=B1*2`, `=B2*2`, `=B3*2` rendered **24, 16, 8**; the full toolbar and its menus; filter/sort panel; chart state; column-type menu. Formula edge cases, all range operations, large-grid performance, print output and every import/merge permutation were not exhaustively tested.

**Redesign observations:** two editing toolbars and a large description area leave less space for the spreadsheet. Consider a collapsible description and grouped toolbar. Small icon-only controls and tiny type badges need accessible names, usable target sizes and tooltips. “Share” currently copies the current URL; it does not grant access. Label it “Copy link” or explain the access requirements.

**Screenshots:** [Index](audit/screenshots/019-sheets-populated.png), [grid](audit/screenshots/086-sheet-editor.png), [zoom](audit/screenshots/087-sheet-zoom.png), [number format](audit/screenshots/088-sheet-number-format.png), [font](audit/screenshots/089-sheet-font.png), [size](audit/screenshots/090-sheet-font-size.png), [text color](audit/screenshots/091-sheet-text-color.png), [fill](audit/screenshots/092-sheet-fill-color.png), [borders](audit/screenshots/093-sheet-borders.png), [link](audit/screenshots/094-sheet-insert-link.png), [note](audit/screenshots/095-sheet-note.png), [functions](audit/screenshots/096-sheet-functions.png), [filter/sort](audit/screenshots/097-sheet-filter-sort.png), [chart](audit/screenshots/098-sheet-chart.png), [column types](audit/screenshots/119-sheet-column-types.png).

### 2.12 Report — `/report`

**Components:** completion percentage, open/completed/overdue/project/doc/sheet metrics, overdue items, priority distribution, upcoming work, projects with open work, workspace totals, mention links and recent updates. Entities link back into their detail/editor surfaces.

**Exercised:** empty and populated reports; cross-link display after inserting a real task mention into a document.

**Redesign observations:** use consistent definitions for work counts across Report, Today and Projects. Improve scannability with fewer competing card headings. Report is a snapshot of work rather than a full historical analytics dashboard; reflect that in page copy and navigation.

**Screenshots:** [Empty](audit/screenshots/012-report-empty.png), [populated](audit/screenshots/020-report-populated.png), [mentions](audit/screenshots/184-report-mentions.png).

### 2.13 Notifications — `/notifications`

**Components:** introduction, Mark all read, notification cards, title/body/type/time, unread state, Mark read, Snooze 15m, Snooze 1h and Tomorrow 9:00, empty/error/loading states.

**Exercised:** an actual scheduled reminder produced a notification; populated cards; 15-minute snooze; Mark all read. Snooze updates the reminder rather than merely hiding the card. OS-level delivery while the app is closed was not independently verified.

**Redesign observations:** separate unread/read/snoozed states more clearly. A snoozed card remains in the list; expose its next notification time so the result is obvious. Align the notification type/time typography with other activity feeds.

**Screenshots:** [Empty](audit/screenshots/013-notifications-empty.png), [populated](audit/screenshots/115-notifications-populated.png), [snoozed](audit/screenshots/116-notification-snoozed.png), [read](audit/screenshots/185-notifications-read.png).

### 2.14 Settings — `/settings`

Six sections share a secondary sidebar. Each supports direct initial selection through `?tab=…`; changing tabs within the page does not update the URL in the current implementation.

| Section | Components and capabilities | Capture |
| --- | --- | --- |
| Account | Name/email form; current/new password; save; device list; last-used/sign-in time; technical details; per-device sign-out | [Account](audit/screenshots/040-settings-account.png) |
| Schedule | Timezone; daily working windows; day-off/add-hours; split/remove window; weekly capacity; copy Monday; save; buffer; freeze; excluded workspaces | [Schedule](audit/screenshots/041-settings-schedule.png) |
| Notifications | Reminder/digest/planning toggles; morning/evening times; quiet hours; timezone; save; background job health and failed-job retry | [Notifications](audit/screenshots/042-settings-notifications.png) |
| Workspaces | Workspace selector/name/color; Status, Labels and Custom fields tabs; named-color editors; default status; add/edit/delete fields and options | [Name](audit/screenshots/043-settings-workspaces.png), [statuses](audit/screenshots/075-workspace-status.png), [labels](audit/screenshots/076-workspace-labels.png), [fields](audit/screenshots/077-workspace-custom-fields.png), [field editor](audit/screenshots/078-custom-field-edit.png), [types](audit/screenshots/079-custom-field-types.png) |
| Data & appearance | System/light/dark; full JSON, tasks CSV, calendar ICS; encrypted server backups; schedule/interval/retention; create/download/delete; restore file input | [Data](audit/screenshots/044-settings-data.png), [created backup](audit/screenshots/101-backup-created.png) |
| Integrations | Named personal API key; one-time secret reveal; copyable Hermes MCP configuration; key metadata; revoke | [Empty](audit/screenshots/045-settings-integrations.png), [created key, redacted](audit/screenshots/100-api-key-created-redacted.png) |

**Exercised:** section navigation, workspace subpanes, color/type selectors and field-edit mode; theme switching; actual API-key create/revoke; backup creation; all three export endpoints returning successful nonempty content. The browser emitted a download event, but its temporary file was not readable from the capture process; export response status, type and size were checked separately in [export-checks.json](audit/evidence/export-checks.json). Restore was not applied. Password changes, device revocation and failed background-job retries were not applied.

**Redesign observations:** the secondary sidebar uses two lines per tab and consumes meaningful width. Group settings by user intent. Keep advanced scheduler and background-job controls understandable without requiring API knowledge. Destructive actions mix custom dialogs, inline confirmations and native `window.confirm`; standardize their presentation and keyboard behavior.

### 2.15 Electron desktop

The desktop renderer uses the same web routes and components. The shell adds a window, minimum size, native application menus, external-link handling, a platform/version bridge, single-instance behavior and startup failure messaging. It starts a bundled Next.js server when packaged, or uses a supplied renderer URL in development.

**Exercised:** real Linux Electron launch against the audit server; sign-in; Today and Tasks rendering. Captured runtime: Electron **44.3.0**, Chromium **152.0.7977.78**. This is the installed runtime; package version declarations may differ.

**Not runtime-verified:** packaged installer/startup, missing-server dialog, OS menu screenshots, macOS/Windows menus and lifecycle, multi-window behavior and external-link launch. These were inventoried from source. Renderer screenshots do not include OS title bars or menus. A final native-menu capture attempt under Xvfb could not locate the application window; no native-menu images are claimed.

**Screenshots:** [Electron login](audit/screenshots/160-electron-login.png), [Today](audit/screenshots/161-electron-today.png), [Tasks](audit/screenshots/162-electron-tasks.png).

## 3. Shared visual system audit

| Area | Current pattern | Redesign direction |
| --- | --- | --- |
| Color | Semantic light/dark tokens; violet primary; green success; amber warning; red destructive; arbitrary workspace/label colors | Preserve semantic roles and test arbitrary label colors in both themes |
| Typography | Geist/system sans, mono for shortcuts/data; many 10–12px metadata labels | Define a small text scale and a readable minimum for essential controls |
| Navigation | Icon rail, settings sidebar, doc/sheet list panes, page tabs and saved-view tabs | Make hierarchy and active locations obvious without relying only on color |
| Buttons | Purple and near-black primary actions, outlined controls, icon-only actions, chips | One primary hierarchy; consistent height, radius, disabled and focus states |
| Forms | Custom Select, native select, date/time popover, plain inputs, property-row inputs | Align label placement, error presentation, required indicators and keyboard behavior |
| Cards | Rounded cards, border-only rows, tinted panels, pills and modal surfaces | Reuse a small set of surfaces while keeping meaningful feature differences |
| Tables/boards | Dense rows, nested groups, horizontally scrolling boards/grids | Provide explicit overflow cues and useful defaults; retain keyboard access |
| Dialogs | Large two-pane entity dialog, compact calendar dialogs, search overlay, alert dialog, inline delete confirmations | Consistent focus, Escape, backdrop, stacking and destructive-action rules |
| Feedback | Inline errors, empty states, save badge, cloud/sync captions, toasts, scheduler status, offline banner | Distinguish saved/pending/failed/offline and ensure visible recovery actions |
| Themes | Persisted system/light/dark preference | Preserve state parity; verify colors, focus and contrast under each theme |

## 4. Findings and priorities

These are audit findings, not fixes applied to the product.

| ID | Priority | Evidence and impact | Recommended action |
| --- | --- | --- | --- |
| F01 | High | Project Overview showed 1 open / 0%, while the same project's Tasks and Stages showed 5 tasks / 20%. [Overview](audit/screenshots/070-project-overview.png), [Stages](audit/screenshots/072-project-stages.png) | Unify count inputs and test embedded versus separately loaded task collections |
| F02 | High | The shared entity modal has `aria-modal` but no accessible title wiring or implemented focus trap in its shell; several visible form labels are not programmatically associated | Add accessible dialog naming, focus entry/containment/return and connected labels; verify with keyboard and assistive technology |
| F03 | Medium | Calendar Add → date picker → Escape dismissed the parent dialog as well | Stop the inner close event before the parent handles Escape; preserve the draft |
| F04 | Medium | Document icon picker remained open after Escape and during editor interaction. [Slash menu capture](audit/screenshots/082-editor-slash-menu.png) shows both controls open | Standardize outside-click and Escape handling across popovers |
| F05 | Medium | Direct workspace-settings load produced a recoverable hydration mismatch. The UI recovered, but server/client trees differed | Investigate cache-dependent initial render; see [diagnostic](audit/evidence/workspace-console-error.txt) |
| F06 | Medium | Default task view renders many columns and several toolbar rows; small desktop windows expose little work at once | Introduce default visible columns, compact filters and explicit horizontal-scroll affordances |
| F07 | Low | `C` creates a task globally, focuses quick capture in Inbox, and marks complete inside a detail panel; the local detail handler does implement the advertised action | Keep the shortcuts but expose their context clearly in help and hints |
| F08 | Medium | Project UI contains release/sprint terminology and raw IDs in a general planning workflow. [Stages](audit/screenshots/072-project-stages.png) | Use project-neutral copy and hide technical identifiers from primary UI |
| F09 | Medium | Destructive actions use three different confirmation styles, and autosave feedback coexists with static sync captions | Standardize confirmation and persistence feedback before redesigning variants |
| F10 | Low | Landing copy promotes implementation details and analytics beyond the current snapshot report | Explain the current planning benefits and align feature claims |
| F11 | Low | Settings tabs change content without updating the query string | Keep route state and selected section synchronized so refresh/bookmark/back behavior is predictable |
| F12 | High | At 900×600, the sheet description and wrapped toolbars leave roughly one fully visible data row. [Minimum-size sheet](audit/screenshots/149-desktop-min-sheet.png) | Collapse the description, group toolbar actions and reserve usable grid height |

**Responsive and accessibility evidence:** [900×600 layout checks](audit/evidence/desktop-layout-checks.json) record document overflow and inputs lacking an obvious label association. These are targeted checks, not a WCAG conformance assessment. The gallery's `desktop min` and `dark` filters show the visual evidence.

## 5. Feature exercise ledger

| Flow | Result / exact scope |
| --- | --- |
| Register → first workspace → authenticated pages | Completed on dedicated account |
| Login | Completed in browser and real Electron |
| Main routes | All 17 page implementations inventoried and captured, including public landing and dynamic detail pages |
| Create task | Submitted through UI; confirmed task persisted through API read-back |
| Task detail | Opened; checklist item, subtask and comment created; recurrence controls exercised |
| Focus | Started and stopped; running timer captured |
| Views | List/Kanban/Gantt switched; saved view created; rename state captured |
| Selection/filter configuration | Bulk selection, completion and Undo exercised; filter/group panels captured; not every mutation combination tested |
| Scheduling | Previewed, applied, undid, reapplied; resulting blocks captured |
| Calendar | Day/Week/Month/Agenda, Add tabs and event detail captured |
| Projects | Index and all four detail tabs; stage rename mode |
| Docs | Edit/autosave, favorite, slash/mention/table/code/link states; actual mention reflected in Report |
| Sheets | Populated grid and calculated formula values; formatting/type/filter/chart controls |
| Notifications | Actual reminder generated; snooze and mark-all-read exercised |
| API key | Created; secret redacted before capture; key revoked |
| Backup/export | Server backup created; JSON/CSV/ICS endpoints returned HTTP 200 with nonempty appropriate content |
| Failure recovery | Task endpoint deliberately returned 503 in browser interception; error UI captured; interception removed; Retry recovered real tasks |
| Offline | Browser offline state toggled; banner captured; connectivity restored |
| Theme/size | Light/dark and 900×600 passes; see per-image manifest |

## 6. Boundaries and follow-up verification

The audit is complete as a **page/component inventory and redesign reference**, with the following testing boundaries made explicit:

- It is not a full regression suite. Every drag-and-drop path, formula, recurrence/DST boundary, undo permutation and large-data case has not been proven.
- Account password changes, logout of other devices, destructive restore, permanent deletion of the main sample entities, native OS dialogs, installer packaging and background notification delivery while closed were not executed as part of the visual pass.
- The failed-job list was empty. Failed-job retry, capacity exhaustion, token expiry and all server error permutations are inventoried but not all photographed as real naturally occurring states.
- The task error screenshot is deliberately simulated. Offline is browser-emulated. All other primary page data came from the running app/API. No mock page designs were substituted.
- Large desktop, minimum desktop and dark-mode captures are representative, not every viewport/theme/state cross-product. Mobile was excluded.
- Dates, focus counters, notification timestamps and scheduling proposals reflect capture time. The audit resumed later the same day, so screenshots intentionally show changing sample state rather than one frozen database snapshot.

## 7. Suggested redesign sequence

1. **Correct shared behavior:** project totals, dialog focus/Escape, labels, hydration and honest save states.
2. **Define foundations:** type scale, color roles, spacing, control sizes, focus styles, dialogs, popovers and feedback states.
3. **Unify shell and forms:** navigation, search, creation and detail. These affect nearly every page.
4. **Simplify task and calendar workflows:** essential properties first; advanced grouping/scheduling on demand.
5. **Align projects, docs and sheets:** shared navigation/headers while preserving their useful specialized editors.
6. **Refine Today, Report and Settings:** consistent metrics, clearer action outcomes and responsive layouts.
7. **Verify parity:** light/dark, minimum desktop, keyboard, empty/loading/error/populated states and Electron packaging.

Use the screenshot gallery as the before-state library. Keep source mappings from the component inventory when naming redesign frames, so each design has an identifiable implementation target.
