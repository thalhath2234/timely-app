package bots

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"timely-api/internal/features/notify"
	"timely-api/internal/models"
)

// How fresh an Answer is.
const (
	FreshCheckedNow = "checked_now" // the check the tag started finished
	FreshRecent     = "recent"      // the last check is under an hour old
	FreshWaiting    = "waiting"     // the tag's check had not finished in time
	FreshPaused     = "paused"      // a paused Bot is never checked for a tag
	FreshLimited    = "limited"     // a tag checked this Bot in the last 5 minutes
	FreshFloor      = "floor"       // the Bot's floor has not passed since its last check
)

const (
	// askFresh is how old the last check may be before a tag checks again.
	askFresh = time.Hour
	// askEvery is how often a tag may start a check of one Bot.
	askEvery = 5 * time.Minute
	// askSoon is how soon the floor must allow a check for a tag to start one.
	askSoon = 10 * time.Second
	askPoll = time.Second
	askWait = 30 * time.Second
	// askFindings and askItems bound what an Answer carries.
	askFindings    = 5
	askFindingDays = 7
	askItems       = 3
)

// Answer is what a Bot knows now, for a person who tagged it in chat: its
// latest readings and findings, and how fresh they are. Readings and item
// titles are page text, so whoever shows it to a model marks it as outside
// data.
type Answer struct {
	Bot         AnswerBot     `json:"bot"`
	Fresh       string        `json:"fresh"`     // one of the Fresh* values
	FreshLine   string        `json:"freshLine"` // "Checked 40 min ago"
	CheckedAt   *time.Time    `json:"checkedAt"`
	NextCheckAt *time.Time    `json:"nextCheckAt"`
	Watches     []AnswerWatch `json:"watches"`
	Findings    []Finding     `json:"findings"` // the last 7 days, newest first, at most 5
	AlertsToday int           `json:"alertsToday"`
}

// AnswerBot names the Bot an Answer is from.
type AnswerBot struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Status      string  `json:"status"`
	PauseReason *string `json:"pauseReason"`
	Health      Health  `json:"health"`
}

// AnswerWatch is one watch's latest reading.
type AnswerWatch struct {
	ID            string      `json:"id"`
	Kind          string      `json:"kind"`
	Site          string      `json:"site"`
	Title         string      `json:"title"` // watchTitle
	Summary       string      `json:"summary"`
	Value         *float64    `json:"value"`
	Currency      string      `json:"currency"`
	Excerpt       string      `json:"excerpt"`
	Items         []ItemBrief `json:"items"` // feeds: the newest 3
	LastChangedAt *time.Time  `json:"lastChangedAt"`
}

// Ask answers for a Bot (by id or name) from its latest findings. An active
// Bot whose last check is over an hour old is checked once first, as Run now
// would, with the trigger ask; a tag starts at most one such check of a Bot
// every 5 minutes, and none before its floor allows. The check is a normal
// one, so alert caps and strikes apply. Ask waits up to askWait for it, then
// answers from what is saved.
func (s *Service) Ask(ctx context.Context, userID, idOrName string) (Answer, error) {
	now := s.now().UTC()
	db := s.db.WithContext(ctx)
	b, err := findBot(db, userID, idOrName, false)
	if err != nil {
		return Answer{}, err
	}
	_, loc, err := notify.LoadAlertSettings(db, userID)
	if err != nil {
		return Answer{}, err
	}
	fresh, line := "", ""
	var nextAt *time.Time
	switch {
	case b.Status != StatusActive:
		fresh, line = FreshPaused, "Paused, and not checked yet"
		if b.LastCheckAt != nil {
			line = "Paused, so this is from " + b.LastCheckAt.In(loc).Format("Jan 2")
		}
	case b.LastCheckAt != nil && now.Sub(*b.LastCheckAt) < askFresh:
		fresh, line = FreshRecent, "Checked "+ago(now.Sub(*b.LastCheckAt))
	default:
		fresh, line, nextAt, err = s.askCheck(ctx, b, loc, now)
		if err != nil {
			return Answer{}, err
		}
	}
	a, err := s.answer(ctx, userID, b.ID)
	if err != nil {
		return Answer{}, err
	}
	a.Fresh, a.FreshLine = fresh, line
	if nextAt != nil {
		a.NextCheckAt = nextAt
	}
	return a, nil
}

