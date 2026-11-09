package agent

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"timely-api/internal/features/focus"
	"timely-api/internal/models"
)

// js is a tool result or review read as the chat stores it.
func js(v any) json.RawMessage {
	raw, err := json.Marshal(objectContent(v))
	if err != nil {
		panic(err)
	}
	return raw
}

func ptr[T any](v T) *T { return &v }

type undoCase struct {
	name   string
	tool   string
	args   map[string]any
	result json.RawMessage
	before json.RawMessage
	// want is the expected undo plan (tool and arguments); nil expects no
	// inverse.
	want []wantStep
}

type wantStep struct {
	tool string
	args map[string]any
}

func (c undoCase) run(t *testing.T, catalog Catalog) {
	t.Helper()
	args, _ := json.Marshal(c.args)
	steps, ok := Inverse(c.tool, args, c.result, c.before)
	if undoable := Undoable(c.tool, args, c.before); c.want != nil && !undoable {
		t.Errorf("%s: Undoable says no, but an inverse is expected", c.name)
	}
	if c.want == nil {
		if ok {
			t.Errorf("%s: got an inverse %s, want none", c.name, describe(steps))
		}
		return
	}
	if !ok {
		t.Fatalf("%s: no inverse, want %v", c.name, c.want)
	}
	if len(steps) != len(c.want) {
		t.Fatalf("%s: got %s, want %d steps", c.name, describe(steps), len(c.want))
	}
	for i, s := range steps {
		var got map[string]any
		if err := json.Unmarshal(s.Arguments, &got); err != nil {
			t.Fatal(err)
		}
		want := map[string]any{}
		raw, _ := json.Marshal(c.want[i].args)
		_ = json.Unmarshal(raw, &want)
		if s.Tool != c.want[i].tool || !reflect.DeepEqual(got, want) {
			t.Errorf("%s step %d: got %s %s, want %s %s", c.name, i, s.Tool, s.Arguments, c.want[i].tool, raw)
		}
		if s.Summary == "" {
			t.Errorf("%s step %d has no summary", c.name, i)
		}
		checkUndoStep(t, catalog, s)
	}
}

// checkUndoStep asserts an undo step names a tool the undo apply accepts
// and that its arguments pass that tool's own schema.
func checkUndoStep(t *testing.T, catalog Catalog, s InverseStep) {
	t.Helper()
	if !UndoTool(s.Tool) {
		t.Errorf("undo step calls %s, which UndoTool does not allow", s.Tool)
	}
	tool, ok := catalog[s.Tool]
	if !ok {
		t.Fatalf("undo step calls unknown tool %s", s.Tool)
	}
	if err := tool.check(s.Arguments); err != nil {
		t.Errorf("undo step %s %s fails its schema: %v", s.Tool, s.Arguments, err)
	}
}

func describe(steps []InverseStep) string {
	raw, _ := json.Marshal(steps)
	return string(raw)
}

var (
	wsID   = "ws1"
	projID = "p1"
	t0     = time.Date(2026, 11, 9, 9, 0, 0, 0, time.UTC)
)

func sampleTask(mod func(*models.Task)) *models.Task {
	t := &models.Task{ID: "t1", Name: "Write report", Kind: models.KindTask, Duration: 60, WorkspaceID: &wsID, StatusID: ptr("todo"), MinChunkMinutes: 15, LabelIDs: models.LabelInputs{{Id: "l1"}}, Checklist: models.Checklist{{ID: "c1", Title: "Outline", Order: 0}}}
	if mod != nil {
		mod(t)
	}
	return t
}

// Every Write tool has either an inverse or a recorded reason for none, so
// Auto never applies a change nobody decided about.
func TestEveryWriteToolHasAnUndoDecision(t *testing.T) {
	c := NewCatalog(Deps{})
	for name, tool := range c {
		if tool.Authority.Access != Write {
			continue
		}
		_, has := inverses[name]
		_, hasNot := noInverse[name]
		switch {
		case has && hasNot:
			t.Errorf("%s is listed both with and without an inverse", name)
		case !has && !hasNot:
			t.Errorf("Write tool %s has no undo decision: add an inverse or a noInverse reason in inverse.go", name)
		}
	}
	for name := range inverses {
		if tool, ok := c[name]; !ok || tool.Authority.Access != Write {
			t.Errorf("inverses lists %s, which is not a chat Write tool", name)
		}
	}
	for name := range noInverse {
		if tool, ok := c[name]; !ok || tool.Authority.Access != Write {
			t.Errorf("noInverse lists %s, which is not a chat Write tool", name)
		}
		if Undoable(name, json.RawMessage(`{}`), nil) {
			t.Errorf("%s has no inverse but reports undoable", name)
		}
	}
	for name := range undoTools {
		if _, ok := c[name]; !ok {
			t.Errorf("UndoTool allows %s, which is not in the catalog", name)
		}
	}
}

