package main

import (
	"strings"
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

func TestIntegrationDocHistoryDailyNotesAndBacklinks(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})

	first := call("open_daily_note", map[string]any{"date": "2026-10-19"})
	again := call("open_daily_note", map[string]any{"date": "2026-10-19"})
	if first["created"] != true || again["created"] != false || again["id"] != first["id"] || first["title"] != "2026-10-19" {
		t.Fatalf("one daily note per day: %v then %v", first, again)
	}

	plan := call("create_doc", map[string]any{"title": "Plan", "markdown": "First draft", "workspaceId": ws["id"]})
	call("update_doc", map[string]any{"docId": plan["id"], "markdown": "Second draft"})
	versions := call("list_doc_versions", map[string]any{"docId": plan["id"]})["versions"].([]any)
	var older string
	for _, v := range versions {
		if v.(map[string]any)["current"] != true {
			older = v.(map[string]any)["id"].(string)
		}
	}
	if len(versions) < 2 || older == "" {
		t.Fatalf("the first draft is kept as an older version: %v", versions)
	}
	restored := call("restore_doc_version", map[string]any{"docId": plan["id"], "versionId": older})
	if !strings.Contains(restored["markdown"].(string), "First draft") {
		t.Fatalf("restore puts the first draft back: %v", restored["markdown"])
	}
	if doc := call("get_doc", map[string]any{"docId": plan["id"]}); !strings.Contains(doc["markdown"].(string), "First draft") {
		t.Fatalf("the restored draft is what the doc reads: %v", doc["markdown"])
	}

	notes := call("create_doc", map[string]any{"title": "Notes", "markdown": "Follow the [[Plan]] closely", "workspaceId": ws["id"]})
	links := call("get_doc_backlinks", map[string]any{"docId": plan["id"]})["backlinks"].([]any)
	if len(links) != 1 || links[0].(map[string]any)["id"] != notes["id"] {
		t.Fatalf("Notes links to Plan: %v", links)
	}
	if none := call("get_doc_backlinks", map[string]any{"docId": notes["id"]})["backlinks"].([]any); len(none) != 0 {
		t.Fatalf("nothing links to Notes: %v", none)
	}
}
