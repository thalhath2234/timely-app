package agent

import "testing"

// Taint is only as complete as the list of untrusted sources (plan 9b.5):
// a Read tool added without a decision fails here.
func TestEveryReadToolHasTaint(t *testing.T) {
	c := NewCatalog(Deps{})
	reads := 0
	for name, tool := range c {
		if tool.Authority.Access != Read {
			continue
		}
		reads++
		if !taintClassified(name) {
			t.Errorf("Read tool %s has no taint classification: add it to readTaint in outside.go (true when its result can carry third-party text)", name)
		}
	}
	for name := range readTaint {
		tool, ok := c[name]
		if !ok || tool.Authority.Access != Read {
			t.Errorf("readTaint lists %s, which is not a chat Read tool", name)
		}
	}
	if reads == 0 {
		t.Fatal("no Read tools found")
	}
}

func TestOutsideToolKeepsTheBotReads(t *testing.T) {
	// The set the classic engine marks today (chat/bot_tags.go outsideReads).
	for _, name := range []string{"preview_bot", "ask_bot", "list_bot_findings", "list_bots"} {
		if !OutsideTool(name) {
			t.Errorf("%s must be outside: it carries text bots read from pages", name)
		}
	}
	// Bot alerts are notifications written from what a bot read.
	if !OutsideTool("list_notifications") {
		t.Error("list_notifications must be outside: bot alert bodies quote pages")
	}
	for _, name := range []string{"get_task", "get_doc", "get_bot", "get_context", "search", "unread_notification_count"} {
		if OutsideTool(name) {
			t.Errorf("%s reads the person's own data and must not be outside", name)
		}
	}
	for _, name := range []string{"create_task", "update_bot", "export_account", "no_such_tool", ""} {
		if OutsideTool(name) {
			t.Errorf("%s is not a Read tool and must report false", name)
		}
	}
}
