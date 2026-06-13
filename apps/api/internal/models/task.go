package models

type Task struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`

	// PostgreSQL text[]
	TimeChunks int `gorm:"default:30" json:"timeChunks"` // 30 min chunks  break 5 min between each chunks

	Duration int `gorm:"default:0" json:"duration"` // total time to finish this task

	Deadline    *string `gorm:"type:date" json:"deadline"`
	StartDate   *string `gorm:"type:date" json:"startDate"`
	ScheduledOn *string `gorm:"type:timestamptz" json:"scheduledOn"`
	CompletedAt *string `gorm:"type:timestamptz" json:"completedAt"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	// Foreign Keys
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

	// Many-to-Many Labels
	// Labels []*Labels `gorm:"many2many:task_labels;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"labels,omitempty"`
}
