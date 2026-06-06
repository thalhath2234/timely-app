package models

import (
	"time"

	"github.com/google/uuid"
)

type Schedule struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name string `gorm:"not null" json:"name"`

	// Example:
	// daily
	// weekly
	// custom
	Type string `json:"type"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	Tasks []Task `json:"tasks,omitempty"`
}
