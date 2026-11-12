package agenthost

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrSuspended means the account's worker is stopped on purpose for a while
// (Supervisor.Suspend: a backup restore swaps its home), so Ensure refuses it
// until the suspension ends.
var ErrSuspended = errors.New("the account's agent is paused while its data is restored")

// replaceReason is the exit reason of a worker Ensure stops to replace.
func replaceReason(staleCatalog bool) string {
	if staleCatalog {
		return "catalog changed"
	}
	return "restart"
}

// onReady runs Config.OnReady for a worker that just passed its handshake.
func (s *Supervisor) onReady(w *Worker) {
	defer func() {
		if r := recover(); r != nil {
			w.logf("OnReady panicked: %v", r)
		}
	}()
	s.cfg.OnReady(w)
}

// markRestart flags the worker for a restart when idle; false when it was
// already flagged.
func (w *Worker) markRestart() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.restart {
		return false
	}
	w.restart = true
	return true
}

func (w *Worker) restartPending() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.restart
}

// RestartWhenIdle replaces the account's worker without cutting anything
// short (phase 3: a web search key changed, and tool keys live in the
// worker's environment, plan 6.4). An idle worker (no live run, hold or
// reported work, unused for StaleGrace) stops now; a busy one keeps serving
// and stops as soon as it is idle. Either way the next Ensure starts a fresh
// worker, with the account's settings and tool keys read again. With no
// worker running, nothing happens: the next start reads them anyway. A
// worker still starting is flagged once its handshake ends.
func (s *Supervisor) RestartWhenIdle(account string) {
	s.mu.Lock()
	e := s.workers[account]
	s.mu.Unlock()
	if e == nil {
		return
	}
	go func() {
		select {
		case <-e.starting:
		case <-s.closing:
			return
		}
		s.mu.Lock()
		w := e.w
		s.mu.Unlock()
		if w == nil || !w.markRestart() {
			return // the start failed, or a restart is already on its way
		}
		s.stopWhenIdle(w)
	}()
}

// stopWhenIdle stops a worker flagged for restart once it is idle, checking
// often enough that a worker idle for StaleGrace goes within a moment.
// Ensure checks the flag too, so a flagged idle worker is never handed out.
func (s *Supervisor) stopWhenIdle(w *Worker) {
	poll := s.cfg.StaleGrace / 4
	poll = min(max(poll, 10*time.Millisecond), 500*time.Millisecond)
	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		if w.stopIfIdle("restart", s.cfg.StaleGrace) {
			w.logf("stopping: asked to restart, and idle")
			return
		}
		select {
		case <-w.Done():
			return
		case <-s.closing:
			return
		case <-t.C:
		}
	}
}

// Suspend stops the account's worker and keeps it stopped until resume is
// called: Ensure answers ErrSuspended meanwhile (phase 3: a backup restore
// swaps the account's agent home while no worker uses it). A start in
// progress is waited for and then stopped. The stop is graceful, like Stop:
// live runs get the shutdown grace. On an error nothing stays suspended.
// resume is idempotent; suspensions nest.
func (s *Supervisor) Suspend(ctx context.Context, account string) (resume func(), err error) {
	if account == "" {
		return nil, errors.New("agenthost: no account")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, ErrClosed
	}
	s.suspended[account]++
	e := s.workers[account]
	s.mu.Unlock()
	var once sync.Once
	resume = func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.suspended[account] <= 1 {
				delete(s.suspended, account)
			} else {
				s.suspended[account]--
			}
		})
	}
	if e != nil {
		select {
		case <-e.starting:
		case <-ctx.Done():
			resume()
			return nil, ctx.Err()
		}
	}
	if err := s.Stop(ctx, account, "suspended"); err != nil {
		resume()
		return nil, err
	}
	return resume, nil
}
