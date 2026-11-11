package agent

import (
	"encoding/json"
	"strconv"
	"strings"
)

// Undo for changes Auto applied without asking (plan 5.5b). A change may
// apply unasked only when Go can put the data back: a create is undone by
// removing what it created, through the owning service's own tool; an update
// by writing back the fields it changed, as the review's "before" read them;
// a move or a placement by putting the old placement back. Where no inverse
// is safe, Inverse says so and Auto holds the proposal for Approve instead.
//
// Inverses address objects by id only. Anything found by position (sheet
// rows by number) or that would also remove what the person added since
// (a project's tasks) has no inverse.

// InverseStep is one call of the undo plan. Tool may be an MCP-only delete
// (see UndoTool): an undo removes only what its own change created.
type InverseStep struct {
	Tool      string          `json:"tool"`
	Summary   string          `json:"summary"`
	Arguments json.RawMessage `json:"arguments"`
}

// AppliedStep is one applied step of a proposal: its arguments as proposed
// (they may hold $n references to earlier results), its result and the
// "before" the review read.
type AppliedStep struct {
	Tool      string
	Arguments json.RawMessage
	Result    json.RawMessage
	Before    json.RawMessage
}

// undoCall is one step's arguments, result and before, decoded.
type undoCall struct {
	args   map[string]any
	result any
	before any
}

// inverse builds the undo of one Write tool.
type inverse struct {
	// possible says, before the step runs, whether its undo can be built
	// from these arguments and this "before" (nil: always).
	possible func(args map[string]any, before any) bool
	build    func(c undoCall) ([]InverseStep, bool)
}

// Undoable reports, before a step runs, whether Undo will be able to
// reverse it. A proposal with a step that is not undoable is held in Auto.
func Undoable(tool string, args, before json.RawMessage) bool {
	inv, ok := inverses[tool]
	if !ok {
		return false
	}
	var a map[string]any
	if json.Unmarshal(args, &a) != nil || a == nil {
		return false
	}
	if inv.possible == nil {
		return true
	}
	return inv.possible(a, decode(before))
}

// Inverse is the undo of one applied step: the calls that restore what it
// changed, in order. ok is false when no safe inverse exists. An empty list
// with ok means the step changed nothing that needs undoing.
func Inverse(tool string, args, result, before json.RawMessage) ([]InverseStep, bool) {
	inv, ok := inverses[tool]
	if !ok {
		return nil, false
	}
	var a map[string]any
	if json.Unmarshal(args, &a) != nil || a == nil {
		return nil, false
	}
	b := decode(before)
	if inv.possible != nil && !inv.possible(a, b) {
		return nil, false
	}
	return inv.build(undoCall{args: a, result: decode(result), before: b})
}

// InversePlan is the undo of a whole applied proposal: each step's inverse,
// last step first, with $n references in the arguments resolved against
// the earlier steps' results. A step that works inside an object an earlier
// step of the same proposal created needs no inverse of its own: removing
// that object removes it too. ok is false when any other step has no
// inverse.
func InversePlan(steps []AppliedStep) ([]InverseStep, bool) {
	results := make([]any, len(steps))
	tools := make([]string, len(steps))
	for i, s := range steps {
		results[i] = decode(s.Result)
		tools[i] = s.Tool
	}
	out := []InverseStep{}
	for i := len(steps) - 1; i >= 0; i-- {
		var args any
		if err := json.Unmarshal(steps[i].Arguments, &args); err != nil {
			return nil, false
		}
		if insideCreated(steps[i].Tool, args, tools, i) {
			continue
		}
		resolved, ok := resolveStepRefs(args, results, i)
		if !ok {
			return nil, false
		}
		raw, err := json.Marshal(resolved)
		if err != nil {
			return nil, false
		}
		inv, ok := Inverse(steps[i].Tool, raw, steps[i].Result, steps[i].Before)
		if !ok {
			return nil, false
		}
		out = append(out, inv...)
	}
	return out, true
}

// PlannedStep is one step of a proposal before it is applied: its
// arguments as proposed and the "before" the review read.
type PlannedStep struct {
	Tool      string
	Arguments json.RawMessage
	Before    json.RawMessage
}

// UndoablePlan reports, before a proposal is applied, whether InversePlan
// will be able to undo it: every step is undoable on its own, or works
// inside an object an earlier step creates.
func UndoablePlan(steps []PlannedStep) bool {
	tools := make([]string, len(steps))
	for i, s := range steps {
		tools[i] = s.Tool
	}
	for i, s := range steps {
		var args any
		if err := json.Unmarshal(s.Arguments, &args); err != nil {
			return false
		}
		if insideCreated(s.Tool, args, tools, i) {
			continue
		}
		if !Undoable(s.Tool, s.Arguments, s.Before) {
			return false
		}
	}
	return len(steps) > 0
}

