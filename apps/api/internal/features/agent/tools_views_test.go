package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"timely-api/internal/features/project"
	"timely-api/internal/features/workspace"
	"timely-api/internal/models"
)

// viewSpaces is one account with two workspaces that both have a Done status.
type viewSpaces struct {
	workspace.WorkspaceService
	cfg   models.Config
	saves int
}

func (f *viewSpaces) GetAllWorkspaceByUser(string) ([]models.Workspace, error) {
	return []models.Workspace{
		{ID: "ws_home", Name: "Home",
			Status:       []*models.Status{{ID: "tst_home_done", Name: "Done"}, {ID: "tst_home_doing", Name: "In progress"}},
			Lables:       []*models.Lable{{ID: "lbl_bug", Name: "Bug"}},
			Projects:     []*models.Project{{ID: "pr_garden", Title: "Garden"}},
			CustomFields: []*models.CustomField{{ID: "cf_area", Name: "Area"}}},
		{ID: "ws_work", Name: "Work",
			Status:   []*models.Status{{ID: "tst_work_done", Name: "Done"}},
			Projects: []*models.Project{{ID: "pr_launch", Title: "Website launch"}}},
	}, nil
}

func (f *viewSpaces) GetConfig(string) (*models.Config, error) {
	cfg := f.cfg
	cfg.TaskViews = append(models.TaskViews(nil), f.cfg.TaskViews...)
	cfg.MobileTaskViews = append(models.TaskViews(nil), f.cfg.MobileTaskViews...)
	return &cfg, nil
}

func (f *viewSpaces) UpdateConfig(cfg *models.Config) (*models.Config, error) {
	f.saves++
	f.cfg = *cfg
	return f.GetConfig(cfg.UserID)
}

type viewProjects struct{ project.ProjectService }

func (viewProjects) GetAllProjectByUser(string) ([]models.Project, error) {
	return []models.Project{
		{ID: "pr_launch", Title: "Website launch", Stages: []*models.Stage{{ID: "stg_review", Name: "Review"}}},
		{ID: "pr_garden", Title: "Garden", Stages: []*models.Stage{{ID: "stg_garden_review", Name: "Review"}}},
	}, nil
}

func callView(t *testing.T, ctx context.Context, spaces *viewSpaces, tool, args string) (map[string]any, error) {
	t.Helper()
	catalog := NewCatalog(Deps{Workspaces: spaces, Projects: viewProjects{}})
	out, err := catalog[tool].Call(ctx, "usr_1", json.RawMessage(args))
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(out)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m, nil
}

func TestResolveViewNames(t *testing.T) {
	spaces := &viewSpaces{}
	cat, err := (&Server{Deps: Deps{Workspaces: spaces, Projects: viewProjects{}}}).viewCatalog("usr_1", true)
	if err != nil {
		t.Fatal(err)
	}
	got, err := resolveViewInput(cat, createViewIn{
		SelectedWorkspaceIds:   []string{"home"},
		SelectedStatusIds:      []string{"done", "tst_home_doing"},
		SelectedLabelIds:       []string{"BUG"},
		SelectedProjectIds:     []string{"Garden"},
		SelectedStageIds:       []string{"review"},
		SelectedPriorityLevels: []string{"urgent", "Critical", "high"},
		GroupFields:            []string{"Priority", "area"},
		RenderMode:             "Board",
		SortBy:                 "due date",
	})
	if err != nil {
		t.Fatal(err)
	}
	// "Done" is the Home workspace's Done, since only Home was chosen; the
	// stage is the chosen project's Review.
	want := map[string][]string{
		"workspaces": {"ws_home"}, "statuses": {"tst_home_done", "tst_home_doing"}, "labels": {"lbl_bug"},
		"projects": {"pr_garden"}, "stages": {"stg_garden_review"}, "priorities": {"Urgent", "High"}, "groups": {"priority", "cf:cf_area"},
	}
	have := map[string][]string{
		"workspaces": got.SelectedWorkspaceIds, "statuses": got.SelectedStatusIds, "labels": got.SelectedLabelIds,
		"projects": got.SelectedProjectIds, "stages": got.SelectedStageIds, "priorities": got.SelectedPriorityLevels, "groups": got.GroupFields,
	}
	for key, ids := range want {
		if strings.Join(have[key], ",") != strings.Join(ids, ",") {
			t.Errorf("%s = %v, want %v", key, have[key], ids)
		}
	}
	if got.RenderMode != "kanban" || got.SortBy != "deadline" {
		t.Errorf("render %q sort %q", got.RenderMode, got.SortBy)
	}

	// With no workspace chosen a status name means every workspace's.
	all, err := resolveViewInput(cat, createViewIn{SelectedStatusIds: []string{"Done"}})
	if err != nil || strings.Join(all.SelectedStatusIds, ",") != "tst_home_done,tst_work_done" {
		t.Fatalf("all Done = %v, %v", all.SelectedStatusIds, err)
	}

	// Unknown names fail with the closest names, never another account's id.
	for args, wantText := range map[string]string{
		"status":    `unknown status "Doing". Close matches: Done`,
		"project":   `unknown project "Websit launch". Close matches: Website launch`,
		"label":     `unknown label "Urgent stuff". Your labels include: Bug`,
		"workspace": `unknown workspace "ws_someone_else"`,
		"priority":  `unknown priority "asap"`,
	} {
		in := createViewIn{}
		switch args {
		case "status":
			in.SelectedStatusIds = []string{"Doing"}
		case "project":
			in.SelectedProjectIds = []string{"Websit launch"}
		case "label":
			in.SelectedLabelIds = []string{"Urgent stuff"}
		case "workspace":
			in.SelectedWorkspaceIds = []string{"ws_someone_else"}
		case "priority":
			in.SelectedPriorityLevels = []string{"asap"}
		}
		if _, err := resolveViewInput(cat, in); err == nil || !strings.Contains(err.Error(), wantText) {
			t.Errorf("%s: %v, want %q", args, err, wantText)
		}
	}
}

