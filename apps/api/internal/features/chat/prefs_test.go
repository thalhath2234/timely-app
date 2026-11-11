package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/features/agent"
	"timely-api/internal/models"

	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The worker gets every Read tool classic offers, propose_changes and
// resolve_target, never a Write tool; the version follows the specs.
func TestAgentToolSpecs(t *testing.T) {
	catalog := agent.Catalog{
		"list_docs":   {Description: "List docs"},
		"ask_bot":     {Description: "Ask a bot"},
		"create_task": {Description: "Create a task"},
	}
	for name, tool := range catalog {
		tool.Authority, _ = agent.AuthorityOf(name)
		catalog[name] = tool
	}
	version, specs := AgentToolSpecs(catalog)
	names := []string{}
	for _, spec := range specs {
		names = append(names, spec.Name)
	}
	if strings.Join(names, ",") != "ask_bot,list_docs,propose_changes,resolve_target" {
		t.Fatalf("specs %v", names)
	}
	if !specs[0].Outside || specs[1].Outside {
		t.Errorf("outside marks: %+v", specs[:2])
	}
	if params, ok := specs[2].Parameters.(map[string]any); !ok || params["required"] == nil || specs[2].Description != proposeDescription {
		t.Errorf("propose_changes spec %+v", specs[2])
	}
	if params, ok := specs[3].Parameters.(map[string]any); !ok || params["properties"] == nil || specs[3].Description == "" {
		t.Errorf("resolve_target spec %+v", specs[3])
	}
	again, _ := AgentToolSpecs(catalog)
	if version == "" || again != version {
		t.Fatalf("version %q then %q", version, again)
	}
	changed := catalog["list_docs"]
	changed.Description = "List the person's docs"
	catalog["list_docs"] = changed
	if other, _ := AgentToolSpecs(catalog); other == version {
		t.Fatal("a changed description must change the version")
	}
}

// fakeEngine records what the lanes and routes ask of the agent engine.
type fakeEngine struct {
	mu          sync.Mutex
	unavailable error
	lostErr     error
	started     []Conversation
	lost        []Conversation
	stopped     []string
	steered     []string
	forgotten   []string
}

func (f *fakeEngine) Available(_ context.Context, _ string, _ *Conversation) error {
	return f.unavailable
}
func (f *fakeEngine) Start(_ context.Context, c *Conversation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.started = append(f.started, *c)
	return nil
}
func (f *fakeEngine) Lost(_ context.Context, c *Conversation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lost = append(f.lost, *c)
	return f.lostErr
}
func (f *fakeEngine) Stop(uid, cid, runID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped = append(f.stopped, cid+":"+runID)
}
func (f *fakeEngine) Steer(_ context.Context, _, cid, runID, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.steered = append(f.steered, cid+":"+runID+":"+text)
	return nil
}
func (f *fakeEngine) Forget(_, cid string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.forgotten = append(f.forgotten, cid)
}

func (f *fakeEngine) startedIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{}
	for _, c := range f.started {
		out = append(out, c.ID)
	}
	return out
}

// queuedChat stores a queued plan turn for user-a.
func queuedChat(t *testing.T, db *gorm.DB, edit func(*Conversation)) Conversation {
	t.Helper()
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Test", Status: "queued", Phase: "plan", Context: []ContextChip{}, Messages: []Message{message("user", "Add Buy milk")}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if edit != nil {
		edit(&c)
	}
	if err := db.Create(&c).Error; err != nil {
		t.Fatal(err)
	}
	return c
}

// runLanes runs the service's lanes until done reports true (or the
// deadline passes), then stops them.
func runLanes(t *testing.T, s *Service, done func() bool) {
	t.Helper()
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	s.Run(ctx)
	defer func() { cancel(); s.Wait() }()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("the lanes did not finish")
}

// settled reports whether every chat reached one of the statuses.
func settled(db *gorm.DB, statuses []string, ids ...string) func() bool {
	return func() bool {
		var n int64
		db.Model(&Conversation{}).Where("id IN ? AND status IN ?", ids, statuses).Count(&n)
		return int(n) == len(ids)
	}
}

