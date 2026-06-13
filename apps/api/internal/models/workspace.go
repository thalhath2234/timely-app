package models

type Workspace struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name   string  `gorm:"not null" json:"name"`
	UserID *string `json:"userId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Status       []*Status      `json:"status,omitempty"`
	Lables       []*Lable       `json:"lables,omitempty"`
	Projects     []*Project     `json:"projects,omitempty"`
	Tasks        []*Task        `json:"tasks,omitempty"`
	CustomFields []*CustomField `json:"customFields,omitempty"`
}
