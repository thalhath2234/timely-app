package agent

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"timely-api/internal/features/project"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) projectFor(uid, projectID string) (*models.Project, error) {
	p, err := s.Projects.GetProjectById(uid, projectID)
	if err != nil {
		return nil, errors.New("project not found")
	}
	return p, nil
}

type listProjectsIn struct {
	WorkspaceID string `json:"workspaceId,omitempty"`
	StatusID    string `json:"statusId,omitempty"`
	Completed   *bool  `json:"completed,omitempty"`
}

func (s *Server) listProjects(ctx context.Context, req *mcp.CallToolRequest, in listProjectsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	projects, err := s.Projects.GetAllProjectByUser(uid)
	if err != nil {
		return fail(err)
	}
	out := make([]models.Project, 0, len(projects))
	for _, p := range projects {
		if in.WorkspaceID != "" && deref(p.WorkspaceID) != in.WorkspaceID {
			continue
		}
		if in.StatusID != "" && deref(p.StatusID) != in.StatusID {
			continue
		}
		if in.Completed != nil {
			done := p.CompletedAt != nil && *p.CompletedAt != ""
			if done != *in.Completed {
				continue
			}
		}
		out = append(out, p)
	}
	tasks, err := s.Tasks.List(uid, task.TaskFilter{Limit: 2000})
	if err != nil {
		return fail(err)
	}
	summaries := make([]map[string]any, 0, len(out))
	for _, p := range out {
		summaries = append(summaries, projectSummary(p, tasks))
	}
	return reply(fmt.Sprintf("%d projects", len(out)), map[string]any{"projects": out, "summaries": summaries})
}

type projectIDIn struct {
	ProjectID string `json:"projectId"`
}

func (s *Server) getProject(ctx context.Context, req *mcp.CallToolRequest, in projectIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	p, err := s.projectFor(uid, in.ProjectID)
	if err != nil {
		return fail(err)
	}
	tasks, err := s.Tasks.List(uid, task.TaskFilter{ProjectIDs: []string{p.ID}, Limit: 500})
	if err != nil {
		return fail(err)
	}
	summary := projectSummary(*p, tasks)
	payload := map[string]any{
		"project":   p,
		"markdown":  richtext.ToMarkdown(p.DescriptionRich),
		"taskCount": summary["total"],
		"openTasks": summary["open"],
		"doneTasks": summary["completed"],
		"progress":  summary["progress"],
		"scheduled": summary["scheduled"],
		"board":     projectBoard(p, tasks),
	}
	return reply(fmt.Sprintf("%s — %d open / %d done", p.Title, summary["open"], summary["completed"]), payload)
}

type createProjectIn struct {
	Title          string      `json:"title"`
	WorkspaceID    string      `json:"workspaceId"`
	Description    string      `json:"description,omitempty" jsonschema:"markdown"`
	StatusID       string      `json:"statusId,omitempty"`
	Deadline       string      `json:"deadline,omitempty"`
	StartDate      string      `json:"startDate,omitempty"`
	PriorityLevel  string      `json:"priorityLevel,omitempty"`
	Color          string      `json:"color,omitempty"`
	DoesHaveStages bool        `json:"doesHaveStages,omitempty"`
	CustomFields   []cfValueIn `json:"customFields,omitempty"`
}

func (s *Server) createProject(ctx context.Context, req *mcp.CallToolRequest, in createProjectIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	p := &models.Project{
		Title:          in.Title,
		WorkspaceID:    strPtr(in.WorkspaceID),
		StatusID:       strPtr(in.StatusID),
		Deadline:       strPtr(in.Deadline),
		StartDate:      strPtr(in.StartDate),
		PriorityLevel:  strPtr(in.PriorityLevel),
		Color:          strPtr(in.Color),
		DoesHaveStages: in.DoesHaveStages,
	}
	if in.Description != "" {
		rich, plain := md(in.Description)
		p.DescriptionRich = rich
		p.Description = plain
	}
	created, err := s.Projects.Create(uid, p, cfValues(in.CustomFields))
	if err != nil {
		return fail(err)
	}
	return reply("created "+created.Title, created)
}

