package jobs

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
	"timely-api/internal/models"
)

type Handler func(ctx context.Context, job *models.Job) error

// stuckAfter is how long a job may hold its lock without renewing it before
// RecoverStuck hands it to another worker; lockRenewal renews it well within.
const (
	stuckAfter  = 10 * time.Minute
	lockRenewal = time.Minute
)

type Worker struct {
	queue    *Queue
	handlers map[string]Handler
	sweep    func(ctx context.Context) error
	interval time.Duration
	id       string
	// lanes are groups of kinds that run on lanes of their own; every other
	// kind runs on the main lane.
	lanes []lane
}

// lane is a group of kinds and how many of its jobs may run at once.
type lane struct {
	kinds []string
	slots int
}

func NewWorker(queue *Queue) *Worker {
	host, _ := os.Hostname()
	return &Worker{
		queue:    queue,
		handlers: map[string]Handler{},
		interval: 10 * time.Second,
		id:       fmt.Sprintf("%s:%d", host, os.Getpid()),
	}
}

func (w *Worker) Handle(kind string, handler Handler) {
	w.handlers[kind] = handler
}

func (w *Worker) SetSweep(fn func(ctx context.Context) error) {
	w.sweep = fn
}

// Separate runs the given kinds on a lane of their own, one job at a time,
// next to the main lane. A slow kind (a whole account's reindex) then never
// holds up reminders, pushes or other accounts' jobs, and they never hold it
// up. Call it before Run.
func (w *Worker) Separate(kinds ...string) { w.SeparateN(1, kinds...) }

// SeparateN is Separate with up to slots of the lane's jobs running at once
// (at least 1). Call it before Run.
func (w *Worker) SeparateN(slots int, kinds ...string) {
	w.lanes = append(w.lanes, lane{kinds: kinds, slots: max(slots, 1)})
}

// Run works every lane until ctx is cancelled. Each lane claims only its own
// kinds, with the same row locking, so lanes and slots never take each
// other's jobs. The main lane is always one goroutine, because only it
// recovers stuck jobs and runs the sweep.
func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	var others []string
	for _, l := range w.lanes {
		others = append(others, l.kinds...)
		for i := range l.slots {
			wg.Add(1)
			go func(lane Lane, delay time.Duration) {
				defer wg.Done()
				// Stagger the slots so they don't all poll at the same moment.
				if delay > 0 {
					select {
					case <-ctx.Done():
						return
					case <-time.After(delay):
					}
				}
				w.loop(ctx, lane, false)
			}(Lane{Kinds: l.kinds}, time.Duration(i)*w.interval/time.Duration(l.slots))
		}
	}
	w.loop(ctx, Lane{Exclude: others}, true)
	wg.Wait()
}

func (w *Worker) loop(ctx context.Context, lane Lane, main bool) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	w.tick(ctx, lane, main)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx, lane, main)
		}
	}
}

// tick runs the lane's due jobs; the main lane also recovers stuck jobs and
// runs the sweep first.
func (w *Worker) tick(ctx context.Context, lane Lane, main bool) {
	if main {
		if err := w.queue.RecoverStuck(stuckAfter); err != nil {
			log.Printf("jobs recover: %v", err)
		}
		if w.sweep != nil {
			if err := w.sweep(ctx); err != nil {
				log.Printf("jobs sweep: %v", err)
			}
		}
	}
	for {
		if ctx.Err() != nil {
			return
		}
		job, err := w.queue.Claim(ctx, w.id, lane)
		if err != nil {
			log.Printf("jobs claim: %v", err)
			return
		}
		if job == nil {
			return
		}
		w.dispatch(ctx, job)
	}
}

func (w *Worker) dispatch(ctx context.Context, job *models.Job) {
	handler, ok := w.handlers[job.Kind]
	if !ok {
		_ = w.queue.Fail(job, fmt.Errorf("unknown job kind %s", job.Kind))
		return
	}
	// Renew the lock while the handler runs, so a long job (a reindex of a
	// large account) is not mistaken for a stuck one and run a second time.
	done := make(chan struct{})
	renewed := make(chan struct{})
	go func() {
		defer close(renewed)
		ticker := time.NewTicker(lockRenewal)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := w.queue.Renew(job, w.id); err != nil {
					log.Printf("jobs renew %s: %v", job.ID, err)
				}
			}
		}
	}()
	err := handler(ctx, job)
	close(done)
	<-renewed
	if err != nil {
		if failErr := w.queue.Fail(job, err); failErr != nil {
			log.Printf("jobs fail %s: %v", job.ID, failErr)
		}
		return
	}
	if err := w.queue.Succeed(job); err != nil {
		log.Printf("jobs succeed %s: %v", job.ID, err)
	}
}
