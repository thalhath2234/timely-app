package portability

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/learning"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

// Schema 3 adds the account's agent state (Backup.Agent) and what the agent
// learned (agent_learning_*); 1 and 2 still restore.
const (
	backupFormat     = "timely-backup"
	schemaVersion    = 3
	minSchemaVersion = 1
	maxRows          = 250000
)

type SourceAccount struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type Backup struct {
	Format        string                       `json:"format"`
	SchemaVersion int                          `json:"schemaVersion"`
	ExportedAt    time.Time                    `json:"exportedAt"`
	Source        SourceAccount                `json:"sourceAccount"`
	Rows          map[string][]json.RawMessage `json:"rows"`
	// Agent is the account's agent state (memory, learned skills, staged
	// writes, chat sessions; plan 6.5), absent when the account never used
	// the agent or the export left it out (Warnings says why). Restore
	// decodes with DisallowUnknownFields, so both fields are declared.
	Agent    *AgentState `json:"agent,omitempty"`
	Warnings []string    `json:"warnings,omitempty"`
}

// AgentState is the zip agent-export wrote (agenthost.ExportState), base64
// in the JSON, with its sha256.
type AgentState struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	SHA256  string `json:"sha256"`
	Zip     []byte `json:"zip"`
}

type tableSpec struct {
	name  string
	query string
}