func TestInverseOfCreatesRemovesWhatTheyMade(t *testing.T) {
	c := NewCatalog(Deps{})
	label := &models.Lable{ID: "lab9", Name: "Errand", WorkspaceID: wsID}
	withItem := sampleTask(func(t *models.Task) {
		t.Checklist = append(t.Checklist, models.ChecklistItem{ID: "c2", Title: "Draft", Order: 1})
	})
	sheet := &models.Sheet{ID: "s1", Title: "Budget", Tabs: models.SheetTabs{
		{ID: "tab1", Name: "Jan", Columns: models.SheetColumns{{ID: "col1", Name: "Item"}}},
		{ID: "tab2", Name: "Feb", Columns: models.SheetColumns{{ID: "col1", Name: "Item"}, {ID: "col9", Name: "Cost"}}},
	}}
	cases := []undoCase{
		{name: "create_task", tool: "create_task", args: map[string]any{"name": "Write report", "workspaceId": wsID}, result: js(taskPayload(sampleTask(nil))),
			want: []wantStep{{"delete_task", map[string]any{"taskId": "t1"}}}},
		{name: "capture_inbox_item", tool: "capture_inbox_item", args: map[string]any{"name": "Idea"}, result: js(taskPayload(sampleTask(func(t *models.Task) { t.ID, t.Kind = "t7", models.KindInbox }))),
			want: []wantStep{{"delete_task", map[string]any{"taskId": "t7"}}}},
		{name: "create_event", tool: "create_event", args: map[string]any{"title": "Dentist", "start": "2026-11-10T09:00:00Z", "end": "2026-11-10T10:00:00Z"}, result: js(&models.Event{ID: "e1", Title: "Dentist", StartAt: t0, EndAt: t0.Add(time.Hour)}),
			want: []wantStep{{"delete_event", map[string]any{"eventId": "e1"}}}},
		{name: "create_doc", tool: "create_doc", args: map[string]any{"title": "Notes"}, result: js(docPayload(&models.Document{ID: "d1", Title: "Notes"})),
			want: []wantStep{{"delete_doc", map[string]any{"docId": "d1", "confirm": true}}}},
		{name: "open_daily_note made one", tool: "open_daily_note", args: map[string]any{}, result: js(map[string]any{"id": "d2", "created": true}),
			want: []wantStep{{"delete_doc", map[string]any{"docId": "d2", "confirm": true}}}},
		{name: "create_sheet", tool: "create_sheet", args: map[string]any{"title": "Budget"}, result: js(sheetResult(sheet, "")),
			want: []wantStep{{"delete_sheet", map[string]any{"sheetId": "s1"}}}},
		{name: "create_sheet_template", tool: "create_sheet_template", args: map[string]any{"sheetId": "s1", "name": "Monthly"}, result: js(templateBrief(&models.SheetTemplate{ID: "tpl1", Name: "Monthly"})),
			want: []wantStep{{"delete_sheet_template", map[string]any{"templateId": "tpl1"}}}},
		{name: "create_label", tool: "create_label", args: map[string]any{"name": "Errand", "workspaceId": wsID}, result: js(label),
			want: []wantStep{{"delete_label", map[string]any{"id": "lab9", "workspaceId": wsID}}}},
		{name: "create_status", tool: "create_status", args: map[string]any{"name": "Waiting", "workspaceId": wsID}, result: js(&models.Status{ID: "st9", Name: "Waiting"}),
			want: []wantStep{{"delete_status", map[string]any{"id": "st9", "workspaceId": wsID}}}},
		{name: "create_custom_field", tool: "create_custom_field", args: map[string]any{"name": "Cost", "type": "number", "workspaceId": wsID}, result: js(&models.CustomField{ID: "cf9", Name: "Cost"}),
			want: []wantStep{{"delete_custom_field", map[string]any{"id": "cf9", "workspaceId": wsID}}}},
		{name: "create_stage", tool: "create_stage", args: map[string]any{"name": "Review", "projectId": projID}, result: js(&models.Stage{ID: "sg9", Name: "Review"}),
			want: []wantStep{{"delete_stage", map[string]any{"projectId": projID, "stageId": "sg9"}}}},
		{name: "add_habit", tool: "add_habit", args: map[string]any{"name": "Walk"}, result: js(&focus.Habit{ID: "h1", Name: "Walk"}),
			want: []wantStep{{"update_habit", map[string]any{"habit": "h1", "action": "remove"}}}},
		{name: "set_goal add", tool: "set_goal", args: map[string]any{"action": "add", "title": "Ship v1"}, result: js(&focus.Goal{ID: "g1", Title: "Ship v1"}),
			want: []wantStep{{"set_goal", map[string]any{"action": "remove", "goal": "g1"}}}},
		{name: "add_checklist_item", tool: "add_checklist_item", args: map[string]any{"taskId": "t1", "title": "Draft"}, result: js(taskPayload(withItem)), before: js(taskPayload(sampleTask(nil))),
			want: []wantStep{{"delete_checklist_item", map[string]any{"taskId": "t1", "itemId": "c2"}}}},
		{name: "add_sheet_tab", tool: "add_sheet_tab", args: map[string]any{"sheetId": "s1", "name": "Feb"}, result: js(sheetResult(sheet, "tab2")),
			want: []wantStep{{"delete_sheet_tab", map[string]any{"sheetId": "s1", "tabId": "tab2"}}}},
		{name: "add_sheet_column", tool: "add_sheet_column", args: map[string]any{"sheetId": "s1", "tabId": "tab2", "name": "Cost", "type": "number"}, result: js(sheetResult(sheet, "tab2")),
			want: []wantStep{{"delete_sheet_column", map[string]any{"sheetId": "s1", "tabId": "tab2", "columnId": "col9"}}}},
	}
	for _, tc := range cases {
		tc.run(t, c)
	}

	// A daily note that was there already changed nothing.
	steps, ok := Inverse("open_daily_note", json.RawMessage(`{}`), js(map[string]any{"id": "d2", "created": false}), nil)
	if !ok || len(steps) != 0 {
		t.Errorf("opening an existing daily note: got %v %s, want an empty undo", ok, describe(steps))
	}
	// Removing a goal or habit cannot be undone.
	undoCase{name: "set_goal remove", tool: "set_goal", args: map[string]any{"action": "remove", "goal": "g1"}, result: js(&focus.Goal{ID: "g1"})}.run(t, c)
	// Without the result's id there is nothing to remove.
	undoCase{name: "create_task without id", tool: "create_task", args: map[string]any{"name": "x"}, result: json.RawMessage(`{}`)}.run(t, c)
	// The checklist item must be new against the review's read of the task.
	undoCase{name: "add_checklist_item without before", tool: "add_checklist_item", args: map[string]any{"taskId": "t1", "title": "Draft"}, result: js(taskPayload(withItem))}.run(t, c)
}

