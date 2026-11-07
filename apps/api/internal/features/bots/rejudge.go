package bots

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/notify"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// Re-judges: an alert sent while AI was unavailable is judged again at
// +15 min, then 45 min and 2 h after each failed try.
const (
	rejudgeFirst     = 15 * time.Minute
	rejudgeAttempts  = 3
	rejudgeLaterLine = "AI checked it later: "
	// rejudgeKeepInput is how long prune leaves a stored input alone.
	rejudgeKeepInput = 6 * time.Hour
)

var rejudgeDelays = []time.Duration{45 * time.Minute, 2 * time.Hour}

func rejudgeKey(alertID string) string { return "bot_judge:" + alertID }

// queueRejudge asks for an unchecked alert to be judged again, inside the
// transaction that writes it.
func queueRejudge(tx *gorm.DB, b Bot, alertID string, now time.Time) error {
	_, err := jobs.NewQueue(tx).Enqueue(jobs.Enqueue{
		UserID: b.UserID, Kind: models.JobBotJudge, DedupeKey: rejudgeKey(alertID), MaxAttempts: rejudgeAttempts,
		RunAt: now.Add(rejudgeFirst), Payload: models.JobPayload{"alertId": alertID},
	})
	return err
}

// HandleRejudge runs one bot_judge job: it asks the judge again about an
// alert that went out unchecked. A verdict that it was worth it only marks
// the alert judged; one that it was not rewrites its notification (no new
// push). The stored input is dropped after the last try, whatever failed,
// and whenever the job stops, so no copy of page text outlives the retries
// (prune backs this up for a job lost on its last try).
func (s *Service) HandleRejudge(ctx context.Context, job *models.Job) error {
	alertID := job.Payload.String("alertId")
	db := s.db.WithContext(ctx)
	stop := func() error {
		return db.Model(&Alert{}).Where("id = ? AND user_id = ?", alertID, job.UserID).Update("ai_input", nil).Error
	}
	err := s.rejudge(ctx, db, job, alertID, stop)
	if err != nil && job.Attempts >= job.MaxAttempts {
		if serr := stop(); serr != nil {
			return serr
		}
	}
	return err
}

func (s *Service) rejudge(ctx context.Context, db *gorm.DB, job *models.Job, alertID string, stop func() error) error {
	var rows []Alert
	if err := db.Where("id = ? AND user_id = ? AND kind = ? AND ai_state = ? AND ai_input IS NOT NULL",
		alertID, job.UserID, alertKindAlert, aiUnchecked).Limit(1).Find(&rows).Error; err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	if len(rows) == 0 {
		return nil
	}
	a := rows[0]
	var bots []Bot
	if err := db.Where("id = ? AND user_id = ?", a.BotID, job.UserID).Limit(1).Find(&bots).Error; err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	paused, err := accountPaused(db, job.UserID)
	if err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	var jj JudgeJob
	// "Pause all bots" stops it too: the alert stays unchecked.
	if paused || len(bots) == 0 || bots[0].JudgeMode != JudgeAI || s.judge == nil || json.Unmarshal(a.AIInput, &jj) != nil {
		return stop()
	}
	b := bots[0]
	now := s.now().UTC()
	callID, err := s.reserveAI(ctx, b, jj.ChainID, purposeRejudge, now)
	switch {
	case errors.Is(err, errAICap):
		return stop()
	case err != nil:
		return s.rejudgeFailed(job, err, stop)
	}
	in, err := s.rejudgeInput(ctx, db, b, jj.Input)
	if err != nil {
		s.markAI(callID, false, false)
		return jobs.RetryAfter(err, time.Minute)
	}
	v, err := s.callJudge(ctx, b.UserID, in, JudgeTimeout)
	s.markAI(callID, err == nil, !errors.Is(err, ErrJudgeOff))
	switch {
	case errors.Is(err, ErrJudgeOff):
		return stop()
	case err != nil:
		return s.rejudgeFailed(job, err, stop)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		// Under the same lock as sharing, so a Bot joining this alert and
		// the flip do not each write the notification from a stale row.
		if err := lockThings(tx, job.UserID); err != nil {
			return err
		}
		pending := tx.Model(&Alert{}).Where("id = ? AND user_id = ? AND ai_state = ? AND ai_input IS NOT NULL", a.ID, job.UserID, aiUnchecked)
		if v.Alert {
			return pending.Updates(map[string]any{"ai_state": aiJudged, "ai_why": v.Why, "urgency": v.Urgency, "ai_input": nil}).Error
		}
		res := pending.Updates(map[string]any{"ai_state": aiRejudged, "ai_why": v.Why, "ai_input": nil})
		if res.Error != nil || res.RowsAffected == 0 || a.NotificationID == nil {
			return res.Error
		}
		var flipped Alert
		if err := tx.Select("also_seen_by").Where("id = ?", a.ID).Take(&flipped).Error; err != nil {
			return err
		}
		// Bots that joined it before the flip stay named.
		err := notify.BumpAlert(tx, job.UserID, *a.NotificationID, a.Title, rejudgeLaterLine+v.Why+alsoSeenTail(flipped.AlsoSeenBy))
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // the person cleared it
		}
		return err
	})
}

// rejudgeInput is the stored input with the person's side read again from
// the Bot as it is now: its name, description and newest lessons, and its
// doc or sheet through readKnowledge (which checks the row is still the
// person's and out of the bin). An edit, a forgotten lesson or removed
// knowledge since the alert is respected.
func (s *Service) rejudgeInput(ctx context.Context, db *gorm.DB, b Bot, stored JudgeInput) (JudgeInput, error) {
	var lessons []string
	if err := db.Model(&Lesson{}).Where("bot_id = ? AND user_id = ?", b.ID, b.UserID).
		Order("created_at DESC, id DESC").Limit(judgeLessons).Pluck("text", &lessons).Error; err != nil {
		return JudgeInput{}, err
	}
	in := stored
	in.Bot, in.Description, in.Lessons, in.Knowledge = b.Name, clipRunes(b.Description, judgeDescription), nil, nil
	for _, l := range lessons {
		in.Lessons = append(in.Lessons, clipRunes(l, MaxLessonLen))
	}
	in.Knowledge = s.readKnowledge(ctx, b)
	return clipJudgeInput(in, judgeMaxInput), nil
}

// rejudgeFailed retries a failed re-judge later, and after the last try
// drops the stored input; the alert stays unchecked.
func (s *Service) rejudgeFailed(job *models.Job, err error, stop func() error) error {
	if job.Attempts >= job.MaxAttempts {
		if serr := stop(); serr != nil {
			return serr
		}
		return jobs.Permanent(err)
	}
	return jobs.RetryAfter(err, rejudgeDelay(job.Attempts))
}

// rejudgeDelay is the wait after a failed try (attempts counts it).
func rejudgeDelay(attempts int) time.Duration {
	if i := attempts - 1; i >= 0 && i < len(rejudgeDelays) {
		return rejudgeDelays[i]
	}
	return rejudgeDelays[len(rejudgeDelays)-1]
}
