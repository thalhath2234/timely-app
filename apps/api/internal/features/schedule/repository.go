package schedule

import (
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Repository interface {
	GetWorkingHours(userID string) (models.WorkingHours, error)
	UpdateWorkingHours(userID string, hours models.WorkingHours) error
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
