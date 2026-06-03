package models

import (
	"time"

	"github.com/google/uuid"
)

type Status struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name  string `gorm:"not null;unique"`
	Color string

	CreatedAt time.Time
	UpdatedAt time.Time

	Tasks []Task
}
