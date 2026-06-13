package models

import (
	"database/sql/driver"
	"encoding/json"
)

type CustomFieldValue struct {
	ID            string                 `gorm:"type:text;primaryKey" json:"id"`
	CustomFieldID string                 `gorm:"type:text;not null;" json:"customFieldId"`
	TaskID        string                 `gorm:"type:text;not null;" json:"taskId"`
	OptionsValue  CustomFieldValueInputs `gorm:"type:jsonb;" json:"optionsValue"`
	Type          string                 `json:"type"`
	StringValue   *string                `gorm:"type:text" json:"stringValue,omitempty"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Task *Task `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"task,omitempty"`
}

type CustomFieldValueInput struct {
	Id string `json:"id"`
}

type CustomFieldValueInputs []CustomFieldValueInput

func (o CustomFieldValueInputs) Value() (driver.Value, error) {
	return json.Marshal(o)
}

func (o *CustomFieldValueInputs) Scan(value any) error {
	if value == nil {
		*o = nil
		return nil
	}

	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return nil
	}

	return json.Unmarshal(bytes, o)
}
