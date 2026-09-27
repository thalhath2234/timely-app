//go:build ignore

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type roundTripper struct {
	base  http.RoundTripper
	token string
}

func (r roundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+r.token)
	base := r.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(req)
}

type runner struct {
	ctx     context.Context
	session *mcp.ClientSession
	called  map[string]bool
	fails   []string
	notes   []string
}

func main() {
	ctx := context.Background()
	base := getenv("TIMELY_API", "http://localhost:8081")
	email := fmt.Sprintf("mcp-parity-%d@example.com", time.Now().Unix())
	password := "parity-pass-1"
	name := "MCP Parity"

	jar, err := cookiejar.New(nil)
	if err != nil {
		fatal(err)
	}
	httpClient := &http.Client{Jar: jar, Timeout: 30 * time.Second}
	registerBody, _ := json.Marshal(map[string]string{"name": name, "email": email, "password": password})
	resp, err := httpClient.Post(base+"/register", "application/json", bytes.NewReader(registerBody))
	if err != nil {
		fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		fatal(fmt.Errorf("register %d: %s", resp.StatusCode, body))
	}

	keyReq, _ := json.Marshal(map[string]string{"name": "mcp-parity"})
	resp, err = httpClient.Post(base+"/api-keys", "application/json", bytes.NewReader(keyReq))
	if err != nil {
		fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		fatal(fmt.Errorf("create key %d: %s", resp.StatusCode, body))
	}
	var created struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(body, &created); err != nil || created.Key == "" {
		fatal(fmt.Errorf("no key in response: %s", body))
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "timely-parity", Version: "1.0.0"}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint: base + "/mcp",
		HTTPClient: &http.Client{
			Timeout:   60 * time.Second,
			Transport: roundTripper{token: created.Key},
		},
		DisableStandaloneSSE: true,
	}
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		fatal(err)
	}
	defer session.Close()

	r := &runner{ctx: ctx, session: session, called: map[string]bool{}}
	r.exercise(email)
	r.report(session)
}

