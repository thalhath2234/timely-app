package agent

// Taint classification of the chat's Read tools (plan 5.2 and 9b.5).
//
// A read is "outside" when its result can carry text written by someone other
// than the person: a page, a feed or a price source a Bot read, or an alert
// built from one. A run that called an outside read has its proposals
// reviewed (ForceReview), and the agent engine records the source in the
// conversation's tainted_sources, so text a page planted cannot steer a change
// that would otherwise apply on its own.
//
// Every Read tool is listed here, true or false. TestEveryReadToolHasTaint
// fails when a Read tool is added without a decision, so a new source of
// third-party text cannot slip in unmarked.
var readTaint = map[string]bool{
	// Bots read third-party pages, feeds and prices.
	"ask_bot":           true, // the bot's latest readings and findings
	"list_bot_findings": true, // the findings board
	"list_bots":         true, // a short summary of each bot's last reading
	"preview_bot":       true, // reads the watched pages now
	// Bot alerts are notifications whose words come from what a bot read.
	"list_notifications": true,

	// The person's own data, and what Timely works out from it.
	"auto_schedule_preview":     false,
	"get_agenda":                false,
	"get_bot":                   false, // settings only: watches, rules, schedule, links
	"get_calendar":              false,
	"get_capacity":              false,
	"get_context":               false,
	"get_doc":                   false,
	"get_doc_backlinks":         false,
	"get_event":                 false,
	"get_free_time":             false,
	"get_goal_progress":         false,
	"get_notification_settings": false,
	"get_project":               false,
	"get_schedule_settings":     false,
	"get_sheet":                 false,
	"get_sheet_template":        false,
	"get_sheet_values":          false,
	"get_task":                  false,
	"get_today":                 false,
	"get_today_suggestions":     false,
	"get_working_hours":         false,
	"get_workspace":             false,
	"list_doc_versions":         false,
	"list_docs":                 false,
	"list_events":               false,
	"list_focus_sessions":       false,
	"list_goals":                false,
	"list_habits":               false,
	"list_inbox":                false,
	"list_projects":             false,
	"list_sheet_templates":      false,
	"list_sheets":               false,
	"list_stale_work":           false,
	"list_task_views":           false,
	"list_tasks":                false,
	"list_workspaces":           false,
	"pick_tasks":                false,
	"search":                    false,
	"semantic_search":           false,
	"undo_schedule_preview":     false,
	"unread_notification_count": false,
	"what_next":                 false,
}

// OutsideTool reports whether a Read tool's result carries text from
// third-party pages, feeds or alerts built from them. Unknown names, writes
// and MCP-only tools report false: they never reach chat as reads.
func OutsideTool(name string) bool {
	return readTaint[name]
}

// taintClassified reports whether a Read tool has an explicit decision above.
func taintClassified(name string) bool {
	_, ok := readTaint[name]
	return ok
}