var exportTables = []tableSpec{
	{"schedules", `SELECT to_jsonb(x) FROM schedules x WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.schedule_id = x.id AND t.user_id = ?)`},
	{"workspaces", `SELECT to_jsonb(x) FROM workspaces x WHERE x.user_id = ? ORDER BY x.id`},
	{"statuses", `SELECT to_jsonb(x) FROM statuses x JOIN workspaces w ON w.id = x.workspace_id WHERE w.user_id = ? ORDER BY x.id`},
	{"lables", `SELECT to_jsonb(x) FROM lables x JOIN workspaces w ON w.id = x.workspace_id WHERE w.user_id = ? ORDER BY x.id`},
	{"custom_fields", `SELECT to_jsonb(x) FROM custom_fields x JOIN workspaces w ON w.id = x.workspace_id WHERE w.user_id = ? ORDER BY x.id`},
	{"projects", `SELECT to_jsonb(x) FROM projects x JOIN workspaces w ON w.id = x.workspace_id WHERE w.user_id = ? ORDER BY x.id`},
	{"stages", `SELECT to_jsonb(x) FROM stages x JOIN projects p ON p.id = x.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ? ORDER BY x.id`},
	{"tasks", `SELECT to_jsonb(x) FROM tasks x WHERE x.user_id = ? ORDER BY x.id`},
	{"custom_field_values", `SELECT to_jsonb(x) FROM custom_field_values x JOIN custom_fields f ON f.id = x.custom_field_id JOIN workspaces w ON w.id = f.workspace_id WHERE w.user_id = ? ORDER BY x.id`},
	{"task_activities", `SELECT to_jsonb(x) FROM task_activities x WHERE x.user_id = ? ORDER BY x.id`},
	{"focus_sessions", `SELECT to_jsonb(x) FROM focus_sessions x WHERE x.user_id = ? ORDER BY x.ended_at`},
	{"documents", `SELECT to_jsonb(x) FROM documents x WHERE x.user_id = ? ORDER BY x.id`},
	{"doc_versions", `SELECT to_jsonb(x) FROM doc_versions x WHERE x.user_id = ? ORDER BY x.created_at`},
	{"doc_files", `SELECT to_jsonb(x) FROM doc_files x WHERE x.user_id = ? ORDER BY x.id`},
	{"sheets", `SELECT to_jsonb(x) FROM sheets x WHERE x.user_id = ? ORDER BY x.id`},
	{"events", `SELECT to_jsonb(x) FROM events x WHERE x.user_id = ? ORDER BY x.id`},
	{"recurrence_rules", `SELECT to_jsonb(x) FROM recurrence_rules x WHERE x.user_id = ? ORDER BY x.id`},
	{"recurrence_exceptions", `SELECT to_jsonb(x) FROM recurrence_exceptions x JOIN recurrence_rules r ON r.id = x.rule_id WHERE r.user_id = ? ORDER BY x.id`},
	{"scheduled_blocks", `SELECT to_jsonb(x) FROM scheduled_blocks x WHERE x.user_id = ? ORDER BY x.id`},
	{"schedule_revisions", `SELECT to_jsonb(x) FROM schedule_revisions x WHERE x.user_id = ? ORDER BY x.created_at`},
	{"configs", `SELECT to_jsonb(x) FROM configs x WHERE x.user_id = ? ORDER BY x.id`},
	{"notifications", `SELECT to_jsonb(x) FROM notifications x WHERE x.user_id = ? ORDER BY x.created_at`},
	// Habits and goals on Today. A check has no id of its own, so the backup
	// names it by habit and day; restore ignores that key.
	{"habits", `SELECT to_jsonb(x) FROM habits x WHERE x.user_id = ? ORDER BY x.position, x.id`},
	{"habit_checks", `SELECT to_jsonb(x) || jsonb_build_object('id', x.habit_id || ':' || x.day::text) FROM habit_checks x WHERE x.user_id = ? ORDER BY x.habit_id, x.day`},
	{"goals", `SELECT to_jsonb(x) FROM goals x WHERE x.user_id = ? ORDER BY x.position, x.id`},
	// Bots (ADR 0021). Watches come back with baseline_pending, so the first
	// check after a restore records a quiet baseline instead of alerting on
	// what changed since the backup. A price day is named by watch and day.
	// Left out on purpose: bot_checks (a 30-day log), bot_sites, bot_robots
	// and bot_site_icons (shared caches with no owner), bot_source_keys
	// (price source keys are sealed with this server's secret, so they would
	// not open anywhere else; a restore keeps the account's own),
	// bot_ai_calls (the AI caps' 30-day log) and bot_passes (the pass log,
	// whose counts a restore must not reset). An alert's ai_input (page and
	// knowledge text kept for a re-judge) never leaves the server, nor does a
	// Bot's gap it has not caught up on (away_*).
	{"bots", `SELECT to_jsonb(x) - 'away_since' - 'away_until' - 'away_reason' FROM bots x WHERE x.user_id = ? ORDER BY x.created_at, x.id`},
	{"bot_watches", `SELECT to_jsonb(x) || jsonb_build_object('baseline_pending', true) FROM bot_watches x WHERE x.user_id = ? ORDER BY x.bot_id, x.position, x.id`},
	{"bot_alerts", `SELECT to_jsonb(x) - 'ai_input' FROM bot_alerts x WHERE x.user_id = ? ORDER BY x.created_at, x.id`},
	{"bot_lessons", `SELECT to_jsonb(x) FROM bot_lessons x WHERE x.user_id = ? ORDER BY x.created_at, x.id`},
	{"bot_links", `SELECT to_jsonb(x) FROM bot_links x WHERE x.user_id = ? ORDER BY x.created_at, x.id`},
	{"bot_findings", `SELECT to_jsonb(x) FROM bot_findings x WHERE x.user_id = ? ORDER BY x.created_at, x.id`},
	{"bot_price_days", `SELECT to_jsonb(x) || jsonb_build_object('id', x.watch_id || ':' || x.day::text) FROM bot_price_days x WHERE x.user_id = ? ORDER BY x.watch_id, x.day`},
	// What the agent learned (plan 9b.7): the account's learning switches and
	// skill lists (the settings row is named by its user; restore ignores
	// that key) and the learning feed. Web search keys (agent_web_keys) stay
	// out, like MCP sign-ins: keys are never in a backup.
	{"agent_learning_settings", `SELECT to_jsonb(x) || jsonb_build_object('id', x.user_id) FROM agent_learning_settings x WHERE x.user_id = ?`},
	{"agent_learning_events", `SELECT to_jsonb(x) FROM agent_learning_events x WHERE x.user_id = ? ORDER BY x.created_at, x.id`},
}

// agentTables are the exportTables that belong to the agent. A restore an
// outside app asked for (RestoreFromMCP) neither clears nor writes them, as
// it never touches the agent's home.
var agentTables = map[string]bool{"agent_learning_settings": true, "agent_learning_events": true}

