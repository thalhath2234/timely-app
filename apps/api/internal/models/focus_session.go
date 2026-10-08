package models

import (
	"time"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// FocusSession is one stretch of focused work on a task, logged when pausing,
// stopping or completing a focused task adds minutes to Task.ActualMinutes.
// TaskName is a snapshot taken at the time, so sessions of a deleted task
// keep their name after TaskID is cleared.
type FocusSession struct {
	ID        string    `gorm:"type:text;primaryKey" json:"id"`
	UserID    string    `gorm:"type:text;not null" json:"-"`
	TaskID    *string   `gorm:"type:text" json:"taskId"`
	TaskName  string    `gorm:"type:text;not null;default:''" json:"taskName"`
	StartedAt time.Time `gorm:"type:timestamptz;not null" json:"startedAt"`
	EndedAt   time.Time `gorm:"type:timestamptz;not null" json:"endedAt"`
	Minutes   int       `gorm:"not null" json:"minutes"`
}

func (f *FocusSession) BeforeCreate(tx *gorm.DB) error {
	if f.ID == "" {
		f.ID = utils.NewFocusSessionID()
	}
	return nil
}

func (FocusSession) TableName() string {
	return "focus_sessions"
}
