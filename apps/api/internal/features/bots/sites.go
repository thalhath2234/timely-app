package bots

import (
	"context"
	"time"

	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/utils"
)

// maxRobotsBody matches the fetcher's robots.txt cap.
const maxRobotsBody = 512 << 10

var (
	_ fetch.Spacer      = (*Store)(nil)
	_ fetch.RobotsCache = (*Store)(nil)
)

// Reserve books the next request slot for a site, at least gap after the one
// before. It is one statement, so processes sharing the database never book
// the same slot. A slot further than maxWait away books nothing and gives
// *fetch.SiteBusyError.
func (s *Store) Reserve(ctx context.Context, site string, gap, maxWait time.Duration, now time.Time) (time.Time, error) {
	args := map[string]any{"site": site, "now": now.UTC(), "gap": gap.Seconds(), "wait": maxWait.Seconds()}
	var slots []struct{ Slot time.Time }
	err := s.conn(ctx).Raw(`
INSERT INTO bot_sites (site, next_slot_at, used_at)
VALUES (@site, CAST(@now AS timestamptz) + make_interval(secs => @gap), @now)
ON CONFLICT (site) DO UPDATE
   SET next_slot_at = GREATEST(bot_sites.next_slot_at, CAST(@now AS timestamptz)) + make_interval(secs => @gap), used_at = @now
 WHERE GREATEST(bot_sites.next_slot_at, CAST(@now AS timestamptz)) <= CAST(@now AS timestamptz) + make_interval(secs => @wait)
RETURNING next_slot_at - make_interval(secs => @gap) AS slot`, args).Scan(&slots).Error
	if err != nil {
		return time.Time{}, err
	}
	if len(slots) > 0 {
		return slots[0].Slot.UTC(), nil
	}
	var until []time.Time
	if err := s.conn(ctx).Raw(`SELECT next_slot_at FROM bot_sites WHERE site = ?`, site).Scan(&until).Error; err != nil {
		return time.Time{}, err
	}
	busy := &fetch.SiteBusyError{Until: now.UTC().Add(maxWait)}
	if len(until) > 0 {
		busy.Until = until[0].UTC()
	}
	return time.Time{}, busy
}

// RobotsGet returns a cached robots.txt answer that has not expired.
func (s *Store) RobotsGet(ctx context.Context, origin string, now time.Time) (int, string, bool, error) {
	var rows []struct {
		Status int
		Body   string
	}
	err := s.conn(ctx).Raw(`SELECT status, body FROM bot_robots WHERE origin = ? AND expires_at > ?`, origin, now.UTC()).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return 0, "", false, err
	}
	return rows[0].Status, rows[0].Body, true, nil
}

// RobotsPut caches a robots.txt answer for ttl.
func (s *Store) RobotsPut(ctx context.Context, origin string, status int, body string, now time.Time, ttl time.Duration) error {
	now = now.UTC()
	return s.conn(ctx).Exec(`
INSERT INTO bot_robots (origin, status, body, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (origin) DO UPDATE
   SET status = EXCLUDED.status, body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
		origin, status, utils.StorableText(body, maxRobotsBody), now, now.Add(ttl)).Error
}