// OutsideBackup strips what Timely learned from a decoded backup an outside
// app is about to receive: the agent zip and the agent's rows (memory and
// About you texts ride in agent_learning_events). What Timely learned stays
// in Timely (plan 9b.7).
func OutsideBackup(backup map[string]any) {
	delete(backup, "agent")
	if rows, ok := backup["rows"].(map[string]any); ok {
		for table := range agentTables {
			delete(rows, table)
		}
	}
}

// Export is the account's rows as an outside app gets them (MCP
// export_account): without the agent's tables. ExportAccount, the person's
// own backup, adds them and the agent state.
func (s *Service) Export(userID string) (*Backup, error) {
	return s.export(userID, false)
}

func (s *Service) export(userID string, withAgent bool) (*Backup, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	var user models.User
	if err := s.db.Select("id", "email", "name").Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, err
	}
	out := &Backup{
		Format: backupFormat, SchemaVersion: schemaVersion, ExportedAt: time.Now().UTC(),
		Source: SourceAccount{ID: user.ID, Email: user.Email, Name: user.Name},
		Rows:   map[string][]json.RawMessage{},
	}
	for _, spec := range exportTables {
		if agentTables[spec.name] && !withAgent {
			continue
		}
		rows, err := s.db.Raw(spec.query, userID).Rows()
		if err != nil {
			return nil, fmt.Errorf("export %s: %w", spec.name, err)
		}
		items := []json.RawMessage{}
		for rows.Next() {
			var raw []byte
			if err := rows.Scan(&raw); err != nil {
				rows.Close()
				return nil, fmt.Errorf("export %s: %w", spec.name, err)
			}
			items = append(items, append(json.RawMessage(nil), raw...))
		}
		rows.Close()
		out.Rows[spec.name] = items
	}
	return out, nil
}

type RestoreResult struct {
	RestoredAt time.Time      `json:"restoredAt"`
	Counts     map[string]int `json:"counts"`
	// Warnings are what the restore left out, in plain words (the agent
	// state when the assistant is not available here, skills the threat
	// scan refused).
	Warnings []string `json:"warnings,omitempty"`
}

func validateBackup(backup *Backup) error {
	if backup == nil || backup.Format != backupFormat {
		return errors.New("not a Timely backup")
	}
	if backup.SchemaVersion < minSchemaVersion || backup.SchemaVersion > schemaVersion {
		return fmt.Errorf("unsupported backup schema %d", backup.SchemaVersion)
	}
	total := 0
	known := map[string]bool{}
	for _, spec := range exportTables {
		known[spec.name] = true
	}
	for table, rows := range backup.Rows {
		if !known[table] {
			return fmt.Errorf("backup contains unknown table %q", table)
		}
		total += len(rows)
		if total > maxRows {
			return errors.New("backup contains too many rows")
		}
		for _, raw := range rows {
			var object map[string]any
			if len(raw) == 0 || json.Unmarshal(raw, &object) != nil || object["id"] == nil {
				return fmt.Errorf("backup contains an invalid %s row", table)
			}
		}
	}
	if err := requireAccountBasics(backup); err != nil {
		return err
	}
	return rejectNestedTaskBackup(backup)
}

// requireAccountBasics refuses a backup that would leave the account without
// what every account has: its settings and a workspace. A restore replaces
// everything, so an empty or hand-built backup would otherwise wipe the
// account and leave it unusable. Every export has both: registration makes
// the settings row and the last workspace cannot be deleted. Statuses are not
// required, because a person may delete them all and still export.
func requireAccountBasics(backup *Backup) error {
	if len(backup.Rows["configs"]) != 1 {
		return errors.New("This backup has no account settings, so your account was not changed. Choose a backup exported from Timely.")
	}
	if len(backup.Rows["workspaces"]) == 0 {
		return errors.New("This backup has no workspace, so your account was not changed. Choose a backup exported from Timely.")
	}
	return nil
}