func TestInverseOfTaskChangesRestoresTheFieldsTheyChanged(t *testing.T) {
	c := NewCatalog(Deps{})
	before := js(taskPayload(sampleTask(nil)))
	done := ptr("2026-11-09T10:00:00Z")
	beforeDone := js(taskPayload(sampleTask(func(t *models.Task) { t.CompletedAt, t.StatusID = done, ptr("done") })))
	cases := []undoCase{
		{name: "update_task name and deadline", tool: "update_task", args: map[string]any{"taskId": "t1", "name": "Final report", "deadline": "2026-11-20"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "name": "Write report", "deadline": ""}}}},
		{name: "update_task status brings completion with it", tool: "update_task", args: map[string]any{"taskId": "t1", "statusId": "done"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "statusId": "todo", "completedAt": ""}}}},
		{name: "update_task labels and lock", tool: "update_task", args: map[string]any{"taskId": "t1", "labelIds": []string{"l2"}, "scheduleLocked": true}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "labelIds": []string{"l1"}, "scheduleLocked": false}}}},
		{name: "update_task duration on work", tool: "update_task", args: map[string]any{"taskId": "t1", "duration": 90}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "duration": 60}}}},
		{name: "update_task move re-homes", tool: "update_task", args: map[string]any{"taskId": "t1", "workspaceId": "ws2"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "workspaceId": wsID, "projectId": "", "statusId": "todo", "stageId": "", "labelIds": []string{"l1"}, "completedAt": ""}}}},
		{name: "complete_task", tool: "complete_task", args: map[string]any{"taskId": "t1"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "completedAt": "", "statusId": "todo"}}}},
		{name: "reopen_task", tool: "reopen_task", args: map[string]any{"taskId": "t1"}, before: beforeDone,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "completedAt": *done, "statusId": "done"}}}},
		{name: "move_task_to_status", tool: "move_task_to_status", args: map[string]any{"taskId": "t1", "statusId": "doing"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "statusId": "todo", "completedAt": ""}}}},
		{name: "move_task_to_stage", tool: "move_task_to_stage", args: map[string]any{"taskId": "t1", "stageId": "sg1"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "stageId": ""}}}},
		{name: "set_task_labels", tool: "set_task_labels", args: map[string]any{"taskId": "t1", "labelIds": []string{}}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "labelIds": []string{"l1"}}}}},
		{name: "set_task_dependency", tool: "set_task_dependency", args: map[string]any{"taskId": "t1", "blockedById": "t2"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "blockedById": ""}}}},
		{name: "set_today_focus", tool: "set_today_focus", args: map[string]any{"taskId": "t1", "date": "2026-11-09"}, before: before,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "todayFocusOn": ""}}}},
		{name: "pin_task", tool: "pin_task", args: map[string]any{"taskId": "t1", "locked": true}, before: before,
			want: []wantStep{{"pin_task", map[string]any{"taskId": "t1", "locked": false}}}},
		{name: "toggle_checklist_item", tool: "toggle_checklist_item", args: map[string]any{"taskId": "t1", "itemId": "c1", "completed": true}, before: before,
			want: []wantStep{{"update_checklist_item", map[string]any{"taskId": "t1", "itemId": "c1", "completed": false}}}},
		{name: "update_checklist_item", tool: "update_checklist_item", args: map[string]any{"taskId": "t1", "itemId": "c1", "title": "Plan"}, before: before,
			want: []wantStep{{"update_checklist_item", map[string]any{"taskId": "t1", "itemId": "c1", "title": "Outline", "completed": false}}}},
		{name: "bulk_update_tasks", tool: "bulk_update_tasks", args: map[string]any{"ids": []string{"t1", "t2"}, "update": map[string]any{"priorityLevel": "high"}},
			before: rawJSON([]any{objectContent(taskPayload(sampleTask(nil))), objectContent(taskPayload(sampleTask(func(t *models.Task) { t.ID, t.PriorityLevel = "t2", ptr("low") })))}),
			want:   []wantStep{{"update_task", map[string]any{"taskId": "t1", "priorityLevel": ""}}, {"update_task", map[string]any{"taskId": "t2", "priorityLevel": "low"}}}},

		// No safe inverse.
		{name: "update_task description", tool: "update_task", args: map[string]any{"taskId": "t1", "description": "new"}, before: before},
		{name: "update_task recurrence", tool: "update_task", args: map[string]any{"taskId": "t1", "recurrence": map[string]any{"rrule": "FREQ=DAILY"}}, before: before},
		{name: "update_task custom fields", tool: "update_task", args: map[string]any{"taskId": "t1", "customFields": []any{}}, before: before},
		{name: "update_task placement", tool: "update_task", args: map[string]any{"taskId": "t1", "scheduledOn": "2026-11-10T09:00:00Z"}, before: before},
		{name: "update_task duration to a reminder", tool: "update_task", args: map[string]any{"taskId": "t1", "duration": 0}, before: before},
		{name: "update_task without a before", tool: "update_task", args: map[string]any{"taskId": "t1", "name": "x"}},
		{name: "update_task with another task's before", tool: "update_task", args: map[string]any{"taskId": "t9", "name": "x"}, before: before},
		{name: "bulk_update_tasks reads out of step", tool: "bulk_update_tasks", args: map[string]any{"ids": []string{"t2", "t1"}, "update": map[string]any{"priorityLevel": "high"}},
			before: rawJSON([]any{objectContent(taskPayload(sampleTask(nil))), objectContent(taskPayload(sampleTask(func(t *models.Task) { t.ID = "t2" })))})},
		{name: "toggle a missing checklist item", tool: "toggle_checklist_item", args: map[string]any{"taskId": "t1", "itemId": "c9", "completed": true}, before: before},
	}
	for _, tc := range cases {
		tc.run(t, c)
	}
}

