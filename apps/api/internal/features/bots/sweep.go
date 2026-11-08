package bots

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

const (
	sweepBatch   = 200
	pruneEvery   = time.Hour
	pruneBatch   = 5000
	wakeAfterGap = time.Minute
)

// Sweep queues every due Bot as a bot_check job. bots.next_check_at is the
// only schedule, so this one indexed query is all a restart, a failed job or
// a sleeping computer needs to catch up. Enqueue's dedupe on waiting and
// running jobs makes repeat sweeps and other processes harmless.
//
// After a gap in wall time (sleep, a closed app, the first sweep of a
// process) the due Bots start spread over a few minutes, and an account
// whose Bots were overdue for a while gets one "While you were away" alert.
func (s *Service) Sweep(ctx context.Context) error {
	now := s.now().UTC()
	// Compare wall clocks: the monotonic clock stops while the computer
	// sleeps, so it would hide exactly the gap this looks for.
	wall := now.Round(0)
	s.mu.Lock()
	wokeUp := s.lastSweepWall.IsZero() || wall.Sub(s.lastSweepWall) > wakeAfterGap
	s.lastSweepWall = wall
	prune := now.Sub(s.lastPrune) > pruneEvery
	if prune {
		s.lastPrune = now
	}
	s.mu.Unlock()

	var due []struct {
		ID          string
		UserID      string
		NextCheckAt time.Time
	}
	// An account with "Pause all bots" on is skipped; its Bots stay due and
	// run once it is turned off.
	if err := s.db.WithContext(ctx).Raw(`SELECT id, user_id, next_check_at FROM bots WHERE status = 'active' AND next_check_at <= @now
		AND NOT EXISTS (SELECT 1 FROM configs c WHERE c.user_id = bots.user_id AND c.bots_paused_at IS NOT NULL)
		ORDER BY next_check_at LIMIT @limit`,
		sql.Named("now", now), sql.Named("limit", sweepBatch)).Scan(&due).Error; err != nil {
		return err
	}
	type away struct {
		earliest time.Time
		bots     int
	}
	late := map[string]*away{}
	var errs []error
	for _, d := range due {
		if err := ctx.Err(); err != nil {
			return err
		}
		trigger, runAt := TriggerSchedule, now
		if now.Sub(d.NextCheckAt) > LateAfter || wokeUp {
			trigger, runAt = TriggerWake, now.Add(WakeSettle+s.jitter(WakeSpread))
		}
		if _, err := s.queue.Enqueue(jobs.Enqueue{
			UserID: d.UserID, Kind: models.JobBotCheck, DedupeKey: checkKey(d.ID), MaxAttempts: checkAttempts, RunAt: runAt,
			Payload: models.JobPayload{"botId": d.ID, "trigger": trigger},
		}); err != nil {
			errs = append(errs, err)
		}
		a := late[d.UserID]
		if a == nil {
			a = &away{earliest: d.NextCheckAt}
			late[d.UserID] = a
		}
		a.bots++
		if d.NextCheckAt.Before(a.earliest) {
			a.earliest = d.NextCheckAt
		}
	}
	if wokeUp {
		for userID, a := range late {
			if now.Sub(a.earliest) <= AwayAfter {
				continue
			}
			errs = append(errs, s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				return awayAlert(tx, userID, a.earliest.UTC(), a.bots, now)
			}))
		}
	}
	if prune {
		errs = append(errs, s.prune(ctx, now))
	}
	return errors.Join(errs...)
}

// prune applies retention in small batches: the check log keeps 30 days and
// the newest 500 per Bot, findings 30 days, alerts a year, price days 366
// days, the shared site and robots caches 30 days past their use, site
// logos 60 days after anyone last asked for them, the AI call log and the
// pass log 30 days, and a re-judge's stored input 6 hours. All times come from Go.
func (s *Service) prune(ctx context.Context, now time.Time) error {
	day := 24 * time.Hour
	steps := []struct {
		sql  string
		args []any
	}{
		{`DELETE FROM bot_checks WHERE ctid IN (SELECT ctid FROM bot_checks WHERE started_at < ? LIMIT ?)`, []any{now.Add(-LogDays * day)}},
		{`DELETE FROM bot_checks WHERE ctid IN (SELECT ctid FROM (
			SELECT ctid, row_number() OVER (PARTITION BY bot_id ORDER BY started_at DESC, id DESC) AS n FROM bot_checks) r
			WHERE r.n > ? LIMIT ?)`, []any{LogMax}},
		{`DELETE FROM bot_findings WHERE ctid IN (SELECT ctid FROM bot_findings WHERE created_at < ? LIMIT ?)`, []any{now.Add(-FindingDays * day)}},
		{`DELETE FROM bot_alerts WHERE ctid IN (SELECT ctid FROM bot_alerts WHERE created_at < ? LIMIT ?)`, []any{now.Add(-AlertKeepDays * day)}},
		{`DELETE FROM bot_price_days WHERE ctid IN (SELECT ctid FROM bot_price_days WHERE day < CAST(? AS date) LIMIT ?)`, []any{now.AddDate(0, 0, -PriceKeepDays).Format(dayLayout)}},
		{`DELETE FROM bot_sites WHERE ctid IN (SELECT ctid FROM bot_sites WHERE used_at < ? LIMIT ?)`, []any{now.Add(-SiteKeepDays * day)}},
		{`DELETE FROM bot_robots WHERE ctid IN (SELECT ctid FROM bot_robots WHERE expires_at < ? LIMIT ?)`, []any{now.Add(-SiteKeepDays * day)}},
		{`DELETE FROM bot_site_icons WHERE ctid IN (SELECT ctid FROM bot_site_icons WHERE used_at < ? LIMIT ?)`, []any{now.Add(-IconKeepDays * day)}},
		{`DELETE FROM bot_ai_calls WHERE ctid IN (SELECT ctid FROM bot_ai_calls WHERE created_at < ? LIMIT ?)`, []any{now.Add(-AICallDays * day)}},
		{`DELETE FROM bot_passes WHERE ctid IN (SELECT ctid FROM bot_passes WHERE created_at < ? LIMIT ?)`, []any{now.Add(-PassDays * day)}},
		// Backstop for a re-judge lost on its last try: no input outlives
		// the retries (15 min + 45 min + 2 h, with room for a late queue).
		{`UPDATE bot_alerts SET ai_input = NULL WHERE ctid IN (SELECT ctid FROM bot_alerts WHERE ai_input IS NOT NULL AND created_at < ? LIMIT ?)`, []any{now.Add(-rejudgeKeepInput)}},
	}
	db := s.db.WithContext(ctx)
	for _, st := range steps {
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			res := db.Exec(st.sql, append(st.args, pruneBatch)...)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected < pruneBatch {
				break
			}
		}
	}
	return nil
}
