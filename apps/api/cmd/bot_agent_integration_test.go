package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"timely-api/internal/features/bots"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// scriptedBotAgent answers every tick with one report, as the worker's
// bot.run does for a Pixel Bot.
type scriptedBotAgent struct{ runs int }

func (a *scriptedBotAgent) Run(_ context.Context, _ string, _ bots.RunInput) (bots.AgentResult, error) {
	a.runs++
	return bots.AgentResult{
		Response: "Pixel is under 90k",
		Reports:  []bots.Report{{Title: "Pixel 10 Pro is under 90k", Body: "At ₹89,999", URL: "https://shop.example/pixel"}},
	}, nil
}

func (a *scriptedBotAgent) BrowserBusy(string) bool { return false }

// The wiring (wireBotThreads) gives the Bots service its thread poster and two
// agent slots; an agent Bot's tick then ends in an alert posted on its Bot
// thread, once.
func TestIntegrationAgentBotTickPostsAlertOnItsThread(t *testing.T) {
	s := newThreadStack(t)
	ctx := context.Background()
	agent := &scriptedBotAgent{}
	s.svc.SetAgent(agent)

	prompt, every := "Alert me when the Pixel is under 90000", json.RawMessage(`"every 6h"`)
	made, err := s.svc.Create(ctx, s.uid, bots.Input{Name: "Pixel", AgentInput: bots.AgentInput{Prompt: &prompt, Schedule: every}}, bots.OriginChat)
	if err != nil {
		t.Fatal(err)
	}
	job := &models.Job{ID: utils.NewJobID(), UserID: s.uid, Kind: models.JobBotCheck, Attempts: 1, MaxAttempts: 2,
		Payload: models.JobPayload{"botId": made.ID, "trigger": bots.TriggerSchedule, "requestId": uuid.NewString()}}
	if err := s.svc.HandleCheck(ctx, job); err != nil {
		t.Fatal(err)
	}
	if agent.runs != 1 {
		t.Fatalf("the agent ran %d times, want 1", agent.runs)
	}
	alerts := threadLines(s.view(made.ID), "alert")
	if len(alerts) != 1 || !strings.Contains(alerts[0].Title, "Pixel 10 Pro is under 90k") {
		t.Fatalf("alerts on the Bot thread: %+v", alerts)
	}
}
