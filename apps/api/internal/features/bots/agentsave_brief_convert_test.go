package bots

import (
	"context"
	"strings"
	"testing"

	"timely-api/internal/models"
)

// A brief goes through Service.ConvertPreview and Service.Convert like any
// Bot: the preview shows its summary prompt and daily_at schedule in the
// notification zone and changes nothing; approval flips it to the agent
// engine with gate 'always'.
func TestIntegrationBriefConvertEndToEnd(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.zone(models.NotificationSettings{Timezone: "Asia/Kolkata"})
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	in := briefInput("Morning", deals.ID)
	in.BriefTime = strp("07:30")
	v := e.create(in)

	view, err := e.s.ConvertPreview(ctx, e.user, v.ID)
	must(t, err)
	if !strings.Contains(view.Prompt, "Sum up what these bots found") || view.Schedule["dailyAt"] != "07:30" ||
		view.Timezone != "Asia/Kolkata" || view.Gate != GateAlways {
		t.Fatalf("preview %+v", view)
	}
	if e.bot(v.ID).Engine != EngineRules {
		t.Fatal("the preview flipped the engine")
	}

	got, err := e.s.Convert(ctx, e.user, v.ID)
	must(t, err)
	b := e.bot(v.ID)
	if got.ID != v.ID || b.Engine != EngineAgent || b.Gate != GateAlways || b.Kind != KindBrief {
		t.Fatalf("converted %+v", b)
	}
}
