package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type Queue struct {
	db *gorm.DB
	// now is the API clock. run_at is written from it, so every query that
	// compares against run_at or locked_at passes it in rather than using the
	// database's now(): a database clock that runs behind would otherwise
	// leave due jobs unclaimed, and one that runs ahead would fire them early.
	now func() time.Time
}

func NewQueue(db *gorm.DB) *Queue {
	return &Queue{db: db, now: time.Now}
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

// EnqueueIndex asks for an item's search index rows to be brought up to date.
// The job names the item only: its handler reads the item's text when it
// runs, so a waiting job always indexes the latest edit and a deleted item's
// text is never kept in the queue.
func (q *Queue) EnqueueIndex(userID, kind, entityID string) error {
	key := indexKey(kind, entityID)
	// Inside a transaction (an agent's tool call), hold the waiting job until
	// it ends: a worker that claimed it meanwhile would read the item without
	// this change, which is not committed yet, and nothing would index it
	// later. Claim skips locked jobs; outside a transaction the lock ends at
	// once.
	var waiting []string
	if err := q.db.Raw(`SELECT id FROM jobs WHERE dedupe_key = ? AND status = ? FOR UPDATE`, key, models.JobPending).
		Scan(&waiting).Error; err != nil {
		return err
	}
	// A running job may have read the item before this change. Free its key
	// so the change gets a waiting job of its own instead of being merged
	// into one that is already past it.
	if err := q.db.Model(&models.Job{}).
		Where("dedupe_key = ? AND status = ?", key, models.JobRunning).
		Update("dedupe_key", nil).Error; err != nil {
		return err
	}
	_, err := q.Enqueue(Enqueue{
		UserID:    userID,
		Kind:      models.JobIndexEntity,
		DedupeKey: key,
		Payload:   models.JobPayload{"kind": kind, "entityId": entityID},
	})
	return err
}

// CancelIndex cancels an item's waiting and failed index jobs once the item
// is deleted, so nothing indexes it again (a cancelled job can still be
// retried; it then finds the item gone and does nothing).
func (q *Queue) CancelIndex(userID, kind, entityID string) error {
	now := time.Now().UTC()
	return q.db.Model(&models.Job{}).
		Where("user_id = ? AND kind = ? AND status IN ?", userID, models.JobIndexEntity, []string{models.JobPending, models.JobFailed}).
		Where("payload->>'kind' = ? AND payload->>'entityId' = ?", kind, entityID).
		Updates(map[string]any{
			"status":      models.JobCancelled,
			"finished_at": now,
			"locked_at":   nil,
			"locked_by":   nil,
			"updated_at":  now,
		}).Error
}

func indexKey(kind, entityID string) string {
	return fmt.Sprintf("index:%s:%s", kind, entityID)
}

// Lane limits the kinds a claim may take: only Kinds when it has any, and
// never Exclude. The zero Lane takes any kind.
type Lane struct {
	Kinds   []string
	Exclude []string
}

func (q *Queue) Claim(ctx context.Context, workerID string, lane Lane) (*models.Job, error) {
	var job models.Job
	now := q.now().UTC()
	args := []any{sql.Named("now", now), sql.Named("worker", workerID)}
	kinds := ""
	if len(lane.Kinds) > 0 {
		kinds += " AND kind IN @kinds"
		args = append(args, sql.Named("kinds", lane.Kinds))
	}
	if len(lane.Exclude) > 0 {
		kinds += " AND kind NOT IN @exclude"
		args = append(args, sql.Named("exclude", lane.Exclude))
	}
	res := q.db.WithContext(ctx).Raw(`
		UPDATE jobs
		SET status = 'running',
		    locked_at = @now,
		    locked_by = @worker,
		    started_at = @now,
		    attempts = attempts + 1,
		    updated_at = @now
		WHERE id = (
			SELECT id FROM jobs
			WHERE status = 'pending' AND run_at <= @now`+kinds+`
			ORDER BY run_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *
	`, args...).Scan(&job)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 || job.ID == "" {
		return nil, nil
	}
	return &job, nil
}

// Renew moves a running job's lock time forward, so RecoverStuck leaves a
// job that is still being worked on alone.
func (q *Queue) Renew(job *models.Job, workerID string) error {
	return q.db.Model(&models.Job{}).
		Where("id = ? AND status = ? AND locked_by = ?", job.ID, models.JobRunning, workerID).
		Update("locked_at", q.now().UTC()).Error
}

func (q *Queue) Succeed(job *models.Job) error {
	now := time.Now().UTC()
	if err := q.db.Model(job).Updates(map[string]any{
		"status":      models.JobSucceeded,
		"finished_at": now,
		"locked_at":   nil,
		"locked_by":   nil,
		"last_error":  nil,
		"updated_at":  now,
	}).Error; err != nil {
		return err
	}
	return q.supersede(job, now)
}

// supersede cancels earlier failed runs of the work a job just did, so they
// leave the failed list instead of offering a Retry that would do it again.
// Index jobs are matched by their item: a running one's key may have been
// freed for a newer edit (see EnqueueIndex).
func (q *Queue) supersede(job *models.Job, now time.Time) error {
	older := q.db.Model(&models.Job{}).Where("user_id = ? AND status = ? AND id <> ?", job.UserID, models.JobFailed, job.ID)
	switch {
	case job.Kind == models.JobIndexEntity && job.Payload.String("entityId") != "":
		older = older.Where("kind = ? AND payload->>'kind' = ? AND payload->>'entityId' = ?",
			models.JobIndexEntity, job.Payload.String("kind"), job.Payload.String("entityId"))
	case job.DedupeKey != nil && *job.DedupeKey != "":
		older = older.Where("dedupe_key = ?", *job.DedupeKey)
	default:
		return nil
	}
	return older.Updates(map[string]any{
		"status":      models.JobCancelled,
		"finished_at": now,
		"updated_at":  now,
	}).Error
}

// maxErrorBytes bounds a job's saved last_error, which the apps list.
const maxErrorBytes = 500

// unsavedError replaces a job's error when even the cleaned text cannot be
// saved, so the job still leaves 'running'.
const unsavedError = "Failed with an error that could not be saved."

// Permanent marks an error that another attempt would only repeat: a refused
// key, no credits left, an input the provider rejects. Fail then marks the
// job failed at once instead of spending its other attempts on it; a person
// can still Retry it.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err}
}

