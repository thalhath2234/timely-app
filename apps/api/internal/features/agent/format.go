package agent

import (
	"fmt"
	"strings"
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

func sheetMarkdown(sh *models.Sheet) string {
	if sh == nil {
		return ""
	}
	if len(sh.Columns) == 0 {
		return ""
	}
	var b strings.Builder
	heads := make([]string, len(sh.Columns))
	seps := make([]string, len(sh.Columns))
	for i, col := range sh.Columns {
		heads[i] = strings.ReplaceAll(col.Name, "|", "\\|")
		seps[i] = "---"
	}
	b.WriteString("| ")
	b.WriteString(strings.Join(heads, " | "))
	b.WriteString(" |\n| ")
	b.WriteString(strings.Join(seps, " | "))
	b.WriteString(" |\n")
	for _, row := range sh.Rows {
		cells := make([]string, len(sh.Columns))
		for i, col := range sh.Columns {
			cells[i] = strings.ReplaceAll(row.Cells[col.ID], "|", "\\|")
		}
		b.WriteString("| ")
		b.WriteString(strings.Join(cells, " | "))
		b.WriteString(" |\n")
	}
	return strings.TrimSpace(b.String())
}

func sheetPayload(sh *models.Sheet) map[string]any {
	if sh == nil {
		return nil
	}
	return map[string]any{
		"sheet":    sh,
		"markdown": sheetMarkdown(sh),
	}
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