func (r *runner) exercise(email string) {
	now := time.Now().UTC().Truncate(time.Minute)
	stamp := fmt.Sprintf("%d", now.Unix())
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	inTwoHours := now.Add(2 * time.Hour).Format(time.RFC3339)
	inThreeHours := now.Add(3 * time.Hour).Format(time.RFC3339)
	tomorrow := now.Add(26 * time.Hour).Format(time.RFC3339)
	tomorrowEnd := now.Add(27 * time.Hour).Format(time.RFC3339)
	weekOut := now.AddDate(0, 0, 14).Format(time.RFC3339)

	r.call("get_profile", nil)
	r.call("update_profile", map[string]any{"name": "Parity Tester"})
	r.call("get_context", nil)
	r.call("get_config", nil)
	r.call("update_account_config", map[string]any{
		"isOnboardingCompleted": true,
		"theme":                 "dark",
		"accent":                "#6E56CF",
	})

	ws := r.call("create_workspace", map[string]any{"name": "Parity Lab", "color": "#6E56CF"})
	wsID := str(ws, "id")
	scratch := r.call("create_workspace", map[string]any{"name": "Scratch"})
	r.call("list_workspaces", nil)
	r.call("get_workspace", map[string]any{"workspaceId": wsID})
	r.call("rename_workspace", map[string]any{"workspaceId": wsID, "name": "Parity Lab", "color": "#6E56CF"})
	r.call("delete_workspace", map[string]any{"workspaceId": str(scratch, "id"), "confirm": true})

	status := r.call("create_status", map[string]any{"workspaceId": wsID, "name": "Blocked", "color": "#E5484D"})
	statusID := str(status, "id")
	r.call("update_status", map[string]any{"workspaceId": wsID, "id": statusID, "name": "Waiting", "color": "#F5A623"})
	r.call("delete_status", map[string]any{"workspaceId": wsID, "id": statusID})
	kept := r.call("create_status", map[string]any{"workspaceId": wsID, "name": "Doing", "color": "#3E63DD"})
	doingID := str(kept, "id")

	label := r.call("create_label", map[string]any{"workspaceId": wsID, "name": "Agent " + stamp, "color": "#6E56CF"})
	labelID := str(label, "id")
	tempLabel := r.call("create_label", map[string]any{"workspaceId": wsID, "name": "Temp " + stamp, "color": "#999999"})
	r.call("update_label", map[string]any{"workspaceId": wsID, "id": labelID, "name": "Tracked " + stamp, "color": "#6E56CF"})
	r.call("delete_label", map[string]any{"workspaceId": wsID, "id": str(tempLabel, "id")})

	field := r.call("create_custom_field", map[string]any{"workspaceId": wsID, "name": "Source", "type": "text"})
	fieldID := str(field, "id")
	tempField := r.call("create_custom_field", map[string]any{"workspaceId": wsID, "name": "Temp field", "type": "number"})
	r.call("update_custom_field", map[string]any{"workspaceId": wsID, "id": fieldID, "name": "Origin", "type": "text"})
	r.call("delete_custom_field", map[string]any{"workspaceId": wsID, "id": str(tempField, "id")})

	project := r.call("create_project", map[string]any{
		"title": "MCP parity", "workspaceId": wsID, "description": "Exercise every tool.",
		"priorityLevel": "High", "color": "#6E56CF", "doesHaveStages": true,
		"deadline": now.AddDate(0, 0, 7).Format("2006-01-02"),
	})
	projectID := str(project, "id")
	r.call("list_projects", map[string]any{"workspaceId": wsID})
	r.call("update_project", map[string]any{"projectId": projectID, "title": "MCP parity lab"})
	stageA := r.call("create_stage", map[string]any{"projectId": projectID, "name": "Backlog", "color": "#999999"})
	stageB := r.call("create_stage", map[string]any{"projectId": projectID, "name": "Doing", "color": "#3E63DD"})
	stageC := r.call("create_stage", map[string]any{"projectId": projectID, "name": "Later", "color": "#F5A623"})
	r.call("reorder_stages", map[string]any{"projectId": projectID, "ids": []string{str(stageB, "id"), str(stageA, "id"), str(stageC, "id")}})
	r.call("update_stage", map[string]any{"projectId": projectID, "stageId": str(stageA, "id"), "name": "Ready", "color": "#30A46C"})
	r.call("delete_stage", map[string]any{"projectId": projectID, "stageId": str(stageC, "id")})
	r.call("get_project", map[string]any{"projectId": projectID})
	dupProject := r.call("duplicate_project", map[string]any{"projectId": projectID})
	dupProjectID := str(dupProject, "project", "id")
	r.call("complete_project", map[string]any{"projectId": dupProjectID})
	r.call("reopen_project", map[string]any{"projectId": dupProjectID})
	r.call("delete_project", map[string]any{"projectId": dupProjectID, "confirm": true})
	r.call("set_project_task_view", map[string]any{"projectId": projectID, "name": "Project board", "renderMode": "kanban"})

	work := r.call("create_task", map[string]any{
		"name": "Write parity notes", "workspaceId": wsID, "projectId": projectID,
		"duration": 60, "priorityLevel": "High", "description": "Cover every MCP tool.",
		"deadline": now.AddDate(0, 0, 2).Format("2006-01-02"), "stageId": str(stageB, "id"),
	})
	workID := str(work, "task", "id")
	review := r.call("create_task", map[string]any{
		"name": "Review the notes", "workspaceId": wsID, "projectId": projectID,
		"duration": 30, "priorityLevel": "Medium", "stageId": str(stageA, "id"),
	})
	reviewID := str(review, "task", "id")
	overdue := r.call("create_task", map[string]any{
		"name": "Ship the digest", "workspaceId": wsID, "projectId": projectID,
		"duration": 45, "priorityLevel": "Medium", "deadline": yesterday,
	})
	overdueID := str(overdue, "task", "id")
	side := r.call("create_task", map[string]any{
		"name": "Clear this block", "workspaceId": wsID, "duration": 15, "projectId": projectID,
	})
	sideID := str(side, "task", "id")
	r.call("capture_inbox_item", map[string]any{"name": "Call the printer", "workspaceId": wsID})
	inbox := r.call("list_inbox", nil)
	inboxID := firstID(inbox, "tasks")
	r.call("clarify_inbox_item", map[string]any{"taskId": inboxID, "kind": "task", "workspaceId": wsID, "duration": 20, "projectId": projectID})
	r.call("create_task", map[string]any{
		"name": "Standup ping", "kind": "reminder", "duration": 0, "scheduleAt": now.Add(30 * time.Second).Format(time.RFC3339),
	})
	r.call("list_tasks", map[string]any{"workspaceId": wsID, "text": "parity"})
	r.call("get_task", map[string]any{"taskId": workID})
	r.call("update_task", map[string]any{"taskId": workID, "name": "Write the parity notes"})
	r.call("bulk_update_tasks", map[string]any{"ids": []string{workID, reviewID}, "update": map[string]any{"priorityLevel": "High"}})
	r.call("move_task_to_status", map[string]any{"taskId": workID, "statusId": doingID})
	r.call("move_task_to_stage", map[string]any{"taskId": reviewID, "stageId": str(stageB, "id")})
	r.call("set_task_labels", map[string]any{"taskId": workID, "labelIds": []string{labelID}})
	r.call("set_task_custom_field", map[string]any{"taskId": workID, "customFieldId": fieldID, "stringValue": "parity-run"})
	r.call("set_task_dependency", map[string]any{"taskId": reviewID, "blockedById": workID})
	r.call("add_task_comment", map[string]any{"taskId": workID, "comment": "Started from the parity harness."})
	r.call("list_task_activity", map[string]any{"taskId": workID})
	r.call("list_project_activity", map[string]any{"projectId": projectID})

	added := r.call("add_checklist_item", map[string]any{"taskId": workID, "title": "Draft the outline"})
	itemID := firstID(added, "task", "checklist")
	r.call("update_checklist_item", map[string]any{"taskId": workID, "itemId": itemID, "title": "Draft the full outline"})
	r.call("toggle_checklist_item", map[string]any{"taskId": workID, "itemId": itemID, "completed": true})
	r.call("replace_checklist", map[string]any{"taskId": workID, "items": []map[string]any{
		{"title": "Draft the outline"},
		{"title": "Run the tools"},
	}})
	replaced := r.call("get_task", map[string]any{"taskId": workID})
	dropID := firstID(replaced, "task", "checklist")
	r.call("delete_checklist_item", map[string]any{"taskId": workID, "itemId": dropID})

	r.call("start_focus", map[string]any{"taskId": workID})
	r.call("pause_focus", map[string]any{"taskId": workID})
	r.call("stop_focus", map[string]any{"taskId": workID})
	r.call("set_today_focus", map[string]any{"taskId": workID, "date": today})
	r.call("get_today", map[string]any{"date": today, "timezone": "UTC"})
	dupTask := r.call("duplicate_task", map[string]any{"taskId": workID})
	dupTaskID := str(dupTask, "task", "id")
	r.call("complete_task", map[string]any{"taskId": dupTaskID})
	r.call("reopen_task", map[string]any{"taskId": dupTaskID})
	r.call("delete_task", map[string]any{"taskId": dupTaskID})

	recur := r.call("create_task", map[string]any{
		"name": "Weekly review", "workspaceId": wsID, "projectId": projectID, "duration": 25,
		"recurrence": map[string]any{"rrule": "FREQ=DAILY;COUNT=5", "dtstart": tomorrow, "timezone": "UTC"},
	})
	recurID := str(recur, "task", "id")
	r.call("set_task_recurrence", map[string]any{"taskId": recurID, "rrule": "FREQ=DAILY;COUNT=4", "dtstart": tomorrow, "timezone": "UTC"})
	r.call("get_calendar", map[string]any{"from": now.Format(time.RFC3339), "to": weekOut, "timezone": "UTC"})
	r.call("edit_task_occurrence", map[string]any{"taskId": recurID, "originalStart": tomorrow, "action": "skip"})
	r.call("edit_task_occurrence", map[string]any{"taskId": recurID, "originalStart": tomorrow, "action": "restore"})
	splitFrom := now.Add(48 * time.Hour).Format(time.RFC3339)
	r.call("split_task_series", map[string]any{
		"taskId": recurID, "fromStart": splitFrom, "rrule": "FREQ=DAILY;COUNT=3",
		"dtstart": splitFrom, "timezone": "UTC", "name": "Weekly review (next)",
	})
	r.call("clear_task_recurrence", map[string]any{"taskId": recurID})

	r.call("get_working_hours", map[string]any{"timezone": "UTC"})
	r.call("update_working_hours", map[string]any{
		"timezone": "UTC",
		"days": map[string]any{
			"mon": []map[string]string{{"start": "09:00", "end": "17:00"}},
			"tue": []map[string]string{{"start": "09:00", "end": "17:00"}},
			"wed": []map[string]string{{"start": "09:00", "end": "17:00"}},
			"thu": []map[string]string{{"start": "09:00", "end": "17:00"}},
			"fri": []map[string]string{{"start": "09:00", "end": "17:00"}},
		},
	})
	r.call("get_schedule_settings", nil)
	r.call("update_schedule_settings", map[string]any{"breakMinutes": 10, "freezeHours": 1, "excludedWorkspaceIds": []string{}})
	r.call("get_capacity", map[string]any{"timezone": "UTC"})
	sideBlock := r.call("schedule_task", map[string]any{"taskId": sideID, "start": inThreeHours, "durationMinutes": 15, "replace": true})
	r.call("delete_block", map[string]any{"id": firstID(sideBlock, "blocks")})
	r.call("clear_task_blocks", map[string]any{"taskId": sideID})
	scheduled := r.call("schedule_task", map[string]any{"taskId": reviewID, "start": inTwoHours, "durationMinutes": 30, "replace": true})
	blockID := firstID(scheduled, "blocks")
	if blockID != "" {
		r.call("move_block", map[string]any{"blockId": blockID, "start": inThreeHours})
		r.call("pin_block", map[string]any{"blockId": blockID, "locked": true})
	} else {
		r.fail("move_block", "no block id")
		r.fail("pin_block", "no block id")
	}
	r.call("pin_task", map[string]any{"taskId": workID, "locked": true})
	r.call("auto_schedule_preview", map[string]any{"timezone": "UTC"})
	r.call("auto_schedule_apply", map[string]any{"timezone": "UTC"})
	r.call("undo_schedule", nil)
	r.call("reschedule_urgent", map[string]any{"taskId": overdueID})

	event := r.call("create_event", map[string]any{
		"title": "Design review", "start": tomorrow, "end": tomorrowEnd,
		"description": "Look at the parity notes", "workspaceId": wsID, "projectId": projectID, "color": "#3E63DD",
	})
	eventID := str(event, "id")
	r.call("list_events", nil)
	r.call("get_event", map[string]any{"eventId": eventID})
	r.call("update_event", map[string]any{"eventId": eventID, "title": "Design review (parity)"})
	series := r.call("create_event", map[string]any{
		"title": "Daily standup", "start": tomorrow, "end": tomorrowEnd, "workspaceId": wsID,
		"recurrence": map[string]any{"rrule": "FREQ=DAILY;COUNT=5", "dtstart": tomorrow, "timezone": "UTC"},
	})
	seriesID := str(series, "id")
	cal := r.call("get_calendar", map[string]any{"from": now.Format(time.RFC3339), "to": weekOut, "timezone": "UTC"})
	eventOriginal := eventOccurrence(cal, seriesID)
	if eventOriginal != "" {
		r.call("edit_event_occurrence", map[string]any{"eventId": seriesID, "originalStart": eventOriginal, "action": "skip"})
		r.call("edit_event_occurrence", map[string]any{"eventId": seriesID, "originalStart": eventOriginal, "action": "restore"})
	} else {
		r.fail("edit_event_occurrence", "calendar had no event occurrence")
	}
	r.call("split_event_series", map[string]any{
		"eventId": seriesID, "fromStart": splitFrom, "rrule": "FREQ=DAILY;COUNT=3",
		"dtstart": splitFrom, "timezone": "UTC", "title": "Daily standup (next)",
	})
	r.call("delete_event", map[string]any{"eventId": eventID})

	r.call("get_agenda", map[string]any{"from": now.Format(time.RFC3339), "to": weekOut, "timezone": "UTC"})
	r.call("get_free_time", map[string]any{"from": now.Format(time.RFC3339), "to": weekOut, "timezone": "UTC"})
	r.call("what_next", nil)
	r.call("search", map[string]any{"query": "parity", "limit": 10})
	if msg := r.callAllow("semantic_search", map[string]any{"query": "notes about the parity test", "limit": 5}, "not configured"); msg != "" {
		r.notes = append(r.notes, "semantic_search: "+msg)
	}
	if msg := r.callAllow("reindex_search", nil, "not configured"); msg != "" {
		r.notes = append(r.notes, "reindex_search: "+msg)
	}

	doc := r.call("create_doc", map[string]any{"title": "Parity notes", "workspaceId": wsID, "projectId": projectID, "markdown": "# Parity\n\nHello from the harness."})
	docID := str(doc, "id")
	child := r.call("create_doc", map[string]any{"title": "Scratch page", "workspaceId": wsID, "parentId": docID, "markdown": "Temporary."})
	r.call("list_docs", map[string]any{"workspaceId": wsID})
	r.call("get_doc", map[string]any{"docId": docID})
	r.call("update_doc", map[string]any{"docId": docID, "title": "Parity notes", "isFavorite": true})
	r.call("append_to_doc", map[string]any{"docId": docID, "markdown": "\n\nAppended by the harness."})
	r.call("archive_doc", map[string]any{"docId": str(child, "id"), "archived": true})
	r.call("archive_doc", map[string]any{"docId": str(child, "id"), "archived": false})
	r.call("export_doc", map[string]any{"docId": docID, "format": "markdown"})
	r.call("export_doc", map[string]any{"docId": docID, "format": "pdf"})
	doomed := r.call("create_doc", map[string]any{"title": "Delete me", "workspaceId": wsID, "markdown": "gone"})
	r.call("delete_doc", map[string]any{"docId": str(doomed, "id"), "confirm": true})

	sheet := r.call("create_sheet", map[string]any{"title": "Inventory", "workspaceId": wsID, "projectId": projectID})
	sheetID := str(sheet, "sheet", "id")
	r.call("list_sheets", map[string]any{"workspaceId": wsID})
	r.call("get_sheet", map[string]any{"sheetId": sheetID})
	withCol := r.call("add_sheet_column", map[string]any{"sheetId": sheetID, "name": "Qty", "type": "number"})
	colID := lastID(withCol, "sheet", "columns")
	rowID := firstID(withCol, "sheet", "rows")
	r.call("update_sheet_column", map[string]any{"sheetId": sheetID, "columnId": colID, "name": "Quantity", "type": "number"})
	r.call("update_sheet_cells", map[string]any{"sheetId": sheetID, "rowId": rowID, "cells": map[string]string{colID: "3"}})
	r.call("add_sheet_rows", map[string]any{"sheetId": sheetID, "count": 1})
	grown := r.call("get_sheet", map[string]any{"sheetId": sheetID})
	lastRow := lastID(grown, "sheet", "rows")
	r.call("delete_sheet_rows", map[string]any{"sheetId": sheetID, "rowIds": []string{lastRow}})
	dropCol := r.call("add_sheet_column", map[string]any{"sheetId": sheetID, "name": "Drop", "type": "text"})
	r.call("delete_sheet_column", map[string]any{"sheetId": sheetID, "columnId": lastID(dropCol, "sheet", "columns")})
	r.call("update_sheet", map[string]any{"sheetId": sheetID, "title": "Inventory list", "isFavorite": true, "merges": []any{}})
	dupSheet := r.call("duplicate_sheet", map[string]any{"sheetId": sheetID})
	dupSheetID := str(dupSheet, "sheet", "id")
	tmpl := r.call("create_sheet_template", map[string]any{"sheetId": sheetID, "name": "Inventory template"})
	tmplID := str(tmpl, "id")
	r.call("list_sheet_templates", nil)
	r.call("get_sheet_template", map[string]any{"templateId": tmplID})
	r.call("update_sheet_template", map[string]any{"templateId": tmplID, "name": "Inventory starter"})
	r.call("materialize_sheet_template_tab", map[string]any{"templateId": tmplID})
	fromTmpl := r.call("create_sheet", map[string]any{"title": "From template", "workspaceId": wsID, "templateId": tmplID})
	r.call("archive_sheet", map[string]any{"sheetId": str(fromTmpl, "sheet", "id"), "archived": true})
	r.call("archive_sheet", map[string]any{"sheetId": str(fromTmpl, "sheet", "id"), "archived": false})
	r.call("delete_sheet", map[string]any{"sheetId": dupSheetID})
	r.call("delete_sheet_template", map[string]any{"templateId": tmplID})

	view := r.call("create_task_view", map[string]any{"name": "Parity view", "renderMode": "list", "selectedProjectIds": []string{projectID}})
	viewID := str(view, "view", "id")
	r.call("list_task_views", nil)
	r.call("update_task_view", map[string]any{"viewId": viewID, "name": "Parity list"})
	r.call("set_active_task_view", map[string]any{"viewId": viewID})
	r.call("delete_task_view", map[string]any{"viewId": viewID})

	r.call("get_notification_settings", nil)
	r.call("update_notification_settings", map[string]any{"reminders": true, "timezone": "UTC", "quietHoursStart": "22:00", "quietHoursEnd": "07:00"})
	r.call("list_notifications", map[string]any{"limit": 20})
	r.call("unread_notification_count", nil)
	notes := r.call("list_notifications", map[string]any{"unread": true, "limit": 20})
	ntfID := firstID(notes, "items")
	if ntfID == "" {
		time.Sleep(12 * time.Second)
		notes = r.call("list_notifications", map[string]any{"unread": true, "limit": 20})
		ntfID = firstID(notes, "items")
	}
	if ntfID != "" {
		r.call("snooze_reminder", map[string]any{"id": ntfID, "minutes": 15})
		r.call("mark_notification_read", map[string]any{"id": ntfID})
	} else {
		r.fail("snooze_reminder", "no notification was produced")
		r.call("mark_notification_read", map[string]any{})
	}
	r.call("list_jobs", map[string]any{"limit": 20})
	r.call("get_job_health", nil)
	jobs := r.call("list_jobs", map[string]any{"limit": 20})
	jobID := firstID(jobs, "items")
	if jobID == "" {
		r.callAllow("retry_job", map[string]any{"id": "job_none"}, "")
		r.notes = append(r.notes, "retry_job: no job row existed to retry")
	} else {
		r.callAllow("retry_job", map[string]any{"id": jobID}, "only failed or cancelled")
	}
	r.call("clear_notifications", nil)

	r.call("get_backup_settings", nil)
	r.call("update_backup_settings", map[string]any{"enabled": true, "intervalDays": 7, "retentionCount": 3})
	r.call("export_tasks_csv", nil)
	r.call("export_calendar", nil)
	exported := r.call("export_account", nil)
	backup := r.call("create_backup", nil)
	backupID := str(backup, "id")
	r.call("list_backups", nil)
	r.call("download_backup", map[string]any{"backupId": backupID})
	r.call("delete_backup", map[string]any{"backupId": backupID, "confirm": true})
	if exported != nil {
		r.call("restore_account", map[string]any{"confirm": true, "backup": exported["backup"]})
	} else {
		r.fail("restore_account", "export_account did not return a backup")
	}
	r.call("get_context", nil)
	fmt.Println("account", email)
}

