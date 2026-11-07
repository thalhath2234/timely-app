package portability

import (
	"encoding/json"
	"testing"

	"timely-api/internal/features/bots"
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
	for _, n := range []models.Notification{{ID: "ntf_1", UserID: uid, Category: models.NotifyBot, Title: "BTC dip: below 25,000"},
		{ID: "ntf_theirs", UserID: other, Category: models.NotifyBot, Title: "Theirs"}} {
		if err := db.Create(&n).Error; err != nil {
			t.Fatal(err)
		}
	}
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
	for _, table := range []string{"bot_checks", "bot_sites", "bot_robots", "bot_site_icons", "bot_source_keys", "bot_ai_calls"} {
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

	// A crafted alert pointing at another account's notification keeps
	// the alert but drops the link, so a "more" bump cannot rewrite it.
	var alert map[string]any
	if err := json.Unmarshal(backup.Rows["bot_alerts"][0], &alert); err != nil {
		t.Fatal(err)
	}
	alert["notification_id"] = "ntf_theirs"
	rawAlert, _ := json.Marshal(alert)
	backup.Rows["bot_alerts"][0] = rawAlert
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_1' AND notification_id IS NULL`); n != 1 {
		t.Fatal("a restored alert kept another account's notification id")
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

// Restored Bots get the checks a save makes, and an outside app's restore
// cannot turn a Bot or its alert settings on.
func TestIntegrationRestoreVetsBots(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_vet"
	if err := db.Create(&models.User{ID: uid, Email: "vet@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at, urgent, notify_phone, judge_mode) VALUES
		('bot_fast', ?, 'Too fast', 300, now(), false, true, 'rules'),
		('bot_has', ?, 'Has selector', 900, now(), false, true, 'rules'),
		('bot_loud', ?, 'Urgent price', 900, now(), true, false, 'ai')`, uid, uid, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url, read_mode, selector) VALUES
		('bw_fast', 'bot_fast', ?, 'page', 'https://example.com/', 'product_price', ''),
		('bw_has', 'bot_has', ?, 'page', 'https://example.com/', 'selector', 'div:has(div:has(p))')`, uid, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, source, symbol, currency) VALUES ('bw_loud', 'bot_loud', ?, 'price', 'coinbase', 'BTC', 'USD')`, uid)

	service := NewService(db, nil)
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	type row struct {
		ID, Status, JudgeMode, Health string
		PauseReason                   *string
		IntervalSeconds               int
		Urgent, NotifyPhone           bool
	}
	read := func() map[string]row {
		t.Helper()
		var rows []row
		if err := db.Raw(`SELECT id, status, judge_mode, health, pause_reason, interval_seconds, urgent, notify_phone FROM bots WHERE user_id = ?`, uid).Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		out := map[string]row{}
		for _, r := range rows {
			out[r.ID] = r
		}
		return out
	}

	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	got := read()
	if r := got["bot_fast"]; r.Status != "active" || r.IntervalSeconds != 6*3600 {
		t.Fatalf("a shop price restored under its floor: %+v", r)
	}
	if r := got["bot_has"]; r.Status != "paused" || r.PauseReason == nil || *r.PauseReason != "person" || r.Health != "unsupported" {
		t.Fatalf("a watch Timely cannot use came back on: %+v", r)
	}
	if r := got["bot_loud"]; r.Status != "active" || !r.Urgent || r.NotifyPhone || r.JudgeMode != "ai" {
		t.Fatalf("the person's own restore changed alert settings: %+v", r)
	}

	// The same backup, edited by an outside app and restored over MCP.
	for i, raw := range backup.Rows["bots"] {
		var b map[string]any
		if err := json.Unmarshal(raw, &b); err != nil {
			t.Fatal(err)
		}
		b["status"], b["pause_reason"], b["urgent"], b["notify_phone"] = "active", nil, true, true
		backup.Rows["bots"][i], _ = json.Marshal(b)
	}
	if _, err := service.RestoreFromMCP(uid, backup); err != nil {
		t.Fatal(err)
	}
	for id, r := range read() {
		if r.Status != "paused" || r.Urgent || !r.NotifyPhone || r.JudgeMode != "rules" {
			t.Fatalf("%s restored over MCP: %+v", id, r)
		}
		if want := map[string]string{"bot_has": "person"}[id]; want == "" && *r.PauseReason != "mcp" {
			t.Fatalf("%s pause reason %s", id, *r.PauseReason)
		}
	}
	var next int64
	if err := db.Raw(`SELECT count(*) FROM bots WHERE user_id = ? AND next_check_at IS NOT NULL`, uid).Scan(&next).Error; err != nil || next != 0 {
		t.Fatalf("%d paused bots still scheduled (%v)", next, err)
	}
}

// A backup made before Bots named their outside app has no origin_client;
// it restores with the column's default instead of failing on NULL.
func TestIntegrationRestoreBotWithoutOriginClient(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_bot_origin"
	if err := db.Create(&models.User{ID: uid, Email: "origin@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	if err := db.Exec(`INSERT INTO bots (id, user_id, name, origin, origin_client, status, pause_reason, interval_seconds)
		VALUES ('bot_old', ?, 'Old one', 'mcp', 'Claude Code', 'paused', 'mcp', 900)`, uid).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(db, nil)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	var row map[string]any
	if err := json.Unmarshal(backup.Rows["bots"][0], &row); err != nil || row["origin_client"] != "Claude Code" {
		t.Fatalf("export: %s", backup.Rows["bots"][0])
	}
	delete(row, "origin_client")
	backup.Rows["bots"][0], _ = json.Marshal(row)
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatalf("restore of an older backup: %v", err)
	}
	var n int64
	if err := db.Raw(`SELECT count(*) FROM bots WHERE id = 'bot_old' AND user_id = ? AND origin_client = ''`, uid).Scan(&n).Error; err != nil || n != 1 {
		t.Fatalf("restored bot: %d (%v)", n, err)
	}
}

// A backup carries the person's ratings of alerts and their alert switches
// for new Bots, and a backup made before either existed restores with none
// and the default switches.
func TestIntegrationBackupKeepsAlertFeedbackAndDefaults(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_bot_feedback"
	if err := db.Create(&models.User{ID: uid, Email: "feedback@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE configs SET bot_alert_defaults = '{"desktop": false, "phone": true, "urgent": true}' WHERE user_id = ?`, uid)
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at) VALUES ('bot_fb', ?, 'Rated', 900, now())`, uid)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, feedback, feedback_reason, feedback_note, feedback_at) VALUES
		('bal_no', 'bot_fb', ?, 'alert', '2026-11-06', 'Not this', 'not_useful', 'too_small', 'Only big dips', '2026-11-06T10:00:00Z'),
		('bal_yes', 'bot_fb', ?, 'alert', '2026-11-06', 'This one', 'useful', '', '', '2026-11-06T11:00:00Z'),
		('bal_none', 'bot_fb', ?, 'alert', '2026-11-06', 'Not rated', NULL, '', '', NULL)`, uid, uid, uid)

	service := NewService(db, nil)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE configs SET bot_alert_defaults = '{"desktop": true, "phone": true, "urgent": false}' WHERE user_id = ?`, uid)
	exec(`UPDATE bot_alerts SET feedback = NULL, feedback_reason = '', feedback_note = '', feedback_at = NULL WHERE user_id = ?`, uid)
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	count := func(query string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := db.Raw(query, args...).Scan(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_no' AND feedback = 'not_useful' AND feedback_reason = 'too_small'
		AND feedback_note = 'Only big dips' AND feedback_at = '2026-11-06T10:00:00Z'`); n != 1 {
		t.Fatal("a not useful rating did not round-trip")
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_yes' AND feedback = 'useful' AND feedback_at IS NOT NULL`); n != 1 {
		t.Fatal("a useful rating did not round-trip")
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_none' AND feedback IS NULL AND feedback_at IS NULL`); n != 1 {
		t.Fatal("an unrated alert came back rated")
	}
	var defaults models.Config
	if err := db.Select("bot_alert_defaults").Where("user_id = ?", uid).First(&defaults).Error; err != nil {
		t.Fatal(err)
	}
	if d := defaults.BotAlertDefaults; d.Desktop || !d.Phone || !d.Urgent {
		t.Fatalf("alert defaults after restore %+v", d)
	}

	// The same backup as an older version wrote it: no feedback columns on
	// the alerts and no alert switches on the settings row.
	for i, raw := range backup.Rows["bot_alerts"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"feedback", "feedback_reason", "feedback_note", "feedback_at"} {
			delete(row, k)
		}
		backup.Rows["bot_alerts"][i], _ = json.Marshal(row)
	}
	var cfg map[string]any
	if err := json.Unmarshal(backup.Rows["configs"][0], &cfg); err != nil {
		t.Fatal(err)
	}
	if _, ok := cfg["bot_alert_defaults"]; !ok {
		t.Fatalf("export has no alert defaults: %s", backup.Rows["configs"][0])
	}
	delete(cfg, "bot_alert_defaults")
	backup.Rows["configs"][0], _ = json.Marshal(cfg)
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatalf("restore of an older backup: %v", err)
	}
	if n := count(`SELECT count(*) FROM bot_alerts WHERE user_id = ? AND feedback IS NULL AND feedback_reason = '' AND feedback_note = '' AND feedback_at IS NULL`, uid); n != 3 {
		t.Fatalf("older alerts restored: %d of 3 unrated", n)
	}
	if n := count(`SELECT count(*) FROM configs WHERE user_id = ? AND bot_alert_defaults = '{"desktop": true, "phone": true, "urgent": false}'::jsonb`, uid); n != 1 {
		t.Fatal("an older settings row did not get the default alert switches")
	}

	// Over MCP an outside app cannot turn urgent on for every later Bot,
	// and a value that is not three switches goes back to the default.
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	cfg["bot_alert_defaults"] = map[string]any{"desktop": false, "phone": true, "urgent": true}
	backup.Rows["configs"][0], _ = json.Marshal(cfg)
	if _, err := service.RestoreFromMCP(uid, backup); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM configs WHERE user_id = ? AND bot_alert_defaults = '{"desktop": false, "phone": true, "urgent": false}'::jsonb`, uid); n != 1 {
		t.Fatal("a restore over MCP kept urgent on for new bots")
	}
	cfg["bot_alert_defaults"] = map[string]any{"urgent": "x"}
	backup.Rows["configs"][0], _ = json.Marshal(cfg)
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM configs WHERE user_id = ? AND bot_alert_defaults = '{"desktop": true, "phone": true, "urgent": false}'::jsonb`, uid); n != 1 {
		t.Fatal("a malformed alert default was kept")
	}
}

