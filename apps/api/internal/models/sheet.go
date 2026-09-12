package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type SheetColumn struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Width int    `json:"width"`
	Type  string `json:"type"`
}

type SheetColumns []SheetColumn

func (c SheetColumns) Value() (driver.Value, error) {
	if c == nil {
		return "[]", nil
	}
	b, err := json.Marshal(c)
	return string(b), err
}

func (c *SheetColumns) Scan(src any) error {
	b, err := jsonBytes(src)
	if err != nil {
		return err
	}
	if len(b) == 0 {
		*c = SheetColumns{}
		return nil
	}
	return json.Unmarshal(b, c)
}

// SheetRow keys its cells by column id so that reordering or renaming a column
// never rewrites row data.
type SheetRow struct {
	ID    string            `json:"id"`
	Cells map[string]string `json:"cells"`
}

type SheetRows []SheetRow

func (r SheetRows) Value() (driver.Value, error) {
	if r == nil {
		return "[]", nil
	}
	b, err := json.Marshal(r)
	return string(b), err
}

func (r *SheetRows) Scan(src any) error {
	b, err := jsonBytes(src)
	if err != nil {
		return err
	}
	if len(b) == 0 {
		*r = SheetRows{}
		return nil
	}
	return json.Unmarshal(b, r)
}

func jsonBytes(src any) ([]byte, error) {
	switch v := src.(type) {
	case nil:
		return nil, nil
	case string:
		return []byte(v), nil
	case []byte:
		return v, nil
	default:
		return nil, errors.New("unsupported type for jsonb scan")
	}
}

type Sheet struct {
	ID string `gorm:"type:text;primaryKey" json:"id"`

	Title       string  `gorm:"not null;default:'Untitled'" json:"title"`
	Icon        *string `gorm:"type:text" json:"icon"`
	Description string  `gorm:"type:text;not null;default:''" json:"description"`

	// DescriptionRich is the editor document; Description holds its plain text.
	DescriptionRich JSONMap `gorm:"type:jsonb;not null;default:'{}'" json:"descriptionRich"`

	Columns SheetColumns `gorm:"type:jsonb;not null;default:'[]'" json:"columns"`
	Rows    SheetRows    `gorm:"type:jsonb;not null;default:'[]'" json:"rows"`

	WorkspaceID string  `gorm:"type:text;not null" json:"workspaceId"`
	ProjectID   *string `json:"projectId"`
	UserID      string  `gorm:"type:text;not null" json:"userId"`

	IsFavorite bool    `gorm:"not null;default:false" json:"isFavorite"`
	ArchivedAt *string `gorm:"type:text" json:"archivedAt"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`

	Workspace *Workspace `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"workspace,omitempty"`
	Project   *Project   `gorm:"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"project,omitempty"`
}

func (s *Sheet) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if s.CreatedAt == "" {
		s.CreatedAt = now
	}
	s.UpdatedAt = now
	return nil
}

func (s *Sheet) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}

// DefaultSheetColumns returns the starter grid every new sheet opens with.
func DefaultSheetColumns() SheetColumns {
	names := []string{"A", "B", "C", "D"}
	columns := make(SheetColumns, 0, len(names))
	for _, name := range names {
		columns = append(columns, SheetColumn{
			ID:    utils.PrefixedUUID("col"),
			Name:  name,
			Width: 160,
			Type:  "text",
		})
	}
	return columns
}

// DefaultSheetRows returns empty rows matching the starter columns.
func DefaultSheetRows(columns SheetColumns, count int) SheetRows {
	rows := make(SheetRows, 0, count)
	for i := 0; i < count; i++ {
		cells := make(map[string]string, len(columns))
		for _, column := range columns {
			cells[column.ID] = ""
		}
		rows = append(rows, SheetRow{ID: utils.PrefixedUUID("row"), Cells: cells})
	}
	return rows
}

const (
	SheetColumnTypeText    = "text"
	SheetColumnTypeNumber  = "number"
	SheetColumnTypeDate    = "date"
	SheetColumnTypeBoolean = "boolean"
)

// NormalizeSheetColumnType returns a canonical column type. Empty becomes text.
func NormalizeSheetColumnType(colType string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(colType)) {
	case "", SheetColumnTypeText:
		return SheetColumnTypeText, nil
	case SheetColumnTypeNumber:
		return SheetColumnTypeNumber, nil
	case SheetColumnTypeDate:
		return SheetColumnTypeDate, nil
	case SheetColumnTypeBoolean, "checkbox", "bool":
		return SheetColumnTypeBoolean, nil
	default:
		return "", errors.New("column type must be text, number, date, or boolean")
	}
}

// NormalizeTypedCell coerces a cell to the column type. Formulas (leading =)
// and empty values are left alone. Invalid number/date/boolean values become "".
func NormalizeTypedCell(colType, value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.HasPrefix(trimmed, "=") {
		return value
	}
	kind, err := NormalizeSheetColumnType(colType)
	if err != nil || kind == SheetColumnTypeText {
		return value
	}
	switch kind {
	case SheetColumnTypeNumber:
		n, err := strconv.ParseFloat(strings.ReplaceAll(trimmed, ",", ""), 64)
		if err != nil {
			return ""
		}
		return strconv.FormatFloat(n, 'f', -1, 64)
	case SheetColumnTypeDate:
		if len(trimmed) == 10 && trimmed[4] == '-' && trimmed[7] == '-' {
			if _, err := time.Parse("2006-01-02", trimmed); err == nil {
				return trimmed
			}
		}
		for _, layout := range []string{
			time.RFC3339,
			"2006-01-02T15:04:05",
			"2006-01-02 15:04:05",
			"01/02/2006",
			"1/2/2006",
			"Jan 2, 2006",
			"January 2, 2006",
		} {
			if parsed, err := time.Parse(layout, trimmed); err == nil {
				return parsed.Format("2006-01-02")
			}
		}
		return ""
	case SheetColumnTypeBoolean:
		switch strings.ToUpper(trimmed) {
		case "TRUE", "1", "YES", "Y":
			return "TRUE"
		case "FALSE", "0", "NO", "N":
			return "FALSE"
		default:
			return ""
		}
	}
	return value
}

// NormalizeSheetCells rewrites every cell according to its column type.
func NormalizeSheetCells(columns SheetColumns, rows SheetRows) {
	types := make(map[string]string, len(columns))
	for _, column := range columns {
		types[column.ID] = column.Type
	}
	for i := range rows {
		if rows[i].Cells == nil {
			continue
		}
		for colID, value := range rows[i].Cells {
			rows[i].Cells[colID] = NormalizeTypedCell(types[colID], value)
		}
	}
}
