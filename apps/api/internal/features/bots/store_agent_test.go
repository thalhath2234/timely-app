package bots

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"

	"gorm.io/gorm"
)

func agentRow(t *testing.T, db *gorm.DB, id string) Bot {
	t.Helper()
	var b Bot
	must(t, db.Where("id = ?", id).First(&b).Error)
	return b
}

func sched(s string) json.RawMessage {
	raw, _ := json.Marshal(s)
	return raw
}

func isInvalid(err error) bool {
	var in *InputError
	return errors.As(err, &in)
}

func TestIntegrationStoreAgentCreate(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	must(t, db.Create(&models.Config{ID: "cfg_" + me, UserID: me, NotificationSettings: models.NotificationSettings{Timezone: "Asia/Kolkata"}}).Error)
	s := NewStore(db)
	ctx := context.Background()
	page := []WatchInput{{Kind: "page", URL: "https://example.com/a"}}

	v, err := s.Create(ctx, me, Input{Name: "Agent", Watches: page, AgentInput: AgentInput{
		Prompt:   ptr("  Tell me when the page says sold out  "),
		Schedule: sched("every 1m"),
		Tools:    &ToolsInput{Egress: &[]string{"example.com"}, UseMemory: ptr(true)},
	}}, OriginApp, botNow)
	must(t, err)
	b := agentRow(t, db, v.ID)
	if b.Engine != EngineAgent || b.Prompt != "Tell me when the page says sold out" || b.Gate != GateChanged || b.Permission != PermissionAuto {
		t.Fatalf("agent fields not saved: %+v", b)
	}
	// The page's 15-minute floor lifts the schedule, and the interval follows.
	if got := b.Schedule["everyMinutes"]; got != float64(15) || b.IntervalSeconds != 15*60 {
		t.Fatalf("schedule %v interval %d, want 15 minutes", b.Schedule, b.IntervalSeconds)
	}
	if b.Timezone != "Asia/Kolkata" {
		t.Fatalf("timezone %q, want the notification zone", b.Timezone)
	}
	if !b.UseMemory || len(b.Egress) != 1 || b.Egress[0] != "example.com" || !b.Tools.UseMemory || len(b.Tools.Egress) != 1 {
		t.Fatalf("egress and memory columns out of step with tools: %+v", b)
	}
	if count(t, db, "bot_watches", "bot_id = ?", b.ID) != 1 {
		t.Fatal("the Bot's watch was not saved with it")
	}
	if b.NextCheckAt == nil || !b.NextCheckAt.Equal(botNow) {
		t.Fatalf("next check %v, want now", b.NextCheckAt)
	}

	// No Reads: it runs on its schedule, the gate is always, the floor is 15 minutes.
	v, err = s.Create(ctx, me, Input{Name: "Daily", AgentInput: AgentInput{
		Prompt: ptr("Summarise my day"), Schedule: sched("weekdays at 9am"), Timezone: ptr("Europe/Berlin"), Gate: ptr(GateChanged),
	}}, OriginApp, botNow)
	must(t, err)
	b = agentRow(t, db, v.ID)
	if b.Gate != GateAlways || b.Timezone != "Europe/Berlin" || count(t, db, "bot_watches", "bot_id = ?", b.ID) != 0 {
		t.Fatalf("a Bot with no Reads: %+v", b)
	}
	if b.IntervalSeconds < 300 || b.IntervalSeconds > 604800 {
		t.Fatalf("interval %d outside the CHECK", b.IntervalSeconds)
	}

	// A rules Bot is unchanged: rules engine, no zone, no agent fields.
	v, err = s.Create(ctx, me, Input{Name: "Rules", Watches: page}, OriginApp, botNow)
	must(t, err)
	b = agentRow(t, db, v.ID)
	if b.Engine != EngineRules || b.Timezone != "" || b.Prompt != "" || b.Permission != PermissionAuto || b.Gate != GateChanged {
		t.Fatalf("rules Bot changed: %+v", b)
	}
}