func TestInverseOfOtherUpdatesRestoresTheBefore(t *testing.T) {
	c := NewCatalog(Deps{})
	event := &models.Event{ID: "e1", Title: "Dentist", StartAt: t0, EndAt: t0.Add(time.Hour), Color: ptr("#f00")}
	project := map[string]any{"project": &models.Project{ID: projID, Title: "Launch", Color: ptr("#0f0")}, "board": []any{}}
	doc := docPayload(&models.Document{ID: "d1", Title: "Notes", Order: 3, ParentID: ptr("d0")})
	sheet := map[string]any{"sheet": sheetBrief(&models.Sheet{ID: "s1", Title: "Budget", Tabs: models.SheetTabs{{ID: "tab1", Name: "Jan"}}}, true)}
	start, end := t0.Format(time.RFC3339), t0.Add(time.Hour).Format(time.RFC3339)
	cases := []undoCase{
		{name: "update_event time", tool: "update_event", args: map[string]any{"eventId": "e1", "start": "2026-11-10T09:00:00Z"}, before: js(event),
			want: []wantStep{{"update_event", map[string]any{"eventId": "e1", "start": start, "end": end, "allDay": false}}}},
		{name: "update_event title and color", tool: "update_event", args: map[string]any{"eventId": "e1", "title": "Doctor", "color": ""}, before: js(event),
			want: []wantStep{{"update_event", map[string]any{"eventId": "e1", "title": "Dentist", "color": "#f00"}}}},
		{name: "update_project", tool: "update_project", args: map[string]any{"projectId": projID, "title": "Go live", "deadline": "2026-12-01", "color": "#00f"}, before: js(project),
			want: []wantStep{{"update_project", map[string]any{"projectId": projID, "title": "Launch", "deadline": "", "color": "#0f0"}}}},
		{name: "complete_project", tool: "complete_project", args: map[string]any{"projectId": projID}, before: js(project),
			want: []wantStep{{"update_project", map[string]any{"projectId": projID, "completedAt": ""}}}},
		{name: "reopen_project", tool: "reopen_project", args: map[string]any{"projectId": projID}, before: js(map[string]any{"project": &models.Project{ID: projID, Title: "Launch", CompletedAt: ptr("2026-11-01T00:00:00Z")}}),
			want: []wantStep{{"update_project", map[string]any{"projectId": projID, "completedAt": "2026-11-01T00:00:00Z"}}}},
		{name: "rename_workspace", tool: "rename_workspace", args: map[string]any{"workspaceId": wsID, "name": "Home"}, before: js(&models.Workspace{ID: wsID, Name: "Work", Color: "#123"}),
			want: []wantStep{{"rename_workspace", map[string]any{"workspaceId": wsID, "name": "Work", "color": "#123"}}}},
		{name: "update_doc details", tool: "update_doc", args: map[string]any{"docId": "d1", "title": "Ideas", "archived": true, "parentId": "", "order": 0}, before: js(doc),
			want: []wantStep{{"update_doc", map[string]any{"docId": "d1", "title": "Notes", "archived": false, "parentId": "d0", "order": 3}}}},
		{name: "update_sheet details", tool: "update_sheet", args: map[string]any{"sheetId": "s1", "title": "Spend", "isFavorite": true}, before: js(sheet),
			want: []wantStep{{"update_sheet", map[string]any{"sheetId": "s1", "title": "Budget", "isFavorite": false}}}},
		{name: "update_sheet_template", tool: "update_sheet_template", args: map[string]any{"templateId": "tpl1", "name": "New"}, before: js(templateBrief(&models.SheetTemplate{ID: "tpl1", Name: "Monthly"})),
			want: []wantStep{{"update_sheet_template", map[string]any{"templateId": "tpl1", "name": "Monthly"}}}},
		{name: "rename_sheet_tab by name", tool: "rename_sheet_tab", args: map[string]any{"sheetId": "s1", "tabId": "Jan", "name": "January"}, before: js(sheet),
			want: []wantStep{{"rename_sheet_tab", map[string]any{"sheetId": "s1", "tabId": "tab1", "name": "Jan"}}}},

		// No safe inverse.
		{name: "update_event recurrence", tool: "update_event", args: map[string]any{"eventId": "e1", "recurrence": map[string]any{"rrule": "FREQ=WEEKLY"}}, before: js(event)},
		{name: "update_event with a task's before", tool: "update_event", args: map[string]any{"eventId": "e1", "title": "x"}, before: js(taskPayload(sampleTask(nil)))},
		{name: "update_project description", tool: "update_project", args: map[string]any{"projectId": projID, "description": "x"}, before: js(project)},
		{name: "update_doc body", tool: "update_doc", args: map[string]any{"docId": "d1", "markdown": "# new"}, before: js(doc)},
		{name: "update_sheet rows", tool: "update_sheet", args: map[string]any{"sheetId": "s1", "rows": []any{}}, before: js(sheet)},
		{name: "rename_sheet_tab without tab", tool: "rename_sheet_tab", args: map[string]any{"sheetId": "s1", "name": "January"}, before: js(sheet)},
	}
	for _, tc := range cases {
		tc.run(t, c)
	}
}

