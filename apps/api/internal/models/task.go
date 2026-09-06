package models

import (
	"database/sql/driver"
	"encoding/json"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type LabelInput struct {
	Id string `json:"id"`
}

type LabelInputs []LabelInput

func (l LabelInputs) Value() (driver.Value, error) {
	return json.Marshal(l)
}

func (l *LabelInputs) Scan(value any) error {
	if value == nil {
		*l = nil
		return nil
	}

	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return nil
	}

	if len(bytes) == 0 {
		*l = nil
		return nil
	}

	if bytes[0] == '{' {
		var single LabelInput
		if err := json.Unmarshal(bytes, &single); err != nil {
			return err
		}
		*l = LabelInputs{single}
		return nil
	}

	return json.Unmarshal(bytes, l)
}

type Task struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`

	// DescriptionRich is the editor document; Description holds its plain text.
	DescriptionRich JSONMap `gorm:"type:jsonb;not null;default:'{}'" json:"descriptionRich"`

	Duration int `gorm:"default:0" json:"duration"` // total time to finish this task

	Deadline    *string `gorm:"type:date" json:"deadline"`
	StartDate   *string `gorm:"type:date" json:"startDate"`
	ScheduledOn *string `gorm:"type:timestamptz" json:"scheduledOn"`
	CompletedAt *string `gorm:"type:timestamptz" json:"completedAt"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	// Foreign Keys
	UserID        *string `json:"userId"`
	ProjectID     *string `json:"projectId"`
	StatusID      *string `json:"statusId"`
	PriorityLevel *string `json:"priorityLevel"`
	WorkspaceID   *string `json:"workspaceId"`
	ScheduleID    *string `json:"scheduleId"`
	StageID       *string `json:"stageId"`

	// Self Referencing Tasks
	BlockedByID *string `json:"blockedById"`

	// Relationships

	Project *Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"project,omitempty"`

	Status *Status `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"status,omitempty"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`

	Schedule *Schedule `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"schedule,omitempty"`

	Stage *Stage `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"stage,omitempty"`

	// Self References
	BlockedBy *Task `gorm:"foreignKey:BlockedByID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"blockedBy,omitempty"`

	CustomFieldValues []*CustomFieldValue `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"customFieldValues,omitempty"`

	LabelIDs LabelInputs `gorm:"column:label_ids;type:jsonb;" json:"labelIds"`
	Labels   []*Lable    `gorm:"-" json:"labels,omitempty"`

	// Recurrence is set for repeating tasks (haircut, weekly run). Such a task
	// is a series: occurrences are expanded on read and completed one by one.
	Recurrence *RecurrenceRule `gorm:"polymorphic:Owner;polymorphicValue:task" json:"recurrence"`

	// Blocks are the calendar intervals reserved for a one-off task. ScheduledOn
	// mirrors the earliest block start so list sorting keeps working.
	Blocks []ScheduledBlock `gorm:"foreignKey:TaskID" json:"blocks"`

	// Many-to-Many Labels
	// Labels []*Labels `gorm:"many2many:task_labels;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"labels,omitempty"`
}

func (t *Task) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if t.CreatedAt == "" {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	return nil
}

func (t *Task) BeforeUpdate(tx *gorm.DB) error {
	t.UpdatedAt = utils.GetCurrentTime()
	return nil
}

// IsRecurring reports whether the task is a series rather than a one-off.
func (t *Task) IsRecurring() bool {
	return t.Recurrence != nil && t.Recurrence.RRule != ""
}

// IsCompleted reports whether the (one-off) task has been finished.
func (t *Task) IsCompleted() bool {
	return t.CompletedAt != nil && *t.CompletedAt != ""
}

// ChunkMinutes is the longest block the engine should schedule at once.
// Time chunks were removed; a task is placed as one duration-sized block
// (the engine still splits across working-hour gaps).
func (t *Task) ChunkMinutes() int {
	return t.Duration
}
