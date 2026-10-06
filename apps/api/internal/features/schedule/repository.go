package schedule

import (
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Repository interface {
	GetWorkingHours(userID string) (models.WorkingHours, error)
	UpdateWorkingHours(userID string, hours models.WorkingHours) error
	GetSettings(userID string) (models.ScheduleSettings, error)
	UpdateSettings(userID string, settings models.ScheduleSettings) error
	SaveRevision(rev *models.ScheduleRevision) error
	LatestRevision(userID string) (*models.ScheduleRevision, error)
	DeleteRevision(userID, id string) error
	// TaskNames maps the user's task ids to their names.
	TaskNames(userID string, ids []string) (map[string]string, error)
}

type repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

func (r *repository) GetWorkingHours(userID string) (models.WorkingHours, error) {
	var config models.Config
	err := r.db.Select("working_hours").Where("user_id = ?", userID).First(&config).Error
	if err != nil {
		return models.WorkingHours{}, err
	}
	return config.WorkingHours, nil
}

func (r *repository) UpdateWorkingHours(userID string, hours models.WorkingHours) error {
	var config models.Config
	if err := r.db.Select("id").Where("user_id = ?", userID).First(&config).Error; err != nil {
		return err
	}
	if err := models.WriteJSONB(r.db, "configs", map[string]any{
		"working_hours": hours,
	}, "user_id = ?", userID); err != nil {
		return err
	}
	return r.db.Model(&models.Config{}).
		Where("user_id = ?", userID).
		Update("updated_at", utils.GetCurrentTime()).Error
}

func (r *repository) GetSettings(userID string) (models.ScheduleSettings, error) {
	var config models.Config
	err := r.db.Select("schedule_settings").Where("user_id = ?", userID).First(&config).Error
	if err != nil {
		return models.ScheduleSettings{}, err
	}
	return config.ScheduleSettings.Normalized(), nil
}

func (r *repository) UpdateSettings(userID string, settings models.ScheduleSettings) error {
	if err := r.db.Select("id").Where("user_id = ?", userID).First(&models.Config{}).Error; err != nil {
		return err
	}
	normalized := settings.Normalized()
	if err := models.WriteJSONB(r.db, "configs", map[string]any{
		"schedule_settings": normalized,
	}, "user_id = ?", userID); err != nil {
		return err
	}
	return r.db.Model(&models.Config{}).
		Where("user_id = ?", userID).
		Update("updated_at", utils.GetCurrentTime()).Error
}

func (r *repository) SaveRevision(rev *models.ScheduleRevision) error {
	if rev.ID == "" {
		rev.ID = utils.NewScheduleRevisionID()
	}
	if rev.CreatedAt == "" {
		rev.CreatedAt = utils.GetCurrentTimestamp()
	}
	if err := r.db.Create(rev).Error; err != nil {
		return err
	}
	var extras []models.ScheduleRevision
	if err := r.db.Where("user_id = ?", rev.UserID).Order("created_at DESC").Offset(5).Find(&extras).Error; err != nil {
		return err
	}
	if len(extras) == 0 {
		return nil
	}
	ids := make([]string, 0, len(extras))
	for _, extra := range extras {
		ids = append(ids, extra.ID)
	}
	return r.db.Where("id IN ?", ids).Delete(&models.ScheduleRevision{}).Error
}

func (r *repository) LatestRevision(userID string) (*models.ScheduleRevision, error) {
	var rev models.ScheduleRevision
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").First(&rev).Error
	if err != nil {
		return nil, err
	}
	return &rev, nil
}

func (r *repository) DeleteRevision(userID, id string) error {
	return r.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.ScheduleRevision{}).Error
}

func (r *repository) TaskNames(userID string, ids []string) (map[string]string, error) {
	names := map[string]string{}
	if len(ids) == 0 {
		return names, nil
	}
	var rows []struct{ ID, Name string }
	if err := r.db.Table("tasks").Select("id, name").Where("user_id = ? AND id IN ?", userID, ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		names[row.ID] = row.Name
	}
	return names, nil
}
