package notify

import (
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/jobs"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const zoneTestUser = "usr_notify_zone_test"

// zoneService migrates an isolated PostgreSQL schema and seeds one account with
// the given notification settings and no saved Working hours.
func zoneService(t *testing.T, settings models.NotificationSettings) (*Service, *gorm.DB) {
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
	schema := "notify_zone_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, row := range []any{
		&models.User{ID: zoneTestUser, Email: "notify-zone@example.invalid", Password: "not-a-real-hash"},
		&models.Config{ID: "cfg_notify_zone_test", UserID: zoneTestUser, NotificationSettings: settings},
	} {
		if err = db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return NewService(db, jobs.NewQueue(db), nil, nil, nil, nil), db
}

// serverZone sets the server's zone for the test, twelve hours from UTC so a
// clock window around the server's "now" never also contains UTC's.
func serverZone(t *testing.T) {
	t.Helper()
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.FixedZone("Server", 12*60*60)
}

// With no notification zone and no saved Working hours, notifications follow
// the server's zone (ADR 0011), and the settings never report it as "Local",
// which a client or a later LoadLocation cannot resolve.
func TestIntegrationNotificationsFallBackToServerZone(t *testing.T) {
	serverZone(t)
	local := time.Now().In(time.Local)
	svc, db := zoneService(t, models.NotificationSettings{
		Reminders:       true,
		QuietHoursStart: local.Add(-time.Hour).Format("15:04"),
		QuietHoursEnd:   local.Add(time.Hour).Format("15:04"),
	})

	settings, err := svc.GetSettings(zoneTestUser)
	if err != nil || settings.Timezone == "Local" || settings.Timezone != "" {
		t.Fatalf("GetSettings timezone = %q (err %v), want unknown rather than %q", settings.Timezone, err, "Local")
	}
	saved, err := svc.UpdateSettings(zoneTestUser, settings)
	if err != nil || saved.Timezone != "" {
		t.Fatalf("UpdateSettings timezone = %q (err %v), want unknown", saved.Timezone, err)
	}
	if got := svc.notificationTimezone(zoneTestUser); got != "" {
		t.Fatalf("notificationTimezone = %q, want unknown", got)
	}

	// The overdue day is the server's day.
	today := svc.notificationToday(zoneTestUser)
	if today.Location() != time.Local || today.Date() != local.Format("2006-01-02") {
		t.Fatalf("overdue day = %s in %s, want %s in the server's zone", today.Date(), today.Location(), local.Format("2006-01-02"))
	}

	// Quiet hours are the server's: the push waits for the window to end.
	ntf := &models.Notification{ID: "ntf_notify_zone_test", UserID: zoneTestUser, Category: models.NotifyReminder}
	if err := svc.deliver(t.Context(), ntf, settings); err != nil {
		t.Fatal(err)
	}
	var job models.Job
	if err := db.Where("user_id = ? AND kind = ?", zoneTestUser, models.JobSendPush).First(&job).Error; err != nil {
		t.Fatalf("push was not deferred for quiet hours: %v", err)
	}
	if !job.RunAt.After(time.Now()) {
		t.Fatalf("deferred push runs at %s, want after now", job.RunAt)
	}
}

// A saved Working hours zone still beats the server's zone.
func TestIntegrationNotificationZoneFollowsWorkingHours(t *testing.T) {
	serverZone(t)
	svc, db := zoneService(t, models.NotificationSettings{Reminders: true})
	hours := models.DefaultWorkingHours("Europe/Berlin")
	if err := db.Model(&models.Config{}).Where("user_id = ?", zoneTestUser).Update("working_hours", hours).Error; err != nil {
		t.Fatal(err)
	}
	settings, err := svc.GetSettings(zoneTestUser)
	if err != nil || settings.Timezone != "Europe/Berlin" {
		t.Fatalf("timezone = %q (err %v), want Europe/Berlin", settings.Timezone, err)
	}
}
