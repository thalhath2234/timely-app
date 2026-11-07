package bots

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"

	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

// tick is one sweep at the current time, then every bot_check job it made
// that is due, run and marked done. It returns how many jobs ran.
func (e *engine) tick() int {
	e.t.Helper()
	ctx := context.Background()
	must(e.t, e.s.Sweep(ctx))
	var due []models.Job
	must(e.t, e.db.Where("kind = ? AND status = 'pending' AND run_at <= ?", models.JobBotCheck, e.now).Find(&due).Error)
	for i := range due {
		j := &due[i]
		j.Attempts++
		must(e.t, e.s.HandleCheck(ctx, j))
		must(e.t, e.db.Model(j).Update("status", models.JobSucceeded).Error)
	}
	return len(due)
}

// spacedOK fails unless the Bot is not due before its floor allows.
func (e *engine) spacedOK(id string) {
	e.t.Helper()
	b := e.bot(id)
	ws, err := loadWatches(e.db, id, false)
	must(e.t, err)
	if want := spacedAt(b.CheckStartedAt, Floor(ws)); b.NextCheckAt == nil || b.NextCheckAt.Before(want) {
		e.t.Fatalf("next check %v is before the floor allows (%v)", b.NextCheckAt, want)
	}
}

// Every way a check ends leaves the Bot due no earlier than its floor, so
// the sweep's next job for it checks instead of losing the fence.
func TestIntegrationBotNeverDueBeforeFloor(t *testing.T) {
	e := newEngine(t)
	e.s.lastSweepWall = e.now // no wake on the first sweep
	e.s.lastPrune = e.now

	// sub runs a step as a subtest, so the engine's helpers fail it alone.
	sub := func(name string, fn func(t *testing.T)) {
		t.Run(name, func(t *testing.T) {
			parent := e.t
			e.t = t
			defer func() { e.t = parent }()
			fn(t)
			// Park this step's Bot so later steps sweep only their own.
			must(t, e.db.Model(&Bot{}).Where("user_id = ?", e.user).
				Updates(map[string]any{"status": StatusPaused, "pause_reason": PausePerson, "next_check_at": nil}).Error)
		})
	}

	// checksAtNext moves to the Bot's next check, sweeps and runs: exactly
	// one job, and it writes a check.
	checksAtNext := func(t *testing.T, id string) {
		t.Helper()
		e.spacedOK(id)
		e.now = *e.bot(id).NextCheckAt
		e.s.lastSweepWall = e.now
		before := e.count("bot_checks", "bot_id = ?", id)
		if ran := e.tick(); ran != 1 {
			t.Fatalf("%d jobs ran", ran)
		}
		if e.count("bot_checks", "bot_id = ?", id) != before+1 {
			t.Fatal("the job lost the fence and checked nothing")
		}
	}

	sub("offline page", func(t *testing.T) {
		u := "https://offline.example.com/"
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput("Offline page", u))
		must(t, e.run(v.ID))
		e.due(v.ID)
		e.net.set(u, func(*http.Request) (*http.Response, error) { return nil, io.ErrUnexpectedEOF })
		must(t, e.run(v.ID))
		if c := e.lastCheck(v.ID); c.Outcome != outOffline {
			t.Fatalf("outcome %s", c.Outcome)
		}
		checksAtNext(t, v.ID)
	})

	sub("final failure of a page", func(t *testing.T) {
		u := "https://fails.example.com/"
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput("Failing page", u))
		must(t, e.run(v.ID))
		e.due(v.ID)
		job := e.job(v.ID, TriggerSchedule)
		e.s.beforeCommit = func(*gorm.DB) error { return errFake }
		for job.Attempts = 1; job.Attempts <= checkAttempts; job.Attempts++ {
			if err := e.s.HandleCheck(context.Background(), job); !errors.Is(err, errFake) {
				t.Fatalf("attempt %d: %v", job.Attempts, err)
			}
		}
		e.s.beforeCommit = nil
		checksAtNext(t, v.ID)
	})

	sub("site busy", func(t *testing.T) {
		u := "https://www.busy.example.net/"
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput("Busy page", u))
		must(t, e.run(v.ID))
		e.due(v.ID)
		plain := e.s.fetch
		e.s.fetch = fetch.New(fetch.Config{
			Client: &http.Client{Transport: e.net}, Spacer: e.s.store, Robots: e.s.store,
			Now: func() time.Time { return e.now }, Sleep: func(context.Context, time.Duration) error { return nil },
		})
		must(t, e.db.Exec(`INSERT INTO bot_sites (site, next_slot_at, used_at) VALUES ('example.net', ?, ?)`, e.now.Add(2*time.Minute), e.now).Error)
		must(t, e.run(v.ID))
		if c := e.lastCheck(v.ID); c.Outcome != outSiteBusy {
			t.Fatalf("outcome %s", c.Outcome)
		}
		e.s.fetch = plain
		checksAtNext(t, v.ID)
	})

	sub("resume soon after a shop check", func(t *testing.T) {
		u := "https://shop.example.com/item"
		e.net.serve(u, 200, "text/html", `<html><head><meta property="og:price:amount" content="10"></head><body></body></html>`)
		v := e.create(Input{Name: "Shop item", Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadProductPrice}}})
		must(t, e.run(v.ID))
		_, err := e.s.Pause(context.Background(), e.user, v.ID, PausePerson)
		must(t, err)
		e.now = e.now.Add(time.Hour)
		_, err = e.s.Resume(context.Background(), e.user, v.ID, OriginApp)
		must(t, err)
		checksAtNext(t, v.ID)
	})

	sub("adding a shop price to a page", func(t *testing.T) {
		u := "https://grow.example.com/"
		e.net.serve(u, 200, "text/html", `<html><head><meta property="og:price:amount" content="10"></head><body><p>hi</p></body></html>`)
		v := e.create(pageInput("Growing", u))
		must(t, e.run(v.ID))
		e.now = e.now.Add(time.Minute)
		ws := []WatchInput{{ID: v.Watches[0].ID, Kind: WatchPage, URL: u}, {Kind: WatchPage, URL: u, Read: ReadProductPrice}}
		_, err := e.s.Update(context.Background(), e.user, v.ID, Patch{Watches: &ws}, OriginApp)
		must(t, err)
		checksAtNext(t, v.ID)
	})

	sub("an old row due too soon is moved on", func(t *testing.T) {
		u := "https://stale.example.com/"
		e.net.serve(u, 200, "text/html", "<p>hello</p>")
		v := e.create(pageInput("Stale", u))
		must(t, e.run(v.ID))
		e.now = e.now.Add(5 * time.Minute)
		must(t, e.db.Model(&Bot{}).Where("id = ?", v.ID).Update("next_check_at", e.now).Error)
		e.s.lastSweepWall = e.now
		if ran := e.tick(); ran != 1 {
			t.Fatalf("%d jobs ran", ran)
		}
		// Run now no longer finds a queued check that would do nothing.
		res, err := e.s.RunNow(context.Background(), e.user, v.ID, OriginApp)
		must(t, err)
		if b := e.bot(v.ID); res.Line == "Checking now." || res.RunAt.Before(spacedAt(b.CheckStartedAt, MinPageEvery)) {
			t.Fatalf("run now %+v", res)
		}
		e.spacedOK(v.ID)
	})
}

