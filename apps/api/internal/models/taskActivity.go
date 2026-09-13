package models

type TaskActivity struct {
	ID        string  `gorm:"type:text;primaryKey" json:"id"`
	TaskID    string  `gorm:"type:text;not null;index" json:"taskId"`
	UserID    string  `gorm:"type:text;not null" json:"userId"`
	ActorName string  `gorm:"not null;default:''" json:"actorName"`
	Action    string  `gorm:"not null" json:"action"`
	Field     *string `gorm:"type:text" json:"field"`
	OldValue  *string `gorm:"type:text" json:"oldValue"`
	NewValue  *string `gorm:"type:text" json:"newValue"`
	Message   string  `gorm:"type:text;not null;default:''" json:"message"`
	CreatedAt string  `json:"createdAt"`
}

func (TaskActivity) TableName() string {
	return "task_activities"
}
