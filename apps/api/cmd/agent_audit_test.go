package main

import (
	"context"
	"encoding/json"
	"testing"

	"timely-api/internal/realtime"
)

// A duration-only edit is the smallest Work estimate change. It must land
// in the saved task, not only in the tool's "done" reply.
func TestIntegrationDurationOnlyTaskUpdateIsSaved(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Audit"})
	created := call("create_task", map[string]any{"name": "Estimate", "workspaceId": ws["id"], "duration": 30})
	taskID := created["task"].(map[string]any)["id"]

	updated := call("update_task", map[string]any{"taskId": taskID, "duration": 45})
	if got := updated["task"].(map[string]any)["duration"]; got != 45.0 {
		t.Fatalf("update_task replied duration %v, want 45", got)
	}
	saved := call("get_task", map[string]any{"taskId": taskID})
	if got := saved["task"].(map[string]any)["duration"]; got != 45.0 {
		t.Fatalf("saved duration %v, want 45", got)
	}

	bulk := call("bulk_update_tasks", map[string]any{"ids": []any{taskID}, "update": map[string]any{"duration": 60}})
	if tasks := bulk["tasks"].([]any); len(tasks) != 1 || tasks[0].(map[string]any)["duration"] != 60.0 {
		t.Fatalf("bulk_update_tasks replied %v, want duration 60", bulk["tasks"])
	}
	saved = call("get_task", map[string]any{"taskId": taskID})
	if got := saved["task"].(map[string]any)["duration"]; got != 60.0 {
		t.Fatalf("saved duration after bulk edit %v, want 60", got)
	}
}

// Placing Work by hand may push aside other replaceable Work blocks, but it
// must never delete time the person protected: a pinned block, the blocks of
// a pinned task, or an Event's time.
func TestIntegrationManualPlacementKeepsProtectedBlocks(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Audit"})
	newTask := func(name string) string {
		return call("create_task", map[string]any{"name": name, "workspaceId": ws["id"], "duration": 30})["task"].(map[string]any)["id"].(string)
	}
	blocksOf := func(taskID string) []any {
		return call("get_task", map[string]any{"taskId": taskID})["task"].(map[string]any)["blocks"].([]any)
	}
	place := func(taskID, start string, replace bool) map[string]any {
		return call("schedule_task", map[string]any{"taskId": taskID, "start": start, "durationMinutes": 30, "replace": replace})
	}

	pinnedBlock := newTask("Pinned block")
	place(pinnedBlock, "2026-12-02T13:00:00Z", false)
	call("pin_block", map[string]any{"blockId": blocksOf(pinnedBlock)[0].(map[string]any)["id"], "locked": true})

	pinnedTask := newTask("Pinned task")
	place(pinnedTask, "2026-12-02T14:00:00Z", false)
	call("pin_task", map[string]any{"taskId": pinnedTask, "locked": true})

	event := call("create_event", map[string]any{"title": "Dentist", "start": "2026-12-02T15:00:00Z", "end": "2026-12-02T15:30:00Z", "workspaceId": ws["id"]})
	eventBlocks := func() []any {
		return call("get_event", map[string]any{"eventId": event["id"]})["blocks"].([]any)
	}

	loose := newTask("Loose")
	place(loose, "2026-12-02T16:00:00Z", false)

	mover := newTask("Mover")
	placed := place(mover, "2026-12-02T13:00:00Z", false)
	if len(blocksOf(pinnedBlock)) != 1 {
		t.Fatal("placing over a pinned block deleted it")
	}
	moverBlock := placed["blocks"].([]any)[0].(map[string]any)["id"]

	place(mover, "2026-12-02T14:00:00Z", true)
	if len(blocksOf(pinnedTask)) != 1 {
		t.Fatal("placing over a pinned task's block deleted it")
	}
	moverBlock = blocksOf(mover)[0].(map[string]any)["id"]

	call("move_block", map[string]any{"blockId": moverBlock, "start": "2026-12-02T15:00:00Z"})
	if len(eventBlocks()) != 1 {
		t.Fatal("moving over an Event deleted the Event's time")
	}

	call("move_block", map[string]any{"blockId": moverBlock, "start": "2026-12-02T16:00:00Z"})
	if len(blocksOf(loose)) != 0 {
		t.Fatal("an unprotected Work block was not displaced")
	}
	if len(blocksOf(mover)) != 1 {
		t.Fatal("the moved block itself was lost")
	}
}

// One patch cannot place many tasks: each would push the others aside (ADR
// 0010). The tool does not offer scheduledOn or scheduleAt in a bulk patch, and
// the call is refused rather than silently dropping them.
func TestIntegrationBulkUpdateToolRefusesScheduling(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Audit"})
	taskID := call("create_task", map[string]any{"name": "Bulk", "workspaceId": ws["id"], "duration": 30})["task"].(map[string]any)["id"]

	tools := chatCatalog(db, realtime.NewHub(), func(string) (string, string) { return "unused-test-key", "" })
	for _, field := range []string{"scheduledOn", "scheduleAt"} {
		raw, _ := json.Marshal(map[string]any{"ids": []any{taskID}, "update": map[string]any{field: "2026-12-02T09:00:00Z"}})
		if _, err := tools["bulk_update_tasks"].Call(context.Background(), uid, raw); err == nil {
			t.Fatalf("bulk_update_tasks accepted %s", field)
		}
	}
	update := tools["bulk_update_tasks"].Parameters.Properties["update"]
	for _, field := range []string{"scheduledOn", "scheduleAt"} {
		if _, ok := update.Properties[field]; ok {
			t.Fatalf("bulk_update_tasks schema still offers %s", field)
		}
	}
	if blocks := call("get_task", map[string]any{"taskId": taskID})["task"].(map[string]any)["blocks"]; len(blocks.([]any)) != 0 {
		t.Fatalf("a refused bulk update placed Blocks: %v", blocks)
	}
}
