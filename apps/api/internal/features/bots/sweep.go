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
// only schedule, so an overdue Bot gets one check however many slots it
// missed, and this indexed query is all a restart, a failed job or a
// sleeping computer needs to catch up. A Bot that already has a waiting or
// running check is skipped, so every sweep takes the next due rows, and
// Enqueue's dedupe makes other processes harmless.
//
// After a gap in wall time (the first sweep of a process: Timely was
// closed; a later one: the computer slept) every active Bot at least
// AwayAfter late is marked with how long it was away, which its next check
// records and any alert it raises tells, and each account gets one alert
// that its Bots are catching up. Late checks start one by one on one tail
// (wakeSlot), scheduled checks queued before the gap included, so the check
// slots are never flooded.
func (s *Service) Sweep(ctx context.Context) error {
	now := s.now().UTC()
	// Compare wall clocks: the monotonic clock stops while the computer
	// sleeps, so it would hide exactly the gap this looks for.
	wall := now.Round(0)
	s.mu.Lock()
	prevWall := s.lastSweepWall
	wokeUp := prevWall.IsZero() || wall.Sub(prevWall) > wakeAfterGap
	reason := AwayAsleep
	if prevWall.IsZero() {
		reason = AwayClosed
	}
	s.lastSweepWall = wall
	prune := now.Sub(s.lastPrune) > pruneEvery
	if prune {
		s.lastPrune = now
	}
	s.mu.Unlock()

	db := s.db.WithContext(ctx)
	var away map[string]*awayAccount
	if wokeUp {
		var err error
		if away, err = markAway(db, now, reason); err == nil {
			err = s.reslotWake(db, now)
		}
		if err != nil {
			// The next sweep counts as the wake again, so no Bot misses
			// its mark.
			s.mu.Lock()
			if s.lastSweepWall.Equal(wall) {
				s.lastSweepWall = prevWall
			}
			s.mu.Unlock()
			return err
		}
	}

	var due []struct {
		ID          string
		UserID      string
		NextCheckAt time.Time
	}
	// An account with "Pause all bots" on is skipped; its Bots stay due and
	// run once it is turned off.
	if err := db.Raw(`SELECT id, user_id, next_check_at FROM bots WHERE status = 'active' AND next_check_at <= @now
		AND NOT EXISTS (SELECT 1 FROM configs c WHERE c.user_id = bots.user_id AND c.bots_paused_at IS NOT NULL)
		AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'bot_check:' || bots.id AND j.status IN ('pending', 'running'))
		ORDER BY next_check_at LIMIT @limit`,
		sql.Named("now", now), sql.Named("limit", sweepBatch)).Scan(&due).Error; err != nil {
		return err
	}
	var errs []error
	for _, d := range due {
		if err := ctx.Err(); err != nil {
			return err
		}
		trigger, runAt := TriggerSchedule, now
		if now.Sub(d.NextCheckAt) > LateAfter || wokeUp {
			trigger, runAt = TriggerWake, s.wakeSlot(now)
		}
		if _, err := s.queue.Enqueue(jobs.Enqueue{
			UserID: d.UserID, Kind: models.JobBotCheck, DedupeKey: checkKey(d.ID), MaxAttempts: checkAttempts, RunAt: runAt,
			Payload: models.JobPayload{"botId": d.ID, "trigger": trigger},
		}); err != nil {
			errs = append(errs, err)
		}
	}
	for userID, a := range away {
		errs = append(errs, db.Transaction(func(tx *gorm.DB) error {
			return awayAlert(tx, userID, a.earliest.UTC(), a.bots, now, reason, a.phone)
		}))
	}
	if prune {
		errs = append(errs, s.prune(ctx, now))
	}
	return errors.Join(errs...)
}

// awayAccount is one account's Bots a wake sweep marked: how many, the
// earliest check they missed (among the Bots this gap newly marked, when
// any), and whether any alerts the phone.
type awayAccount struct {
	earliest time.Time
	fresh    bool
	bots     int
	phone    bool
}