// checkAccountBasics runs inside the restore, after the rows are written: if
// the backup's rows did not give the account its settings and a workspace,
// the restore is rolled back and the account keeps its data.
func checkAccountBasics(tx *gorm.DB, userID string) error {
	var configs, workspaces int64
	if err := tx.Raw(`SELECT count(*) FROM configs WHERE user_id = ?`, userID).Scan(&configs).Error; err != nil {
		return err
	}
	if err := tx.Raw(`SELECT count(*) FROM workspaces WHERE user_id = ?`, userID).Scan(&workspaces).Error; err != nil {
		return err
	}
	if configs != 1 || workspaces == 0 {
		return errors.New("This backup would leave your account without its settings or a workspace, so your account was not changed. Choose a backup exported from Timely.")
	}
	return nil
}

func rejectNestedTaskBackup(backup *Backup) error {
	for _, raw := range backup.Rows["tasks"] {
		var row map[string]any
		if json.Unmarshal(raw, &row) != nil {
			continue
		}
		parent, ok := row["parent_task_id"]
		if !ok || parent == nil {
			continue
		}
		if text, ok := parent.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		return errors.New("this backup contains nested tasks; export a new backup after upgrading past the subtask removal")
	}
	return nil
}

type deferredRef struct {
	table, id, column string
	value             any
}

// Restore replaces the account's rows with the backup's.
func (s *Service) Restore(userID string, backup *Backup) (*RestoreResult, error) {
	return s.restore(userID, backup, false)
}

// RestoreFromMCP is Restore for an outside app: the restore vet holds what
// it brings back to what its own tools may do.
func (s *Service) RestoreFromMCP(userID string, backup *Backup) (*RestoreResult, error) {
	return s.restore(userID, backup, true)
}

func (s *Service) restore(userID string, backup *Backup, fromMCP bool) (*RestoreResult, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if err := validateBackup(backup); err != nil {
		return nil, err
	}
	var warnings []string
	// The agent state is staged beside the live home before the
	// transaction, so a bad zip or a threat-scan refusal is known before any
	// row changes, and swapped in only after the rows committed.
	var staged *agenthost.Staged
	switch {
	case backup.Agent == nil:
		if !fromMCP && len(backup.Warnings) > 0 {
			// The export left what Timely learned out (over the cap, the
			// assistant unavailable): say so, and keep the account's own.
			warnings = append(warnings, backup.Warnings...)
			warnings = append(warnings, warnAgentKept)
		}
	case fromMCP:
		warnings = append(warnings, warnAgentNotFromApps)
	default:
		if err := validateAgentState(backup.Agent); err != nil {
			return nil, err
		}
		var warn []string
		staged, warn = s.stageAgent(userID, backup.Agent)
		warnings = append(warnings, warn...)
	}
	committed := false
	defer func() {
		if staged != nil && !committed {
			if err := s.agent.DiscardRestore(*staged); err != nil {
				log.Printf("restore: drop the staged agent state: %v", err)
			}
		}
	}()
	// What the agent learned is replaced only by a backup that carries it
	// (schema 3 rows and an agent state that staged) and never by an
	// outside app. Otherwise the account keeps its learning switches, skill
	// lists and feed as they are, as its agent home stays as it is: the
	// backup's lists would turn back on skills an earlier restore or the
	// person turned off.
	withAgent := !fromMCP && carriesAgentRows(backup) && staged != nil
	counts := map[string]int{}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := clearAccountData(tx, userID, withAgent); err != nil {
			return err
		}
		var refs []deferredRef
		owned := newRestoreOwnership(tx, userID)
		for _, spec := range exportTables {
			if agentTables[spec.name] && !withAgent {
				continue
			}
			for _, raw := range backup.Rows[spec.name] {
				var row map[string]any
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				_, hasUser := row["user_id"]
				if hasUser {
					row["user_id"] = userID
				}
				for column, value := range restoreDefaults[spec.name] {
					if _, ok := row[column]; !ok {
						row[column] = value
					}
				}
				if err := checkRestoreParents(spec.name, row, owned.has); err != nil {
					return err
				}
				for _, col := range deferredColumns(spec.name) {
					if value := row[col]; value != nil && value != "" {
						refs = append(refs, deferredRef{table: spec.name, id: fmt.Sprint(row["id"]), column: col, value: value})
						row[col] = nil
					}
				}
				encoded, _ := json.Marshal(row)
				if err := insertJSONRow(tx, spec.name, encoded); err != nil {
					return fmt.Errorf("restore %s: %w", spec.name, err)
				}
				counts[spec.name]++
				if hasUser || len(restoreParents[spec.name]) > 0 {
					owned.add(spec.name, fmt.Sprint(row["id"]))
				}
			}
		}
		for _, ref := range refs {
			if !owned.has(ref.table, fmt.Sprint(ref.value)) {
				continue
			}
			query := fmt.Sprintf(`UPDATE %q SET %q = ? WHERE id = ?`, ref.table, ref.column)
			if err := tx.Exec(query, ref.value, ref.id).Error; err != nil {
				return fmt.Errorf("restore relationship %s.%s: %w", ref.table, ref.column, err)
			}
		}
		// Restored skills stay off, shown as "restored, review", until the
		// person turns them on (Q-3.4). After the rows: the backup's own
		// settings row is the one marked.
		if staged != nil {
			if err := learning.MarkRestored(tx, userID, staged.RestoredSkills); err != nil {
				return fmt.Errorf("restore: mark restored skills: %w", err)
			}
		}
		if s.vetRestore != nil {
			if err := s.vetRestore(tx, userID, fromMCP); err != nil {
				return err
			}
		}
		return checkAccountBasics(tx, userID)
	})
	if err != nil {
		return nil, err
	}
	committed = true
	if staged != nil {
		warnings = append(warnings, s.commitAgent(*staged)...)
	}
	if s.afterRestore != nil {
		s.afterRestore(userID)
	}
	return &RestoreResult{RestoredAt: time.Now().UTC(), Counts: counts, Warnings: warnings}, nil
}

