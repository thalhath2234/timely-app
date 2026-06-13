package models

type Stage struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name  string `gorm:"not null" json:"name"`
	Order int    `json:"order"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	ProjectID *string `json:"projectId"`

	Project Project `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"project,omitempty"`

	Tasks []Task `json:"tasks,omitempty"`
}