type permanentError struct{ error }

func (e permanentError) Unwrap() error { return e.error }

// Fail records the error and either schedules another attempt or, after the
// last one or a Permanent error, marks the job failed. The error usually
// quotes a provider, so it is cleaned first: keys it echoes are hidden, and
// Postgres refuses invalid UTF-8 and NUL, and a refused update would leave
// the job 'running' for RecoverStuck to run again.
func (q *Queue) Fail(job *models.Job, cause error) error {
	var permanent permanentError
	final := job.Attempts >= job.MaxAttempts || errors.As(cause, &permanent)
	err := q.fail(job, utils.StorableText(utils.RedactSecrets(cause.Error()), maxErrorBytes), final)
	if err != nil {
		if again := q.fail(job, unsavedError, final); again == nil {
			return nil
		}
	}
	return err
}

func (q *Queue) fail(job *models.Job, msg string, final bool) error {
	now := time.Now().UTC()
	if final {
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

// ErrNewerRun refuses a Retry while a newer run of the same work is waiting
// or running; that run does what the retry would.
var ErrNewerRun = errors.New("A newer run of this job is already waiting or running, so it wasn’t retried.")

func (q *Queue) Retry(userID, jobID string) (*models.Job, error) {
	var job models.Job
	if err := q.db.Where("id = ? AND user_id = ?", jobID, userID).First(&job).Error; err != nil {
		return nil, err
	}
	if job.Status != models.JobFailed && job.Status != models.JobCancelled {
		return nil, errors.New("only failed or cancelled jobs can be retried")
	}
	if job.DedupeKey != nil && *job.DedupeKey != "" {
		var newer int64
		if err := q.db.Model(&models.Job{}).
			Where("dedupe_key = ? AND status IN ? AND id <> ?", *job.DedupeKey, []string{models.JobPending, models.JobRunning}, job.ID).
			Count(&newer).Error; err != nil {
			return nil, err
		}
		if newer > 0 {
			return nil, ErrNewerRun
		}
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
		// A newer run was queued between the check and this update.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrNewerRun
		}
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
	for i := range rows {
		if rows[i].Kind == models.JobIndexEntity {
			// Index jobs name their item only; never list an item's text.
			delete(rows[i].Payload, "title")
			delete(rows[i].Payload, "body")
		}
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

// RecoverStuck puts back jobs whose lock was not renewed for olderThan: their
// worker stopped (see Worker.dispatch). A job that has used all its attempts
// is marked failed instead, so a job that keeps losing its worker cannot run
// forever.
func (q *Queue) RecoverStuck(olderThan time.Duration) error {
	now := q.now().UTC()
	return q.db.Exec(`
		UPDATE jobs
		SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
		    finished_at = CASE WHEN attempts >= max_attempts THEN @now ELSE finished_at END,
		    last_error = CASE WHEN attempts >= max_attempts THEN @lost ELSE last_error END,
		    locked_at = NULL, locked_by = NULL, updated_at = @now
		WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < @cutoff
	`, sql.Named("now", now), sql.Named("cutoff", now.Add(-olderThan)), sql.Named("lost", "Stopped before finishing, on every attempt.")).Error
}
