package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

// viewSet is the saved views a call acts on: the phone app's own views when
// the chat message came from the phone, else the web and desktop views.
type viewSet struct {
	phone  bool
	views  *models.TaskViews
	active *string
}

func viewsOf(ctx context.Context, cfg *models.Config) viewSet {
	if ClientFrom(ctx) != ClientPhone {
		return viewSet{views: &cfg.TaskViews, active: &cfg.ActiveTaskViewId}
	}
	if len(cfg.MobileTaskViews) == 0 {
		// Until the phone uploads its device views it shows its built-in ones.
		cfg.MobileTaskViews = models.DefaultMobileTaskViews()
		cfg.MobileActiveTaskViewId = cfg.MobileTaskViews[0].ID
	}
	return viewSet{phone: true, views: &cfg.MobileTaskViews, active: &cfg.MobileActiveTaskViewId}
}

// on names the views in tool results so the model and the change cards know
// which app shows them.
func (v viewSet) on() string {
	if v.phone {
		return ClientPhone
	}
	return ClientWeb
}

func (v viewSet) noun() string {
	if v.phone {
		return "phone view"
	}
	return "web and desktop view"
}

// find returns the index of a view by id, else by name (ignoring case).
func (v viewSet) find(ref string) int {
	ref = strings.TrimSpace(ref)
	for i, view := range *v.views {
		if view.ID == ref {
			return i
		}
	}
	for i, view := range *v.views {
		if ref != "" && strings.EqualFold(strings.TrimSpace(view.Name), ref) {
			return i
		}
	}
	return -1
}

func (v viewSet) notFound(ref string) error {
	names := make([]string, 0, len(*v.views))
	for _, view := range *v.views {
		names = append(names, view.Name)
	}
	return fmt.Errorf("no %s %q; the %ss are: %s", v.noun(), ref, v.noun(), strings.Join(names, ", "))
}

// phoneViewNote is told to the model with every phone view result.
const phoneViewNote = "These are the phone app's own saved views, apart from the web and desktop views. The phone shows them as a list or a board (kanban) only."

// fitToPhone keeps a phone view to what the phone can show: a list or a
// board of work. It returns what was changed, for the model to tell the person.
func fitToPhone(view *models.TaskViewConfig) string {
	switch {
	case view.RenderMode == models.RenderModeGantt:
		view.RenderMode = models.RenderModeList
		return "The phone has no timeline, so this phone view is a list."
	case view.RenderMode == models.RenderModeKanban && view.DataMode == models.DataModeProject:
		view.RenderMode = models.RenderModeList
		return "The phone shows projects as a list only, so this phone view is a list."
	}
	return ""
}

