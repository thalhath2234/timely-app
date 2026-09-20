package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"timely-api/internal/utils"
	"unicode/utf8"

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
	return marshalJSONSlice([]SheetColumn(c))
}

func (c *SheetColumns) Scan(src any) error {
	var items []SheetColumn
	if err := scanJSONSlice(src, &items); err != nil {
		return err
	}
	*c = items
	return nil
}

// SheetCellFormat stores optional display style for one cell, keyed by column id.
type SheetCellFormat struct {
	Bold          bool   `json:"bold,omitempty"`
	Italic        bool   `json:"italic,omitempty"`
	Underline     bool   `json:"underline,omitempty"`
	Strikethrough bool   `json:"strikethrough,omitempty"`
	Align         string `json:"align,omitempty"`
	VerticalAlign string `json:"verticalAlign,omitempty"`
	Wrap          bool   `json:"wrap,omitempty"`
	Clip          bool   `json:"clip,omitempty"`
	Rotation      int    `json:"rotation,omitempty"`
	NumberFormat  string `json:"numberFormat,omitempty"`
	Decimals      *int   `json:"decimals,omitempty"`
	TextColor     string `json:"textColor,omitempty"`
	FillColor     string `json:"fillColor,omitempty"`
	Border        string `json:"border,omitempty"`
	Link          string `json:"link,omitempty"`
	FontSize      int    `json:"fontSize,omitempty"`
	FontFamily    string `json:"fontFamily,omitempty"`
	Note          string `json:"note,omitempty"`
}

// SheetRow keys its cells by column id so that reordering or renaming a column
// never rewrites row data.
type SheetRow struct {
	ID      string                     `json:"id"`
	Cells   map[string]string          `json:"cells"`
	Formats map[string]SheetCellFormat `json:"formats,omitempty"`
}

type SheetRows []SheetRow

func (r SheetRows) Value() (driver.Value, error) {
	return marshalJSONSlice([]SheetRow(r))
}

func (r *SheetRows) Scan(src any) error {
	var items []SheetRow
	if err := scanJSONSlice(src, &items); err != nil {
		return err
	}
	*r = items
	return nil
}

// SheetMerge describes a rectangular merged range in grid coordinates.
type SheetMerge struct {
	StartCol int `json:"startCol"`
	StartRow int `json:"startRow"`
	ColSpan  int `json:"colSpan"`
	RowSpan  int `json:"rowSpan"`
}

type SheetMerges []SheetMerge

func (m SheetMerges) Value() (driver.Value, error) {
	return marshalJSONSlice([]SheetMerge(m))
}

func (m *SheetMerges) Scan(src any) error {
	var items []SheetMerge
	if err := scanJSONSlice(src, &items); err != nil {
		return err
	}
	*m = items
	return nil
}

// SheetTab is an extra worksheet inside a workbook. The first tab is also
// mirrored onto Sheet.Columns / Rows / Merges so older clients keep working.
type SheetTab struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Columns SheetColumns `json:"columns"`
	Rows    SheetRows    `json:"rows"`
	Merges  SheetMerges  `json:"merges,omitempty"`
}

type SheetTabs []SheetTab

func (t SheetTabs) Value() (driver.Value, error) {
	return marshalJSONSlice([]SheetTab(t))
}

func (t *SheetTabs) Scan(src any) error {
	var items []SheetTab
	if err := scanJSONSlice(src, &items); err != nil {
		return err
	}
	*t = items
	return nil
}

func marshalJSONSlice[T any](value []T) (driver.Value, error) {
	if value == nil {
		return "[]", nil
	}
	b, err := json.Marshal(value)
	return string(b), err
}

