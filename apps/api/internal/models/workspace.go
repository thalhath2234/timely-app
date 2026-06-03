package models

import (
	"time"

	"github.com/google/uuid"
)

type Workspace struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name        string `gorm:"not null"`
	Description string `gorm:"type:text"`
	UserID      *uuid.UUID

	CreatedAt time.Time
	UpdatedAt time.Time

	User User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Projects []Project
	Tasks    []Task
}
