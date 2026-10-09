package project

import (
	"errors"
	"testing"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type fakeWorkspaces struct {
	owned map[string]string // workspaceID -> userID
}

func (f fakeWorkspaces) GetWorkspaceById(userID, workspaceID string) (*models.Workspace, error) {
	if f.owned[workspaceID] != userID {
		return nil, gorm.ErrRecordNotFound
	}
	id := workspaceID
	return &models.Workspace{ID: id, UserID: &userID}, nil
}

type capturingRepo struct {
	created  *models.Project
	statuses map[string]string // statusID -> workspaceID
	fields   map[string]string // customFieldID -> workspaceID
}

func (r *capturingRepo) CreateProject(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error) {
	r.created = project
	return project, nil
}
func (r *capturingRepo) GetAllProjectByUser(userID string) ([]models.Project, error) {
	return nil, nil
}
func (r *capturingRepo) GetProjectById(projectId string) (*models.Project, error) {
	return nil, gorm.ErrRecordNotFound
}
func (r *capturingRepo) GetProjectByIdForUser(userID string, projectID string) (*models.Project, error) {
	if r.created != nil && r.created.ID == projectID {
		return r.created, nil
	}
	return nil, gorm.ErrRecordNotFound
}
func (r *capturingRepo) UpdateProject(userID string, projectID string, updates map[string]any) (*models.Project, error) {
	return r.GetProjectByIdForUser(userID, projectID)
}
func (r *capturingRepo) DeleteProject(userID, projectID string) error { return gorm.ErrRecordNotFound }
func (r *capturingRepo) GetStageById(projectID string, stageID string) (*models.Stage, error) {
	return nil, gorm.ErrRecordNotFound
}
func (r *capturingRepo) CreateStage(stage *models.Stage) (*models.Stage, error) { return stage, nil }
func (r *capturingRepo) UpdateStage(stage *models.Stage) (*models.Stage, error) { return stage, nil }
func (r *capturingRepo) DeleteStage(projectID, stageID string) error            { return nil }
func (r *capturingRepo) ReorderStages(projectID string, ids []string) error     { return nil }
func (r *capturingRepo) NextStageOrder(projectID string) (int, error)           { return 0, nil }
func (r *capturingRepo) ListTaskActivity(userID, projectID string, limit int) ([]ProjectActivityEntry, error) {
	return nil, nil
}
func (r *capturingRepo) CountByWorkspace(workspaceID string) (int64, error) {
	return 0, nil
}
func (r *capturingRepo) GetWorkspaceStatus(workspaceID, statusID string) (*models.Status, error) {
	if r.statuses[statusID] != workspaceID {
		return nil, gorm.ErrRecordNotFound
	}
	return &models.Status{ID: statusID, WorkspaceID: workspaceID}, nil
}
func (r *capturingRepo) GetCustomFieldsByIDs(workspaceID string, fieldIDs []string) ([]models.CustomField, error) {
	var out []models.CustomField
	for _, id := range fieldIDs {
		if r.fields[id] == workspaceID {
			out = append(out, models.CustomField{ID: id, WorkspaceID: workspaceID, Type: "text"})
		}
	}
	return out, nil
}

func TestCreateRejectsForeignWorkspace(t *testing.T) {
	repo := &capturingRepo{}
	svc := NewProjectService(repo, fakeWorkspaces{owned: map[string]string{"ws_mine": "usr_a"}}, nil)
	ws := "ws_theirs"
	_, err := svc.Create("usr_a", &models.Project{Title: "Secret", WorkspaceID: &ws}, nil)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	if repo.created != nil {
		t.Fatal("must not insert into another account's workspace")
	}
}

func TestCreateAllowsOwnedWorkspace(t *testing.T) {
	repo := &capturingRepo{}
	svc := NewProjectService(repo, fakeWorkspaces{owned: map[string]string{"ws_mine": "usr_a"}}, nil)
	ws := "ws_mine"
	project, err := svc.Create("usr_a", &models.Project{Title: "Mine", WorkspaceID: &ws}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if project == nil || repo.created == nil {
		t.Fatal("expected create")
	}
	if project.Color == nil || *project.Color == "" {
		t.Fatal("new projects should receive a palette color")
	}
}

func TestGetProjectByIdIsUserScoped(t *testing.T) {
	repo := &capturingRepo{}
	svc := NewProjectService(repo, fakeWorkspaces{owned: map[string]string{}}, nil)
	_, err := svc.GetProjectById("usr_b", "pr_missing")
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestCreateRejectsForeignStatusAndCustomField(t *testing.T) {
	repo := &capturingRepo{
		statuses: map[string]string{"st_mine": "ws_mine", "st_theirs": "ws_theirs"},
		fields:   map[string]string{"cf_mine": "ws_mine", "cf_theirs": "ws_theirs"},
	}
	svc := NewProjectService(repo, fakeWorkspaces{owned: map[string]string{"ws_mine": "usr_a"}}, nil)
	ws := "ws_mine"

	theirs := "st_theirs"
	_, err := svc.Create("usr_a", &models.Project{Title: "P", WorkspaceID: &ws, StatusID: &theirs}, nil)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign status: expected not found, got %v", err)
	}
	_, err = svc.Create("usr_a", &models.Project{Title: "P", WorkspaceID: &ws}, []*models.CustomFieldValue{{CustomFieldID: "cf_theirs"}})
	if err == nil {
		t.Fatal("foreign custom field should be rejected")
	}
	if repo.created != nil {
		t.Fatal("must not insert a project pointing at another account's rows")
	}

	mine := "st_mine"
	if _, err := svc.Create("usr_a", &models.Project{Title: "P", WorkspaceID: &ws, StatusID: &mine},
		[]*models.CustomFieldValue{{CustomFieldID: "cf_mine"}}); err != nil {
		t.Fatalf("owned status and field should pass: %v", err)
	}
}

func TestUpdateRejectsForeignStatus(t *testing.T) {
	ws := "ws_mine"
	repo := &capturingRepo{
		created:  &models.Project{ID: "pr_1", WorkspaceID: &ws},
		statuses: map[string]string{"st_mine": "ws_mine", "st_theirs": "ws_theirs"},
	}
	svc := NewProjectService(repo, fakeWorkspaces{owned: map[string]string{"ws_mine": "usr_a"}}, nil)
	theirs := "st_theirs"
	_, err := svc.Update("usr_a", "pr_1", ProjectUpdate{StatusID: &theirs})
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	mine := "st_mine"
	if _, err := svc.Update("usr_a", "pr_1", ProjectUpdate{StatusID: &mine}); err != nil {
		t.Fatalf("owned status should pass: %v", err)
	}
}

func TestDuplicateAsTakesTheNewFormInTheSameWorkspace(t *testing.T) {
	mine, other := "ws_mine", "ws_other"
	repo := &capturingRepo{
		created: &models.Project{ID: "pr_src", Title: "Lisbon trip", WorkspaceID: &mine, DoesHaveStages: true},
		fields:  map[string]string{"cf_mine": "ws_mine"},
	}
	svc := NewProjectService(repo, fakeWorkspaces{owned: map[string]string{"ws_mine": "usr_a", "ws_other": "usr_a"}}, nil)

	if _, err := svc.DuplicateAs("usr_a", "pr_src", &models.Project{Title: "Porto trip", WorkspaceID: &other}, nil); err == nil {
		t.Fatal("a copy into another workspace should be refused")
	}
	if repo.created.ID != "pr_src" {
		t.Fatal("a refused copy must not create a project")
	}

	copied, err := svc.DuplicateAs("usr_a", "pr_src", &models.Project{Title: "Porto trip", WorkspaceID: &mine},
		[]*models.CustomFieldValue{{CustomFieldID: "cf_mine"}})
	if err != nil {
		t.Fatal(err)
	}
	if copied.Title != "Porto trip" || !copied.DoesHaveStages {
		t.Fatalf("copy should take the form's title and keep the source's stages, got %q stages=%v", copied.Title, copied.DoesHaveStages)
	}
}
