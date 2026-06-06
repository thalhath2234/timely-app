package models

import (
	"time"

	"github.com/google/uuid"
)

type Task struct {
	ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`

	// PostgreSQL text[]
	TimeChunks int `gorm:"default:30" json:"timeChunks"` // 30 min chunks  break 5 min between each chunks

	Duration int `gorm:"default:0" json:"duration"` // total time to finish this task

	Deadline    *time.Time `gorm:"type:date" json:"deadline"`
	StartDate   *time.Time `gorm:"type:date" json:"startDate"`
	ScheduledOn *time.Time `gorm:"type:timestamptz" json:"scheduledOn"`
	CompletedAt *time.Time `gorm:"type:timestamptz" json:"completedAt"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	// Foreign Keys
	UserId      *uuid.UUID `json:"userId"`
	ProjectID   *uuid.UUID `json:"projectId"`
	StatusID    *uuid.UUID `json:"statusId"`
	PriorityID  *uuid.UUID `json:"priorityId"`
	WorkspaceID *uuid.UUID `json:"workspaceId"`
	ScheduleID  *uuid.UUID `json:"scheduleId"`
	StageID     *uuid.UUID `json:"stageId"`

	// Self Referencing Tasks
	BlockedByID *uuid.UUID `json:"blockedById"`

	// Relationships
	User *User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"user,omitempty"`

	Project *Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"project,omitempty"`

	Status *Status `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"status,omitempty"`

	Priority *Priority `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"priority,omitempty"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`

	Schedule *Schedule `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"schedule,omitempty"`

	Stage *Stage `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"stage,omitempty"`

	// Self References
	BlockedBy *Task `gorm:"foreignKey:BlockedByID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"blockedBy,omitempty"`

	// Many-to-Many Labels
	Labels []*Label `gorm:"many2many:task_labels;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"labels,omitempty"`
}
