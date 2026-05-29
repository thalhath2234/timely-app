package models

import (
	"time"

	"github.com/google/uuid"
)

type Schedule struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name string `gorm:"not null"`

	// Example:
	// daily
	// weekly
	// custom
	Type string

	CreatedAt time.Time
	UpdatedAt time.Time

	// Tasks []Task
}
