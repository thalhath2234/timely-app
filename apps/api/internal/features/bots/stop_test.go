package bots

import (
	"context"
	"slices"
	"sync"
	"testing"

	"timely-api/internal/models"
)

// stops records the Bots whose live ticks were stopped (chat's StopBot).
type stops struct {
	mu  sync.Mutex
	ids []string
}

func (s *stops) stop(userID, botID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ids = append(s.ids, userID+"/"+botID)
}

func (s *stops) got() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := slices.Clone(s.ids)
	slices.Sort(out)
	return out
}

func (s *stops) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ids = nil
}

// Pause, Delete (by name too) and Pause all stop the live ticks of every Bot
// they touch, after the change committed; turning Pause all off stops none.
func TestIntegrationPauseDeletePauseAllStopTicks(t *testing.T) {
	e := newEngine(t)
	rec := &stops{}
	e.s.SetStopper(rec.stop)
	ctx := context.Background()
	a := e.bareAgent("First", 15, AgentTools{})
	b := e.bareAgent("Second", 15, AgentTools{})

	v, err := e.s.Pause(ctx, e.user, a.ID, PausePerson)
	must(t, err)
	if got := rec.got(); len(got) != 1 || got[0] != e.user+"/"+a.ID || v.Status != StatusPaused {
		t.Fatalf("pause: %v, %+v", got, v)
	}

	rec.reset()
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	_, err = e.s.SetAllPaused(ctx, e.user, true)
	must(t, err)
	want := []string{e.user + "/" + a.ID, e.user + "/" + b.ID}
	slices.Sort(want)
	if got := rec.got(); !slices.Equal(got, want) {
		t.Fatalf("pause all: %v, want %v", got, want)
	}
	rec.reset()
	_, err = e.s.SetAllPaused(ctx, e.user, false)
	must(t, err)
	if got := rec.got(); len(got) != 0 {
		t.Fatalf("pause all off stopped %v", got)
	}

	must(t, e.s.Delete(ctx, e.user, "Second"))
	if got := rec.got(); len(got) != 1 || got[0] != e.user+"/"+b.ID {
		t.Fatalf("delete: %v", got)
	}
	rec.reset()
	if err := e.s.Delete(ctx, e.user, "Second"); err == nil || len(rec.got()) != 0 {
		t.Fatalf("a Bot not found: %v, stopped %v", err, rec.got())
	}
}

// A tick whose Bot is paused, put under Pause all, or deleted while it runs
// raises no alert when it finishes late: the paused ones record the Check
// with no alert, notification or thread post; a deleted Bot's saves nothing.
func TestIntegrationLateTickAfterPauseSavesNoAlert(t *testing.T) {
	for _, how := range []string{"pause", "pause all", "delete"} {
		t.Run(how, func(t *testing.T) {
			e := newEngine(t)
			e.zone(models.NotificationSettings{Timezone: "UTC"})
			threads := &scriptedThreads{}
			e.s.SetThreadPoster(threads)
			var b Bot
			agent := newScriptedAgent(func(RunInput) (AgentResult, error) {
				ctx := context.Background()
				switch how {
				case "pause":
					if _, err := e.s.Pause(ctx, e.user, b.ID, PausePerson); err != nil {
						t.Error(err)
					}
				case "pause all":
					if _, err := e.s.SetAllPaused(ctx, e.user, true); err != nil {
						t.Error(err)
					}
				case "delete":
					if err := e.s.Delete(ctx, e.user, b.ID); err != nil {
						t.Error(err)
					}
				}
				return reportOf("Pixel in stock"), nil
			})
			e.s.SetAgent(agent)
			b = e.bareAgent("Pixel", 15, AgentTools{})
			must(t, e.run(b.ID))
			if agent.asked != 1 {
				t.Fatalf("%d asks", agent.asked)
			}
			if n := e.count("bot_alerts", "user_id = ?", e.user); n != 0 || len(e.notifications()) != 0 || len(threads.got()) != 0 {
				t.Fatalf("%d alerts, %d notifications, %d posts", n, len(e.notifications()), len(threads.got()))
			}
			checks := e.count("bot_checks", "bot_id = ?", b.ID)
			if how == "delete" && checks != 0 || how != "delete" && checks != 1 {
				t.Fatalf("%d checks", checks)
			}
		})
	}
}
