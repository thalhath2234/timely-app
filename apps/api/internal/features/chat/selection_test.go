package chat

import (
	"slices"
	"testing"
)

// Changes chosen on their own carry what they build on ("$0.task.id") when
// applied, and take what builds on them along when set aside.
func TestSelectionFollowsReferences(t *testing.T) {
	plan := []Step{
		{Tool: "create_task", Arguments: raw(map[string]any{"name": "Draft"})},
		{Tool: "complete_task", Arguments: raw(map[string]any{"taskId": "$0.task.id"})},
		{Tool: "add_task_comment", Arguments: raw(map[string]any{"taskId": "$1.task.id", "comment": "costs $5.00"})},
		{Tool: "create_doc", Arguments: raw(map[string]any{"title": "Notes"})},
	}
	if got := withDependencies(plan, []int{2}); !slices.Equal(got, []int{0, 1, 2}) {
		t.Fatalf("dependencies of 2 = %v", got)
	}
	if got := withDependents(plan, []int{0}); !slices.Equal(got, []int{0, 1, 2}) {
		t.Fatalf("dependents of 0 = %v", got)
	}
	if got := withDependents(plan, []int{3}); !slices.Equal(got, []int{3}) {
		t.Fatalf("dependents of 3 = %v", got)
	}
	if _, err := planSelection(plan, []int{4}); err == nil {
		t.Fatal("an index outside the plan was accepted")
	}
	plan[0].Status, plan[1].Status, plan[2].Status, plan[3].Status = "done", "discarded", "discarded", "done"
	if hasPending(plan) {
		t.Fatal("nothing is left to apply")
	}
	for _, status := range []string{stepApproved, "pending", "failed"} {
		plan[3].Status = status
		if !hasPending(plan) {
			t.Fatalf("a %s change is still to apply", status)
		}
	}
}
