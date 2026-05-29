package models

import (
	"time"

	"github.com/google/uuid"
)

type Priority struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name  string `gorm:"not null;unique"`
	Level int

	CreatedAt time.Time
	UpdatedAt time.Time

	// Tasks []Task
}
