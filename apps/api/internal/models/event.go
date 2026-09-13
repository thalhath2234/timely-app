package models

import (
	"time"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// Event is a standalone calendar item. It is one-off unless a RecurrenceRule
// with owner_type "event" points at it.
type Event struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Title       string    `gorm:"not null" json:"title"`
	Description string    `gorm:"type:text;not null;default:''" json:"description"`
	StartAt     time.Time `gorm:"type:timestamptz;not null" json:"start"`
	EndAt       time.Time `gorm:"type:timestamptz;not null" json:"end"`
	AllDay      bool      `gorm:"not null;default:false" json:"allDay"`
	Color       *string   `json:"color"`

	UserID      string  `gorm:"type:text;not null" json:"userId"`
	WorkspaceID *string `json:"workspaceId"`
	ProjectID   *string `json:"projectId"`
	TaskID      *string `json:"taskId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Recurrence *RecurrenceRule `gorm:"polymorphic:Owner;polymorphicValue:event" json:"recurrence"`
}

func (e *Event) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if e.CreatedAt == "" {
		e.CreatedAt = now
	}
	e.UpdatedAt = now
	return nil
}

func (e *Event) BeforeUpdate(tx *gorm.DB) error {
	e.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}

// DurationMinutes is the length of one instance of the event.
func (e *Event) DurationMinutes() int {
	minutes := int(e.EndAt.Sub(e.StartAt).Minutes())
	if minutes <= 0 {
		return 30
	}
	return minutes
}
