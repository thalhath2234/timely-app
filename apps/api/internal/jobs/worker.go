package jobs

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"
	"timely-api/internal/models"
)

type Handler func(ctx context.Context, job *models.Job) error

type Worker struct {
	queue    *Queue
	handlers map[string]Handler
	sweep    func(ctx context.Context) error
	interval time.Duration
	id       string
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

func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	w.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	if err := w.queue.RecoverStuck(10 * time.Minute); err != nil {
		log.Printf("jobs recover: %v", err)
	}
	if w.sweep != nil {
		if err := w.sweep(ctx); err != nil {
			log.Printf("jobs sweep: %v", err)
		}
	}
	for {
		if ctx.Err() != nil {
			return
		}
		job, err := w.queue.Claim(ctx, w.id)
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
	if err := handler(ctx, job); err != nil {
		if failErr := w.queue.Fail(job, err); failErr != nil {
			log.Printf("jobs fail %s: %v", job.ID, failErr)
		}
		return
	}
	if err := w.queue.Succeed(job); err != nil {
		log.Printf("jobs succeed %s: %v", job.ID, err)
	}
}
