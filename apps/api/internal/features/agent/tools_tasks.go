package agent

import (
	"context"
	"fmt"
	"strings"
	"timely-api/internal/features/task"
	"timely-api/internal/models"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listTasksIn struct {
	WorkspaceID  string   `json:"workspaceId,omitempty"`
	WorkspaceIDs []string `json:"workspaceIds,omitempty"`
	ProjectID    string   `json:"projectId,omitempty"`
	ProjectIDs   []string `json:"projectIds,omitempty"`
	StatusID     string   `json:"statusId,omitempty"`
	StatusIDs    []string `json:"statusIds,omitempty"`
	LabelID      string   `json:"labelId,omitempty"`
	LabelIDs     []string `json:"labelIds,omitempty"`
	Priority     string   `json:"priority,omitempty"`
	StageID      string   `json:"stageId,omitempty"`
	Completed    *bool    `json:"completed,omitempty"`
	Overdue      *bool    `json:"overdue,omitempty"`
	DueBefore    string   `json:"dueBefore,omitempty"`
	DueAfter     string   `json:"dueAfter,omitempty"`
	Scheduled    *bool    `json:"scheduled,omitempty"`
	Recurring    *bool    `json:"recurring,omitempty"`
	Reminders    *bool    `json:"reminders,omitempty" jsonschema:"true lists duration-0 reminders instead of work tasks"`
	Kind         string   `json:"kind,omitempty" jsonschema:"task, reminder, or inbox"`
	Inbox        *bool    `json:"inbox,omitempty"`
	Text         string   `json:"text,omitempty"`
	Sort         string   `json:"sort,omitempty"`
	Limit        int      `json:"limit,omitempty"`
	Offset       int      `json:"offset,omitempty"`
}

func (in listTasksIn) filter() task.TaskFilter {
	return task.TaskFilter{
		WorkspaceIDs:  appendID(in.WorkspaceIDs, in.WorkspaceID),
		ProjectIDs:    appendID(in.ProjectIDs, in.ProjectID),
		StatusIDs:     appendID(in.StatusIDs, in.StatusID),
		LabelIDs:      appendID(in.LabelIDs, in.LabelID),
		Priority:      in.Priority,
		StageID:       in.StageID,
		Completed:     in.Completed,
		Overdue:       in.Overdue,
		DueBefore:     in.DueBefore,
		DueAfter:      in.DueAfter,
		Scheduled:     in.Scheduled,
		HasRecurrence: in.Recurring,
		Reminders:     in.Reminders,
		Kind:          in.Kind,
		Inbox:         in.Inbox,
		Text:          in.Text,
		Sort:          in.Sort,
		Limit:         in.Limit,
		Offset:        in.Offset,
	}
}

func appendID(ids []string, id string) []string {
	if id == "" {
		return ids
	}
	return append(append([]string{}, ids...), id)
}

func (s *Server) listTasks(ctx context.Context, req *mcp.CallToolRequest, in listTasksIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	tasks, err := s.tasksFor(req).List(uid, in.filter())
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d tasks", len(tasks)), map[string]any{"tasks": tasks})
}

func (s *Server) getTask(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.Tasks.GetForUser(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	activity, _ := s.Tasks.ListActivity(uid, in.TaskID)
	if len(activity) > 20 {
		activity = activity[:20]
	}
	payload := taskPayload(t)
	payload["activity"] = activity
	return reply(t.Name, payload)
}

type createTaskIn struct {
	Name          string      `json:"name"`
	WorkspaceID   string      `json:"workspaceId,omitempty" jsonschema:"required for work; ask the user unless specified in this request; optional on reminders when setting labels or custom fields"`
	Description   string      `json:"description,omitempty" jsonschema:"markdown"`
	Duration      *int        `json:"duration,omitempty" jsonschema:"minutes of work; defaults to 30 when omitted; must be positive if supplied for Work"`
	Kind          string      `json:"kind,omitempty" jsonschema:"task by default; use reminder only for a timed ping; use capture_inbox_item for Inbox"`
	Deadline      string      `json:"deadline,omitempty"`
	StartDate     string      `json:"startDate,omitempty"`
	ScheduleAt    string      `json:"scheduleAt,omitempty" jsonschema:"RFC3339 ping time for a reminder, or start of the first work block"`
	ProjectID     string      `json:"projectId,omitempty"`
	StatusID      string      `json:"statusId,omitempty"`
	PriorityLevel string      `json:"priorityLevel,omitempty"`
	StageID       string      `json:"stageId,omitempty"`
	BlockedByID   string      `json:"blockedById,omitempty"`
	ParentTaskID  *string     `json:"parentTaskId,omitempty" jsonschema:"-"`
	LabelIDs      []string    `json:"labelIds,omitempty"`
	CustomFields  []cfValueIn `json:"customFields,omitempty"`
	Recurrence    *recIn      `json:"recurrence,omitempty"`
}

// prepareCreateTask makes the default create_task intent Work. Work without
// an estimate gets 30 minutes; Hermes asks for a missing workspace.
func prepareCreateTask(in createTaskIn) (createTaskIn, error) {
	if in.Kind == "" {
		in.Kind = models.KindTask
	}
	kind, err := models.NormalizeKind(in.Kind)
	if err != nil {
		return in, err
	}
	if kind == models.KindInbox {
		return in, fmt.Errorf("use capture_inbox_item to capture a thought in Inbox")
	}
	in.Kind = kind
	if in.Kind == models.KindTask {
		if strings.TrimSpace(in.WorkspaceID) == "" {
			return in, fmt.Errorf("ask the user which workspace to use for this task, then retry create_task")
		}
		if in.Duration == nil {
			defaultDuration := 30
			in.Duration = &defaultDuration
		} else if *in.Duration <= 0 {
			return in, fmt.Errorf("work duration must be greater than 0 minutes")
		}
	}
	return in, nil
}

func (s *Server) createTask(ctx context.Context, req *mcp.CallToolRequest, in createTaskIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	in, err = prepareCreateTask(in)
	if err != nil {
		return fail(err)
	}
	if in.ParentTaskID != nil {
		return fail(fmt.Errorf("parentTaskId is no longer supported; nested tasks were removed"))
	}
	kind := in.Kind
	duration := 0
	if in.Duration != nil {
		duration = *in.Duration
	}
	if kind == models.KindReminder {
		in.ProjectID = ""
		in.StatusID = ""
		in.StageID = ""
		if len(in.LabelIDs) == 0 && len(in.CustomFields) == 0 {
			in.WorkspaceID = ""
		}
	}
	t := &models.Task{
		Name:          in.Name,
		UserID:        &uid,
		WorkspaceID:   strPtr(in.WorkspaceID),
		Duration:      duration,
		Kind:          kind,
		Deadline:      strPtr(in.Deadline),
		StartDate:     strPtr(in.StartDate),
		ScheduledOn:   strPtr(in.ScheduleAt),
		ProjectID:     strPtr(in.ProjectID),
		StatusID:      strPtr(in.StatusID),
		PriorityLevel: strPtr(in.PriorityLevel),
		StageID:       strPtr(in.StageID),
		BlockedByID:   strPtr(in.BlockedByID),
		LabelIDs:      labelInputs(in.LabelIDs),
	}
	if in.Description != "" {
		rich, plain := md(in.Description)
		t.DescriptionRich = rich
		t.Description = plain
	}
	var rec *models.RecurrenceInput
	if in.Recurrence != nil {
		rec = in.Recurrence.model()
	}
	created, err := s.tasksFor(req).Create(t, cfValues(in.CustomFields), rec)
	if err != nil {
		return fail(err)
	}
	return reply("created "+created.Name, taskPayload(created))
}

type updateTaskIn struct {
	TaskID                string      `json:"taskId,omitempty"`
	Name                  *string     `json:"name,omitempty"`
	Description           *string     `json:"description,omitempty" jsonschema:"markdown"`
	Duration              *int        `json:"duration,omitempty"`
	Deadline              *string     `json:"deadline,omitempty"`
	StartDate             *string     `json:"startDate,omitempty"`
	ScheduledOn           *string     `json:"scheduledOn,omitempty"`
	ScheduleAt            *string     `json:"scheduleAt,omitempty" jsonschema:"alias for scheduledOn"`
	CompletedAt           *string     `json:"completedAt,omitempty"`
	WorkspaceID           *string     `json:"workspaceId,omitempty"`
	ProjectID             *string     `json:"projectId,omitempty"`
	StatusID              *string     `json:"statusId,omitempty"`
	PriorityLevel         *string     `json:"priorityLevel,omitempty"`
	StageID               *string     `json:"stageId,omitempty"`
	BlockedByID           *string     `json:"blockedById,omitempty"`
	ParentTaskID          *string     `json:"parentTaskId,omitempty" jsonschema:"-"`
	Kind                  *string     `json:"kind,omitempty" jsonschema:"task, reminder, or inbox"`
	TodayFocusOn          *string     `json:"todayFocusOn,omitempty"`
	MinChunkMinutes       *int        `json:"minChunkMinutes,omitempty"`
	PreferredChunkMinutes *int        `json:"preferredChunkMinutes,omitempty"`
	Contiguous            *bool       `json:"contiguous,omitempty"`
	EarliestStartAt       *string     `json:"earliestStartAt,omitempty"`
	ScheduleLocked        *bool       `json:"scheduleLocked,omitempty"`
	LabelIDs              []string    `json:"labelIds,omitempty"`
	CustomFields          []cfValueIn `json:"customFields,omitempty"`
	Recurrence            *recIn      `json:"recurrence,omitempty"`
	ClearRecurrence       bool        `json:"clearRecurrence,omitempty"`
}

func (in updateTaskIn) toUpdate() task.TaskUpdate {
	scheduledOn := in.ScheduledOn
	if scheduledOn == nil {
		scheduledOn = in.ScheduleAt
	}
	update := task.TaskUpdate{
		Name:                  in.Name,
		Duration:              in.Duration,
		Deadline:              in.Deadline,
		StartDate:             in.StartDate,
		ScheduledOn:           scheduledOn,
		CompletedAt:           in.CompletedAt,
		WorkspaceID:           in.WorkspaceID,
		ProjectID:             in.ProjectID,
		StatusID:              in.StatusID,
		PriorityLevel:         in.PriorityLevel,
		StageID:               in.StageID,
		BlockedByID:           in.BlockedByID,
		Kind:                  in.Kind,
		TodayFocusOn:          in.TodayFocusOn,
		MinChunkMinutes:       in.MinChunkMinutes,
		PreferredChunkMinutes: in.PreferredChunkMinutes,
		Contiguous:            in.Contiguous,
		EarliestStartAt:       in.EarliestStartAt,
		ScheduleLocked:        in.ScheduleLocked,
	}
	if in.Description != nil {
		rich, plain := md(*in.Description)
		update.Description = &plain
		update.DescriptionRich = &rich
	}
	if in.LabelIDs != nil {
		labels := labelInputs(in.LabelIDs)
		update.LabelIDs = &labels
	}
	if in.CustomFields != nil {
		values := cfValues(in.CustomFields)
		update.CustomFieldValues = &values
	}
	if in.ClearRecurrence {
		update.RecurrenceSet = true
		update.Recurrence = nil
	} else if in.Recurrence != nil {
		update.RecurrenceSet = true
		update.Recurrence = in.Recurrence.model()
	}
	return update
}

func (s *Server) updateTask(ctx context.Context, req *mcp.CallToolRequest, in updateTaskIn) (*mcp.CallToolResult, any, error) {
	if in.TaskID == "" {
		return fail(fmt.Errorf("taskId is required"))
	}
	if in.ParentTaskID != nil {
		return fail(fmt.Errorf("parentTaskId is no longer supported; nested tasks were removed"))
	}
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, in.toUpdate())
	if err != nil {
		return fail(err)
	}
	return reply("updated "+t.Name, taskPayload(t))
}

type bulkUpdateIn struct {
	IDs    []string     `json:"ids"`
	Update updateTaskIn `json:"update"`
}

func (s *Server) bulkUpdateTasks(ctx context.Context, req *mcp.CallToolRequest, in bulkUpdateIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	tasks, err := s.tasksFor(req).BulkUpdate(uid, in.IDs, in.Update.toUpdate())
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("updated %d tasks", len(tasks)), map[string]any{"tasks": tasks})
}

