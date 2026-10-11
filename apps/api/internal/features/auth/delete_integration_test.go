package auth

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Opt-in because it needs the production-like Postgres schema.
// Run with TIMELY_TEST_POSTGRES=1 go test ./internal/features/auth -run DeleteUserPostgres.
func TestDeleteUserPostgresRemovesEverything(t *testing.T) {
	if os.Getenv("TIMELY_TEST_POSTGRES") != "1" {
		t.Skip("set TIMELY_TEST_POSTGRES=1 to run the Postgres delete test")
	}
	_ = godotenv.Load("../../../../../.env")
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"), os.Getenv("DB_PORT"), os.Getenv("DB_SSLMODE"))
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })

	suffix := fmt.Sprint(time.Now().UnixNano())
	seed := func(owner string) {
		t.Helper()
		id := func(prefix string) string { return prefix + "_" + owner + "_" + suffix }
		now := "2026-10-11"
		statements := []struct {
			sql  string
			args []any
		}{
			{`INSERT INTO users (id,email,name,password,created_at,updated_at) VALUES (?,?,?,?,?,?)`, []any{id("usr"), owner + "-" + suffix + "@example.test", owner, "x", now, now}},
			{`INSERT INTO workspaces (id,name,user_id,created_at,updated_at) VALUES (?,?,?,?,?)`, []any{id("ws"), "Private", id("usr"), now, now}},
			{`INSERT INTO statuses (id,name,color,workspace_id,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, []any{id("st"), "Todo", "#888888", id("ws"), true, now, now}},
			{`INSERT INTO projects (id,title,workspace_id) VALUES (?,?,?)`, []any{id("prj"), "Project", id("ws")}},
			{`INSERT INTO stages (id,name,project_id) VALUES (?,?,?)`, []any{id("stg"), "Stage", id("prj")}},
			{`INSERT INTO schedules (id,name) VALUES (?,?)`, []any{id("sch"), "Weekdays"}},
			{`INSERT INTO tasks (id,name,description,duration,kind,user_id,workspace_id,status_id,project_id,stage_id,schedule_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, []any{id("tsk"), "Task", "", 30, "task", id("usr"), id("ws"), id("st"), id("prj"), id("stg"), id("sch"), now, now}},
			{`INSERT INTO documents (id,workspace_id,user_id) VALUES (?,?,?)`, []any{id("doc"), id("ws"), id("usr")}},
			{`INSERT INTO habits (id,user_id,name) VALUES (?,?,?)`, []any{id("hab"), id("usr"), "Walk"}},
			{`INSERT INTO notifications (id,user_id,category,title) VALUES (?,?,?,?)`, []any{id("ntf"), id("usr"), "reminder", "Hi"}},
			{`INSERT INTO jobs (id,user_id,kind,run_at) VALUES (?,?,?,now())`, []any{id("job"), id("usr"), "create_backup"}},
			{`INSERT INTO push_devices (id,user_id,token) VALUES (?,?,?)`, []any{id("psh"), id("usr"), id("token")}},
		}
		for _, statement := range statements {
			if err := tx.Exec(statement.sql, statement.args...).Error; err != nil {
				t.Fatalf("%s: %v", statement.sql, err)
			}
		}
	}
	seed("gone")
	seed("kept")
	gone, kept := "usr_gone_"+suffix, "usr_kept_"+suffix

	if err := NewUserRepository(tx).DeleteUser(gone); err != nil {
		t.Fatal(err)
	}

	var tables []string
	if err := tx.Raw(`SELECT table_name FROM information_schema.columns WHERE column_name = 'user_id' AND table_schema = current_schema()`).Scan(&tables).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range tables {
		var n int64
		tx.Raw(fmt.Sprintf(`SELECT count(*) FROM %q WHERE user_id = ?`, table), gone).Scan(&n)
		if n != 0 {
			t.Errorf("%s still has %d rows for the deleted account", table, n)
		}
	}
	for _, check := range []struct{ table, id string }{
		{"users", gone}, {"stages", "stg_gone_" + suffix}, {"schedules", "sch_gone_" + suffix},
		{"projects", "prj_gone_" + suffix}, {"statuses", "st_gone_" + suffix},
	} {
		var n int64
		tx.Raw(fmt.Sprintf(`SELECT count(*) FROM %q WHERE id = ?`, check.table), check.id).Scan(&n)
		if n != 0 {
			t.Errorf("%s %s survived the delete", check.table, check.id)
		}
	}
	for _, check := range []struct{ table, id string }{
		{"users", kept}, {"tasks", "tsk_kept_" + suffix}, {"stages", "stg_kept_" + suffix},
		{"schedules", "sch_kept_" + suffix}, {"jobs", "job_kept_" + suffix},
	} {
		var n int64
		tx.Raw(fmt.Sprintf(`SELECT count(*) FROM %q WHERE id = ?`, check.table), check.id).Scan(&n)
		if n != 1 {
			t.Errorf("the other account lost %s %s", check.table, check.id)
		}
	}
}
