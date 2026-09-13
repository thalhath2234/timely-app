package portability

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This test is opt-in because it needs the production-like Postgres schema.
// Run with TIMELY_TEST_POSTGRES=1 go test ./internal/features/portability -run RestorePostgres.
func TestRestorePostgresRoundTrip(t *testing.T) {
	if os.Getenv("TIMELY_TEST_POSTGRES") != "1" {
		t.Skip("set TIMELY_TEST_POSTGRES=1 to run the Postgres restore test")
	}
	_ = godotenv.Load("../../../.env")
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
	userID, workspaceID, statusID, taskID := "usr_restore_"+suffix, "ws_restore_"+suffix, "tst_restore_"+suffix, "tsk_restore_"+suffix
	if err := tx.Exec(`INSERT INTO users (id,email,name,password,created_at,updated_at) VALUES (?,?,?,?,?,?)`, userID, "restore-"+suffix+"@example.test", "Restore Test", "not-a-login", "2026-09-13", "2026-09-13").Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec(`INSERT INTO workspaces (id,name,user_id,created_at,updated_at) VALUES (?,?,?,?,?)`, workspaceID, "Private", userID, "2026-09-13", "2026-09-13").Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec(`INSERT INTO statuses (id,name,color,workspace_id,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, statusID, "Todo", "#888888", workspaceID, true, "2026-09-13", "2026-09-13").Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec(`INSERT INTO tasks (id,name,description,duration,kind,user_id,workspace_id,status_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, taskID, "Before export", "", 30, "task", userID, workspaceID, statusID, "2026-09-13", "2026-09-13").Error; err != nil {
		t.Fatal(err)
	}

	service := NewService(tx, nil)
	backup, err := service.Export(userID)
	if err != nil {
		t.Fatal(err)
	}
	if len(backup.Rows["tasks"]) != 1 {
		t.Fatalf("exported %d tasks", len(backup.Rows["tasks"]))
	}
	if err := tx.Exec(`UPDATE tasks SET name = 'Changed after export' WHERE id = ?`, taskID).Error; err != nil {
		t.Fatal(err)
	}
	result, err := service.Restore(userID, backup)
	if err != nil {
		t.Fatal(err)
	}
	if result.Counts["tasks"] != 1 {
		t.Fatalf("restored %d tasks", result.Counts["tasks"])
	}
	var name string
	if err := tx.Raw(`SELECT name FROM tasks WHERE id = ? AND user_id = ?`, taskID, userID).Scan(&name).Error; err != nil {
		t.Fatal(err)
	}
	if name != "Before export" {
		t.Fatalf("task name = %q", name)
	}
}
