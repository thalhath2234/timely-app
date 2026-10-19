package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/suggest"
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

// staleJev calls every stale task blocked.
func staleJev(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		answers := map[string]any{}
		for id := range req.Questions {
			answers[id] = map[string]any{"type": "choice", "choice": "blocked", "confidence": 0.95}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": answers, "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestIntegrationSuggestionTools(t *testing.T) {
	db, uid := agentToolsDB(t)
	defer func(old *suggest.Service) { todaySuggestions = old }(todaySuggestions)
	ws := agentToolCaller(t, db, uid)("create_workspace", map[string]any{"name": "Personal"})["id"].(string)
	old := time.Now().AddDate(0, 0, -40).Format("2006-01-02")
	stale := "tsk_renew_passport"
	if err := db.Create(&models.Task{ID: stale, Name: "Renew passport", UserID: &uid, WorkspaceID: &ws, Kind: models.KindTask}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.Task{}).Where("id = ?", stale).UpdateColumns(map[string]any{"created_at": old, "updated_at": old}).Error; err != nil {
		t.Fatal(err)
	}

	todaySuggestions = nil
	for _, name := range []string{"list_stale_work", "get_today_suggestions"} {
		if _, err := chatCatalog(db, nil, nil)[name].Call(context.Background(), uid, json.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "not available") {
			t.Fatalf("%s without the service: %v", name, err)
		}
	}

	client := decide.NewClient(nil)
	client.TypeSafeURL = staleJev(t).URL
	keys := decide.Keys{TypeSafe: "ts-test-key-123"}
	todaySuggestions = suggest.New(db, decide.New(db, func(context.Context, string) (decide.Keys, error) { return keys, nil }, client), nil)
	call := agentToolCaller(t, db, uid)
	for _, name := range []string{"list_stale_work", "get_today_suggestions"} {
		if out := call(name, map[string]any{}); out["available"] == true {
			t.Fatalf("%s with smart suggestions off: %v", name, out)
		}
	}

	keys.Enabled = true
	work := call("list_stale_work", map[string]any{})
	tasks := work["tasks"].([]any)
	if work["available"] != true || len(tasks) != 1 {
		t.Fatalf("one stale task: %v", work)
	}
	if got := tasks[0].(map[string]any); got["id"] != stale || got["verdict"] != "blocked" || got["idleDays"].(float64) < 39 {
		t.Fatalf("stale task with its idle days and verdict: %v", got)
	}
}

func TestIntegrationTriageAndDeleteNotifications(t *testing.T) {
	db, uid := agentToolsDB(t)
	call := agentToolCaller(t, db, uid)
	ws := call("create_workspace", map[string]any{"name": "Personal"})
	due := time.Now().AddDate(0, 0, -3).Format("2006-01-02")
	taskID := call("create_task", map[string]any{"name": "File taxes", "workspaceId": ws["id"], "deadline": due, "priorityLevel": "High"})["task"].(map[string]any)["id"].(string)
	entity := "task"
	for _, id := range []string{"ntf_overdue", "ntf_other"} {
		n := models.Notification{ID: id, UserID: uid, Category: models.NotifyOverdue, Title: "File taxes is overdue", EntityType: &entity, EntityID: &taskID, Data: models.JobPayload{"taskId": taskID}, CreatedAt: time.Now()}
		if err := db.Create(&n).Error; err != nil {
			t.Fatal(err)
		}
	}

	if out := call("triage_notification", map[string]any{"notificationId": "ntf_overdue", "action": "lower"}); !strings.Contains(out["message"].(string), "Medium") {
		t.Fatalf("lower takes High to Medium: %v", out)
	}
	if got := call("get_task", map[string]any{"taskId": taskID})["task"].(map[string]any)["priorityLevel"]; got != "Medium" {
		t.Fatalf("the task's priority after triage: %v", got)
	}
	for _, n := range call("list_notifications", map[string]any{"unread": true})["items"].([]any) {
		if n.(map[string]any)["id"] == "ntf_overdue" {
			t.Fatal("a triaged notification is read")
		}
	}
	if _, err := chatCatalog(db, nil, nil)["triage_notification"].Call(context.Background(), uid, json.RawMessage(`{"notificationId":"ntf_overdue","action":"shrug"}`)); err == nil {
		t.Fatal("an unknown step was accepted")
	}

	call("delete_notification", map[string]any{"notificationId": "ntf_overdue"})
	left := call("list_notifications", map[string]any{})["items"].([]any)
	if len(left) != 1 || left[0].(map[string]any)["id"] != "ntf_other" {
		t.Fatalf("only the other notification is left: %v", left)
	}
	if _, err := chatCatalog(db, nil, nil)["delete_notification"].Call(context.Background(), uid, json.RawMessage(`{"notificationId":"ntf_overdue"}`)); err == nil {
		t.Fatal("deleting it twice succeeded")
	}
}
