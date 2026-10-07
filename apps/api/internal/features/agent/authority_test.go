package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The expected authority of every tool. A tool that is registered but missing
// here, or listed here but not registered, fails TestEveryToolDeclaresAuthority,
// so adding a tool means deciding its authority in the registration (which
// cannot compile without one) and recording the decision in this table.
var expectedAuthority = []struct {
	access   Access
	approval Approval
	tools    string
}{
	// Run immediately during a chat turn.
	{Read, Applies, `
	auto_schedule_preview get_agenda get_calendar get_capacity get_context get_doc get_event get_free_time
	get_notification_settings get_project get_schedule_settings get_sheet get_sheet_template get_task get_today
	get_working_hours get_workspace list_docs list_events list_inbox list_notifications list_projects
	list_sheet_templates list_sheets list_tasks list_workspaces search semantic_search undo_schedule_preview
	unread_notification_count what_next`},
	// Applied directly when the plan is one clear step.
	{Write, Applies, `
	add_checklist_item add_sheet_column add_sheet_tab add_task_comment append_to_doc capture_inbox_item
	clarify_inbox_item complete_project complete_task create_custom_field create_doc create_event create_label
	create_project create_sheet_template create_stage create_status create_task create_workspace move_block
	move_task_to_stage move_task_to_status pause_focus pin_block pin_task rename_sheet_tab rename_workspace
	reopen_project reopen_task reorder_stages schedule_task set_task_custom_field set_task_dependency
	set_task_labels set_today_focus snooze_reminder start_focus stop_focus toggle_checklist_item
	update_checklist_item update_custom_field update_label update_project update_sheet_template update_stage
	update_status`},
	// Always need an Agent proposal: removing a component of an entity (not the entity), recurring series, bulk edits, calendar-wide changes.
	{Write, Reviewed, `
	add_sheet_rows auto_schedule_apply bulk_update_tasks clear_task_blocks clear_task_recurrence delete_block
	delete_checklist_item delete_sheet_column delete_sheet_rows delete_sheet_tab edit_event_occurrence
	edit_task_occurrence set_task_recurrence split_event_series split_task_series undo_schedule`},
	// Need an Agent proposal depending on their arguments (TestArgumentRules).
	{Write, ReviewedWhen, `
	create_sheet mark_notification_read update_doc update_event update_sheet update_sheet_cells
	update_sheet_column update_task`},
	// External MCP clients only; chat never sees them.
	{MCPOnly, Applies, `
	archive_doc archive_sheet clear_notifications create_backup create_task_view download_backup
	duplicate_project duplicate_sheet duplicate_task export_account export_calendar export_doc export_tasks_csv
	get_backup_settings get_config get_job_health get_profile list_backups list_jobs list_project_activity
	list_task_activity list_task_views materialize_sheet_template_tab reindex_search replace_checklist
	reschedule_urgent restore_account retry_job set_active_task_view set_project_task_view update_account_config
	update_backup_settings update_profile update_schedule_settings update_task_view`},
	// External MCP only, and would be reviewed if chat ever gained them: whole-object deletion and settings (ADR 0007).
	{MCPOnly, Reviewed, `
	delete_backup delete_custom_field delete_doc delete_event delete_label delete_project delete_sheet
	delete_sheet_template delete_stage delete_status delete_task delete_task_view delete_workspace
	update_notification_settings update_working_hours`},
}

func TestEveryToolDeclaresAuthority(t *testing.T) {
	catalog := NewCatalog(Deps{})
	want := map[string]int{}
	for i, group := range expectedAuthority {
		for _, name := range strings.Fields(group.tools) {
			if _, dup := want[name]; dup {
				t.Errorf("%s is listed twice", name)
			}
			want[name] = i
		}
	}
	for name, tool := range catalog {
		i, listed := want[name]
		if !listed {
			t.Errorf("tool %s is registered but its authority is not in expectedAuthority", name)
			continue
		}
		group := expectedAuthority[i]
		if tool.Authority.Access != group.access || tool.Authority.Approval != group.approval {
			t.Errorf("%s declares access %d approval %d, want %d and %d", name, tool.Authority.Access, tool.Authority.Approval, group.access, group.approval)
		}
	}
	for name := range want {
		if _, registered := catalog[name]; !registered {
			t.Errorf("expectedAuthority lists %s, which is not registered", name)
		}
	}
}

