package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Status struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Color       string `json:"color"`
	WorkspaceID string `gorm:"type:uuid;not null" json:"workspaceId"`
	IsDefault   bool   `gorm:"default:false" json:"isDefault"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Tasks []Task `json:"tasks,omitempty"`
}

func (s *Status) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if s.CreatedAt == "" {
		s.CreatedAt = now
	}
	s.UpdatedAt = now
	return nil
}

func (s *Status) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = utils.GetCurrentTime()
	return nil
}
