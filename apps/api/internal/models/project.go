package models

import (
	"time"

	"github.com/google/uuid"
)

type Project struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name        string `gorm:"not null"`
	Description string `gorm:"type:text"`

	UserID      *uuid.UUID
	WorkspaceID *uuid.UUID

	CreatedAt time.Time
	UpdatedAt time.Time

	User User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Stages []*Stage `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Tasks []*Task `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}
