package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Workspace struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name   string  `gorm:"not null" json:"name"`
	UserID *string `json:"userId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Status       []*Status      `json:"status,omitempty"`
	Lables       []*Lable       `json:"lables,omitempty"`
	Projects     []*Project     `json:"projects,omitempty"`
	Tasks        []*Task        `json:"tasks,omitempty"`
	CustomFields []*CustomField `json:"customFields,omitempty"`
}

func (w *Workspace) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if w.CreatedAt == "" {
		w.CreatedAt = now
	}
	w.UpdatedAt = now
	return nil
}

func (w *Workspace) BeforeUpdate(tx *gorm.DB) error {
	w.UpdatedAt = utils.GetCurrentTime()
	return nil
}