// carriesAgentRows reports whether the backup has the agent's tables at all
// (every schema 3 export lists them, empty or not).
func carriesAgentRows(backup *Backup) bool {
	for table := range agentTables {
		if _, ok := backup.Rows[table]; ok {
			return true
		}
	}
	return false
}

// restoreDefaults fills NOT NULL columns added after older backups were
// made; a missing key would otherwise insert NULL instead of the default.
var restoreDefaults = map[string]map[string]any{
	"documents":     {"is_template": false},
	"statuses":      {"position": 0},
	"lables":        {"position": 0},
	"custom_fields": {"position": 0},
	"configs": {"mobile_task_views": []any{}, "mobile_active_task_view_id": "",
		"bot_alert_defaults": map[string]any{"desktop": true, "phone": true, "urgent": false}},
	"bots": {"origin_client": "", "knowledge_kind": "", "knowledge_id": "", "kind": "watch", "brief_only": false, "brief_ai": false, "brief_time": ""},
	"bot_alerts": {"feedback_reason": "", "feedback_note": "", "ai_state": "", "ai_why": "", "urgency": "normal",
		"things": []any{}, "also_seen_by": []any{}, "via": []any{}},
	"bot_findings": {"thing_key": "", "chain_id": "", "depth": 0},
}

type parentRef struct {
	column, table string
	required      bool
}

