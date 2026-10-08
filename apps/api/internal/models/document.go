package models

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// JSONMap holds an arbitrary JSON object. Document content is a ProseMirror
// document tree, so the API stores and returns it verbatim.
type JSONMap map[string]any

func (m JSONMap) Value() (driver.Value, error) {
	b, err := MarshalJSONMap(m)
	if err != nil {
		return nil, err
	}
	// []byte so pgx/libpq bind this as jsonb, not a JSON string (double-encoded).
	return b, nil
}

func (m *JSONMap) Scan(src any) error {
	if src == nil {
		*m = JSONMap{}
		return nil
	}

	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for JSONMap scan")
	}

	if len(b) == 0 {
		*m = JSONMap{}
		return nil
	}

	return UnmarshalJSONMap(b, m)
}

// UnmarshalJSON accepts a TipTap document object or a bare block array.
func (m *JSONMap) UnmarshalJSON(b []byte) error {
	return UnmarshalJSONMap(b, m)
}

// MarshalJSONMap encodes a JSON object for a jsonb column.
func MarshalJSONMap(m JSONMap) ([]byte, error) {
	if m == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(m)
}

// UnmarshalJSONMap accepts a ProseMirror object, a bare block array (some
// editors omit the doc wrapper), or a JSON string of either.
func UnmarshalJSONMap(b []byte, dest *JSONMap) error {
	if dest == nil {
		return errors.New("nil JSONMap destination")
	}
	b = bytes.TrimSpace(b)
	if len(b) == 0 || string(b) == "null" {
		*dest = JSONMap{}
		return nil
	}

	if b[0] == '"' {
		var inner string
		if err := json.Unmarshal(b, &inner); err != nil {
			return err
		}
		return UnmarshalJSONMap([]byte(inner), dest)
	}

	if b[0] == '[' {
		var blocks []any
		if err := json.Unmarshal(b, &blocks); err != nil {
			return err
		}
		*dest = JSONMap{"type": "doc", "content": blocks}
		return nil
	}

	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*dest = JSONMap(raw)
	return nil
}

// NormalizeDocumentContent makes sure the tree is a {type:"doc"} document.
func NormalizeDocumentContent(raw JSONMap) JSONMap {
	if len(raw) == 0 {
		return EmptyDocumentContent()
	}
	if _, ok := raw["type"]; !ok {
		if blocks, ok := raw["content"]; ok {
			return JSONMap{"type": "doc", "content": blocks}
		}
		return EmptyDocumentContent()
	}
	if raw["type"] != "doc" {
		return JSONMap{"type": "doc", "content": []any{raw}}
	}
	if _, ok := raw["content"]; !ok {
		raw["content"] = []any{map[string]any{"type": "paragraph"}}
	}
	return raw
}

// IsDocumentContentEmpty reports a blank TipTap tree (no text nodes).
func IsDocumentContentEmpty(m JSONMap) bool {
	if len(m) == 0 {
		return true
	}
	if _, ok := m["type"].(string); !ok {
		return true
	}
	return !jsonMapHasText(m)
}

func jsonMapHasText(node any) bool {
	switch n := node.(type) {
	case JSONMap:
		if text, ok := n["text"].(string); ok && text != "" {
			return true
		}
		return jsonMapHasText(n["content"])
	case map[string]any:
		if text, ok := n["text"].(string); ok && text != "" {
			return true
		}
		return jsonMapHasText(n["content"])
	case []any:
		for _, child := range n {
			if jsonMapHasText(child) {
				return true
			}
		}
	}
	return false
}

// DocumentFromPlainText wraps leftover search text as paragraph nodes so a
// client that sent unusable JSON still keeps the words the user typed.
func DocumentFromPlainText(plain string) JSONMap {
	lines := strings.Split(strings.ReplaceAll(plain, "\r\n", "\n"), "\n")
	blocks := make([]any, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		blocks = append(blocks, map[string]any{
			"type": "paragraph",
			"content": []any{
				map[string]any{"type": "text", "text": line},
			},
		})
	}
	if len(blocks) == 0 {
		return EmptyDocumentContent()
	}
	return JSONMap{"type": "doc", "content": blocks}
}

type Document struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Title     string  `gorm:"not null;default:'Untitled'" json:"title"`
	Icon      *string `gorm:"type:text" json:"icon"`
	Content   JSONMap `gorm:"type:jsonb;not null;default:'{}'" json:"content"`
	PlainText string  `gorm:"type:text;not null;default:''" json:"plainText"`

	ParentID    *string `json:"parentId"`
	WorkspaceID string  `gorm:"type:text;not null" json:"workspaceId"`
	ProjectID   *string `json:"projectId"`
	UserID      string  `gorm:"type:text;not null" json:"userId"`

	IsFavorite bool    `gorm:"not null;default:false" json:"isFavorite"`
	ArchivedAt *string `gorm:"type:text" json:"archivedAt"`
	Order      int     `gorm:"column:order;not null;default:0" json:"order"`
	// IsTemplate offers the doc under "New from template".
	IsTemplate bool `gorm:"not null;default:false" json:"isTemplate"`
	// DailyDate (YYYY-MM-DD) marks the daily note for that day.
	DailyDate *string `gorm:"type:text" json:"dailyDate"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`
	Project   *Project   `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"project,omitempty"`
}

func (d *Document) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if d.CreatedAt == "" {
		d.CreatedAt = now
	}
	d.UpdatedAt = now
	return nil
}

func (d *Document) BeforeUpdate(tx *gorm.DB) error {
	d.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}

// EmptyDocumentContent is the ProseMirror document a new page starts with.
func EmptyDocumentContent() JSONMap {
	return JSONMap{
		"type": "doc",
		"content": []any{
			map[string]any{"type": "paragraph"},
		},
	}
}
