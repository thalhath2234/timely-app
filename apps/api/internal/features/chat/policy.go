package chat

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// An allowlist, not a name-based denylist: new Hermes tools do not silently gain
// in-app authority. Every mutation passes through proposal validation.
var readTools = names(`get_context search semantic_search get_agenda get_free_time what_next list_workspaces get_workspace list_projects get_project list_tasks get_task list_inbox get_today list_events get_event get_calendar get_working_hours get_capacity get_schedule_settings auto_schedule_preview list_docs get_doc list_sheets get_sheet list_sheet_templates get_sheet_template list_notifications unread_notification_count get_notification_settings undo_schedule_preview`)
var writeTools = names(`create_workspace rename_workspace create_status update_status create_label update_label create_custom_field update_custom_field create_project update_project complete_project reopen_project create_stage update_stage reorder_stages create_task update_task bulk_update_tasks complete_task reopen_task move_task_to_status move_task_to_stage set_task_labels set_task_custom_field set_task_dependency add_task_comment set_task_recurrence clear_task_recurrence edit_task_occurrence split_task_series capture_inbox_item clarify_inbox_item add_checklist_item update_checklist_item toggle_checklist_item create_event update_event edit_event_occurrence split_event_series auto_schedule_apply schedule_task pin_task pin_block move_block create_doc update_doc append_to_doc create_sheet_template update_sheet_template create_sheet update_sheet add_sheet_column update_sheet_column delete_sheet_column add_sheet_rows delete_sheet_rows update_sheet_cells add_sheet_tab rename_sheet_tab delete_sheet_tab
	update_working_hours delete_task delete_event delete_doc delete_sheet delete_label delete_stage delete_checklist_item delete_block clear_task_blocks
	mark_notification_read start_focus pause_focus stop_focus set_today_focus snooze_reminder undo_schedule update_notification_settings`)

// Settings and calendar-wide changes always need review, like deletions.
var reviewedTools = names(`update_working_hours update_notification_settings undo_schedule clear_task_blocks`)

func names(s string) map[string]bool {
	out := map[string]bool{}
	for _, n := range strings.Fields(s) {
		out[n] = true
	}
	return out
}

func needsApproval(steps []Step, direct bool) bool {
	if !direct || len(steps) != 1 {
		return true
	}
	s := steps[0]
	var args map[string]any
	_ = json.Unmarshal(s.Arguments, &args)
	switch s.Tool {
	case "update_sheet_cells":
		cells, _ := args["cells"].(map[string]any)
		return len(cells) != 1
	case "update_sheet":
		for _, k := range []string{"rows", "columns", "tabs", "merges"} {
			if _, ok := args[k]; ok {
				return true
			}
		}
	case "update_sheet_column":
		if _, ok := args["type"]; ok {
			return true
		}
	case "create_sheet":
		if args["templateId"] != nil && args["templateId"] != "" {
			return true
		}
	case "update_doc":
		if _, ok := args["markdown"]; ok {
			return true
		}
	case "update_task", "update_event":
		for _, k := range []string{"recurrence", "clearRecurrence"} {
			if _, ok := args[k]; ok {
				return true
			}
		}
	case "mark_notification_read":
		// An empty id marks every unread notification.
		id, _ := args["id"].(string)
		return id == ""
	}
	if reviewedTools[s.Tool] {
		return true
	}
	return strings.Contains(s.Tool, "recurrence") || strings.Contains(s.Tool, "occurrence") || strings.Contains(s.Tool, "series") || strings.HasPrefix(s.Tool, "delete_") || strings.HasPrefix(s.Tool, "bulk_") || s.Tool == "auto_schedule_apply" || s.Tool == "add_sheet_rows"
}

// $0.id (or $0.task.id) references a prior step's actual result, never an ID
// invented by the model. Resolve structured values without string substitution.
func resolve(value any, steps []Step, index int) (any, error) {
	switch v := value.(type) {
	case string:
		if !strings.HasPrefix(v, "$") {
			return v, nil
		}
		parts := strings.Split(v[1:], ".")
		if len(parts) < 2 {
			return v, nil
		}
		n, err := strconv.Atoi(parts[0])
		if err != nil {
			return v, nil
		}
		if n < 0 || n >= index || steps[n].Status != "done" {
			return nil, fmt.Errorf("reference %s must target a completed earlier step", v)
		}
		var out any
		if err = json.Unmarshal(steps[n].Result, &out); err != nil {
			return nil, err
		}
		for _, p := range parts[1:] {
			switch x := out.(type) {
			case map[string]any:
				out = x[p]
			case []any:
				j, e := strconv.Atoi(p)
				if e != nil || j < 0 || j >= len(x) {
					return nil, fmt.Errorf("invalid reference %s", v)
				}
				out = x[j]
			default:
				return nil, fmt.Errorf("invalid reference %s", v)
			}
		}
		if out == nil {
			return nil, fmt.Errorf("missing reference %s", v)
		}
		return out, nil
	case map[string]any:
		out := map[string]any{}
		for k, x := range v {
			r, e := resolve(x, steps, index)
			if e != nil {
				return nil, e
			}
			out[k] = r
		}
		return out, nil
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			r, e := resolve(x, steps, index)
			if e != nil {
				return nil, e
			}
			out[i] = r
		}
		return out, nil
	default:
		return v, nil
	}
}