// The lane picks the engine at claim: the chat's choice, else the
// account's; Sensitive chats and other phases run classic; an agent turn
// goes to Start and holds no lane; an engine that cannot run fails the chat
// with "Use classic for this chat", never switching on its own.
func TestIntegrationEngineChosenAtClaim(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&AgentChatSettings{UserID: "user-a", Engine: engineAgent, ChatPermission: "supervised", BotPermission: "auto", FullAccessAllowedOn: "desktop"}).Error; err != nil {
		t.Fatal(err)
	}
	model := &scripted{responses: []WireMessage{{Role: "assistant", Content: "Classic answered."}, {Role: "assistant", Content: "Classic answered."}}}
	engine := &fakeEngine{}
	s := New(db, createCatalog, model)
	s.SetAgentEngine(engine)
	agentTurn := queuedChat(t, db, nil)
	sensitive := queuedChat(t, db, func(c *Conversation) { c.Sensitive = true })
	pinned := queuedChat(t, db, func(c *Conversation) { c.Engine = engineClassic })
	runLanes(t, s, func() bool {
		return len(engine.startedIDs()) > 0 && settled(db, []string{"idle", "failed"}, sensitive.ID, pinned.ID)()
	})

	if got := engine.startedIDs(); len(got) != 1 || got[0] != agentTurn.ID {
		t.Fatalf("started %v, want only %s", got, agentTurn.ID)
	}
	var rows []Conversation
	db.Where("id IN ?", []string{agentTurn.ID, sensitive.ID, pinned.ID}).Find(&rows)
	for _, row := range rows {
		switch row.ID {
		case agentTurn.ID:
			if row.RunEngine != engineAgent || row.Status != "running" {
				t.Errorf("agent turn: %s %s", row.RunEngine, row.Status)
			}
		default:
			if row.RunEngine != engineClassic || row.Status != "idle" {
				t.Errorf("%s: %s %s (classic expected)", row.ID, row.RunEngine, row.Status)
			}
		}
	}

	// An engine that cannot run this chat fails it with the reason.
	engine.unavailable = errors.New("the agent runtime is not installed")
	broken := queuedChat(t, db, nil)
	runLanes(t, s, settled(db, []string{"failed"}, broken.ID))
	db.First(&broken, "id = ?", broken.ID)
	if broken.Status != "failed" || broken.ErrorAction != ActionUseClassic || !strings.Contains(broken.Error, "the agent runtime is not installed") {
		t.Fatalf("unavailable engine: %s %q %q", broken.Status, broken.ErrorAction, broken.Error)
	}
	// Without any engine the same chat says so too.
	s.SetAgentEngine(nil)
	none := queuedChat(t, db, nil)
	runLanes(t, s, settled(db, []string{"failed"}, none.ID))
	db.First(&none, "id = ?", none.ID)
	if none.Status != "failed" || none.ErrorAction != ActionUseClassic || !strings.Contains(none.Error, "not available") {
		t.Fatalf("no engine: %s %q %q", none.Status, none.ErrorAction, none.Error)
	}
	if !strings.Contains(string(raw(none)), `"errorAction":"use_classic"`) {
		t.Fatal("the apps read errorAction use_classic")
	}
}

// A claimed agent run whose lease expired goes to Lost; Lost's error
// fails it with Try again, and without an engine it fails as lost.
func TestIntegrationLostAgentRun(t *testing.T) {
	db := integrationDB(t)
	engine := &fakeEngine{lostErr: errors.New(tr("", txtAgentLost))}
	s := New(db, createCatalog, &scripted{})
	s.SetAgentEngine(engine)
	expired := time.Now().UTC().Add(-time.Minute)
	c := queuedChat(t, db, func(c *Conversation) {
		c.Status, c.Lease, c.LeaseUntil, c.RunEngine, c.AgentRunID, c.AgentInstance = "running", "old", &expired, engineAgent, "run-1", "42:1"
	})
	runLanes(t, s, settled(db, []string{"failed"}, c.ID))
	db.First(&c, "id = ?", c.ID)
	if len(engine.lost) != 1 || engine.lost[0].AgentRunID != "run-1" || engine.lost[0].Lease == "old" {
		t.Fatalf("Lost got %+v", engine.lost)
	}
	if c.Status != "failed" || c.ErrorAction != ActionRetry || c.Error != tr("", txtAgentLost) {
		t.Fatalf("lost run: %s %q %q", c.Status, c.ErrorAction, c.Error)
	}
}

