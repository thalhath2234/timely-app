package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Schedule struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name string `gorm:"not null" json:"name"`

	// Example:
	// daily
	// weekly
	// custom
	Type string `json:"type"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Tasks []Task `json:"tasks,omitempty"`
}

func (s *Schedule) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if s.CreatedAt == "" {
		s.CreatedAt = now
	}
	s.UpdatedAt = now
	return nil
}

func (s *Schedule) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = utils.GetCurrentTime()
	return nil
}
