package bots

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/models"
)

const (
	mcpRestored     = "Restored by an outside app. Turn it on in Timely."
	healthUnusable  = "unsupported"
	restoredOverCap = "Only 25 bots can run. This one came back from a backup paused."
)

// VetRestore checks the Bots a restore just wrote, inside its transaction
// (portability.RestoreVet). The rows come from a file, so none of the checks
// a save makes have run: a Bot whose watches Timely cannot use, or past the
// 25-Bot cap, is paused; an interval under the floor is raised to it; a
// judge mode Timely does not know is set back to rules; a suggestion is
// dropped; no alert keeps a judge input (the export never carries one); a
// doc or sheet a Bot reads that is not the person's, or is in the bin, is
// let go. Restored over MCP, every Bot comes back paused, judged by rules,
// reading no doc or sheet, with the alert settings a Bot made over MCP gets,
// so an outside app cannot turn a Bot, its urgent alerts, AI judging or what
// the judge reads on this way (ADR 0021). A
// stock watch passes when the account has its key, which the restore keeps.
func (s *Service) VetRestore(tx *gorm.DB, userID string, fromMCP bool) error {
	// A suggestion is code's reading of ratings made here, and the file's
	// may name rules it does not have.
	if err := tx.Exec(`UPDATE bots SET suggestion = NULL WHERE user_id = ? AND suggestion IS NOT NULL`, userID).Error; err != nil {
		return err
	}
	// A re-judge reads its input from the alert; a file's would be text no
	// check here read.
	if err := tx.Exec(`UPDATE bot_alerts SET ai_input = NULL WHERE user_id = ? AND ai_input IS NOT NULL`, userID).Error; err != nil {
		return err
	}
	// knowledge_id has no foreign key, so a file can name any row; reads
	// check again, but the Bot should not show another account's title.
	if err := tx.Exec(`
UPDATE bots b SET knowledge_kind = '', knowledge_id = ''
WHERE b.user_id = @uid AND b.knowledge_kind <> '' AND (@mcp
   OR (b.knowledge_kind = 'doc' AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = b.knowledge_id AND d.user_id = b.user_id AND d.archived_at IS NULL))
   OR (b.knowledge_kind = 'sheet' AND NOT EXISTS (SELECT 1 FROM sheets s WHERE s.id = b.knowledge_id AND s.user_id = b.user_id AND s.archived_at IS NULL)))`,
		sql.Named("uid", userID), sql.Named("mcp", fromMCP)).Error; err != nil {
		return err
	}
	var bots []Bot
	if err := tx.Where("user_id = ?", userID).Order("created_at, id").Find(&bots).Error; err != nil {
		return err
	}
	var ws []Watch
	if err := tx.Where("user_id = ?", userID).Order("position, created_at").Find(&ws).Error; err != nil {
		return err
	}
	byBot := map[string][]Watch{}
	for _, w := range ws {
		byBot[w.BotID] = append(byBot[w.BotID], w)
	}
	// Keys hang off the account, not its Bots, so the restore kept them.
	hasKey, err := keySet(tx, userID)
	if err != nil {
		return err
	}
	if err := vetAlertDefaults(tx, userID, fromMCP); err != nil {
		return err
	}
	now := s.now().UTC()
	for i, b := range bots {
		set := map[string]any{}
		if floor := int(Floor(byBot[b.ID]) / time.Second); b.IntervalSeconds < floor {
			set["interval_seconds"] = floor
		}
		if (b.JudgeMode != JudgeRules && b.JudgeMode != JudgeAI) || (fromMCP && b.JudgeMode != JudgeRules) {
			set["judge_mode"] = JudgeRules
		}
		// Only a Bot made over MCP names the app it came from, so a file
		// cannot make another say "From <anything>".
		client := ""
		if b.Origin == OriginMCP {
			client = cleanOriginClient(b.OriginClient)
		}
		if client != b.OriginClient {
			set["origin_client"] = client
		}
		// A file cannot hold off the checks a tag starts.
		if b.AskedAt != nil {
			set["asked_at"] = nil
		}
		reason, detail := "", unusable(byBot[b.ID], hasKey)
		if i >= MaxBots {
			detail = restoredOverCap
		}
		if detail != "" {
			reason = PausePerson
			set["health"], set["health_detail"] = healthUnusable, detail
		}
		if fromMCP {
			set["urgent"], set["notify_desktop"], set["notify_phone"] = false, true, true
			if reason == "" {
				reason = PauseMCP
				set["health_detail"] = mcpRestored
			}
		}
		if reason != "" && b.Status == StatusActive {
			set["status"], set["pause_reason"], set["next_check_at"], set["checking_job_id"] = StatusPaused, reason, nil, nil
		}
		if len(set) == 0 {
			continue
		}
		set["updated_at"] = now
		if err := tx.Model(&Bot{}).Where("id = ? AND user_id = ?", b.ID, userID).Updates(set).Error; err != nil {
			return err
		}
	}
	return nil
}

// vetAlertDefaults checks the restored "Alerts for new bots": a value that
// is not three switches goes back to the default, and over MCP urgent goes
// off, so an outside app cannot make every later Bot urgent this way.
func vetAlertDefaults(tx *gorm.DB, userID string, fromMCP bool) error {
	var rows []struct{ Defaults *string }
	if err := tx.Raw(`SELECT bot_alert_defaults::text AS defaults FROM configs WHERE user_id = ?`, userID).Scan(&rows).Error; err != nil || len(rows) == 0 {
		return err
	}
	defs := models.DefaultBotAlertDefaults()
	if rows[0].Defaults != nil {
		var raw map[string]json.RawMessage
		if json.Unmarshal([]byte(*rows[0].Defaults), &raw) == nil {
			for key, dst := range map[string]*bool{"desktop": &defs.Desktop, "phone": &defs.Phone, "urgent": &defs.Urgent} {
				var v bool
				if b, ok := raw[key]; ok && json.Unmarshal(b, &v) == nil {
					*dst = v
				}
			}
		}
	}
	if fromMCP {
		defs.Urgent = false
	}
	return tx.Exec(`UPDATE configs SET bot_alert_defaults = ? WHERE user_id = ?`, defs, userID).Error
}

// unusable says why a restored Bot's watches cannot run, or "" when they
// pass the checks a save makes.
func unusable(ws []Watch, hasKey hasKeyFunc) string {
	if len(ws) == 0 || len(ws) > MaxWatches {
		return "This bot came back from a backup with no watches Timely can use. Edit it to turn it on."
	}
	for _, w := range ws {
		in := WatchInput{Kind: w.Kind, URL: w.URL, Read: w.ReadMode, Selector: w.Selector, Source: w.Source, Symbol: w.Symbol, Currency: w.Currency, Rules: w.Rules}
		if _, err := cleanWatch(in, nil, hasKey); err != nil {
			var bad *InputError
			if errors.As(err, &bad) {
				return "Restored with a watch Timely cannot use: " + bad.Message + ". Edit it to turn it on."
			}
			return "Restored with a watch Timely cannot use. Edit it to turn it on."
		}
	}
	return ""
}