// creates are the tools whose undo removes the object they made, with the
// argument other tools name that object by and where its id is in the
// result (as a $n reference spells it).
var creates = map[string]struct{ key, ref string }{
	"create_task":        {"taskId", "task.id"},
	"capture_inbox_item": {"taskId", "task.id"},
	"create_event":       {"eventId", "id"},
	"create_doc":         {"docId", "id"},
	"create_sheet":       {"sheetId", "sheet.id"},
}

// insideTools work inside one object, named by this argument: removing the
// object removes what they did.
var insideTools = map[string]string{
	"update_task": "taskId", "complete_task": "taskId", "reopen_task": "taskId",
	"move_task_to_status": "taskId", "move_task_to_stage": "taskId", "set_task_labels": "taskId",
	"set_task_custom_field": "taskId", "set_task_dependency": "taskId", "add_task_comment": "taskId",
	"add_checklist_item": "taskId", "update_checklist_item": "taskId", "toggle_checklist_item": "taskId",
	"delete_checklist_item": "taskId", "set_today_focus": "taskId", "schedule_task": "taskId",
	"pin_task": "taskId", "clear_task_blocks": "taskId", "set_task_recurrence": "taskId",
	"clear_task_recurrence": "taskId",
	"update_event":          "eventId",
	"update_doc":            "docId", "append_to_doc": "docId", "add_3d_model": "docId", "add_live_block": "docId",
	"update_sheet": "sheetId", "add_sheet_column": "sheetId", "update_sheet_column": "sheetId",
	"delete_sheet_column": "sheetId", "add_sheet_rows": "sheetId", "add_sheet_row": "sheetId",
	"add_sheet_entries": "sheetId", "update_sheet_cells": "sheetId", "delete_sheet_rows": "sheetId",
	"add_sheet_tab": "sheetId", "rename_sheet_tab": "sheetId", "update_sheet_tab": "sheetId",
	"delete_sheet_tab": "sheetId",
}

// insideCreated reports whether step index works inside an object that an
// earlier step of the same proposal creates.
func insideCreated(tool string, args any, tools []string, index int) bool {
	key, ok := insideTools[tool]
	if !ok {
		return false
	}
	ref, _ := get(args, key).(string)
	if !strings.HasPrefix(ref, "$") {
		return false
	}
	n, path, ok := strings.Cut(ref[1:], ".")
	if !ok {
		return false
	}
	i, err := strconv.Atoi(n)
	if err != nil || i < 0 || i >= index {
		return false
	}
	made, ok := creates[tools[i]]
	return ok && made.key == key && made.ref == path
}

// UndoTool reports whether an inverse may call this tool. The apply of an
// undo plan accepts these besides the chat's Write tools.
func UndoTool(name string) bool {
	return undoTools[name]
}

var undoTools = set(
	"delete_task", "delete_event", "delete_doc", "delete_sheet", "delete_label", "delete_status",
	"delete_custom_field", "delete_stage", "delete_sheet_template", "delete_checklist_item",
	"delete_sheet_tab", "delete_sheet_column", "delete_block", "update_habit", "set_goal",
	"update_task", "update_event", "update_project", "rename_workspace", "update_doc", "update_sheet",
	"update_sheet_template", "rename_sheet_tab", "update_checklist_item", "move_block", "pin_task",
	"undo_schedule",
)

