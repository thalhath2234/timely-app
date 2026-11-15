package portability

import (
	"encoding/json"
	"testing"

	"timely-api/internal/features/bots"
	"timely-api/internal/models"
)

// An agent Bot's backup carries its prompt, schedule and notepad (bot_notes);
// what it may reach comes back switched off: no signed-in browser site and no
// extra host (Q-B2), the Bot thread it names is let go, and a proposal that
// was approved but never applied waits for the person again.
func TestIntegrationBackupKeepsAgentBots(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_agent_bots"
	if err := db.Create(&models.User{ID: uid, Email: "agent-bots@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	count := func(query string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := db.Raw(query, args...).Scan(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at, engine, prompt, schedule, tools, egress, gate, permission, use_memory, thread_id, skills)
		VALUES ('bot_agent', ?, 'Pixel', 900, now(), 'agent', 'Watch the Pixel and say when it is in stock', '{"everyMinutes": 15}',
		        '{"browserSites": ["flipkart.com"], "egress": ["example.com"], "useMemory": true, "mcp": {"gmail": "use"}}', '["example.com"]',
		        'always', 'full', true, 'chat_thread', '["product-price-monitor"]')`, uid)
	exec(`INSERT INTO agent_conversations (id, user_id, title, kind, bot_id) VALUES ('chat_thread', ?, 'Pixel', 'bot_thread', 'bot_agent')`, uid)
	exec(`INSERT INTO bot_notes (bot_id, user_id, key, value) VALUES ('bot_agent', ?, 'last price', '89999'), ('bot_agent', ?, 'seen', 'a,b')`, uid, uid)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, proposal, proposal_state, fingerprint)
		VALUES ('bal_proposal', 'bot_agent', ?, 'alert', '2026-11-15', 'Pixel in stock', '{"tool": "create_task"}', 'approved', 'abc')`, uid)

	service := NewService(db, nil)
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(backup.Rows["bot_notes"]); got != 2 {
		t.Fatalf("export bot_notes: %d rows, want 2", got)
	}
	for _, raw := range backup.Rows["bot_notes"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil || row["id"] == nil || row["bot_id"] != "bot_agent" || row["user_id"] != uid {
			t.Fatalf("exported note: %s", raw)
		}
	}
	if _, ok := backup.Rows["bot_checks"]; ok {
		t.Fatal("export carries bot_checks")
	}

	// Replace: a note written after the export is gone after the restore.
	exec(`INSERT INTO bot_notes (bot_id, user_id, key, value) VALUES ('bot_agent', ?, 'later', 'x')`, uid)
	result, err := service.Restore(uid, backup)
	if err != nil {
		t.Fatal(err)
	}
	if result.Counts["bots"] != 1 || result.Counts["bot_notes"] != 2 {
		t.Fatalf("restore counts: %v", result.Counts)
	}
	if n := count(`SELECT count(*) FROM bot_notes WHERE bot_id = 'bot_agent' AND user_id = ? AND ((key = 'last price' AND value = '89999') OR (key = 'seen' AND value = 'a,b'))`, uid); n != 2 {
		t.Fatalf("%d notes came back", n)
	}
	if n := count(`SELECT count(*) FROM bot_notes WHERE key = 'later'`); n != 0 {
		t.Fatal("a note made after the export survived the restore")
	}
	// Prompt, schedule, skills, memory and permission are the Bot's own and stay;
	// the browser sites and extra hosts are off; it has no Reads and is not
	// paused for it; its thread was not in the file.
	if n := count(`SELECT count(*) FROM bots WHERE id = 'bot_agent' AND engine = 'agent' AND status = 'active' AND prompt = 'Watch the Pixel and say when it is in stock'
		AND schedule = '{"everyMinutes": 15}' AND skills = '["product-price-monitor"]' AND permission = 'full' AND use_memory AND gate = 'always'
		AND tools->'browserSites' = '[]' AND tools->'egress' = '[]' AND tools->'mcp' = '{"gmail": "use"}' AND egress = '[]' AND thread_id IS NULL`); n != 1 {
		t.Fatal("the agent Bot did not come back as expected")
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_proposal' AND proposal_state = 'pending' AND proposal = '{"tool": "create_task"}'`); n != 1 {
		t.Fatal("an approved proposal did not come back pending")
	}

	// An outside app restores with less: auto permission, no memory, skills or
	// model, no proposals, the Bot paused.
	if _, err := service.RestoreFromMCP(uid, backup); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM bots WHERE id = 'bot_agent' AND status = 'paused' AND pause_reason = 'mcp' AND permission = 'auto' AND NOT use_memory
		AND skills = '[]' AND model = '' AND model_provider = '' AND tools->'browserSites' = '[]' AND egress = '[]'`); n != 1 {
		t.Fatal("the agent Bot kept reach an outside app may not give")
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_proposal' AND proposal_state = '' AND proposal IS NULL`); n != 1 {
		t.Fatal("an outside app brought back a proposal")
	}
	if n := count(`SELECT count(*) FROM bot_notes WHERE bot_id = 'bot_agent'`); n != 2 {
		t.Fatalf("%d notes after the outside restore", n)
	}
}
