package task

import (
	"testing"

	"timely-api/internal/models"
)

func TestApplyKindUpdatePersistsWorkDuration(t *testing.T) {
	workspaceID := "ws_1"
	duration := 30
	kind := models.KindTask
	before := &models.Task{
		ID:          "tsk_1",
		Kind:        models.KindReminder,
		Duration:    0,
		WorkspaceID: &workspaceID,
	}
	updates := map[string]any{}

	err := (&taskService{}).applyKindUpdate("usr_1", before, TaskUpdate{
		Kind:     &kind,
		Duration: &duration,
	}, updates)
	if err != nil {
		t.Fatalf("apply kind update: %v", err)
	}
	if got := updates["kind"]; got != models.KindTask {
		t.Fatalf("kind update = %v, want %q", got, models.KindTask)
	}
	if got := updates["duration"]; got != 30 {
		t.Fatalf("duration update = %v, want 30", got)
	}
}

func TestApplyKindUpdatePersistsDurationEdit(t *testing.T) {
	workspaceID := "ws_1"
	duration := 60
	before := &models.Task{
		ID:          "tsk_1",
		Kind:        models.KindTask,
		Duration:    30,
		WorkspaceID: &workspaceID,
	}
	updates := map[string]any{}

	err := (&taskService{}).applyKindUpdate("usr_1", before, TaskUpdate{
		Duration: &duration,
	}, updates)
	if err != nil {
		t.Fatalf("apply duration update: %v", err)
	}
	if got := updates["duration"]; got != 60 {
		t.Fatalf("duration update = %v, want 60", got)
	}
}
