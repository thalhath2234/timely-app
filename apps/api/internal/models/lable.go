package models

import (
	"time"

	"github.com/google/uuid"
)

type Label struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name  string `gorm:"not null;unique" json:"name"`
	Color string `json:"color"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	Tasks []Task `gorm:"many2many:task_labels;" json:"tasks,omitempty"`
}
