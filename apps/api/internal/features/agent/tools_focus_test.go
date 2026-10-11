package agent

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"timely-api/internal/features/focus"
	"timely-api/internal/models"
)

func TestFocusToolsWithoutStore(t *testing.T) {
	catalog := NewCatalog(Deps{})
	for name, args := range map[string]string{"list_habits": `{}`, "check_habit": `{"habit":"Walk"}`, "add_habit": `{"name":"Walk"}`,
		"list_goals": `{}`, "set_goal": `{"action":"add","title":"Get fit"}`} {
		if _, err := catalog[name].Call(context.Background(), "usr_1", json.RawMessage(args)); err == nil || !strings.Contains(err.Error(), "not available") {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// focusDB is a scratch schema with users and the focus tables.
func focusDB(t *testing.T) *gorm.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
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
	schema := "agent_focus_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); db.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.AutoMigrate(append([]any{&models.User{}}, focus.Models...)...); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestIntegrationFocusTools(t *testing.T) {
	db := focusDB(t)
	uid := "usr_" + uuid.NewString()
	if err := db.Create(&models.User{ID: uid, Email: uid + "@test.local", Password: "x"}).Error; err != nil {
		t.Fatal(err)
	}
	catalog := NewCatalog(Deps{Focus: focus.NewStore(db)})
	ctx := WithTimezone(context.Background(), "UTC")
	call := func(name, args string) map[string]any {
		t.Helper()
		out, err := catalog[name].Call(ctx, uid, json.RawMessage(args))
		if err != nil {
			t.Fatalf("%s %s: %v", name, args, err)
		}
		raw, _ := json.Marshal(out)
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		return m
	}

	call("add_habit", `{"name":"Walk outside"}`)
	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	call("check_habit", `{"habit":"walk OUTSIDE","day":"`+yesterday+`"}`)
	if got := call("check_habit", `{"habit":"Walk outside"}`); got["doneToday"] != true || got["streak"] != float64(2) {
		t.Fatalf("checked today %v", got)
	}
	if got := call("check_habit", `{"habit":"Walk outside","done":false}`); got["doneToday"] != false || got["streak"] != float64(1) {
		t.Fatalf("unchecked today %v", got)
	}
	listed := call("list_habits", `{}`)
	if listed["today"] != today || len(listed["habits"].([]any)) != 1 {
		t.Fatalf("list %v", listed)
	}
	if _, err := catalog["check_habit"].Call(ctx, uid, json.RawMessage(`{"habit":"Swim"}`)); err == nil || !strings.Contains(err.Error(), "list_habits") {
		t.Fatalf("unknown habit: %v", err)
	}

	call("set_goal", `{"action":"add","title":"Get fit"}`)
	call("set_goal", `{"action":"rename","goal":"get fit","title":"Run a 10k"}`)
	goals := call("list_goals", `{}`)["items"].([]any)
	if len(goals) != 1 || goals[0].(map[string]any)["title"] != "Run a 10k" {
		t.Fatalf("goals %v", goals)
	}
	call("set_goal", `{"action":"remove","goal":"Run a 10k"}`)
	if goals := call("list_goals", `{}`)["items"].([]any); len(goals) != 0 {
		t.Fatalf("after remove %v", goals)
	}
	if _, err := catalog["set_goal"].Call(ctx, uid, json.RawMessage(`{"action":"archive","goal":"x"}`)); err == nil {
		t.Fatal("unknown action accepted")
	}
}
