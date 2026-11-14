package agenthost

import (
	"sync"
	"time"
)

// Worker limits that Settings → Server changes while the API runs (phase 5,
// instance_settings agent_max_workers and agent_idle_minutes).

// slotSem is the MaxWorkers semaphore, resizable at run time. A smaller cap
// stops nothing: workers over it finish and leave, and no new one starts
// until the count is under the cap again.
type slotSem struct {
	mu    sync.Mutex
	max   int
	used  int
	freed chan struct{} // signalled (never blocking) when a slot frees or the cap grows
}

func newSlotSem(max int) *slotSem {
	return &slotSem{max: max, freed: make(chan struct{}, 1)}
}

func (s *slotSem) tryAcquire() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.used >= s.max {
		return false
	}
	s.used++
	return true
}

func (s *slotSem) release() {
	s.mu.Lock()
	if s.used > 0 {
		s.used--
	}
	s.mu.Unlock()
	s.signal()
}

func (s *slotSem) signal() {
	select {
	case s.freed <- struct{}{}:
	default:
	}
}

func (s *slotSem) resize(max int) {
	s.mu.Lock()
	s.max = max
	s.mu.Unlock()
	s.signal()
}

// inUse is how many slots are taken (tests).
func (s *slotSem) inUse() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.used
}

// SetLimits changes the worker cap and the idle time a worker is reaped
// after, for workers running now and later (Settings → Server). A value
// below 1 keeps the current one.
func (s *Supervisor) SetLimits(maxWorkers, idleMinutes int) {
	if maxWorkers > 0 {
		s.slots.resize(maxWorkers)
	}
	if idleMinutes > 0 {
		s.limitsMu.Lock()
		s.idle = time.Duration(idleMinutes) * time.Minute
		s.limitsMu.Unlock()
	}
	s.logf("worker limits: %d workers, idle %s", s.slots.cap(), s.idleTimeout())
}

func (s *slotSem) cap() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.max
}

// idleTimeout is how long an idle worker lives (Config.IdleTimeout until
// SetLimits changes it).
func (s *Supervisor) idleTimeout() time.Duration {
	s.limitsMu.Lock()
	defer s.limitsMu.Unlock()
	if s.idle > 0 {
		return s.idle
	}
	return s.cfg.IdleTimeout
}