// noInverse lists every Write tool without an inverse and why. With the
// inverses below it covers every Write tool (TestEveryWriteToolHasAnUndoDecision).
var noInverse = map[string]string{
	"clarify_inbox_item":     "turning a capture into work changes its kind",
	"set_task_custom_field":  "custom field values are not read back in a form that can be written",
	"add_task_comment":       "comments cannot be removed",
	"set_task_recurrence":    "repeating series are always reviewed",
	"clear_task_recurrence":  "repeating series are always reviewed",
	"edit_task_occurrence":   "repeating series are always reviewed",
	"split_task_series":      "repeating series are always reviewed",
	"edit_event_occurrence":  "repeating series are always reviewed",
	"split_event_series":     "repeating series are always reviewed",
	"delete_checklist_item":  "deleted data cannot be put back exactly",
	"delete_block":           "deleted data cannot be put back exactly",
	"clear_task_blocks":      "deleted data cannot be put back exactly",
	"delete_sheet_column":    "deleted data cannot be put back exactly",
	"delete_sheet_rows":      "deleted data cannot be put back exactly",
	"delete_sheet_tab":       "deleted data cannot be put back exactly",
	"start_focus":            "focus time is recorded as it happens",
	"pause_focus":            "focus time is recorded as it happens",
	"stop_focus":             "focus time is recorded as it happens",
	"pin_block":              "locking turns the block into a manual one",
	"undo_schedule":          "it is an undo already",
	"create_workspace":       "removing it would also remove what was added to it since",
	"create_project":         "removing it would also remove what was added to it since",
	"update_status":          "the review does not read the previous values",
	"update_label":           "the review does not read the previous values",
	"update_custom_field":    "the review does not read the previous values",
	"update_stage":           "the review does not read the previous values",
	"reorder_stages":         "the review does not read the previous values",
	"append_to_doc":          "a document's text cannot be put back exactly",
	"add_3d_model":           "a document's text cannot be put back exactly",
	"add_live_block":         "a document's text cannot be put back exactly",
	"restore_doc_version":    "a document's text cannot be put back exactly",
	"add_sheet_rows":         "rows are found by number, which can shift",
	"add_sheet_row":          "rows are found by number, which can shift",
	"add_sheet_entries":      "rows are found by number, which can shift",
	"update_sheet_column":    "the previous sheet values are not kept",
	"update_sheet_tab":       "the previous sheet values are not kept",
	"update_sheet_cells":     "the previous sheet values are not kept",
	"create_task_view":       "it also changes which view is shown",
	"update_task_view":       "the review does not read the previous view",
	"set_active_task_view":   "the review does not read the previous view",
	"mark_notification_read": "nothing marks a notification unread",
	"triage_notification":    "its next step is not recorded",
	"snooze_reminder":        "the previous reminder time is not read",
	"check_habit":            "the previous habit state is not read",
	"update_habit":           "the previous habit state is not read",
	"create_bot":             "bots are always reviewed",
	"update_bot":             "bots are always reviewed",
}

