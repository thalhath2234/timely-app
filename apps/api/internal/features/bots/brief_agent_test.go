package bots

import (
	"errors"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"
)

// convertBriefNow approves a brief's conversion the way Service.Convert does
// for any Bot: briefConversionOf's fields, applied and stored.
func (e *engine) convertBriefNow(id string) Bot {
	e.t.Helper()
	b := e.bot(id)
	_, f, err := briefConversionOf(e.db, b)
	must(e.t, err)
	f.Apply(&b)
	must(e.t, e.db.Select("Engine", "Prompt", "Schedule", "Timezone", "Skills", "Tools", "Egress", "UseMemory", "Permission", "Gate",
		"MarketHours", "ModelProvider", "Model", "IntervalSeconds").Updates(&b).Error)
	return e.bot(id)
}

// A brief becomes an agent Bot: its daily time is schedule.daily_at in the
// account's zone, the gate is always, and it has no Reads, skills or tools.
func TestIntegrationBriefConvertFields(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "Asia/Kolkata"})
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	in := briefInput("Morning", deals.ID)
	in.Description = "What my bots found overnight"
	in.BriefTime = strp("07:30")
	v := e.create(in)

	view, f, err := briefConversionOf(e.db, e.bot(v.ID))
	must(t, err)
	if e.bot(v.ID).Engine != EngineRules {
		t.Fatal("the preview flipped the engine")
	}
	if view.Gate != GateAlways || view.Timezone != "Asia/Kolkata" || view.Schedule["dailyAt"] != "07:30" ||
		len(view.Skills) != 0 || !strings.HasPrefix(view.Prompt, "Morning. What my bots found overnight. Sum up what these bots found") {
		t.Fatalf("conversion view %+v", view)
	}
	if len(f.Tools.BrowserSites) != 0 || len(f.Tools.Egress) != 0 || f.Tools.UseMemory || f.Permission != PermissionAuto {
		t.Fatalf("a converted brief has reach: %+v", f)
	}

	b := e.convertBriefNow(v.ID)
	if b.Engine != EngineAgent || b.Kind != KindBrief || b.Gate != GateAlways || b.Timezone != "Asia/Kolkata" || b.Schedule["dailyAt"] != "07:30" ||
		b.BriefTime != "07:30" || b.IntervalSeconds != 24*3600 {
		t.Fatalf("converted brief %+v", b)
	}
	if _, _, err := briefConversionOf(e.db, b); !errors.Is(err, errConvertDone) {
		t.Fatalf("a second conversion: %v", err)
	}
}

// A brief with no zone of its own, in an account with none set, runs in UTC;
// one with a zone of its own keeps it.
func TestIntegrationBriefConvertZone(t *testing.T) {
	e := newEngine(t)
	deals := e.create(pageInput("Deals", "https://deals.example/"))
	v := e.create(briefInput("Morning", deals.ID))
	_, f, err := briefConversionOf(e.db, e.bot(v.ID))
	must(t, err)
	if f.Timezone != "UTC" || f.Schedule.DailyAt != DefaultBriefTime {
		t.Fatalf("no zone anywhere: %q %+v", f.Timezone, f.Schedule)
	}
	b := e.bot(v.ID)
	b.Timezone = "Europe/Berlin"
	_, f, err = briefConversionOf(e.db, b)
	must(t, err)
	if f.Timezone != "Europe/Berlin" {
		t.Fatalf("the Bot's own zone %q", f.Timezone)
	}
}

// briefAgentSetup makes a converted brief over two watch Bots; script nil
// leaves the service with no Agent.
func briefAgentSetup(t *testing.T, script func(RunInput) (AgentResult, error)) (e *engine, agent *scriptedAgent, brief, deals, prices string) {
	t.Helper()
	e = newEngine(t)
	e.zone(models.NotificationSettings{Timezone: "Asia/Kolkata"})
	d := e.create(pageInput("Deals", "https://deals.example/"))
	p := e.create(pageInput("Prices", "https://prices.example/"))
	v := e.create(briefInput("Morning", d.ID, p.ID))
	e.convertBriefNow(v.ID)
	if script != nil {
		agent = newScriptedAgent(script)
		e.s.SetAgent(agent)
	}
	return e, agent, v.ID, d.ID, p.ID
}

