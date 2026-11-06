package bots

import (
	"context"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/jobs"
)

// Service runs Bots: the Store behind REST and MCP, and (from the engine
// commit) the sweep and the checks.
type Service struct {
	store *Store
	db    *gorm.DB
	queue *jobs.Queue
	now   func() time.Time
}

func New(db *gorm.DB, queue *jobs.Queue) *Service {
	return &Service{store: NewStore(db), db: db, queue: queue, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Store() *Store { return s.store }

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

func (s *Service) List(ctx context.Context, userID string) ([]View, error) {
	return s.store.List(ctx, userID, s.now())
}

func (s *Service) Get(ctx context.Context, userID, idOrName string) (Detail, error) {
	return s.store.Get(ctx, userID, idOrName, s.now())
}

func (s *Service) Findings(ctx context.Context, userID string, q FindingQuery) ([]Finding, error) {
	return s.store.Findings(ctx, userID, q)
}