func scanJSONSlice[T any](src any, dest *[]T) error {
	b, err := jsonBytes(src)
	if err != nil {
		return err
	}
	if len(b) == 0 {
		*dest = []T{}
		return nil
	}
	return json.Unmarshal(b, dest)
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

	Title string  `gorm:"not null;default:'Untitled'" json:"title"`
	Icon  *string `gorm:"type:text" json:"icon"`

	Columns SheetColumns `gorm:"type:jsonb;not null;default:'[]'" json:"columns"`
	Rows    SheetRows    `gorm:"type:jsonb;not null;default:'[]'" json:"rows"`
	Merges  SheetMerges  `gorm:"type:jsonb;not null;default:'[]'" json:"merges"`
	Tabs    SheetTabs    `gorm:"type:jsonb;not null;default:'[]'" json:"tabs"`

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
	SheetColumnTypeText     = "text"
	SheetColumnTypeNumber   = "number"
	SheetColumnTypeDate     = "date"
	SheetColumnTypeBoolean  = "boolean"
	SheetColumnTypeCurrency = "currency"
	SheetColumnTypePercent  = "percent"
	SheetColumnTypeFormula  = "formula"

	SheetAlignLeft   = "left"
	SheetAlignCenter = "center"
	SheetAlignRight  = "right"

	SheetVerticalAlignTop    = "top"
	SheetVerticalAlignMiddle = "middle"
	SheetVerticalAlignBottom = "bottom"

	SheetNumberFormatNumber     = "number"
	SheetNumberFormatCurrency   = "currency"
	SheetNumberFormatPercent    = "percent"
	SheetNumberFormatScientific = "scientific"
	SheetNumberFormatPlain      = "plain"

	SheetBorderAll    = "all"
	SheetBorderOuter  = "outer"
	SheetBorderBottom = "bottom"
	SheetBorderTop    = "top"
	SheetBorderLeft   = "left"
	SheetBorderRight  = "right"

	SheetFontFamilyDefault = "default"
	SheetFontFamilySerif   = "serif"
	SheetFontFamilyMono    = "mono"
)

// NormalizeSheetColumnType returns a canonical column type. Empty becomes text.
func NormalizeSheetColumnType(colType string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(colType)) {
	case "", SheetColumnTypeText:
		return SheetColumnTypeText, nil
	case SheetColumnTypeNumber, "#":
		return SheetColumnTypeNumber, nil
	case SheetColumnTypeDate:
		return SheetColumnTypeDate, nil
	case SheetColumnTypeBoolean, "checkbox", "bool":
		return SheetColumnTypeBoolean, nil
	case SheetColumnTypeCurrency, "money":
		return SheetColumnTypeCurrency, nil
	case SheetColumnTypePercent, "%":
		return SheetColumnTypePercent, nil
	case SheetColumnTypeFormula, "fx", "computed":
		return SheetColumnTypeFormula, nil
	default:
		return "", errors.New("column type must be text, number, date, boolean, currency, percent, or formula")
	}
}

func normalizeNumberCell(value string) string {
	trimmed := strings.TrimSpace(value)
	hadPercent := strings.HasSuffix(trimmed, "%")
	if hadPercent {
		trimmed = strings.TrimSpace(strings.TrimSuffix(trimmed, "%"))
	}
	n, err := strconv.ParseFloat(strings.ReplaceAll(trimmed, ",", ""), 64)
	if err != nil {
		return ""
	}
	if hadPercent {
		n = n / 100
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
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
	case SheetColumnTypeNumber, SheetColumnTypeCurrency, SheetColumnTypePercent, SheetColumnTypeFormula:
		return normalizeNumberCell(trimmed)
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
		rows[i].Formats = NormalizeCellFormats(rows[i].Formats)
	}
}

