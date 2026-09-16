package models

import (
	"testing"
	"timely-api/internal/utils"
)

func TestEntityColorPrefersProjectThenWorkspace(t *testing.T) {
	projectColor := "#E93D82"
	projectID := "prj_1"
	workspaceID := "ws_1"
	task := &Task{
		ProjectID:   &projectID,
		WorkspaceID: &workspaceID,
		Project:     &Project{ID: projectID, Color: &projectColor},
		Workspace:   &Workspace{ID: workspaceID, Color: "#30A66D"},
	}
	if got := task.EntityColor(); got != "#E93D82" {
		t.Fatalf("project color: got %q", got)
	}

	task.Project = &Project{ID: projectID}
	if got := task.EntityColor(); got != utils.StableColorForID(projectID) {
		t.Fatalf("missing project color should hash project id, got %q", got)
	}

	task.Project = nil
	task.ProjectID = nil
	if got := task.EntityColor(); got != "#30A66D" {
		t.Fatalf("workspace color: got %q", got)
	}
}

func TestEntityColorIgnoresStatus(t *testing.T) {
	workspaceID := "ws_1"
	task := &Task{
		WorkspaceID: &workspaceID,
		Workspace:   &Workspace{ID: workspaceID, Color: "#0090FF"},
		Status:      &Status{Color: "#E5484D"},
	}
	if got := task.EntityColor(); got != "#0090FF" {
		t.Fatalf("status must not drive task color, got %q", got)
	}
}
