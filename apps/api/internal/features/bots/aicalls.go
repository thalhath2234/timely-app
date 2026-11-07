package bots

import (
	"context"
	"database/sql"
	"log"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/utils"
)

// What an AI call is for (bot_ai_calls.purpose).
const (
	purposeJudge   = "judge"
	purposeRejudge = "rejudge"
	purposeBrief   = "brief"
)

// AICall is one AI call a Bot made (table bot_ai_calls): the daily caps and
// the board's "AI checks today" count these rows. It has no foreign key to
// bots, so deleting a Bot or restoring a backup resets no count.
type AICall struct {
	ID        string    `gorm:"type:text;primaryKey"`
	UserID    string    `gorm:"type:text;not null"`
	BotID     string    `gorm:"type:text;not null"`
	ChainID   string    `gorm:"type:text;not null"`
	LocalDay  time.Time `gorm:"type:date;not null"`
	Purpose   string    `gorm:"type:text;not null"`
	OK        bool      `gorm:"column:ok;not null"`
	CreatedAt time.Time
}

func (AICall) TableName() string { return "bot_ai_calls" }

// reserveAI takes one AI call for b before it is made, in its own short
// transaction under the account's AI lock: errAICap when b has made
// AIPerBot calls today, the account AIPerAccount, or the chain ChainAI
// (whoever made them). Days are the notification zone's.
func (s *Service) reserveAI(ctx context.Context, b Bot, chainID, purpose string, now time.Time) (string, error) {
	id := utils.PrefixedUUID("bai")
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext('bot_ai:' || ?))", b.UserID).Error; err != nil {
			return err
		}
		day, err := localDay(tx, b.UserID, now)
		if err != nil {
			return err
		}
		var n struct{ Bot, Account, Chain int }
		if err := tx.Raw(`
SELECT count(*) FILTER (WHERE bot_id = @bot) AS bot, count(*) AS account,
       (SELECT count(*) FROM bot_ai_calls WHERE user_id = @uid AND chain_id = @chain AND @chain <> '') AS chain
FROM bot_ai_calls WHERE user_id = @uid AND local_day = CAST(@day AS date)`,
			sql.Named("bot", b.ID), sql.Named("uid", b.UserID), sql.Named("chain", chainID), sql.Named("day", day)).Scan(&n).Error; err != nil {
			return err
		}
		if n.Bot >= AIPerBot || n.Account >= AIPerAccount || n.Chain >= ChainAI {
			return errAICap
		}
		return tx.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, chain_id, local_day, purpose, created_at) VALUES (?, ?, ?, ?, CAST(? AS date), ?, ?)`,
			id, b.UserID, b.ID, chainID, day, purpose, now.UTC()).Error
	})
	if err != nil {
		return "", err
	}
	return id, nil
}

// markAI records how a reserved call went. A call the judge never made (AI
// off) gives its slot back, so a Bot with no AI uses none of the caps.
func (s *Service) markAI(callID string, ok, made bool) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(context.Background()), releaseWithin)
	defer cancel()
	db := s.db.WithContext(ctx)
	var err error
	if made {
		err = db.Exec(`UPDATE bot_ai_calls SET ok = ? WHERE id = ?`, ok, callID).Error
	} else {
		err = db.Exec(`DELETE FROM bot_ai_calls WHERE id = ?`, callID).Error
	}
	if err != nil {
		log.Printf("bots: mark ai call %s: %v", callID, err)
	}
}

// aiCallsToday counts the account's AI calls today, in all and by Bot.
func aiCallsToday(db *gorm.DB, userID, day string) (int, map[string]int, error) {
	var rows []struct {
		BotID string
		N     int
	}
	q := db.Model(&AICall{}).Select("bot_id, count(*) AS n").Where("user_id = ? AND local_day = CAST(? AS date)", userID, day)
	if err := q.Group("bot_id").Scan(&rows).Error; err != nil {
		return 0, nil, err
	}
	total, by := 0, map[string]int{}
	for _, r := range rows {
		total += r.N
		by[r.BotID] = r.N
	}
	return total, by, nil
}