func NormalizeCellFormats(formats map[string]SheetCellFormat) map[string]SheetCellFormat {
	if len(formats) == 0 {
		return nil
	}
	next := make(map[string]SheetCellFormat, len(formats))
	for colID, format := range formats {
		normalized := SheetCellFormat{
			Bold:          format.Bold,
			Italic:        format.Italic,
			Underline:     format.Underline,
			Strikethrough: format.Strikethrough,
			Align:         strings.ToLower(strings.TrimSpace(format.Align)),
			VerticalAlign: strings.ToLower(strings.TrimSpace(format.VerticalAlign)),
			Wrap:          format.Wrap,
			Clip:          format.Clip,
			Rotation:      format.Rotation,
			NumberFormat:  strings.ToLower(strings.TrimSpace(format.NumberFormat)),
			TextColor:     normalizeHexColor(format.TextColor),
			FillColor:     normalizeHexColor(format.FillColor),
			Border:        strings.ToLower(strings.TrimSpace(format.Border)),
			Link:          strings.TrimSpace(format.Link),
			FontSize:      format.FontSize,
			FontFamily:    strings.ToLower(strings.TrimSpace(format.FontFamily)),
			Note:          strings.TrimSpace(format.Note),
		}
		switch normalized.Align {
		case SheetAlignLeft, SheetAlignCenter, SheetAlignRight:
		default:
			normalized.Align = ""
		}
		switch normalized.VerticalAlign {
		case SheetVerticalAlignTop, SheetVerticalAlignMiddle, SheetVerticalAlignBottom:
		default:
			normalized.VerticalAlign = ""
		}
		switch normalized.NumberFormat {
		case SheetNumberFormatNumber, SheetNumberFormatCurrency, SheetNumberFormatPercent,
			SheetNumberFormatScientific, SheetNumberFormatPlain:
		default:
			normalized.NumberFormat = ""
		}
		switch normalized.Border {
		case SheetBorderAll, SheetBorderOuter, SheetBorderBottom, SheetBorderTop, SheetBorderLeft, SheetBorderRight:
		default:
			normalized.Border = ""
		}
		if normalized.Rotation > 90 {
			normalized.Rotation = 90
		}
		if normalized.Rotation < -90 {
			normalized.Rotation = -90
		}
		switch normalized.FontFamily {
		case SheetFontFamilyDefault, SheetFontFamilySerif, SheetFontFamilyMono:
			if normalized.FontFamily == SheetFontFamilyDefault {
				normalized.FontFamily = ""
			}
		default:
			normalized.FontFamily = ""
		}
		if normalized.FontSize < 8 || normalized.FontSize > 36 {
			normalized.FontSize = 0
		}
		if format.Decimals != nil {
			decimals := *format.Decimals
			if decimals < 0 {
				decimals = 0
			}
			if decimals > 8 {
				decimals = 8
			}
			normalized.Decimals = &decimals
		}
		normalized.Link = truncateUTF8Bytes(normalized.Link, 2048)
		normalized.Note = truncateUTF8Bytes(normalized.Note, 2000)
		if cellFormatEmpty(normalized) {
			continue
		}
		next[colID] = normalized
	}
	if len(next) == 0 {
		return nil
	}
	return next
}

func normalizeHexColor(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) == 4 && trimmed[0] == '#' {
		expanded := make([]byte, 7)
		expanded[0] = '#'
		expanded[1], expanded[2] = trimmed[1], trimmed[1]
		expanded[3], expanded[4] = trimmed[2], trimmed[2]
		expanded[5], expanded[6] = trimmed[3], trimmed[3]
		trimmed = string(expanded)
	}
	if len(trimmed) != 7 || trimmed[0] != '#' {
		return ""
	}
	for i := 1; i < 7; i++ {
		c := trimmed[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
			return ""
		}
	}
	return strings.ToLower(trimmed)
}

func truncateUTF8Bytes(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	end := limit
	for end > 0 && !utf8.RuneStart(value[end]) {
		end--
	}
	return value[:end]
}

func cellFormatEmpty(format SheetCellFormat) bool {
	return !format.Bold &&
		!format.Italic &&
		!format.Underline &&
		!format.Strikethrough &&
		format.Align == "" &&
		format.VerticalAlign == "" &&
		!format.Wrap &&
		!format.Clip &&
		format.Rotation == 0 &&
		format.NumberFormat == "" &&
		format.Decimals == nil &&
		format.TextColor == "" &&
		format.FillColor == "" &&
		format.Border == "" &&
		format.Link == "" &&
		format.FontSize == 0 &&
		format.FontFamily == "" &&
		format.Note == ""
}

