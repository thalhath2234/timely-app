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
	"timely-api/internal/realtime"
)

// Check triggers, as stored in bot_checks.trigger and the job payload.
const (
	TriggerSchedule = "schedule"
	TriggerWake     = "wake"
	TriggerRunNow   = "run_now"
	// TriggerAsk is the one check a tag in chat starts (Ask). Like run now,
	// it runs whether or not the Bot is due, once its floor has passed.
	TriggerAsk = "ask"
)

// runsNow reports a trigger that runs a Bot before it is due: Run now, or
// a tag asking it.
func runsNow(trigger string) bool { return trigger == TriggerRunNow || trigger == TriggerAsk }

// Service runs Bots: the Store behind REST and MCP, the sweep that queues
// due Bots, and the checks themselves.
type Service struct {
	store *Store
	db    *gorm.DB
	queue *jobs.Queue
	fetch *fetch.Fetcher
	// keys finds a person's price source key; keyStore is the same store,
	// which also saves keys (SetKeys). Without one (tests), a keyed source
	// answers *price.KeyError and no key can be saved.
	keys     price.Keys
	keyStore *KeyStore
	live     *realtime.Hub // GET /bots/watch; nil answers 503
	now      func() time.Time
	// Ask waits for its check by looking every askPoll, for up to askWait,
	// sleeping through sleep. Tests shorten the sleep.
	askPoll time.Duration
	askWait time.Duration
	sleep   func(ctx context.Context, d time.Duration) error
	// judge decides what an AI-judged Bot's rules spot (SetJudge); nil
	// leaves AI off.
	judge Judge

	mu            sync.Mutex
	rnd           *rand.Rand // under mu
	lastSweepWall time.Time  // under mu
	lastPrune     time.Time  // under mu

	beforeCommit  func(tx *gorm.DB) error // test seam; nil in production
	knowledgeRead func(b Bot)             // test seam, told of each knowledge read; nil in production
}

func New(db *gorm.DB, queue *jobs.Queue) *Service {
	if queue == nil {
		queue = jobs.NewQueue(db)
	}
	store := NewStore(db)
	return &Service{
		store: store, db: db, queue: queue,
		fetch:   fetch.New(fetch.Config{Spacer: store, Robots: store}),
		now:     func() time.Time { return time.Now().UTC() },
		askPoll: askPoll, askWait: askWait, sleep: sleepCtx,
		rnd: rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), rand.Uint64())),
	}
}

// WithDB is a copy of s whose reads and writes go through db and whose jobs
// go on q, so the chat agent's saves join its transaction (a rehearsal's
// rollback takes their logo jobs with it). The copy shares the fetcher,
// the keys, the live hub, the clock, Ask's timing and the judge, and with them the
// process-wide preview memo and limit; it has its own random source and no
// test hook.
func (s *Service) WithDB(db *gorm.DB, q *jobs.Queue) *Service {
	if q == nil {
		q = jobs.NewQueue(db)
	}
	return &Service{
		store: NewStore(db), db: db, queue: q,
		fetch: s.fetch, keys: s.keys, keyStore: s.keyStore, live: s.live, now: s.now,
		askPoll: s.askPoll, askWait: s.askWait, sleep: s.sleep, judge: s.judge,
		rnd: rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), rand.Uint64())),
	}
}

func (s *Service) Store() *Store { return s.store }

// SetKeys gives the checks the people's saved price source keys, and the
// key routes somewhere to save them.
func (s *Service) SetKeys(k *KeyStore) {
	if k == nil {
		return
	}
	s.keys, s.keyStore = k, k
}

// SetFetcher swaps the fetcher every check, preview and key test reads
// through. Tests use it with a fake network (botstest.Net); nil keeps the
// current one.
func (s *Service) SetFetcher(f *fetch.Fetcher) {
	if f != nil {
		s.fetch = f
	}
}

// Register adds the check, site logo and re-judge handlers. The sweep is
// joined into the worker's one sweep in main.go, never set here.
func (s *Service) Register(w *jobs.Worker) {
	w.Handle(models.JobBotCheck, s.HandleCheck)
	w.Handle(models.JobBotIcon, s.HandleIcon)
	w.Handle(models.JobBotJudge, s.HandleRejudge)
}

