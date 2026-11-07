package bots

import (
	"context"
	"fmt"
	"time"
)

// The morning digest's "From your bots" section.
const (
	digestWindow = 24 * time.Hour
	digestPerBot = 3
	digestBots   = 8
)

// DigestLines lists the past day's findings not yet in a digest (with
// notes passed on that never reached the next Bot), one
// "<Bot>: <finding title>" line each: the newest 3 per Bot, for the 8 Bots
// with the newest findings, then "and N more". done marks every finding the
// lines cover (listed or counted) as digested, so none comes back tomorrow;
// the caller runs it only once the digest is saved. No findings gives no
// lines.
func (s *Service) DigestLines(ctx context.Context, userID string, now time.Time) ([]string, func() error, error) {
	var rows []struct {
		ID, Name, Title, BotID string
	}
	// The past day's notes, and notes whose pass was folded, overflowed or
	// failed in the past day: they went to no one, so the digest lists them.
	since := now.UTC().Add(-digestWindow)
	err := s.db.WithContext(ctx).Raw(`
		SELECT f.id, f.bot_id, b.name, f.title
		FROM bot_findings f JOIN bots b ON b.id = f.bot_id
		WHERE f.user_id = ? AND f.digested_at IS NULL AND (f.created_at > ? OR f.id IN (
			SELECT finding_id FROM bot_passes WHERE user_id = ? AND state IN ? AND updated_at > ? AND finding_id IS NOT NULL))
		ORDER BY f.created_at DESC, f.id DESC`, userID, since, userID, briefPassStates, since).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, nil, err
	}
	rank := map[string]int{} // a Bot's place by its newest finding
	shown := map[string][]string{}
	var order []string
	ids := make([]string, 0, len(rows))
	listed := 0
	for _, r := range rows {
		ids = append(ids, r.ID)
		if _, ok := rank[r.BotID]; !ok {
			rank[r.BotID] = len(order)
			order = append(order, r.BotID)
		}
		if rank[r.BotID] >= digestBots || len(shown[r.BotID]) >= digestPerBot {
			continue
		}
		shown[r.BotID] = append(shown[r.BotID], r.Name+": "+r.Title)
		listed++
	}
	lines := make([]string, 0, listed+1)
	for _, id := range order {
		lines = append(lines, shown[id]...)
	}
	if more := len(rows) - listed; more > 0 {
		lines = append(lines, fmt.Sprintf("and %d more", more))
	}
	done := func() error {
		return s.db.Exec(`UPDATE bot_findings SET digested_at = ? WHERE user_id = ? AND id IN ? AND digested_at IS NULL`,
			now.UTC(), userID, ids).Error
	}
	return lines, done, nil
}
