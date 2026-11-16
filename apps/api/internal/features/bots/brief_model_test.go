package bots

import (
	"testing"
	"time"
)

// A brief on the account default records the model that actually ran, as an
// agent tick does, not the blank choice of its own.
func TestIntegrationBriefRecordsTheModelThatRan(t *testing.T) {
	ran := ModelChoice{Provider: "claude", Model: "sonnet"}
	e, _, id, deals, _ := briefAgentSetup(t, func(in RunInput) (AgentResult, error) {
		if in.Model != (ModelChoice{}) {
			t.Errorf("a brief on the account default was handed a model: %+v", in.Model)
		}
		return AgentResult{Reports: []Report{{Title: "Morning", Body: "One new deal."}}, Model: ran}, nil
	})
	e.note(deals, "item", "Deal 1", "New in deals.example", e.now.Add(time.Minute))
	c := e.runBrief(id)
	if c.Run == nil || c.Run.Model != ran {
		t.Fatalf("brief run %+v", c.Run)
	}
}
