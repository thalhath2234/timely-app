package portability

import (
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// migratedDB migrates an isolated PostgreSQL schema.
func migratedDB(t *testing.T) *gorm.DB {
	t.Helper()
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
	schema := "portability_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = goose.Up(sqlDB, "."); err != nil {
		t.Fatal(err)
	}
	return db
}

// A backup carries the phone's saved views, and a backup made before they
// existed restores with none.
func TestIntegrationBackupKeepsPhoneViews(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_phone_views"
	phone := models.DefaultMobileTaskViews()
	for _, row := range []any{
		&models.User{ID: uid, Email: "phone-views@example.invalid", Password: "not-a-real-hash"},
		&models.Config{ID: "cfg_phone_views", UserID: uid, TaskViews: models.DefaultTaskViews(), ActiveTaskViewId: "view_task_list",
			MobileTaskViews: phone, MobileActiveTaskViewId: "native_view_board"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(db, nil)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE configs SET mobile_task_views = '[]', mobile_active_task_view_id = '' WHERE user_id = ?`, uid).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	var cfg models.Config
	if err := db.Where("user_id = ?", uid).First(&cfg).Error; err != nil {
		t.Fatal(err)
	}
	if len(cfg.MobileTaskViews) != len(phone) || cfg.MobileActiveTaskViewId != "native_view_board" || len(cfg.TaskViews) != 4 {
		t.Fatalf("restored phone views %d active %q, web views %d", len(cfg.MobileTaskViews), cfg.MobileActiveTaskViewId, len(cfg.TaskViews))
	}

	// An older backup has no phone view columns.
	var row map[string]any
	if err := json.Unmarshal(backup.Rows["configs"][0], &row); err != nil {
		t.Fatal(err)
	}
	delete(row, "mobile_task_views")
	delete(row, "mobile_active_task_view_id")
	backup.Rows["configs"][0], _ = json.Marshal(row)
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatalf("older backup: %v", err)
	}
	cfg = models.Config{}
	if err := db.Where("user_id = ?", uid).First(&cfg).Error; err != nil {
		t.Fatal(err)
	}
	if len(cfg.MobileTaskViews) != 0 || cfg.MobileActiveTaskViewId != "" {
		t.Fatalf("older backup left phone views %+v", cfg.MobileTaskViews)
	}
}