// A restore keeps the account's price source keys (they hang off the
// account, not its Bots), so a restored stock Bot stays on while the key is
// there. Only a Bot made over MCP keeps the app name it came from.
func TestIntegrationRestoreKeepsSourceKeys(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_keys"
	if err := db.Create(&models.User{ID: uid, Email: "keys@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO bot_source_keys (user_id, source, api_key, key_hint, checked_at) VALUES (?, 'finnhub', 'c2VhbGVk', '…1234', now())`, uid)
	// A file that says a tag just checked a Bot, far ahead, must not hold
	// off the checks tags start.
	exec(`INSERT INTO bots (id, user_id, name, origin, origin_client, interval_seconds, next_check_at, asked_at) VALUES
		('bot_stock', ?, 'NVDA', 'app', 'Claude Code', 900, now(), now() + interval '10 years')`, uid)
	exec(`INSERT INTO bots (id, user_id, name, origin, origin_client, status, pause_reason, interval_seconds) VALUES
		('bot_mcp', ?, 'From an app', 'mcp', 'My key', 'paused', 'mcp', 900)`, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, source, symbol, currency) VALUES
		('bw_stock', 'bot_stock', ?, 'price', 'finnhub', 'NVDA', 'USD'),
		('bw_mcp', 'bot_mcp', ?, 'price', 'coinbase', 'BTC', 'USD')`, uid, uid)

	service := NewService(db, nil)
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := backup.Rows["bot_source_keys"]; ok {
		t.Fatal("export carries bot_source_keys")
	}
	type row struct {
		ID, Status, OriginClient, HealthDetail string
		Asked                                  bool
	}
	read := func() map[string]row {
		t.Helper()
		var rows []row
		if err := db.Raw(`SELECT id, status, origin_client, health_detail, asked_at IS NOT NULL AS asked FROM bots WHERE user_id = ?`, uid).Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		out := map[string]row{}
		for _, r := range rows {
			out[r.ID] = r
		}
		return out
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	var keys int64
	if err := db.Raw(`SELECT count(*) FROM bot_source_keys WHERE user_id = ? AND state = 'ok'`, uid).Scan(&keys).Error; err != nil || keys != 1 {
		t.Fatalf("the restore dropped the key: %d (%v)", keys, err)
	}
	got := read()
	if r := got["bot_stock"]; r.Status != "active" || r.OriginClient != "" || r.Asked {
		t.Fatalf("stock bot with a key: %+v", r)
	}
	if r := got["bot_mcp"]; r.OriginClient != "My key" {
		t.Fatalf("an MCP bot lost its app name: %+v", r)
	}

	exec(`DELETE FROM bot_source_keys WHERE user_id = ?`, uid)
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	if r := read()["bot_stock"]; r.Status != "paused" || r.HealthDetail != "Restored with a watch Timely cannot use: Stock prices need your free Finnhub key. Add it in Settings › Agent. Edit it to turn it on." {
		t.Fatalf("stock bot without a key: %+v", r)
	}
}

// An alert's judge input (page text kept for a re-judge) never leaves the
// server: the export has no ai_input, and a crafted file's is dropped on
// restore. How AI saw the alert round-trips, and a backup made before AI
// judging restores with the defaults.
func TestIntegrationBackupLeavesOutJudgeInput(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_bot_judge"
	if err := db.Create(&models.User{ID: uid, Email: "judge@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at, judge_mode) VALUES ('bot_j', ?, 'Judged', 900, now(), 'ai')`, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, source, symbol, currency) VALUES ('bw_j', 'bot_j', ?, 'price', 'coinbase', 'BTC', 'USD')`, uid)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, ai_state, ai_why, ai_input, urgency) VALUES
		('bal_j1', 'bot_j', ?, 'alert', '2026-11-06', 'Judged: below 25,000', 'unchecked', 'AI was unavailable; Timely asks again later', '{"chainId": "bchk_j", "input": {"bot": "secret page text"}}', 'high'),
		('bal_j2', 'bot_j', ?, 'alert', '2026-11-06', 'Judged: up 5.0%', 'judged', 'Big move', NULL, 'low')`, uid, uid)
	exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, local_day, purpose) VALUES ('bai_j', ?, 'bot_j', '2026-11-06', 'judge')`, uid)

	service := NewService(db, nil)
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := backup.Rows["bot_ai_calls"]; ok {
		t.Fatal("export carries bot_ai_calls")
	}
	for _, raw := range backup.Rows["bot_alerts"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		if _, ok := row["ai_input"]; ok {
			t.Fatalf("exported alert carries ai_input: %s", raw)
		}
		if row["id"] == "bal_j1" && (row["ai_state"] != "unchecked" || row["urgency"] != "high") {
			t.Fatalf("exported alert lost how AI saw it: %s", raw)
		}
	}
	// A crafted file puts an input back on one alert and leaves the AI
	// columns out of the other, as a backup made before AI judging would.
	for i, raw := range backup.Rows["bot_alerts"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		if row["id"] == "bal_j1" {
			row["ai_input"] = map[string]any{"chainId": "x", "input": map[string]any{"bot": "crafted"}}
		} else {
			delete(row, "ai_state")
			delete(row, "ai_why")
			delete(row, "urgency")
		}
		backup.Rows["bot_alerts"][i], _ = json.Marshal(row)
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		ID, AIState, AIWhy, Urgency string
		HasInput                    bool
	}
	if err := db.Raw(`SELECT id, ai_state, ai_why, urgency, ai_input IS NOT NULL AS has_input FROM bot_alerts WHERE user_id = ? ORDER BY id`, uid).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].HasInput || rows[0].AIState != "unchecked" || rows[0].Urgency != "high" ||
		rows[1].HasInput || rows[1].AIState != "" || rows[1].AIWhy != "" || rows[1].Urgency != "normal" {
		t.Fatalf("restored alerts %+v", rows)
	}
	var calls int64
	if err := db.Raw(`SELECT count(*) FROM bot_ai_calls WHERE user_id = ?`, uid).Scan(&calls).Error; err != nil || calls != 1 {
		t.Fatalf("a restore reset the AI call log: %d (%v)", calls, err)
	}
}

// A restored Bot keeps the doc or sheet its judge reads only while that is
// the person's and not in the bin; over MCP it always lets it go. A backup
// made before knowledge restores with none.
func TestIntegrationRestoreVetsBotKnowledge(t *testing.T) {
	db := migratedDB(t)
	const uid, other = "usr_portability_knowledge", "usr_portability_knowledge_other"
	for _, row := range []any{
		&models.User{ID: uid, Email: "knowledge@example.invalid", Password: "not-a-real-hash"},
		&models.User{ID: other, Email: "knowledge-other@example.invalid", Password: "not-a-real-hash"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedAccountBasics(t, db, uid, true)
	seedAccountBasics(t, db, other, true)
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO documents (id, title, workspace_id, user_id, created_at, updated_at) VALUES
		('doc_k_own', 'Wishlist notes', 'ws_' || ?, ?, '2026-11-01', '2026-11-01'),
		('doc_k_theirs', 'Theirs', 'ws_' || ?, ?, '2026-11-01', '2026-11-01')`, uid, uid, other, other)
	exec(`INSERT INTO sheets (id, title, workspace_id, user_id, archived_at, created_at, updated_at) VALUES
		('sht_k_bin', 'Old wishlist', 'ws_' || ?, ?, '2026-11-02', '2026-11-01', '2026-11-01')`, uid, uid)
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at, judge_mode, knowledge_kind, knowledge_id) VALUES
		('bot_k_own', ?, 'Own doc', 900, now(), 'ai', 'doc', 'doc_k_own'),
		('bot_k_bin', ?, 'Binned sheet', 900, now(), 'ai', 'sheet', 'sht_k_bin'),
		('bot_k_theirs', ?, 'Their doc', 900, now(), 'ai', 'doc', 'doc_k_theirs'),
		('bot_k_none', ?, 'No knowledge', 900, now(), 'ai', '', '')`, uid, uid, uid, uid)

	service := NewService(db, nil)
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	read := func() map[string][2]string {
		t.Helper()
		var rows []struct{ ID, KnowledgeKind, KnowledgeID string }
		if err := db.Raw(`SELECT id, knowledge_kind, knowledge_id FROM bots WHERE user_id = ?`, uid).Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		out := map[string][2]string{}
		for _, r := range rows {
			out[r.ID] = [2]string{r.KnowledgeKind, r.KnowledgeID}
		}
		return out
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	got := read()
	if got["bot_k_own"] != [2]string{"doc", "doc_k_own"} || got["bot_k_bin"] != [2]string{} || got["bot_k_theirs"] != [2]string{} || got["bot_k_none"] != [2]string{} {
		t.Fatalf("restored knowledge %v", got)
	}

	// A backup made before knowledge has no knowledge columns.
	for i, raw := range backup.Rows["bots"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		if row["id"] == "bot_k_none" {
			delete(row, "knowledge_kind")
			delete(row, "knowledge_id")
		}
		backup.Rows["bots"][i], _ = json.Marshal(row)
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatalf("restore of an older backup: %v", err)
	}
	if got := read(); got["bot_k_none"] != [2]string{} || got["bot_k_own"] != [2]string{"doc", "doc_k_own"} {
		t.Fatalf("older backup restored %v", got)
	}

	// Over MCP no Bot keeps a doc or sheet, even its own.
	if _, err := service.RestoreFromMCP(uid, backup); err != nil {
		t.Fatal(err)
	}
	for id, k := range read() {
		if k != [2]string{} {
			t.Fatalf("%s kept %v after a restore over MCP", id, k)
		}
	}
}

// One alert per thing survives a backup: the things a sent alert told of,
// who else saw it and the alert a shared one joined. A crafted file cannot
// point shared_with at another account's alert or name another account's
// Bot under "Also seen by", and a backup made before sharing restores with
// none.
func TestIntegrationRestoreSharedAlerts(t *testing.T) {
	db := migratedDB(t)
	const uid, other = "usr_portability_shared", "usr_portability_shared_other"
	for _, row := range []any{
		&models.User{ID: uid, Email: "shared@example.invalid", Password: "not-a-real-hash"},
		&models.User{ID: other, Email: "shared-other@example.invalid", Password: "not-a-real-hash"},
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
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at) VALUES
		('bot_s_a', ?, 'BTC A', 900, now()), ('bot_s_b', ?, 'BTC B', 900, now())`, uid, uid)
	exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at) VALUES ('bot_s_theirs', ?, 'Theirs', 900, now())`, other)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, things, also_seen_by, created_at) VALUES
		('bal_s_theirs', 'bot_s_theirs', ?, 'alert', '2026-11-06', 'Theirs: below 70,000', '[]', '[]', '2026-11-06 09:00')`, other)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, things, also_seen_by, created_at) VALUES
		('bal_s_first', 'bot_s_a', ?, 'alert', '2026-11-06', 'BTC A: price changed', '[{"key": "price:coinbase:BTC", "value": 69120, "urgency": "normal"}]',
		 '[{"botId": "bot_s_b", "name": "BTC B"}]', '2026-11-06 09:00')`, uid)
	exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, held, local_day, title, shared_with, created_at) VALUES
		('bal_s_shared', 'bot_s_b', ?, 'alert', 'shared', '2026-11-06', 'BTC B: price changed', 'bal_s_first', '2026-11-06 09:01'),
		('bal_s_crafted', 'bot_s_b', ?, 'alert', 'shared', '2026-11-06', 'BTC B: price changed', NULL, '2026-11-06 09:02')`, uid, uid)
	exec(`INSERT INTO bot_findings (id, bot_id, user_id, kind, title, urgency, thing_key) VALUES
		('bfd_s', 'bot_s_a', ?, 'item', 'Story', 'normal', 'link:https://news.example/1')`, uid)

	service := NewService(db, nil)
	service.SetRestoreVet(bots.New(db, nil).VetRestore)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	type alertRow struct {
		ID, Things, AlsoSeenBy string
		SharedWith             *string
	}
	read := func() map[string]alertRow {
		t.Helper()
		var rows []alertRow
		if err := db.Raw(`SELECT id, things::text AS things, also_seen_by::text AS also_seen_by, shared_with FROM bot_alerts WHERE user_id = ?`, uid).Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		out := map[string]alertRow{}
		for _, r := range rows {
			out[r.ID] = r
		}
		return out
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	got := read()
	if r := got["bal_s_shared"]; r.SharedWith == nil || *r.SharedWith != "bal_s_first" {
		t.Fatalf("shared alert lost what it joined: %+v", r)
	}
	// What an alert told of only matters to sharing, and a file's could
	// hold back the person's other Bots: a restore lets it go.
	if r := got["bal_s_first"]; r.AlsoSeenBy != `[{"name": "BTC B", "botId": "bot_s_b"}]` || r.Things != "[]" {
		t.Fatalf("first alert %+v", r)
	}
	var key string
	if err := db.Raw(`SELECT thing_key FROM bot_findings WHERE id = 'bfd_s'`).Scan(&key).Error; err != nil || key != "link:https://news.example/1" {
		t.Fatalf("finding thing key %q (%v)", key, err)
	}

	// A crafted file: one shared alert points at another account's alert,
	// "Also seen by" names their Bot and a made-up name for one of ours,
	// things are not a list or carry a value that is not a number, and an
	// older backup leaves the new columns out.
	for i, raw := range backup.Rows["bot_alerts"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		switch row["id"] {
		case "bal_s_crafted":
			row["shared_with"] = "bal_s_theirs"
			row["things"] = []any{map[string]any{"key": "price:coinbase:BTC:USD", "value": "x"}}
		case "bal_s_first":
			row["also_seen_by"] = []any{
				map[string]any{"botId": "bot_s_theirs", "name": "Theirs"},
				map[string]any{"botId": "bot_s_b", "name": "Anything at all"},
				map[string]any{"botId": "bot_missing", "name": "Gone"},
			}
			row["things"] = "not a list"
		case "bal_s_shared":
			delete(row, "things")
			delete(row, "also_seen_by")
		}
		backup.Rows["bot_alerts"][i], _ = json.Marshal(row)
	}
	for i, raw := range backup.Rows["bot_findings"] {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		delete(row, "thing_key")
		backup.Rows["bot_findings"][i], _ = json.Marshal(row)
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	got = read()
	if r := got["bal_s_crafted"]; r.SharedWith != nil || r.Things != "[]" {
		t.Fatalf("a crafted shared_with points at another account's alert: %+v", r)
	}
	if r := got["bal_s_first"]; r.AlsoSeenBy != `[{"name": "BTC B", "botId": "bot_s_b"}]` || r.Things != "[]" {
		t.Fatalf("also seen by and things after a crafted file: %+v", r)
	}
	if r := got["bal_s_shared"]; r.Things != "[]" || r.AlsoSeenBy != "[]" || r.SharedWith == nil {
		t.Fatalf("older backup restored %+v", r)
	}
	if err := db.Raw(`SELECT thing_key FROM bot_findings WHERE id = 'bfd_s'`).Scan(&key).Error; err != nil || key != "" {
		t.Fatalf("older finding thing key %q (%v)", key, err)
	}
	var theirs int64
	if err := db.Raw(`SELECT count(*) FROM bot_alerts WHERE id = 'bal_s_theirs' AND user_id = ?`, other).Scan(&theirs).Error; err != nil || theirs != 1 {
		t.Fatalf("the other account's alert: %d (%v)", theirs, err)
	}
}
