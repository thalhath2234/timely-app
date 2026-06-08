package models

import (
	"time"

	"github.com/google/uuid"
)

type Workspace struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name   string     `gorm:"not null" json:"name"`
	UserID *uuid.UUID `json:"userId"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	User *User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"user,omitempty"`

	Projects []*Project `json:"projects,omitempty"`
	Tasks    []*Task    `json:"tasks,omitempty"`
}
