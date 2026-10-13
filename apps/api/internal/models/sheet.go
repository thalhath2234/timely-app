package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"regexp"
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
	// Options lists the choices of a select (dropdown) column. Other column
	// types keep it empty.
	Options []string `json:"options,omitempty"`
	// Format sets how the whole column displays: currency, date style, decimals.
	Format *SheetColumnFormat `json:"format,omitempty"`
	// Hidden columns keep their data but are not drawn.
	Hidden bool `json:"hidden,omitempty"`
}

// SheetColumnFormat is the column-wide display style. Cell formats override it.
type SheetColumnFormat struct {
	// Currency is an ISO 4217 code such as LKR, or a short symbol such as Rs.
	Currency string `json:"currency,omitempty"`
	// DateFormat is one of SheetDateFormats.
	DateFormat string `json:"dateFormat,omitempty"`
	Decimals   *int   `json:"decimals,omitempty"`
}

// SheetDateFormats are the date styles a column can show.
var SheetDateFormats = []string{"yyyy-mm-dd", "d mmm yyyy", "d mmm", "mmm d, yyyy", "dd/mm/yyyy", "mm/dd/yyyy", "ddd d mmm", "mmmm yyyy"}

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
	// Color tints the tab in the tab strip.
	Color string `json:"color,omitempty"`
	// FrozenRows/FrozenCols keep the first rows/columns in view while scrolling.
	FrozenRows int `json:"frozenRows,omitempty"`
	FrozenCols int `json:"frozenCols,omitempty"`
	// ConditionalFormats color cells (or their rows) whose value matches a rule.
	ConditionalFormats []SheetConditionalFormat `json:"conditionalFormats,omitempty"`
}

// SheetConditionalFormat styles the cells of one column that match a test.
type SheetConditionalFormat struct {
	ID       string `json:"id"`
	ColumnID string `json:"columnId"`
	// Operator is one of SheetConditionOperators.
	Operator  string `json:"operator"`
	Value     string `json:"value,omitempty"`
	Value2    string `json:"value2,omitempty"`
	FillColor string `json:"fillColor,omitempty"`
	TextColor string `json:"textColor,omitempty"`
	Bold      bool   `json:"bold,omitempty"`
	// WholeRow paints every cell of a matching row.
	WholeRow bool `json:"wholeRow,omitempty"`
}

// SheetConditionOperators are the tests a conditional format can use.
var SheetConditionOperators = []string{
	"gt", "gte", "lt", "lte", "eq", "neq", "between", "contains", "notContains",
	"empty", "notEmpty", "aboveAverage", "belowAverage", "duplicate",
}

const (
	maxConditionalFormats = 50
	maxFrozenRows         = 50
	maxFrozenCols         = 10
)

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
	SheetColumnTypeSelect   = "select"

	// MaxSheetSelectOptions caps the dropdown choices of one select column.
	MaxSheetSelectOptions = 200
	// MaxSheetSelectOptionLength caps one dropdown choice in bytes.
	MaxSheetSelectOptionLength = 120

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
	case SheetColumnTypeSelect, "dropdown", "choice", "enum":
		return SheetColumnTypeSelect, nil
	default:
		return "", errors.New("column type must be text, number, date, boolean, currency, percent, formula, or select")
	}
}