// restoreParents lists the columns of a restored row that point at another
// row and the table that row lives in. Restore keeps backup ids, so without
// this a crafted backup could hang statuses, stages, values or tasks off
// another account's workspace, project or field. Tables without a user_id
// are owned only through their required parent.
var restoreParents = map[string][]parentRef{
	"statuses":              {{"workspace_id", "workspaces", true}},
	"lables":                {{"workspace_id", "workspaces", true}},
	"custom_fields":         {{"workspace_id", "workspaces", true}},
	"projects":              {{"workspace_id", "workspaces", true}},
	"stages":                {{"project_id", "projects", true}},
	"tasks":                 {{"workspace_id", "workspaces", false}, {"project_id", "projects", false}, {"status_id", "statuses", false}, {"stage_id", "stages", false}},
	"focus_sessions":        {{"task_id", "tasks", false}},
	"custom_field_values":   {{"custom_field_id", "custom_fields", true}, {"task_id", "tasks", false}, {"project_id", "projects", false}},
	"documents":             {{"workspace_id", "workspaces", false}, {"project_id", "projects", false}},
	"doc_versions":          {{"document_id", "documents", true}},
	"sheets":                {{"workspace_id", "workspaces", false}, {"project_id", "projects", false}},
	"recurrence_exceptions": {{"rule_id", "recurrence_rules", true}},
	"habit_checks":          {{"habit_id", "habits", true}},
	// bot_checks is never restored, so check_id always comes back NULL.
	"bot_watches": {{"bot_id", "bots", true}},
	// notification_id has no FK, and bumping a "more" alert rewrites that
	// notification, so it must be one restored to this account.
	"bot_alerts":     {{"bot_id", "bots", true}, {"check_id", "bot_checks", false}, {"notification_id", "notifications", false}},
	"bot_lessons":    {{"bot_id", "bots", true}, {"alert_id", "bot_alerts", false}},
	"bot_links":      {{"from_bot_id", "bots", true}, {"to_bot_id", "bots", true}},
	"bot_findings":   {{"bot_id", "bots", true}, {"check_id", "bot_checks", false}, {"watch_id", "bot_watches", false}},
	"bot_price_days": {{"watch_id", "bot_watches", true}, {"bot_id", "bots", true}},
}

// checkRestoreParents vets a row's parents against rows restored earlier from
// this backup or already owned by the restoring user. A foreign or missing
// required parent rejects the restore; a foreign optional link is dropped so
// the row stays the user's but no longer points elsewhere.
func checkRestoreParents(table string, row map[string]any, owned func(table, id string) bool) error {
	for _, ref := range restoreParents[table] {
		value := row[ref.column]
		if value == nil || value == "" {
			if ref.required {
				return fmt.Errorf("restore %s %v: %s is required", table, row["id"], ref.column)
			}
			continue
		}
		if owned(ref.table, fmt.Sprint(value)) {
			continue
		}
		if ref.required {
			return fmt.Errorf("restore %s %v: %s %v not found", table, row["id"], ref.column, value)
		}
		row[ref.column] = nil
	}
	return nil
}

// ownedQueries prove that an existing row belongs to the user, for parents
// that are not in the backup itself.
var ownedQueries = map[string]string{
	"workspaces":       `SELECT count(*) FROM workspaces WHERE id = ? AND user_id = ?`,
	"statuses":         `SELECT count(*) FROM statuses x JOIN workspaces w ON w.id = x.workspace_id WHERE x.id = ? AND w.user_id = ?`,
	"custom_fields":    `SELECT count(*) FROM custom_fields x JOIN workspaces w ON w.id = x.workspace_id WHERE x.id = ? AND w.user_id = ?`,
	"projects":         `SELECT count(*) FROM projects x JOIN workspaces w ON w.id = x.workspace_id WHERE x.id = ? AND w.user_id = ?`,
	"stages":           `SELECT count(*) FROM stages x JOIN projects p ON p.id = x.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE x.id = ? AND w.user_id = ?`,
	"tasks":            `SELECT count(*) FROM tasks WHERE id = ? AND user_id = ?`,
	"documents":        `SELECT count(*) FROM documents WHERE id = ? AND user_id = ?`,
	"recurrence_rules": `SELECT count(*) FROM recurrence_rules WHERE id = ? AND user_id = ?`,
	"habits":           `SELECT count(*) FROM habits WHERE id = ? AND user_id = ?`,
	"bots":             `SELECT count(*) FROM bots WHERE id = ? AND user_id = ?`,
	"bot_watches":      `SELECT count(*) FROM bot_watches WHERE id = ? AND user_id = ?`,
	"bot_alerts":       `SELECT count(*) FROM bot_alerts WHERE id = ? AND user_id = ?`,
	"bot_findings":     `SELECT count(*) FROM bot_findings WHERE id = ? AND user_id = ?`,
}

type restoreOwnership struct {
	tx       *gorm.DB
	userID   string
	restored map[string]map[string]bool
}

