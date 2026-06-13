package models

type Status struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name        string `gorm:"not null" json:"name"`
	Color       string `json:"color"`
	WorkspaceID string `gorm:"type:uuid;not null" json:"workspaceId"`
	IsDefault   bool   `gorm:"default:false" json:"isDefault"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Tasks []Task `json:"tasks,omitempty"`
}
