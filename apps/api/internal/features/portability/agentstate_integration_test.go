package portability

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

// agentAccount is an account with its basics, learning settings (learning
// off, one skill turned off), one learning event and a web search key.
func agentAccount(t *testing.T, db *gorm.DB, uid string) {
	t.Helper()
	if err := db.Create(&models.User{ID: uid, Email: uid + "@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	for _, q := range []string{
		`INSERT INTO agent_learning_settings (user_id, learning, skills_disabled) VALUES (?, false, '["old-off"]')`,
		`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, action, subject, status, tainted_sources)
		 VALUES ('ale_` + uid + `', ?, 'w-1', 'skill', 'created', 'pantry-steps', 'applied', '[{"kind":"web"}]')`,
		`INSERT INTO agent_web_keys (user_id, backend, api_key, key_hint) VALUES (?, 'exa', 'sealed', '…abcd')`,
	} {
		if err := db.Exec(q, uid).Error; err != nil {
			t.Fatal(err)
		}
	}
}

type learningRow struct {
	Learning       bool
	SkillsDisabled string
	SkillsRestored string
}

func learningSettings(t *testing.T, db *gorm.DB, uid string) learningRow {
	t.Helper()
	var row learningRow
	if err := db.Raw(`SELECT learning, skills_disabled::text AS skills_disabled, skills_restored::text AS skills_restored FROM agent_learning_settings WHERE user_id = ?`, uid).Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

func countRows(t *testing.T, db *gorm.DB, table, uid string) int64 {
	t.Helper()
	var n int64
	if err := db.Table(table).Where("user_id = ?", uid).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// strictCopy sends a backup through JSON and the restore handler's strict
// decoder.
func strictCopy(t *testing.T, backup *Backup) *Backup {
	t.Helper()
	raw, err := json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var out Backup
	if err := decoder.Decode(&out); err != nil {
		t.Fatal(err)
	}
	return &out
}

// A schema 3 backup carries the agent state and what the agent learned, but
// never the web search key. Restoring it stages the zip before the rows
// change, marks the restored skills off and "restored, review" inside the
// transaction, and swaps the agent state in after it commits.
func TestIntegrationBackupCarriesAgentState(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_agent"
	agentAccount(t, db, uid)
	agent := &fakeAgent{zip: []byte("agent zip"), restored: []string{"pantry-steps"}}
	service := NewService(db, nil)
	service.SetAgentState(agent)

	backup, err := service.ExportAccount(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if backup.SchemaVersion != 3 || backup.Agent == nil || string(backup.Agent.Zip) != "agent zip" || len(backup.Warnings) != 0 {
		t.Fatalf("backup: schema %d, agent %+v, warnings %v", backup.SchemaVersion, backup.Agent, backup.Warnings)
	}
	if len(backup.Rows["agent_learning_settings"]) != 1 || len(backup.Rows["agent_learning_events"]) != 1 {
		t.Fatalf("learning rows: %d settings, %d events", len(backup.Rows["agent_learning_settings"]), len(backup.Rows["agent_learning_events"]))
	}
	if _, ok := backup.Rows["agent_web_keys"]; ok {
		t.Fatal("the backup carries the web search key")
	}
	// What an outside app exports has the other rows only: the learning
	// feed holds memory and About you texts.
	rowsOnly, err := service.Export(uid)
	if err != nil || rowsOnly.Agent != nil {
		t.Fatalf("Export: agent %v, err %v", rowsOnly.Agent, err)
	}
	for table := range agentTables {
		if _, ok := rowsOnly.Rows[table]; ok {
			t.Fatalf("an outside app's export carries %s", table)
		}
	}
	if len(rowsOnly.Rows["workspaces"]) == 0 {
		t.Fatal("an outside app's export lost the account's rows")
	}

	// Change things after the backup.
	for _, q := range []string{
		`UPDATE agent_learning_settings SET learning = true, skills_disabled = '[]' WHERE user_id = ?`,
		`DELETE FROM agent_learning_events WHERE user_id = ?`,
	} {
		if err := db.Exec(q, uid).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := service.Restore(uid, strictCopy(t, backup))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) != 0 || result.Counts["agent_learning_settings"] != 1 || result.Counts["agent_learning_events"] != 1 {
		t.Fatalf("result %+v", result)
	}
	staged, committed, discarded := agent.counts()
	if staged != 1 || committed != 1 || discarded != 0 || string(agent.staged[0]) != "agent zip" {
		t.Fatalf("staged %d committed %d discarded %d", staged, committed, discarded)
	}
	got := learningSettings(t, db, uid)
	if got.Learning || got.SkillsDisabled != `["old-off", "pantry-steps"]` || got.SkillsRestored != `["pantry-steps"]` {
		t.Fatalf("learning settings after restore: %+v", got)
	}
	var tainted string
	if err := db.Raw(`SELECT tainted_sources::text FROM agent_learning_events WHERE id = ? AND user_id = ?`, "ale_"+uid, uid).Scan(&tainted).Error; err != nil || tainted != `[{"kind": "web"}]` {
		t.Fatalf("restored event: tainted %q, err %v", tainted, err)
	}
	if countRows(t, db, "agent_web_keys", uid) != 1 {
		t.Fatal("the restore removed the web search key")
	}
}

// A damaged agent state refuses the whole restore before anything changes;
// a restore whose transaction fails drops the staged folder; a swap that
// fails after the commit, or no assistant on this server, still restores
// the rows and says what was left out.
func TestIntegrationRestoreAgentStateFailures(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_agent_fail"
	agentAccount(t, db, uid)
	agent := &fakeAgent{zip: []byte("agent zip"), restored: []string{"pantry-steps"}}
	service := NewService(db, nil)
	service.SetAgentState(agent)
	backup, err := service.ExportAccount(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	reset := func() {
		t.Helper()
		if err := db.Exec(`UPDATE agent_learning_settings SET skills_disabled = '[]', skills_restored = '[]' WHERE user_id = ?`, uid).Error; err != nil {
			t.Fatal(err)
		}
		*agent = fakeAgent{zip: agent.zip, restored: agent.restored}
	}

	t.Run("damaged", func(t *testing.T) {
		reset()
		damaged := strictCopy(t, backup)
		damaged.Agent.Zip = []byte("agent zap")
		if _, err := service.Restore(uid, damaged); err == nil {
			t.Fatal("a damaged agent state was restored")
		}
		if staged, _, _ := agent.counts(); staged != 0 {
			t.Fatal("a damaged agent state was staged")
		}
		if got := learningSettings(t, db, uid); got.SkillsDisabled != "[]" {
			t.Fatalf("the account changed: %+v", got)
		}
	})
	t.Run("transaction fails", func(t *testing.T) {
		reset()
		service.SetRestoreVet(func(*gorm.DB, string, bool) error { return errors.New("vet refused") })
		defer service.SetRestoreVet(nil)
		if _, err := service.Restore(uid, strictCopy(t, backup)); err == nil {
			t.Fatal("restore passed a failing vet")
		}
		if staged, committed, discarded := agent.counts(); staged != 1 || committed != 0 || discarded != 1 {
			t.Fatalf("staged %d committed %d discarded %d", staged, committed, discarded)
		}
		if got := learningSettings(t, db, uid); got.SkillsRestored != "[]" {
			t.Fatalf("the rollback kept the restored marks: %+v", got)
		}
	})
	t.Run("swap fails", func(t *testing.T) {
		reset()
		// The person turned a skill off after the backup, and an earlier
		// restore left one for review; the feed has a newer event.
		for _, q := range []string{
			`UPDATE agent_learning_settings SET skills_disabled = '["mine-off", "unreviewed"]', skills_restored = '["unreviewed"]' WHERE user_id = ?`,
			`DELETE FROM agent_learning_events WHERE user_id = ?`,
			`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, action, subject, status, tainted_sources)
			 VALUES ('ale_new', ?, 'w-2', 'memory', 'added', 'About you', 'applied', '[]')`,
		} {
			if err := db.Exec(q, uid).Error; err != nil {
				t.Fatal(err)
			}
		}
		agent.commitErr = errors.New("disk full")
		result, err := service.Restore(uid, strictCopy(t, backup))
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(result.Warnings, []string{warnAgentNotStaged}) {
			t.Fatalf("warnings %q", result.Warnings)
		}
		// The agent home stays the old one, so its lists and feed stay too.
		if got := learningSettings(t, db, uid); got.SkillsDisabled != `["mine-off", "unreviewed"]` || got.SkillsRestored != `["unreviewed"]` {
			t.Fatalf("a failed swap replaced the skill lists: %+v", got)
		}
		var ids []string
		if err := db.Raw(`SELECT id FROM agent_learning_events WHERE user_id = ? ORDER BY id`, uid).Scan(&ids).Error; err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(ids, []string{"ale_new"}) {
			t.Fatalf("a failed swap replaced the feed: %v", ids)
		}
	})
	t.Run("staging fails", func(t *testing.T) {
		reset()
		// An earlier restore left a skill off for review; the agent home
		// stays as it is, so must the lists.
		if err := db.Exec(`UPDATE agent_learning_settings SET skills_disabled = '["unreviewed"]', skills_restored = '["unreviewed"]' WHERE user_id = ?`, uid).Error; err != nil {
			t.Fatal(err)
		}
		agent.stageErr = fmt.Errorf("%w: agent-import: not a zip", agenthost.ErrHelperFailed)
		result, err := service.Restore(uid, strictCopy(t, backup))
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(result.Warnings, []string{warnAgentNotStaged}) {
			t.Fatalf("warnings %q", result.Warnings)
		}
		if got := learningSettings(t, db, uid); got.SkillsRestored != `["unreviewed"]` || got.SkillsDisabled != `["unreviewed"]` {
			t.Fatalf("an agent-less restore changed the skill lists: %+v", got)
		}
	})
	t.Run("no assistant here", func(t *testing.T) {
		reset()
		bare := NewService(db, nil)
		result, err := bare.Restore(uid, strictCopy(t, backup))
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(result.Warnings, []string{warnAgentNotHere}) {
			t.Fatalf("warnings %q", result.Warnings)
		}
	})
	t.Run("an injected skill is left out", func(t *testing.T) {
		reset()
		agent.blocked = []string{"injected"}
		result, err := service.Restore(uid, strictCopy(t, backup))
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(result.Warnings, []string{warnSkillsBlocked([]string{"injected"})}) {
			t.Fatalf("warnings %q", result.Warnings)
		}
	})
}

// An outside app's restore never stages the agent state and leaves what the
// agent learned as it is.
func TestIntegrationMCPRestoreLeavesTheAgentAlone(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_agent_mcp"
	agentAccount(t, db, uid)
	agent := &fakeAgent{zip: []byte("agent zip"), restored: []string{"pantry-steps"}}
	service := NewService(db, nil)
	service.SetAgentState(agent)
	backup, err := service.ExportAccount(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE agent_learning_settings SET learning = true, skills_disabled = '["mine"]' WHERE user_id = ?`, uid).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, status) VALUES ('ale_after', ?, 'w-2', 'memory', 'applied')`, uid).Error; err != nil {
		t.Fatal(err)
	}
	result, err := service.RestoreFromMCP(uid, strictCopy(t, backup))
	if err != nil {
		t.Fatal(err)
	}
	if staged, _, _ := agent.counts(); staged != 0 {
		t.Fatal("an outside app's restore staged the agent state")
	}
	if !slices.Equal(result.Warnings, []string{warnAgentNotFromApps}) || result.Counts["agent_learning_events"] != 0 {
		t.Fatalf("result %+v", result)
	}
	if got := learningSettings(t, db, uid); !got.Learning || got.SkillsDisabled != `["mine"]` {
		t.Fatalf("learning settings changed: %+v", got)
	}
	if countRows(t, db, "agent_learning_events", uid) != 2 {
		t.Fatal("learning events changed")
	}
}

// Above the cap the backup leaves the agent state out and says so, in the
// backup file and in the scheduled job's result; the rows are all there.
func TestIntegrationOverCapBackupWarns(t *testing.T) {
	t.Setenv("TIMELY_BACKUP_DIR", t.TempDir())
	db := migratedDB(t)
	const uid = "usr_portability_agent_cap"
	agentAccount(t, db, uid)
	service := NewService(db, nil)
	service.SetAgentState(&fakeAgent{exportErr: fmt.Errorf("%w (70 MB, the limit is 64 MB)", agenthost.ErrStateTooLarge)})

	backup, err := service.ExportAccount(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if backup.Agent != nil || !slices.Equal(backup.Warnings, []string{warnAgentTooLarge}) || len(backup.Rows["agent_learning_events"]) != 1 {
		t.Fatalf("agent %v warnings %q", backup.Agent != nil, backup.Warnings)
	}

	now := time.Now().UTC()
	job := models.Job{ID: "job_cap", UserID: uid, Kind: models.JobCreateBackup, Status: "running", Payload: models.JobPayload{"scheduled": true}, RunAt: now, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.HandleBackup(context.Background(), &job); err != nil {
		t.Fatal(err)
	}
	var stored models.Job
	if err := db.Where("id = ?", job.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(stored.Payload["warnings"]) != fmt.Sprint([]string{warnAgentTooLarge}) || stored.Payload["scheduled"] != true {
		t.Fatalf("job payload %v", stored.Payload)
	}
	files, err := service.List(uid)
	if err != nil || len(files) != 1 {
		t.Fatalf("%d backup files, err %v", len(files), err)
	}
	plain, _, err := service.Read(uid, files[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	var written Backup
	if err := json.Unmarshal(plain, &written); err != nil {
		t.Fatal(err)
	}
	if written.Agent != nil || !slices.Equal(written.Warnings, []string{warnAgentTooLarge}) {
		t.Fatalf("stored backup: agent %v warnings %q", written.Agent != nil, written.Warnings)
	}
	// The written backup still restores. Its agent state is not in it, so
	// the agent home stays as it is and so do the account's skill lists: a
	// skill an earlier restore left off for review stays off.
	if err := db.Exec(`UPDATE agent_learning_settings SET skills_disabled = '["old-off", "unreviewed"]', skills_restored = '["unreviewed"]' WHERE user_id = ?`, uid).Error; err != nil {
		t.Fatal(err)
	}
	result, err := service.Restore(uid, &written)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(result.Warnings, []string{warnAgentTooLarge, warnAgentKept}) {
		t.Fatalf("restore warnings %q", result.Warnings)
	}
	if got := learningSettings(t, db, uid); got.SkillsRestored != `["unreviewed"]` || got.SkillsDisabled != `["old-off", "unreviewed"]` {
		t.Fatalf("an over-cap restore turned skills back on: %+v", got)
	}
}

// A schema 2 backup (before agent state) still restores, and keeps the
// account's learning switches and skill lists as they are.
func TestIntegrationSchema2BackupStillRestores(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_agent_v2"
	agentAccount(t, db, uid)
	agent := &fakeAgent{zip: []byte("agent zip")}
	service := NewService(db, nil)
	service.SetAgentState(agent)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	backup.SchemaVersion = 2
	for table := range agentTables {
		delete(backup.Rows, table)
	}
	raw, _ := json.Marshal(backup)
	if bytes.Contains(raw, []byte(`"agent"`)) || bytes.Contains(raw, []byte(`"warnings"`)) {
		t.Fatalf("a backup without agent state names it: %s", raw)
	}
	result, err := service.Restore(uid, strictCopy(t, backup))
	if err != nil {
		t.Fatal(err)
	}
	if staged, _, _ := agent.counts(); staged != 0 || len(result.Warnings) != 0 {
		t.Fatalf("staged %d, warnings %q", staged, result.Warnings)
	}
	if got := learningSettings(t, db, uid); got.Learning || got.SkillsDisabled != `["old-off"]` {
		t.Fatalf("learning settings changed: %+v", got)
	}
	if countRows(t, db, "agent_learning_events", uid) != 1 {
		t.Fatal("learning events changed")
	}
}

// A backup without the agent zip (no agent home yet, over the cap, or a
// stage that failed) still carries the person's "Learn from chats" and
// "Search my past chats" switches: a restore into a fresh account keeps
// them off, while the account's own skill lists and feed stay as they are.
func TestIntegrationRestoreKeepsLearningSwitchesWithoutAgentState(t *testing.T) {
	db := migratedDB(t)
	cases := []struct {
		name  string
		agent *fakeAgent
	}{
		{"no agent home", &fakeAgent{exportErr: agenthost.ErrNoAgentState}},
		{"over the cap", &fakeAgent{exportErr: fmt.Errorf("%w: 70 MB", agenthost.ErrStateTooLarge)}},
		{"stage fails", &fakeAgent{zip: []byte("agent zip"), stageErr: fmt.Errorf("%w: not a zip", agenthost.ErrHelperFailed)}},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uid := fmt.Sprintf("usr_portability_switches_%d", i)
			agentAccount(t, db, uid)
			if err := db.Exec(`UPDATE agent_learning_settings SET search_history = false, use_case_copied_at = now() WHERE user_id = ?`, uid).Error; err != nil {
				t.Fatal(err)
			}
			service := NewService(db, nil)
			service.SetAgentState(tc.agent)
			backup, err := service.ExportAccount(context.Background(), uid)
			if err != nil {
				t.Fatal(err)
			}
			if len(backup.Rows["agent_learning_settings"]) != 1 {
				t.Fatalf("backup settings rows: %d", len(backup.Rows["agent_learning_settings"]))
			}
			// A fresh account: no settings row, no feed.
			for _, q := range []string{`DELETE FROM agent_learning_settings WHERE user_id = ?`, `DELETE FROM agent_learning_events WHERE user_id = ?`} {
				if err := db.Exec(q, uid).Error; err != nil {
					t.Fatal(err)
				}
			}
			if _, err := service.Restore(uid, strictCopy(t, backup)); err != nil {
				t.Fatal(err)
			}
			var row struct {
				Learning, SearchHistory bool
				Copied                  bool
				SkillsDisabled          string
			}
			if err := db.Raw(`SELECT learning, search_history, use_case_copied_at IS NOT NULL AS copied, skills_disabled::text AS skills_disabled
				FROM agent_learning_settings WHERE user_id = ?`, uid).Scan(&row).Error; err != nil {
				t.Fatal(err)
			}
			if row.Learning || row.SearchHistory || !row.Copied || row.SkillsDisabled != "[]" {
				t.Fatalf("settings after restore: %+v", row)
			}
			if countRows(t, db, "agent_learning_events", uid) != 0 {
				t.Fatal("the backup's feed came back without its agent home")
			}
		})
	}
}

// Review round 6: when the account keeps its agent home, a backup taken
// before "What you use Timely for" was copied into About you must not clear
// use_case_copied_at, or the next worker ready copies it a second time
// (Q-3.3: copied once). The switches still come from the backup.
func TestIntegrationRestoreKeepsUseCaseCopiedWithoutAgentState(t *testing.T) {
	db := migratedDB(t)
	cases := []struct {
		name  string
		agent *fakeAgent
	}{
		{"over the cap", &fakeAgent{exportErr: fmt.Errorf("%w: 70 MB", agenthost.ErrStateTooLarge)}},
		{"stage fails", &fakeAgent{zip: []byte("agent zip"), stageErr: fmt.Errorf("%w: not a zip", agenthost.ErrHelperFailed)}},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uid := fmt.Sprintf("usr_portability_copied_%d", i)
			agentAccount(t, db, uid)
			if err := db.Exec(`UPDATE agent_learning_settings SET learning = true, search_history = false, use_case_copied_at = NULL WHERE user_id = ?`, uid).Error; err != nil {
				t.Fatal(err)
			}
			service := NewService(db, nil)
			service.SetAgentState(tc.agent)
			backup, err := service.ExportAccount(context.Background(), uid)
			if err != nil {
				t.Fatal(err)
			}
			// The worker copies the use case into the kept home after the backup.
			if err := db.Exec(`UPDATE agent_learning_settings SET use_case_copied_at = now(), search_history = true WHERE user_id = ?`, uid).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := service.Restore(uid, strictCopy(t, backup)); err != nil {
				t.Fatal(err)
			}
			var row struct {
				Learning, SearchHistory, Copied bool
			}
			if err := db.Raw(`SELECT learning, search_history, use_case_copied_at IS NOT NULL AS copied
				FROM agent_learning_settings WHERE user_id = ?`, uid).Scan(&row).Error; err != nil {
				t.Fatal(err)
			}
			if !row.Learning || row.SearchHistory || !row.Copied {
				t.Fatalf("settings after restore: %+v (want the backup's switches, the account's copied mark)", row)
			}
		})
	}
}

// A schema 3 backup written before skills_enabled and reason existed still
// restores: the missing NOT NULL columns take their defaults.
func TestIntegrationRestoreOlderSchema3LearningRows(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_agent_older"
	agentAccount(t, db, uid)
	agent := &fakeAgent{zip: []byte("agent zip")}
	service := NewService(db, nil)
	service.SetAgentState(agent)
	backup, err := service.ExportAccount(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	drop := func(table string, columns ...string) {
		for i, raw := range backup.Rows[table] {
			var row map[string]any
			if err := json.Unmarshal(raw, &row); err != nil {
				t.Fatal(err)
			}
			for _, c := range columns {
				delete(row, c)
			}
			backup.Rows[table][i], _ = json.Marshal(row)
		}
	}
	drop("agent_learning_settings", "skills_enabled", "skills_restored", "skills_disabled", "search_history")
	drop("agent_learning_events", "reason")
	if _, err := service.Restore(uid, strictCopy(t, backup)); err != nil {
		t.Fatal(err)
	}
	if got := learningSettings(t, db, uid); got.Learning || got.SkillsDisabled != "[]" {
		t.Fatalf("settings after restore: %+v", got)
	}
}

// Review round 6: a chat deleted while no worker ran waits in
// agent_session_forgets; the backup's export leaves its session out. A
// restored state.db that holds chats the account no longer has (deleted
// after the backup) queues their session.delete, and keeps the chats it has.
func TestIntegrationBackupLeavesOutAndForgetsDeletedChats(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_forgets"
	agentAccount(t, db, uid)
	for _, q := range []string{
		`INSERT INTO agent_session_forgets (user_id, conversation_id, created_at) VALUES (?, 'cnv_deleted_waiting', now())`,
		`INSERT INTO agent_conversations (id, user_id, title) VALUES ('cnv_kept_r6', ?, 'Kept')`,
	} {
		if err := db.Exec(q, uid).Error; err != nil {
			t.Fatal(err)
		}
	}
	agent := &fakeAgent{zip: []byte("agent zip"), sessions: []string{"cnv_kept_r6", "cnv_deleted_since", "cnv_deleted_waiting"}}
	service := NewService(db, nil)
	service.SetAgentState(agent)
	backup, err := service.ExportAccount(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if len(agent.dropped) != 1 || len(agent.dropped[0]) != 1 || agent.dropped[0][0] != "cnv_deleted_waiting" {
		t.Fatalf("export left out %v, want the waiting delete", agent.dropped)
	}
	if _, err := service.Restore(uid, strictCopy(t, backup)); err != nil {
		t.Fatal(err)
	}
	var waiting []string
	if err := db.Raw(`SELECT conversation_id FROM agent_session_forgets WHERE user_id = ? ORDER BY conversation_id`, uid).Scan(&waiting).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Join(waiting, ",") != "cnv_deleted_since,cnv_deleted_waiting" {
		t.Fatalf("session deletes after restore: %v", waiting)
	}
}
