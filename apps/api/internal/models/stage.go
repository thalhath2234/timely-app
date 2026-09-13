package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Stage struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name  string `gorm:"not null" json:"name"`
	Order int    `json:"order"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	ProjectID *string `json:"projectId"`

	Project Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"project,omitempty"`

	Tasks []Task `json:"tasks,omitempty"`
}

func (s *Stage) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if s.CreatedAt == "" {
		s.CreatedAt = now
	}
	s.UpdatedAt = now
	return nil
}

func (s *Stage) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = utils.GetCurrentTime()
	return nil
}