// Stop, Delete, Retry and steering reach the live agent run.
func TestIntegrationAgentRunHooks(t *testing.T) {
	db := integrationDB(t)
	engine := &fakeEngine{}
	s := New(db, createCatalog, nil)
	s.SetAgentEngine(engine)
	live := func() Conversation {
		future := time.Now().UTC().Add(time.Minute)
		return queuedChat(t, db, func(c *Conversation) {
			c.Status, c.Lease, c.LeaseUntil, c.RunEngine, c.AgentRunID = "running", "l", &future, engineAgent, "run-7"
		})
	}
	c := live()
	if code, body := serve(t, s, "POST", "/chats/"+c.ID+"/steer", `{"text":"Make it Friday instead"}`); code != 200 || !strings.Contains(string(body), `"kind":"steer"`) {
		t.Fatalf("steer: %d %s", code, body)
	}
	if code, body := serve(t, s, "POST", "/chats/"+c.ID+"/stop", `{}`); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	db.First(&c, "id = ?", c.ID)
	if c.Status != "stopped" || c.AgentRunID != "" {
		t.Fatalf("after stop: %s %q", c.Status, c.AgentRunID)
	}
	if code, _ := serve(t, s, "POST", "/chats/"+c.ID+"/steer", `{"text":"too late"}`); code != 409 {
		t.Fatalf("steer after stop: %d", code)
	}
	gone := live()
	if code, _ := serve(t, s, "DELETE", "/chats/"+gone.ID, ``); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	engine.mu.Lock()
	if strings.Join(engine.steered, "|") != c.ID+":run-7:Make it Friday instead" ||
		strings.Join(engine.stopped, "|") != c.ID+":run-7|"+gone.ID+":run-7" || strings.Join(engine.forgotten, "|") != gone.ID {
		t.Errorf("steered %v stopped %v forgotten %v", engine.steered, engine.stopped, engine.forgotten)
	}
	engine.mu.Unlock()

	failed := live()
	db.Model(&Conversation{}).Where("id = ?", failed.ID).Updates(map[string]any{"status": "failed", "error": "x"})
	if code, body := serve(t, s, "POST", "/chats/"+failed.ID+"/retry", `{}`); code != 200 {
		t.Fatalf("retry: %d %s", code, body)
	}
	db.First(&failed, "id = ?", failed.ID)
	if failed.Status != "queued" || failed.AgentRunID != "" {
		t.Fatalf("retry kept the old run: %s %q", failed.Status, failed.AgentRunID)
	}
}

// Settings → Agent: defaults, validation, and new chats taking the default
// permission.
func TestIntegrationChatSettings(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, nil)
	code, body := serve(t, s, "GET", "/agent/chat-settings", ``)
	var got map[string]any
	_ = json.Unmarshal(body, &got)
	if code != 200 || got["engine"] != "classic" || got["chatPermission"] != "supervised" || got["botPermission"] != "auto" ||
		got["fullAccessAllowedOn"] != "desktop" || got["engineAvailable"] != false || got["engineReason"] != "not available" {
		t.Fatalf("defaults: %d %s", code, body)
	}
	for _, bad := range []string{`{"engine":"turbo"}`, `{"chatPermission":"reckless"}`, `{"botPermission":""}`, `{"fullAccessAllowedOn":"phone"}`} {
		if code, _ := serve(t, s, "PATCH", "/agent/chat-settings", bad); code != 400 {
			t.Errorf("%s: %d", bad, code)
		}
	}
	if code, body := serve(t, s, "PATCH", "/agent/chat-settings", `{"engine":"agent","chatPermission":"Auto"}`); code != 200 || !strings.Contains(string(body), `"chatPermission":"auto"`) {
		t.Fatalf("patch: %d %s", code, body)
	}
	s.SetAgentEngine(&fakeEngine{})
	code, body = serve(t, s, "GET", "/agent/chat-settings", ``)
	got = nil
	_ = json.Unmarshal(body, &got)
	if code != 200 || got["engine"] != "agent" || got["chatPermission"] != "auto" || got["botPermission"] != "auto" || got["engineAvailable"] != true {
		t.Fatalf("after patch: %d %s", code, body)
	}

	code, body = serve(t, s, "POST", "/chats", `{"content":"Add Buy milk"}`)
	if code != 201 || !strings.Contains(string(body), `"permission":"auto"`) {
		t.Fatalf("a new chat takes the account default: %d %s", code, body)
	}
	code, body = serve(t, s, "POST", "/chats", `{"content":"Add Buy bread","permission":"supervised"}`)
	if code != 201 || !strings.Contains(string(body), `"permission":"supervised"`) {
		t.Fatalf("a new chat's own permission: %d %s", code, body)
	}
	if code, _ := serve(t, s, "POST", "/chats", `{"content":"x","permission":"reckless"}`); code != 400 {
		t.Fatalf("an unknown permission: %d", code)
	}

	code, body = serve(t, s, "GET", "/agent/tool-specs", ``)
	if code != 200 || !strings.Contains(string(body), `"catalogVersion"`) || !strings.Contains(string(body), `"propose_changes"`) {
		t.Fatalf("tool specs: %d %s", code, body)
	}
}

