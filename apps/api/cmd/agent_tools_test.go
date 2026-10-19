package main

import (
	"testing"
	"time"

	"timely-api/internal/models"
)

func TestIntegrationListFocusSessions(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})
	read := call("create_task", map[string]any{"name": "Read", "workspaceId": ws["id"]})["task"].(map[string]any)["id"].(string)
	write := call("create_task", map[string]any{"name": "Write", "workspaceId": ws["id"]})["task"].(map[string]any)["id"].(string)
	at := func(day string, hour int) time.Time {
		d, _ := time.Parse("2006-01-02", day)
		return d.Add(time.Duration(hour) * time.Hour)
	}
	for _, s := range []models.FocusSession{
		{UserID: uid, TaskID: &read, TaskName: "Read", StartedAt: at("2026-10-05", 9), EndedAt: at("2026-10-05", 10), Minutes: 60},
		{UserID: uid, TaskID: &write, TaskName: "Write", StartedAt: at("2026-10-06", 23), EndedAt: at("2026-10-06", 23).Add(45 * time.Minute), Minutes: 45},
		{UserID: uid, TaskID: &read, TaskName: "Read", StartedAt: at("2026-10-07", 9), EndedAt: at("2026-10-07", 9).Add(30 * time.Minute), Minutes: 30},
	} {
		if err := db.Create(&s).Error; err != nil {
			t.Fatal(err)
		}
	}
	week := call("list_focus_sessions", map[string]any{"from": "2026-10-05", "to": "2026-10-06", "timezone": "UTC"})
	if sessions := week["sessions"].([]any); len(sessions) != 2 || week["minutes"] != float64(105) {
		t.Fatalf("both days are included and the 7th is not: %v", week)
	}
	one := call("list_focus_sessions", map[string]any{"from": "2026-10-01", "to": "2026-10-31", "taskId": read, "timezone": "UTC"})
	if sessions := one["sessions"].([]any); len(sessions) != 2 || one["minutes"] != float64(90) {
		t.Fatalf("taskId keeps only that task's sessions: %v", one)
	}
}
