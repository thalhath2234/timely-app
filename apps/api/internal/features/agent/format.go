package agent

import (
	"fmt"
	"strings"
	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
	"timely-api/internal/utils"
)

type recIn struct {
	RRule    string `json:"rrule"`
	Dtstart  string `json:"dtstart,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

func (r recIn) model() *models.RecurrenceInput {
	if strings.TrimSpace(r.RRule) == "" {
		return nil
	}
	return &models.RecurrenceInput{RRule: r.RRule, Dtstart: r.Dtstart, Timezone: r.Timezone}
}

type cfValueIn struct {
	CustomFieldID string   `json:"customFieldId"`
	Type          string   `json:"type,omitempty"`
	StringValue   string   `json:"stringValue,omitempty"`
	OptionIDs     []string `json:"optionIds,omitempty"`
}

func cfValues(in []cfValueIn) []*models.CustomFieldValue {
	if len(in) == 0 {
		return nil
	}
	out := make([]*models.CustomFieldValue, 0, len(in))
	for _, item := range in {
		value := &models.CustomFieldValue{
			CustomFieldID: item.CustomFieldID,
			Type:          item.Type,
		}
		if item.StringValue != "" {
			value.StringValue = strPtr(item.StringValue)
		}
		for _, id := range item.OptionIDs {
			if id != "" {
				value.OptionsValue = append(value.OptionsValue, models.CustomFieldValueInput{Id: id})
			}
		}
		out = append(out, value)
	}
	return out
}

func labelInputs(ids []string) models.LabelInputs {
	out := make(models.LabelInputs, 0, len(ids))
	for _, id := range ids {
		if id != "" {
			out = append(out, models.LabelInput{Id: id})
		}
	}
	return out
}

func taskPayload(t *models.Task) map[string]any {
	if t == nil {
		return nil
	}
	return map[string]any{
		"task":     t,
		"markdown": richtext.ToMarkdown(t.DescriptionRich),
	}
}

func docPayload(d *models.Document) map[string]any {
	if d == nil {
		return nil
	}
	content, kept := shortenBlocks(d.ID, d.Content)
	payload := map[string]any{
		"id":          d.ID,
		"title":       d.Title,
		"icon":        d.Icon,
		"parentId":    d.ParentID,
		"workspaceId": d.WorkspaceID,
		"projectId":   d.ProjectID,
		"isFavorite":  d.IsFavorite,
		"archivedAt":  d.ArchivedAt,
		"order":       d.Order,
		"markdown":    richtext.ToMarkdown(content),
		"plainText":   d.PlainText,
		"createdAt":   d.CreatedAt,
		"updatedAt":   d.UpdatedAt,
	}
	if kept > 0 {
		// The search copy holds the same big blocks in full.
		delete(payload, "plainText")
		payload["keptBlocks"] = fmt.Sprintf("%d big data block(s) are shown as a [kept ...] line. Leave that line inside its fence to keep the block as is (moving the fence moves the block); delete the fence to remove it, or write a new block in its place to replace it", kept)
	}
	return payload
}

// sheetMarkdown shows every tab as a table with its id, A1 column letters and
// row numbers, so formulas and tabId can be written from it. Rows without an
// entry are left out; the row numbers keep their place.
func sheetMarkdown(sh *models.Sheet) string {
	if sh == nil {
		return ""
	}
	tabs := sh.Tabs
	if len(tabs) == 0 {
		if len(sh.Columns) == 0 {
			return ""
		}
		return gridMarkdown(sh.Columns, sh.Rows)
	}
	var b strings.Builder
	for _, tab := range tabs {
		if len(tab.Columns) == 0 {
			continue
		}
		fmt.Fprintf(&b, "## %s (tabId %s)\n", tab.Name, tab.ID)
		if tab.FrozenRows > 0 || tab.FrozenCols > 0 {
			fmt.Fprintf(&b, "Frozen rows: %d, columns: %d.\n", tab.FrozenRows, tab.FrozenCols)
		}
		if n := len(tab.ConditionalFormats); n > 0 {
			fmt.Fprintf(&b, "%d colour rules.\n", n)
		}
		b.WriteString("\n")
		b.WriteString(gridMarkdown(tab.Columns, tab.Rows))
		b.WriteString("\n\n")
	}
	return strings.TrimSpace(b.String())
}

func gridMarkdown(columns models.SheetColumns, rows models.SheetRows) string {
	var b strings.Builder
	heads := make([]string, len(columns))
	seps := make([]string, len(columns))
	for i, col := range columns {
		head := columnLetters(i) + " " + col.Name
		if col.Hidden {
			head += " (hidden)"
		}
		heads[i] = strings.ReplaceAll(head, "|", "\\|")
		seps[i] = "---"
	}
	b.WriteString("| # | ")
	b.WriteString(strings.Join(heads, " | "))
	b.WriteString(" |\n| --- | ")
	b.WriteString(strings.Join(seps, " | "))
	b.WriteString(" |\n")
	blank := 0
	for r, row := range rows {
		if sheet.EmptyEntryRow(row.Cells, r+1) {
			blank++
			continue
		}
		cells := make([]string, len(columns))
		for i, col := range columns {
			cells[i] = strings.ReplaceAll(strings.ReplaceAll(row.Cells[col.ID], "|", "\\|"), "\n", " ")
		}
		fmt.Fprintf(&b, "| %d | %s |\n", r+1, strings.Join(cells, " | "))
	}
	if blank > 0 {
		fmt.Fprintf(&b, "\n%d empty rows not shown (blank, or only formulas reading their own row, which add_sheet_row fills).", blank)
	}
	return strings.TrimSpace(b.String())
}

// columnLetters turns a zero-based index into spreadsheet letters (0 → A).
func columnLetters(index int) string {
	letters := ""
	for index >= 0 {
		letters = string(rune('A'+index%26)) + letters
		index = index/26 - 1
	}
	return letters
}

func confirmOrFail(confirm bool, action string) error {
	if confirm {
		return nil
	}
	return fmt.Errorf("set confirm=true to %s", action)
}

func viewID() string {
	return utils.PrefixedUUID("view")
}
