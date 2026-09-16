package task

import (
	"errors"
	"testing"
	"timely-api/internal/models"
)

type parentLookupRepo struct {
	TaskRepository
	byID map[string]models.Task
}

func (r parentLookupRepo) GetTaskByIdForUser(_ string, taskID string) (*models.Task, error) {
	task, ok := r.byID[taskID]
	if !ok {
		return nil, errors.New("not found")
	}
	copy := task
	return &copy, nil
}

func TestPrepareParentInheritsWorkspaceAndProject(t *testing.T) {
	ws := "ws_design"
	project := "prj_site"
	svc := &taskService{taskRepo: parentLookupRepo{byID: map[string]models.Task{
		"tsk_parent": {
			ID:          "tsk_parent",
			Kind:        models.KindTask,
			Duration:    30,
			WorkspaceID: &ws,
			ProjectID:   &project,
		},
	}}}

	child := &models.Task{
		Name:         "Write copy",
		Duration:     30,
		ParentTaskID: ptr("tsk_parent"),
	}
	if err := svc.prepareParent("usr", child); err != nil {
		t.Fatalf("prepareParent: %v", err)
	}
	if child.WorkspaceID == nil || *child.WorkspaceID != ws {
		t.Fatalf("workspace = %v, want %s", child.WorkspaceID, ws)
	}
	if child.ProjectID == nil || *child.ProjectID != project {
		t.Fatalf("project = %v, want %s", child.ProjectID, project)
	}
}

func TestPrepareParentRejectsInboxAndNested(t *testing.T) {
	ws := "ws_design"
	svc := &taskService{taskRepo: parentLookupRepo{byID: map[string]models.Task{
		"tsk_inbox": {
			ID:   "tsk_inbox",
			Kind: models.KindInbox,
		},
		"tsk_child": {
			ID:           "tsk_child",
			Kind:         models.KindTask,
			WorkspaceID:  &ws,
			ParentTaskID: ptr("tsk_parent"),
		},
	}}}

	if err := svc.prepareParent("usr", &models.Task{
		Name: "Nested", Duration: 15, ParentTaskID: ptr("tsk_inbox"),
	}); err == nil || err.Error() != "clarify the inbox item before adding subtasks" {
		t.Fatalf("inbox parent: %v", err)
	}

	if err := svc.prepareParent("usr", &models.Task{
		Name: "Too deep", Duration: 15, ParentTaskID: ptr("tsk_child"),
	}); err == nil || err.Error() != "subtasks can only nest one level" {
		t.Fatalf("nested parent: %v", err)
	}
}
