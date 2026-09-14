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
}

type Server struct {
	Deps
}

func New(deps Deps) *mcp.Server {
	s := &Server{Deps: deps}
	server := mcp.NewServer(&mcp.Implementation{Name: "timely", Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: `Timely personal productivity MCP. Call get_context first.

IDs: usr_, ws_, pr_, tsk_, evt_, doc_, sht_, tst_ (status), lbl_, stg_, cf_, blk_, rr_, view_, ntf_, job_.
Dates are ISO-8601. Recurrence is an RFC 5545 RRULE (FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH).
Recurring tasks expand on the calendar; complete an occurrence with edit_task_occurrence, not complete_task.
Docs and descriptions accept markdown. Mentions: [@Label](timely://task/<id>).
Reminders fire as server jobs even when the UI is closed. snooze_reminder moves the underlying reminder. Quiet hours still write the in-app row and delay push. Failed jobs are listed with list_jobs and recovered with retry_job.

Projects can have ordered stages (stg_). Move cards with move_task_to_stage (empty stageId = Unstaged) or move_task_to_status for kanban.
Reminders are duration 0 with kind=reminder; list them with list_tasks reminders=true. Title-only capture is inbox (kind=inbox) and is not auto-scheduled until clarify_inbox_item.
Subtasks nest one level (parentTaskId). Schedulable subtasks replace the parent in auto-schedule (skip reason parent_has_subtasks). Checklist items are lightweight and are not scheduled.
Today: get_today, set_today_focus, start_focus/stop_focus (actualMinutes is focused time, separate from duration).
Duplicate with duplicate_task / duplicate_project (checklist + subtasks; no blocks/completion).
Auto-schedule v2: preview shows add/move/remove/pin, skip messages, capacity, and deadline risk. Recurring work occurrences in the horizon are placed without creating extra task rows. Frozen hours, locked tasks, and manual pins stay put. undo_schedule reverts the last apply. Scores from what_next and the engine are ordering hints, not certainty.
bulk_update_tasks applies one patch to many tasks: complete/reopen, status, priority, project, stage, deadline, and labelIds (replaces the full set; [] clears).
Archive docs/sheets with archive_doc / archive_sheet (archived=false unarchives). list_docs/list_sheets archived=true lists the archive. Prefer archive over delete.
Sheet columns are text, number, date, or boolean; update_sheet_cells coerces values to the column type. Formulas start with =.
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

// register exposes Timely's task, project, and workspace tools to the MCP server.
func (s *Server) register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{Name: "get_context", Description: "User, workspaces (statuses, labels, custom fields), projects with stages and open/done counts, working hours, saved views, and current time. Call this first."}, s.getContext)
	mcp.AddTool(server, &mcp.Tool{Name: "search", Description: "Search tasks, projects, docs, sheets, and events by exact or substring text."}, s.search)
	mcp.AddTool(server, &mcp.Tool{Name: "semantic_search", Description: "Meaning/intent search across tasks, projects, docs, sheets, and events. Use when the user asks what is related to a topic or keyword search is too literal. Returns ranked chunks; follow with get_task/get_doc/… for the full record."}, s.semanticSearch)
	mcp.AddTool(server, &mcp.Tool{Name: "reindex_search", Description: "Rebuild the user's search index (same as POST /search/reindex). Use after bulk imports or if semantic results look stale."}, s.reindexSearch)
	mcp.AddTool(server, &mcp.Tool{Name: "get_agenda", Description: "Calendar items, overdue tasks, and unscheduled work for a day or week."}, s.getAgenda)
	mcp.AddTool(server, &mcp.Tool{Name: "get_free_time", Description: "Working-hour gaps with no events or task blocks."}, s.getFreeTime)
	mcp.AddTool(server, &mcp.Tool{Name: "what_next", Description: "Ranked unscheduled and overdue tasks to do next."}, s.whatNext)

	mcp.AddTool(server, &mcp.Tool{Name: "list_workspaces", Description: "List workspaces with statuses, labels, and custom fields."}, s.listWorkspaces)
	mcp.AddTool(server, &mcp.Tool{Name: "get_workspace", Description: "Get one workspace."}, s.getWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "create_workspace", Description: "Create a workspace with default statuses."}, s.createWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "rename_workspace", Description: "Rename or recolor a workspace."}, s.renameWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_workspace", Description: "Delete a workspace. Fails if it is the last one. Requires confirm=true."}, s.deleteWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "create_status", Description: "Add a status to a workspace."}, s.createStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "update_status", Description: "Rename or recolor a status."}, s.updateStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_status", Description: "Delete a workspace status."}, s.deleteStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "create_label", Description: "Add a label to a workspace."}, s.createLabel)
	mcp.AddTool(server, &mcp.Tool{Name: "update_label", Description: "Rename or recolor a label."}, s.updateLabel)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_label", Description: "Delete a workspace label."}, s.deleteLabel)
	mcp.AddTool(server, &mcp.Tool{Name: "create_custom_field", Description: "Add a custom field (text, select, multi_select, number, url, date, boolean)."}, s.createCustomField)
	mcp.AddTool(server, &mcp.Tool{Name: "update_custom_field", Description: "Update a custom field definition."}, s.updateCustomField)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_custom_field", Description: "Delete a custom field."}, s.deleteCustomField)

	mcp.AddTool(server, &mcp.Tool{Name: "list_projects", Description: "List projects with open/done/progress summaries. Optional filters: workspaceId, statusId, completed."}, s.listProjects)
	mcp.AddTool(server, &mcp.Tool{Name: "get_project", Description: "Get a project with stages, progress, and a stage board (Unstaged + stg_ columns)."}, s.getProject)
	mcp.AddTool(server, &mcp.Tool{Name: "create_project", Description: "Create a project."}, s.createProject)
	mcp.AddTool(server, &mcp.Tool{Name: "update_project", Description: "Partial-update a project."}, s.updateProject)
	mcp.AddTool(server, &mcp.Tool{Name: "complete_project", Description: "Mark a project complete."}, s.completeProject)
	mcp.AddTool(server, &mcp.Tool{Name: "reopen_project", Description: "Clear completedAt on a project."}, s.reopenProject)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_project", Description: "Delete a project and its tasks. Requires confirm=true."}, s.deleteProject)
	mcp.AddTool(server, &mcp.Tool{Name: "create_stage", Description: "Add a stage to a project."}, s.createStage)
	mcp.AddTool(server, &mcp.Tool{Name: "update_stage", Description: "Rename or recolor a project stage."}, s.updateStage)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_stage", Description: "Delete a stage."}, s.deleteStage)
	mcp.AddTool(server, &mcp.Tool{Name: "reorder_stages", Description: "Set stage order by id list."}, s.reorderStages)

	mcp.AddTool(server, &mcp.Tool{Name: "list_tasks", Description: "List work tasks. Reminders and inbox items are hidden unless reminders=true, kind=inbox, or inbox=true. Filters: workspace, project, status, labels, priority, stage, completed, overdue, scheduled, recurring, parentId, includeSubtasks, text."}, s.listTasks)
	mcp.AddTool(server, &mcp.Tool{Name: "get_task", Description: "Get a task with blocks, recurrence, checklist, subtasks, progress, and recent activity."}, s.getTask)
	mcp.AddTool(server, &mcp.Tool{Name: "create_task", Description: "Create a task. Title-only (no duration, no ping time) captures to inbox. Duration 0 with scheduleAt/recurrence is a reminder. Work tasks (duration > 0) require workspaceId. Optional parentTaskId creates a one-level subtask. Description is markdown."}, s.createTask)
	mcp.AddTool(server, &mcp.Tool{Name: "update_task", Description: "Partial-update a task, including statusId (kanban) and stageId (project board; empty unstages)."}, s.updateTask)
	mcp.AddTool(server, &mcp.Tool{Name: "bulk_update_tasks", Description: "Apply the same patch to many tasks: completedAt (set or empty to reopen), statusId, priorityLevel, projectId, stageId, deadline, and labelIds (replaces the full set; [] clears)."}, s.bulkUpdateTasks)
	mcp.AddTool(server, &mcp.Tool{Name: "complete_task", Description: "Mark a one-off task complete."}, s.completeTask)
	mcp.AddTool(server, &mcp.Tool{Name: "reopen_task", Description: "Clear completedAt on a one-off task."}, s.reopenTask)
	mcp.AddTool(server, &mcp.Tool{Name: "move_task_to_status", Description: "Move a task to a workspace status (kanban column). Empty statusId clears status."}, s.moveTaskToStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "move_task_to_stage", Description: "Move a task to a project stage. Empty stageId sends it to Unstaged."}, s.moveTaskToStage)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_task", Description: "Delete a task."}, s.deleteTask)
	mcp.AddTool(server, &mcp.Tool{Name: "set_task_labels", Description: "Replace a task's labels."}, s.setTaskLabels)
	mcp.AddTool(server, &mcp.Tool{Name: "set_task_custom_field", Description: "Set or clear one custom field value on a task."}, s.setTaskCustomField)
	mcp.AddTool(server, &mcp.Tool{Name: "set_task_dependency", Description: "Set or clear blockedBy (this task waits on another)."}, s.setTaskDependency)
	mcp.AddTool(server, &mcp.Tool{Name: "add_task_comment", Description: "Comment on a task."}, s.addTaskComment)
	mcp.AddTool(server, &mcp.Tool{Name: "list_task_activity", Description: "Activity and comments for a task."}, s.listTaskActivity)
	mcp.AddTool(server, &mcp.Tool{Name: "set_task_recurrence", Description: "Turn a task into a repeating series."}, s.setTaskRecurrence)
	mcp.AddTool(server, &mcp.Tool{Name: "clear_task_recurrence", Description: "Turn a series back into a one-off task."}, s.clearTaskRecurrence)
	mcp.AddTool(server, &mcp.Tool{Name: "edit_task_occurrence", Description: "complete, uncomplete, skip, restore, or move one occurrence."}, s.editTaskOccurrence)
	mcp.AddTool(server, &mcp.Tool{Name: "split_task_series", Description: "This-and-future split of a recurring task."}, s.splitTaskSeries)
	mcp.AddTool(server, &mcp.Tool{Name: "capture_inbox_item", Description: "Capture a thought with only a title. It stays in Inbox and is not auto-scheduled until clarified."}, s.captureInboxItem)
	mcp.AddTool(server, &mcp.Tool{Name: "list_inbox", Description: "List unprocessed inbox items."}, s.listInbox)
	mcp.AddTool(server, &mcp.Tool{Name: "clarify_inbox_item", Description: "Turn an inbox item into a work task (workspaceId + duration) or a reminder (scheduleAt)."}, s.clarifyInboxItem)
	mcp.AddTool(server, &mcp.Tool{Name: "list_subtasks", Description: "List one-level subtasks of a parent task."}, s.listSubtasks)
	mcp.AddTool(server, &mcp.Tool{Name: "create_subtask", Description: "Create a one-level subtask under a parent. Inherits workspace/project. Schedulable subtasks replace the parent in the engine."}, s.createSubtask)
	mcp.AddTool(server, &mcp.Tool{Name: "add_checklist_item", Description: "Add a lightweight checklist item on a task. Checklist items are not scheduled."}, s.addChecklistItem)
	mcp.AddTool(server, &mcp.Tool{Name: "toggle_checklist_item", Description: "Complete or reopen a checklist item."}, s.toggleChecklistItem)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_checklist_item", Description: "Remove a checklist item."}, s.deleteChecklistItem)
	mcp.AddTool(server, &mcp.Tool{Name: "start_focus", Description: "Start a focus session on a task. Stops any other active focus and records elapsed minutes on stop."}, s.startFocus)
	mcp.AddTool(server, &mcp.Tool{Name: "stop_focus", Description: "Stop the focus session and add elapsed minutes to actualMinutes."}, s.stopFocus)
	mcp.AddTool(server, &mcp.Tool{Name: "get_today", Description: "Today view: scheduled items, overdue, inbox count, today-focus set, active focus, completed today, and unfinished scheduled work."}, s.getToday)
	mcp.AddTool(server, &mcp.Tool{Name: "set_today_focus", Description: "Add or remove a task from the Today focus set (max 7). date is YYYY-MM-DD; omit/empty clears."}, s.setTodayFocus)
	mcp.AddTool(server, &mcp.Tool{Name: "duplicate_task", Description: "Duplicate a task with checklist and subtasks. Skips blocks, completion, and focus time."}, s.duplicateTask)
	mcp.AddTool(server, &mcp.Tool{Name: "duplicate_project", Description: "Duplicate a project with stages and tasks (including checklists and subtasks)."}, s.duplicateProject)

	mcp.AddTool(server, &mcp.Tool{Name: "list_events", Description: "List all calendar events (no date filter). Use get_calendar for a date range."}, s.listEvents)
	mcp.AddTool(server, &mcp.Tool{Name: "get_event", Description: "Get one event."}, s.getEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "create_event", Description: "Create an event, optionally recurring."}, s.createEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "update_event", Description: "Partial-update an event."}, s.updateEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_event", Description: "Delete an event (whole series)."}, s.deleteEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "edit_event_occurrence", Description: "skip, restore, or move one event occurrence."}, s.editEventOccurrence)
	mcp.AddTool(server, &mcp.Tool{Name: "split_event_series", Description: "This-and-future split of a recurring event."}, s.splitEventSeries)

	mcp.AddTool(server, &mcp.Tool{Name: "get_calendar", Description: "Unified calendar items in a date range."}, s.getCalendar)
	mcp.AddTool(server, &mcp.Tool{Name: "get_working_hours", Description: "Weekly availability template."}, s.getWorkingHours)
	mcp.AddTool(server, &mcp.Tool{Name: "update_working_hours", Description: "Replace weekly availability."}, s.updateWorkingHours)
	mcp.AddTool(server, &mcp.Tool{Name: "get_schedule_settings", Description: "Engine controls: breakMinutes, freezeHours (near-term blocks the engine will not move), excludedWorkspaceIds."}, s.getScheduleSettings)
	mcp.AddTool(server, &mcp.Tool{Name: "update_schedule_settings", Description: "Update breakMinutes, freezeHours, and excludedWorkspaceIds."}, s.updateScheduleSettings)
	mcp.AddTool(server, &mcp.Tool{Name: "get_capacity", Description: "Per-day available vs scheduled vs planned minutes. overCapacity and atRisk are flags, not certainty."}, s.getCapacity)
	mcp.AddTool(server, &mcp.Tool{Name: "auto_schedule_preview", Description: "Preview engine v2 placement without writing. Recurring work occurrences in the horizon are placed as blocks (not new task rows). Returns proposals (with why), skipped (reason+message), changes (add/move/remove/pin), capacity, and risks. Scores are ordering hints, not certainty."}, s.autoSchedulePreview)
	mcp.AddTool(server, &mcp.Tool{Name: "auto_schedule_apply", Description: "Apply engine placement. Idempotent per user (advisory lock). Frozen/locked/manual pins stay. Stores a revision for undo_schedule. POST /schedule/reschedule is an alias."}, s.autoScheduleApply)
	mcp.AddTool(server, &mcp.Tool{Name: "undo_schedule", Description: "Undo the last auto-schedule apply by restoring the previous engine blocks."}, s.undoSchedule)
	mcp.AddTool(server, &mcp.Tool{Name: "pin_task", Description: "Lock or unlock a task so the engine will not move its blocks (scheduleLocked)."}, s.pinTask)
	mcp.AddTool(server, &mcp.Tool{Name: "pin_block", Description: "Lock or unlock one calendar block. Locking turns it into a manual pin."}, s.pinBlock)
	mcp.AddTool(server, &mcp.Tool{Name: "schedule_task", Description: "Pin a manual time block on a one-off work task. On a reminder (duration 0) this only sets the ping time."}, s.scheduleTask)
	mcp.AddTool(server, &mcp.Tool{Name: "move_block", Description: "Move a scheduled block."}, s.moveBlock)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_block", Description: "Delete one scheduled block."}, s.deleteBlock)
	mcp.AddTool(server, &mcp.Tool{Name: "clear_task_blocks", Description: "Remove all blocks from a task."}, s.clearTaskBlocks)

	mcp.AddTool(server, &mcp.Tool{Name: "list_docs", Description: "List active documents by default. archived=true lists the archive; archived=false is the default."}, s.listDocs)
	mcp.AddTool(server, &mcp.Tool{Name: "get_doc", Description: "Get a document as markdown."}, s.getDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "create_doc", Description: "Create a document from markdown."}, s.createDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "update_doc", Description: "Update a document (replace markdown, title, parent, archived, …)."}, s.updateDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "append_to_doc", Description: "Append markdown to a document."}, s.appendToDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "archive_doc", Description: "Archive a document (archived=false unarchives). Prefer this over delete."}, s.archiveDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_doc", Description: "Delete a document. Requires confirm=true. Subpages are not deleted; descendantCount is returned."}, s.deleteDoc)

	mcp.AddTool(server, &mcp.Tool{Name: "list_sheets", Description: "List active sheets by default. archived=true lists the archive."}, s.listSheets)
	mcp.AddTool(server, &mcp.Tool{Name: "get_sheet", Description: "Get a sheet as a markdown table plus raw grid."}, s.getSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "create_sheet", Description: "Create a sheet."}, s.createSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "update_sheet", Description: "Update sheet title/description/project/favorite/archived."}, s.updateSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "archive_sheet", Description: "Archive a sheet (archived=false unarchives). Prefer this over delete."}, s.archiveSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "add_sheet_column", Description: "Add a column. Type is text, number, date, or boolean (default text)."}, s.addSheetColumn)
	mcp.AddTool(server, &mcp.Tool{Name: "update_sheet_column", Description: "Rename or retype a column (text, number, date, boolean)."}, s.updateSheetColumn)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_sheet_column", Description: "Delete a column."}, s.deleteSheetColumn)
	mcp.AddTool(server, &mcp.Tool{Name: "add_sheet_rows", Description: "Append empty rows."}, s.addSheetRows)
	mcp.AddTool(server, &mcp.Tool{Name: "update_sheet_cells", Description: "Set cells in one row by column id. Values are coerced to the column type (number, date YYYY-MM-DD, boolean TRUE/FALSE). Formulas starting with = are stored as-is."}, s.updateSheetCells)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_sheet_rows", Description: "Delete rows by id."}, s.deleteSheetRows)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_sheet", Description: "Delete a sheet."}, s.deleteSheet)

	mcp.AddTool(server, &mcp.Tool{Name: "list_task_views", Description: "Saved task list/kanban/gantt views, including Phase 1 filters (project, priority, labels, stage, overdue, scheduled, recurring, reminders)."}, s.listTaskViews)
	mcp.AddTool(server, &mcp.Tool{Name: "create_task_view", Description: "Create a saved view. Filters: selectedProjectIds, selectedPriorityLevels, selectedLabelIds, selectedStageIds, showCompleted, onlyOverdue, onlyScheduled, onlyRecurring, onlyDated (deadline or scheduled block), showReminders. renderMode: list, kanban, gantt."}, s.createTaskView)
	mcp.AddTool(server, &mcp.Tool{Name: "update_task_view", Description: "Update a saved view, including filters and renderMode."}, s.updateTaskView)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_task_view", Description: "Delete a saved view."}, s.deleteTaskView)
	mcp.AddTool(server, &mcp.Tool{Name: "set_active_task_view", Description: "Select the active saved view."}, s.setActiveTaskView)

	mcp.AddTool(server, &mcp.Tool{Name: "get_profile", Description: "Current user profile."}, s.getProfile)
	mcp.AddTool(server, &mcp.Tool{Name: "update_profile", Description: "Update the user's display name."}, s.updateProfile)

	mcp.AddTool(server, &mcp.Tool{Name: "list_notifications", Description: "In-app notifications, newest first. unread=true lists only unread."}, s.listNotifications)
	mcp.AddTool(server, &mcp.Tool{Name: "mark_notification_read", Description: "Mark one notification read. Empty id marks all unread as read."}, s.markNotificationRead)
	mcp.AddTool(server, &mcp.Tool{Name: "snooze_reminder", Description: "Snooze a reminder notification. Updates the underlying reminder time and enqueues the next ping. minutes or until (RFC3339)."}, s.snoozeReminder)
	mcp.AddTool(server, &mcp.Tool{Name: "get_notification_settings", Description: "Reminder, digest, planning, and quiet-hours preferences."}, s.getNotificationSettings)
	mcp.AddTool(server, &mcp.Tool{Name: "update_notification_settings", Description: "Update reminder/digest/planning toggles, quiet hours, and digest times."}, s.updateNotificationSettings)
	mcp.AddTool(server, &mcp.Tool{Name: "list_jobs", Description: "Background jobs for this account. Optional status: pending, running, succeeded, failed, cancelled."}, s.listJobs)
	mcp.AddTool(server, &mcp.Tool{Name: "retry_job", Description: "Re-queue a failed or cancelled job."}, s.retryJob)
	mcp.AddTool(server, &mcp.Tool{Name: "get_job_health", Description: "Counts of pending, running, failed, and recently succeeded jobs."}, s.getJobHealth)
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
	return s.Tasks.WithActor(actorHermes)
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
