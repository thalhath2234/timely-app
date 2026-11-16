package notify

import (
	"context"
	"strings"
	"time"

	"timely-api/internal/models"
)

// BotLearnedTitle is the push for a Bot's staged suggestion (contract
// botLearnedPush): "<bot> learned something - Keep?".
func BotLearnedTitle(botName string) string {
	return strings.TrimSpace(botName) + " learned something - Keep?"
}

// BotLearned tells the person one of their Bots learned something that
// waits for Keep or Discard (plan 9b.3, Q5): one notification and push per
// staged suggestion (pendingID), held by quiet hours like any alert, and
// opening the Bot's page (data botId). A repeat of the same pendingID does
// nothing. A Bot that is gone is skipped.
func (s *Service) BotLearned(ctx context.Context, userID, botID, pendingID string, now time.Time) error {
	if userID == "" || botID == "" || pendingID == "" {
		return nil
	}
	db := s.repo.db.WithContext(ctx)
	var names []string
	if err := db.Table("bots").Where("id = ? AND user_id = ?", botID, userID).Limit(1).Pluck("name", &names).Error; err != nil {
		return err
	}
	if len(names) == 0 {
		return nil
	}
	settings, loc, err := LoadAlertSettings(db, userID)
	if err != nil {
		return err
	}
	key := "bot_learned:" + pendingID
	ntf := models.Notification{
		UserID: userID, Category: models.NotifyBotLearned, Title: BotLearnedTitle(names[0]),
		Body:       "Open the bot to keep or discard it.",
		EntityType: strPtr("bot"), EntityID: strPtr(botID), DedupeKey: &key,
		Data: models.JobPayload{"botId": botID, "pendingId": pendingID},
	}
	_, err = WriteAlert(db, &ntf, settings, loc, AlertOptions{Phone: true, Now: now})
	return err
}
