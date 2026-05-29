package models

import (
	"time"

	"github.com/google/uuid"
)

type Workspace struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name        string `gorm:"not null"`
	Description string `gorm:"type:text"`

	CreatedAt time.Time
	UpdatedAt time.Time

	// Projects []Project
	// Tasks    []Task
}
