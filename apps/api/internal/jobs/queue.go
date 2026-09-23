package jobs

import (
	"context"
	"errors"
	"fmt"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Queue struct {
	db *gorm.DB
}

func NewQueue(db *gorm.DB) *Queue {
	return &Queue{db: db}
}

type Enqueue struct {
	UserID    string
	Kind      string
	DedupeKey string
	Payload   models.JobPayload
	RunAt     time.Time
}

func (q *Queue) Enqueue(job Enqueue) (*models.Job, error) {
	if job.UserID == "" || job.Kind == "" {
		return nil, errors.New("job user and kind are required")
	}
	if job.RunAt.IsZero() {
		job.RunAt = time.Now()
	}
	if job.Payload == nil {
		job.Payload = models.JobPayload{}
	}
	if job.DedupeKey != "" {
		var existing models.Job
		err := q.db.Where("dedupe_key = ? AND status IN ?", job.DedupeKey, []string{models.JobPending, models.JobRunning}).
			First(&existing).Error
		if err == nil {
			return &existing, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	row := &models.Job{
		ID:          utils.NewJobID(),
		UserID:      job.UserID,
		Kind:        job.Kind,
		Status:      models.JobPending,
		Payload:     job.Payload,
		RunAt:       job.RunAt.UTC(),
		MaxAttempts: 8,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if job.DedupeKey != "" {
		key := job.DedupeKey
		row.DedupeKey = &key
	}
	if err := q.db.Create(row).Error; err != nil {
		if job.DedupeKey == "" {
			return nil, err
		}
		var existing models.Job
		if findErr := q.db.Where("dedupe_key = ? AND status IN ?", job.DedupeKey, []string{models.JobPending, models.JobRunning}).
			First(&existing).Error; findErr == nil {
			return &existing, nil
		}
		return nil, err
	}
	return row, nil
}

func (q *Queue) EnqueueIndex(userID, kind, entityID, title, body string) error {
	_, err := q.Enqueue(Enqueue{
		UserID:    userID,
		Kind:      models.JobIndexEntity,
		DedupeKey: fmt.Sprintf("index:%s:%s", kind, entityID),
		Payload: models.JobPayload{
			"kind":     kind,
			"entityId": entityID,
			"title":    title,
			"body":     body,
		},
	})
	return err
}

func (q *Queue) Claim(ctx context.Context, workerID string) (*models.Job, error) {
	var job models.Job
	res := q.db.WithContext(ctx).Raw(`
		UPDATE jobs
		SET status = 'running',
		    locked_at = now(),
		    locked_by = ?,
		    started_at = now(),
		    attempts = attempts + 1,
		    updated_at = now()
		WHERE id = (
			SELECT id FROM jobs
			WHERE status = 'pending' AND run_at <= now()
			ORDER BY run_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *
	`, workerID).Scan(&job)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 || job.ID == "" {
		return nil, nil
	}
	return &job, nil
}

func (q *Queue) Succeed(job *models.Job) error {
	now := time.Now().UTC()
	return q.db.Model(job).Updates(map[string]any{
		"status":      models.JobSucceeded,
		"finished_at": now,
		"locked_at":   nil,
		"locked_by":   nil,
		"last_error":  nil,
		"updated_at":  now,
	}).Error
}

func (q *Queue) Fail(job *models.Job, cause error) error {
	now := time.Now().UTC()
	msg := cause.Error()
	if job.Attempts >= job.MaxAttempts {
		return q.db.Model(job).Updates(map[string]any{
			"status":      models.JobFailed,
			"finished_at": now,
			"last_error":  msg,
			"locked_at":   nil,
			"locked_by":   nil,
			"updated_at":  now,
		}).Error
	}
	return q.db.Model(job).Updates(map[string]any{
		"status":     models.JobPending,
		"run_at":     now.Add(Backoff(job.Attempts)),
		"last_error": msg,
		"locked_at":  nil,
		"locked_by":  nil,
		"updated_at": now,
	}).Error
}

func Backoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	shift := attempts
	if shift > 20 {
		shift = 20
	}
	d := time.Duration(1<<uint(shift)) * time.Second
	if d > 15*time.Minute {
		return 15 * time.Minute
	}
	return d
}

func (q *Queue) Retry(userID, jobID string) (*models.Job, error) {
	var job models.Job
	if err := q.db.Where("id = ? AND user_id = ?", jobID, userID).First(&job).Error; err != nil {
		return nil, err
	}
	if job.Status != models.JobFailed && job.Status != models.JobCancelled {
		return nil, errors.New("only failed or cancelled jobs can be retried")
	}
	now := time.Now().UTC()
	if err := q.db.Model(&job).Updates(map[string]any{
		"status":      models.JobPending,
		"run_at":      now,
		"attempts":    0,
		"last_error":  nil,
		"finished_at": nil,
		"locked_at":   nil,
		"locked_by":   nil,
		"updated_at":  now,
	}).Error; err != nil {
		return nil, err
	}
	job.Status = models.JobPending
	job.RunAt = now
	job.Attempts = 0
	job.LastError = nil
	job.FinishedAt = nil
	return &job, nil
}

func (q *Queue) List(userID, status string, limit int) ([]models.Job, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := q.db.Where("user_id = ?", userID).Order("created_at desc").Limit(limit)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var rows []models.Job
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []models.Job{}
	}
	return rows, nil
}

type Health struct {
	Pending           int64 `json:"pending"`
	Running           int64 `json:"running"`
	Failed            int64 `json:"failed"`
	SucceededLastHour int64 `json:"succeededLastHour"`
}

func (q *Queue) Health(userID string) (Health, error) {
	var out Health
	count := func(dest *int64, conds ...any) error {
		return q.db.Model(&models.Job{}).Where("user_id = ?", userID).Where(conds[0], conds[1:]...).Count(dest).Error
	}
	if err := count(&out.Pending, "status = ?", models.JobPending); err != nil {
		return out, err
	}
	if err := count(&out.Running, "status = ?", models.JobRunning); err != nil {
		return out, err
	}
	if err := count(&out.Failed, "status = ?", models.JobFailed); err != nil {
		return out, err
	}
	if err := count(&out.SucceededLastHour, "status = ? AND finished_at >= ?", models.JobSucceeded, time.Now().Add(-time.Hour)); err != nil {
		return out, err
	}
	return out, nil
}

func (q *Queue) UserIDs() ([]string, error) {
	var ids []string
	if err := q.db.Model(&models.Config{}).Distinct("user_id").Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func (q *Queue) HasNotification(dedupeKey string) bool {
	if dedupeKey == "" {
		return false
	}
	var n int64
	q.db.Model(&models.Notification{}).Where("dedupe_key = ?", dedupeKey).Count(&n)
	return n > 0
}

// HasJob includes completed jobs so clearing the notification center does not
// cause a one-time alert to be created again on the next sweep.
func (q *Queue) HasJob(dedupeKey string) bool {
	if dedupeKey == "" {
		return false
	}
	var n int64
	q.db.Model(&models.Job{}).Where("dedupe_key = ?", dedupeKey).Count(&n)
	return n > 0
}

func (q *Queue) RecoverStuck(olderThan time.Duration) error {
	cutoff := time.Now().UTC().Add(-olderThan)
	return q.db.Exec(`
		UPDATE jobs
		SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now()
		WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?
	`, cutoff).Error
}
