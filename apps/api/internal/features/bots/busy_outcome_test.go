package bots

import "testing"

// A run a chat cut short by taking the browser keeps what it had already
// reported; one that failed any other way keeps nothing.
func TestBusyRunKeepsItsReports(t *testing.T) {
	res := AgentResult{Reports: []Report{{Title: "Pixel in stock", Body: "At 89999"}}, ErrorClass: ClassBrowserBusy}
	if got := cleanReports(agentRun{ran: true, class: ClassBrowserBusy, res: res}); len(got) != 1 || got[0].Title != "Pixel in stock" {
		t.Fatalf("busy mid-tick: %+v", got)
	}
	if got := cleanReports(agentRun{ran: true, class: ClassCrash, res: res}); got != nil {
		t.Fatalf("a crash kept reports: %+v", got)
	}
	if got := cleanReports(agentRun{skip: SkipBrowserBusy, class: ClassBrowserBusy}); got != nil {
		t.Fatalf("a tick that never ran has reports: %+v", got)
	}
}

// A tick skipped because a chat held the browser, and a tick whose bot.done
// ended browser_busy, both save the outcome 'browser_busy' (what the contract,
// the web tally and the "Browser busy" cell read). The second keeps the
// reports it had made as alerts, notified and posted to the thread.
func TestIntegrationBrowserBusyOutcome(t *testing.T) {
	e := newEngine(t)
	agent := newScriptedAgent(func(RunInput) (AgentResult, error) { return quiet() })
	e.s.SetAgent(agent)
	b := e.bareAgent("Signed in", 15, AgentTools{BrowserSites: []string{"flipkart.com"}})

	agent.busy = true
	must(t, e.run(b.ID))
	if c := e.lastCheck(b.ID); c.Outcome != outBrowserBusy || c.SkipReason != SkipBrowserBusy || c.Run != nil {
		t.Fatalf("skipped for the lease: %+v", c)
	}

	agent.busy = false
	agent.script = func(RunInput) (AgentResult, error) {
		return AgentResult{Response: "Pixel in stock", ErrorClass: ClassBrowserBusy,
			Reports: []Report{{Title: "Pixel in stock", Body: "At 89999", URL: "https://store.example.com/pixel"}}}, nil
	}
	e.again(b.ID)
	c := e.lastCheck(b.ID)
	if c.Outcome != outBrowserBusy || c.SkipReason != SkipBrowserBusy || c.Run == nil || c.Run.ErrorClass != ClassBrowserBusy {
		t.Fatalf("taken mid-tick: %+v", c)
	}
	var alerts []Alert
	must(t, e.db.Where("bot_id = ? AND kind = ?", b.ID, alertKindAlert).Find(&alerts).Error)
	if len(alerts) != 1 || alerts[0].Held != "" || alerts[0].CheckID == nil || *alerts[0].CheckID != c.ID || alerts[0].NotificationID == nil {
		t.Fatalf("alerts %+v", alerts)
	}
	if c.AlertID == nil || *c.AlertID != alerts[0].ID {
		t.Fatalf("the check does not name its alert: %+v", c)
	}
	if got := e.bot(b.ID); got.Strikes != 0 {
		t.Fatalf("a busy tick struck: %+v", got)
	}
}
