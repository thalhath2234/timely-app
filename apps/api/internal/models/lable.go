package models

type Lable struct {
	ID          string `gorm:"type:text;primaryKey" json:"id"`
	Name        string `gorm:"not null;unique" json:"name"`
	Color       string `json:"color"`
	WorkspaceID string `gorm:"type:uuid;not null" json:"workspaceId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