func TestInverseOfPlacementPutsTheOldPlacementBack(t *testing.T) {
	c := NewCatalog(Deps{})
	block := models.ScheduledBlock{ID: "b1", TaskID: "t1", StartAt: t0, EndAt: t0.Add(time.Hour), Source: "auto"}
	booked := sampleTask(func(t *models.Task) {
		t.Blocks = []models.ScheduledBlock{block, {ID: "b2", TaskID: "t1", StartAt: t0.Add(3 * time.Hour), EndAt: t0.Add(4 * time.Hour), Source: "manual"}}
	})
	before := js(taskPayload(sampleTask(func(t *models.Task) { t.Blocks = []models.ScheduledBlock{block} })))
	reminder := js(taskPayload(sampleTask(func(t *models.Task) {
		t.Kind, t.Duration, t.ScheduledOn = models.KindReminder, 0, ptr("2026-11-09T08:00:00Z")
	})))
	cases := []undoCase{
		{name: "move_block", tool: "move_block", args: map[string]any{"blockId": "b1", "start": "2026-11-10T14:00:00Z"}, before: js(block),
			want: []wantStep{{"move_block", map[string]any{"blockId": "b1", "start": t0.Format(time.RFC3339), "end": t0.Add(time.Hour).Format(time.RFC3339)}}}},
		{name: "schedule_task books time", tool: "schedule_task", args: map[string]any{"taskId": "t1", "start": "2026-11-09T12:00:00Z"}, result: js(booked), before: before,
			want: []wantStep{{"delete_block", map[string]any{"id": "b2"}}}},
		{name: "schedule_task on a reminder", tool: "schedule_task", args: map[string]any{"taskId": "t1", "start": "2026-11-09T12:00:00Z"}, result: js(booked), before: reminder,
			want: []wantStep{{"update_task", map[string]any{"taskId": "t1", "scheduledOn": "2026-11-09T08:00:00Z"}}}},
		{name: "auto_schedule_apply", tool: "auto_schedule_apply", args: map[string]any{}, result: js(map[string]any{}),
			want: []wantStep{{"undo_schedule", map[string]any{}}}},

		// No safe inverse.
		{name: "schedule_task replacing blocks", tool: "schedule_task", args: map[string]any{"taskId": "t1", "start": "2026-11-09T12:00:00Z", "replace": true}, result: js(booked), before: before},
		{name: "move_block with another block's before", tool: "move_block", args: map[string]any{"blockId": "b9", "start": "2026-11-10T14:00:00Z"}, before: js(block)},
		{name: "pin_block", tool: "pin_block", args: map[string]any{"blockId": "b1", "locked": true}, before: js(block)},
	}
	for _, tc := range cases {
		tc.run(t, c)
	}
}