var inverses = map[string]inverse{
	// Creates: remove what was made.
	"create_task":           removesCreated("delete_task", "Remove the task it made", "taskId", "task", "id"),
	"capture_inbox_item":    removesCreated("delete_task", "Remove the item it captured", "taskId", "task", "id"),
	"create_event":          removesCreated("delete_event", "Remove the event it made", "eventId", "id"),
	"create_sheet":          removesCreated("delete_sheet", "Remove the sheet it made", "sheetId", "sheet", "id"),
	"create_sheet_template": removesCreated("delete_sheet_template", "Remove the template it saved", "templateId", "id"),
	"create_doc": {build: func(c undoCall) ([]InverseStep, bool) {
		return removeDoc(str(c.result, "id"))
	}},
	"open_daily_note": {build: func(c undoCall) ([]InverseStep, bool) {
		created, ok := get(c.result, "created").(bool)
		if !ok {
			return nil, false
		}
		if !created {
			return []InverseStep{}, true // it opened a note that was there
		}
		return removeDoc(str(c.result, "id"))
	}},
	"create_label":        removesFromWorkspace("delete_label", "Remove the label it made"),
	"create_status":       removesFromWorkspace("delete_status", "Remove the status it made"),
	"create_custom_field": removesFromWorkspace("delete_custom_field", "Remove the custom field it made"),
	"create_stage": {build: func(c undoCall) ([]InverseStep, bool) {
		project, stage := argStr(c.args, "projectId"), str(c.result, "id")
		if project == "" || stage == "" {
			return nil, false
		}
		return one("delete_stage", "Remove the stage it made", map[string]any{"projectId": project, "stageId": stage})
	}},
	"add_habit": {build: func(c undoCall) ([]InverseStep, bool) {
		id := str(c.result, "id")
		if id == "" {
			return nil, false
		}
		return one("update_habit", "Remove the habit it added", map[string]any{"habit": id, "action": "remove"})
	}},
	"set_goal": {
		possible: func(args map[string]any, _ any) bool {
			return strings.EqualFold(strings.TrimSpace(argStr(args, "action")), "add")
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			id := str(c.result, "id")
			if id == "" {
				return nil, false
			}
			return one("set_goal", "Remove the goal it added", map[string]any{"action": "remove", "goal": id})
		},
	},
	"add_checklist_item": {
		possible: sameTask,
		build: func(c undoCall) ([]InverseStep, bool) {
			had := map[string]bool{}
			for _, item := range list(c.before, "task", "checklist") {
				had[str(item, "id")] = true
			}
			added := []string{}
			for _, item := range list(c.result, "task", "checklist") {
				if id := str(item, "id"); id != "" && !had[id] {
					added = append(added, id)
				}
			}
			if len(added) != 1 {
				return nil, false
			}
			return one("delete_checklist_item", "Remove the checklist item it added", map[string]any{"taskId": argStr(c.args, "taskId"), "itemId": added[0]})
		},
	},
	"add_sheet_tab": {build: func(c undoCall) ([]InverseStep, bool) {
		sheet, tab := firstOf(argStr(c.args, "sheetId"), str(c.result, "sheet", "id")), str(c.result, "tab", "id")
		if sheet == "" || tab == "" {
			return nil, false
		}
		return one("delete_sheet_tab", "Remove the tab it added", map[string]any{"sheetId": sheet, "tabId": tab})
	}},
	"add_sheet_column": {build: func(c undoCall) ([]InverseStep, bool) {
		sheet := firstOf(argStr(c.args, "sheetId"), str(c.result, "sheet", "id"))
		tab := str(c.result, "tab", "id")
		columns := list(c.result, "tab", "columns")
		if sheet == "" || len(columns) == 0 {
			return nil, false
		}
		column := str(columns[len(columns)-1], "id")
		if column == "" {
			return nil, false
		}
		// The new column is the tab's last; it must not have been there before.
		for _, t := range list(c.before, "sheet", "tabs") {
			if str(t, "id") != tab {
				continue
			}
			for _, col := range list(t, "columns") {
				if str(col, "id") == column {
					return nil, false
				}
			}
		}
		return one("delete_sheet_column", "Remove the column it added", map[string]any{"sheetId": sheet, "tabId": tab, "columnId": column})
	}},

	// Task updates: write back the fields the call changed.
	"update_task": {
		possible: func(args map[string]any, before any) bool {
			_, ok := taskRestore(args, before)
			return ok && sameTask(args, before)
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			fields, ok := taskRestore(c.args, c.before)
			if !ok {
				return nil, false
			}
			return restoreTask(argStr(c.args, "taskId"), fields)
		},
	},
	"bulk_update_tasks": {
		possible: func(args map[string]any, before any) bool {
			_, ok := bulkRestore(args, before)
			return ok
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			return bulkRestore(c.args, c.before)
		},
	},
	"complete_task":       taskFields("completedAt"),
	"reopen_task":         taskFields("completedAt"),
	"move_task_to_status": taskFields("statusId"),
	"move_task_to_stage":  taskFields("stageId"),
	"set_task_labels":     taskFields("labelIds"),
	"set_task_dependency": taskFields("blockedById"),
	"set_today_focus":     taskFields("todayFocusOn"),
	"pin_task": {
		possible: sameTask,
		build: func(c undoCall) ([]InverseStep, bool) {
			locked, ok := get(c.before, "task", "scheduleLocked").(bool)
			if !ok {
				return nil, false
			}
			return one("pin_task", "Put the task's lock back", map[string]any{"taskId": argStr(c.args, "taskId"), "locked": locked})
		},
	},
	"update_checklist_item": checklistRestore(),
	"toggle_checklist_item": checklistRestore(),

	// Other updates.
	"update_event": {
		possible: func(args map[string]any, before any) bool {
			_, ok := eventRestore(args, before)
			return ok
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			fields, ok := eventRestore(c.args, c.before)
			if !ok {
				return nil, false
			}
			fields["eventId"] = argStr(c.args, "eventId")
			return one("update_event", "Put the event back as it was", fields)
		},
	},
	"update_project": projectRestore(),
	"complete_project": {
		possible: sameProject,
		build: func(c undoCall) ([]InverseStep, bool) {
			return one("update_project", "Put the project's completion back", map[string]any{"projectId": argStr(c.args, "projectId"), "completedAt": nullable(get(c.before, "project", "completedAt"))})
		},
	},
	"reopen_project": {
		possible: sameProject,
		build: func(c undoCall) ([]InverseStep, bool) {
			return one("update_project", "Put the project's completion back", map[string]any{"projectId": argStr(c.args, "projectId"), "completedAt": nullable(get(c.before, "project", "completedAt"))})
		},
	},
	"rename_workspace": {
		possible: func(args map[string]any, before any) bool {
			return argStr(args, "workspaceId") != "" && str(before, "id") == argStr(args, "workspaceId") && str(before, "name") != ""
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			return one("rename_workspace", "Put the workspace's name back", map[string]any{"workspaceId": argStr(c.args, "workspaceId"), "name": str(c.before, "name"), "color": str(c.before, "color")})
		},
	},
	"update_doc": {
		possible: func(args map[string]any, before any) bool {
			_, ok := docRestore(args, before)
			return ok
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			fields, ok := docRestore(c.args, c.before)
			if !ok {
				return nil, false
			}
			fields["docId"] = argStr(c.args, "docId")
			return one("update_doc", "Put the document's details back", fields)
		},
	},
	"update_sheet": {
		possible: func(args map[string]any, before any) bool {
			_, ok := sheetRestore(args, before)
			return ok
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			fields, ok := sheetRestore(c.args, c.before)
			if !ok {
				return nil, false
			}
			fields["sheetId"] = argStr(c.args, "sheetId")
			return one("update_sheet", "Put the sheet's details back", fields)
		},
	},
	"update_sheet_template": {
		possible: func(args map[string]any, before any) bool {
			return argStr(args, "templateId") != "" && str(before, "id") == argStr(args, "templateId") && str(before, "name") != ""
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			return one("update_sheet_template", "Put the template's name back", map[string]any{"templateId": argStr(c.args, "templateId"), "name": str(c.before, "name")})
		},
	},
	"rename_sheet_tab": {
		possible: func(args map[string]any, before any) bool {
			id, name := beforeTab(args, before)
			return id != "" && name != ""
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			id, name := beforeTab(c.args, c.before)
			if id == "" || name == "" {
				return nil, false
			}
			return one("rename_sheet_tab", "Put the tab's name back", map[string]any{"sheetId": argStr(c.args, "sheetId"), "tabId": id, "name": name})
		},
	},

	// Placement: put the old placement back.
	"move_block": {
		possible: func(args map[string]any, before any) bool {
			return argStr(args, "blockId") != "" && str(before, "id") == argStr(args, "blockId") && str(before, "start") != "" && str(before, "end") != ""
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			return one("move_block", "Move the block back", map[string]any{"blockId": argStr(c.args, "blockId"), "start": str(c.before, "start"), "end": str(c.before, "end")})
		},
	},
	"schedule_task": {
		possible: func(args map[string]any, before any) bool {
			if replace, _ := args["replace"].(bool); replace || !sameTask(args, before) {
				return false
			}
			if str(before, "task", "kind") == "reminder" {
				return str(before, "task", "scheduledOn") != ""
			}
			return true
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			taskID := argStr(c.args, "taskId")
			if str(c.before, "task", "kind") == "reminder" {
				// On a reminder it only set the ping time.
				return one("update_task", "Put the reminder's time back", map[string]any{"taskId": taskID, "scheduledOn": str(c.before, "task", "scheduledOn")})
			}
			had := map[string]bool{}
			for _, b := range list(c.before, "task", "blocks") {
				had[str(b, "id")] = true
			}
			out := []InverseStep{}
			for _, b := range list(c.result, "blocks") {
				if id := str(b, "id"); id != "" && !had[id] {
					s, ok := one("delete_block", "Remove the time it booked", map[string]any{"id": id})
					if !ok {
						return nil, false
					}
					out = append(out, s...)
				}
			}
			if len(out) == 0 {
				return nil, false
			}
			return out, true
		},
	},
	"auto_schedule_apply": {build: func(undoCall) ([]InverseStep, bool) {
		// The schedule keeps the blocks each apply replaced; its own undo
		// puts them back.
		return one("undo_schedule", "Put the earlier plan back", map[string]any{})
	}},
}

