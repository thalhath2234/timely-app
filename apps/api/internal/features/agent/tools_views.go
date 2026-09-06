package agent

import (
	"context"
	"errors"
	"fmt"
	"timely-api/internal/models"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) loadConfig(uid string) (*models.Config, error) {
	cfg, err := s.Workspaces.GetConfig(uid)
	if err != nil {
		return nil, err
	}
	cfg.UserID = uid
	return cfg, nil
}

func (s *Server) listTaskViews(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d views (active %s)", len(cfg.TaskViews), cfg.ActiveTaskViewId), map[string]any{
		"activeTaskViewId": cfg.ActiveTaskViewId,
		"taskViews":        cfg.TaskViews,
	})
}

type createViewIn struct {
	Name                 string              `json:"name"`
	DataMode             string              `json:"dataMode,omitempty"`
	RenderMode           string              `json:"renderMode,omitempty"`
	GroupFields          []string            `json:"groupFields,omitempty"`
	GroupSortDirection   string              `json:"groupSortDirection,omitempty"`
	GroupValueOrders     map[string][]string `json:"groupValueOrders,omitempty"`
	SortBy               string              `json:"sortBy,omitempty"`
	SortDirection        string              `json:"sortDirection,omitempty"`
	SelectedWorkspaceIds []string            `json:"selectedWorkspaceIds,omitempty"`
	SelectedStatusIds    []string            `json:"selectedStatusIds,omitempty"`
	ColumnOrder          []string            `json:"columnOrder,omitempty"`
}

func viewFromInput(in createViewIn, existing *models.TaskViewConfig) models.TaskViewConfig {
	view := models.TaskViewConfig{
		ID:                   viewID(),
		Name:                 in.Name,
		DataMode:             models.DataModeTask,
		RenderMode:           models.RenderModeList,
		GroupFields:          in.GroupFields,
		GroupSortDirection:   models.SortDirectionAsc,
		GroupValueOrders:     in.GroupValueOrders,
		SortBy:               models.SortByDeadline,
		SortDirection:        models.SortDirectionAsc,
		SelectedWorkspaceIds: in.SelectedWorkspaceIds,
		SelectedStatusIds:    in.SelectedStatusIds,
		ColumnOrder:          in.ColumnOrder,
	}
	if existing != nil {
		view = *existing
		if in.Name != "" {
			view.Name = in.Name
		}
		if in.GroupFields != nil {
			view.GroupFields = in.GroupFields
		}
		if in.GroupValueOrders != nil {
			view.GroupValueOrders = in.GroupValueOrders
		}
		if in.SelectedWorkspaceIds != nil {
			view.SelectedWorkspaceIds = in.SelectedWorkspaceIds
		}
		if in.SelectedStatusIds != nil {
			view.SelectedStatusIds = in.SelectedStatusIds
		}
		if in.ColumnOrder != nil {
			view.ColumnOrder = in.ColumnOrder
		}
	}
	if in.DataMode != "" {
		view.DataMode = models.DataMode(in.DataMode)
	}
	if in.RenderMode != "" {
		view.RenderMode = models.RenderMode(in.RenderMode)
	}
	if in.GroupSortDirection != "" {
		view.GroupSortDirection = models.SortDirection(in.GroupSortDirection)
	}
	if in.SortBy != "" {
		view.SortBy = models.SortByField(in.SortBy)
	}
	if in.SortDirection != "" {
		view.SortDirection = models.SortDirection(in.SortDirection)
	}
	if view.GroupFields == nil {
		view.GroupFields = []string{}
	}
	if view.GroupValueOrders == nil {
		view.GroupValueOrders = map[string][]string{}
	}
	if view.SelectedWorkspaceIds == nil {
		view.SelectedWorkspaceIds = []string{}
	}
	if view.SelectedStatusIds == nil {
		view.SelectedStatusIds = []string{}
	}
	if view.ColumnOrder == nil {
		view.ColumnOrder = []string{}
	}
	return view
}

func (s *Server) createTaskView(ctx context.Context, req *mcp.CallToolRequest, in createViewIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	view := viewFromInput(in, nil)
	cfg.TaskViews = append(cfg.TaskViews, view)
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	return reply("created view "+view.Name, map[string]any{"view": view, "taskViews": updated.TaskViews})
}

type updateViewIn struct {
	createViewIn
	ViewID string `json:"viewId"`
}

func (s *Server) updateTaskView(ctx context.Context, req *mcp.CallToolRequest, in updateViewIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	found := -1
	for i, view := range cfg.TaskViews {
		if view.ID == in.ViewID {
			found = i
			break
		}
	}
	if found < 0 {
		return fail(errors.New("view not found"))
	}
	existing := cfg.TaskViews[found]
	cfg.TaskViews[found] = viewFromInput(in.createViewIn, &existing)
	cfg.TaskViews[found].ID = in.ViewID
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	return reply("updated view "+cfg.TaskViews[found].Name, map[string]any{"view": cfg.TaskViews[found], "taskViews": updated.TaskViews})
}

type viewIDIn struct {
	ViewID string `json:"viewId"`
}

func (s *Server) deleteTaskView(ctx context.Context, req *mcp.CallToolRequest, in viewIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	next := make(models.TaskViews, 0, len(cfg.TaskViews))
	for _, view := range cfg.TaskViews {
		if view.ID != in.ViewID {
			next = append(next, view)
		}
	}
	if len(next) == len(cfg.TaskViews) {
		return fail(errors.New("view not found"))
	}
	cfg.TaskViews = next
	if cfg.ActiveTaskViewId == in.ViewID {
		cfg.ActiveTaskViewId = ""
		if len(next) > 0 {
			cfg.ActiveTaskViewId = next[0].ID
		}
	}
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	return reply("view deleted", map[string]any{"id": in.ViewID, "activeTaskViewId": updated.ActiveTaskViewId, "taskViews": updated.TaskViews})
}

func (s *Server) setActiveTaskView(ctx context.Context, req *mcp.CallToolRequest, in viewIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	cfg.ActiveTaskViewId = in.ViewID
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	return reply("active view "+updated.ActiveTaskViewId, map[string]any{"activeTaskViewId": updated.ActiveTaskViewId})
}

func (s *Server) getProfile(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	user, onboarding, err := s.Auth.GetProfile(uid)
	if err != nil {
		return fail(err)
	}
	out := map[string]any{
		"id":                  user.ID,
		"email":               user.Email,
		"name":                user.Name,
		"onboardingCompleted": onboarding,
	}
	return reply(user.Email, out)
}

type updateProfileIn struct {
	Name string `json:"name"`
}

func (s *Server) updateProfile(ctx context.Context, req *mcp.CallToolRequest, in updateProfileIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	user, _, err := s.Auth.GetProfile(uid)
	if err != nil {
		return fail(err)
	}
	updated, _, err := s.Auth.UpdateProfile(uid, in.Name, user.Email, "", "")
	if err != nil {
		return fail(err)
	}
	return reply("updated name to "+updated.Name, map[string]any{"id": updated.ID, "email": updated.Email, "name": updated.Name})
}