func (r *runner) call(name string, args map[string]any) map[string]any {
	out, errText := r.invoke(name, args)
	if errText != "" {
		r.fails = append(r.fails, name+": "+errText)
		fmt.Println("FAIL", name, errText)
		return nil
	}
	fmt.Println("ok", name)
	return out
}

func (r *runner) callAllow(name string, args map[string]any, allow string) string {
	out, errText := r.invoke(name, args)
	if errText == "" {
		fmt.Println("ok", name)
		_ = out
		return ""
	}
	if allow != "" && strings.Contains(errText, allow) {
		fmt.Println("ok", name, "(allowed:", errText, ")")
		return errText
	}
	r.fails = append(r.fails, name+": "+errText)
	fmt.Println("FAIL", name, errText)
	return errText
}

func (r *runner) fail(name, msg string) {
	r.called[name] = true
	r.fails = append(r.fails, name+": "+msg)
	fmt.Println("FAIL", name, msg)
}

func (r *runner) invoke(name string, args map[string]any) (map[string]any, string) {
	r.called[name] = true
	if args == nil {
		args = map[string]any{}
	}
	res, err := r.session.CallTool(r.ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		return nil, err.Error()
	}
	if res.IsError {
		raw, _ := json.Marshal(res.Content)
		return nil, string(raw)
	}
	if res.StructuredContent == nil {
		return map[string]any{}, ""
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		return nil, err.Error()
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err.Error()
	}
	return out, ""
}

