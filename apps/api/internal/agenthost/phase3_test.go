package agenthost

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestReadyCarriesWebBackendsAndSkillsUpstream(t *testing.T) {
	h := newHarness(t, "ok", nil)
	ready := h.ensure("acct-1").Ready()
	if len(ready.WebBackends) != 2 || ready.WebBackends[0] != "exa" || ready.WebBackends[1] != "firecrawl" || ready.SkillsUpstream != 2 {
		t.Fatalf("ready = %+v", ready)
	}
}

func TestOnReadyRunsOncePerWorkerAndMayRequest(t *testing.T) {
	type call struct {
		account, pid, tag string
		echoed            bool
	}
	calls := make(chan call, 8)
	h := newHarness(t, "ok", func(c *Config) {
		c.OnReady = func(w *Worker) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			reply, err := w.Request(ctx, "echo", map[string]any{"payload": "from OnReady"})
			var body struct {
				Payload string `json:"payload"`
			}
			_ = reply.Decode(&body)
			calls <- call{account: w.Account(), tag: w.Ready().HermesTag, echoed: err == nil && body.Payload == "from OnReady"}
		}
	})
	w := h.ensure("acct-1")
	got := <-calls
	if got.account != "acct-1" || got.tag != "v0.23.0" || !got.echoed {
		t.Fatalf("OnReady saw %+v", got)
	}
	// The same worker again: no second call.
	if again := h.ensure("acct-1"); again.PID() != w.PID() {
		t.Fatal("a second worker started")
	}
	select {
	case extra := <-calls:
		t.Fatalf("OnReady ran again for the same worker: %+v", extra)
	case <-time.After(300 * time.Millisecond):
	}
	// A fresh worker after a stop: called again.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.sup.Stop(ctx, "acct-1", "test"); err != nil {
		t.Fatal(err)
	}
	h.ensure("acct-1")
	select {
	case <-calls:
	case <-time.After(5 * time.Second):
		t.Fatal("OnReady did not run for the new worker")
	}
}

func TestOnReadyPanicDoesNotKillTheWorker(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.OnReady = func(*Worker) { panic("boom") }
	})
	w := h.ensure("acct-1")
	time.Sleep(200 * time.Millisecond)
	select {
	case <-w.Done():
		t.Fatal("the worker exited after OnReady panicked")
	default:
	}
	if !h.log.contains("OnReady panicked") {
		t.Fatal("the panic was not logged")
	}
}

func TestRestartWhenIdleStopsAnIdleWorkerNow(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) { c.StaleGrace = 100 * time.Millisecond })
	h.sup.RestartWhenIdle("nobody") // no worker: nothing to do
	w1 := h.ensure("acct-1")
	time.Sleep(150 * time.Millisecond)
	h.sup.RestartWhenIdle("acct-1")
	exit := h.exit(5 * time.Second)
	if exit.PID != w1.PID() || exit.Reason != "restart" || exit.Crashed {
		t.Fatalf("exit = %+v", exit)
	}
	if w2 := h.ensure("acct-1"); w2.PID() == w1.PID() {
		t.Fatal("Ensure returned the restarted worker")
	}
}

func TestRestartWhenIdleNeverCutsARunShort(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) { c.StaleGrace = 100 * time.Millisecond })
	w1 := h.ensure("acct-1")
	if err := w1.Send(TypeRunStart, map[string]any{"run": "hang-1", "conversation_id": "c1"}); err != nil {
		t.Fatal(err)
	}
	h.message("event")
	h.sup.RestartWhenIdle("acct-1")
	h.sup.RestartWhenIdle("acct-1") // a second ask while one is pending changes nothing
	time.Sleep(400 * time.Millisecond)
	select {
	case <-w1.Done():
		t.Fatal("a worker with a live run was restarted")
	default:
	}
	// While the run is live, Ensure still hands the worker out.
	if w := h.ensure("acct-1"); w.PID() != w1.PID() {
		t.Fatal("a busy worker was replaced")
	}
	if err := w1.Send(TypeRunStop, map[string]any{"run": "hang-1", "reason": "test"}); err != nil {
		t.Fatal(err)
	}
	h.message(TypeRunDone)
	exit := h.exit(5 * time.Second)
	if exit.PID != w1.PID() || exit.Reason != "restart" || exit.Crashed || len(exit.LiveRuns) != 0 {
		t.Fatalf("exit = %+v", exit)
	}
	if w2 := h.ensure("acct-1"); w2.PID() == w1.PID() {
		t.Fatal("Ensure returned the restarted worker")
	}
}

