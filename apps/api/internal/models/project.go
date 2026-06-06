package models

import (
	"time"

	"github.com/google/uuid"
)

type Project struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`

	UserID      *uuid.UUID `json:"userId"`
	WorkspaceID *uuid.UUID `json:"workspaceId"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	User User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"user,omitempty"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`

	Stages []*Stage `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"stages,omitempty"`

	Tasks []*Task `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"tasks,omitempty"`
}