// askCheck checks an active Bot for a tag, when the 5-minute limit and its
// floor allow, and waits for the check. nextAt is set for a floor answer:
// when the Bot is next checked.
func (s *Service) askCheck(ctx context.Context, b Bot, loc *time.Location, now time.Time) (fresh, line string, nextAt *time.Time, err error) {
	db := s.db.WithContext(ctx)
	// One conditional update, so two tags at once start one check.
	claim := db.Exec(`
UPDATE bots SET asked_at = @now
WHERE id = @id AND user_id = @uid AND (asked_at IS NULL OR asked_at < @since)`,
		sql.Named("now", now), sql.Named("id", b.ID), sql.Named("uid", b.UserID), sql.Named("since", now.Add(-askEvery)))
	if claim.Error != nil {
		return "", "", nil, claim.Error
	}
	if claim.RowsAffected == 0 {
		waiting, err := s.checkWaiting(ctx, b.ID)
		if err != nil {
			return "", "", nil, err
		}
		if waiting {
			return FreshLimited, "Checking now for an earlier tag; the result shows on the bot", nil, nil
		}
		since := time.Duration(0) // a tag that claimed it after b was read
		if b.AskedAt != nil {
			since = now.Sub(*b.AskedAt)
		}
		return FreshLimited, "Checked " + ago(since) + " by an earlier tag", nil, nil
	}
	ws, err := loadWatches(db, b.ID, false)
	if err != nil {
		return "", "", nil, err
	}
	floor := Floor(ws)
	if at := spacedAt(b.CheckStartedAt, floor); at.After(now.Add(askSoon)) {
		// No check started, so give the 5 minutes back: the next tag may
		// check once the floor has passed.
		if err := db.Exec(`UPDATE bots SET asked_at = @prev WHERE id = @id AND asked_at = @now`,
			sql.Named("prev", b.AskedAt), sql.Named("id", b.ID), sql.Named("now", now)).Error; err != nil {
			return "", "", nil, err
		}
		if b.NextCheckAt != nil && b.NextCheckAt.After(at) {
			at = b.NextCheckAt.UTC()
		}
		return FreshFloor, floorLine(floor) + ". Next check " + at.In(loc).Format("15:04"), &at, nil
	}
	if _, err := s.queueCheck(b, floor, TriggerAsk, now); err != nil {
		return "", "", nil, err
	}
	done, err := s.awaitCheck(ctx, b.ID, b.LastCheckAt)
	if err != nil {
		return "", "", nil, err
	}
	if !done {
		return FreshWaiting, "Checking now; the result shows on the bot", nil, nil
	}
	return FreshCheckedNow, "Checked just now", nil, nil
}

// checkWaiting reports a check of the Bot queued or running.
func (s *Service) checkWaiting(ctx context.Context, botID string) (bool, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&models.Job{}).
		Where("dedupe_key = ? AND status IN ?", checkKey(botID), []string{models.JobPending, models.JobRunning}).Count(&n).Error
	return n > 0, err
}

// awaitCheck looks every askPoll, for up to askWait, for a check of the Bot
// that finished after last (nil: one that ever finished). Failed checks count:
// they are saved too, and the Answer shows the Bot's health.
func (s *Service) awaitCheck(ctx context.Context, botID string, last *time.Time) (bool, error) {
	for waited := time.Duration(0); waited < s.askWait; waited += s.askPoll {
		if err := s.sleep(ctx, s.askPoll); err != nil {
			return false, err
		}
		var rows []Bot
		if err := s.db.WithContext(ctx).Select("id", "last_check_at").Where("id = ?", botID).Limit(1).Find(&rows).Error; err != nil {
			return false, err
		}
		if len(rows) == 0 {
			return false, ErrNotFound
		}
		if at := rows[0].LastCheckAt; at != nil && (last == nil || at.After(*last)) {
			return true, nil
		}
	}
	return false, nil
}

// answer builds an Answer, without its freshness, from the Bot's rows now.
func (s *Service) answer(ctx context.Context, userID, botID string) (Answer, error) {
	now := s.now().UTC()
	v, ws, err := s.store.load(ctx, userID, botID, now)
	if err != nil {
		return Answer{}, err
	}
	findings, err := s.store.Findings(ctx, userID, FindingQuery{BotID: botID, Since: now.AddDate(0, 0, -askFindingDays), Limit: askFindings})
	if err != nil {
		return Answer{}, err
	}
	a := Answer{
		Bot:       AnswerBot{ID: v.ID, Name: v.Name, Status: v.Status, PauseReason: v.PauseReason, Health: v.Health},
		CheckedAt: v.LastCheckAt, NextCheckAt: v.NextCheckAt, Watches: make([]AnswerWatch, 0, len(ws)),
		Findings: findings, AlertsToday: v.AlertsToday,
	}
	for i, w := range ws {
		wv := v.Watches[i]
		aw := AnswerWatch{
			ID: w.ID, Kind: w.Kind, Site: wv.Site, Title: watchTitle(w), Summary: wv.Summary, Value: wv.Value,
			Currency: w.Currency, Excerpt: wv.Excerpt, Items: []ItemBrief{}, LastChangedAt: w.LastChangedAt,
		}
		if r := w.LastReading; r != nil {
			if r.Currency != "" {
				aw.Currency = r.Currency
			}
			if w.Kind == WatchFeed {
				aw.Items = newestItems(r.Items, askItems)
			}
		}
		a.Watches = append(a.Watches, aw)
	}
	return a, nil
}

// ago says how long ago d was, for a time under a day: "just now",
// "40 min ago", "3 h ago".
func ago(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%d min ago", int(d/time.Minute))
	}
	return fmt.Sprintf("%d h ago", int(d/time.Hour))
}

// sleepCtx waits d, or until ctx ends.
func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