func TestInversePlanUndoesLastStepFirstWithReferencesResolved(t *testing.T) {
	c := NewCatalog(Deps{})
	steps := []AppliedStep{
		{Tool: "create_label", Arguments: json.RawMessage(`{"name":"Errand","workspaceId":"ws1"}`), Result: js(&models.Lable{ID: "lab9", Name: "Errand"})},
		{Tool: "set_task_labels", Arguments: json.RawMessage(`{"taskId":"t1","labelIds":["$0.id"]}`), Result: js(taskPayload(sampleTask(nil))), Before: js(taskPayload(sampleTask(nil)))},
		{Tool: "create_task", Arguments: json.RawMessage(`{"name":"Buy stamps","workspaceId":"ws1","labelIds":["$0.id"]}`), Result: js(taskPayload(sampleTask(func(t *models.Task) { t.ID = "t5" })))},
	}
	plan, ok := InversePlan(steps)
	if !ok {
		t.Fatal("no undo plan")
	}
	got := []string{}
	for _, s := range plan {
		got = append(got, s.Tool)
		checkUndoStep(t, c, s)
	}
	if want := []string{"delete_task", "update_task", "delete_label"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("undo order %v, want %v", got, want)
	}
	if string(plan[2].Arguments) != `{"id":"lab9","workspaceId":"ws1"}` {
		t.Errorf("label removal arguments %s", plan[2].Arguments)
	}

	// One step without an inverse means no Undo for the proposal.
	steps = append(steps, AppliedStep{Tool: "add_task_comment", Arguments: json.RawMessage(`{"taskId":"t1","comment":"hi"}`), Result: json.RawMessage(`{}`)})
	if _, ok := InversePlan(steps); ok {
		t.Error("a plan with a comment must have no undo")
	}
	// A reference to a later step is refused.
	bad := []AppliedStep{{Tool: "create_task", Arguments: json.RawMessage(`{"name":"x","projectId":"$1.id"}`), Result: js(taskPayload(sampleTask(nil)))}}
	if _, ok := InversePlan(bad); ok {
		t.Error("a forward reference must not resolve")
	}
}

