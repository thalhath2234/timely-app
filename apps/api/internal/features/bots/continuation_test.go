package bots

import (
	"context"
	"testing"

	"timely-api/internal/models"
)

// A Run once continuation's report becomes an alert on the Check of the card
// it ran: notified, posted into the Bot thread, with its proposal as a pending
// Review card. The same report again is held as a duplicate and posted
// nowhere; a paused Bot saves nothing.
func TestIntegrationContinuationReportsBecomeAlerts(t *testing.T) {
	e := newEngine(t)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return quiet() })
	threads := &scriptedThreads{}
	e.s.SetAgent(agent)
	e.s.SetThreadPoster(threads)
	b := e.bareAgent("Pixel", 15, AgentTools{})
	must(t, e.run(b.ID))
	c := e.lastCheck(b.ID)
	if c.Outcome != outSilent {
		t.Fatalf("tick: %+v", c)
	}

	ctx := context.Background()
	res := AgentResult{Response: "Found it", Reports: []Report{{Title: "Pixel in stock", Body: "At 89999", URL: "https://store.example.com/pixel",
		Proposal: []byte(`{"tool":"create_task","args":{"title":"Buy the Pixel"}}`)}}}
	must(t, e.s.SaveContinuation(ctx, e.user, b.ID, c.ID, res))
	var alerts []Alert
	must(t, e.db.Where("bot_id = ? AND kind = ?", b.ID, alertKindAlert).Order("created_at, id").Find(&alerts).Error)
	if len(alerts) != 1 || alerts[0].CheckID == nil || *alerts[0].CheckID != c.ID || alerts[0].Held != "" || alerts[0].NotificationID == nil ||
		alerts[0].ProposalState != ProposalPending {
		t.Fatalf("alerts %+v", alerts)
	}
	if got := threads.got(); len(got) != 1 || got[0] != alerts[0].ID {
		t.Fatalf("thread posts %v", got)
	}
	if len(e.notifications()) != 1 {
		t.Fatalf("%d notifications", len(e.notifications()))
	}
	if c := e.lastCheck(b.ID); c.AlertID == nil || *c.AlertID != alerts[0].ID {
		t.Fatalf("the check does not name its alert: %+v", c)
	}

	// The same report again: held as a duplicate, no notification, no post.
	must(t, e.s.SaveContinuation(ctx, e.user, b.ID, c.ID, res))
	if n := e.count("bot_alerts", "bot_id = ? AND held = 'duplicate'", b.ID); n != 1 || len(threads.got()) != 1 || len(e.notifications()) != 1 {
		t.Fatalf("repeat: %d duplicates, %d posts, %d notifications", n, len(threads.got()), len(e.notifications()))
	}

	// A silent continuation, or one on a paused Bot, saves nothing.
	must(t, e.s.SaveContinuation(ctx, e.user, b.ID, c.ID, AgentResult{Response: "[SILENT]", Silent: true}))
	_, err := e.s.Pause(ctx, e.user, b.ID, PausePerson)
	must(t, err)
	other := res
	other.Reports = []Report{{Title: "Another", Body: "x"}}
	must(t, e.s.SaveContinuation(ctx, e.user, b.ID, c.ID, other))
	if n := e.count("bot_alerts", "bot_id = ?", b.ID); n != 2 {
		t.Fatalf("%d alerts after a silent run and a paused Bot", n)
	}
}

// Under Pause all a continuation saves no alert either.
func TestIntegrationContinuationUnderPauseAll(t *testing.T) {
	e := newEngine(t)
	e.s.SetAgent(newScriptedAgent(func(RunInput) (AgentResult, error) { return quiet() }))
	b := e.bareAgent("Pixel", 15, AgentTools{})
	must(t, e.run(b.ID))
	c := e.lastCheck(b.ID)
	e.zone(models.NotificationSettings{})
	_, err := e.s.SetAllPaused(context.Background(), e.user, true)
	must(t, err)
	must(t, e.s.SaveContinuation(context.Background(), e.user, b.ID, c.ID, reportOf("Pixel in stock")))
	if n := e.count("bot_alerts", "bot_id = ?", b.ID); n != 0 {
		t.Fatalf("%d alerts under Pause all", n)
	}
}