// removesCreated undoes a create by deleting the object whose id is at path in the
// result.
func removesCreated(tool, summary, idArg string, path ...string) inverse {
	return inverse{build: func(c undoCall) ([]InverseStep, bool) {
		id := str(c.result, path...)
		if id == "" {
			return nil, false
		}
		return one(tool, summary, map[string]any{idArg: id})
	}}
}

// removesFromWorkspace undoes a create of a workspace's label, status or
// custom field.
func removesFromWorkspace(tool, summary string) inverse {
	return inverse{build: func(c undoCall) ([]InverseStep, bool) {
		id := str(c.result, "id")
		workspace := firstOf(argStr(c.args, "workspaceId"), str(c.result, "workspaceId"))
		if id == "" || workspace == "" {
			return nil, false
		}
		return one(tool, summary, map[string]any{"id": id, "workspaceId": workspace})
	}}
}

func removeDoc(id string) ([]InverseStep, bool) {
	if id == "" {
		return nil, false
	}
	return one("delete_doc", "Remove the document it made", map[string]any{"docId": id, "confirm": true})
}

// Tasks.

// taskScalars are update_task's fields that are written back as they were.
// A nullable field that was empty is cleared with "".
var taskScalars = map[string]string{
	"name": "text", "duration": "number", "deadline": "nullable", "startDate": "nullable",
	"completedAt": "nullable", "workspaceId": "nullable", "projectId": "nullable", "statusId": "nullable",
	"priorityLevel": "nullable", "stageId": "nullable", "blockedById": "nullable", "todayFocusOn": "nullable",
	"earliestStartAt": "nullable", "minChunkMinutes": "number", "preferredChunkMinutes": "chunk",
	"contiguous": "bool", "scheduleLocked": "bool", "labelIds": "labels",
}