func viewResult(set viewSet, extra map[string]any) map[string]any {
	out := map[string]any{"viewsOn": set.on()}
	if set.phone {
		out["note"] = phoneViewNote
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
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
	set := viewsOf(ctx, cfg)
	return reply(fmt.Sprintf("%d %ss (active %s)", len(*set.views), set.noun(), *set.active), viewResult(set, map[string]any{
		"activeTaskViewId": *set.active,
		"taskViews":        *set.views,
	}))
}

type createViewIn struct {
	Name                   string              `json:"name,omitempty" jsonschema:"short name for the view, from the person's words"`
	DataMode               string              `json:"dataMode,omitempty" jsonschema:"task (default) lists work; project lists projects"`
	RenderMode             string              `json:"renderMode,omitempty" jsonschema:"list (default), kanban (board) or gantt (timeline, web and desktop only)"`
	GroupFields            []string            `json:"groupFields,omitempty" jsonschema:"up to 3 of workspace, project, stage, status, priority, or a custom field name"`
	GroupSortDirection     string              `json:"groupSortDirection,omitempty" jsonschema:"asc or desc"`
	GroupValueOrders       map[string][]string `json:"groupValueOrders,omitempty"`
	SortBy                 string              `json:"sortBy,omitempty" jsonschema:"name, deadline (default), startDate, scheduledOn, createdAt, priority, status or project"`
	SortDirection          string              `json:"sortDirection,omitempty" jsonschema:"asc or desc"`
	SelectedWorkspaceIds   []string            `json:"selectedWorkspaceIds,omitempty" jsonschema:"workspace names or ids"`
	SelectedStatusIds      []string            `json:"selectedStatusIds,omitempty" jsonschema:"status names or ids; a name means that status in every chosen workspace"`
	SelectedProjectIds     []string            `json:"selectedProjectIds,omitempty" jsonschema:"project titles or ids"`
	SelectedPriorityLevels []string            `json:"selectedPriorityLevels,omitempty" jsonschema:"Low, Medium, High or Urgent"`
	SelectedLabelIds       []string            `json:"selectedLabelIds,omitempty" jsonschema:"label names or ids"`
	SelectedStageIds       []string            `json:"selectedStageIds,omitempty" jsonschema:"project stage names or ids"`
	ShowCompleted          *bool               `json:"showCompleted,omitempty" jsonschema:"false hides finished work"`
	OnlyOverdue            *bool               `json:"onlyOverdue,omitempty" jsonschema:"only work past its deadline"`
	OnlyScheduled          *bool               `json:"onlyScheduled,omitempty" jsonschema:"only work with time on the calendar"`
	OnlyRecurring          *bool               `json:"onlyRecurring,omitempty" jsonschema:"only repeating work"`
	OnlyDated              *bool               `json:"onlyDated,omitempty" jsonschema:"only work with a deadline or planned time"`
	ShowReminders          *bool               `json:"showReminders,omitempty" jsonschema:"list reminders instead of work"`
	ColumnOrder            []string            `json:"columnOrder,omitempty"`
}

func viewFromInput(in createViewIn, existing *models.TaskViewConfig) models.TaskViewConfig {
	view := models.TaskViewConfig{
		ID:                     viewID(),
		Name:                   in.Name,
		DataMode:               models.DataModeTask,
		RenderMode:             models.RenderModeList,
		GroupFields:            in.GroupFields,
		GroupSortDirection:     models.SortDirectionAsc,
		GroupValueOrders:       in.GroupValueOrders,
		SortBy:                 models.SortByDeadline,
		SortDirection:          models.SortDirectionAsc,
		SelectedWorkspaceIds:   in.SelectedWorkspaceIds,
		SelectedStatusIds:      in.SelectedStatusIds,
		SelectedProjectIds:     in.SelectedProjectIds,
		SelectedPriorityLevels: in.SelectedPriorityLevels,
		SelectedLabelIds:       in.SelectedLabelIds,
		SelectedStageIds:       in.SelectedStageIds,
		ColumnOrder:            in.ColumnOrder,
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
		if in.SelectedProjectIds != nil {
			view.SelectedProjectIds = in.SelectedProjectIds
		}
		if in.SelectedPriorityLevels != nil {
			view.SelectedPriorityLevels = in.SelectedPriorityLevels
		}
		if in.SelectedLabelIds != nil {
			view.SelectedLabelIds = in.SelectedLabelIds
		}
		if in.SelectedStageIds != nil {
			view.SelectedStageIds = in.SelectedStageIds
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
	if in.ShowCompleted != nil {
		view.ShowCompleted = in.ShowCompleted
	}
	if in.OnlyOverdue != nil {
		view.OnlyOverdue = *in.OnlyOverdue
	}
	if in.OnlyScheduled != nil {
		view.OnlyScheduled = *in.OnlyScheduled
	}
	if in.OnlyRecurring != nil {
		view.OnlyRecurring = *in.OnlyRecurring
	}
	if in.OnlyDated != nil {
		view.OnlyDated = in.OnlyDated
	}
	if in.ShowReminders != nil {
		view.ShowReminders = *in.ShowReminders
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
	if view.SelectedProjectIds == nil {
		view.SelectedProjectIds = []string{}
	}
	if view.SelectedPriorityLevels == nil {
		view.SelectedPriorityLevels = []string{}
	}
	if view.SelectedLabelIds == nil {
		view.SelectedLabelIds = []string{}
	}
	if view.SelectedStageIds == nil {
		view.SelectedStageIds = []string{}
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
	if strings.TrimSpace(in.Name) == "" {
		return fail(errors.New("name is required: give the view a short name from the person's words"))
	}
	in.Name = strings.TrimSpace(in.Name)
	if in, err = s.resolveViewNames(uid, in); err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	set := viewsOf(ctx, cfg)
	view := viewFromInput(in, nil)
	changed := ""
	if set.phone {
		changed = fitToPhone(&view)
	}
	*set.views = append(*set.views, view)
	// A view made from the person's words is the one they want to see.
	*set.active = view.ID
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	out := viewResult(viewsOf(ctx, updated), map[string]any{"view": view, "activeTaskViewId": view.ID})
	if changed != "" {
		out["changed"] = changed
	}
	return reply("created "+set.noun()+" "+view.Name, out)
}

type updateViewIn struct {
	createViewIn
	ViewID string `json:"viewId" jsonschema:"the view's id or name"`
}

func (s *Server) updateTaskView(ctx context.Context, req *mcp.CallToolRequest, in updateViewIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if in.createViewIn, err = s.resolveViewNames(uid, in.createViewIn); err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	set := viewsOf(ctx, cfg)
	found := set.find(in.ViewID)
	if found < 0 {
		return fail(set.notFound(in.ViewID))
	}
	views := *set.views
	existing := views[found]
	in.Name = strings.TrimSpace(in.Name)
	views[found] = viewFromInput(in.createViewIn, &existing)
	views[found].ID = existing.ID
	changed := ""
	if set.phone {
		changed = fitToPhone(&views[found])
	}
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	after := viewsOf(ctx, updated)
	out := viewResult(after, map[string]any{"view": views[found], "activeTaskViewId": *after.active})
	if changed != "" {
		out["changed"] = changed
	}
	return reply("updated "+set.noun()+" "+views[found].Name, out)
}

type viewIDIn struct {
	ViewID string `json:"viewId" jsonschema:"the view's id or name"`
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
	set := viewsOf(ctx, cfg)
	found := set.find(in.ViewID)
	if found < 0 {
		return fail(set.notFound(in.ViewID))
	}
	removed := (*set.views)[found]
	next := make(models.TaskViews, 0, len(*set.views)-1)
	next = append(next, (*set.views)[:found]...)
	next = append(next, (*set.views)[found+1:]...)
	*set.views = next
	if *set.active == removed.ID {
		*set.active = ""
		if len(next) > 0 {
			*set.active = next[0].ID
		}
	}
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	after := viewsOf(ctx, updated)
	return reply(set.noun()+" deleted", viewResult(after, map[string]any{"id": removed.ID, "activeTaskViewId": *after.active, "taskViews": *after.views}))
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
	set := viewsOf(ctx, cfg)
	found := set.find(in.ViewID)
	if found < 0 {
		return fail(set.notFound(in.ViewID))
	}
	view := (*set.views)[found]
	*set.active = view.ID
	if _, err := s.Workspaces.UpdateConfig(cfg); err != nil {
		return fail(err)
	}
	return reply("active "+set.noun()+" "+view.Name, viewResult(set, map[string]any{"activeTaskViewId": view.ID, "view": view}))
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
	updated, _, err := s.Auth.UpdateProfile(uid, in.Name, user.Email, "", "", "")
	if err != nil {
		return fail(err)
	}
	return reply("updated name to "+updated.Name, map[string]any{"id": updated.ID, "email": updated.Email, "name": updated.Name})
}

func (s *Server) getConfig(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	return reply("account config", cfg)
}

type accountConfigIn struct {
	IsOnBoardingCompleted *bool   `json:"isOnboardingCompleted,omitempty"`
	Theme                 *string `json:"theme,omitempty" jsonschema:"system, light, or dark"`
	Accent                *string `json:"accent,omitempty" jsonschema:"default or #RRGGBB"`
}

func (s *Server) updateAccountConfig(ctx context.Context, req *mcp.CallToolRequest, in accountConfigIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	if in.IsOnBoardingCompleted != nil {
		cfg.IsOnBoardingCompleted = *in.IsOnBoardingCompleted
	}
	if in.Theme != nil || in.Accent != nil {
		appearance := cfg.Appearance
		if in.Theme != nil {
			appearance.Theme = *in.Theme
		}
		if in.Accent != nil {
			appearance.Accent = *in.Accent
		}
		cfg.Appearance = appearance
	}
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	return reply("account config saved", updated)
}

type projectViewIn struct {
	ProjectID string `json:"projectId"`
	Clear     bool   `json:"clear,omitempty"`
	createViewIn
}

func (s *Server) setProjectTaskView(ctx context.Context, req *mcp.CallToolRequest, in projectViewIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if in.ProjectID == "" {
		return fail(errors.New("projectId is required"))
	}
	cfg, err := s.loadConfig(uid)
	if err != nil {
		return fail(err)
	}
	if cfg.ProjectTaskViews == nil {
		cfg.ProjectTaskViews = models.ProjectTaskViews{}
	}
	if in.Clear {
		delete(cfg.ProjectTaskViews, in.ProjectID)
	} else {
		var existing *models.TaskViewConfig
		if current, ok := cfg.ProjectTaskViews[in.ProjectID]; ok {
			existing = &current
		}
		if existing == nil && in.Name == "" {
			return fail(errors.New("name is required"))
		}
		resolved, err := s.resolveViewNames(uid, in.createViewIn)
		if err != nil {
			return fail(err)
		}
		view := viewFromInput(resolved, existing)
		cfg.ProjectTaskViews[in.ProjectID] = view
	}
	updated, err := s.Workspaces.UpdateConfig(cfg)
	if err != nil {
		return fail(err)
	}
	return reply("project task view saved", map[string]any{
		"projectId":        in.ProjectID,
		"projectTaskViews": updated.ProjectTaskViews,
	})
}