func (r *runner) report(session *mcp.ClientSession) {
	listed, err := session.ListTools(r.ctx, nil)
	if err != nil {
		r.fails = append(r.fails, "list tools: "+err.Error())
	} else {
		var missing []string
		for _, tool := range listed.Tools {
			if !r.called[tool.Name] {
				missing = append(missing, tool.Name)
			}
		}
		fmt.Printf("tools registered %d, called %d\n", len(listed.Tools), len(r.called))
		if len(missing) > 0 {
			r.fails = append(r.fails, "uncalled: "+strings.Join(missing, ", "))
		}
	}
	for _, note := range r.notes {
		fmt.Println("note", note)
	}
	if len(r.fails) > 0 {
		fmt.Fprintf(os.Stderr, "\n%d failures:\n", len(r.fails))
		for _, fail := range r.fails {
			fmt.Fprintln(os.Stderr, "-", fail)
		}
		os.Exit(1)
	}
	fmt.Println("parity passed")
}

func str(m map[string]any, path ...string) string {
	cur := any(m)
	for _, key := range path {
		obj, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = obj[key]
	}
	s, _ := cur.(string)
	return s
}

func firstID(m map[string]any, path ...string) string {
	return nthID(m, 0, path...)
}

func lastID(m map[string]any, path ...string) string {
	items := sliceAt(m, path...)
	if len(items) == 0 {
		return ""
	}
	obj, _ := items[len(items)-1].(map[string]any)
	s, _ := obj["id"].(string)
	return s
}

func nthID(m map[string]any, n int, path ...string) string {
	items := sliceAt(m, path...)
	if n >= len(items) {
		return ""
	}
	obj, _ := items[n].(map[string]any)
	s, _ := obj["id"].(string)
	return s
}

func sliceAt(m map[string]any, path ...string) []any {
	cur := any(m)
	for _, key := range path {
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = obj[key]
	}
	items, _ := cur.([]any)
	return items
}

func eventOccurrence(cal map[string]any, eventID string) string {
	for _, item := range sliceAt(cal, "items") {
		obj, _ := item.(map[string]any)
		if str(obj, "eventId") != eventID && str(obj, "seriesId") != eventID {
			continue
		}
		if start := str(obj, "originalStart"); start != "" {
			return start
		}
		if start := str(obj, "start"); start != "" {
			return start
		}
	}
	return ""
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