// taskCoupled are written back together, since the task service changes
// them together: completion and status follow each other, and a move to
// another workspace or project re-homes status, stage and labels.
var taskCoupled = map[string][]string{
	"completedAt": {"completedAt", "statusId"},
	"statusId":    {"completedAt", "statusId"},
	"workspaceId": {"workspaceId", "projectId", "statusId", "stageId", "labelIds", "completedAt"},
	"projectId":   {"workspaceId", "projectId", "statusId", "stageId", "labelIds", "completedAt"},
}

// sameTask reports whether before is get_task's read of the call's task.
func sameTask(args map[string]any, before any) bool {
	id := argStr(args, "taskId")
	return id != "" && str(before, "task", "id") == id
}

// taskRestore is the update_task arguments that put back what a task patch
// changed, read from the task as it was.
func taskRestore(patch map[string]any, before any) (map[string]any, bool) {
	task, ok := get(before, "task").(map[string]any)
	if !ok {
		return nil, false
	}
	keys := []string{}
	for key := range patch {
		if key == "taskId" {
			continue
		}
		if _, ok := taskScalars[key]; !ok {
			// description, kind, custom fields, recurrence and placement
			// cannot be written back exactly.
			return nil, false
		}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return nil, false
	}
	// A duration change on work stays work; one that crosses into a
	// reminder or out of one cannot be put back by duration alone.
	if _, ok := patch["duration"]; ok {
		if d, _ := patch["duration"].(float64); d <= 0 || str(task, "kind") != "task" {
			return nil, false
		}
	}
	// Moving to another workspace drops values that belong to the old one.
	if _, moved := patch["workspaceId"]; moved && len(list(task, "customFieldValues")) > 0 {
		return nil, false
	}
	fields := map[string]any{}
	for _, key := range keys {
		group := taskCoupled[key]
		if group == nil {
			group = []string{key}
		}
		for _, k := range group {
			value, ok := taskValue(task, k)
			if !ok {
				return nil, false
			}
			fields[k] = value
		}
	}
	return fields, true
}

// taskValue is one field of the task as update_task takes it back.
func taskValue(task map[string]any, key string) (any, bool) {
	value, present := task[key]
	switch taskScalars[key] {
	case "text":
		s, ok := value.(string)
		return s, ok && s != ""
	case "number":
		n, ok := value.(float64)
		return n, ok
	case "bool":
		b, ok := value.(bool)
		return b, ok
	case "nullable":
		if !present {
			return nil, false
		}
		return nullable(value), true
	case "chunk":
		if value == nil {
			return 0, present // 0 clears the preferred chunk
		}
		n, ok := value.(float64)
		return n, ok
	case "labels":
		ids := []string{}
		for _, l := range list(task, "labelIds") {
			if id := str(l, "id"); id != "" {
				ids = append(ids, id)
			}
		}
		return ids, true
	}
	return nil, false
}

func restoreTask(taskID string, fields map[string]any) ([]InverseStep, bool) {
	if taskID == "" {
		return nil, false
	}
	fields["taskId"] = taskID
	return one("update_task", "Put the task back as it was", fields)
}

// taskFields undoes a narrow task tool by writing back the task fields it
// changes.
func taskFields(keys ...string) inverse {
	patch := func(args map[string]any) map[string]any {
		p := map[string]any{"taskId": args["taskId"]}
		for _, k := range keys {
			p[k] = true // only the keys matter
		}
		return p
	}
	return inverse{
		possible: func(args map[string]any, before any) bool {
			if !sameTask(args, before) {
				return false
			}
			_, ok := taskRestore(patch(args), before)
			return ok
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			fields, ok := taskRestore(patch(c.args), c.before)
			if !ok {
				return nil, false
			}
			return restoreTask(argStr(c.args, "taskId"), fields)
		},
	}
}