// The MCP server and the in-app catalog come from the same registrations.
func TestMCPServerServesTheCatalog(t *testing.T) {
	ctx := context.Background()
	server, clientSide := mcp.NewInMemoryTransports()
	session, err := New(Deps{}).Connect(ctx, server, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	client, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	listed, err := client.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	catalog := NewCatalog(Deps{})
	if len(listed.Tools) != len(catalog) {
		t.Errorf("MCP serves %d tools, catalog has %d", len(listed.Tools), len(catalog))
	}
	for _, tool := range listed.Tools {
		if _, ok := catalog[tool.Name]; !ok {
			t.Errorf("MCP serves %s, which the catalog lacks", tool.Name)
		}
	}
}

func TestRegistrationRequiresAuthority(t *testing.T) {
	handler := func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, any, error) {
		return nil, nil, nil
	}
	register := func(authority Authority) (panicked bool) {
		defer func() { panicked = recover() != nil }()
		s := &Server{catalog: Catalog{}}
		registerTool(s, nil, &mcp.Tool{Name: "probe"}, authority, handler)
		return false
	}
	if !register(Authority{}) {
		t.Error("a tool without a declared authority registered")
	}
	if !register(reads.reviewed()) {
		t.Error("a read-only tool registered as needing review")
	}
	if !register(Authority{Access: Write, Approval: ReviewedWhen}) {
		t.Error("a conditionally reviewed tool registered without a rule")
	}
	if !register(Authority{Access: Write, Approval: ReviewedWhen + 1}) {
		t.Error("a tool with an unknown approval registered")
	}
	if register(writes) || register(mcpOnly.reviewed()) {
		t.Error("a valid declaration was rejected")
	}
}

func TestArgumentRules(t *testing.T) {
	tests := []struct {
		tool string
		args map[string]any
		want bool
	}{
		{"update_sheet_cells", map[string]any{"cells": map[string]any{"a": 1}}, false},
		{"update_sheet_cells", map[string]any{"cells": map[string]any{"a": 1, "b": 2}}, true},
		{"update_sheet_cells", nil, true},
		{"update_sheet", map[string]any{"title": "x"}, false},
		{"update_sheet", map[string]any{"merges": nil}, true},
		{"update_sheet_column", map[string]any{"type": "number"}, true},
		{"update_sheet_column", map[string]any{"options": []any{"a"}}, true},
		{"update_sheet_column", map[string]any{"name": "Cost", "width": 120}, false},
		{"create_sheet", map[string]any{"templateId": ""}, false},
		{"create_sheet", map[string]any{"templateId": "tst"}, true},
		{"update_doc", map[string]any{"markdown": ""}, true},
		{"update_task", map[string]any{"clearRecurrence": false}, true},
		{"update_event", map[string]any{"title": "x"}, false},
		{"mark_notification_read", map[string]any{"id": "ntf"}, false},
		{"mark_notification_read", nil, true},
		{"delete_task", nil, true},
		{"delete_sheet_rows", nil, true},
		{"create_task", nil, false},
	}
	for _, tt := range tests {
		authority, ok := AuthorityOf(tt.tool)
		if !ok {
			t.Fatalf("no authority for %s", tt.tool)
		}
		if got := authority.NeedsProposal(tt.args); got != tt.want {
			t.Errorf("%s %v: needs proposal=%v want %v", tt.tool, tt.args, got, tt.want)
		}
	}
	if _, ok := AuthorityOf("no_such_tool"); ok {
		t.Error("unknown tool has an authority")
	}
}

// Tools whose review shows the current state of something they change.
func TestReviewShowsCurrentState(t *testing.T) {
	want := map[string]struct {
		read     string
		withArgs bool
	}{
		"undo_schedule":       {"undo_schedule_preview", false},
		"auto_schedule_apply": {"auto_schedule_preview", true},
	}
	catalog := NewCatalog(Deps{})
	for name, tool := range catalog {
		w, ok := want[name]
		if tool.Authority.Showing != w.read || tool.Authority.ShowingStepArguments != w.withArgs {
			t.Errorf("%s shows %q (step arguments %v), want %q (%v)", name, tool.Authority.Showing, tool.Authority.ShowingStepArguments, w.read, w.withArgs)
		}
		if ok && catalog[w.read].Authority.Access != Read {
			t.Errorf("%s shows %s, which is not a read tool", name, w.read)
		}
	}
}

// Whole-object deletion and settings are outside the in-app agent's initial
// authority (ADR 0007); removing a component of an entity is not.
func TestChatCannotDeleteWholeObjectsOrChangeSettings(t *testing.T) {
	for _, name := range strings.Fields(`delete_task delete_event delete_doc delete_sheet delete_label delete_stage
		delete_project delete_workspace delete_status delete_custom_field delete_sheet_template delete_task_view
		update_working_hours update_notification_settings update_schedule_settings update_account_config
		update_backup_settings create_backup restore_account`) {
		authority, ok := AuthorityOf(name)
		if !ok || authority.Access != MCPOnly {
			t.Errorf("%s must be MCP-only, got %+v", name, authority.Access)
		}
	}
	for _, name := range strings.Fields(`delete_block delete_checklist_item delete_sheet_column delete_sheet_rows delete_sheet_tab`) {
		authority, ok := AuthorityOf(name)
		if !ok || authority.Access != Write || authority.Approval != Reviewed {
			t.Errorf("%s must be a reviewed chat write", name)
		}
	}
}
