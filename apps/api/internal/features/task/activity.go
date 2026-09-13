package task

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

func newActivity(userID, actorName, taskID, action, field, message, oldValue, newValue string) models.TaskActivity {
	entry := models.TaskActivity{
		ID:        utils.NewActivityID(),
		TaskID:    taskID,
		UserID:    userID,
		ActorName: actorName,
		Action:    action,
		Message:   message,
		CreatedAt: utils.GetCurrentTimestamp(),
	}
	if field != "" {
		entry.Field = &field
	}
	if oldValue != "" {
		entry.OldValue = &oldValue
	}
	if newValue != "" {
		entry.NewValue = &newValue
	}
	return entry
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func displayValue(value string) string {
	if strings.TrimSpace(value) == "" {
		return "None"
	}
	return prettyDate(value)
}

func prettyDate(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "None"
	}
	if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return parsed.Local().Format("Jan 2, 2006 3:04 PM")
	}
	if parsed, err := time.Parse("2006-01-02", trimmed); err == nil {
		return parsed.Format("Jan 2, 2006")
	}
	return trimmed
}

func relationName(entity *string, fallback string) string {
	if fallback != "" {
		return fallback
	}
	if entity == nil || *entity == "" {
		return "None"
	}
	return *entity
}

func labelNames(task *models.Task) string {
	if task == nil || len(task.Labels) == 0 {
		if task != nil && len(task.LabelIDs) > 0 {
			ids := make([]string, 0, len(task.LabelIDs))
			for _, label := range task.LabelIDs {
				if label.Id != "" {
					ids = append(ids, label.Id)
				}
			}
			sort.Strings(ids)
			if len(ids) == 0 {
				return "None"
			}
			return strings.Join(ids, ", ")
		}
		return "None"
	}

	names := make([]string, 0, len(task.Labels))
	for _, label := range task.Labels {
		if label != nil && label.Name != "" {
			names = append(names, label.Name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "None"
	}
	return strings.Join(names, ", ")
}

func customFieldText(value *models.CustomFieldValue) string {
	if len(value.OptionValue) > 0 {
		names := make([]string, 0, len(value.OptionValue))
		for _, option := range value.OptionValue {
			names = append(names, option.Value)
		}
		return strings.Join(names, ", ")
	}
	if value.StringValue != nil && strings.TrimSpace(*value.StringValue) != "" {
		return *value.StringValue
	}
	return "None"
}

// customFieldTexts maps a custom field id to its displayed value and its name,
// so an update can be diffed field by field.
func customFieldTexts(task *models.Task) (map[string]string, map[string]string) {
	texts := make(map[string]string, len(task.CustomFieldValues))
	names := make(map[string]string, len(task.CustomFieldValues))

	for _, value := range task.CustomFieldValues {
		if value == nil {
			continue
		}
		texts[value.CustomFieldID] = customFieldText(value)
		if value.Name != "" {
			names[value.CustomFieldID] = value.Name
		}
	}

	return texts, names
}

func richEqual(a, b models.JSONMap) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	left, err1 := json.Marshal(a)
	right, err2 := json.Marshal(b)
	if err1 != nil || err2 != nil {
		return false
	}
	return bytes.Equal(left, right)
}

func labelKey(task *models.Task) string {
	ids := make([]string, 0, len(task.LabelIDs))
	for _, label := range task.LabelIDs {
		if label.Id != "" {
			ids = append(ids, label.Id)
		}
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

func collectTaskActivity(userID, actorName string, before, after *models.Task, touched map[string]bool) []models.TaskActivity {
	if before == nil || after == nil {
		return nil
	}

	var entries []models.TaskActivity
	add := func(field, message, oldValue, newValue string) {
		entries = append(entries, newActivity(userID, actorName, after.ID, "updated", field, message, oldValue, newValue))
	}

	if touched["name"] && before.Name != after.Name {
		add("name", fmt.Sprintf("changed the title from %q to %q", before.Name, after.Name), before.Name, after.Name)
	}

	if (touched["description"] || touched["description_rich"]) &&
		(before.Description != after.Description || !richEqual(before.DescriptionRich, after.DescriptionRich)) {
		add("description", "updated the description", "", "")
	}

	if touched["duration"] && before.Duration != after.Duration {
		add(
			"duration",
			fmt.Sprintf("changed duration from %d to %d min", before.Duration, after.Duration),
			fmt.Sprintf("%d", before.Duration),
			fmt.Sprintf("%d", after.Duration),
		)
	}

	if touched["deadline"] && deref(before.Deadline) != deref(after.Deadline) {
		oldValue, newValue := displayValue(deref(before.Deadline)), displayValue(deref(after.Deadline))
		add("deadline", fmt.Sprintf("changed the deadline from %s to %s", oldValue, newValue), oldValue, newValue)
	}

	if touched["start_date"] && deref(before.StartDate) != deref(after.StartDate) {
		oldValue, newValue := displayValue(deref(before.StartDate)), displayValue(deref(after.StartDate))
		add("startDate", fmt.Sprintf("changed the start date from %s to %s", oldValue, newValue), oldValue, newValue)
	}

	if touched["scheduled_on"] && deref(before.ScheduledOn) != deref(after.ScheduledOn) {
		if after.ScheduledOn == nil || *after.ScheduledOn == "" {
			add("scheduledOn", "removed this task from the calendar", prettyDate(deref(before.ScheduledOn)), "")
		} else {
			add("scheduledOn", fmt.Sprintf("scheduled this task for %s", prettyDate(*after.ScheduledOn)), prettyDate(deref(before.ScheduledOn)), prettyDate(*after.ScheduledOn))
		}
	}

	if touched["completed_at"] && deref(before.CompletedAt) != deref(after.CompletedAt) {
		if after.CompletedAt == nil || *after.CompletedAt == "" {
			add("completedAt", "reopened this task", prettyDate(deref(before.CompletedAt)), "")
		} else {
			add("completedAt", "marked this task complete", "", prettyDate(*after.CompletedAt))
		}
	}

	if touched["priority_level"] && deref(before.PriorityLevel) != deref(after.PriorityLevel) {
		oldValue, newValue := displayValue(deref(before.PriorityLevel)), displayValue(deref(after.PriorityLevel))
		add("priorityLevel", fmt.Sprintf("changed priority from %s to %s", oldValue, newValue), oldValue, newValue)
	}

	if touched["status_id"] && deref(before.StatusID) != deref(after.StatusID) {
		oldName := relationName(before.StatusID, "")
		if before.Status != nil {
			oldName = before.Status.Name
		}
		newName := relationName(after.StatusID, "")
		if after.Status != nil {
			newName = after.Status.Name
		}
		add("status", fmt.Sprintf("changed status from %s to %s", displayValue(oldName), displayValue(newName)), oldName, newName)
	}

	if touched["project_id"] && deref(before.ProjectID) != deref(after.ProjectID) {
		oldName := "None"
		if before.Project != nil && before.Project.Title != "" {
			oldName = before.Project.Title
		}
		newName := "None"
		if after.Project != nil && after.Project.Title != "" {
			newName = after.Project.Title
		}
		add("project", fmt.Sprintf("moved this task from %s to %s", oldName, newName), oldName, newName)
	}

	if touched["stage_id"] && deref(before.StageID) != deref(after.StageID) {
		oldName := "None"
		if before.Stage != nil && before.Stage.Name != "" {
			oldName = before.Stage.Name
		}
		newName := "None"
		if after.Stage != nil && after.Stage.Name != "" {
			newName = after.Stage.Name
		}
		add("stage", fmt.Sprintf("changed stage from %s to %s", oldName, newName), oldName, newName)
	}

	if touched["blocked_by_id"] && deref(before.BlockedByID) != deref(after.BlockedByID) {
		oldName := "None"
		if before.BlockedBy != nil && before.BlockedBy.Name != "" {
			oldName = before.BlockedBy.Name
		}
		newName := "None"
		if after.BlockedBy != nil && after.BlockedBy.Name != "" {
			newName = after.BlockedBy.Name
		}
		add("blockedBy", fmt.Sprintf("changed blocked by from %s to %s", oldName, newName), oldName, newName)
	}

	if touched["label_ids"] && labelKey(before) != labelKey(after) {
		oldValue, newValue := labelNames(before), labelNames(after)
		add("labels", fmt.Sprintf("updated labels from %s to %s", oldValue, newValue), oldValue, newValue)
	}

	if touched["custom_field_values"] {
		beforeTexts, beforeNames := customFieldTexts(before)
		afterTexts, afterNames := customFieldTexts(after)

		fieldIDs := make([]string, 0, len(beforeTexts)+len(afterTexts))
		for id := range beforeTexts {
			fieldIDs = append(fieldIDs, id)
		}
		for id := range afterTexts {
			if _, ok := beforeTexts[id]; !ok {
				fieldIDs = append(fieldIDs, id)
			}
		}
		sort.Strings(fieldIDs)

		for _, id := range fieldIDs {
			oldValue, newValue := beforeTexts[id], afterTexts[id]
			if oldValue == "" {
				oldValue = "None"
			}
			if newValue == "" {
				newValue = "None"
			}
			if oldValue == newValue {
				continue
			}

			name := afterNames[id]
			if name == "" {
				name = beforeNames[id]
			}
			if name == "" {
				name = "custom field"
			}

			add(
				"customField",
				fmt.Sprintf("changed %s from %s to %s", name, oldValue, newValue),
				oldValue,
				newValue,
			)
		}
	}

	return entries
}