// bulkRestore undoes bulk_update_tasks task by task, from the reads the
// review made of each (before is their list, in the order of ids).
func bulkRestore(args map[string]any, before any) ([]InverseStep, bool) {
	ids, _ := args["ids"].([]any)
	reads, _ := before.([]any)
	patch, _ := args["update"].(map[string]any)
	if len(ids) == 0 || len(ids) != len(reads) || len(patch) == 0 {
		return nil, false
	}
	out := []InverseStep{}
	for i, raw := range ids {
		id, _ := raw.(string)
		if id == "" || str(reads[i], "task", "id") != id {
			return nil, false
		}
		fields, ok := taskRestore(patch, reads[i])
		if !ok {
			return nil, false
		}
		steps, ok := restoreTask(id, fields)
		if !ok {
			return nil, false
		}
		out = append(out, steps...)
	}
	return out, true
}

// checklistRestore undoes update_checklist_item and toggle_checklist_item.
func checklistRestore() inverse {
	item := func(args map[string]any, before any) map[string]any {
		id := argStr(args, "itemId")
		if id == "" || !sameTask(args, before) {
			return nil
		}
		for _, it := range list(before, "task", "checklist") {
			if m, ok := it.(map[string]any); ok && str(m, "id") == id {
				return m
			}
		}
		return nil
	}
	return inverse{
		possible: func(args map[string]any, before any) bool {
			return item(args, before) != nil
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			was := item(c.args, c.before)
			if was == nil {
				return nil, false
			}
			done := str(was, "completedAt") != ""
			fields := map[string]any{"taskId": argStr(c.args, "taskId"), "itemId": argStr(c.args, "itemId"), "completed": done}
			if _, ok := c.args["title"]; ok {
				fields["title"] = str(was, "title")
			}
			return one("update_checklist_item", "Put the checklist item back", fields)
		},
	}
}

// Events.

// eventRestore is the update_event arguments that put back what an event
// patch changed. A change of time puts start, end and all-day back together.
func eventRestore(args map[string]any, before any) (map[string]any, bool) {
	id := argStr(args, "eventId")
	event, ok := before.(map[string]any)
	if !ok || id == "" || str(event, "id") != id {
		return nil, false
	}
	fields := map[string]any{}
	changed := false
	for key := range args {
		switch key {
		case "eventId":
		case "title":
			if str(event, "title") == "" {
				return nil, false
			}
			fields["title"] = str(event, "title")
		case "description":
			fields["description"] = str(event, "description")
		case "start", "end", "allDay":
			allDay, ok := event["allDay"].(bool)
			if !ok || str(event, "start") == "" || str(event, "end") == "" {
				return nil, false
			}
			fields["start"], fields["end"], fields["allDay"] = str(event, "start"), str(event, "end"), allDay
		case "color", "workspaceId", "projectId", "taskId":
			value, present := event[key]
			if !present {
				return nil, false
			}
			fields[key] = nullable(value)
		default:
			// Recurrence changes are always reviewed and not undone here.
			return nil, false
		}
		changed = true
	}
	return fields, changed
}

// Projects.

func sameProject(args map[string]any, before any) bool {
	id := argStr(args, "projectId")
	project, ok := get(before, "project").(map[string]any)
	if !ok {
		return false
	}
	_, present := project["completedAt"]
	return id != "" && str(project, "id") == id && present
}

func projectRestore() inverse {
	restore := func(args map[string]any, before any) (map[string]any, bool) {
		id := argStr(args, "projectId")
		project, ok := get(before, "project").(map[string]any)
		if !ok || id == "" || str(project, "id") != id {
			return nil, false
		}
		fields := map[string]any{"projectId": id}
		for key := range args {
			switch key {
			case "projectId":
			case "title":
				if str(project, "title") == "" {
					return nil, false
				}
				fields["title"] = str(project, "title")
			case "statusId", "deadline", "startDate", "completedAt", "priorityLevel", "color":
				value, present := project[key]
				if !present {
					return nil, false
				}
				fields[key] = nullable(value)
			case "doesHaveStages":
				b, ok := project[key].(bool)
				if !ok {
					return nil, false
				}
				fields[key] = b
			default:
				// The description is rich text and cannot be written back exactly.
				return nil, false
			}
		}
		return fields, len(fields) > 1
	}
	return inverse{
		possible: func(args map[string]any, before any) bool {
			_, ok := restore(args, before)
			return ok
		},
		build: func(c undoCall) ([]InverseStep, bool) {
			fields, ok := restore(c.args, c.before)
			if !ok {
				return nil, false
			}
			return one("update_project", "Put the project back as it was", fields)
		},
	}
}

// Docs and sheets.