// NormalizeSelectOptions trims, de-duplicates (case-insensitively, keeping the
// first spelling) and caps the choices of a select column.
func NormalizeSelectOptions(options []string) []string {
	if len(options) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(options))
	out := make([]string, 0, len(options))
	for _, option := range options {
		trimmed := truncateUTF8Bytes(strings.TrimSpace(option), MaxSheetSelectOptionLength)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, trimmed)
		if len(out) >= MaxSheetSelectOptions {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// MatchSelectOption returns the stored spelling of value among options when it
// matches one case-insensitively, and whether it matched.
func MatchSelectOption(options []string, value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	for _, option := range options {
		if strings.EqualFold(option, trimmed) {
			return option, true
		}
	}
	return trimmed, false
}

var (
	currencyAffix   = regexp.MustCompile(`^(?:[A-Z]{3}|(?i:rs\.?|r\$|kr|zł|fr\.?)|\p{Sc})\s*|\s*(?:[A-Z]{3}|(?i:rs\.?|kr|zł|fr\.?)|\p{Sc})$`)
	plainNumberText = regexp.MustCompile(`^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$`)
	unicodeFraction = map[string]float64{"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1.0 / 3, "⅔": 2.0 / 3, "⅛": 0.125}
)

// ParseNumberText reads a number the way people type amounts: "$12.50",
// "Rs 1,250", "LKR 500", "1.234,56", "(45.00)" for a negative, "12%" and "½".
func ParseNumberText(value string) (float64, bool) {
	text := strings.TrimSpace(value)
	if text == "" {
		return 0, false
	}
	if f, ok := unicodeFraction[text]; ok {
		return f, true
	}
	negative := false
	if strings.HasPrefix(text, "(") && strings.HasSuffix(text, ")") {
		negative = true
		text = strings.TrimSpace(text[1 : len(text)-1])
	}
	percent := strings.HasSuffix(text, "%")
	if percent {
		text = strings.TrimSpace(strings.TrimSuffix(text, "%"))
	}
	if strings.HasPrefix(text, "-") {
		negative = !negative
		text = strings.TrimSpace(text[1:])
	}
	for i := 0; i < 2; i++ {
		text = strings.TrimSpace(currencyAffix.ReplaceAllString(text, ""))
	}
	if strings.HasPrefix(text, "-") {
		negative = !negative
		text = strings.TrimSpace(text[1:])
	}
	text = strings.NewReplacer(" ", "", "\u00a0", "", "\u202f", "", "'", "").Replace(text)
	lastComma := strings.LastIndex(text, ",")
	lastDot := strings.LastIndex(text, ".")
	switch {
	case lastComma >= 0 && lastDot >= 0 && lastComma > lastDot:
		// 1.234,56 (decimal comma)
		text = strings.ReplaceAll(text, ".", "")
		text = strings.Replace(text, ",", ".", 1)
	case lastComma >= 0 && lastDot < 0 && strings.Count(text, ",") == 1 && len(text)-lastComma-1 <= 2:
		// 9,99 (decimal comma without thousands)
		text = strings.Replace(text, ",", ".", 1)
	default:
		text = strings.ReplaceAll(text, ",", "")
	}
	if !plainNumberText.MatchString(text) {
		return 0, false
	}
	n, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return 0, false
	}
	if negative {
		n = -n
	}
	if percent {
		n = n / 100
	}
	return n, true
}

var dateLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006/01/02",
	"2006.01.02",
	"01/02/2006",
	"1/2/2006",
	"Jan 2, 2006",
	"January 2, 2006",
	"Jan 2 2006",
	"January 2 2006",
	"2 Jan 2006",
	"02 Jan 2006",
	"2 January 2006",
	"2-Jan-2006",
	"2-Jan-06",
	"Mon, 2 Jan 2006",
	"Monday, January 2, 2006",
}

// ParseTypedCell coerces a cell to the column type and reports whether the
// value fits it. Formulas and blanks always fit.
func ParseTypedCell(colType, value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.HasPrefix(trimmed, "=") {
		return value, true
	}
	kind, err := NormalizeSheetColumnType(colType)
	if err != nil || kind == SheetColumnTypeText {
		return value, true
	}
	switch kind {
	case SheetColumnTypeNumber, SheetColumnTypeCurrency, SheetColumnTypePercent, SheetColumnTypeFormula:
		n, ok := ParseNumberText(trimmed)
		if !ok {
			return value, false
		}
		return strconv.FormatFloat(n, 'f', -1, 64), true
	case SheetColumnTypeDate:
		if len(trimmed) == 10 && trimmed[4] == '-' && trimmed[7] == '-' {
			if _, err := time.Parse("2006-01-02", trimmed); err == nil {
				return trimmed, true
			}
		}
		for _, layout := range dateLayouts {
			if parsed, err := time.Parse(layout, trimmed); err == nil {
				return parsed.Format("2006-01-02"), true
			}
		}
		return value, false
	case SheetColumnTypeBoolean:
		switch strings.ToUpper(trimmed) {
		case "TRUE", "1", "YES", "Y", "ON", "✓", "✔", "X":
			return "TRUE", true
		case "FALSE", "0", "NO", "N", "OFF":
			return "FALSE", true
		default:
			return value, false
		}
	case SheetColumnTypeSelect:
		return trimmed, true
	}
	return value, true
}

