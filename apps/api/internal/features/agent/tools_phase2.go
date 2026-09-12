package agent

import (
	"context"
	"fmt"
	"timely-api/internal/features/task"
	"timely-api/internal/models"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type captureInboxIn struct {
	Name          string `json:"name"`
	PriorityLevel string `json:"priorityLevel,omitempty"`
	ProjectID     string `json:"projectId,omitempty"`
	WorkspaceID   string `json:"workspaceId,omitempty"`
}

func (s *Server) captureInboxItem(ctx context.Context, req *mcp.CallToolRequest, in captureInboxIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t := &models.Task{
		Name:          in.Name,
		UserID:        &uid,
		Kind:          models.KindInbox,
		Duration:      0,
		PriorityLevel: strPtr(in.PriorityLevel),
		ProjectID:     strPtr(in.ProjectID),
		WorkspaceID:   strPtr(in.WorkspaceID),
	}
	created, err := s.tasksFor(req).Create(t, nil, nil)
	if err != nil {
		return fail(err)
	}
	return reply("captured "+created.Name, taskPayload(created))
}

func (s *Server) listInbox(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	inbox := true
	tasks, err := s.tasksFor(req).List(uid, task.TaskFilter{Inbox: &inbox, Limit: 200})
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d inbox items", len(tasks)), map[string]any{"tasks": tasks})
}

type clarifyInboxIn struct {
	TaskID        string `json:"taskId"`
	Kind          string `json:"kind,omitempty" jsonschema:"task or reminder"`
	WorkspaceID   string `json:"workspaceId,omitempty"`
	Duration      *int   `json:"duration,omitempty"`
	ProjectID     string `json:"projectId,omitempty"`
	PriorityLevel string `json:"priorityLevel,omitempty"`
	ScheduleAt    string `json:"scheduleAt,omitempty"`
}

func (s *Server) clarifyInboxItem(ctx context.Context, req *mcp.CallToolRequest, in clarifyInboxIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	kind := in.Kind
	if kind == "" {
		if in.Duration != nil && *in.Duration > 0 {
			kind = models.KindTask
		} else {
			kind = models.KindReminder
		}
	}
	update := task.TaskUpdate{
		Kind:          &kind,
		WorkspaceID:   strPtr(in.WorkspaceID),
		Duration:      in.Duration,
		ProjectID:     strPtr(in.ProjectID),
		PriorityLevel: strPtr(in.PriorityLevel),
		ScheduledOn:   strPtr(in.ScheduleAt),
	}
	t, err := s.tasksFor(req).Update(uid, in.TaskID, update)
	if err != nil {
		return fail(err)
	}
	return reply("clarified "+t.Name, taskPayload(t))
}

type parentIDIn struct {
	ParentID string `json:"parentId"`
}

func (s *Server) listSubtasks(ctx context.Context, req *mcp.CallToolRequest, in parentIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	tasks, err := s.tasksFor(req).List(uid, task.TaskFilter{ParentID: in.ParentID, Limit: 200})
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d subtasks", len(tasks)), map[string]any{"tasks": tasks})
}

type createSubtaskIn struct {
	ParentID      string `json:"parentId"`
	Name          string `json:"name"`
	Duration      int    `json:"duration,omitempty"`
	PriorityLevel string `json:"priorityLevel,omitempty"`
}

func (s *Server) createSubtask(ctx context.Context, req *mcp.CallToolRequest, in createSubtaskIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	parent, err := s.Tasks.GetForUser(uid, in.ParentID)
	if err != nil {
		return fail(err)
	}
	t := &models.Task{
		Name:          in.Name,
		UserID:        &uid,
		ParentTaskID:  &in.ParentID,
		Duration:      in.Duration,
		Kind:          models.KindTask,
		WorkspaceID:   parent.WorkspaceID,
		ProjectID:     parent.ProjectID,
		PriorityLevel: strPtr(in.PriorityLevel),
	}
	created, err := s.tasksFor(req).Create(t, nil, nil)
	if err != nil {
		return fail(err)
	}
	return reply("created subtask "+created.Name, taskPayload(created))
}

type checklistAddIn struct {
	TaskID string `json:"taskId"`
	Title  string `json:"title"`
}

func (s *Server) addChecklistItem(ctx context.Context, req *mcp.CallToolRequest, in checklistAddIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).AddChecklistItem(uid, in.TaskID, in.Title)
	if err != nil {
		return fail(err)
	}
	return reply("added checklist item", taskPayload(t))
}

type checklistToggleIn struct {
	TaskID    string `json:"taskId"`
	ItemID    string `json:"itemId"`
	Completed bool   `json:"completed"`
}

func (s *Server) toggleChecklistItem(ctx context.Context, req *mcp.CallToolRequest, in checklistToggleIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).UpdateChecklistItem(uid, in.TaskID, in.ItemID, nil, &in.Completed)
	if err != nil {
		return fail(err)
	}
	return reply("updated checklist item", taskPayload(t))
}

type checklistDeleteIn struct {
	TaskID string `json:"taskId"`
	ItemID string `json:"itemId"`
}

func (s *Server) deleteChecklistItem(ctx context.Context, req *mcp.CallToolRequest, in checklistDeleteIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).DeleteChecklistItem(uid, in.TaskID, in.ItemID)
	if err != nil {
		return fail(err)
	}
	return reply("deleted checklist item", taskPayload(t))
}

func (s *Server) startFocus(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).StartFocus(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply("focusing "+t.Name, taskPayload(t))
}

func (s *Server) stopFocus(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).StopFocus(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply("stopped focus on "+t.Name, taskPayload(t))
}

type todayIn struct {
	Date     string `json:"date,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) getToday(ctx context.Context, req *mcp.CallToolRequest, in todayIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	today, err := s.Calendar.Today(uid, in.Date, in.Timezone)
	if err != nil {
		return fail(err)
	}
	return reply("today "+today.Date, today)
}

type todayFocusIn struct {
	TaskID string  `json:"taskId"`
	Date   *string `json:"date,omitempty" jsonschema:"YYYY-MM-DD; empty clears"`
}

func (s *Server) setTodayFocus(ctx context.Context, req *mcp.CallToolRequest, in todayFocusIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).SetTodayFocus(uid, in.TaskID, in.Date)
	if err != nil {
		return fail(err)
	}
	return reply("today focus updated", taskPayload(t))
}

func (s *Server) duplicateTask(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).Duplicate(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply("duplicated "+t.Name, taskPayload(t))
}

func (s *Server) duplicateProject(ctx context.Context, req *mcp.CallToolRequest, in projectIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	p, err := s.Projects.Duplicate(uid, in.ProjectID)
	if err != nil {
		return fail(err)
	}
	return reply("duplicated "+p.Title, map[string]any{"project": p})
}
