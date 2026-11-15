package bots

import (
	"context"
	"math/rand/v2"
	"testing"
	"time"

	"gorm.io/gorm"
)

// agentResume makes an agent Bot, pauses it and resumes it at botNow.
func agentResume(t *testing.T, db *gorm.DB, s *Store, me string, in Input) Bot {
	t.Helper()
	ctx := context.Background()
	v, err := s.Create(ctx, me, in, OriginApp, botNow)
	must(t, err)
	_, err = s.Pause(ctx, me, v.ID, PausePerson, botNow)
	must(t, err)
	_, err = s.Resume(ctx, me, v.ID, OriginApp, botNow)
	must(t, err)
	return agentRow(t, db, v.ID)
}

func TestIntegrationStoreGetCarriesAgentCheckFields(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := NewStore(db)
	ctx := context.Background()

	v, err := s.Create(ctx, me, Input{Name: "Agent", AgentInput: AgentInput{Prompt: ptr("Summarise my day"), Schedule: sched("every 1h")}}, OriginApp, botNow)
	must(t, err)
	run := &RunRecord{Response: "Nothing new", Silent: true, Usage: Usage{Calls: 2}}
	must(t, db.Create(&Check{ID: "bchk_run", BotID: v.ID, UserID: me, Trigger: TriggerSchedule, StartedAt: botNow, FinishedAt: botNow, Outcome: outSilent, Run: run}).Error)
	must(t, db.Create(&Check{ID: "bchk_skip", BotID: v.ID, UserID: me, Trigger: TriggerSchedule, StartedAt: botNow.Add(-time.Hour), FinishedAt: botNow.Add(-time.Hour),
		Outcome: outUnchanged, GateSkipped: true, SkipReason: SkipUnchanged}).Error)

	d, err := s.Get(ctx, me, v.ID, botNow)
	must(t, err)
	if len(d.Checks) != 2 {
		t.Fatalf("got %d checks, want 2", len(d.Checks))
	}
	if c := d.Checks[0]; c.ID != "bchk_run" || c.Run == nil || !c.Run.Silent || c.Run.Response != "Nothing new" || c.Run.Usage.Calls != 2 || c.GateSkipped || c.SkipReason != "" {
		t.Errorf("run check: %+v", c)
	}
	if c := d.Checks[1]; c.ID != "bchk_skip" || c.Run != nil || !c.GateSkipped || c.SkipReason != SkipUnchanged {
		t.Errorf("gate-skipped check: %+v", c)
	}
}

func TestIntegrationStoreResumeAgentSchedule(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := NewStore(db)
	page := []WatchInput{{Kind: "page", URL: "https://example.com/a"}}

	// An interval schedule comes back an interval from now, with the jitter.
	b := agentResume(t, db, s, me, Input{Name: "Hourly", Watches: page, AgentInput: AgentInput{Prompt: ptr("watch"), Schedule: sched("every 1h")}})
	if b.NextCheckAt == nil || b.NextCheckAt.Before(botNow.Add(time.Hour-FenceSlack)) || b.NextCheckAt.After(botNow.Add(time.Hour+maxJitter)) {
		t.Errorf("hourly resumed at %v, want about %v", b.NextCheckAt, botNow.Add(time.Hour))
	}

	// A daily schedule is read in the Bot's zone: Friday 09:00 Berlin is
	// before now, so Monday's.
	b = agentResume(t, db, s, me, Input{Name: "Daily", AgentInput: AgentInput{Prompt: ptr("sum up"), Schedule: sched("weekdays at 9am"), Timezone: ptr("Europe/Berlin")}})
	if want := time.Date(2026, 11, 9, 8, 0, 0, 0, time.UTC); b.NextCheckAt == nil || !b.NextCheckAt.Equal(want) {
		t.Errorf("daily resumed at %v, want %v", b.NextCheckAt, want)
	}

	// Market hours: the Friday session opens at 14:30 UTC, and nothing runs sooner.
	b = agentResume(t, db, s, me, Input{Name: "Market", AgentInput: AgentInput{Prompt: ptr("watch"), Schedule: sched("every 1h"), MarketHours: ptr(true)}})
	if want := time.Date(2026, 11, 6, 14, 30, 0, 0, time.UTC); b.NextCheckAt == nil || !b.NextCheckAt.Equal(want) {
		t.Errorf("market-hours Bot resumed at %v, want %v", b.NextCheckAt, want)
	}

	// A rules Bot is unchanged: due now.
	v, err := s.Create(context.Background(), me, Input{Name: "Rules", Watches: page, IntervalMinutes: 60}, OriginApp, botNow)
	must(t, err)
	_, err = s.Pause(context.Background(), me, v.ID, PausePerson, botNow)
	must(t, err)
	_, err = s.Resume(context.Background(), me, v.ID, OriginApp, botNow)
	must(t, err)
	if rb := agentRow(t, db, v.ID); rb.NextCheckAt == nil || !rb.NextCheckAt.Equal(botNow) {
		t.Errorf("rules Bot resumed at %v, want now", rb.NextCheckAt)
	}
}

func TestAgentResumeAt(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	every := func(m int) Bot {
		return Bot{Schedule: jsonMap[string, any]{"everyMinutes": float64(m)}}
	}
	if got := agentResumeAt(Bot{}, nil, botNow, r); !got.IsZero() {
		t.Errorf("no schedule: %v, want zero", got)
	}
	// No jitter source: exactly an interval, lifted to the floor of its Reads.
	if got, want := agentResumeAt(every(60), nil, botNow, nil), botNow.Add(time.Hour); !got.Equal(want) {
		t.Errorf("hourly: %v, want %v", got, want)
	}
	ws := []Watch{{Kind: WatchPage, ReadMode: ReadProductPrice}}
	if got, want := agentResumeAt(every(15), ws, botNow, nil), botNow.Add(MinProductEvery); !got.Equal(want) {
		t.Errorf("product floor: %v, want %v", got, want)
	}
	// The last check's spacing holds a resume back even on a daily schedule.
	started := botNow.Add(-time.Minute)
	b := every(15)
	b.CheckStartedAt = &started
	if got := agentResumeAt(b, nil, botNow, nil); got.Before(botNow.Add(MinPageEvery-time.Minute)) {
		t.Errorf("spaced: %v, too soon after the last check", got)
	}
}
