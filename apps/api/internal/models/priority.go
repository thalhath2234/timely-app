package models

import (
	"time"

	"github.com/google/uuid"
)

type Priority struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name  string `gorm:"not null;unique" json:"name"`
	Level int    `json:"level"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	Tasks []Task `json:"tasks,omitempty"`
}