// Create saves a Bot, and asks for the logos of sites new to Timely, so
// the board shows them before the first check. A save over MCP asks for
// none: that Bot starts paused and nothing may be fetched for an outside
// app's say-so (create_bot promises it), so its logo comes with the first
// clean check after the person turns it on.
func (s *Service) Create(ctx context.Context, userID string, in Input, o Origin) (View, error) {
	v, err := s.store.Create(ctx, userID, in, o, s.now())
	if err == nil && o != OriginMCP {
		s.askIcons(ctx, userID, viewWatches(v))
	}
	return v, err
}

// Update edits a Bot, and asks for the logos of sites new to Timely; over
// MCP it asks for none, as Create.
func (s *Service) Update(ctx context.Context, userID, idOrName string, p Patch, o Origin) (View, error) {
	v, err := s.store.Update(ctx, userID, idOrName, p, o, s.now())
	if err == nil && o != OriginMCP {
		s.askIcons(ctx, userID, viewWatches(v))
	}
	return v, err
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

// Names lists the account's Bots by id and name (Store.Names).
func (s *Service) Names(ctx context.Context, userID string) ([]BotName, error) {
	return s.store.Names(ctx, userID)
}

func (s *Service) Get(ctx context.Context, userID, idOrName string) (Detail, error) {
	return s.store.Get(ctx, userID, idOrName, s.now())
}

// RateAlert records a rating and the lesson it teaches (Store.RateAlert).
func (s *Service) RateAlert(ctx context.Context, userID, botID, alertID string, r Rating) (RateResult, error) {
	ready := s.judge != nil && s.AIStatus(ctx, userID).Ready
	return s.store.RateAlert(ctx, userID, botID, alertID, r, s.now(), ready)
}

// ApplySuggestion makes the change a Bot suggested (Store.ApplySuggestion).
func (s *Service) ApplySuggestion(ctx context.Context, userID, botID, suggestionID string) (View, error) {
	return s.store.ApplySuggestion(ctx, userID, botID, suggestionID, s.now())
}

// DismissSuggestion drops a Bot's suggestion (Store.DismissSuggestion).
func (s *Service) DismissSuggestion(ctx context.Context, userID, botID string) error {
	return s.store.DismissSuggestion(ctx, userID, botID, s.now())
}

func (s *Service) ForgetLesson(ctx context.Context, userID, botID, lessonID string) error {
	return s.store.ForgetLesson(ctx, userID, botID, lessonID)
}

func (s *Service) AlertDefaults(ctx context.Context, userID string) (models.BotAlertDefaults, error) {
	return s.store.AlertDefaults(ctx, userID)
}

func (s *Service) SetAlertDefaults(ctx context.Context, userID string, d models.BotAlertDefaults) (models.BotAlertDefaults, error) {
	return s.store.SetAlertDefaults(ctx, userID, d)
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
	job, err := s.queueCheck(b, floor, TriggerRunNow, now)
	if err != nil {
		return RunResult{}, err
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

// queueCheck queues a check of b that runs now, or once its floor has
// passed. A check already waiting is pulled forward instead of doubled, and
// keeps a run-now trigger it already has (so it still runs before the Bot is
// due); otherwise it takes trigger.
func (s *Service) queueCheck(b Bot, floor time.Duration, trigger string, now time.Time) (*models.Job, error) {
	// The earliest the claim fence lets a check start (spacedAt): the same
	// time the board's Check now and a tag's "soon" go by.
	runAt := now
	if next := spacedAt(b.CheckStartedAt, floor); next.After(runAt) {
		runAt = next
	}
	job, err := s.queue.Enqueue(jobs.Enqueue{
		UserID: b.UserID, Kind: models.JobBotCheck, DedupeKey: checkKey(b.ID), MaxAttempts: checkAttempts, RunAt: runAt,
		Payload: models.JobPayload{"botId": b.ID, "trigger": trigger},
	})
	if err != nil {
		return nil, err
	}
	if !runsNow(job.Payload.String("trigger")) || job.RunAt.After(runAt) {
		if err := s.queue.Expedite(job.ID, runAt, models.JobPayload{"trigger": trigger}); err != nil {
			return nil, err
		}
		if job.RunAt.After(runAt) {
			job.RunAt = runAt
		}
	}
	return job, nil
}

const checkAttempts = 2

func checkKey(botID string) string { return "bot_check:" + botID }
