package models

import (
	"time"

	"github.com/google/uuid"
)

type Task struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`

	Name        string `gorm:"not null"`
	Description string `gorm:"type:text"`

	// PostgreSQL text[]
	TimeChunks int `gorm:"default:30"` // 30 min chunks  break 5 min between each chunks

	Duration int `gorm:"default:0"` // total time to finish this task

	Deadline    *time.Time `gorm:"type:date"`
	StartDate   *time.Time `gorm:"type:date"`
	ScheduledOn *time.Time `gorm:"type:timestamptz"`
	CompletedAt *time.Time `gorm:"type:timestamptz"`

	CreatedAt time.Time
	UpdatedAt time.Time

	// Foreign Keys
	UserId      *uuid.UUID
	ProjectID   *uuid.UUID
	StatusID    *uuid.UUID
	PriorityID  *uuid.UUID
	WorkspaceID *uuid.UUID
	ScheduleID  *uuid.UUID
	StageID     *uuid.UUID

	// Self Referencing Tasks
	BlockedByID *uuid.UUID

	// Relationships
	User *User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Project *Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Status *Status `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	Priority *Priority `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`

	Schedule *Schedule `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	Stage *Stage `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	// Self References
	BlockedBy *Task `gorm:"foreignKey:BlockedByID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`

	// Many-to-Many Labels
	Labels []*Label `gorm:"many2many:task_labels;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}