func TestIntegrationStoreAgentTimezoneDefaults(t *testing.T) {
	db := migratedDB(t)
	s := NewStore(db)
	ctx := context.Background()
	in := func(name string) Input {
		return Input{Name: name, AgentInput: AgentInput{Prompt: ptr("Do it"), Schedule: sched("every 6h")}}
	}

	// No settings row at all: UTC.
	noCfg := addUser(t, db)
	v, err := s.Create(ctx, noCfg, in("A"), OriginApp, botNow)
	must(t, err)
	if tz := agentRow(t, db, v.ID).Timezone; tz != "UTC" {
		t.Fatalf("no settings: timezone %q, want UTC", tz)
	}

	// A settings row with no zone reads the server's, pinned to UTC here.
	blank := addUser(t, db)
	must(t, db.Create(&models.Config{ID: "cfg_" + blank, UserID: blank}).Error)
	v, err = s.Create(ctx, blank, in("B"), OriginApp, botNow)
	must(t, err)
	if tz := agentRow(t, db, v.ID).Timezone; tz != "UTC" {
		t.Fatalf("blank zone: timezone %q, want UTC", tz)
	}

	// The zone quiet hours read.
	set := addUser(t, db)
	must(t, db.Create(&models.Config{ID: "cfg_" + set, UserID: set, NotificationSettings: models.NotificationSettings{Timezone: "America/Chicago"}}).Error)
	v, err = s.Create(ctx, set, in("C"), OriginApp, botNow)
	must(t, err)
	if tz := agentRow(t, db, v.ID).Timezone; tz != "America/Chicago" {
		t.Fatalf("timezone %q, want the notification zone", tz)
	}

	// A zone the person sends wins; a Bot that kept none gets the zone on its next edit.
	explicit := in("D")
	explicit.Timezone = ptr("Asia/Tokyo")
	v, err = s.Create(ctx, set, explicit, OriginApp, botNow)
	must(t, err)
	if tz := agentRow(t, db, v.ID).Timezone; tz != "Asia/Tokyo" {
		t.Fatalf("timezone %q, want the one sent", tz)
	}
	must(t, db.Model(&Bot{}).Where("id = ?", v.ID).Update("timezone", "").Error)
	if _, err = s.Update(ctx, set, v.ID, Patch{AgentInput: AgentInput{Prompt: ptr("Do it again")}}, OriginApp, botNow); err != nil {
		t.Fatal(err)
	}
	if tz := agentRow(t, db, v.ID).Timezone; tz != "America/Chicago" {
		t.Fatalf("after update: timezone %q, want the notification zone", tz)
	}
}

func TestIntegrationStoreAgentUpdate(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := NewStore(db)
	ctx := context.Background()
	page := []WatchInput{{Kind: "page", URL: "https://example.com/a"}}

	v, err := s.Create(ctx, me, Input{Name: "Agent", Watches: page, AgentInput: AgentInput{
		Prompt: ptr("Watch it"), Schedule: sched("every 6h"),
	}}, OriginApp, botNow)
	must(t, err)
	before := agentRow(t, db, v.ID)

	// A prompt change alone leaves the schedule, interval and next check as they are.
	if _, err = s.Update(ctx, me, v.ID, Patch{AgentInput: AgentInput{Prompt: ptr("Watch it closely")}}, OriginApp, botNow); err != nil {
		t.Fatal(err)
	}
	b := agentRow(t, db, v.ID)
	if b.Prompt != "Watch it closely" || b.IntervalSeconds != before.IntervalSeconds || b.Schedule["everyMinutes"] != before.Schedule["everyMinutes"] {
		t.Fatalf("prompt update: %+v", b)
	}

	// Several fields at once, in one write; a faster schedule brings the next check sooner.
	_, err = s.Update(ctx, me, v.ID, Patch{AgentInput: AgentInput{
		Schedule: sched("every 30m"), Permission: ptr(PermissionSupervised), Gate: ptr(GateAlways),
		Tools: &ToolsInput{BrowserSites: &[]string{"example.com"}, Egress: &[]string{"api.example.com"}, UseMemory: ptr(true)},
	}}, OriginApp, botNow)
	must(t, err)
	b = agentRow(t, db, v.ID)
	if b.Engine != EngineAgent || b.Permission != PermissionSupervised || b.Gate != GateAlways || !b.UseMemory ||
		b.IntervalSeconds != 30*60 || b.Schedule["everyMinutes"] != float64(30) {
		t.Fatalf("update: %+v", b)
	}
	if len(b.Tools.BrowserSites) != 1 || len(b.Tools.Egress) != 1 || !b.Tools.UseMemory || len(b.Egress) != 1 || b.Egress[0] != "api.example.com" {
		t.Fatalf("tools out of step with columns: %+v", b)
	}
	if b.NextCheckAt == nil || b.NextCheckAt.After(botNow.Add(30*time.Minute)) {
		t.Fatalf("next check %v, want within the new schedule", b.NextCheckAt)
	}

	// Dropping every Read leaves a Bot that runs on its schedule, gate always.
	empty := []WatchInput{}
	if _, err = s.Update(ctx, me, v.ID, Patch{Watches: &empty, AgentInput: AgentInput{Gate: ptr(GateChanged)}}, OriginApp, botNow); err != nil {
		t.Fatal(err)
	}
	b = agentRow(t, db, v.ID)
	if b.Gate != GateAlways || count(t, db, "bot_watches", "bot_id = ?", b.ID) != 0 {
		t.Fatalf("no Reads: %+v", b)
	}

	// Adding a price Read without agent fields still re-derives the interval from the floor.
	price := []WatchInput{{Kind: "page", URL: "https://example.com/shop", Read: ReadProductPrice}}
	if _, err = s.Update(ctx, me, v.ID, Patch{Watches: &price, AgentInput: AgentInput{Schedule: sched("every 15m")}}, OriginApp, botNow); err != nil {
		t.Fatal(err)
	}
	b = agentRow(t, db, v.ID)
	if want := int(MinProductEvery / time.Second); b.IntervalSeconds != want || b.Schedule["everyMinutes"] != float64(want/60) {
		t.Fatalf("product floor: interval %d schedule %v, want %d s", b.IntervalSeconds, b.Schedule, want)
	}

	// intervalMinutes is a rules Bot's: an agent Bot ignores it.
	if _, err = s.Update(ctx, me, v.ID, Patch{IntervalMinutes: ptr(10000)}, OriginApp, botNow); err != nil {
		t.Fatal(err)
	}
	if got := agentRow(t, db, v.ID); got.IntervalSeconds != b.IntervalSeconds {
		t.Fatalf("interval moved to %d by intervalMinutes", got.IntervalSeconds)
	}
}

