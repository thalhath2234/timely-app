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

	// Kind is task (schedulable work), reminder (timed ping), or inbox
	// (unprocessed capture). Duration 0 is no longer enough on its own:
	// inbox items also have duration 0 but must not appear as calendar pings.
	Kind string `gorm:"type:text;not null;default:task" json:"kind"`

	Checklist Checklist `gorm:"type:jsonb;not null;default:'[]'" json:"checklist"`

	// ActualMinutes is focused time, independent of estimated Duration.
	ActualMinutes  int     `gorm:"not null;default:0" json:"actualMinutes"`
	FocusStartedAt *string `gorm:"type:timestamptz" json:"focusStartedAt"`
	// TodayFocusOn is a calendar day the user picked as a Today focus item.
	TodayFocusOn *string `gorm:"type:date" json:"todayFocusOn"`

	MinChunkMinutes       int              `gorm:"not null;default:15" json:"minChunkMinutes"`
	PreferredChunkMinutes *int             `json:"preferredChunkMinutes"`
	Contiguous            bool             `gorm:"not null;default:false" json:"contiguous"`
	EarliestStartAt       *string          `gorm:"type:timestamptz" json:"earliestStartAt"`
	PreferredWindows      PreferredWindows `gorm:"type:jsonb;not null;default:'[]'" json:"preferredWindows"`
	ScheduleLocked        bool             `gorm:"not null;default:false" json:"scheduleLocked"`

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
	WorkspaceID   *string `json:"workspaceId"` // nil for inbox items and standalone reminders
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

	// Progress is computed on read from checklist items.
	ChecklistDone  int `gorm:"-" json:"checklistDone"`
	ChecklistTotal int `gorm:"-" json:"checklistTotal"`
	ProgressDone   int `gorm:"-" json:"progressDone"`
	ProgressTotal  int `gorm:"-" json:"progressTotal"`

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

func (t *Task) AfterFind(tx *gorm.DB) error {
	normalizeDatePtr(t.TodayFocusOn)
	normalizeDatePtr(t.Deadline)
	normalizeDatePtr(t.StartDate)
	return nil
}

// IsRecurring reports whether the task is a series rather than a one-off.
func (t *Task) IsRecurring() bool {
	return t.Recurrence != nil && t.Recurrence.RRule != ""
}

// IsInbox is an unprocessed capture. It is not a calendar ping and the
// engine must not auto-schedule it until it is clarified into a task.
func (t *Task) IsInbox() bool {
	return t.Kind == KindInbox
}

// IsReminder is a timed ping with no work estimate. It can be one-off or
// repeating; it shows on the calendar at that time but does not reserve a block.
// Inbox items also have duration 0, so kind is the source of truth.
func (t *Task) IsReminder() bool {
	if t.Kind == KindInbox {
		return false
	}
	if t.Kind == KindReminder {
		return true
	}
	if t.Kind == KindTask {
		return false
	}
	return t.Duration <= 0
}

func (t *Task) IsFocusing() bool {
	return t.FocusStartedAt != nil && *t.FocusStartedAt != ""
}

func (t *Task) IsSchedulableWork() bool {
	return t.Kind == KindTask && t.Duration > 0 && !t.IsCompleted()
}

// IsCompleted reports whether the (one-off) task has been finished.
func (t *Task) IsCompleted() bool {
	return t.CompletedAt != nil && *t.CompletedAt != ""
}

// ChunkMinutes is the longest block the engine should schedule at once.
// Time chunks were removed; a task is placed as one duration-sized block
// (the engine still splits across working-hour gaps).
func (t *Task) ChunkMinutes() int {
	if t.PreferredChunkMinutes != nil && *t.PreferredChunkMinutes > 0 {
		return *t.PreferredChunkMinutes
	}
	if t.Contiguous {
		return t.Duration
	}
	return t.Duration
}

func (t *Task) MinChunk() int {
	if t.MinChunkMinutes < 15 {
		return 15
	}
	return t.MinChunkMinutes
}

// EntityColor is the scan color for lists and calendar: project, then workspace,
// then a stable hash so tasks without a stored color still stay distinct.
func (t *Task) EntityColor() string {
	if t == nil {
		return utils.UnstagedColor
	}
	if t.Project != nil {
		color := ""
		if t.Project.Color != nil {
			color = *t.Project.Color
		}
		return utils.ResolvedColor(color, t.Project.ID, 0)
	}
	if t.ProjectID != nil && *t.ProjectID != "" {
		return utils.StableColorForID(*t.ProjectID)
	}
	if t.Workspace != nil {
		return utils.ResolvedColor(t.Workspace.Color, t.Workspace.ID, 0)
	}
	if t.WorkspaceID != nil && *t.WorkspaceID != "" {
		return utils.StableColorForID(*t.WorkspaceID)
	}
	return utils.UnstagedColor
}
