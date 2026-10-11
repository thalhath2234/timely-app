package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Lable struct {
	ID          string `gorm:"type:text;primaryKey" json:"id"`
	Name        string `gorm:"not null;uniqueIndex:lables_workspace_name_key,priority:2" json:"name"`
	Color       string `json:"color"`
	WorkspaceID string `gorm:"type:uuid;not null;uniqueIndex:lables_workspace_name_key,priority:1" json:"workspaceId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (l *Lable) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if l.CreatedAt == "" {
		l.CreatedAt = now
	}
	l.UpdatedAt = now
	return nil
}

func (l *Lable) BeforeUpdate(tx *gorm.DB) error {
	l.UpdatedAt = utils.GetCurrentTime()
	return nil
}