// newGap is true for a Bot whose next away mark starts a gap of its own:
// it has none, or a check finished after its last mark. That check ran and
// read nothing (offline, a wait, an edit), so its gap ended there; one that
// keeps failing must not carry its first gap into every later one. A Bot
// with no check since its mark (Timely closed again before it caught up)
// keeps its start and reason.
const newGap = `(away_since IS NULL OR last_check_at > away_until)`

// markAway marks every active Bot at least AwayAfter late, in accounts
// without Pause all, as away until now for reason, keeping the start and
// reason of a gap it has not caught up on yet (newGap). It returns what it
// marked per account, across every batch the due query will take.
func markAway(db *gorm.DB, now time.Time, reason string) (map[string]*awayAccount, error) {
	var marked []struct {
		UserID      string
		AwaySince   time.Time
		NotifyPhone bool
		Fresh       bool
	}
	if err := db.Raw(`WITH m AS (
		SELECT id, `+newGap+` AS fresh FROM bots
		WHERE status = 'active' AND next_check_at <= @cutoff
			AND NOT EXISTS (SELECT 1 FROM configs c WHERE c.user_id = bots.user_id AND c.bots_paused_at IS NOT NULL)
		FOR UPDATE)
	UPDATE bots SET away_since = CASE WHEN m.fresh THEN bots.next_check_at ELSE bots.away_since END, away_until = @now,
		away_reason = CASE WHEN m.fresh THEN @reason ELSE bots.away_reason END, updated_at = @now
	FROM m WHERE bots.id = m.id
	RETURNING bots.user_id, bots.away_since, bots.notify_phone, m.fresh`,
		sql.Named("now", now), sql.Named("reason", reason), sql.Named("cutoff", now.Add(-AwayAfter))).Scan(&marked).Error; err != nil {
		return nil, err
	}
	out := map[string]*awayAccount{}
	for _, m := range marked {
		a := out[m.UserID]
		if a == nil {
			a = &awayAccount{}
			out[m.UserID] = a
		}
		a.bots++
		a.phone = a.phone || m.NotifyPhone
		// The alert dates the gap from the Bots it newly marked: a Bot
		// still on an earlier gap's alert must not hide this one.
		if m.Fresh && (!a.fresh || m.AwaySince.Before(a.earliest)) {
			a.earliest, a.fresh = m.AwaySince, true
		} else if !a.fresh && (a.earliest.IsZero() || m.AwaySince.Before(a.earliest)) {
			a.earliest = m.AwaySince
		}
	}
	return out, nil
}

// reslotWake moves the checks queued before a gap, whose time has passed,
// onto the wake tail in the order they were due, as wake checks: they would
// otherwise all start at once. A check the person asked for (Check now, a
// chat tag) keeps its trigger and time: it runs whether or not its Bot is
// due, and a wake trigger would lose the claim on a Bot that is not.
func (s *Service) reslotWake(db *gorm.DB, now time.Time) error {
	var ids []string
	if err := db.Raw(`SELECT id FROM jobs WHERE kind = ? AND status = ? AND run_at <= ?
		AND COALESCE(payload->>'trigger', '') NOT IN (?, ?) ORDER BY run_at, id`,
		models.JobBotCheck, models.JobPending, now, TriggerRunNow, TriggerAsk).Scan(&ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		if err := db.Exec(`UPDATE jobs SET run_at = ?, payload = jsonb_set(payload, '{trigger}', to_jsonb(CAST(? AS text))), updated_at = ?
			WHERE id = ? AND status = ?`, s.wakeSlot(now), TriggerWake, now, id, models.JobPending).Error; err != nil {
			return err
		}
	}
	return nil
}

// wakeSlot is when the next wake check starts: WakeStep after the last one
// handed out, and never before WakeSettle from now, with up to WakeStep/2 of
// jitter, so consecutive starts are at least WakeStep/2 apart.
func (s *Service) wakeSlot(now time.Time) time.Time {
	s.mu.Lock()
	slot := maxTime(s.wakeTail, now.Add(WakeSettle)).Add(WakeStep)
	s.wakeTail = slot
	s.mu.Unlock()
	return slot.Add(s.jitter(WakeStep / 2))
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
