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
	created *models.Project
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
	return nil, gorm.ErrRecordNotFound
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
