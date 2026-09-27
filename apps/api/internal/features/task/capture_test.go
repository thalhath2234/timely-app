package task

import (
	"errors"
	"testing"

	"timely-api/internal/models"
)

type memRepo struct {
	TaskRepository
	byID map[string]models.Task
}

func (r *memRepo) ensure() {
	if r.byID == nil {
		r.byID = map[string]models.Task{}
	}
}

func (r *memRepo) CreateTask(task *models.Task, _ []*models.CustomFieldValue) (*models.Task, error) {
	r.ensure()
	cp := *task
	r.byID[cp.ID] = cp
	return &cp, nil
}

func (r *memRepo) GetTaskById(taskID string) (*models.Task, error) {
	r.ensure()
	t, ok := r.byID[taskID]
	if !ok {
		return nil, errors.New("not found")
	}
	cp := t
	return &cp, nil
}

func (r *memRepo) GetTaskByIdForUser(userID, taskID string) (*models.Task, error) {
	t, err := r.GetTaskById(taskID)
	if err != nil {
		return nil, err
	}
	if t.UserID == nil || *t.UserID != userID {
		return nil, errors.New("not found")
	}
	return t, nil
}

func (r *memRepo) DeleteTask(userID, taskID string) error {
	if _, err := r.GetTaskByIdForUser(userID, taskID); err != nil {
		return err
	}
	delete(r.byID, taskID)
	return nil
}

func (r *memRepo) CreateActivities([]models.TaskActivity) error { return nil }

func (r *memRepo) ActorName(string) string { return "test" }

func (r *memRepo) GetLabelsByIds(string, []string) ([]*models.Lable, error) {
	return nil, nil
}

type stubWorkspaces struct{}

func (stubWorkspaces) GetWorkspaceById(userID, workspaceID string) (*models.Workspace, error) {
	uid := userID
	return &models.Workspace{ID: workspaceID, UserID: &uid}, nil
}

func captureService() (*taskService, *memRepo) {
	repo := &memRepo{}
	return &taskService{taskRepo: repo, workspaces: stubWorkspaces{}}, repo
}

func TestCaptureKeepsTitleOnly(t *testing.T) {
	svc, repo := captureService()
	got, err := svc.Capture("usr_1", "Buy milk")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if got.Kind != models.KindInbox || got.Duration != 0 || got.Name != "Buy milk" {
		t.Fatalf("got kind=%s duration=%d name=%q", got.Kind, got.Duration, got.Name)
	}
	if got.WorkspaceID != nil || got.ScheduledOn != nil {
		t.Fatal("inbox item must not store workspace or ping")
	}
	if _, err := repo.GetTaskById(got.ID); err != nil {
		t.Fatalf("stored: %v", err)
	}
}

func TestClarifyToWorkConsumesInbox(t *testing.T) {
	svc, repo := captureService()
	inbox, err := svc.Capture("usr_1", "Buy milk")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	ws := "ws_1"
	created, err := svc.Clarify("usr_1", inbox.ID, ClarifyInput{
		Kind:        models.KindTask,
		Duration:    30,
		WorkspaceID: &ws,
	})
	if err != nil {
		t.Fatalf("clarify: %v", err)
	}
	if created.ID == inbox.ID {
		t.Fatal("clarify must create a new row")
	}
	if created.Kind != models.KindTask || created.Duration != 30 {
		t.Fatalf("work: kind=%s duration=%d", created.Kind, created.Duration)
	}
	if _, err := repo.GetTaskById(inbox.ID); err == nil {
		t.Fatal("inbox item should be gone")
	}
}

func TestClarifyTitleOnlyLeavesInbox(t *testing.T) {
	svc, repo := captureService()
	inbox, err := svc.Capture("usr_1", "Buy milk")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	_, err = svc.Clarify("usr_1", inbox.ID, ClarifyInput{Kind: models.KindTask, Duration: 0})
	if err == nil {
		t.Fatal("title-only clarify should fail")
	}
	if _, err := repo.GetTaskById(inbox.ID); err != nil {
		t.Fatal("inbox item must remain")
	}
}

func TestClarifyTwiceFails(t *testing.T) {
	svc, _ := captureService()
	inbox, err := svc.Capture("usr_1", "Buy milk")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	ws := "ws_1"
	if _, err := svc.Clarify("usr_1", inbox.ID, ClarifyInput{
		Kind: models.KindTask, Duration: 30, WorkspaceID: &ws,
	}); err != nil {
		t.Fatalf("first clarify: %v", err)
	}
	if _, err := svc.Clarify("usr_1", inbox.ID, ClarifyInput{
		Kind: models.KindTask, Duration: 30, WorkspaceID: &ws,
	}); err == nil {
		t.Fatal("second clarify should fail")
	}
}

func TestClarifyReminderNeedsPing(t *testing.T) {
	svc, repo := captureService()
	inbox, err := svc.Capture("usr_1", "Call bank")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	_, err = svc.Clarify("usr_1", inbox.ID, ClarifyInput{Kind: models.KindReminder})
	if err == nil {
		t.Fatal("reminder without ping should fail")
	}
	if _, err := repo.GetTaskById(inbox.ID); err != nil {
		t.Fatal("inbox item must remain")
	}
}