func TestEnsureReplacesAnIdleWorkerFlaggedForRestart(t *testing.T) {
	// A long poll interval would leave the flagged worker running; Ensure
	// must not hand it out once it is idle.
	h := newHarness(t, "ok", func(c *Config) { c.StaleGrace = 100 * time.Millisecond })
	w1 := h.ensure("acct-1")
	if !w1.markRestart() {
		t.Fatal("markRestart refused a fresh worker")
	}
	if w1.markRestart() {
		t.Fatal("markRestart flagged a worker twice")
	}
	time.Sleep(150 * time.Millisecond)
	if w2 := h.ensure("acct-1"); w2.PID() == w1.PID() {
		t.Fatal("Ensure handed out an idle worker flagged for restart")
	}
	if exit := h.exit(5 * time.Second); exit.Reason != "restart" || exit.Crashed {
		t.Fatalf("exit = %+v", exit)
	}
}

func TestSuspendStopsTheWorkerAndRefusesEnsureUntilResumed(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w1 := h.ensure("acct-1")
	other := h.ensure("acct-2")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resume, err := h.sup.Suspend(ctx, "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-w1.Done():
	default:
		t.Fatal("Suspend returned before the worker exited")
	}
	if exit := h.exit(time.Second); exit.PID != w1.PID() || exit.Reason != "suspended" || exit.Crashed {
		t.Fatalf("exit = %+v", exit)
	}
	if err := h.ensureErr("acct-1"); !errors.Is(err, ErrSuspended) {
		t.Fatalf("Ensure while suspended: %v", err)
	}
	// Other accounts are untouched.
	if w := h.ensure("acct-2"); w.PID() != other.PID() {
		t.Fatal("another account's worker was replaced")
	}

	// Suspensions nest: the account stays suspended until both resume.
	resume2, err := h.sup.Suspend(ctx, "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	resume()
	resume() // idempotent: does not undo the second suspension
	if err := h.ensureErr("acct-1"); !errors.Is(err, ErrSuspended) {
		t.Fatalf("Ensure after one of two resumes: %v", err)
	}
	resume2()
	if w := h.ensure("acct-1"); w.PID() == w1.PID() {
		t.Fatal("the suspended worker came back")
	}
}

func TestSuspendWaitsForAStartInProgress(t *testing.T) {
	h := newHarness(t, "ok", nil)
	var wg sync.WaitGroup
	wg.Add(1)
	var started *Worker
	var startErr error
	go func() {
		defer wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		started, startErr = h.sup.Ensure(ctx, "acct-1")
	}()
	// Wait until the start is under way.
	deadline := time.Now().Add(5 * time.Second)
	for {
		h.sup.mu.Lock()
		_, starting := h.sup.workers["acct-1"]
		h.sup.mu.Unlock()
		if starting || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resume, err := h.sup.Suspend(ctx, "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	defer resume()
	wg.Wait()
	if _, ok := h.sup.Worker("acct-1"); ok {
		t.Fatal("a worker is running while the account is suspended")
	}
	if startErr == nil {
		select {
		case <-started.Done():
		default:
			t.Fatal("the worker started during Suspend is still running")
		}
	}
}

func TestSuspendGivesUpWithItsContext(t *testing.T) {
	h := newHarness(t, "stubborn", func(c *Config) {
		c.ShutdownGrace = 3 * time.Second
		c.KillWait = 3 * time.Second
	})
	h.ensure("acct-1")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := h.sup.Suspend(ctx, "acct-1"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Suspend = %v, want the context's deadline", err)
	}
	// Nothing stays suspended: once the stubborn worker is gone, Ensure
	// starts a new one.
	h.exit(15 * time.Second)
	h.ensure("acct-1")
}
