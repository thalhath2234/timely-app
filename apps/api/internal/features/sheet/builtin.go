package sheet

import (
	"embed"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// The built-in templates are built in packages/contract/src/sheetTemplates.ts
// and written here by `make gen-sheet-builtins`, so the apps and the API make
// the same workbook.
//
//go:embed builtin/*.json
var builtinFiles embed.FS

// BuiltinTemplate is a ready-made workbook that ships with Timely.
type BuiltinTemplate struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Icon        string           `json:"icon"`
	Title       string           `json:"title"`
	Tabs        models.SheetTabs `json:"tabs,omitempty"`
}

// IsBuiltinTemplate reports whether id names a built-in template ("builtin:…").
func IsBuiltinTemplate(id string) bool {
	return strings.HasPrefix(id, "builtin:")
}

// BuiltinTemplates lists the built-in templates without their tabs.
func BuiltinTemplates() ([]BuiltinTemplate, error) {
	entries, err := builtinFiles.ReadDir("builtin")
	if err != nil {
		return nil, err
	}
	out := make([]BuiltinTemplate, 0, len(entries))
	for _, entry := range entries {
		template, err := readBuiltin(entry.Name())
		if err != nil {
			return nil, err
		}
		template.Tabs = nil
		out = append(out, template)
	}
	return out, nil
}

func readBuiltin(file string) (BuiltinTemplate, error) {
	var template BuiltinTemplate
	data, err := builtinFiles.ReadFile("builtin/" + file)
	if err != nil {
		return template, err
	}
	err = json.Unmarshal(data, &template)
	return template, err
}

// BuildBuiltin returns a new sheet from a built-in template for year, with
// currency (an ISO code such as LKR, or a symbol) on its money columns and
// fresh ids throughout. The caller sets the owner and saves it.
func BuildBuiltin(id string, year int, currency string) (*models.Sheet, error) {
	template, err := readBuiltin(strings.TrimPrefix(id, "builtin:") + ".json")
	if err != nil || template.ID != id {
		return nil, errors.New("unknown built-in template: " + id)
	}
	currency = strings.TrimSpace(currency)
	tabs := make(models.SheetTabs, len(template.Tabs))
	for i, tab := range template.Tabs {
		tabs[i] = freshTab(tab, currency)
	}
	sheet := &models.Sheet{
		Title: strings.ReplaceAll(template.Title, "{year}", strconv.Itoa(year)),
		Icon:  &template.Icon,
		Tabs:  tabs,
	}
	if len(tabs) > 0 {
		sheet.Columns, sheet.Rows, sheet.Merges = tabs[0].Columns, tabs[0].Rows, tabs[0].Merges
	}
	return sheet, nil
}

func freshTab(tab models.SheetTab, currency string) models.SheetTab {
	ids := map[string]string{}
	columns := make(models.SheetColumns, len(tab.Columns))
	for i, column := range tab.Columns {
		ids[column.ID] = utils.PrefixedUUID("col")
		column.ID = ids[column.ID]
		if column.Format != nil {
			format := *column.Format
			column.Format = &format
		}
		if currency != "" && column.Type == models.SheetColumnTypeCurrency {
			if column.Format == nil {
				column.Format = &models.SheetColumnFormat{}
			}
			column.Format.Currency = currency
		}
		columns[i] = column
	}
	rows := make(models.SheetRows, len(tab.Rows))
	for i, row := range tab.Rows {
		cells := make(map[string]string, len(columns))
		for _, column := range columns {
			cells[column.ID] = ""
		}
		for key, value := range row.Cells {
			cells[ids[key]] = value
		}
		next := models.SheetRow{ID: utils.PrefixedUUID("row"), Cells: cells}
		if len(row.Formats) > 0 {
			next.Formats = make(map[string]models.SheetCellFormat, len(row.Formats))
			for key, format := range row.Formats {
				next.Formats[ids[key]] = format
			}
		}
		rows[i] = next
	}
	rules := make([]models.SheetConditionalFormat, len(tab.ConditionalFormats))
	for i, rule := range tab.ConditionalFormats {
		rule.ID = utils.PrefixedUUID("cf")
		rule.ColumnID = ids[rule.ColumnID]
		rules[i] = rule
	}
	tab.ID = utils.PrefixedUUID("tab")
	tab.Columns = columns
	tab.Rows = rows
	tab.Merges = append(models.SheetMerges{}, tab.Merges...)
	tab.ConditionalFormats = rules
	return tab
}