func (s *Server) completeTask(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	now := nowRFC()
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{CompletedAt: &now})
	if err != nil {
		return fail(err)
	}
	return reply("completed "+t.Name, taskPayload(t))
}

func (s *Server) reopenTask(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	empty := ""
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{CompletedAt: &empty})
	if err != nil {
		return fail(err)
	}
	return reply("reopened "+t.Name, taskPayload(t))
}

type moveTaskStatusIn struct {
	TaskID   string `json:"taskId"`
	StatusID string `json:"statusId" jsonschema:"workspace status id (tst_); empty clears status"`
}

func (s *Server) moveTaskToStatus(ctx context.Context, req *mcp.CallToolRequest, in moveTaskStatusIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{StatusID: emptyPtr(in.StatusID)})
	if err != nil {
		return fail(err)
	}
	return reply("moved "+t.Name+" to status "+in.StatusID, taskPayload(t))
}

type moveTaskStageIn struct {
	TaskID  string `json:"taskId"`
	StageID string `json:"stageId,omitempty" jsonschema:"stg_ id; omit or empty to unstage"`
}

func (s *Server) moveTaskToStage(ctx context.Context, req *mcp.CallToolRequest, in moveTaskStageIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{StageID: emptyPtr(in.StageID)})
	if err != nil {
		return fail(err)
	}
	label := "Unstaged"
	if in.StageID != "" {
		label = in.StageID
	}
	return reply("moved "+t.Name+" to "+label, taskPayload(t))
}

