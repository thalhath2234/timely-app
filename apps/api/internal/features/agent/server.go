package agent

import (
	"errors"
	"net/http"
	"reflect"
	"time"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/event"
	"timely-api/internal/features/notify"
	"timely-api/internal/features/portability"
	"timely-api/internal/features/project"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const actorHermes = "Hermes"

type Deps struct {
	Auth       auth.AuthService
	Tasks      task.TaskService
	Projects   project.ProjectService
	Workspaces workspace.WorkspaceService
	Events     event.EventService
	Calendar   calendar.Service
	Schedule   schedule.Service
	Docs       doc.DocumentService
	Sheets     sheet.SheetService
	Search     search.Service
	Notify     *notify.Service
	Jobs       *jobs.Queue
	Portable   *portability.Service
}

type Server struct {
	Deps
	catalog Catalog
	actor   string
}

// SheetFormulaHelp is shared by external MCP and the in-app tool catalog.
const SheetFormulaHelp = "Formulas start with = and use same-tab A1 coordinates (data starts at row 1, headers excluded). Supported ranges: N2:N21 (bounded), N:N (whole column), 2:2 (whole row), N2:N (row 2 onward), B2:2 (column B onward). Whole/open ranges include future rows or columns. Use SUM to add ranges: =B5+SUM(N2:N), not =B5+N2:N. SUM, AVERAGE, MIN, MAX, PRODUCT, COUNT and COUNTA accept ranges. Date helpers: TODAY(), DATE(y,m,d), YEAR, MONTH, DAY, WEEKDAY(date[,type]) (1=Sun..7=Sat; type 2 = 1=Mon..7=Sun), DAYS(end,start), TEXT(value,format) with date tokens dddd/ddd (weekday name), mmmm/mmm (month name), yyyy, mm, dd. =TEXT(A1,\"dddd\") gives the weekday of a date cell. Keep the formula cell outside its own range to avoid #CYCLE!. Cross-tab references are unsupported. Formulas are stored verbatim and evaluated by the web/desktop/mobile clients; tool responses contain raw formulas, not calculated results. Existing positional references are not automatically rewritten after structural edits."

func New(deps Deps) *mcp.Server {
	s := &Server{Deps: deps}
	server := mcp.NewServer(&mcp.Implementation{Name: "timely", Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: `Timely personal productivity MCP. Call get_context first.

IDs: usr_, ws_, pr_, tsk_, evt_, doc_, sht_, tst_ (status), lbl_, stg_, cf_, blk_, rr_, view_, ntf_, job_.
Dates are ISO-8601. Recurrence is an RFC 5545 RRULE (FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH).
Recurring tasks expand on the calendar; complete an occurrence with edit_task_occurrence, not complete_task.
Docs and descriptions accept markdown: CommonMark + GFM (tables, task lists), ==highlight==, $inline math$ and $$ display math $$ blocks, > [!NOTE]/[!TIP]/[!IMPORTANT]/[!WARNING]/[!CAUTION] callouts (optional title after the marker), [^1] footnotes with [^1]: definitions, --- frontmatter at the top (key: value lines, shown as page properties), [[Page title]] and [[Page title|alias]] links to other docs by title, and fenced blocks that render: mermaid (diagrams), geojson/topojson (maps), stl (3D models; build them with add_3d_model, and an STL "solid <name> #rrggbb" line colors that part). get_doc returns the same syntax, so edit what it gives back. Mentions: [@Label](timely://task/<id>) (also project, doc, sheet); subpage links: [Title](timely://doc/<id>).
Reminders fire as server jobs even when the UI is closed. snooze_reminder moves the underlying reminder. Quiet hours still write the in-app row and delay push. Failed jobs are listed with list_jobs and recovered with retry_job.

Projects can have ordered stages (stg_). Move cards with move_task_to_stage (empty stageId = Unstaged) or move_task_to_status for kanban.
When the user asks to create Work, ask which workspace to use unless the user specified one in that request. Do not infer the workspace from get_context or previous tasks. Work tasks default to 30 minutes when the user does not specify a duration; use the user's duration when supplied. Use capture_inbox_item only when the user asks to capture a thought for Inbox. Reminders use kind=reminder and a ping time; list them with list_tasks reminders=true. Inbox items are not auto-scheduled until clarify_inbox_item.
Checklist items are lightweight completion text on a task and are not scheduled.
Today: get_today, set_today_focus, start_focus/stop_focus (actualMinutes is focused time, separate from duration).
Duplicate with duplicate_task / duplicate_project (checklist copied; no blocks/completion).
Auto-schedule v2: preview shows add/move/remove/pin, skip messages, capacity, and deadline risk. Recurring work occurrences in the horizon are placed without creating extra task rows. Frozen hours, locked tasks, and manual pins stay put. undo_schedule reverts the last apply. Scores from what_next and the engine are ordering hints, not certainty.
bulk_update_tasks applies one patch to many tasks: complete/reopen, status, priority, project, stage, deadline, and labelIds (replaces the full set; [] clears). It never schedules; place tasks one at a time with schedule_task.
Archive docs/sheets with archive_doc / archive_sheet (archived=false unarchives). list_docs/list_sheets archived=true lists the archive. Prefer archive over delete.
Sheet columns are text, number, date, boolean, currency, percent, formula, or select (dropdown with options); update_sheet_cells coerces literal values to the column type and appends unknown select values to the options. A sheet is a workbook of tabs; the first tab is the primary grid and is renamed with rename_sheet_tab (tabId empty). ` + SheetFormulaHelp + `
Saved views can filter by project, priority, labels, stage, completed, overdue, scheduled, recurring, and showReminders. renderMode is list, kanban, or gantt.
Destructive deletes of a workspace, project, or document require confirm=true. Deleting a doc does not cascade to subpages; the tool reports descendantCount.`,
	})
	s.register(server)
	return server
}

func Handler(mcpServer *mcp.Server, verifier mcpauth.TokenVerifier) http.Handler {
	stream := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return mcpServer
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	return mcpauth.RequireBearerToken(verifier, &mcpauth.RequireBearerTokenOptions{
		AllowMissingExpiration: true,
	})(stream)
}

func (s *Server) register(server *mcp.Server) {
	registerTool(s, server, &mcp.Tool{Name: "get_context", Description: "User, workspaces (statuses, labels, custom fields), projects with stages and open/done counts, working hours, saved views, and current time. Call this first."}, reads, s.getContext)
	registerTool(s, server, &mcp.Tool{Name: "search", Description: "Keyword search over tasks, projects, docs, sheets, and events: exact title first, then title prefix, title substring, body substring. No embeddings. key:value terms (status:draft, tags:travel, owner:\"Sam Lee\") keep only docs whose properties (frontmatter) match."}, reads, s.search)
	registerTool(s, server, &mcp.Tool{Name: "semantic_search", Description: "Hybrid search across tasks, projects, docs, sheets, and events: keyword and embedding hits fused, so exact titles and related meaning both rank. Prefer this for most lookups; falls back to keyword-only when no embedding provider is set. Returns ranked chunks; follow with get_task/get_doc/… for the full record. key:value terms (status:draft, tags:travel) keep only docs whose properties (frontmatter) match; doc properties are also embedded."}, reads, s.semanticSearch)
	registerTool(s, server, &mcp.Tool{Name: "reindex_search", Description: "Rebuild the user's search index (same as POST /search/reindex). Use after bulk imports or if semantic results look stale."}, mcpOnly, s.reindexSearch)
	registerTool(s, server, &mcp.Tool{Name: "get_agenda", Description: "Calendar items, overdue tasks, and unscheduled work for a day or week."}, reads, s.getAgenda)
	registerTool(s, server, &mcp.Tool{Name: "get_free_time", Description: "Working-hour gaps with no events or task blocks."}, reads, s.getFreeTime)
	registerTool(s, server, &mcp.Tool{Name: "what_next", Description: "Ranked unscheduled and overdue tasks to do next."}, reads, s.whatNext)

	registerTool(s, server, &mcp.Tool{Name: "list_workspaces", Description: "List workspaces with statuses, labels, and custom fields."}, reads, s.listWorkspaces)
	registerTool(s, server, &mcp.Tool{Name: "get_workspace", Description: "Get one workspace."}, reads, s.getWorkspace)
	registerTool(s, server, &mcp.Tool{Name: "create_workspace", Description: "Create a workspace with default statuses."}, writes, s.createWorkspace)
	registerTool(s, server, &mcp.Tool{Name: "rename_workspace", Description: "Rename or recolor a workspace."}, writes, s.renameWorkspace)
	registerTool(s, server, &mcp.Tool{Name: "delete_workspace", Description: "Delete a workspace. Fails if it is the last one. Requires confirm=true."}, mcpOnly.reviewed(), s.deleteWorkspace)
	registerTool(s, server, &mcp.Tool{Name: "create_status", Description: "Add a status to a workspace."}, writes, s.createStatus)
	registerTool(s, server, &mcp.Tool{Name: "update_status", Description: "Rename or recolor a status."}, writes, s.updateStatus)
	registerTool(s, server, &mcp.Tool{Name: "delete_status", Description: "Delete a workspace status."}, mcpOnly.reviewed(), s.deleteStatus)
	registerTool(s, server, &mcp.Tool{Name: "create_label", Description: "Add a label to a workspace."}, writes, s.createLabel)
	registerTool(s, server, &mcp.Tool{Name: "update_label", Description: "Rename or recolor a label."}, writes, s.updateLabel)
	registerTool(s, server, &mcp.Tool{Name: "delete_label", Description: "Delete a workspace label."}, mcpOnly.reviewed(), s.deleteLabel)
	registerTool(s, server, &mcp.Tool{Name: "create_custom_field", Description: "Add a custom field (text, select, multi_select, number, url, date, boolean)."}, writes, s.createCustomField)
	registerTool(s, server, &mcp.Tool{Name: "update_custom_field", Description: "Update a custom field definition."}, writes, s.updateCustomField)
	registerTool(s, server, &mcp.Tool{Name: "delete_custom_field", Description: "Delete a custom field."}, mcpOnly.reviewed(), s.deleteCustomField)

	registerTool(s, server, &mcp.Tool{Name: "list_projects", Description: "List projects with open/done/progress summaries. Optional filters: workspaceId, statusId, completed."}, reads, s.listProjects)
	registerTool(s, server, &mcp.Tool{Name: "get_project", Description: "Get a project with stages, progress, and a stage board (Unstaged + stg_ columns)."}, reads, s.getProject)
	registerTool(s, server, &mcp.Tool{Name: "list_project_activity", Description: "Activity feed for tasks in a project (newest first)."}, mcpOnly, s.listProjectActivity)
	registerTool(s, server, &mcp.Tool{Name: "create_project", Description: "Create a project."}, writes, s.createProject)
	registerTool(s, server, &mcp.Tool{Name: "update_project", Description: "Partial-update a project."}, writes, s.updateProject)
	registerTool(s, server, &mcp.Tool{Name: "complete_project", Description: "Mark a project complete."}, writes, s.completeProject)
	registerTool(s, server, &mcp.Tool{Name: "reopen_project", Description: "Clear completedAt on a project."}, writes, s.reopenProject)
	registerTool(s, server, &mcp.Tool{Name: "delete_project", Description: "Delete a project and its tasks. Requires confirm=true."}, mcpOnly.reviewed(), s.deleteProject)
	registerTool(s, server, &mcp.Tool{Name: "create_stage", Description: "Add a stage to a project."}, writes, s.createStage)
	registerTool(s, server, &mcp.Tool{Name: "update_stage", Description: "Rename or recolor a project stage."}, writes, s.updateStage)
	registerTool(s, server, &mcp.Tool{Name: "delete_stage", Description: "Delete a stage."}, mcpOnly.reviewed(), s.deleteStage)
	registerTool(s, server, &mcp.Tool{Name: "reorder_stages", Description: "Set stage order by id list."}, writes, s.reorderStages)

	registerTool(s, server, &mcp.Tool{Name: "list_tasks", Description: "List work tasks. Reminders and inbox items are hidden unless reminders=true, kind=inbox, or inbox=true. Filters: workspace, project, status, labels, priority, stage, completed, overdue, scheduled, recurring, text."}, reads, s.listTasks)
	registerTool(s, server, &mcp.Tool{Name: "get_task", Description: "Get a task with blocks, recurrence, checklist, progress, and recent activity."}, reads, s.getTask)
	registerTool(s, server, &mcp.Tool{Name: "create_task", Description: "Create a work task with workspaceId. Ask which workspace to use unless the user specified one in this request; do not infer it from context or past tasks. Work duration defaults to 30 minutes unless the user specifies one. Never silently capture a task to Inbox; use capture_inbox_item for intentional Inbox capture. Explicit kind=reminder with scheduleAt creates a reminder. Description is markdown."}, writes, s.createTask)
	registerTool(s, server, &mcp.Tool{Name: "update_task", Description: "Partial-update a task, including statusId (kanban) and stageId (project board; empty unstages)."}, writes.reviewedWhen(hasAny("recurrence", "clearRecurrence")), s.updateTask)
	registerTool(s, server, &mcp.Tool{Name: "bulk_update_tasks", Description: "Apply the same patch to many tasks: completedAt (set or empty to reopen), statusId, priorityLevel, projectId, stageId, deadline, and labelIds (replaces the full set; [] clears). It cannot schedule: place tasks one at a time with schedule_task."}, writes.reviewed(), s.bulkUpdateTasks)
	registerTool(s, server, &mcp.Tool{Name: "complete_task", Description: "Mark a one-off task complete."}, writes, s.completeTask)
	registerTool(s, server, &mcp.Tool{Name: "reopen_task", Description: "Clear completedAt on a one-off task."}, writes, s.reopenTask)
	registerTool(s, server, &mcp.Tool{Name: "move_task_to_status", Description: "Move a task to a workspace status (kanban column). Empty statusId clears status."}, writes, s.moveTaskToStatus)
	registerTool(s, server, &mcp.Tool{Name: "move_task_to_stage", Description: "Move a task to a project stage. Empty stageId sends it to Unstaged."}, writes, s.moveTaskToStage)
	registerTool(s, server, &mcp.Tool{Name: "delete_task", Description: "Delete a task."}, mcpOnly.reviewed(), s.deleteTask)
	registerTool(s, server, &mcp.Tool{Name: "set_task_labels", Description: "Replace a task's labels."}, writes, s.setTaskLabels)
	registerTool(s, server, &mcp.Tool{Name: "set_task_custom_field", Description: "Set or clear one custom field value on a task."}, writes, s.setTaskCustomField)
	registerTool(s, server, &mcp.Tool{Name: "set_task_dependency", Description: "Set or clear blockedBy (this task waits on another)."}, writes, s.setTaskDependency)
	registerTool(s, server, &mcp.Tool{Name: "add_task_comment", Description: "Comment on a task."}, writes, s.addTaskComment)
	registerTool(s, server, &mcp.Tool{Name: "list_task_activity", Description: "Activity and comments for a task."}, mcpOnly, s.listTaskActivity)
	registerTool(s, server, &mcp.Tool{Name: "set_task_recurrence", Description: "Turn a task into a repeating series."}, writes.reviewed(), s.setTaskRecurrence)
	registerTool(s, server, &mcp.Tool{Name: "clear_task_recurrence", Description: "Turn a series back into a one-off task."}, writes.reviewed(), s.clearTaskRecurrence)
	registerTool(s, server, &mcp.Tool{Name: "edit_task_occurrence", Description: "complete, uncomplete, skip, restore, or move one occurrence."}, writes.reviewed(), s.editTaskOccurrence)
	registerTool(s, server, &mcp.Tool{Name: "split_task_series", Description: "This-and-future split of a recurring task."}, writes.reviewed(), s.splitTaskSeries)
	registerTool(s, server, &mcp.Tool{Name: "capture_inbox_item", Description: "Capture a thought with only a title. It stays in Inbox and is not auto-scheduled until clarified."}, writes, s.captureInboxItem)
	registerTool(s, server, &mcp.Tool{Name: "list_inbox", Description: "List unprocessed inbox items."}, reads, s.listInbox)
	registerTool(s, server, &mcp.Tool{Name: "clarify_inbox_item", Description: "Turn an inbox item into a work task (workspaceId + duration) or a reminder (scheduleAt)."}, writes, s.clarifyInboxItem)
	registerTool(s, server, &mcp.Tool{Name: "add_checklist_item", Description: "Add a lightweight checklist item on a task. Checklist items are not scheduled."}, writes, s.addChecklistItem)
	registerTool(s, server, &mcp.Tool{Name: "update_checklist_item", Description: "Rename and/or complete a checklist item."}, writes, s.updateChecklistItem)
	registerTool(s, server, &mcp.Tool{Name: "toggle_checklist_item", Description: "Complete or reopen a checklist item."}, writes, s.toggleChecklistItem)
	registerTool(s, server, &mcp.Tool{Name: "replace_checklist", Description: "Replace a task's checklist. Items without an id are created; empty titles are skipped."}, mcpOnly, s.replaceChecklist)
	registerTool(s, server, &mcp.Tool{Name: "delete_checklist_item", Description: "Remove a checklist item."}, writes.reviewed(), s.deleteChecklistItem)
	registerTool(s, server, &mcp.Tool{Name: "start_focus", Description: "Start a focus session on a task. Stops any other active focus and records elapsed minutes on stop."}, writes, s.startFocus)
	registerTool(s, server, &mcp.Tool{Name: "pause_focus", Description: "Pause the active focus session. Elapsed minutes are added to actualMinutes; start_focus resumes it."}, writes, s.pauseFocus)
	registerTool(s, server, &mcp.Tool{Name: "stop_focus", Description: "Stop the focus session and add elapsed minutes to actualMinutes."}, writes, s.stopFocus)
	registerTool(s, server, &mcp.Tool{Name: "get_today", Description: "Today view: scheduled items, overdue, inbox count, today-focus set, active focus, completed today, and unfinished scheduled work."}, reads, s.getToday)
	registerTool(s, server, &mcp.Tool{Name: "set_today_focus", Description: "Add or remove a task from the Today focus set (max 7). date is YYYY-MM-DD; omit/empty clears."}, writes, s.setTodayFocus)
	registerTool(s, server, &mcp.Tool{Name: "duplicate_task", Description: "Duplicate a task with its checklist. Skips blocks, completion, and focus time."}, mcpOnly, s.duplicateTask)
	registerTool(s, server, &mcp.Tool{Name: "duplicate_project", Description: "Duplicate a project with stages and tasks (including checklists)."}, mcpOnly, s.duplicateProject)

	registerTool(s, server, &mcp.Tool{Name: "list_events", Description: "List all calendar events (no date filter). Use get_calendar for a date range."}, reads, s.listEvents)
	registerTool(s, server, &mcp.Tool{Name: "get_event", Description: "Get one event."}, reads, s.getEvent)
	registerTool(s, server, &mcp.Tool{Name: "create_event", Description: "Create an event, optionally recurring."}, writes, s.createEvent)
	registerTool(s, server, &mcp.Tool{Name: "update_event", Description: "Partial-update an event."}, writes.reviewedWhen(hasAny("recurrence", "clearRecurrence")), s.updateEvent)
	registerTool(s, server, &mcp.Tool{Name: "delete_event", Description: "Delete an event (whole series)."}, mcpOnly.reviewed(), s.deleteEvent)
	registerTool(s, server, &mcp.Tool{Name: "edit_event_occurrence", Description: "skip, restore, or move one event occurrence."}, writes.reviewed(), s.editEventOccurrence)
	registerTool(s, server, &mcp.Tool{Name: "split_event_series", Description: "This-and-future split of a recurring event. To move future occurrences to a new time, pass start (and end) for the first changed occurrence."}, writes.reviewed(), s.splitEventSeries)

	registerTool(s, server, &mcp.Tool{Name: "get_calendar", Description: "Unified calendar items in a date range."}, reads, s.getCalendar)
	registerTool(s, server, &mcp.Tool{Name: "get_working_hours", Description: "Weekly availability template."}, reads, s.getWorkingHours)
	registerTool(s, server, &mcp.Tool{Name: "update_working_hours", Description: "Replace weekly availability."}, mcpOnly.reviewed(), s.updateWorkingHours)
	registerTool(s, server, &mcp.Tool{Name: "get_schedule_settings", Description: "Engine controls: breakMinutes, freezeHours (near-term blocks the engine will not move), excludedWorkspaceIds."}, reads, s.getScheduleSettings)
	registerTool(s, server, &mcp.Tool{Name: "update_schedule_settings", Description: "Update breakMinutes, freezeHours, and excludedWorkspaceIds."}, mcpOnly, s.updateScheduleSettings)
	registerTool(s, server, &mcp.Tool{Name: "get_capacity", Description: "Per-day available vs scheduled vs planned minutes. overCapacity and atRisk are flags, not certainty."}, reads, s.getCapacity)
	registerTool(s, server, &mcp.Tool{Name: "auto_schedule_preview", Description: "Preview engine v2 placement without writing. Recurring work occurrences in the horizon are placed as blocks (not new task rows). Returns proposals (with why), skipped (reason+message), changes (add/move/remove/pin), capacity, and risks. Scores are ordering hints, not certainty."}, reads, s.autoSchedulePreview)
	registerTool(s, server, &mcp.Tool{Name: "auto_schedule_apply", Description: "Apply engine placement. Idempotent per user (advisory lock). Frozen/locked/manual pins stay. Stores a revision for undo_schedule. POST /schedule/reschedule is an alias."}, writes.reviewed().showingFor("auto_schedule_preview"), s.autoScheduleApply)
	registerTool(s, server, &mcp.Tool{Name: "undo_schedule", Description: "Undo the last auto-schedule apply by restoring the previous engine blocks."}, writes.reviewed().showing("undo_schedule_preview"), s.undoSchedule)
	registerTool(s, server, &mcp.Tool{Name: "undo_schedule_preview", Description: "Show what undo_schedule would change: the engine blocks it removes and the earlier blocks it restores. canUndo=false when there is nothing to undo."}, reads, s.undoSchedulePreview)
	registerTool(s, server, &mcp.Tool{Name: "pin_task", Description: "Lock or unlock a task so the engine will not move its blocks (scheduleLocked)."}, writes, s.pinTask)
	registerTool(s, server, &mcp.Tool{Name: "pin_block", Description: "Lock or unlock one calendar block. Locking turns it into a manual pin."}, writes, s.pinBlock)
	registerTool(s, server, &mcp.Tool{Name: "schedule_task", Description: "Pin a manual time block on a one-off work task. On a reminder (duration 0) this only sets the ping time."}, writes, s.scheduleTask)
	registerTool(s, server, &mcp.Tool{Name: "move_block", Description: "Move a scheduled block."}, writes, s.moveBlock)
	registerTool(s, server, &mcp.Tool{Name: "delete_block", Description: "Delete one scheduled block."}, writes.reviewed(), s.deleteBlock)
	registerTool(s, server, &mcp.Tool{Name: "clear_task_blocks", Description: "Remove all blocks from a task."}, writes.reviewed(), s.clearTaskBlocks)

	registerTool(s, server, &mcp.Tool{Name: "list_docs", Description: "List active documents by default. archived=true lists the archive; archived=false is the default."}, reads, s.listDocs)
	registerTool(s, server, &mcp.Tool{Name: "get_doc", Description: "Get a document as markdown (GFM plus math, callouts, footnotes, frontmatter, [[wiki links]] and mermaid/geojson/stl blocks)."}, reads, s.getDoc)
	registerTool(s, server, &mcp.Tool{Name: "create_doc", Description: "Create a document from markdown. Supports GFM, $math$, > [!NOTE] callouts, [^1] footnotes, --- frontmatter, [[wiki links]], and mermaid/geojson/topojson/stl fences that render."}, writes, s.createDoc)
	registerTool(s, server, &mcp.Tool{Name: "update_doc", Description: "Update a document (replace markdown, title, parent, archived, …)."}, writes.reviewedWhen(hasAny("markdown")), s.updateDoc)
	registerTool(s, server, &mcp.Tool{Name: "append_to_doc", Description: "Append markdown to a document (same syntax as create_doc)."}, writes, s.appendToDoc)
	registerTool(s, server, &mcp.Tool{Name: "add_3d_model", Description: "Add a 3D model to a document, built from parts (sphere, box, cylinder, cone, capsule) with a center, size, optional rotation and a #rrggbb color each. Use this instead of writing STL triangles by hand: it writes a colored stl block the doc draws. Overlap parts so they join, z is up; e.g. a figure is a sphere head on a capsule body with capsule arms and legs. replace=true swaps the doc's first stl block, so you can refine a model."}, writes.reviewedWhen(isTrue("replace")), s.add3DModel)
	registerTool(s, server, &mcp.Tool{Name: "archive_doc", Description: "Archive a document (archived=false unarchives). Prefer this over delete."}, mcpOnly, s.archiveDoc)
	registerTool(s, server, &mcp.Tool{Name: "delete_doc", Description: "Delete a document. Requires confirm=true. Subpages are not deleted; descendantCount is returned."}, mcpOnly.reviewed(), s.deleteDoc)

	registerTool(s, server, &mcp.Tool{Name: "list_sheets", Description: "List active sheets by default. archived=true lists the archive."}, reads, s.listSheets)
	registerTool(s, server, &mcp.Tool{Name: "get_sheet", Description: "Get a sheet as a markdown table plus raw grid. " + SheetFormulaHelp}, reads, s.getSheet)
	registerTool(s, server, &mcp.Tool{Name: "create_sheet", Description: "Create a sheet."}, writes.reviewedWhen(fromTemplate), s.createSheet)
	registerTool(s, server, &mcp.Tool{Name: "update_sheet", Description: "Update sheet metadata or grid. Supplied rows, columns, merges and tabs replace those arrays; preserve unrelated data. Use update_sheet_cells for a primary-tab cell edit, or tabs for another tab. Every tab, including the first, carries its own name; rename_sheet_tab renames one without resending the grid. " + SheetFormulaHelp}, writes.reviewedWhen(hasAny("rows", "columns", "tabs", "merges")), s.updateSheet)
	registerTool(s, server, &mcp.Tool{Name: "archive_sheet", Description: "Archive a sheet (archived=false unarchives). Prefer this over delete."}, mcpOnly, s.archiveSheet)
	registerTool(s, server, &mcp.Tool{Name: "add_sheet_column", Description: "Add a column. Type is text, number, date, boolean, currency, percent, formula, or select (default text). Pass options for a select column."}, writes, s.addSheetColumn)
	registerTool(s, server, &mcp.Tool{Name: "update_sheet_column", Description: "Rename, retype or re-option a column (text, number, date, boolean, currency, percent, formula, select). Retyping may clear incompatible values; options replaces a select column's choices."}, writes.reviewedWhen(hasAny("type", "options")), s.updateSheetColumn)
	registerTool(s, server, &mcp.Tool{Name: "delete_sheet_column", Description: "Delete a column."}, writes.reviewed(), s.deleteSheetColumn)
	registerTool(s, server, &mcp.Tool{Name: "add_sheet_rows", Description: "Append empty rows."}, writes.reviewed(), s.addSheetRows)
	registerTool(s, server, &mcp.Tool{Name: "update_sheet_cells", Description: "Set cells in one primary-tab row by row id and column ids from get_sheet. Literal values are coerced to the column type (number, date YYYY-MM-DD, boolean TRUE/FALSE). " + SheetFormulaHelp}, writes.reviewedWhen(otherThanOneCell), s.updateSheetCells)
	registerTool(s, server, &mcp.Tool{Name: "delete_sheet_rows", Description: "Delete rows by id."}, writes.reviewed(), s.deleteSheetRows)
	registerTool(s, server, &mcp.Tool{Name: "add_sheet_tab", Description: "Append a blank tab (A-D, 20 rows) to a sheet's workbook. Fill it with update_sheet tabs."}, writes, s.addSheetTab)
	registerTool(s, server, &mcp.Tool{Name: "rename_sheet_tab", Description: "Rename a tab. Empty tabId renames the first (primary) tab, which otherwise shows the sheet title."}, writes, s.renameSheetTab)
	registerTool(s, server, &mcp.Tool{Name: "delete_sheet_tab", Description: "Delete a tab by id. The next tab becomes the primary grid; a workbook keeps at least one tab."}, writes.reviewed(), s.deleteSheetTab)
	registerTool(s, server, &mcp.Tool{Name: "duplicate_sheet", Description: "Duplicate a sheet, including columns, rows, merges, and tabs."}, mcpOnly, s.duplicateSheet)
	registerTool(s, server, &mcp.Tool{Name: "delete_sheet", Description: "Delete a sheet."}, mcpOnly.reviewed(), s.deleteSheet)
	registerTool(s, server, &mcp.Tool{Name: "list_sheet_templates", Description: "List saved sheet templates."}, reads, s.listSheetTemplates)
	registerTool(s, server, &mcp.Tool{Name: "get_sheet_template", Description: "Get one sheet template."}, reads, s.getSheetTemplate)
	registerTool(s, server, &mcp.Tool{Name: "create_sheet_template", Description: "Save a sheet (or one tab) as a template. Pass templateId to create_sheet to apply it."}, writes, s.createSheetTemplate)
	registerTool(s, server, &mcp.Tool{Name: "update_sheet_template", Description: "Rename a sheet template."}, writes, s.updateSheetTemplate)
	registerTool(s, server, &mcp.Tool{Name: "delete_sheet_template", Description: "Delete a sheet template."}, mcpOnly.reviewed(), s.deleteSheetTemplate)
	registerTool(s, server, &mcp.Tool{Name: "materialize_sheet_template_tab", Description: "Clone a template tab (or the whole template when tabId is empty) with new ids. Does not create a sheet."}, mcpOnly, s.materializeSheetTemplateTab)

	registerTool(s, server, &mcp.Tool{Name: "list_task_views", Description: "Saved task list/kanban/gantt views, including Phase 1 filters (project, priority, labels, stage, overdue, scheduled, recurring, reminders)."}, mcpOnly, s.listTaskViews)
	registerTool(s, server, &mcp.Tool{Name: "create_task_view", Description: "Create a saved view. Filters: selectedProjectIds, selectedPriorityLevels, selectedLabelIds, selectedStageIds, showCompleted, onlyOverdue, onlyScheduled, onlyRecurring, onlyDated (deadline or scheduled block), showReminders. renderMode: list, kanban, gantt."}, mcpOnly, s.createTaskView)
	registerTool(s, server, &mcp.Tool{Name: "update_task_view", Description: "Update a saved view, including filters and renderMode."}, mcpOnly, s.updateTaskView)
	registerTool(s, server, &mcp.Tool{Name: "delete_task_view", Description: "Delete a saved view."}, mcpOnly.reviewed(), s.deleteTaskView)
	registerTool(s, server, &mcp.Tool{Name: "set_active_task_view", Description: "Select the active saved view."}, mcpOnly, s.setActiveTaskView)
	registerTool(s, server, &mcp.Tool{Name: "set_project_task_view", Description: "Save or clear the task view stored for one project (config.projectTaskViews). clear=true removes it."}, mcpOnly, s.setProjectTaskView)

	registerTool(s, server, &mcp.Tool{Name: "get_profile", Description: "Current user profile."}, mcpOnly, s.getProfile)
	registerTool(s, server, &mcp.Tool{Name: "get_config", Description: "Account config: onboarding, task views, project task views, appearance, working hours, and schedule settings."}, mcpOnly, s.getConfig)
	registerTool(s, server, &mcp.Tool{Name: "update_account_config", Description: "Update onboarding completion and appearance (theme: system, light, dark; accent: default or #RRGGBB)."}, mcpOnly, s.updateAccountConfig)
	registerTool(s, server, &mcp.Tool{Name: "update_profile", Description: "Update the user's display name."}, mcpOnly, s.updateProfile)

	registerTool(s, server, &mcp.Tool{Name: "list_notifications", Description: "In-app notifications, newest first. unread=true lists only unread."}, reads, s.listNotifications)
	registerTool(s, server, &mcp.Tool{Name: "unread_notification_count", Description: "Count of unread in-app notifications."}, reads, s.unreadNotificationCount)
	registerTool(s, server, &mcp.Tool{Name: "reschedule_urgent", Description: "Mark an overdue work task urgent and apply the schedule so it takes the earliest free slot. Same as POST /tasks/:id/reschedule-urgent."}, mcpOnly, s.rescheduleUrgent)
	registerTool(s, server, &mcp.Tool{Name: "mark_notification_read", Description: "Mark one notification read. Empty id marks all unread as read."}, writes.reviewedWhen(allNotifications), s.markNotificationRead)
	registerTool(s, server, &mcp.Tool{Name: "clear_notifications", Description: "Delete all in-app notifications for this account."}, mcpOnly, s.clearNotifications)
	registerTool(s, server, &mcp.Tool{Name: "snooze_reminder", Description: "Snooze a reminder notification. Updates the underlying reminder time and enqueues the next ping. minutes or until (RFC3339)."}, writes, s.snoozeReminder)
	registerTool(s, server, &mcp.Tool{Name: "get_notification_settings", Description: "Reminder, digest, planning, and quiet-hours preferences."}, reads, s.getNotificationSettings)
	registerTool(s, server, &mcp.Tool{Name: "update_notification_settings", Description: "Update reminder/digest/planning toggles, quiet hours, and digest times."}, mcpOnly.reviewed(), s.updateNotificationSettings)
	registerTool(s, server, &mcp.Tool{Name: "list_jobs", Description: "Background jobs for this account. Optional status: pending, running, succeeded, failed, cancelled."}, mcpOnly, s.listJobs)
	registerTool(s, server, &mcp.Tool{Name: "retry_job", Description: "Re-queue a failed or cancelled job."}, mcpOnly, s.retryJob)
	registerTool(s, server, &mcp.Tool{Name: "get_job_health", Description: "Counts of pending, running, failed, and recently succeeded jobs."}, mcpOnly, s.getJobHealth)

	registerTool(s, server, &mcp.Tool{Name: "export_account", Description: "Full versioned JSON export of this account (same as GET /export/full)."}, mcpOnly, s.exportAccount)
	registerTool(s, server, &mcp.Tool{Name: "export_tasks_csv", Description: "Export tasks as CSV text."}, mcpOnly, s.exportTasksCSV)
	registerTool(s, server, &mcp.Tool{Name: "export_calendar", Description: "Export events and scheduled blocks as iCalendar text."}, mcpOnly, s.exportCalendar)
	registerTool(s, server, &mcp.Tool{Name: "export_doc", Description: "Export one document as markdown, or pdf (base64)."}, mcpOnly, s.exportDoc)
	registerTool(s, server, &mcp.Tool{Name: "get_backup_settings", Description: "Encrypted backup schedule: enabled, intervalDays, retentionCount."}, mcpOnly, s.getBackupSettings)
	registerTool(s, server, &mcp.Tool{Name: "update_backup_settings", Description: "Update the encrypted backup schedule. intervalDays and retentionCount are 1–30."}, mcpOnly, s.updateBackupSettings)
	registerTool(s, server, &mcp.Tool{Name: "create_backup", Description: "Write an encrypted server backup of this account."}, mcpOnly, s.createBackup)
	registerTool(s, server, &mcp.Tool{Name: "list_backups", Description: "List encrypted server backups."}, mcpOnly, s.listBackups)
	registerTool(s, server, &mcp.Tool{Name: "download_backup", Description: "Decrypt and return one server backup."}, mcpOnly, s.downloadBackup)
	registerTool(s, server, &mcp.Tool{Name: "delete_backup", Description: "Delete one encrypted server backup. Requires confirm=true."}, mcpOnly.reviewed(), s.deleteBackup)
	registerTool(s, server, &mcp.Tool{Name: "restore_account", Description: "Replace this account's data with a timely-backup JSON object. Requires confirm=true. Same guard as POST /restore."}, mcpOnly, s.restoreAccount)
}

func userID(req *mcp.CallToolRequest) (string, error) {
	if req != nil && req.Extra != nil && req.Extra.TokenInfo != nil && req.Extra.TokenInfo.UserID != "" {
		return req.Extra.TokenInfo.UserID, nil
	}
	return "", errors.New("not authenticated")
}

func reply(summary string, data any) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: summary}},
	}, objectContent(data), nil
}

// Hermes (and other Pydantic MCP clients) require structuredContent to be a
// JSON object. Slices become {"items": [...]}.
func objectContent(data any) any {
	if data == nil {
		return map[string]any{}
	}
	switch reflect.TypeOf(data).Kind() {
	case reflect.Slice, reflect.Array:
		return map[string]any{"items": data}
	default:
		return data
	}
}

func fail(err error) (*mcp.CallToolResult, any, error) {
	if err == nil {
		err = errors.New("unknown error")
	}
	return nil, nil, err
}

func (s *Server) tasksFor(_ *mcp.CallToolRequest) task.TaskService {
	actor := s.actor
	if actor == "" {
		actor = actorHermes
	}
	return s.Tasks.WithActor(actor)
}

func strPtr(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func emptyPtr(v string) *string {
	return &v
}

func boolPtr(v bool) *bool { return &v }

func nowRFC() string { return time.Now().UTC().Format(time.RFC3339) }

func md(src string) (models.JSONMap, string) {
	return richtext.FromMarkdown(src)
}
