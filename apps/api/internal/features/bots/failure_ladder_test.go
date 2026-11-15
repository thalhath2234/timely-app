package bots

import (
	"testing"
	"time"
)

func TestRateHoldFor(t *testing.T) {
	floor := 15 * time.Minute
	for _, c := range []struct {
		name  string
		after time.Duration
		want  time.Duration
	}{
		{"nothing said", 0, rateHold},
		{"negative is nothing", -time.Minute, rateHold},
		{"exactly what it asked", 40 * time.Minute, 40 * time.Minute},
		{"below the floor", time.Minute, floor},
		{"above a day", 48 * time.Hour, 24 * time.Hour},
		{"a day", 24 * time.Hour, 24 * time.Hour},
	} {
		if got := rateHoldFor(c.after, floor); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
	if got := rateHoldFor(0, 6*time.Hour); got != rateHold {
		t.Errorf("no Retry-After keeps the fixed hold, got %v", got)
	}
}

func TestEndOfCarriesRetryAfter(t *testing.T) {
	e := endOf(agentRun{ran: true, class: ClassRateLimited, res: AgentResult{ErrorClass: ClassRateLimited, RetryAfter: 40 * time.Minute}})
	if e.kind != endRateLimited || e.outcome != outRateLimited || e.retryAfter != 40*time.Minute {
		t.Fatalf("%+v", e)
	}
	if e := endOf(agentRun{ran: true, class: ClassTimeout, res: AgentResult{RetryAfter: time.Hour}}); e.retryAfter != 0 {
		t.Fatalf("only a rate limit holds: %+v", e)
	}
}

// A 429 holds the next check for the provider's Retry-After, exactly, and is
// never a strike; without one it holds 15 minutes.
func TestIntegrationAgentRateLimitHold(t *testing.T) {
	e := newEngine(t)
	var res AgentResult
	e.s.SetAgent(newScriptedAgent(func(RunInput) (AgentResult, error) { return res, nil }))
	b := e.bareAgent("Limited", 5, AgentTools{})

	for _, c := range []struct {
		name  string
		after time.Duration
		want  time.Duration
	}{
		{"retry-after", 40 * time.Minute, 40 * time.Minute},
		{"no retry-after", 0, 15 * time.Minute},
		{"retry-after under the floor", time.Minute, 15 * time.Minute},
		{"retry-after over a day", 72 * time.Hour, 24 * time.Hour},
	} {
		res = AgentResult{ErrorClass: ClassRateLimited, RetryAfter: c.after}
		must(t, e.run(b.ID))
		got, check := e.bot(b.ID), e.lastCheck(b.ID)
		if check.Outcome != outRateLimited || got.Strikes != 0 || got.Status != StatusActive || got.Health != "rate_limited" {
			t.Fatalf("%s: %+v, bot %+v", c.name, check, got)
		}
		if got.NextCheckAt == nil || !got.NextCheckAt.Equal(e.now.Add(c.want)) {
			t.Fatalf("%s: next check %v, want %v", c.name, got.NextCheckAt, e.now.Add(c.want))
		}
		e.due(b.ID)
	}
}

// A run stopped for obeying a page pauses the Bot at once, with the reason, one
// alert and one notification, and a failed Check of kind injection.
func TestIntegrationAgentInjectionPauses(t *testing.T) {
	e := newEngine(t)
	e.s.SetAgent(newScriptedAgent(func(RunInput) (AgentResult, error) { return AgentResult{ErrorClass: ClassInjection}, nil }))
	b := e.bareAgent("Injected", 15, AgentTools{})

	must(t, e.run(b.ID))
	got, c := e.bot(b.ID), e.lastCheck(b.ID)
	if got.Status != StatusPaused || got.PauseReason == nil || *got.PauseReason != PauseInjection || got.NextCheckAt != nil || got.Strikes != 0 {
		t.Fatalf("bot %+v", got)
	}
	if c.Outcome != outFailed || c.ErrorKind != ClassInjection {
		t.Fatalf("check %+v", c)
	}
	if n := e.count("bot_alerts", "bot_id = ?", b.ID); n != 1 || e.count("bot_alerts", "bot_id = ? AND kind = 'paused'", b.ID) != 1 {
		t.Fatalf("%d alerts", n)
	}
	if n := e.notifications(); len(n) != 1 || n[0].Body == "" {
		t.Fatalf("%d notifications", len(n))
	}
	if got.Health != ClassInjection || got.HealthDetail != injectionLine {
		t.Fatalf("health %q %q", got.Health, got.HealthDetail)
	}
}
