package task

import (
	"errors"
	"testing"

	"timely-api/internal/features/project"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

// scopeRepo knows which statuses and custom fields live in which workspace.
type scopeRepo struct {
	memRepo
	statuses map[string]string // statusID -> workspaceID
	fields   map[string]string // customFieldID -> workspaceID
	created  []*models.CustomFieldValue
}

func (r *scopeRepo) CreateTask(task *models.Task, values []*models.CustomFieldValue) (*models.Task, error) {
	r.created = values
	return r.memRepo.CreateTask(task, values)
}

func (r *scopeRepo) GetWorkspaceStatuses(workspaceID string) ([]models.Status, error) {
	var out []models.Status
	for id, ws := range r.statuses {
		if ws == workspaceID {
			out = append(out, models.Status{ID: id, WorkspaceID: ws})
		}
	}
	return out, nil
}

func (r *scopeRepo) GetCustomFieldsByIDs(workspaceID string, ids []string) ([]models.CustomField, error) {
	var out []models.CustomField
	for _, id := range ids {
		if r.fields[id] == workspaceID {
			out = append(out, models.CustomField{ID: id, WorkspaceID: workspaceID, Type: "text"})
		}
	}
	return out, nil
}

// scopeProjects owns pr_mine (in ws_1, with stage sg_mine) for usr_1 only.
type scopeProjects struct {
	project.ProjectRepository
}

func (scopeProjects) GetProjectByIdForUser(userID, projectID string) (*models.Project, error) {
	if userID != "usr_1" || projectID != "pr_mine" {
		return nil, gorm.ErrRecordNotFound
	}
	ws := "ws_1"
	return &models.Project{ID: projectID, WorkspaceID: &ws}, nil
}

func (scopeProjects) GetStageById(projectID, stageID string) (*models.Stage, error) {
	if projectID != "pr_mine" || stageID != "sg_mine" {
		return nil, gorm.ErrRecordNotFound
	}
	return &models.Stage{ID: stageID, ProjectID: &projectID}, nil
}

func scopeService() (*taskService, *scopeRepo) {
	repo := &scopeRepo{
		statuses: map[string]string{"st_mine": "ws_1", "st_theirs": "ws_other"},
		fields:   map[string]string{"cf_mine": "ws_1", "cf_theirs": "ws_other"},
	}
	return &taskService{taskRepo: repo, projectRepo: scopeProjects{}, workspaces: stubWorkspaces{}}, repo
}

func newWork(status, project, stage *string) *models.Task {
	user, ws := "usr_1", "ws_1"
	return &models.Task{
		Name: "Write", Duration: 30, Kind: models.KindTask,
		UserID: &user, WorkspaceID: &ws,
		StatusID: status, ProjectID: project, StageID: stage,
	}
}

func TestCreateRejectsForeignStatusAndStage(t *testing.T) {
	svc, _ := scopeService()
	mine, theirs := "pr_mine", "sg_theirs"

	if _, err := svc.Create(newWork(ptr("st_theirs"), nil, nil), nil, nil); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign status: expected not found, got %v", err)
	}
	if _, err := svc.Create(newWork(nil, &mine, &theirs), nil, nil); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign stage: expected not found, got %v", err)
	}
	if _, err := svc.Create(newWork(nil, nil, ptr("sg_mine")), nil, nil); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("stage without project: expected not found, got %v", err)
	}
	if _, err := svc.Create(newWork(ptr("st_mine"), &mine, ptr("sg_mine")), nil, nil); err != nil {
		t.Fatalf("owned status and stage should pass: %v", err)
	}
}

func TestCreateValidatesCustomFieldValues(t *testing.T) {
	svc, repo := scopeService()

	_, err := svc.Create(newWork(nil, nil, nil), []*models.CustomFieldValue{{CustomFieldID: "cf_theirs"}}, nil)
	if err == nil {
		t.Fatal("foreign custom field should be rejected")
	}

	if _, err := svc.Create(newWork(nil, nil, nil), []*models.CustomFieldValue{{CustomFieldID: "cf_mine", Type: "bogus"}}, nil); err != nil {
		t.Fatalf("owned custom field should pass: %v", err)
	}
	if len(repo.created) != 1 || repo.created[0].Type != "text" {
		t.Fatalf("type should come from the field definition, got %+v", repo.created)
	}
}

func TestUpdateRejectsForeignStatusAndStage(t *testing.T) {
	svc, repo := scopeService()
	user, ws, pr := "usr_1", "ws_1", "pr_mine"
	repo.ensure()
	repo.byID["tsk_1"] = models.Task{ID: "tsk_1", UserID: &user, WorkspaceID: &ws, ProjectID: &pr, Kind: models.KindTask, Duration: 30}

	if _, err := svc.Update(user, "tsk_1", TaskUpdate{StatusID: ptr("st_theirs")}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign status: expected not found, got %v", err)
	}
	if _, err := svc.Update(user, "tsk_1", TaskUpdate{StageID: ptr("sg_theirs")}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign stage: expected not found, got %v", err)
	}
	// Clearing the project in the same update leaves the stage without a home.
	if _, err := svc.Update(user, "tsk_1", TaskUpdate{ProjectID: ptr(""), StageID: ptr("sg_mine")}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("stage on cleared project: expected not found, got %v", err)
	}
	if err := svc.assertStatusAndStage(user, &ws, &pr, ptr("st_mine"), ptr("sg_mine")); err != nil {
		t.Fatalf("owned status and stage should pass: %v", err)
	}
}
