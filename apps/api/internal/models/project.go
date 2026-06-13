package models

type Project struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`

	WorkspaceID *string `json:"workspaceId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`

	Stages []*Stage `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"stages,omitempty"`

	Tasks []*Task `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"tasks,omitempty"`
}
