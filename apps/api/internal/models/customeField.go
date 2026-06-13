package models

import (
	"database/sql/driver"
	"encoding/json"
)

// CustomField represents a custom field model as returned by the API.
type CustomField struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	WorkspaceID string          `json:"workspaceId"`
	CreatedAt   string          `json:"createdTime"`
	UpdatedAt   string          `json:"updatedTime"`
	Type        CustomFieldType `json:"type"`
	Options     Options         `gorm:"type:jsonb" json:"options"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`
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
