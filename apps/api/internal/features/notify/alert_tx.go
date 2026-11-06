package notify

import (
	"errors"
	"time"

	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// These helpers let another feature (Bots, ADR 0021) write a notification
// and its push inside its own transaction, as chat/service.go's notify does.

// LoadAlertSettings reads the account's notification settings and zone in
// tx. An account with no config row gets the normalized zero settings.
func LoadAlertSettings(tx *gorm.DB, userID string) (models.NotificationSettings, *time.Location, error) {
	var config models.Config
	if err := tx.Select("notification_settings", "working_hours").Where("user_id = ?", userID).First(&config).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.NotificationSettings{}, nil, err
	}
	settings := config.NotificationSettings.Normalized()
	return settings, settings.Location(config.WorkingHours.Timezone), nil
}

// AlertOptions says how WriteAlert delivers. Urgent ignores quiet hours;
// Phone false keeps the alert off the phone. A zero Now means time.Now().
type AlertOptions struct {
	Urgent, Phone bool
	Now           time.Time
}

// QuietUntil is when quiet hours release an alert written now, and false
// when they do not hold it. Callers use it to word a held alert.
func QuietUntil(settings models.NotificationSettings, loc *time.Location, o AlertOptions) (time.Time, bool) {
	if o.Urgent {
		return time.Time{}, false
	}
	if loc == nil {
		loc = time.Local
	}
	local := alertNow(o).In(loc)
	if !settings.InQuietHours(local) {
		return time.Time{}, false
	}
	return settings.QuietEnd(local), true
}

// WriteAlert inserts ntf in tx, and does nothing when its dedupe key (or id)
// already exists: created is then false and ntf.ID is the existing row's id
// when it can be found. A new alert held by quiet hours gets SnoozedUntil =
// the quiet end, and its push waits until then. With Phone false the row is
// delivered at once and no push is queued; otherwise a send_push job is
// queued in tx.
func WriteAlert(tx *gorm.DB, ntf *models.Notification, settings models.NotificationSettings, loc *time.Location, o AlertOptions) (created bool, err error) {
	now := alertNow(o).UTC()
	if ntf.ID == "" {
		ntf.ID = utils.NewNotificationID()
	}
	if ntf.CreatedAt.IsZero() {
		ntf.CreatedAt = now
	}
	runAt := now
	if end, held := QuietUntil(settings, loc, o); held {
		end = end.UTC()
		ntf.SnoozedUntil = &end
		runAt = end
	}
	if !o.Phone {
		ntf.DeliveredAt = &now
	}
	res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(ntf)
	if res.Error != nil {
		return false, res.Error
	}
	if res.RowsAffected == 0 {
		if ntf.DedupeKey != nil {
			var id string
			if err := tx.Model(&models.Notification{}).Select("id").Where("dedupe_key = ? AND user_id = ?", *ntf.DedupeKey, ntf.UserID).Scan(&id).Error; err != nil {
				return false, err
			}
			if id != "" {
				ntf.ID = id
			}
		}
		return false, nil
	}
	if !o.Phone {
		return true, nil
	}
	_, err = jobs.NewQueue(tx).Enqueue(jobs.Enqueue{UserID: ntf.UserID, Kind: models.JobSendPush, DedupeKey: "push:" + ntf.ID, RunAt: runAt, Payload: models.JobPayload{"notificationId": ntf.ID}})
	return true, err
}

// BumpAlert rewrites an alert's title and body without a new push (the
// "and N more" alert). It returns gorm.ErrRecordNotFound when the row is
// gone, for example after Clear all, so the caller can write a new one.
func BumpAlert(tx *gorm.DB, id, title, body string) error {
	res := tx.Model(&models.Notification{}).Where("id = ?", id).Updates(map[string]any{"title": title, "body": body})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func alertNow(o AlertOptions) time.Time {
	if o.Now.IsZero() {
		return time.Now()
	}
	return o.Now
}

// dataBool reads a boolean from a notification's data, or def when it is
// missing or not a boolean.
func dataBool(p models.JobPayload, key string, def bool) bool {
	if v, ok := p[key].(bool); ok {
		return v
	}
	return def
}
