package bots

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const (
	mcpRestored     = "Restored by an outside app. Turn it on in Timely."
	healthUnusable  = "unsupported"
	restoredOverCap = "Only 25 bots can run. This one came back from a backup paused."
)

// VetRestore checks the Bots a restore just wrote, inside its transaction
// (portability.RestoreVet). The rows come from a file, so none of the checks
// a save makes have run: a Bot whose watches Timely cannot use, or past the
// 25-Bot cap, is paused; an interval under the floor is raised to it; AI
// judging is set back to rules. Restored over MCP, every Bot comes back
// paused with the alert settings a Bot made over MCP gets, so an outside
// app cannot turn a Bot or its urgent alerts on this way (ADR 0021).
func (s *Service) VetRestore(tx *gorm.DB, userID string, fromMCP bool) error {
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
	now := s.now().UTC()
	for i, b := range bots {
		set := map[string]any{}
		if floor := int(Floor(byBot[b.ID]) / time.Second); b.IntervalSeconds < floor {
			set["interval_seconds"] = floor
		}
		if b.JudgeMode != JudgeRules {
			set["judge_mode"] = JudgeRules
		}
		reason, detail := "", unusable(byBot[b.ID])
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

// unusable says why a restored Bot's watches cannot run, or "" when they
// pass the checks a save makes.
func unusable(ws []Watch) string {
	if len(ws) == 0 || len(ws) > MaxWatches {
		return "This bot came back from a backup with no watches Timely can use. Edit it to turn it on."
	}
	for _, w := range ws {
		in := WatchInput{Kind: w.Kind, URL: w.URL, Read: w.ReadMode, Selector: w.Selector, Source: w.Source, Symbol: w.Symbol, Currency: w.Currency, Rules: w.Rules}
		if _, err := cleanWatch(in, nil); err != nil {
			var bad *InputError
			if errors.As(err, &bad) {
				return "Restored with a watch Timely cannot use: " + bad.Message + ". Edit it to turn it on."
			}
			return "Restored with a watch Timely cannot use. Edit it to turn it on."
		}
	}
	return ""
}
