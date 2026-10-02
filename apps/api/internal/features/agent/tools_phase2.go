package agent

import (
	"context"
	"fmt"
	"timely-api/internal/features/task"
	"timely-api/internal/models"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type captureInboxIn struct {
	Name string `json:"name"`
}

func (s *Server) captureInboxItem(ctx context.Context, req *mcp.CallToolRequest, in captureInboxIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	created, err := s.tasksFor(req).Capture(uid, in.Name)
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
	duration := 0
	if in.Duration != nil {
		duration = *in.Duration
	}
	kind := in.Kind
	if kind == "" {
		if duration > 0 {
			kind = models.KindTask
		} else {
			kind = models.KindReminder
		}
	}
	t, err := s.tasksFor(req).Clarify(uid, in.TaskID, task.ClarifyInput{
		Kind:          kind,
		WorkspaceID:   strPtr(in.WorkspaceID),
		Duration:      duration,
		ProjectID:     strPtr(in.ProjectID),
		PriorityLevel: strPtr(in.PriorityLevel),
		ScheduledOn:   strPtr(in.ScheduleAt),
	})
	if err != nil {
		return fail(err)
	}
	return reply("clarified "+t.Name, taskPayload(t))
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

func (s *Server) pauseFocus(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).PauseFocus(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply("paused focus on "+t.Name, taskPayload(t))
}

type checklistUpdateIn struct {
	TaskID    string  `json:"taskId"`
	ItemID    string  `json:"itemId"`
	Title     *string `json:"title,omitempty"`
	Completed *bool   `json:"completed,omitempty"`
}

func (s *Server) updateChecklistItem(ctx context.Context, req *mcp.CallToolRequest, in checklistUpdateIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).UpdateChecklistItem(uid, in.TaskID, in.ItemID, in.Title, in.Completed)
	if err != nil {
		return fail(err)
	}
	return reply("updated checklist item", taskPayload(t))
}

type checklistItemIn struct {
	ID          string  `json:"id,omitempty"`
	Title       string  `json:"title"`
	Completed   *bool   `json:"completed,omitempty"`
	CompletedAt *string `json:"completedAt,omitempty"`
	Order       int     `json:"order,omitempty"`
}

type checklistReplaceIn struct {
	TaskID string            `json:"taskId"`
	Items  []checklistItemIn `json:"items"`
}

func checklistFromInput(items []checklistItemIn) models.Checklist {
	out := make(models.Checklist, 0, len(items))
	for _, item := range items {
		next := models.ChecklistItem{ID: item.ID, Title: item.Title, Order: item.Order, CompletedAt: item.CompletedAt}
		if item.Completed != nil && *item.Completed && (next.CompletedAt == nil || *next.CompletedAt == "") {
			now := nowRFC()
			next.CompletedAt = &now
		}
		if item.Completed != nil && !*item.Completed {
			next.CompletedAt = nil
		}
		out = append(out, next)
	}
	return out
}

func (s *Server) replaceChecklist(ctx context.Context, req *mcp.CallToolRequest, in checklistReplaceIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.tasksFor(req).ReplaceChecklist(uid, in.TaskID, checklistFromInput(in.Items))
	if err != nil {
		return fail(err)
	}
	return reply("replaced checklist", taskPayload(t))
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
	today, err := s.Calendar.Today(uid, in.Date, zone(ctx, in.Timezone))
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
