package bots

import "testing"

// A Bot that follows the account default names no model of its own; its
// Check's run records the provider and model that actually ran, as the Agent
// reports them. A run that reports none keeps the Bot's own choice.
func TestIntegrationAgentRunRecordsTheModelThatRan(t *testing.T) {
	e := newEngine(t)
	ran := ModelChoice{Provider: "claude", Model: "sonnet"}
	agent := newScriptedAgent(func(in RunInput) (AgentResult, error) {
		if in.Model != (ModelChoice{}) {
			t.Errorf("a Bot on the account default was handed a model: %+v", in.Model)
		}
		return AgentResult{Silent: true, Usage: Usage{InputTokens: 900, OutputTokens: 40, Calls: 2}, Model: ran}, nil
	})
	e.s.SetAgent(agent)
	b := e.bareAgent("Default model", 15, AgentTools{})
	must(t, e.run(b.ID))
	c := e.lastCheck(b.ID)
	if c.Run == nil || c.Run.Model != ran {
		t.Fatalf("run %+v", c.Run)
	}
	if c.Run.Usage.InputTokens != 900 || c.Run.Usage.OutputTokens != 40 {
		t.Fatalf("usage %+v", c.Run.Usage)
	}

	// The Bot's own model, and a run that reports nothing back.
	own := ModelChoice{Provider: "openrouter", Model: "some/model"}
	must(t, e.db.Model(&Bot{}).Where("id = ?", b.ID).Updates(map[string]any{"model_provider": own.Provider, "model": own.Model}).Error)
	agent.script = func(RunInput) (AgentResult, error) { return AgentResult{Silent: true}, nil }
	e.again(b.ID)
	if c := e.lastCheck(b.ID); c.Run == nil || c.Run.Model != own {
		t.Fatalf("own model: %+v", c.Run)
	}
}
