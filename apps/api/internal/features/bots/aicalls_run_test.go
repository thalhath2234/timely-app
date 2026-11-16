package bots

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// Agent runs are exempt from the daily caps, and their rows don't count
// toward them either: a busy agent Bot can't use up the account cap that
// rules Bots' judge, rejudge and brief calls depend on (Q-B7).
func TestIntegrationAgentRunRowsLeaveDailyCapsAlone(t *testing.T) {
	e := newEngine(t)
	agent := e.bareAgent("Busy", 15, AgentTools{})
	rules := e.bareAgent("Rules", 15, AgentTools{})
	day, err := localDay(e.db, e.user, e.now)
	must(t, err)
	insert := func(botID, purpose string, n int) {
		for range n {
			must(t, e.db.Exec(`INSERT INTO bot_ai_calls (id, user_id, bot_id, chain_id, local_day, purpose, created_at)
				VALUES (?, ?, ?, ?, CAST(? AS date), ?, ?)`, "bai_"+uuid.NewString(), e.user, botID, "chain_"+uuid.NewString(), day, purpose, e.now).Error)
		}
	}
	ctx := context.Background()

	// A full account's worth of agent runs, some on the rules Bot's own id.
	insert(agent.ID, purposeRun, AIPerAccount)
	insert(rules.ID, purposeRun, AIPerBot)
	if _, err := e.s.reserveAI(ctx, rules, "", purposeJudge, e.now); err != nil {
		t.Fatalf("run rows used up the judge's caps: %v", err)
	}
	if _, err := e.s.reserveAI(ctx, rules, "", purposeBrief, e.now); err != nil {
		t.Fatalf("run rows used up the brief's caps: %v", err)
	}

	// Judge rows still count: the per-Bot cap, then the account cap.
	insert(rules.ID, purposeJudge, AIPerBot-1)
	if _, err := e.s.reserveAI(ctx, rules, "", purposeRejudge, e.now); !errors.Is(err, errAICap) {
		t.Fatalf("past the per-Bot cap: %v", err)
	}
	other := e.bareAgent("Other", 15, AgentTools{})
	insert(other.ID, purposeJudge, AIPerAccount-AIPerBot)
	if _, err := e.s.reserveAI(ctx, e.bareAgent("Third", 15, AgentTools{}), "", purposeJudge, e.now); !errors.Is(err, errAICap) {
		t.Fatalf("past the account cap: %v", err)
	}
	// A run is still never refused by the daily caps.
	if _, err := e.s.reserveAI(ctx, agent, "", purposeRun, e.now); err != nil {
		t.Fatalf("a run past the daily caps: %v", err)
	}
}
