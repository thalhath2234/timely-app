package models

import (
	"time"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

const (
	RecurrenceOwnerTask  = "task"
	RecurrenceOwnerEvent = "event"
)

// RecurrenceRule attaches an RFC 5545 RRULE to a task or an event. The owner
// stays a single row; occurrences are expanded on read, never persisted.
type RecurrenceRule struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	OwnerType string `gorm:"type:text;not null" json:"ownerType"`
	OwnerID   string `gorm:"type:text;not null" json:"ownerId"`
	UserID    string `gorm:"type:text;not null" json:"userId"`

	RRule    string    `gorm:"column:rrule;type:text;not null" json:"rrule"`
	Dtstart  time.Time `gorm:"type:timestamptz;not null" json:"dtstart"`
	Timezone string    `gorm:"type:text;not null;default:'UTC'" json:"timezone"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Exceptions []RecurrenceException `gorm:"foreignKey:RuleID" json:"exceptions"`
}

func (r *RecurrenceRule) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if r.CreatedAt == "" {
		r.CreatedAt = now
	}
	r.UpdatedAt = now
	return nil
}

func (r *RecurrenceRule) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}

// Location resolves the rule's IANA zone, falling back to UTC.
func (r *RecurrenceRule) Location() *time.Location {
	if r.Timezone == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(r.Timezone)
	if err != nil {
		return time.UTC
	}
	return loc
}

// RecurrenceException overrides one instance of a series: it can be cancelled,
// moved to a new time, or (for tasks) marked completed without touching the
// series itself.
type RecurrenceException struct {
	ID     string `gorm:"type:text;primaryKey" json:"id"`
	RuleID string `gorm:"type:text;not null" json:"ruleId"`

	OriginalStart time.Time  `gorm:"type:timestamptz;not null" json:"originalStart"`
	NewStart      *time.Time `gorm:"type:timestamptz" json:"newStart"`
	NewEnd        *time.Time `gorm:"type:timestamptz" json:"newEnd"`
	IsCancelled   bool       `gorm:"not null;default:false" json:"isCancelled"`
	CompletedAt   *time.Time `gorm:"type:timestamptz" json:"completedAt"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (e *RecurrenceException) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if e.CreatedAt == "" {
		e.CreatedAt = now
	}
	e.UpdatedAt = now
	return nil
}

func (e *RecurrenceException) BeforeUpdate(tx *gorm.DB) error {
	e.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}

// RecurrenceInput is the client payload for attaching a rule.
type RecurrenceInput struct {
	RRule    string `json:"rrule"`
	Dtstart  string `json:"dtstart"`
	Timezone string `json:"timezone"`
}