type updateProjectIn struct {
	ProjectID      string  `json:"projectId"`
	Title          *string `json:"title,omitempty"`
	Description    *string `json:"description,omitempty" jsonschema:"markdown; empty string clears"`
	StatusID       *string `json:"statusId,omitempty"`
	Deadline       *string `json:"deadline,omitempty"`
	StartDate      *string `json:"startDate,omitempty"`
	CompletedAt    *string `json:"completedAt,omitempty"`
	PriorityLevel  *string `json:"priorityLevel,omitempty"`
	Color          *string `json:"color,omitempty"`
	DoesHaveStages *bool   `json:"doesHaveStages,omitempty"`
}

func (s *Server) updateProject(ctx context.Context, req *mcp.CallToolRequest, in updateProjectIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	update := project.ProjectUpdate{
		Title:          in.Title,
		StatusID:       in.StatusID,
		Deadline:       in.Deadline,
		StartDate:      in.StartDate,
		CompletedAt:    in.CompletedAt,
		PriorityLevel:  in.PriorityLevel,
		Color:          in.Color,
		DoesHaveStages: in.DoesHaveStages,
	}
	if in.Description != nil {
		rich, plain := md(*in.Description)
		update.Description = &plain
		update.DescriptionRich = &rich
	}
	p, err := s.Projects.Update(uid, in.ProjectID, update)
	if err != nil {
		return fail(err)
	}
	return reply("updated "+p.Title, p)
}

func (s *Server) completeProject(ctx context.Context, req *mcp.CallToolRequest, in projectIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	now := nowRFC()
	p, err := s.Projects.Update(uid, in.ProjectID, project.ProjectUpdate{CompletedAt: &now})
	if err != nil {
		return fail(err)
	}
	return reply("completed "+p.Title, p)
}

func (s *Server) reopenProject(ctx context.Context, req *mcp.CallToolRequest, in projectIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	empty := ""
	p, err := s.Projects.Update(uid, in.ProjectID, project.ProjectUpdate{CompletedAt: &empty})
	if err != nil {
		return fail(err)
	}
	return reply("reopened "+p.Title, p)
}

type deleteProjectIn struct {
	ProjectID string `json:"projectId"`
	Confirm   bool   `json:"confirm"`
}

func (s *Server) deleteProject(ctx context.Context, req *mcp.CallToolRequest, in deleteProjectIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := confirmOrFail(in.Confirm, "delete this project and its tasks"); err != nil {
		return fail(err)
	}
	if err := s.Projects.Delete(uid, in.ProjectID); err != nil {
		return fail(err)
	}
	return reply("project deleted", map[string]string{"id": in.ProjectID})
}

type createStageIn struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
}

func (s *Server) createStage(ctx context.Context, req *mcp.CallToolRequest, in createStageIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	stage, err := s.Projects.CreateStage(uid, in.ProjectID, in.Name)
	if err != nil {
		return fail(err)
	}
	return reply("created stage "+stage.Name, stage)
}

type updateStageIn struct {
	ProjectID string `json:"projectId"`
	StageID   string `json:"stageId"`
	Name      string `json:"name"`
}

func (s *Server) updateStage(ctx context.Context, req *mcp.CallToolRequest, in updateStageIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	stage, err := s.Projects.UpdateStage(uid, in.ProjectID, in.StageID, in.Name)
	if err != nil {
		return fail(err)
	}
	return reply("updated stage "+stage.Name, stage)
}

type deleteStageIn struct {
	ProjectID string `json:"projectId"`
	StageID   string `json:"stageId"`
}

