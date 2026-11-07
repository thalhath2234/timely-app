package notify

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"

	"gorm.io/gorm"
)

// botAlert is a Bot alert as the bots engine writes one.
func botAlert(id, key string, data models.JobPayload) *models.Notification {
	kind, bot := "bot", "bot_tx"
	return &models.Notification{ID: id, UserID: zoneTestUser, Category: models.NotifyBot, Title: "Price check: below 25,000", Body: "now ₹24,900 (was ₹27,499)", EntityType: &kind, EntityID: &bot, DedupeKey: &key, Data: data}
}

func pushJobs(t *testing.T, db *gorm.DB, id string) []models.Job {
	t.Helper()
	var rows []models.Job
	if err := db.Where("kind = ? AND payload->>'notificationId' = ?", models.JobSendPush, id).Order("run_at").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func notificationRow(t *testing.T, db *gorm.DB, id string) models.Notification {
	t.Helper()
	var row models.Notification
	if err := db.First(&row, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

// WriteAlert follows quiet hours unless the alert is urgent, keeps an alert
// off the phone when asked, and writes nothing twice for one dedupe key.
func TestIntegrationWriteAlertDelivery(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Timezone: "Asia/Kolkata", QuietHoursStart: "22:00", QuietHoursEnd: "07:00"})
	settings, loc, err := LoadAlertSettings(db, zoneTestUser)
	if err != nil || loc.String() != "Asia/Kolkata" || settings.QuietHoursEnd != "07:00" {
		t.Fatalf("LoadAlertSettings = %+v in %v (err %v)", settings, loc, err)
	}
	night := time.Date(2026, 11, 6, 20, 44, 0, 0, time.UTC) // 02:14 in Kolkata
	quietEnd := time.Date(2026, 11, 7, 1, 30, 0, 0, time.UTC)

	write := func(n *models.Notification, o AlertOptions) bool {
		t.Helper()
		var created bool
		err := db.Transaction(func(tx *gorm.DB) error {
			var err error
			created, err = WriteAlert(tx, n, settings, loc, o)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return created
	}

	// Quiet hours: the row waits and so does its push.
	held := botAlert("ntf_bot_quiet", "bot:tx:quiet", models.JobPayload{"botId": "bot_tx", "phone": true})
	if !write(held, AlertOptions{Phone: true, Now: night}) {
		t.Fatal("a new alert was not created")
	}
	row := notificationRow(t, db, held.ID)
	if row.SnoozedUntil == nil || !row.SnoozedUntil.Equal(quietEnd) || row.DeliveredAt != nil || !row.CreatedAt.Equal(night) {
		t.Fatalf("held row = snoozed %v delivered %v created %v", row.SnoozedUntil, row.DeliveredAt, row.CreatedAt)
	}
	if jobs := pushJobs(t, db, held.ID); len(jobs) != 1 || !jobs[0].RunAt.Equal(quietEnd) || *jobs[0].DedupeKey != "push:"+held.ID {
		t.Fatalf("held push jobs = %+v", jobs)
	}

	// Urgent: the push goes now and nothing is snoozed.
	urgent := botAlert("ntf_bot_urgent", "bot:tx:urgent", models.JobPayload{"botId": "bot_tx", "urgent": true})
	write(urgent, AlertOptions{Urgent: true, Phone: true, Now: night})
	if row := notificationRow(t, db, urgent.ID); row.SnoozedUntil != nil || row.DeliveredAt != nil {
		t.Fatalf("urgent row = snoozed %v delivered %v", row.SnoozedUntil, row.DeliveredAt)
	}
	if jobs := pushJobs(t, db, urgent.ID); len(jobs) != 1 || !jobs[0].RunAt.Equal(night) {
		t.Fatalf("urgent push jobs = %+v", jobs)
	}

	// Phone off: delivered at once with no push, still held for the desktop.
	desk := botAlert("ntf_bot_desk", "bot:tx:desk", models.JobPayload{"botId": "bot_tx", "phone": false})
	write(desk, AlertOptions{Now: night})
	if row := notificationRow(t, db, desk.ID); row.DeliveredAt == nil || !row.DeliveredAt.Equal(night) || row.SnoozedUntil == nil {
		t.Fatalf("phone-off row = delivered %v snoozed %v", row.DeliveredAt, row.SnoozedUntil)
	}
	if jobs := pushJobs(t, db, desk.ID); len(jobs) != 0 {
		t.Fatalf("phone-off alert queued %d pushes", len(jobs))
	}

	// The same key again (a retried save) adds nothing and names the first row.
	again := botAlert("", "bot:tx:quiet", models.JobPayload{"botId": "bot_tx"})
	if write(again, AlertOptions{Phone: true, Now: night.Add(time.Minute)}) {
		t.Fatal("a repeated key created a second alert")
	}
	if again.ID != held.ID {
		t.Fatalf("repeat named %q, want %q", again.ID, held.ID)
	}
	var count int64
	db.Model(&models.Notification{}).Where("dedupe_key = ?", "bot:tx:quiet").Count(&count)
	if count != 1 || len(pushJobs(t, db, held.ID)) != 1 {
		t.Fatalf("repeat left %d rows and %d pushes", count, len(pushJobs(t, db, held.ID)))
	}

	// A failed transaction leaves neither the row nor its push.
	boom := errors.New("boom")
	rolled := botAlert("ntf_bot_rolled", "bot:tx:rolled", nil)
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := WriteAlert(tx, rolled, settings, loc, AlertOptions{Phone: true, Now: night}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatal(err)
	}
	db.Model(&models.Notification{}).Where("id = ?", rolled.ID).Count(&count)
	if count != 0 || len(pushJobs(t, db, rolled.ID)) != 0 {
		t.Fatal("a rolled-back alert was kept")
	}

	// Another account's notification is never rewritten.
	if err := BumpAlert(db, "usr_someone_else", held.ID, "Taken over", "body"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("bump of another account's row = %v", err)
	}
	if row := notificationRow(t, db, held.ID); row.Title == "Taken over" {
		t.Fatal("BumpAlert rewrote another account's notification")
	}
	// BumpAlert rewrites the text with no new push; a gone row says so.
	if err := BumpAlert(db, zoneTestUser, held.ID, "Price check: and 2 more today", "body"); err != nil {
		t.Fatal(err)
	}
	if row := notificationRow(t, db, held.ID); row.Title != "Price check: and 2 more today" || row.Body != "body" || len(pushJobs(t, db, held.ID)) != 1 {
		t.Fatalf("bumped row = %q / %q", row.Title, row.Body)
	}
	if err := BumpAlert(db, zoneTestUser, "ntf_missing", "t", "b"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("bump of a gone row = %v", err)
	}
}

// An account with no config row reads the default settings in the server zone.
func TestIntegrationLoadAlertSettingsWithoutConfig(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{})
	if err := db.Where("user_id = ?", zoneTestUser).Delete(&models.Config{}).Error; err != nil {
		t.Fatal(err)
	}
	settings, loc, err := LoadAlertSettings(db, zoneTestUser)
	if err != nil || loc != time.Local || settings.InQuietHours(time.Now()) {
		t.Fatalf("LoadAlertSettings = %+v in %v (err %v)", settings, loc, err)
	}
}

// HandlePush sends nothing for a Bot alert kept off the phone or already
// read, holds a non-urgent one through quiet hours, and pushes an urgent one.
func TestIntegrationBotPush(t *testing.T) {
	now := time.Now().UTC()
	svc, db := zoneService(t, models.NotificationSettings{
		Timezone:        "UTC",
		QuietHoursStart: now.Add(-time.Hour).Format("15:04"),
		QuietHoursEnd:   now.Add(time.Hour).Format("15:04"),
	})
	pushes := 0
	svc.http = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		pushes++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[]}`)), Header: http.Header{}}, nil
	})}
	if err := db.Create(&models.PushDevice{ID: "dev_bot", UserID: zoneTestUser, Token: "ExponentPushToken[test]", CreatedAt: now, UpdatedAt: now, LastSeenAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	read := now
	for _, n := range []*models.Notification{
		botAlert("ntf_bot_nophone", "bot:push:nophone", models.JobPayload{"botId": "bot_tx", "phone": false, "urgent": true}),
		botAlert("ntf_bot_read", "bot:push:read", models.JobPayload{"botId": "bot_tx", "phone": true, "urgent": true}),
		botAlert("ntf_bot_quiet", "bot:push:quiet", models.JobPayload{"botId": "bot_tx", "phone": true}),
		botAlert("ntf_bot_urgent", "bot:push:urgent", models.JobPayload{"botId": "bot_tx", "phone": true, "urgent": true}),
	} {
		n.CreatedAt = now
		if n.ID == "ntf_bot_read" {
			n.ReadAt = &read
		}
		if err := db.Create(n).Error; err != nil {
			t.Fatal(err)
		}
	}
	handle := func(id string) {
		t.Helper()
		if err := svc.HandlePush(context.Background(), &models.Job{UserID: zoneTestUser, Kind: models.JobSendPush, Payload: models.JobPayload{"notificationId": id}}); err != nil {
			t.Fatal(err)
		}
	}

	for _, id := range []string{"ntf_bot_nophone", "ntf_bot_read"} {
		handle(id)
		if notificationRow(t, db, id).DeliveredAt == nil || pushes != 0 {
			t.Fatalf("%s: delivered %v after %d pushes", id, notificationRow(t, db, id).DeliveredAt, pushes)
		}
	}

	handle("ntf_bot_quiet")
	if notificationRow(t, db, "ntf_bot_quiet").DeliveredAt != nil || pushes != 0 {
		t.Fatal("a quiet-hours bot alert was pushed")
	}
	requeued := pushJobs(t, db, "ntf_bot_quiet")
	if len(requeued) != 1 || !strings.HasPrefix(*requeued[0].DedupeKey, "push:ntf_bot_quiet:quiet:") || !requeued[0].RunAt.After(now) {
		t.Fatalf("quiet-hours push jobs = %+v", requeued)
	}

	handle("ntf_bot_urgent")
	if notificationRow(t, db, "ntf_bot_urgent").DeliveredAt == nil || pushes != 1 {
		t.Fatalf("urgent bot alert: %d pushes", pushes)
	}
}
