package bots

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SaveContinuation keeps what a Run once continuation found (chat's
// BotAgent.SaveContinuation): its reports become alerts on the Check whose
// parked card it ran, as a tick's do. In ONE transaction each report is held
// as a duplicate, snoozed, shared or capped like any other alert, else
// notified with its Review card for a proposal (Q-B5, Q-B6); the alerts it
// sent are then posted into the Bot thread. A Bot that is gone or no longer
// active by then (Pause all included), or a Check that is not the Bot's, saves
// nothing.
func (s *Service) SaveContinuation(ctx context.Context, userID, botID, checkID string, res AgentResult) error {
	reports := cleanReports(agentRun{ran: true, res: res, class: runClass(res, nil)})
	if len(reports) == 0 {
		return nil
	}
	var (
		b     Bot
		posts []string
	)
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		posts = nil
		var found []Bot
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", botID, userID).Limit(1).Find(&found).Error; err != nil {
			return err
		}
		if len(found) == 0 || found[0].Status != StatusActive || found[0].Engine != EngineAgent {
			return nil
		}
		b = found[0]
		if paused, err := accountPaused(tx, userID); err != nil || paused {
			return err
		}
		var check []Check
		if err := tx.Select("id", "alert_id").Where("id = ? AND bot_id = ? AND user_id = ?", checkID, botID, userID).Limit(1).Find(&check).Error; err != nil {
			return err
		}
		if len(check) == 0 {
			return nil
		}
		saved, err := s.saveReports(tx, reportSave{bot: b, checkID: checkID, chainID: checkID, now: s.now().UTC()}, reports)
		if err != nil {
			return err
		}
		posts = saved.posts
		if saved.firstAlert != "" && check[0].AlertID == nil {
			return tx.Model(&Check{}).Where("id = ?", checkID).Update("alert_id", saved.firstAlert).Error
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.postAlerts(ctx, b, posts)
	return nil
}