// NormalizeTypedCell coerces a cell to the column type. Formulas and empty
// values are left alone. A value that does not fit the type is kept as typed
// (the apps flag it) rather than erased, so nothing a person enters is lost.
func NormalizeTypedCell(colType, value string) string {
	next, _ := ParseTypedCell(colType, value)
	return next
}

// NormalizeSheetCells rewrites every cell according to its column type. Select
// cells take the spelling of the matching option; a value that is not an
// option yet is appended to the column's options so the dropdown stays
// truthful.
func NormalizeSheetCells(columns SheetColumns, rows SheetRows) {
	types := make(map[string]string, len(columns))
	selectIndex := make(map[string]int, len(columns))
	for i, column := range columns {
		types[column.ID] = column.Type
		if column.Type == SheetColumnTypeSelect {
			selectIndex[column.ID] = i
		}
	}
	for i := range rows {
		if rows[i].Cells == nil {
			continue
		}
		for colID, value := range rows[i].Cells {
			next := NormalizeTypedCell(types[colID], value)
			if idx, ok := selectIndex[colID]; ok && next != "" && !strings.HasPrefix(next, "=") {
				matched, found := MatchSelectOption(columns[idx].Options, next)
				if found {
					next = matched
				} else if len(columns[idx].Options) < MaxSheetSelectOptions {
					next = truncateUTF8Bytes(next, MaxSheetSelectOptionLength)
					columns[idx].Options = append(columns[idx].Options, next)
				}
			}
			rows[i].Cells[colID] = next
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
	tab.Color = normalizeHexColor(tab.Color)
	tab.FrozenRows = clampInt(tab.FrozenRows, 0, min(maxFrozenRows, len(tab.Rows)))
	tab.FrozenCols = clampInt(tab.FrozenCols, 0, min(maxFrozenCols, len(tab.Columns)))
	tab.ConditionalFormats = NormalizeConditionalFormats(tab.ConditionalFormats, tab.Columns)
	return tab, nil
}

func clampInt(value, low, high int) int {
	if high < low {
		high = low
	}
	return max(low, min(high, value))
}

// NormalizeConditionalFormats drops rules for unknown columns or operators
// and caps their number and text.
func NormalizeConditionalFormats(rules []SheetConditionalFormat, columns SheetColumns) []SheetConditionalFormat {
	if len(rules) == 0 {
		return nil
	}
	known := make(map[string]bool, len(columns))
	for _, column := range columns {
		known[column.ID] = true
	}
	operators := make(map[string]bool, len(SheetConditionOperators))
	for _, operator := range SheetConditionOperators {
		operators[operator] = true
	}
	out := make([]SheetConditionalFormat, 0, len(rules))
	for _, rule := range rules {
		if !known[rule.ColumnID] || !operators[rule.Operator] {
			continue
		}
		if rule.ID == "" {
			rule.ID = utils.PrefixedUUID("cf")
		}
		rule.Value = truncateUTF8Bytes(strings.TrimSpace(rule.Value), 200)
		rule.Value2 = truncateUTF8Bytes(strings.TrimSpace(rule.Value2), 200)
		rule.FillColor = normalizeHexColor(rule.FillColor)
		rule.TextColor = normalizeHexColor(rule.TextColor)
		out = append(out, rule)
		if len(out) >= maxConditionalFormats {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeColumnFormat(format *SheetColumnFormat) *SheetColumnFormat {
	if format == nil {
		return nil
	}
	next := SheetColumnFormat{
		Currency: truncateUTF8Bytes(strings.TrimSpace(format.Currency), 8),
	}
	for _, allowed := range SheetDateFormats {
		if format.DateFormat == allowed {
			next.DateFormat = allowed
		}
	}
	if format.Decimals != nil {
		decimals := clampInt(*format.Decimals, 0, 8)
		next.Decimals = &decimals
	}
	if next.Currency == "" && next.DateFormat == "" && next.Decimals == nil {
		return nil
	}
	return &next
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
		if kind == SheetColumnTypeSelect {
			columns[i].Options = NormalizeSelectOptions(columns[i].Options)
		} else {
			columns[i].Options = nil
		}
		columns[i].Format = normalizeColumnFormat(columns[i].Format)
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
		out[i] = CloneTab(tab)
	}
	return out
}

func CloneTab(tab SheetTab) SheetTab {
	columns, rows := CloneGrid(tab.Columns, tab.Rows)
	return withTabSettings(SheetTab{
		ID:      utils.PrefixedUUID("tab"),
		Name:    tab.Name,
		Columns: columns,
		Rows:    rows,
		Merges:  CloneMerges(tab.Merges),
	}, tab)
}

func tabHasSettings(tab SheetTab) bool {
	return tab.Color != "" || tab.FrozenRows > 0 || tab.FrozenCols > 0 || len(tab.ConditionalFormats) > 0
}

// withTabSettings copies src's color, frozen panes and rules onto tab. Rules
// follow their column by position, so a clone with fresh column ids keeps them.
func withTabSettings(tab SheetTab, src SheetTab) SheetTab {
	tab.Color = src.Color
	tab.FrozenRows = src.FrozenRows
	tab.FrozenCols = src.FrozenCols
	if len(src.ConditionalFormats) == 0 {
		return tab
	}
	idMap := make(map[string]string, len(src.Columns))
	for i, column := range src.Columns {
		if i < len(tab.Columns) {
			idMap[column.ID] = tab.Columns[i].ID
		}
	}
	tab.ConditionalFormats = make([]SheetConditionalFormat, 0, len(src.ConditionalFormats))
	for _, rule := range src.ConditionalFormats {
		if next, ok := idMap[rule.ColumnID]; ok {
			rule.ColumnID = next
			tab.ConditionalFormats = append(tab.ConditionalFormats, rule)
		}
	}
	return tab
}

// CloneSheetContents copies grid data with new ids so a duplicate is independent.
func CloneSheetContents(src *Sheet) (SheetColumns, SheetRows, SheetMerges, SheetTabs) {
	if src == nil {
		return nil, nil, nil, nil
	}
	columns, rows := CloneGrid(src.Columns, src.Rows)
	return columns, rows, CloneMerges(src.Merges), CloneTabs(src.Tabs)
}

// SheetTemplate is a reusable snapshot of a workbook: formulas, values, formats,
// merges, and tabs. Applying it always clones ids so instances stay independent.
type SheetTemplate struct {
	ID     string  `gorm:"type:text;primaryKey" json:"id"`
	UserID string  `gorm:"type:text;not null" json:"userId"`
	Name   string  `gorm:"not null" json:"name"`
	Icon   *string `gorm:"type:text" json:"icon"`

	Columns SheetColumns `gorm:"type:jsonb;not null;default:'[]'" json:"columns"`
	Rows    SheetRows    `gorm:"type:jsonb;not null;default:'[]'" json:"rows"`
	Merges  SheetMerges  `gorm:"type:jsonb;not null;default:'[]'" json:"merges"`
	Tabs    SheetTabs    `gorm:"type:jsonb;not null;default:'[]'" json:"tabs"`

	SourceSheetID *string `gorm:"type:text" json:"sourceSheetId"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (SheetTemplate) TableName() string { return "sheet_templates" }

func (t *SheetTemplate) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if t.CreatedAt == "" {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	return nil
}

func (t *SheetTemplate) BeforeUpdate(tx *gorm.DB) error {
	t.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}

func CopyGrid(columns SheetColumns, rows SheetRows) (SheetColumns, SheetRows) {
	nextColumns := append(SheetColumns{}, columns...)
	nextRows := make(SheetRows, len(rows))
	for i, row := range rows {
		cells := make(map[string]string, len(row.Cells))
		for key, value := range row.Cells {
			cells[key] = value
		}
		var formats map[string]SheetCellFormat
		if len(row.Formats) > 0 {
			formats = make(map[string]SheetCellFormat, len(row.Formats))
			for key, format := range row.Formats {
				formats[key] = format
			}
		}
		nextRows[i] = SheetRow{ID: row.ID, Cells: cells, Formats: formats}
	}
	return nextColumns, nextRows
}

func SnapshotSheet(src *Sheet, tabID string) (SheetColumns, SheetRows, SheetMerges, SheetTabs, error) {
	if src == nil {
		return nil, nil, nil, nil, errors.New("sheet not found")
	}
	if tabID != "" {
		for _, tab := range src.Tabs {
			if tab.ID == tabID {
				columns, rows := CopyGrid(tab.Columns, tab.Rows)
				if !tabHasSettings(tab) {
					return columns, rows, CloneMerges(tab.Merges), SheetTabs{}, nil
				}
				// Keep frozen panes and rules by saving the tab itself.
				single := withTabSettings(SheetTab{ID: tab.ID, Name: tab.Name, Columns: columns, Rows: rows, Merges: CloneMerges(tab.Merges)}, tab)
				return columns, rows, CloneMerges(tab.Merges), SheetTabs{single}, nil
			}
		}
		if len(src.Tabs) == 0 && tabID != "" {
			columns, rows := CopyGrid(src.Columns, src.Rows)
			return columns, rows, CloneMerges(src.Merges), SheetTabs{}, nil
		}
		return nil, nil, nil, nil, errors.New("tab not found")
	}
	columns, rows := CopyGrid(src.Columns, src.Rows)
	tabs := make(SheetTabs, len(src.Tabs))
	for i, tab := range src.Tabs {
		tabColumns, tabRows := CopyGrid(tab.Columns, tab.Rows)
		tabs[i] = withTabSettings(SheetTab{
			ID:      tab.ID,
			Name:    tab.Name,
			Columns: tabColumns,
			Rows:    tabRows,
			Merges:  CloneMerges(tab.Merges),
		}, tab)
	}
	return columns, rows, CloneMerges(src.Merges), tabs, nil
}

func CloneTemplateContents(src *SheetTemplate) (SheetColumns, SheetRows, SheetMerges, SheetTabs) {
	if src == nil {
		return nil, nil, nil, nil
	}
	columns, rows := CloneGrid(src.Columns, src.Rows)
	return columns, rows, CloneMerges(src.Merges), CloneTabs(src.Tabs)
}

func TabFromTemplate(src *SheetTemplate, tabID string) (SheetTab, error) {
	if src == nil {
		return SheetTab{}, errors.New("template not found")
	}
	if tabID != "" {
		for _, tab := range src.Tabs {
			if tab.ID == tabID {
				return CloneTab(tab), nil
			}
		}
		return SheetTab{}, errors.New("tab not found")
	}
	if len(src.Tabs) > 0 {
		return CloneTab(src.Tabs[0]), nil
	}
	columns, rows := CloneGrid(src.Columns, src.Rows)
	name := strings.TrimSpace(src.Name)
	if name == "" {
		name = "Sheet 1"
	}
	return SheetTab{
		ID:      utils.PrefixedUUID("tab"),
		Name:    name,
		Columns: columns,
		Rows:    rows,
		Merges:  CloneMerges(src.Merges),
	}, nil
}