func rawJSON(v any) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

// A change made inside an object the same proposal created is undone by
// removing that object, even when the change has no inverse of its own.
func TestInversePlanCoversChangesInsideWhatItCreated(t *testing.T) {
	c := NewCatalog(Deps{})
	made := js(taskPayload(sampleTask(func(t *models.Task) { t.ID = "t5" })))
	steps := []AppliedStep{
		{Tool: "create_task", Arguments: json.RawMessage(`{"name":"Trip","workspaceId":"ws1"}`), Result: made},
		{Tool: "add_checklist_item", Arguments: json.RawMessage(`{"taskId":"$0.task.id","title":"Pack"}`), Result: made},
		{Tool: "add_task_comment", Arguments: json.RawMessage(`{"taskId":"$0.task.id","comment":"Book early"}`), Result: json.RawMessage(`{}`)},
		// An event linked to the task is its own object: it is removed by itself.
		{Tool: "create_event", Arguments: json.RawMessage(`{"title":"Flight","start":"2026-11-10T09:00:00Z","end":"2026-11-10T11:00:00Z","taskId":"$0.task.id"}`), Result: js(&models.Event{ID: "e5", StartAt: t0, EndAt: t0})},
	}
	plan, ok := InversePlan(steps)
	if !ok {
		t.Fatal("no undo plan")
	}
	got := []string{}
	for _, s := range plan {
		got = append(got, s.Tool+" "+string(s.Arguments))
		checkUndoStep(t, c, s)
	}
	want := []string{`delete_event {"eventId":"e5"}`, `delete_task {"taskId":"t5"}`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("undo plan %v, want %v", got, want)
	}

	planned := make([]PlannedStep, len(steps))
	for i, s := range steps {
		planned[i] = PlannedStep{Tool: s.Tool, Arguments: s.Arguments}
	}
	if !UndoablePlan(planned) {
		t.Error("UndoablePlan must agree with InversePlan for changes inside a created task")
	}
	// The same comment on an existing task has no undo.
	if UndoablePlan([]PlannedStep{{Tool: "add_task_comment", Arguments: json.RawMessage(`{"taskId":"t1","comment":"x"}`)}}) {
		t.Error("a comment on an existing task is not undoable")
	}
	// A reference to something other than the created id is not covered.
	if UndoablePlan([]PlannedStep{planned[0], {Tool: "add_task_comment", Arguments: json.RawMessage(`{"taskId":"$0.task.projectId","comment":"x"}`)}}) {
		t.Error("only the created object's own id covers a step")
	}
	if UndoablePlan(nil) {
		t.Error("an empty plan has nothing to undo")
	}
}
