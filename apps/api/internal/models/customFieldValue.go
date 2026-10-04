package models

import (
	"database/sql/driver"
	"encoding/json"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type CustomFieldValue struct {
	ID            string                 `gorm:"type:text;primaryKey" json:"customFieldValueId"`
	CustomFieldID string                 `gorm:"type:text;not null;" json:"customFieldId"`
	TaskID        string                 `gorm:"type:text;" json:"taskId,omitempty"`
	ProjectID     string                 `gorm:"type:text;" json:"projectId,omitempty"`
	OptionsValue  CustomFieldValueInputs `gorm:"type:jsonb;" json:"-"`
	Type          string                 `json:"type"`
	StringValue   *string                `gorm:"type:text" json:"stringValue,omitempty"`
	BoolValue     *bool                  `gorm:"-" json:"boolValue,omitempty"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Task        *Task        `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Project     *Project     `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	CustomField *CustomField `gorm:"foreignKey:CustomFieldID;" json:"-"`

	// API-only fields
	Name        string   `gorm:"-" json:"name,omitempty"`
	OptionValue []Option `gorm:"-" json:"optionValue,omitempty"`
}

func (c *CustomFieldValue) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if c.CreatedAt == "" {
		c.CreatedAt = now
	}
	c.UpdatedAt = now
	return nil
}

func (c *CustomFieldValue) BeforeUpdate(tx *gorm.DB) error {
	c.UpdatedAt = utils.GetCurrentTime()
	return nil
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

	if len(bytes) == 0 {
		*o = nil
		return nil
	}

	// Accept both a single object and an array of objects stored in JSONB.
	if bytes[0] == '{' {
		var single CustomFieldValueInput
		if err := json.Unmarshal(bytes, &single); err != nil {
			return err
		}
		*o = CustomFieldValueInputs{single}
		return nil
	}

	return json.Unmarshal(bytes, o)
}

func (c *CustomFieldValue) EnrichDerived() {
	if c == nil {
		return
	}
	isBool := c.Type == string(CustomFieldTypeBoolean) ||
		(c.CustomField != nil && c.CustomField.Type == CustomFieldTypeBoolean)
	if !isBool || c.StringValue == nil {
		return
	}
	v := *c.StringValue == "true" || *c.StringValue == "1"
	c.BoolValue = &v
}
