package models

type CustomFieldValue struct {
	ID            string          `gorm:"type:text;primaryKey" json:"id"`
	CustomFieldID string          `gorm:"type:text;not null;" json:"customFieldId"`
	TaskID        string          `gorm:"type:text;not null;" json:"taskId"`
	Value         string          `gorm:"type:text;not null;" json:"value"`
	Type          CustomFieldType `json:"type"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	CustomField *CustomField `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"customField,omitempty"`
	Task        *Task        `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"task,omitempty"`
}
