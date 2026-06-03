package models

import (
	"time"

	"github.com/google/uuid"
)

type Project struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name        string `gorm:"not null"`
	Description string `gorm:"type:text"`

	WorkspaceID *uuid.UUID

	CreatedAt time.Time
	UpdatedAt time.Time

	Workspace Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	Tasks []Task
}