func TestIntegrationStoreAgentRulesBotStaysRules(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := NewStore(db)
	ctx := context.Background()
	v, err := s.Create(ctx, me, Input{Name: "Rules", Watches: []WatchInput{{Kind: "page", URL: "https://example.com/a"}}}, OriginApp, botNow)
	must(t, err)

	// Agent fields on a rules Bot are refused; the engine flips only on approval.
	_, err = s.Update(ctx, me, v.ID, Patch{AgentInput: AgentInput{Prompt: ptr("Be an agent"), Schedule: sched("every 6h")}}, OriginApp, botNow)
	if !isInvalid(err) || !strings.Contains(err.Error(), "agent") {
		t.Fatalf("err %v, want the switch-first refusal", err)
	}
	// A plain rules patch, with its watches and interval, leaves it a rules Bot.
	_, err = s.Update(ctx, me, v.ID, Patch{IntervalMinutes: ptr(60), Description: ptr("hello"),
		Watches: &[]WatchInput{{Kind: "page", URL: "https://example.com/b"}}}, OriginApp, botNow)
	must(t, err)
	b := agentRow(t, db, v.ID)
	if b.Engine != EngineRules || b.Prompt != "" || b.Timezone != "" || b.IntervalSeconds != 3600 {
		t.Fatalf("rules Bot changed: %+v", b)
	}
	// A rules Bot still needs a watch.
	if _, err = s.Update(ctx, me, v.ID, Patch{Watches: &[]WatchInput{}}, OriginApp, botNow); !isInvalid(err) {
		t.Fatalf("err %v, want an empty watch list refused", err)
	}
}