func (s *Server) deleteTask(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := s.tasksFor(req).Delete(uid, in.TaskID); err != nil {
		return fail(err)
	}
	return reply("task deleted", map[string]string{"id": in.TaskID})
}

type setLabelsIn struct {
	TaskID   string   `json:"taskId"`
	LabelIDs []string `json:"labelIds"`
}

func (s *Server) setTaskLabels(ctx context.Context, req *mcp.CallToolRequest, in setLabelsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	labels := labelInputs(in.LabelIDs)
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{LabelIDs: &labels})
	if err != nil {
		return fail(err)
	}
	return reply("labels updated on "+t.Name, taskPayload(t))
}

type setCFIn struct {
	TaskID        string   `json:"taskId"`
	CustomFieldID string   `json:"customFieldId"`
	StringValue   string   `json:"stringValue,omitempty"`
	OptionIDs     []string `json:"optionIds,omitempty"`
	Clear         bool     `json:"clear,omitempty"`
}

func (s *Server) setTaskCustomField(ctx context.Context, req *mcp.CallToolRequest, in setCFIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	item := cfValueIn{CustomFieldID: in.CustomFieldID, OptionIDs: in.OptionIDs}
	if !in.Clear {
		item.StringValue = in.StringValue
	}
	values := cfValues([]cfValueIn{item})
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{CustomFieldValues: &values})
	if err != nil {
		return fail(err)
	}
	return reply("custom field updated on "+t.Name, taskPayload(t))
}

