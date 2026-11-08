package jobs

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"timely-api/internal/models"
)

// slotKind is the kind multi-slot lanes were added for (ADR 0021).
const slotKind = models.JobBotCheck

// waitFor polls cond until it holds or five seconds pass.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// blockingLane runs w with a handler for slotKind that holds each job until
// release is closed, counting how many run at once.
func blockingLane(t *testing.T, w *Worker) (running, peak, done *atomic.Int32, release chan struct{}) {
	t.Helper()
	running, peak, done = &atomic.Int32{}, &atomic.Int32{}, &atomic.Int32{}
	release = make(chan struct{})
	w.Handle(slotKind, func(ctx context.Context, job *models.Job) error {
		n := running.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		select {
		case <-release:
		case <-ctx.Done():
		}
		running.Add(-1)
		done.Add(1)
		return nil
	})
	return running, peak, done, release
}

func runWorker(t *testing.T, w *Worker) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { w.Run(ctx); close(stopped) }()
	t.Cleanup(func() { cancel(); <-stopped })
}

// A lane with three slots runs three of its jobs at once, never a fourth.
func TestIntegrationSeparateNRunsUpToItsSlots(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	w := NewWorker(q)
	w.interval = 20 * time.Millisecond
	w.SeparateN(3, slotKind)
	running, peak, done, release := blockingLane(t, w)
	defer close(release)

	for range 5 {
		if _, err := q.Enqueue(Enqueue{UserID: "user-a", Kind: slotKind}); err != nil {
			t.Fatal(err)
		}
	}
	runWorker(t, w)
	waitFor(t, "three jobs running", func() bool { return running.Load() == 3 })
	// Twenty more ticks: no slot is free, so no fourth job starts.
	time.Sleep(20 * w.interval)
	if got := peak.Load(); got != 3 {
		t.Fatalf("%d jobs ran at once on a 3-slot lane", got)
	}
	release <- struct{}{}
	waitFor(t, "a freed slot to take the fourth job", func() bool { return done.Load() == 1 && running.Load() == 3 })
	if got := peak.Load(); got != 3 {
		t.Fatalf("%d jobs ran at once on a 3-slot lane", got)
	}
}

// A lane whose every slot is busy does not hold up reminders on the main lane.
func TestIntegrationBusyLaneDoesNotDelayReminders(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	w := NewWorker(q)
	w.interval = 20 * time.Millisecond
	w.SeparateN(2, slotKind)
	running, _, _, release := blockingLane(t, w)
	defer close(release)
	ran := make(chan struct{}, 1)
	w.Handle(models.JobSendReminder, func(ctx context.Context, job *models.Job) error {
		ran <- struct{}{}
		return nil
	})

	for range 3 {
		if _, err := q.Enqueue(Enqueue{UserID: "user-a", Kind: slotKind}); err != nil {
			t.Fatal(err)
		}
	}
	runWorker(t, w)
	waitFor(t, "the lane to fill", func() bool { return running.Load() == 2 })
	if _, err := q.Enqueue(Enqueue{UserID: "user-b", Kind: models.JobSendReminder}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ran:
	case <-time.After(5 * time.Second):
		t.Fatal("the reminder waited behind a full lane")
	}
}

func TestIntegrationEnqueueKeepsMaxAttempts(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	two, err := q.Enqueue(Enqueue{UserID: "user-a", Kind: slotKind, MaxAttempts: 2})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := q.Enqueue(Enqueue{UserID: "user-a", Kind: models.JobSendReminder})
	if err != nil {
		t.Fatal(err)
	}
	if got := jobRow(t, db, two.ID).MaxAttempts; got != 2 {
		t.Fatalf("max_attempts = %d, want 2", got)
	}
	if got := jobRow(t, db, plain.ID).MaxAttempts; got != 8 {
		t.Fatalf("default max_attempts = %d, want 8", got)
	}
}

func TestIntegrationRetryAfterSetsRunAt(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	job, _ := q.Enqueue(Enqueue{UserID: "user-a", Kind: slotKind, MaxAttempts: 2})
	claimed, err := q.Claim(context.Background(), "w1", Lane{})
	if err != nil || claimed == nil || claimed.ID != job.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	before := time.Now()
	if err := q.Fail(claimed, RetryAfter(errors.New("site asked to wait"), 10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	after := time.Now()
	row := jobRow(t, db, job.ID)
	if row.Status != models.JobPending {
		t.Fatalf("status %s, want pending", row.Status)
	}
	if row.RunAt.Before(before.Add(10*time.Minute).Add(-time.Second)) || row.RunAt.After(after.Add(10*time.Minute).Add(time.Second)) {
		t.Fatalf("run_at %s, want about %s", row.RunAt, before.Add(10*time.Minute))
	}

	// The second of two attempts is final, RetryAfter or not.
	q.now = func() time.Time { return row.RunAt.Add(time.Second) }
	claimed, _ = q.Claim(context.Background(), "w1", Lane{})
	if claimed == nil || claimed.ID != job.ID {
		t.Fatalf("second claim: %+v", claimed)
	}
	if err := q.Fail(claimed, RetryAfter(errors.New("site asked to wait"), 10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, job.ID); row.Status != models.JobFailed {
		t.Fatalf("status after the last attempt %s, want failed", row.Status)
	}
}

func TestIntegrationExpeditePullsAWaitingJobForward(t *testing.T) {
	db := integrationDB(t)
	q := NewQueue(db)
	now := time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)
	q.now = func() time.Time { return now }
	job, err := q.Enqueue(Enqueue{UserID: "user-a", Kind: slotKind, RunAt: now.Add(time.Hour),
		Payload: models.JobPayload{"botId": "bot_1", "trigger": "schedule"}})
	if err != nil {
		t.Fatal(err)
	}

	if err := q.Expedite(job.ID, now, models.JobPayload{"trigger": "run_now"}); err != nil {
		t.Fatal(err)
	}
	row := jobRow(t, db, job.ID)
	if !row.RunAt.Equal(now) {
		t.Fatalf("run_at %s, want %s", row.RunAt, now)
	}
	if row.Payload.String("botId") != "bot_1" || row.Payload.String("trigger") != "run_now" {
		t.Fatalf("payload %v", row.Payload)
	}

	// A later time never pushes the job back.
	if err := q.Expedite(job.ID, now.Add(2*time.Hour), nil); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, job.ID); !row.RunAt.Equal(now) {
		t.Fatalf("run_at moved back to %s", row.RunAt)
	}

	// A job that is no longer waiting is left alone.
	claimed, _ := q.Claim(context.Background(), "w1", Lane{})
	if claimed == nil || claimed.ID != job.ID {
		t.Fatalf("claim: %+v", claimed)
	}
	if err := q.Expedite(job.ID, now.Add(-time.Hour), models.JobPayload{"trigger": "wake"}); err != nil {
		t.Fatal(err)
	}
	if row := jobRow(t, db, job.ID); row.Status != models.JobRunning || row.Payload.String("trigger") != "run_now" || !row.RunAt.Equal(now) {
		t.Fatalf("a running job was changed: %s %v %s", row.Status, row.Payload, row.RunAt)
	}
}