// docRestore puts back a document's details; its text has no inverse.
func docRestore(args map[string]any, before any) (map[string]any, bool) {
	id := argStr(args, "docId")
	doc, ok := before.(map[string]any)
	if !ok || id == "" || str(doc, "id") != id {
		return nil, false
	}
	fields := map[string]any{}
	for key := range args {
		switch key {
		case "docId":
		case "title":
			fields["title"] = str(doc, "title")
		case "icon", "parentId", "projectId":
			value, present := doc[key]
			if !present {
				return nil, false
			}
			fields[key] = nullable(value)
		case "isFavorite":
			b, ok := doc[key].(bool)
			if !ok {
				return nil, false
			}
			fields[key] = b
		case "order":
			n, ok := doc[key].(float64)
			if !ok {
				return nil, false
			}
			fields[key] = n
		case "archived":
			value, present := doc["archivedAt"]
			if !present {
				return nil, false
			}
			fields["archived"] = nullable(value) != ""
		default:
			return nil, false
		}
	}
	return fields, len(fields) > 0
}

// sheetRestore puts back a sheet's details; its grid has no inverse.
func sheetRestore(args map[string]any, before any) (map[string]any, bool) {
	id := argStr(args, "sheetId")
	sheet, ok := get(before, "sheet").(map[string]any)
	if !ok || id == "" || str(sheet, "id") != id {
		return nil, false
	}
	fields := map[string]any{}
	for key := range args {
		switch key {
		case "sheetId":
		case "title":
			fields["title"] = str(sheet, "title")
		case "icon", "projectId":
			value, present := sheet[key]
			if !present {
				return nil, false
			}
			fields[key] = nullable(value)
		case "isFavorite":
			b, ok := sheet[key].(bool)
			if !ok {
				return nil, false
			}
			fields[key] = b
		case "archived":
			value, present := sheet["archivedAt"]
			if !present {
				return nil, false
			}
			fields["archived"] = nullable(value) != ""
		default:
			return nil, false
		}
	}
	return fields, len(fields) > 0
}

// beforeTab finds the tab a rename_sheet_tab call names (by id or current
// name) in the sheet as it was.
func beforeTab(args map[string]any, before any) (id, name string) {
	want := strings.TrimSpace(argStr(args, "tabId"))
	if want == "" || argStr(args, "sheetId") == "" || str(before, "sheet", "id") != argStr(args, "sheetId") {
		return "", ""
	}
	for _, t := range list(before, "sheet", "tabs") {
		if str(t, "id") == want || strings.EqualFold(str(t, "name"), want) {
			return str(t, "id"), str(t, "name")
		}
	}
	return "", ""
}

// JSON helpers.

func decode(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	return v
}

// get walks object keys; it returns nil when any is missing.
func get(v any, path ...string) any {
	for _, key := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[key]
	}
	return v
}

func str(v any, path ...string) string {
	s, _ := get(v, path...).(string)
	return s
}

func list(v any, path ...string) []any {
	l, _ := get(v, path...).([]any)
	return l
}

func argStr(args map[string]any, key string) string {
	s, _ := args[key].(string)
	return s
}

// nullable is a nullable field as the update tools take it: "" clears.
func nullable(v any) string {
	s, _ := v.(string)
	return s
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func one(tool, summary string, args map[string]any) ([]InverseStep, bool) {
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, false
	}
	return []InverseStep{{Tool: tool, Summary: summary, Arguments: raw}}, true
}

// resolveStepRefs replaces "$n.path" strings with the value at path in step n's
// result, as the apply did. Only earlier steps may be referenced.
func resolveStepRefs(value any, results []any, index int) (any, bool) {
	switch v := value.(type) {
	case string:
		if !strings.HasPrefix(v, "$") {
			return v, true
		}
		parts := strings.Split(v[1:], ".")
		n, err := strconv.Atoi(parts[0])
		if err != nil || len(parts) < 2 {
			return v, true
		}
		if n < 0 || n >= index {
			return nil, false
		}
		out := results[n]
		for _, p := range parts[1:] {
			switch x := out.(type) {
			case map[string]any:
				out = x[p]
			case []any:
				j, err := strconv.Atoi(p)
				if err != nil || j < 0 || j >= len(x) {
					return nil, false
				}
				out = x[j]
			default:
				return nil, false
			}
		}
		return out, out != nil
	case map[string]any:
		out := map[string]any{}
		for k, x := range v {
			r, ok := resolveStepRefs(x, results, index)
			if !ok {
				return nil, false
			}
			out[k] = r
		}
		return out, true
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			r, ok := resolveStepRefs(x, results, index)
			if !ok {
				return nil, false
			}
			out[i] = r
		}
		return out, true
	}
	return value, true
}