// A person's Retry of a job that failed while it held the claim starts at
// attempt 1, so it must pass the fence like any other job.
func TestIntegrationBotRetryKeepsTheFloor(t *testing.T) {
	e := newEngine(t)
	u := "https://retry.example.com/item"
	e.net.serve(u, 200, "text/html", `<html><head><meta property="og:price:amount" content="10"></head><body></body></html>`)
	v := e.create(Input{Name: "Retry", Watches: []WatchInput{{Kind: WatchPage, URL: u, Read: ReadProductPrice}}})
	must(t, e.run(v.ID))
	e.due(v.ID)
	job := e.job(v.ID, TriggerSchedule)
	e.s.beforeCommit = func(*gorm.DB) error { return errFake }
	for job.Attempts = 1; job.Attempts <= checkAttempts; job.Attempts++ {
		if err := e.s.HandleCheck(context.Background(), job); !errors.Is(err, errFake) {
			t.Fatalf("attempt %d: %v", job.Attempts, err)
		}
	}
	e.s.beforeCommit = nil
	if b := e.bot(v.ID); b.CheckingJobID == nil || *b.CheckingJobID != job.ID {
		t.Fatalf("the failed job no longer holds the claim: %+v", b)
	}
	hits := e.net.hits[netKey(u)]
	e.now = e.now.Add(time.Minute)
	job.Attempts = 1 // Queue.Retry resets attempts; the claim makes it 1
	must(t, e.s.HandleCheck(context.Background(), job))
	if e.net.hits[netKey(u)] != hits {
		t.Fatal("a retried job read the site again inside the floor")
	}
}

// An edit made while a failing watch is read supersedes the failure: no
// strike, no pause and no alert for an address that is no longer watched.
func TestIntegrationBotEditDuringFailingCheck(t *testing.T) {
	e := newEngine(t)
	gone, fixed := "https://edit.example.com/old", "https://edit.example.com/new"
	e.net.serve(fixed, 200, "text/html", "<p>hello</p>")
	v := e.create(pageInput("Edited", gone))
	must(t, e.db.Model(&Bot{}).Where("id = ?", v.ID).Update("strikes", MaxStrikes-1).Error)
	e.net.set(gone, func(req *http.Request) (*http.Response, error) {
		ws := []WatchInput{{ID: v.Watches[0].ID, Kind: WatchPage, URL: fixed}}
		if _, err := e.s.Update(context.Background(), e.user, v.ID, Patch{Watches: &ws}, OriginApp); err != nil {
			return nil, err
		}
		return reply(req, 404, "text/html", "gone"), nil
	})
	must(t, e.run(v.ID))
	b := e.bot(v.ID)
	if c := e.lastCheck(v.ID); c.Outcome != outSuperseded {
		t.Fatalf("outcome %s", c.Outcome)
	}
	if b.Status != StatusActive || b.Strikes != MaxStrikes-1 || b.CheckingJobID != nil || b.Health == "not_found" {
		t.Fatalf("bot after a superseded failure %+v", b)
	}
	if n := e.count("bot_alerts", "bot_id = ?", v.ID); n != 0 {
		t.Fatalf("%d alerts", n)
	}
	if w := watchRow(t, e.db, v.Watches[0].ID); w.Health == "not_found" {
		t.Fatalf("the edited watch got the old address's health %+v", w)
	}
	e.spacedOK(v.ID)
}
