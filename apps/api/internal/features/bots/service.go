package bots

import (
	"context"
	"errors"
	"log"
	"math/rand/v2"
	"sync"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/features/bots/price"
	"timely-api/internal/features/notify"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// Check triggers, as stored in bot_checks.trigger and the job payload.
const (
	TriggerSchedule = "schedule"
	TriggerWake     = "wake"
	TriggerRunNow   = "run_now"
)

// Service runs Bots: the Store behind REST and MCP, the sweep that queues
// due Bots, and the checks themselves.
type Service struct {
	store *Store
	db    *gorm.DB
	queue *jobs.Queue
	fetch *fetch.Fetcher
	// keys finds a person's price source key. Nil until key storage lands
	// (branch 3): a keyed source then answers *price.KeyError.
	keys price.Keys
	now  func() time.Time

	mu            sync.Mutex
	rnd           *rand.Rand // under mu
	lastSweepWall time.Time  // under mu
	lastPrune     time.Time  // under mu

	beforeCommit func(tx *gorm.DB) error // test seam; nil in production
}

func New(db *gorm.DB, queue *jobs.Queue) *Service {
	if queue == nil {
		queue = jobs.NewQueue(db)
	}
	store := NewStore(db)
	return &Service{
		store: store, db: db, queue: queue,
		fetch: fetch.New(fetch.Config{Spacer: store, Robots: store}),
		now:   func() time.Time { return time.Now().UTC() },
		rnd:   rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), rand.Uint64())),
	}
}

func (s *Service) Store() *Store { return s.store }

// Register adds the check handler. The sweep is joined into the worker's
// one sweep in main.go, never set here.
func (s *Service) Register(w *jobs.Worker) { w.Handle(models.JobBotCheck, s.HandleCheck) }

func (s *Service) Create(ctx context.Context, userID string, in Input, o Origin) (View, error) {
	return s.store.Create(ctx, userID, in, o, s.now())
}

func (s *Service) Update(ctx context.Context, userID, idOrName string, p Patch, o Origin) (View, error) {
	return s.store.Update(ctx, userID, idOrName, p, o, s.now())
}

func (s *Service) Pause(ctx context.Context, userID, idOrName, reason string) (View, error) {
	return s.store.Pause(ctx, userID, idOrName, reason, s.now())
}

func (s *Service) Resume(ctx context.Context, userID, id string, o Origin) (View, error) {
	return s.store.Resume(ctx, userID, id, o, s.now())
}

func (s *Service) Snooze(ctx context.Context, userID, id string, until *time.Time) (View, error) {
	return s.store.Snooze(ctx, userID, id, until, s.now())
}

func (s *Service) Delete(ctx context.Context, userID, id string) error {
	return s.store.Delete(ctx, userID, id)
}

func (s *Service) List(ctx context.Context, userID string) (BotList, error) {
	return s.store.List(ctx, userID, s.now())
}

func (s *Service) Get(ctx context.Context, userID, idOrName string) (Detail, error) {
	return s.store.Get(ctx, userID, idOrName, s.now())
}

func (s *Service) Findings(ctx context.Context, userID string, q FindingQuery) ([]Finding, error) {
	return s.store.Findings(ctx, userID, q)
}

// RunResult answers Run now: the job, when it runs, and a line saying so.
type RunResult struct {
	JobID string    `json:"jobId"`
	RunAt time.Time `json:"runAt"`
	Line  string    `json:"line"`
}

// RunNow queues a check as soon as the Bot's floor allows. A paused Bot gives
// ErrPaused. A check already waiting is pulled forward instead of doubled.
// Both origins may run an active Bot; Bots made over MCP start paused.
func (s *Service) RunNow(ctx context.Context, userID, idOrName string, _ Origin) (RunResult, error) {
	now := s.now().UTC()
	db := s.db.WithContext(ctx)
	b, err := findBot(db, userID, idOrName, false)
	if err != nil {
		return RunResult{}, err
	}
	if b.Status != StatusActive {
		return RunResult{}, ErrPaused
	}
	ws, err := loadWatches(db, b.ID, false)
	if err != nil {
		return RunResult{}, err
	}
	floor := Floor(ws)
	runAt := now
	if b.CheckStartedAt != nil {
		if next := b.CheckStartedAt.Add(floor); next.After(runAt) {
			runAt = next.UTC()
		}
	}
	job, err := s.queue.Enqueue(jobs.Enqueue{
		UserID: userID, Kind: models.JobBotCheck, DedupeKey: checkKey(b.ID), MaxAttempts: checkAttempts, RunAt: runAt,
		Payload: models.JobPayload{"botId": b.ID, "trigger": TriggerRunNow},
	})
	if err != nil {
		return RunResult{}, err
	}
	if job.Payload.String("trigger") != TriggerRunNow || job.RunAt.After(runAt) {
		if err := s.queue.Expedite(job.ID, runAt, models.JobPayload{"trigger": TriggerRunNow}); err != nil {
			return RunResult{}, err
		}
		if job.RunAt.After(runAt) {
			job.RunAt = runAt
		}
	}
	// A check queued before the floor allows would lose the fence; the
	// sweep then queues the Bot again when it may run.
	at := maxTime(maxTime(job.RunAt.UTC(), now), spacedAt(b.CheckStartedAt, floor))
	line := "Checking now."
	if at.Sub(now) > 10*time.Second {
		_, loc, err := notify.LoadAlertSettings(db, userID)
		if err != nil {
			return RunResult{}, err
		}
		line = "Checking at " + at.In(loc).Format("15:04") + ". " + floorLine(floor) + "."
	}
	return RunResult{JobID: job.ID, RunAt: at, Line: line}, nil
}

// AfterRestore spreads the restored account's active Bots over the next few
// minutes, so none counts as late (no away alert) and they do not all start
// at once. Every watch records a quiet baseline first.
func (s *Service) AfterRestore(userID string) {
	now := s.now().UTC()
	db := s.db
	var ids []string
	if err := db.Model(&Bot{}).Where("user_id = ? AND status = ?", userID, StatusActive).Pluck("id", &ids).Error; err != nil {
		log.Printf("bots: after restore: %v", err)
		return
	}
	var errs []error
	for _, id := range ids {
		at := now.Add(s.jitter(WakeSpread))
		errs = append(errs, db.Model(&Bot{}).Where("id = ? AND status = ?", id, StatusActive).Updates(map[string]any{
			"next_check_at": at, "checking_job_id": nil, "check_started_at": nil, "updated_at": now,
		}).Error)
	}
	errs = append(errs, db.Model(&Watch{}).Where("user_id = ?", userID).Updates(map[string]any{"baseline_pending": true, "updated_at": now}).Error)
	if err := errors.Join(errs...); err != nil {
		log.Printf("bots: after restore: %v", err)
	}
}

// jitter is a random duration in [0, d].
func (s *Service) jitter(d time.Duration) time.Duration {
	if d <= 0 {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return time.Duration(s.rnd.Int64N(int64(d) + 1))
}

func (s *Service) nextCheck(interval time.Duration, now time.Time) time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return NextCheck(interval, now, s.rnd)
}

const checkAttempts = 2

func checkKey(botID string) string { return "bot_check:" + botID }