func (s *Server) deleteStage(ctx context.Context, req *mcp.CallToolRequest, in deleteStageIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := s.Projects.DeleteStage(uid, in.ProjectID, in.StageID); err != nil {
		return fail(err)
	}
	return reply("stage deleted", map[string]string{"id": in.StageID})
}

type reorderStagesIn struct {
	ProjectID string   `json:"projectId"`
	IDs       []string `json:"ids"`
}

func (s *Server) reorderStages(ctx context.Context, req *mcp.CallToolRequest, in reorderStagesIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	stages, err := s.Projects.ReorderStages(uid, in.ProjectID, in.IDs)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("reordered %d stages", len(stages)), map[string]any{"stages": stages})
}

func projectSummary(p models.Project, tasks []models.Task) map[string]any {
	open, done, scheduled := 0, 0, 0
	nextDeadline := deref(p.Deadline)
	for _, t := range tasks {
		if deref(t.ProjectID) != p.ID || t.IsReminder() || t.IsInbox() || t.IsSubtask() {
			continue
		}
		if t.IsCompleted() {
			done++
			continue
		}
		open++
		if deref(t.ScheduledOn) != "" || len(t.Blocks) > 0 {
			scheduled++
		}
		if d := deref(t.Deadline); d != "" && (nextDeadline == "" || d < nextDeadline) {
			nextDeadline = d
		}
	}
	total := open + done
	progress := 0
	if total > 0 {
		progress = (done * 100) / total
	}
	stageNames := make([]string, 0, len(p.Stages))
	for _, stage := range sortedProjectStages(p.Stages) {
		stageNames = append(stageNames, stage.Name)
	}
	return map[string]any{
		"id":             p.ID,
		"title":          p.Title,
		"workspaceId":    deref(p.WorkspaceID),
		"statusId":       deref(p.StatusID),
		"priorityLevel":  deref(p.PriorityLevel),
		"deadline":       deref(p.Deadline),
		"startDate":      deref(p.StartDate),
		"completed":      p.CompletedAt != nil && *p.CompletedAt != "",
		"doesHaveStages": p.DoesHaveStages,
		"stages":         stageNames,
		"open":           open,
		"completedCount": done,
		"total":          total,
		"scheduled":      scheduled,
		"progress":       progress,
		"nextDeadline":   nextDeadline,
	}
}

func projectBoard(p *models.Project, tasks []models.Task) []map[string]any {
	type column struct {
		id, name string
		items    []map[string]any
	}
	known := map[string]int{}
	cols := []column{{id: "", name: "Unstaged"}}
	if p != nil {
		for _, stage := range sortedProjectStages(p.Stages) {
			known[stage.ID] = len(cols)
			cols = append(cols, column{id: stage.ID, name: stage.Name})
		}
	}
	for _, t := range tasks {
		if t.IsReminder() || t.IsInbox() || t.IsSubtask() {
			continue
		}
		idx := 0
		if id := deref(t.StageID); id != "" {
			if found, ok := known[id]; ok {
				idx = found
			}
		}
		cols[idx].items = append(cols[idx].items, map[string]any{
			"id":            t.ID,
			"name":          t.Name,
			"statusId":      deref(t.StatusID),
			"priorityLevel": deref(t.PriorityLevel),
			"deadline":      deref(t.Deadline),
			"completed":     t.IsCompleted(),
		})
	}
	out := make([]map[string]any, 0, len(cols))
	for _, col := range cols {
		if col.items == nil {
			col.items = []map[string]any{}
		}
		out = append(out, map[string]any{
			"stageId": col.id,
			"name":    col.name,
			"count":   len(col.items),
			"tasks":   col.items,
		})
	}
	return out
}

func sortedProjectStages(stages []*models.Stage) []*models.Stage {
	out := make([]*models.Stage, 0, len(stages))
	for _, stage := range stages {
		if stage != nil {
			out = append(out, stage)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].Name < out[j].Name
	})
	return out
}