// The migrations on a fresh schema: the new conversation columns and their
// defaults, the checks, and account settings removed with the account.
func TestIntegrationAgentEngineMigrations(t *testing.T) {
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schema := "chat_migrate_" + strings.ReplaceAll(id(""), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := root.DB(); sqlDB.Close() })
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	goose.SetTableName(schema + ".goose_db_version")
	t.Cleanup(func() { goose.SetTableName("goose_db_version") })
	if err = goose.Up(sqlDB, "."); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&models.User{ID: "usr_migrate", Email: "migrate@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec("INSERT INTO agent_conversations (id, user_id, title) VALUES ('chat_old', 'usr_migrate', 'Old')").Error; err != nil {
		t.Fatal(err)
	}
	var row struct {
		Engine, RunEngine, Permission, AgentRunID, AgentInstance, Activity, RunReads, TaintedSources string
	}
	db.Raw("SELECT engine, run_engine, permission, agent_run_id, agent_instance, activity::text AS activity, run_reads::text AS run_reads, tainted_sources::text AS tainted_sources FROM agent_conversations WHERE id = 'chat_old'").Scan(&row)
	if row.Engine != "" || row.RunEngine != "" || row.Permission != "supervised" || row.AgentRunID != "" || row.AgentInstance != "" || row.Activity != "{}" || row.RunReads != "{}" || row.TaintedSources != "[]" {
		t.Fatalf("defaults %+v", row)
	}
	if db.Exec("UPDATE agent_conversations SET permission = 'reckless' WHERE id = 'chat_old'").Error == nil {
		t.Fatal("an unknown permission was stored")
	}
	if db.Exec("UPDATE agent_conversations SET engine = 'turbo' WHERE id = 'chat_old'").Error == nil {
		t.Fatal("an unknown engine was stored")
	}
	// The model reads and writes the new columns.
	var c Conversation
	if err = db.First(&c, "id = 'chat_old'").Error; err != nil {
		t.Fatal(err)
	}
	c.Permission, c.Activity = "auto", ChatActivity{Run: "run-1", Lines: []ActivityLine{{ID: "l1", Kind: "tool", Label: "Reading your tasks", State: "running", At: time.Now().UTC()}}, Draft: "Sure"}
	mergeTaint(&c, []TaintSource{{Kind: "timely", Tool: "ask_bot"}, {Kind: "timely", Tool: "ask_bot"}})
	if err = db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	var back Conversation
	db.First(&back, "id = 'chat_old'")
	if back.Permission != "auto" || back.Activity.Draft != "Sure" || len(back.Activity.Lines) != 1 || len(back.TaintedSources) != 1 {
		t.Fatalf("round trip %+v %+v", back.Activity, back.TaintedSources)
	}

	if err = db.Exec("INSERT INTO agent_chat_settings (user_id) VALUES ('usr_migrate')").Error; err != nil {
		t.Fatal(err)
	}
	prefs, err := chatSettings(db, "usr_migrate")
	if err != nil || prefs.Engine != "classic" || prefs.ChatPermission != "supervised" || prefs.BotPermission != "auto" || prefs.FullAccessAllowedOn != "desktop" {
		t.Fatalf("settings defaults %+v %v", prefs, err)
	}
	if db.Exec("UPDATE agent_chat_settings SET engine = 'turbo'").Error == nil || db.Exec("UPDATE agent_chat_settings SET full_access_allowed_on = 'phone'").Error == nil {
		t.Fatal("agent_chat_settings accepted an unknown value")
	}
	if err = db.Exec("DELETE FROM users WHERE id = 'usr_migrate'").Error; err != nil {
		t.Fatal(err)
	}
	var left int64
	db.Raw("SELECT count(*) FROM agent_chat_settings").Scan(&left)
	if left != 0 {
		t.Fatal("account settings outlived the account")
	}
}