// NormalizeMerges drops out-of-bounds or overlapping ranges.
func NormalizeMerges(merges SheetMerges, colCount, rowCount int) SheetMerges {
	if len(merges) == 0 || colCount < 1 || rowCount < 1 {
		return SheetMerges{}
	}
	occupied := make([][]bool, rowCount)
	for i := range occupied {
		occupied[i] = make([]bool, colCount)
	}
	out := make(SheetMerges, 0, len(merges))
	for _, merge := range merges {
		if merge.ColSpan < 1 {
			merge.ColSpan = 1
		}
		if merge.RowSpan < 1 {
			merge.RowSpan = 1
		}
		if merge.StartCol < 0 || merge.StartRow < 0 {
			continue
		}
		if merge.ColSpan == 1 && merge.RowSpan == 1 {
			continue
		}
		if merge.StartCol+merge.ColSpan > colCount || merge.StartRow+merge.RowSpan > rowCount {
			continue
		}
		overlaps := false
		for row := merge.StartRow; row < merge.StartRow+merge.RowSpan && !overlaps; row++ {
			for col := merge.StartCol; col < merge.StartCol+merge.ColSpan; col++ {
				if occupied[row][col] {
					overlaps = true
					break
				}
			}
		}
		if overlaps {
			continue
		}
		for row := merge.StartRow; row < merge.StartRow+merge.RowSpan; row++ {
			for col := merge.StartCol; col < merge.StartCol+merge.ColSpan; col++ {
				occupied[row][col] = true
			}
		}
		out = append(out, merge)
	}
	return out
}

func NormalizeSheetTab(tab SheetTab, fallbackName string) (SheetTab, error) {
	if tab.ID == "" {
		tab.ID = utils.PrefixedUUID("tab")
	}
	tab.Name = strings.TrimSpace(tab.Name)
	if tab.Name == "" {
		tab.Name = fallbackName
	}
	if len(tab.Name) > 80 {
		tab.Name = tab.Name[:80]
	}
	if err := NormalizeSheetColumns(tab.Columns); err != nil {
		return SheetTab{}, err
	}
	NormalizeSheetCells(tab.Columns, tab.Rows)
	tab.Merges = NormalizeMerges(tab.Merges, len(tab.Columns), len(tab.Rows))
	return tab, nil
}

func NormalizeSheetColumns(columns SheetColumns) error {
	for i := range columns {
		kind, err := NormalizeSheetColumnType(columns[i].Type)
		if err != nil {
			return err
		}
		columns[i].Type = kind
		if columns[i].Width < 1 {
			columns[i].Width = 160
		}
	}
	return nil
}

func CloneGrid(columns SheetColumns, rows SheetRows) (SheetColumns, SheetRows) {
	idMap := make(map[string]string, len(columns))
	nextColumns := make(SheetColumns, len(columns))
	for i, column := range columns {
		nextID := utils.PrefixedUUID("col")
		idMap[column.ID] = nextID
		column.ID = nextID
		nextColumns[i] = column
	}

	nextRows := make(SheetRows, len(rows))
	for i, row := range rows {
		cells := make(map[string]string, len(row.Cells))
		for oldID, value := range row.Cells {
			nextID, ok := idMap[oldID]
			if !ok {
				nextID = oldID
			}
			cells[nextID] = value
		}
		var formats map[string]SheetCellFormat
		if len(row.Formats) > 0 {
			formats = make(map[string]SheetCellFormat, len(row.Formats))
			for oldID, format := range row.Formats {
				nextID, ok := idMap[oldID]
				if !ok {
					nextID = oldID
				}
				formats[nextID] = format
			}
		}
		nextRows[i] = SheetRow{
			ID:      utils.PrefixedUUID("row"),
			Cells:   cells,
			Formats: formats,
		}
	}
	return nextColumns, nextRows
}

func CloneMerges(merges SheetMerges) SheetMerges {
	if len(merges) == 0 {
		return SheetMerges{}
	}
	out := make(SheetMerges, len(merges))
	copy(out, merges)
	return out
}

func CloneTabs(tabs SheetTabs) SheetTabs {
	if len(tabs) == 0 {
		return SheetTabs{}
	}
	out := make(SheetTabs, len(tabs))
	for i, tab := range tabs {
		columns, rows := CloneGrid(tab.Columns, tab.Rows)
		out[i] = SheetTab{
			ID:      utils.PrefixedUUID("tab"),
			Name:    tab.Name,
			Columns: columns,
			Rows:    rows,
			Merges:  CloneMerges(tab.Merges),
		}
	}
	return out
}

// CloneSheetContents copies grid data with new ids so a duplicate is independent.
func CloneSheetContents(src *Sheet) (SheetColumns, SheetRows, SheetMerges, SheetTabs) {
	if src == nil {
		return nil, nil, nil, nil
	}
	columns, rows := CloneGrid(src.Columns, src.Rows)
	return columns, rows, CloneMerges(src.Merges), CloneTabs(src.Tabs)
}
