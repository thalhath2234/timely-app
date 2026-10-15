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
	// Position orders the workspace's labels; see WorkspaceItemOrder.
	Position int64 `gorm:"not null;default:0" json:"-"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (l *Lable) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if l.CreatedAt == "" {
		l.CreatedAt = now
	}
	l.UpdatedAt = now
	if l.Position == 0 {
		p, err := nextPosition(tx, "lables", l.WorkspaceID)
		if err != nil {
			return err
		}
		l.Position = p
	}
	return nil
}

func (l *Lable) BeforeUpdate(tx *gorm.DB) error {
	l.UpdatedAt = utils.GetCurrentTime()
	return nil
}