type setDepIn struct {
	TaskID      string `json:"taskId"`
	BlockedByID string `json:"blockedById,omitempty" jsonschema:"empty clears the dependency"`
	Clear       bool   `json:"clear,omitempty"`
}

func (s *Server) setTaskDependency(ctx context.Context, req *mcp.CallToolRequest, in setDepIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	blocked := in.BlockedByID
	if in.Clear {
		blocked = ""
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{BlockedByID: &blocked})
	if err != nil {
		return fail(err)
	}
	return reply("dependency updated on "+t.Name, taskPayload(t))
}

type commentIn struct {
	TaskID  string `json:"taskId"`
	Comment string `json:"comment"`
}

func (s *Server) addTaskComment(ctx context.Context, req *mcp.CallToolRequest, in commentIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	entry, err := s.tasksFor(req).AddComment(uid, in.TaskID, in.Comment)
	if err != nil {
		return fail(err)
	}
	return reply("comment added", entry)
}

func (s *Server) listTaskActivity(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	entries, err := s.Tasks.ListActivity(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d activity entries", len(entries)), map[string]any{"activity": entries})
}

type setRecurrenceIn struct {
	TaskID   string `json:"taskId"`
	RRule    string `json:"rrule"`
	Dtstart  string `json:"dtstart,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) setTaskRecurrence(ctx context.Context, req *mcp.CallToolRequest, in setRecurrenceIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	rec := recIn{RRule: in.RRule, Dtstart: in.Dtstart, Timezone: in.Timezone}.model()
	if rec == nil {
		return fail(fmt.Errorf("rrule is required"))
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{RecurrenceSet: true, Recurrence: rec})
	if err != nil {
		return fail(err)
	}
	return reply("recurrence set on "+t.Name, taskPayload(t))
}

func (s *Server) clearTaskRecurrence(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, task.TaskUpdate{RecurrenceSet: true, Recurrence: nil})
	if err != nil {
		return fail(err)
	}
	return reply("recurrence cleared on "+t.Name, taskPayload(t))
}

type editOccIn struct {
	TaskID        string `json:"taskId"`
	OriginalStart string `json:"originalStart"`
	Action        string `json:"action" jsonschema:"complete, uncomplete, skip, restore, or move"`
	NewStart      string `json:"newStart,omitempty"`
	NewEnd        string `json:"newEnd,omitempty"`
}

func (s *Server) editTaskOccurrence(ctx context.Context, req *mcp.CallToolRequest, in editOccIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).EditOccurrence(uid, in.TaskID, task.OccurrenceAction{
		OriginalStart: in.OriginalStart,
		Action:        in.Action,
		NewStart:      strPtr(in.NewStart),
		NewEnd:        strPtr(in.NewEnd),
	})
	if err != nil {
		return fail(err)
	}
	return reply(in.Action+" occurrence of "+t.Name, taskPayload(t))
}

type splitTaskIn struct {
	TaskID    string `json:"taskId"`
	FromStart string `json:"fromStart"`
	RRule     string `json:"rrule"`
	Dtstart   string `json:"dtstart,omitempty"`
	Timezone  string `json:"timezone,omitempty"`
	Name      string `json:"name,omitempty"`
	Duration  *int   `json:"duration,omitempty"`
}

func (s *Server) splitTaskSeries(ctx context.Context, req *mcp.CallToolRequest, in splitTaskIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	input := task.SplitInput{
		FromStart: in.FromStart,
		Duration:  in.Duration,
		Recurrence: models.RecurrenceInput{
			RRule:    in.RRule,
			Dtstart:  in.Dtstart,
			Timezone: in.Timezone,
		},
	}
	if in.Name != "" {
		input.Name = &in.Name
	}
	t, err := s.tasksFor(req).Split(uid, in.TaskID, input)
	if err != nil {
		return fail(err)
	}
	return reply("split series; new task "+t.Name, taskPayload(t))
}
