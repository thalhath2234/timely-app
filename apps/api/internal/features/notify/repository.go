package notify

import (
	"errors"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type repository struct {
	db *gorm.DB
}

func newRepository(db *gorm.DB) *repository {
	return &repository{db: db}
}

func (r *repository) GetSettings(userID string) (models.NotificationSettings, error) {
	var config models.Config
	err := r.db.Select("notification_settings").Where("user_id = ?", userID).First(&config).Error
	if err != nil {
		return models.NotificationSettings{}, err
	}
	return config.NotificationSettings.Normalized(), nil
}

func (r *repository) UpdateSettings(userID string, settings models.NotificationSettings) error {
	if err := r.db.Select("id").Where("user_id = ?", userID).First(&models.Config{}).Error; err != nil {
		return err
	}
	normalized := settings.Normalized()
	if err := models.WriteJSONB(r.db, "configs", map[string]any{
		"notification_settings": normalized,
	}, "user_id = ?", userID); err != nil {
		return err
	}
	return r.db.Model(&models.Config{}).
		Where("user_id = ?", userID).
		Update("updated_at", utils.GetCurrentTime()).Error
}

func (r *repository) WorkingHoursTimezone(userID string) string {
	hours, err := models.LoadWorkingHours(r.db, userID)
	if err != nil {
		return ""
	}
	return hours.Timezone
}

func (r *repository) List(userID string, unreadOnly bool, limit int) ([]models.Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := r.db.Where("user_id = ?", userID).Order("created_at desc").Limit(limit)
	if unreadOnly {
		query = query.Where("read_at IS NULL")
	}
	var rows []models.Notification
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []models.Notification{}
	}
	return rows, nil
}

func (r *repository) UnreadCount(userID string) (int64, error) {
	var n int64
	err := r.db.Model(&models.Notification{}).Where("user_id = ? AND read_at IS NULL", userID).Count(&n).Error
	return n, err
}

func (r *repository) Get(userID, id string) (*models.Notification, error) {
	var row models.Notification
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *repository) MarkRead(userID, id string) (*models.Notification, error) {
	now := time.Now().UTC()
	if err := r.db.Model(&models.Notification{}).
		Where("id = ? AND user_id = ? AND read_at IS NULL", id, userID).
		Update("read_at", now).Error; err != nil {
		return nil, err
	}
	row, err := r.Get(userID, id)
	if err == nil && row.EntityType != nil && *row.EntityType == "chat" && row.EntityID != nil {
		// The chat badge follows its notification; reading one clears the other.
		if err := r.db.Exec("UPDATE agent_conversations SET unread = false WHERE id = ? AND user_id = ?", *row.EntityID, userID).Error; err != nil {
			return nil, err
		}
	}
	return row, err
}

func (r *repository) MarkAllRead(userID string) error {
	now := time.Now().UTC()
	if err := r.db.Model(&models.Notification{}).
		Where("user_id = ? AND read_at IS NULL", userID).
		Update("read_at", now).Error; err != nil {
		return err
	}
	return r.db.Exec("UPDATE agent_conversations SET unread = false WHERE user_id = ?", userID).Error
}

func (r *repository) MarkOverdueRead(userID, taskID string) error {
	return r.db.Model(&models.Notification{}).
		Where("user_id = ? AND category = ? AND entity_id = ? AND read_at IS NULL", userID, models.NotifyOverdue, taskID).
		Update("read_at", time.Now().UTC()).Error
}

func (r *repository) ClearAll(userID string) error {
	return r.db.Where("user_id = ?", userID).Delete(&models.Notification{}).Error
}

func (r *repository) SetSnoozed(userID, id string, until time.Time) error {
	now := time.Now().UTC()
	return r.db.Model(&models.Notification{}).
		Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]any{"snoozed_until": until.UTC(), "read_at": now}).Error
}

func (r *repository) Upsert(row *models.Notification) (*models.Notification, error) {
	if row.ID == "" {
		row.ID = utils.NewNotificationID()
	}
	if row.CreatedAt.IsZero() {
		row.CreatedAt = time.Now().UTC()
	}
	if row.Data == nil {
		row.Data = models.JobPayload{}
	}
	if row.DedupeKey != nil && *row.DedupeKey != "" {
		if err := r.db.Exec(`
			INSERT INTO notifications (id, user_id, category, title, body, entity_type, entity_id, data, dedupe_key, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
			ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
		`, row.ID, row.UserID, row.Category, row.Title, row.Body, row.EntityType, row.EntityID, mustJSON(row.Data), row.DedupeKey, row.CreatedAt).Error; err != nil {
			return nil, err
		}
		var existing models.Notification
		if findErr := r.db.Where("dedupe_key = ?", *row.DedupeKey).First(&existing).Error; findErr == nil {
			return &existing, nil
		}
		return row, nil
	}
	if err := r.db.Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func mustJSON(payload models.JobPayload) string {
	raw, err := payload.Value()
	if err != nil {
		return "{}"
	}
	s, _ := raw.(string)
	if s == "" {
		return "{}"
	}
	return s
}

func (r *repository) MarkDelivered(id string) error {
	now := time.Now().UTC()
	return r.db.Model(&models.Notification{}).Where("id = ? AND delivered_at IS NULL", id).
		Update("delivered_at", now).Error
}

func (r *repository) RegisterDevice(userID, token, platform string) (*models.PushDevice, error) {
	if platform == "" {
		platform = "android"
	}
	now := time.Now().UTC()
	var existing models.PushDevice
	err := r.db.Where("token = ?", token).First(&existing).Error
	if err == nil {
		existing.UserID = userID
		existing.Platform = platform
		existing.UpdatedAt = now
		existing.LastSeenAt = now
		if err := r.db.Save(&existing).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	row := &models.PushDevice{
		ID:         utils.NewPushDeviceID(),
		UserID:     userID,
		Token:      token,
		Platform:   platform,
		CreatedAt:  now,
		UpdatedAt:  now,
		LastSeenAt: now,
	}
	if err := r.db.Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func (r *repository) UnregisterDevice(userID, token string) error {
	return r.db.Where("user_id = ? AND token = ?", userID, token).Delete(&models.PushDevice{}).Error
}

func (r *repository) Devices(userID string) ([]models.PushDevice, error) {
	var rows []models.PushDevice
	if err := r.db.Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *repository) DeleteToken(token string) error {
	return r.db.Where("token = ?", token).Delete(&models.PushDevice{}).Error
}

func reminderDedupe(taskID string, start time.Time) string {
	return "reminder:" + taskID + ":" + start.UTC().Format(time.RFC3339)
}

func missedDedupe(taskID string, end time.Time) string {
	return "missed:" + taskID + ":" + end.UTC().Format(time.RFC3339)
}

func startSoonDedupe(taskID string, start time.Time) string {
	return "start:" + taskID + ":" + start.UTC().Format(time.RFC3339)
}

func digestDedupe(kind, userID, day string) string {
	return "digest:" + kind + ":" + userID + ":" + day
}

func overdueDedupe(taskID, deadline string) string {
	return "overdue:" + taskID + ":" + deadline
}
