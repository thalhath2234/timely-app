package models

type Schedule struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Name string `gorm:"not null" json:"name"`

	// Example:
	// daily
	// weekly
	// custom
	Type string `json:"type"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Tasks []Task `json:"tasks,omitempty"`
}