func newRestoreOwnership(tx *gorm.DB, userID string) *restoreOwnership {
	return &restoreOwnership{tx: tx, userID: userID, restored: map[string]map[string]bool{}}
}

func (o *restoreOwnership) add(table, id string) {
	if o.restored[table] == nil {
		o.restored[table] = map[string]bool{}
	}
	o.restored[table][id] = true
}

func (o *restoreOwnership) has(table, id string) bool {
	if o.restored[table][id] {
		return true
	}
	query, ok := ownedQueries[table]
	if !ok {
		return false
	}
	var count int64
	if err := o.tx.Raw(query, id, o.userID).Scan(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func deferredColumns(table string) []string {
	switch table {
	case "tasks":
		return []string{"blocked_by_id"}
	case "documents":
		return []string{"parent_id"}
	case "bot_alerts":
		return []string{"shared_with"}
	case "bot_findings":
		return []string{"source_finding_id"}
	default:
		return nil
	}
}

func insertJSONRow(tx *gorm.DB, table string, raw []byte) error {
	query := fmt.Sprintf(`INSERT INTO %q SELECT (jsonb_populate_record(NULL::%q, ?::jsonb)).*`, table, table)
	if table == "schedules" {
		query += " ON CONFLICT (id) DO NOTHING"
	}
	return tx.Exec(query, string(raw)).Error
}

// clearAccountData deletes the rows a restore replaces; withAgent also
// deletes what the agent learned (restore writes the backup's in its place).
func clearAccountData(tx *gorm.DB, userID string, withAgent bool) error {
	queries := []string{
		`DELETE FROM recurrence_exceptions WHERE rule_id IN (SELECT id FROM recurrence_rules WHERE user_id = ?)`,
		`DELETE FROM custom_field_values WHERE custom_field_id IN (SELECT f.id FROM custom_fields f JOIN workspaces w ON w.id = f.workspace_id WHERE w.user_id = ?)`,
		`DELETE FROM task_activities WHERE user_id = ?`,
		`DELETE FROM focus_sessions WHERE user_id = ?`,
		`DELETE FROM scheduled_blocks WHERE user_id = ?`,
		`DELETE FROM recurrence_rules WHERE user_id = ?`,
		`DELETE FROM events WHERE user_id = ?`,
		`DELETE FROM documents WHERE user_id = ?`,
		`DELETE FROM doc_files WHERE user_id = ?`,
		`DELETE FROM sheets WHERE user_id = ?`,
		`DELETE FROM tasks WHERE user_id = ?`,
		`DELETE FROM stages WHERE project_id IN (SELECT p.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ?)`,
		`DELETE FROM projects WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`,
		`DELETE FROM statuses WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`,
		`DELETE FROM lables WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`,
		`DELETE FROM custom_fields WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`,
		`DELETE FROM workspaces WHERE user_id = ?`,
		`DELETE FROM schedule_revisions WHERE user_id = ?`,
		`DELETE FROM configs WHERE user_id = ?`,
		`DELETE FROM notifications WHERE user_id = ?`,
		`DELETE FROM habits WHERE user_id = ?`,
		`DELETE FROM goals WHERE user_id = ?`,
		// Cascades to every bot_* table that has an owner.
		`DELETE FROM bots WHERE user_id = ?`,
		// Goal tags stay: each one holds hashes of the goals and the task's
		// words, so it is used only while both still match, and dropping
		// them made the next goal progress ask about every task again.
		//
		// Finished jobs stay too: they are the record of what was already
		// done (today's digest, smart alerts, overdue alerts), which the sweep
		// checks before queueing the same work again.
		`DELETE FROM jobs WHERE user_id = ? AND status <> 'succeeded'`,
		`DELETE FROM embeddings WHERE user_id = ?`,
	}
	if withAgent {
		queries = append(queries,
			`DELETE FROM agent_learning_events WHERE user_id = ?`,
			`DELETE FROM agent_learning_settings WHERE user_id = ?`)
	}
	for _, query := range queries {
		if err := tx.Exec(query, userID).Error; err != nil {
			return err
		}
	}
	return nil
}

func checksum(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
