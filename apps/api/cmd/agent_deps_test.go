package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
)

func TestIntegrationRealAgentToolsShareTransaction(t *testing.T) {
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("run make test-chat-integration")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schema := "agent_tools_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := root.DB(); sqlDB.Close() })
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	goose.SetTableName(schema + ".goose_db_version")
	t.Cleanup(func() { goose.SetTableName("goose_db_version") })
	if err = goose.Up(sqlDB, "../migrations"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENROUTER_API_KEY", "unused-test-key")
	uid := "usr_agent_test"
	if err = db.Create(&models.User{ID: uid, Email: "agent@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO configs (id,user_id) VALUES (?,?)", "cfg_test", uid).Error; err != nil {
		t.Fatal(err)
	}
	rollback := fmt.Errorf("rollback test")
	createAll := func(tx *gorm.DB) error {
		tools := chatCatalog(tx, realtime.NewHub())
		call := func(name string, args map[string]any) map[string]any {
			t.Helper()
			raw, _ := json.Marshal(args)
			out, err := tools[name].Call(context.Background(), uid, raw)
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			bytes, _ := json.Marshal(out)
			var result map[string]any
			json.Unmarshal(bytes, &result)
			return result
		}
		ws := call("create_workspace", map[string]any{"name": "Personal"})
		pr := call("create_project", map[string]any{"title": "PDF prototype", "workspaceId": ws["id"]})
		call("create_doc", map[string]any{"title": "Plan", "markdown": "# Initial plan\n\nBuild merge and split.", "workspaceId": ws["id"], "projectId": pr["id"]})
		call("create_task", map[string]any{"name": "Study", "workspaceId": ws["id"]})
		sheet := call("create_sheet", map[string]any{"title": "Budget", "workspaceId": ws["id"], "projectId": pr["id"]})["sheet"].(map[string]any)
		call("update_sheet", map[string]any{"sheetId": sheet["id"], "columns": []any{map[string]any{"id": "item", "name": "Item", "type": "text", "width": 180}, map[string]any{"id": "price", "name": "Cost", "type": "currency", "width": 120}}, "rows": []any{map[string]any{"id": "hosting", "cells": map[string]string{"item": "Hosting", "price": "25"}}}})
		template := call("create_sheet_template", map[string]any{"sheetId": sheet["id"], "name": "Monthly expenses"})
		if template["name"] != "Monthly expenses" {
			t.Fatal("template was not saved")
		}
		event := call("create_event", map[string]any{"title": "Standup", "start": "2026-10-05T09:00:00Z", "end": "2026-10-05T09:30:00Z", "workspaceId": ws["id"], "recurrence": map[string]string{"rrule": "FREQ=WEEKLY;BYDAY=MO,WE", "dtstart": "2026-10-05T09:00:00Z", "timezone": "UTC"}})
		call("edit_event_occurrence", map[string]any{"eventId": event["id"], "action": "move", "originalStart": "2026-10-14T09:00:00Z", "newStart": "2026-10-15T11:00:00Z", "newEnd": "2026-10-15T11:30:00Z"})
		next := call("split_event_series", map[string]any{"eventId": event["id"], "fromStart": "2026-10-12T09:00:00Z", "rrule": "FREQ=WEEKLY;BYDAY=MO,TU"})
		rule := next["recurrence"].(map[string]any)
		if exceptions, ok := rule["exceptions"].([]any); !ok || len(exceptions) != 1 {
			t.Fatal("future split lost the adjusted meeting")
		}
		return nil
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := createAll(tx); err != nil {
			return err
		}
		return rollback
	}); err != rollback {
		t.Fatal(err)
	}
	for _, model := range []any{&models.Workspace{}, &models.Project{}, &models.Document{}, &models.Task{}, &models.Sheet{}, &models.SheetTemplate{}, &models.Job{}} {
		var count int64
		db.Model(model).Count(&count)
		if count != 0 {
			t.Fatalf("%T escaped rollback: %d", model, count)
		}
	}
	if err := db.Transaction(createAll); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&models.Sheet{}).Count(&count)
	if count != 1 {
		t.Fatal("sheet missing after commit")
	}
}
