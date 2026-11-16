package bots

import (
	"testing"

	"timely-api/internal/models"
)

// A tick the person stopped (Pause, Pause all, Delete) is no failure: the
// Check is recorded skipped with no error, and the Bot's strikes, health and
// offline time stay as they were.
func TestIntegrationStoppedTickKeepsHealth(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "UTC"})
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) {
		return AgentResult{ErrorClass: ClassStopped, Trace: []ToolTrace{}}, nil
	})
	e.s.SetAgent(agent)
	b := e.bareAgent("Stopped", 15, AgentTools{})
	must(t, e.db.Model(&Bot{}).Where("id = ?", b.ID).Updates(map[string]any{"strikes": 2, "health": "timeout", "health_detail": "The run took too long"}).Error)

	must(t, e.run(b.ID))
	c := e.lastCheck(b.ID)
	if c.Outcome != outSkipped || c.ErrorKind != "" || c.Error != "" || c.SkipReason != "" || c.Run == nil || c.Run.ErrorClass != ClassStopped {
		t.Fatalf("check %+v", c)
	}
	got := e.bot(b.ID)
	if got.Strikes != 2 || got.Health != "timeout" || got.HealthDetail != "The run took too long" || got.OfflineSince != nil || got.Status != StatusActive {
		t.Fatalf("bot %+v", got)
	}
	if n := e.count("bot_alerts", "bot_id = ?", b.ID); n != 0 {
		t.Fatalf("%d alerts", n)
	}
	// The same class from the end table: no strike, nothing consumed.
	if end := endOf(agentRun{ran: true, class: ClassStopped}); end.kind != endStopped || end.outcome != outSkipped || end.consume || end.errKind != "" || end.errText != "" {
		t.Fatalf("end %+v", end)
	}
}
