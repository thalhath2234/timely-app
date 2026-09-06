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
	"timely-api/internal/features/project"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const actorHermes = "Hermes"

type Deps struct {
	Auth      auth.AuthService
	Tasks     task.TaskService
	Projects  project.ProjectService
	Workspaces workspace.WorkspaceService
	Events    event.EventService
	Calendar  calendar.Service
	Schedule  schedule.Service
	Docs      doc.DocumentService
	Sheets    sheet.SheetService
	Search    search.Service
}

type Server struct {
	Deps
}

func New(deps Deps) *mcp.Server {
	s := &Server{Deps: deps}
	server := mcp.NewServer(&mcp.Implementation{Name: "timely", Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: `Timely personal productivity MCP. Call get_context first.

IDs: usr_, ws_, pr_, tsk_, evt_, doc_, sht_, tst_ (status), lbl_, stg_, cf_, blk_, rr_.
Dates are ISO-8601. Recurrence is an RFC 5545 RRULE (FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH).
Recurring tasks expand on the calendar; complete an occurrence with edit_task_occurrence, not complete_task.
Docs and descriptions accept markdown. Mentions: [@Label](timely://task/<id>).
Destructive deletes of a workspace or project require confirm=true.`,
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
	mcp.AddTool(server, &mcp.Tool{Name: "get_context", Description: "User, workspaces (statuses, labels, custom fields), projects, working hours, active view, and current time. Call this first."}, s.getContext)
	mcp.AddTool(server, &mcp.Tool{Name: "search", Description: "Search tasks, projects, docs, sheets, and events by exact or substring text."}, s.search)
	mcp.AddTool(server, &mcp.Tool{Name: "semantic_search", Description: "Meaning/intent search across tasks, projects, docs, sheets, and events. Use when the user asks what is related to a topic or keyword search is too literal. Returns ranked chunks; follow with get_task/get_doc/… for the full record."}, s.semanticSearch)
	mcp.AddTool(server, &mcp.Tool{Name: "get_agenda", Description: "Calendar items, overdue tasks, and unscheduled work for a day or week."}, s.getAgenda)
	mcp.AddTool(server, &mcp.Tool{Name: "get_free_time", Description: "Working-hour gaps with no events or task blocks."}, s.getFreeTime)
	mcp.AddTool(server, &mcp.Tool{Name: "what_next", Description: "Ranked unscheduled and overdue tasks to do next."}, s.whatNext)

	mcp.AddTool(server, &mcp.Tool{Name: "list_workspaces", Description: "List workspaces with statuses, labels, and custom fields."}, s.listWorkspaces)
	mcp.AddTool(server, &mcp.Tool{Name: "get_workspace", Description: "Get one workspace."}, s.getWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "create_workspace", Description: "Create a workspace with default statuses."}, s.createWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "rename_workspace", Description: "Rename a workspace."}, s.renameWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_workspace", Description: "Delete a workspace. Fails if it is the last one. Requires confirm=true."}, s.deleteWorkspace)
	mcp.AddTool(server, &mcp.Tool{Name: "create_status", Description: "Add a status to a workspace."}, s.createStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "update_status", Description: "Rename or recolor a status."}, s.updateStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_status", Description: "Delete a workspace status."}, s.deleteStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "create_label", Description: "Add a label to a workspace."}, s.createLabel)
	mcp.AddTool(server, &mcp.Tool{Name: "update_label", Description: "Rename or recolor a label."}, s.updateLabel)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_label", Description: "Delete a workspace label."}, s.deleteLabel)
	mcp.AddTool(server, &mcp.Tool{Name: "create_custom_field", Description: "Add a custom field (text, select, multi_select, number, url, date)."}, s.createCustomField)
	mcp.AddTool(server, &mcp.Tool{Name: "update_custom_field", Description: "Update a custom field definition."}, s.updateCustomField)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_custom_field", Description: "Delete a custom field."}, s.deleteCustomField)

	mcp.AddTool(server, &mcp.Tool{Name: "list_projects", Description: "List projects, optionally filtered by workspace."}, s.listProjects)
	mcp.AddTool(server, &mcp.Tool{Name: "get_project", Description: "Get a project with stages."}, s.getProject)
	mcp.AddTool(server, &mcp.Tool{Name: "create_project", Description: "Create a project."}, s.createProject)
	mcp.AddTool(server, &mcp.Tool{Name: "update_project", Description: "Partial-update a project."}, s.updateProject)
	mcp.AddTool(server, &mcp.Tool{Name: "complete_project", Description: "Mark a project complete."}, s.completeProject)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_project", Description: "Delete a project and its tasks. Requires confirm=true."}, s.deleteProject)
	mcp.AddTool(server, &mcp.Tool{Name: "create_stage", Description: "Add a stage to a project."}, s.createStage)
	mcp.AddTool(server, &mcp.Tool{Name: "update_stage", Description: "Rename a stage."}, s.updateStage)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_stage", Description: "Delete a stage."}, s.deleteStage)
	mcp.AddTool(server, &mcp.Tool{Name: "reorder_stages", Description: "Set stage order by id list."}, s.reorderStages)

	mcp.AddTool(server, &mcp.Tool{Name: "list_tasks", Description: "List tasks with filters (workspace, project, status, labels, overdue, text, …)."}, s.listTasks)
	mcp.AddTool(server, &mcp.Tool{Name: "get_task", Description: "Get a task with blocks, recurrence, and recent activity."}, s.getTask)
	mcp.AddTool(server, &mcp.Tool{Name: "create_task", Description: "Create a task. Description is markdown. Optional recurrence and scheduleAt."}, s.createTask)
	mcp.AddTool(server, &mcp.Tool{Name: "update_task", Description: "Partial-update a task."}, s.updateTask)
	mcp.AddTool(server, &mcp.Tool{Name: "bulk_update_tasks", Description: "Apply the same patch to many tasks."}, s.bulkUpdateTasks)
	mcp.AddTool(server, &mcp.Tool{Name: "complete_task", Description: "Mark a one-off task complete."}, s.completeTask)
	mcp.AddTool(server, &mcp.Tool{Name: "reopen_task", Description: "Clear completedAt on a one-off task."}, s.reopenTask)
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

	mcp.AddTool(server, &mcp.Tool{Name: "list_events", Description: "List calendar events."}, s.listEvents)
	mcp.AddTool(server, &mcp.Tool{Name: "get_event", Description: "Get one event."}, s.getEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "create_event", Description: "Create an event, optionally recurring."}, s.createEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "update_event", Description: "Partial-update an event."}, s.updateEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_event", Description: "Delete an event (whole series)."}, s.deleteEvent)
	mcp.AddTool(server, &mcp.Tool{Name: "edit_event_occurrence", Description: "skip, restore, or move one event occurrence."}, s.editEventOccurrence)
	mcp.AddTool(server, &mcp.Tool{Name: "split_event_series", Description: "This-and-future split of a recurring event."}, s.splitEventSeries)

	mcp.AddTool(server, &mcp.Tool{Name: "get_calendar", Description: "Unified calendar items in a date range."}, s.getCalendar)
	mcp.AddTool(server, &mcp.Tool{Name: "get_working_hours", Description: "Weekly availability template."}, s.getWorkingHours)
	mcp.AddTool(server, &mcp.Tool{Name: "update_working_hours", Description: "Replace weekly availability."}, s.updateWorkingHours)
	mcp.AddTool(server, &mcp.Tool{Name: "auto_schedule_preview", Description: "Preview engine placement without writing blocks."}, s.autoSchedulePreview)
	mcp.AddTool(server, &mcp.Tool{Name: "auto_schedule_apply", Description: "Apply engine placement to the calendar."}, s.autoScheduleApply)
	mcp.AddTool(server, &mcp.Tool{Name: "schedule_task", Description: "Pin a manual time block on a one-off task."}, s.scheduleTask)
	mcp.AddTool(server, &mcp.Tool{Name: "move_block", Description: "Move a scheduled block."}, s.moveBlock)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_block", Description: "Delete one scheduled block."}, s.deleteBlock)
	mcp.AddTool(server, &mcp.Tool{Name: "clear_task_blocks", Description: "Remove all blocks from a task."}, s.clearTaskBlocks)

	mcp.AddTool(server, &mcp.Tool{Name: "list_docs", Description: "List documents."}, s.listDocs)
	mcp.AddTool(server, &mcp.Tool{Name: "get_doc", Description: "Get a document as markdown."}, s.getDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "create_doc", Description: "Create a document from markdown."}, s.createDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "update_doc", Description: "Update a document (replace markdown, title, parent, …)."}, s.updateDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "append_to_doc", Description: "Append markdown to a document."}, s.appendToDoc)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_doc", Description: "Delete a document."}, s.deleteDoc)

	mcp.AddTool(server, &mcp.Tool{Name: "list_sheets", Description: "List sheets."}, s.listSheets)
	mcp.AddTool(server, &mcp.Tool{Name: "get_sheet", Description: "Get a sheet as a markdown table plus raw grid."}, s.getSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "create_sheet", Description: "Create a sheet."}, s.createSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "update_sheet", Description: "Update sheet title/description/project/favorite/archived."}, s.updateSheet)
	mcp.AddTool(server, &mcp.Tool{Name: "add_sheet_column", Description: "Add a column."}, s.addSheetColumn)
	mcp.AddTool(server, &mcp.Tool{Name: "update_sheet_column", Description: "Rename or retype a column."}, s.updateSheetColumn)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_sheet_column", Description: "Delete a column."}, s.deleteSheetColumn)
	mcp.AddTool(server, &mcp.Tool{Name: "add_sheet_rows", Description: "Append empty rows."}, s.addSheetRows)
	mcp.AddTool(server, &mcp.Tool{Name: "update_sheet_cells", Description: "Set cells in one row by column id."}, s.updateSheetCells)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_sheet_rows", Description: "Delete rows by id."}, s.deleteSheetRows)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_sheet", Description: "Delete a sheet."}, s.deleteSheet)

	mcp.AddTool(server, &mcp.Tool{Name: "list_task_views", Description: "Saved task list/kanban/gantt views."}, s.listTaskViews)
	mcp.AddTool(server, &mcp.Tool{Name: "create_task_view", Description: "Create a saved view."}, s.createTaskView)
	mcp.AddTool(server, &mcp.Tool{Name: "update_task_view", Description: "Update a saved view."}, s.updateTaskView)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_task_view", Description: "Delete a saved view."}, s.deleteTaskView)
	mcp.AddTool(server, &mcp.Tool{Name: "set_active_task_view", Description: "Select the active saved view."}, s.setActiveTaskView)

	mcp.AddTool(server, &mcp.Tool{Name: "get_profile", Description: "Current user profile."}, s.getProfile)
	mcp.AddTool(server, &mcp.Tool{Name: "update_profile", Description: "Update the user's display name."}, s.updateProfile)
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