func TestViewToolsFollowTheChatClient(t *testing.T) {
	spaces := &viewSpaces{cfg: models.Config{UserID: "usr_1", TaskViews: models.DefaultTaskViews(), ActiveTaskViewId: "view_task_list"}}
	phone := WithClient(context.Background(), "phone")

	// From the phone, a new view is a phone view built from names; the phone
	// starts from its built-in views and has no timeline, so gantt is a list.
	out, err := callView(t, phone, spaces, "create_task_view",
		`{"name":"Overdue in Home","selectedWorkspaceIds":["Home"],"onlyOverdue":true,"groupFields":["priority"],"renderMode":"gantt"}`)
	if err != nil {
		t.Fatal(err)
	}
	view, _ := out["view"].(map[string]any)
	id, _ := view["id"].(string)
	if out["viewsOn"] != "phone" || view["renderMode"] != "list" || out["changed"] == nil || out["activeTaskViewId"] != id {
		t.Fatalf("phone create = %+v", out)
	}
	if got := spaces.cfg.MobileTaskViews; len(got) != 5 || got[0].ID != "native_view_task_list" || got[4].SelectedWorkspaceIds[0] != "ws_home" {
		t.Fatalf("phone views = %+v", got)
	}
	if spaces.cfg.MobileActiveTaskViewId != id || len(spaces.cfg.TaskViews) != 4 || spaces.cfg.ActiveTaskViewId != "view_task_list" {
		t.Fatalf("web views touched: active %q, %d views", spaces.cfg.ActiveTaskViewId, len(spaces.cfg.TaskViews))
	}

	// The same calls from the web (or an MCP client) act on web views, and a
	// web view keeps its timeline.
	for _, ctx := range []context.Context{WithClient(context.Background(), "web"), WithClient(context.Background(), "tablet"), context.Background()} {
		out, err = callView(t, ctx, spaces, "list_task_views", `{}`)
		if err != nil || out["viewsOn"] != "web" || len(out["taskViews"].([]any)) != len(spaces.cfg.TaskViews) {
			t.Fatalf("web list = %+v, %v", out, err)
		}
	}
	web := WithClient(context.Background(), "web")
	out, err = callView(t, web, spaces, "create_task_view", `{"name":"Launch timeline","selectedProjectIds":["website launch"],"renderMode":"timeline"}`)
	if err != nil || out["viewsOn"] != "web" || out["view"].(map[string]any)["renderMode"] != "gantt" || out["changed"] != nil {
		t.Fatalf("web create = %+v, %v", out, err)
	}
	if len(spaces.cfg.TaskViews) != 5 || len(spaces.cfg.MobileTaskViews) != 5 {
		t.Fatalf("views: web %d phone %d", len(spaces.cfg.TaskViews), len(spaces.cfg.MobileTaskViews))
	}

	// Update, activate and delete find a phone view by name.
	if out, err = callView(t, phone, spaces, "update_task_view", `{"viewId":"overdue in home","selectedLabelIds":["Bug"],"renderMode":"board"}`); err != nil {
		t.Fatal(err)
	}
	if v := spaces.cfg.MobileTaskViews[4]; v.ID != id || v.RenderMode != models.RenderModeKanban || v.SelectedLabelIds[0] != "lbl_bug" || !v.OnlyOverdue {
		t.Fatalf("phone update = %+v", v)
	}
	if out, err = callView(t, phone, spaces, "set_active_task_view", `{"viewId":"Board"}`); err != nil || spaces.cfg.MobileActiveTaskViewId != "native_view_board" || out["viewsOn"] != "phone" {
		t.Fatalf("phone activate = %+v, %v", out, err)
	}
	if _, err = callView(t, phone, spaces, "set_active_task_view", `{"viewId":"Launch timeline"}`); err == nil || !strings.Contains(err.Error(), "no phone view") {
		t.Fatalf("a web view was activated on the phone: %v", err)
	}
	if _, err = callView(t, phone, spaces, "delete_task_view", `{"viewId":"Overdue in Home"}`); err != nil || len(spaces.cfg.MobileTaskViews) != 4 {
		t.Fatalf("phone delete: %v, %d left", err, len(spaces.cfg.MobileTaskViews))
	}

	// An unknown name saves nothing.
	saves := spaces.saves
	if _, err = callView(t, phone, spaces, "create_task_view", `{"name":"Nope","selectedLabelIds":["Missing"]}`); err == nil || spaces.saves != saves {
		t.Fatalf("unknown label: %v, saves %d", err, spaces.saves-saves)
	}
}

func TestGetContextListsTheClientViews(t *testing.T) {
	cfg := models.Config{TaskViews: models.DefaultTaskViews(), MobileTaskViews: models.TaskViews{models.DefaultMobileTaskViews()[3]}, MobileActiveTaskViewId: "native_view_board"}
	if v := viewsOf(WithClient(context.Background(), "phone"), &cfg); !v.phone || len(*v.views) != 1 || *v.active != "native_view_board" {
		t.Fatalf("phone = %+v", v)
	}
	if v := viewsOf(context.Background(), &cfg); v.phone || len(*v.views) != 4 {
		t.Fatalf("default = %+v", v)
	}
}
