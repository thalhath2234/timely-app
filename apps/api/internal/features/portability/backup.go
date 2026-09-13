package portability

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"timely-api/internal/models"

	"gorm.io/gorm"
)

const (
	backupFormat  = "timely-backup"
	schemaVersion = 1
	maxRows       = 250000
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
	{"documents", `SELECT to_jsonb(x) FROM documents x WHERE x.user_id = ? ORDER BY x.id`},
	{"sheets", `SELECT to_jsonb(x) FROM sheets x WHERE x.user_id = ? ORDER BY x.id`},
	{"events", `SELECT to_jsonb(x) FROM events x WHERE x.user_id = ? ORDER BY x.id`},
	{"recurrence_rules", `SELECT to_jsonb(x) FROM recurrence_rules x WHERE x.user_id = ? ORDER BY x.id`},
	{"recurrence_exceptions", `SELECT to_jsonb(x) FROM recurrence_exceptions x JOIN recurrence_rules r ON r.id = x.rule_id WHERE r.user_id = ? ORDER BY x.id`},
	{"scheduled_blocks", `SELECT to_jsonb(x) FROM scheduled_blocks x WHERE x.user_id = ? ORDER BY x.id`},
	{"schedule_revisions", `SELECT to_jsonb(x) FROM schedule_revisions x WHERE x.user_id = ? ORDER BY x.created_at`},
	{"configs", `SELECT to_jsonb(x) FROM configs x WHERE x.user_id = ? ORDER BY x.id`},
	{"notifications", `SELECT to_jsonb(x) FROM notifications x WHERE x.user_id = ? ORDER BY x.created_at`},
}

func (s *Service) Export(userID string) (*Backup, error) {
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
}

func validateBackup(backup *Backup) error {
	if backup == nil || backup.Format != backupFormat {
		return errors.New("not a Timely backup")
	}
	if backup.SchemaVersion != schemaVersion {
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
	return nil
}

type deferredRef struct {
	table, id, column string
	value             any
}

func (s *Service) Restore(userID string, backup *Backup) (*RestoreResult, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if err := validateBackup(backup); err != nil {
		return nil, err
	}
	counts := map[string]int{}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := clearAccountData(tx, userID); err != nil {
			return err
		}
		var refs []deferredRef
		for _, spec := range exportTables {
			for _, raw := range backup.Rows[spec.name] {
				var row map[string]any
				if err := json.Unmarshal(raw, &row); err != nil {
					return err
				}
				if _, ok := row["user_id"]; ok {
					row["user_id"] = userID
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
			}
		}
		for _, ref := range refs {
			query := fmt.Sprintf(`UPDATE %q SET %q = ? WHERE id = ?`, ref.table, ref.column)
			if err := tx.Exec(query, ref.value, ref.id).Error; err != nil {
				return fmt.Errorf("restore relationship %s.%s: %w", ref.table, ref.column, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &RestoreResult{RestoredAt: time.Now().UTC(), Counts: counts}, nil
}

func deferredColumns(table string) []string {
	switch table {
	case "tasks":
		return []string{"parent_task_id", "blocked_by_id"}
	case "documents":
		return []string{"parent_id"}
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

func clearAccountData(tx *gorm.DB, userID string) error {
	queries := []string{
		`DELETE FROM recurrence_exceptions WHERE rule_id IN (SELECT id FROM recurrence_rules WHERE user_id = ?)`,
		`DELETE FROM custom_field_values WHERE custom_field_id IN (SELECT f.id FROM custom_fields f JOIN workspaces w ON w.id = f.workspace_id WHERE w.user_id = ?)`,
		`DELETE FROM task_activities WHERE user_id = ?`,
		`DELETE FROM scheduled_blocks WHERE user_id = ?`,
		`DELETE FROM recurrence_rules WHERE user_id = ?`,
		`DELETE FROM events WHERE user_id = ?`,
		`DELETE FROM documents WHERE user_id = ?`,
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
		`DELETE FROM jobs WHERE user_id = ?`,
		`DELETE FROM embeddings WHERE user_id = ?`,
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
