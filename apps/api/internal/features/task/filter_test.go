package task

import "testing"
import "timely-api/internal/models"

func TestApplyTaskFilterByWorkspaceAndText(t *testing.T) {
	wsA := "ws_a"
	wsB := "ws_b"
	open := false
	tasks := []models.Task{
		{ID: "tsk_1", Name: "Haircut", WorkspaceID: &wsA},
		{ID: "tsk_2", Name: "Taxes", WorkspaceID: &wsB, Description: "file return"},
		{ID: "tsk_3", Name: "Done thing", WorkspaceID: &wsA, CompletedAt: str("2026-01-01T00:00:00Z")},
	}

	got := applyTaskFilter(tasks, TaskFilter{WorkspaceIDs: []string{wsA}, Completed: &open, Limit: 50})
	if len(got) != 1 || got[0].ID != "tsk_1" {
		t.Fatalf("workspace+open filter: got %#v", ids(got))
	}

	got = applyTaskFilter(tasks, TaskFilter{Text: "file", Limit: 50})
	if len(got) != 1 || got[0].ID != "tsk_2" {
		t.Fatalf("text filter: got %#v", ids(got))
	}
}

func str(v string) *string { return &v }

func ids(tasks []models.Task) []string {
	out := make([]string, len(tasks))
	for i, t := range tasks {
		out[i] = t.ID
	}
	return out
}