func TestIntegrationStoreAgentRejectsInvalid(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := NewStore(db)
	ctx := context.Background()
	page := []WatchInput{{Kind: "page", URL: "https://example.com/a"}}
	ok := AgentInput{Prompt: ptr("Do it"), Schedule: sched("every 6h")}
	with := func(f func(a *AgentInput)) Input {
		a := ok
		f(&a)
		return Input{Name: "X", Watches: page, AgentInput: a}
	}

	for name, in := range map[string]Input{
		"no prompt":         with(func(a *AgentInput) { a.Prompt = nil }),
		"blank prompt":      with(func(a *AgentInput) { a.Prompt = ptr("   ") }),
		"long prompt":       with(func(a *AgentInput) { a.Prompt = ptr(strings.Repeat("a", MaxPromptLen+1)) }),
		"no schedule":       with(func(a *AgentInput) { a.Schedule = nil }),
		"bad schedule":      with(func(a *AgentInput) { a.Schedule = sched("whenever") }),
		"bad zone":          with(func(a *AgentInput) { a.Timezone = ptr("Mars/Base") }),
		"bad permission":    with(func(a *AgentInput) { a.Permission = ptr("root") }),
		"bad gate":          with(func(a *AgentInput) { a.Gate = ptr("sometimes") }),
		"lone model":        with(func(a *AgentInput) { a.Model = ptr("m") }),
		"bad mcp mode":      with(func(a *AgentInput) { a.Tools = &ToolsInput{MCP: map[string]string{"x": "maybe"}} }),
		"bad browser site":  with(func(a *AgentInput) { a.Tools = &ToolsInput{BrowserSites: &[]string{"not a host!"}} }),
		"agent but no read": {Name: "X", AgentInput: AgentInput{Gate: ptr(GateAlways)}},
		"brief with agent":  {Name: "X", Kind: KindBrief, Sources: &[]string{"a"}, BriefTime: ptr("08:00"), AgentInput: ok},
	} {
		if _, err := s.Create(ctx, me, in, OriginApp, botNow); !isInvalid(err) {
			t.Errorf("%s: err %v, want a validation error", name, err)
		}
	}
	if n := count(t, db, "bots", "user_id = ?", me); n != 0 {
		t.Fatalf("%d Bots saved from refused creates", n)
	}

	// An outside app cannot set tools, skills, permission or a model.
	for name, a := range map[string]AgentInput{
		"tools":      {Tools: &ToolsInput{UseMemory: ptr(true)}},
		"skills":     {Skills: &[]string{"x"}},
		"permission": {Permission: ptr(PermissionFull)},
		"model":      {ModelProvider: ptr("p"), Model: ptr("m")},
	} {
		a.Prompt, a.Schedule = ok.Prompt, ok.Schedule
		if _, err := s.Create(ctx, me, Input{Name: "MCP " + name, Watches: page, AgentInput: a}, OriginMCP, botNow); !isInvalid(err) {
			t.Errorf("mcp %s: err %v, want a validation error", name, err)
		}
	}

	// On update, a refused field changes nothing, not even the valid ones sent with it.
	v, err := s.Create(ctx, me, Input{Name: "Agent", Watches: page, AgentInput: ok}, OriginApp, botNow)
	must(t, err)
	before := agentRow(t, db, v.ID)
	_, err = s.Update(ctx, me, v.ID, Patch{Description: ptr("changed"), AgentInput: AgentInput{Prompt: ptr("New"), Permission: ptr("root")}}, OriginApp, botNow)
	if !isInvalid(err) {
		t.Fatalf("err %v, want a validation error", err)
	}
	if after := agentRow(t, db, v.ID); after.Prompt != before.Prompt || after.Description != before.Description {
		t.Fatalf("a refused update saved something: %+v", after)
	}
}

func TestIntegrationStoreAgentInterval(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := NewStore(db)
	ctx := context.Background()
	for i, sc := range []string{"every 5m", "every 1m", "every 7d", "every 99999h", "daily at 9am", "weekdays at 9am", "0 9 * * *", "*/10 * * * *", "0 9 1 * *"} {
		for _, reads := range [][]WatchInput{nil, {{Kind: "page", URL: "https://example.com/a"}}, {{Kind: "price", Source: "stock", Symbol: "AAPL"}}} {
			in := Input{Name: "B" + string(rune('a'+i)) + string(rune('0'+len(reads))), Watches: reads, AgentInput: AgentInput{Prompt: ptr("Go"), Schedule: sched(sc)}}
			if len(reads) == 1 && reads[0].Kind == "price" {
				in.Name += "p"
			}
			v, err := s.Create(ctx, me, in, OriginApp, botNow)
			if err != nil {
				if isInvalid(err) {
					continue // a schedule the parser refuses never reaches the column
				}
				t.Fatalf("%s: %v", sc, err)
			}
			if got := agentRow(t, db, v.ID).IntervalSeconds; got < 300 || got > 604800 {
				t.Errorf("%s: interval_seconds %d outside 300..604800", sc, got)
			}
		}
	}
	if n := count(t, db, "bots", "user_id = ?", me); n == 0 {
		t.Fatal("no schedule was accepted")
	}
}
