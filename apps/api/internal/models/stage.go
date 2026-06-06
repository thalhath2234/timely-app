package models

import (
	"time"

	"github.com/google/uuid"
)

type Stage struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name  string `gorm:"not null" json:"name"`
	Order int    `json:"order"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	ProjectID *uuid.UUID `json:"projectId"`

	Project Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"project,omitempty"`

	Tasks []Task `json:"tasks,omitempty"`
}
