package bots

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

// fakeAgent is a compile-time proof that Agent and ThreadPoster can be
// implemented from outside the tick.
type fakeAgent struct{ busy bool }

func (f fakeAgent) Run(context.Context, string, RunInput) (AgentResult, error) {
	return AgentResult{Silent: true}, nil
}
func (f fakeAgent) BrowserBusy(string) bool { return f.busy }

type fakePoster struct{}

func (fakePoster) PostAlert(context.Context, string, string, string) error { return nil }

var (
	_ Agent        = fakeAgent{}
	_ ThreadPoster = fakePoster{}
)

// TestAgentWordsAreInMigration checks that every word the API writes for an
// agent Bot is one the migration's CHECK constraints allow, so a drift fails
// here rather than as a constraint error at run time.
func TestAgentWordsAreInMigration(t *testing.T) {
	b, err := os.ReadFile("../../../migrations/20261115120000_agent_bots.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	up, _, _ := strings.Cut(string(b), "-- +goose Down")
	for _, w := range []string{
		SkipBrowserBusy, SkipNoAI, SkipUnchanged, SkipDuplicate,
		ProposalPending, ProposalApproved, ProposalApplied, ProposalDismissed, ProposalUndone, ProposalFailed,
		outSilent, outAlerted, outSkipped, outFailed, outBrowserBusy, outNoAI, outDuplicate,
		EngineRules, EngineAgent, PermissionSupervised, PermissionAuto, PermissionFull, GateChanged, GateAlways,
	} {
		if !strings.Contains(up, "'"+w+"'") {
			t.Errorf("migration does not allow %q", w)
		}
	}
}

// TestRunTypesJSON checks the wire shape of what the bridge sends back: a
// Report keeps a proposal verbatim and drops what is empty.
func TestRunTypesJSON(t *testing.T) {
	in := `{"title":"Drop","body":"Now 40","price":40,"proposal":{"tool":"create_task"}}`
	var r Report
	if err := json.Unmarshal([]byte(in), &r); err != nil {
		t.Fatal(err)
	}
	if r.Price == nil || *r.Price != 40 || string(r.Proposal) != `{"tool":"create_task"}` {
		t.Fatalf("decoded %+v", r)
	}
	out, err := json.Marshal(Report{Title: "x", Body: "y"})
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"title":"x","body":"y"}` {
		t.Fatalf("empty fields not dropped: %s", out)
	}
}

// TestAgentBotFieldsDefaultJSON checks a Bot's JSON carries every agent field
// the contract's AgentBotFields names.
func TestAgentBotFieldsDefaultJSON(t *testing.T) {
	b, err := json.Marshal(Bot{})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"engine", "prompt", "schedule", "timezone", "skills", "tools", "modelProvider", "model", "gate", "egress", "marketHours", "permission", "useMemory", "threadId"} {
		if _, ok := m[k]; !ok {
			t.Errorf("Bot JSON has no %q", k)
		}
	}
}

// TestIntegrationAgentBotsMigrationRoundTrip runs the phase 6 migration up,
// down and up again on an isolated schema, checks the down step drops every
// column and table it added, and that the new columns and constraints hold
// what the models write.
func TestIntegrationAgentBotsMigrationRoundTrip(t *testing.T) {
	db := migratedDB(t)
	sqlDB, err := db.DB()
	must(t, err)

	added := map[string][]string{
		"bots":                {"prompt", "schedule", "timezone", "skills", "tools", "model_provider", "model", "gate", "egress", "market_hours", "engine", "permission", "use_memory", "thread_id"},
		"bot_checks":          {"run", "gate_skipped", "skip_reason"},
		"bot_alerts":          {"proposal", "proposal_state", "fingerprint"},
		"agent_conversations": {"kind", "bot_id", "from_bot_id"},
		"bot_notes":           {"bot_id", "user_id", "key", "value", "updated_at"},
	}
	has := func(table, col string) bool {
		var n int64
		must(t, db.Raw("SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?", table, col).Scan(&n).Error)
		return n > 0
	}
	check := func(want bool, when string) {
		t.Helper()
		for table, cols := range added {
			for _, c := range cols {
				if has(table, c) != want {
					t.Errorf("%s: %s.%s present = %v, want %v", when, table, c, !want, want)
				}
			}
		}
	}
	check(true, "after up")

	// Down to just before 20261115120000_agent_bots.sql (later ones first).
	must(t, goose.DownTo(sqlDB, ".", 20261115120000-1))
	check(false, "after down")

	must(t, goose.Up(sqlDB, "."))
	check(true, "after second up")

	uid := addUser(t, db)
	bot := Bot{ID: "bot_" + uuid.NewString(), UserID: uid, Name: "Agent", Origin: OriginApp, Status: "active", JudgeMode: JudgeRules, IntervalSeconds: 900, NextCheckAt: &botNow, Kind: KindWatch, Health: "new",
		Engine: EngineAgent, Prompt: "watch it", Gate: GateChanged, Permission: PermissionAuto, Schedule: jsonMap[string, any]{"everyMinutes": 15}}
	must(t, db.Create(&bot).Error)
	var got Bot
	must(t, db.First(&got, "id = ?", bot.ID).Error)
	if got.Engine != EngineAgent || got.Gate != GateChanged || got.Permission != PermissionAuto || got.UseMemory || got.Schedule["everyMinutes"] != float64(15) {
		t.Errorf("Bot round trip lost fields: %+v", got)
	}

	// A rules Bot keeps the defaults.
	rules := Bot{ID: "bot_" + uuid.NewString(), UserID: uid, Name: "Rules", Origin: OriginApp, Status: "active", JudgeMode: JudgeRules, IntervalSeconds: 900, NextCheckAt: &botNow, Kind: KindWatch, Health: "new"}
	must(t, db.Create(&rules).Error)
	var plain Bot
	must(t, db.First(&plain, "id = ?", rules.ID).Error)
	if plain.Engine != EngineRules || plain.Gate != GateChanged || plain.Permission != PermissionAuto {
		t.Errorf("rules Bot defaults: %+v", plain)
	}

	// One bot_thread per Bot, and a chat has no bot_id.
	thread := func(id string, botID *string, kind string) error {
		return db.Exec("INSERT INTO agent_conversations (id, user_id, title, kind, bot_id) VALUES (?, ?, 't', ?, ?)", id, uid, kind, botID).Error
	}
	if err := thread("chat_t1", &bot.ID, "bot_thread"); err != nil {
		t.Fatal(err)
	}
	if err := thread("chat_t2", &bot.ID, "bot_thread"); err == nil {
		t.Error("a second bot_thread for one Bot was allowed")
	}
	if err := thread("chat_c1", &bot.ID, "chat"); err == nil {
		t.Error("a chat with a bot_id was allowed")
	}
	if err := thread("chat_c2", nil, "chat"); err != nil {
		t.Errorf("a plain chat: %v", err)
	}

	// Notes are one value per Bot and key; deleting the Bot takes them and
	// its thread.
	must(t, db.Create(&Note{BotID: bot.ID, UserID: uid, Key: "last", Value: "1"}).Error)
	if err := db.Create(&Note{BotID: bot.ID, UserID: uid, Key: "last", Value: "2"}).Error; err == nil {
		t.Error("a second note with the same key was allowed")
	}
	must(t, db.Delete(&Bot{}, "id = ?", bot.ID).Error)
	var left, threads int64
	must(t, db.Model(&Note{}).Where("bot_id = ?", bot.ID).Count(&left).Error)
	must(t, db.Raw("SELECT count(*) FROM agent_conversations WHERE id = 'chat_t1'").Scan(&threads).Error)
	if left != 0 || threads != 0 {
		t.Errorf("deleting the Bot left %d notes and %d threads", left, threads)
	}
}
