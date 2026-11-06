package portability

import (
	"encoding/json"
	"testing"

	"timely-api/internal/models"
)

// A backup carries the account's Bots, watches, alerts, lessons, findings and
// price days, but not the check log. Restored watches record a quiet baseline
// first, and links to the check log come back NULL.
func TestIntegrationBackupKeepsBots(t *testing.T) {
	db := migratedDB(t)
	const uid, other = "usr_portability_bots", "usr_portability_bots_other"
	for _, row := range []any{
		&models.User{ID: uid, Email: "bots@example.invalid", Password: "not-a-real-hash"},
		&models.User{ID: other, Email: "bots-other@example.invalid", Password: "not-a-real-hash"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedAccountBasics(t, db, uid, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at, checking_job_id, check_started_at, health)
		VALUES ('bot_1', ?, 'BTC dip', 900, now(), 'job_running', now(), 'ok'),
		       ('bot_x', ?, 'Theirs', 900, now(), NULL, NULL, 'ok')`, uid, other)
	exec(`INSERT INTO bots (id, user_id, name, status, pause_reason, interval_seconds) VALUES ('bot_2', ?, 'Paused one', 'paused', 'mcp', 3600)`, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, source, symbol, currency, rules, rule_state, last_reading, baseline_pending)
		VALUES ('bw_1', 'bot_1', ?, 'price', 'coinbase', 'BTC', 'USD', '[{"id":"r1","kind":"below","value":25000}]', '{"r1":{"armed":false}}', '{"price":24900}', false)`, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url, read_mode, baseline_pending)
		VALUES ('bw_2', 'bot_2', ?, 'page', 'https://example.com/', 'text', false)`, uid)
	exec(`INSERT INTO bot_checks (id, bot_id, user_id, trigger, started_at, finished_at, outcome) VALUES ('bchk_1', 'bot_1', ?, 'schedule', now(), now(), 'fired')`, uid)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, check_id, notification_id, kind, local_day, title) VALUES ('bal_1', 'bot_1', ?, 'bchk_1', 'ntf_1', 'alert', '2026-11-06', 'BTC dip: below 25,000')`, uid)
	exec(`INSERT INTO bot_lessons (id, bot_id, user_id, alert_id, text) VALUES ('bls_1', 'bot_1', ?, 'bal_1', 'Only dips under 25k matter')`, uid)
	exec(`INSERT INTO bot_findings (id, bot_id, user_id, check_id, watch_id, kind, title, price, currency, alerted, digested_at)
		VALUES ('bfd_1', 'bot_1', ?, 'bchk_1', 'bw_1', 'price', 'below 25,000', 24900.5, 'USD', true, now())`, uid)
	exec(`INSERT INTO bot_price_days (watch_id, day, bot_id, user_id, currency, points, open, high, low, close)
		VALUES ('bw_1', '2026-11-05', 'bot_1', ?, 'USD', '[[1762300800, 27499], [1762304400, 24900.5]]', 27499, 27499, 24900.5, 24900.5),
		       ('bw_1', '2026-11-06', 'bot_1', ?, 'USD', '[[1762387200, 24800]]', 24800, 24800, 24800, 24800)`, uid, uid)

	service := NewService(db, nil)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	for table, want := range map[string]int{"bots": 2, "bot_watches": 2, "bot_alerts": 1, "bot_lessons": 1, "bot_findings": 1, "bot_price_days": 2} {
		if got := len(backup.Rows[table]); got != want {
			t.Fatalf("export %s: %d rows, want %d", table, got, want)
		}
	}
	for _, table := range []string{"bot_checks", "bot_sites", "bot_robots"} {
		if _, ok := backup.Rows[table]; ok {
			t.Fatalf("export carries %s", table)
		}
	}
	for _, raw := range backup.Rows["bot_watches"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil || row["baseline_pending"] != true {
			t.Fatalf("exported watch is not baseline_pending: %s", raw)
		}
	}
	var day map[string]any
	if err := json.Unmarshal(backup.Rows["bot_price_days"][0], &day); err != nil || day["id"] != "bw_1:2026-11-05" {
		t.Fatalf("price day id: %s", backup.Rows["bot_price_days"][0])
	}

	// Replace: a Bot made after the export is gone after the restore.
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at) VALUES ('bot_new', ?, 'Made later', 900, now())`, uid)
	result, err := service.Restore(uid, backup)
	if err != nil {
		t.Fatal(err)
	}
	if result.Counts["bots"] != 2 || result.Counts["bot_price_days"] != 2 {
		t.Fatalf("restore counts: %v", result.Counts)
	}
	count := func(query string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := db.Raw(query, args...).Scan(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM bots WHERE user_id = ?`, uid); n != 2 {
		t.Fatalf("restored bots: %d", n)
	}
	if n := count(`SELECT count(*) FROM bots WHERE id = 'bot_new'`); n != 0 {
		t.Fatal("restore kept a Bot made after the export")
	}
	if n := count(`SELECT count(*) FROM bots WHERE id = 'bot_2' AND status = 'paused' AND pause_reason = 'mcp' AND next_check_at IS NULL`); n != 1 {
		t.Fatal("paused Bot did not round-trip")
	}
	if n := count(`SELECT count(*) FROM bot_watches WHERE user_id = ? AND baseline_pending`, uid); n != 2 {
		t.Fatalf("watches with baseline_pending: %d of 2", n)
	}
	if n := count(`SELECT count(*) FROM bot_watches WHERE id = 'bw_1' AND rule_state = '{"r1":{"armed":false}}' AND last_reading = '{"price":24900}' AND rules @> '[{"id":"r1"}]'`); n != 1 {
		t.Fatal("watch rules, state or reading did not round-trip")
	}
	if n := count(`SELECT count(*) FROM bot_checks WHERE user_id = ?`, uid); n != 0 {
		t.Fatalf("check log came back: %d rows", n)
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_1' AND check_id IS NULL AND notification_id = 'ntf_1' AND local_day = '2026-11-06'`); n != 1 {
		t.Fatal("alert did not round-trip with check_id NULL")
	}
	if n := count(`SELECT count(*) FROM bot_lessons WHERE id = 'bls_1' AND alert_id = 'bal_1'`); n != 1 {
		t.Fatal("lesson lost its alert")
	}
	if n := count(`SELECT count(*) FROM bot_findings WHERE id = 'bfd_1' AND check_id IS NULL AND watch_id = 'bw_1' AND price = 24900.5 AND alerted AND digested_at IS NOT NULL`); n != 1 {
		t.Fatal("finding did not round-trip")
	}
	if n := count(`SELECT count(*) FROM bot_price_days WHERE watch_id = 'bw_1' AND day = '2026-11-05' AND points = '[[1762300800, 27499], [1762304400, 24900.5]]' AND low = 24900.5`); n != 1 {
		t.Fatal("price day did not round-trip")
	}

	// A crafted watch on another account's Bot is refused, and nothing changes.
	// It is a full exported row, so only the ownership check can refuse it.
	var crafted map[string]any
	if err := json.Unmarshal(backup.Rows["bot_watches"][1], &crafted); err != nil {
		t.Fatal(err)
	}
	crafted["id"], crafted["bot_id"] = "bw_x", "bot_x"
	raw, _ := json.Marshal(crafted)
	backup.Rows["bot_watches"] = append(backup.Rows["bot_watches"], raw)
	if _, err := service.Restore(uid, backup); err == nil {
		t.Fatal("restore accepted a watch on another account's Bot")
	}
	if n := count(`SELECT count(*) FROM bot_watches WHERE bot_id = 'bot_x'`); n != 0 {
		t.Fatalf("foreign Bot got %d watches", n)
	}
	if n := count(`SELECT count(*) FROM bots WHERE user_id = ?`, uid); n != 2 {
		t.Fatalf("refused restore changed the Bots: %d", n)
	}
}
