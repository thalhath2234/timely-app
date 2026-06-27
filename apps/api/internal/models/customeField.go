package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// CustomField represents a custom field model as returned by the API.
type CustomField struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	WorkspaceID string          `json:"workspaceId"`
	CreatedAt   string          `json:"createdTime"`
	UpdatedAt   string          `json:"updatedTime"`
	Type        CustomFieldType `gorm:"type:text;not null" json:"type"`
	Options     Options         `gorm:"type:jsonb" json:"options"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`
}

func (c *CustomField) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if c.CreatedAt == "" {
		c.CreatedAt = now
	}
	c.UpdatedAt = now

	if !c.Type.IsValid() {
		return errors.New("invalid custom field type")
	}
	return nil
}

func (c *CustomField) BeforeUpdate(tx *gorm.DB) error {
	c.UpdatedAt = utils.GetCurrentTime()
	if !c.Type.IsValid() {
		return errors.New("invalid custom field type")
	}
	return nil
}

type CustomFieldType string

const (
	CustomFieldTypeText        CustomFieldType = "text"
	CustomFieldTypeMultiSelect CustomFieldType = "multi_select"
	CustomFieldTypeSelect      CustomFieldType = "select"
	CustomFieldTypeNumber      CustomFieldType = "number"
	CustomFieldTypeURL         CustomFieldType = "url"
	CustomFieldTypeDate        CustomFieldType = "date"
)

type Option struct {
	ID    string `json:"id"`
	Value string `json:"value"`
	Color string `json:"color"`
}

type Options struct {
	Options []Option `json:"options"`
}

func (o Options) Value() (driver.Value, error) {
	return json.Marshal(o)
}

func (t CustomFieldType) IsValid() bool {
	switch t {
	case CustomFieldTypeText,
		CustomFieldTypeMultiSelect,
		CustomFieldTypeSelect,
		CustomFieldTypeNumber,
		CustomFieldTypeURL,
		CustomFieldTypeDate:
		return true
	default:
		return false
	}
}

func (o *Options) Scan(value any) error {
	if value == nil {
		*o = Options{}
		return nil
	}

	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}

	return json.Unmarshal(bytes, o)
}
