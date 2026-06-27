package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Project struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Title          string  `gorm:"not null" json:"title"`
	Description    string  `gorm:"type:text" json:"description"`
	StatusID       *string `json:"statusId"`
	Deadline       *string `gorm:"type:date" json:"deadline"`
	StartDate      *string `gorm:"type:date" json:"startDate"`
	CompletedAt    *string `gorm:"type:timestamptz" json:"completedAt"`
	PriorityLevel  *string `json:"priorityLevel"`
	Color          *string `json:"color"`
	DoesHaveStages bool    `gorm:"default:false" json:"doesHaveStages"`

	WorkspaceID *string `json:"workspaceId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Workspace         *Workspace          `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`
	Status            *Status             `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"status,omitempty"`
	CustomFieldValues []*CustomFieldValue `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"customFieldValues,omitempty"`
	Stages            []*Stage            `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"stages,omitempty"`

	Tasks []*Task `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"tasks,omitempty"`
}

func (p *Project) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if p.CreatedAt == "" {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	return nil
}

func (p *Project) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = utils.GetCurrentTime()
	return nil
}