// A converted brief's tick hands the Agent its sources' notes since the last
// brief and sends what it wrote; the next brief hands only newer notes, and
// with none new the Agent is not asked.
func TestIntegrationBriefAgentRun(t *testing.T) {
	e, agent, id, deals, prices := briefAgentSetup(t, func(RunInput) (AgentResult, error) {
		return AgentResult{Reports: []Report{{Title: "Morning: two deals and a drop", Body: "Deals had two new ones.\nPrices dropped below $10."}}}, nil
	})
	start := e.now
	e.note(deals, "item", "Before the brief", "", start.Add(-time.Minute))
	e.note(deals, "item", "Deal 1", "New in deals.example", start.Add(time.Minute))
	e.note(deals, "item", "Deal 2", "New in deals.example", start.Add(2*time.Minute))
	e.note(prices, "price", "below $10", "Now $9 (was $12)", start.Add(time.Hour))

	c := e.runBrief(id)
	if c.Outcome != outFired || c.AlertID == nil || c.Run == nil || c.Run.ErrorClass != "" || c.Run.Reports != 1 || c.SkipReason != "" {
		t.Fatalf("brief check %+v run %+v", c, c.Run)
	}
	if agent.runCount() != 1 {
		t.Fatalf("%d agent runs", agent.runCount())
	}
	in := agent.runs[0]
	if in.CheckID != c.ID || in.Bot.ID != id || !strings.Contains(in.Prompt, "Sum up what these bots found") || len(in.Readings) != 0 || len(in.Diff) != 0 {
		t.Fatalf("run input %+v", in)
	}
	var titles []string
	for _, f := range in.Passed {
		titles = append(titles, f.Title)
	}
	if len(titles) != 3 || titles[0] != "Deals: Deal 2" || titles[1] != "Deals: Deal 1" || titles[2] != "Prices: below $10" {
		t.Fatalf("passed notes %v", titles)
	}
	a := e.alertRow(c.ID)
	if a.Kind != alertKindBrief || a.Title != "Morning: two deals and a drop" || a.Body != "Deals had two new ones.\nPrices dropped below $10." ||
		a.AIState != aiJudged || a.AIWhy != "" || a.NotificationID == nil {
		t.Fatalf("brief alert %+v", a)
	}
	b := e.bot(id)
	loc, err := time.LoadLocation("Asia/Kolkata")
	must(t, err)
	if next := b.NextCheckAt.In(loc); next.Hour() != 8 || next.Minute() != 0 || !next.After(e.now) || b.BriefCursorAt == nil || !b.BriefCursorAt.After(start) {
		t.Fatalf("next %v cursor %v", b.NextCheckAt, b.BriefCursorAt)
	}

	// Only what came after the last brief goes in next time.
	e.note(deals, "item", "Deal 3", "New in deals.example", e.now.Add(time.Minute))
	c = e.runBrief(id)
	if c.Outcome != outFired || agent.runCount() != 2 {
		t.Fatalf("second brief %+v, %d runs", c, agent.runCount())
	}
	if p := agent.runs[1].Passed; len(p) != 1 || p[0].Title != "Deals: Deal 3" {
		t.Fatalf("second brief passed %+v", p)
	}

	// Nothing new: no run, no alert.
	c = e.runBrief(id)
	if c.Outcome != outUnchanged || c.AlertID != nil || c.Run != nil || agent.runCount() != 2 {
		t.Fatalf("an empty brief %+v, %d runs", c, agent.runCount())
	}
}

// With no AI provider, the model out of reach, or a run that says nothing, a
// brief goes out from the template: the one fallback bots keep.
func TestIntegrationBriefAgentTemplateFallback(t *testing.T) {
	cases := []struct {
		name   string
		script func(RunInput) (AgentResult, error)
		skip   string
		why    string
		class  string
	}{
		{name: "no agent wired", skip: SkipNoAI, why: noteNoProvider},
		{name: "no provider", script: func(RunInput) (AgentResult, error) { return AgentResult{}, ErrNoAI }, skip: SkipNoAI, why: noteNoProvider},
		{name: "unreachable", script: func(RunInput) (AgentResult, error) { return AgentResult{ErrorClass: ClassUnreachable}, nil }, why: noteBriefLater, class: ClassUnreachable},
		{name: "worker gone", script: func(RunInput) (AgentResult, error) { return AgentResult{}, errors.New("broken pipe") }, why: noteBriefLater, class: ClassUnreachable},
		{name: "silent", script: func(RunInput) (AgentResult, error) { return AgentResult{Silent: true}, nil }, why: noteBriefLater},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, _, id, deals, _ := briefAgentSetup(t, tc.script)
			e.note(deals, "item", "Deal 1", "New in deals.example", e.now.Add(time.Minute))
			e.note(deals, "item", "Deal 2", "New in deals.example", e.now.Add(2*time.Minute))

			c := e.runBrief(id)
			if c.Outcome != outFired || c.AlertID == nil || c.SkipReason != tc.skip {
				t.Fatalf("check %+v", c)
			}
			if tc.class != "" && (c.Run == nil || c.Run.ErrorClass != tc.class) {
				t.Fatalf("run record %+v", c.Run)
			}
			a := e.alertRow(c.ID)
			if a.Title != "Morning: 2 new from 1 bot" || a.Body != "Deals: Deal 2\nDeals: Deal 1" || a.AIState != aiUnchecked || a.AIWhy != tc.why || a.NotificationID == nil {
				t.Fatalf("template brief %+v", a)
			}
			if b := e.bot(id); b.Strikes != 0 || b.Status != StatusActive || b.NextCheckAt == nil || !b.NextCheckAt.After(e.now) {
				t.Fatalf("the Bot after a fallback: %+v", b)
			}
		})
	}
}

// A snoozed converted brief keeps the Agent's words but sends no notification.
func TestIntegrationBriefAgentSnoozed(t *testing.T) {
	e, _, id, deals, _ := briefAgentSetup(t, func(RunInput) (AgentResult, error) {
		return AgentResult{Reports: []Report{{Title: "Quiet day", Body: "One deal."}}}, nil
	})
	e.note(deals, "item", "Deal 1", "", e.now.Add(time.Minute))
	must(t, e.db.Model(&Bot{}).Where("id = ?", id).Update("snoozed_until", e.now.Add(72*time.Hour)).Error)
	c := e.runBrief(id)
	a := e.alertRow(c.ID)
	if a.Held != heldSnoozed || a.NotificationID != nil || a.Body != "One deal." {
		t.Fatalf("snoozed brief %+v", a)
	}
}
