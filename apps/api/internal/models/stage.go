package models

import (
	"time"

	"github.com/google/uuid"
)

type Stage struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name  string `gorm:"not null"`
	Order int

	ProjectID *uuid.UUID

	CreatedAt time.Time
	UpdatedAt time.Time

	Project Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	// Tasks []Task
}
