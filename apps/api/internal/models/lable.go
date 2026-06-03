package models

import (
	"time"

	"github.com/google/uuid"
)

type Label struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name  string `gorm:"not null;unique"`
	Color string

	CreatedAt time.Time
	UpdatedAt time.Time

	Tasks []Task `gorm:"many2many:task_labels;"`
}
