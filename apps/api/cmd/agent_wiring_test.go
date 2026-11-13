package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/learning"
	"timely-api/internal/features/provider"
)

// Test pages are served only to an isolated test API: both
// TIMELY_AGENT_WEB_FIXTURES and DB_SCHEMA must be set.
func TestWebFetcherNeedsFixturesAndASchema(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "news"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "news", "index.html"), []byte("<p>fixture page</p>"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := func(values map[string]string) func(string) string {
		return func(name string) string { return values[name] }
	}
	for name, values := range map[string]map[string]string{
		"neither":       {},
		"fixtures only": {"TIMELY_AGENT_WEB_FIXTURES": dir},
		"schema only":   {"DB_SCHEMA": "wt_feature"},
		"blank fixture": {"TIMELY_AGENT_WEB_FIXTURES": "  ", "DB_SCHEMA": "wt_feature"},
	} {
		if webFetcher(env(values)) != nil {
			t.Errorf("%s: the fixture fetcher is on", name)
		}
	}
	fetch := webFetcher(env(map[string]string{"TIMELY_AGENT_WEB_FIXTURES": dir, "DB_SCHEMA": "wt_feature"}))
	if fetch == nil {
		t.Fatal("the fixture fetcher is off with both set")
	}
	page, err := fetch(context.Background(), "https://news.fixture.invalid/")
	if err != nil || page.URL == "" {
		t.Fatalf("fixture page: %+v, %v", page, err)
	}
	if _, err := fetch(context.Background(), "https://example.com/"); err == nil {
		t.Fatal("the fixture fetcher read a real address")
	}
}

// The worker's "learning" messages go to the learning service; every other
// message reaches the chat engine.
func TestWorkerMuxSendsLearningToTheLearningService(t *testing.T) {
	var learned, engine []string
	mux := workerMux(func(_ *agenthost.Worker, m agenthost.Message) bool {
		if m.Type == agenthost.TypeLearning {
			learned = append(learned, m.Type)
			return true
		}
		return false
	}, func(_ *agenthost.Worker, m agenthost.Message) { engine = append(engine, m.Type) })
	for _, typ := range []string{agenthost.TypeLearning, "event", agenthost.TypeRunDone, agenthost.TypeToolCall, agenthost.TypeLearning} {
		mux(nil, agenthost.Message{Type: typ})
	}
	if !slices.Equal(learned, []string{"learning", "learning"}) || !slices.Equal(engine, []string{"event", "run.done", "tool.call"}) {
		t.Fatalf("learning got %v, the engine got %v", learned, engine)
	}
}

// accountSettings renders phase 3: the learning toolsets follow the
// account's switches, the curator never archives, the person's and the
// restored skills stay off, and the web backend and its key come from the
// account's web search key (the timely backend without one).
func TestIntegrationAccountSettingsRenderLearningAndWeb(t *testing.T) {
	db, uid := agentToolsDB(t)
	prefs := learning.Prefs{Learning: true, SearchHistory: true, SkillsDisabled: []string{"pantry-steps"}, SkillsEnabled: []string{"himalaya"}}
	webBackend, webEnv, webErr := provider.TimelyWebBackend, map[string]string(nil), error(nil)
	settings := accountSettings(db,
		func(context.Context, string) (learning.Prefs, error) { return prefs, nil },
		func(context.Context, string) (string, map[string]string, error) { return webBackend, webEnv, webErr })
	render := func() (map[string]any, agenthost.AccountSpec) {
		t.Helper()
		spec, err := settings(context.Background(), uid)
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal(spec.Settings, &out); err != nil {
			t.Fatal(err)
		}
		return out, spec
	}
	strs := func(v any) []string {
		var out []string
		for _, x := range v.([]any) {
			out = append(out, x.(string))
		}
		return out
	}

	got, spec := render()
	if ts := strs(got["toolsets"]); !slices.Equal(ts, []string{"timely", "todo", "skills", "memory", "session_search", "web", "clarify", "delegation"}) {
		t.Errorf("toolsets = %v", ts)
	}
	if c := got["curator"].(map[string]any); c["enabled"] != true || c["auto_archive"] != false {
		t.Errorf("curator = %v", c)
	}
	if l := got["learning"].(map[string]any); l["memory"] != true || l["user_profile"] != true || len(l) != 2 {
		t.Errorf("learning = %v (no separate learning model, Q-3.2)", l)
	}
	// A bundled skill that is off by default loads only when listed in
	// skills_enabled (the worker's effective_default_off).
	if e := strs(got["skills_enabled"]); !slices.Equal(e, []string{"himalaya"}) {
		t.Errorf("skills_enabled = %v", e)
	}
	if d := strs(got["skills_disabled"]); !slices.Equal(d, []string{"pantry-steps"}) {
		t.Errorf("skills_disabled = %v", d)
	}
	if w := got["web"].(map[string]any); w["search_backend"] != "timely" || w["extract_backend"] != "timely" {
		t.Errorf("web = %v", w)
	}
	if spec.ToolKeys != nil {
		t.Errorf("tool keys without a web key: %v", spec.ToolKeys)
	}

	// Search off, then learning off: the toolsets follow, and the curator
	// rests while learning is off.
	prefs.SearchHistory = false
	if got, _ = render(); !slices.Equal(strs(got["toolsets"]), []string{"timely", "todo", "skills", "memory", "web", "clarify", "delegation"}) {
		t.Errorf("search off: toolsets = %v", got["toolsets"])
	}
	prefs.Learning, prefs.SkillsDisabled, prefs.SkillsEnabled = false, nil, nil
	got, _ = render()
	if !slices.Equal(strs(got["toolsets"]), []string{"timely", "todo", "skills", "web", "clarify", "delegation"}) || got["curator"].(map[string]any)["enabled"] != false {
		t.Errorf("learning off: toolsets %v, curator %v", got["toolsets"], got["curator"])
	}
	if e, ok := got["skills_enabled"].([]any); !ok || len(e) != 0 {
		t.Errorf("skills_enabled must be a list: %v", got["skills_enabled"])
	}
	if d, ok := got["skills_disabled"].([]any); !ok || len(d) != 0 {
		t.Errorf("skills_disabled must be a list: %v", got["skills_disabled"])
	}

	// A web search key: its backend for search and extract, its key in the
	// worker's environment.
	webBackend, webEnv = "exa", map[string]string{"EXA_API_KEY": "exa-test-key"}
	got, spec = render()
	if w := got["web"].(map[string]any); w["search_backend"] != "exa" || w["extract_backend"] != "exa" {
		t.Errorf("web = %v", w)
	}
	if spec.ToolKeys["EXA_API_KEY"] != "exa-test-key" {
		t.Errorf("tool keys = %v", spec.ToolKeys)
	}
	if strings.Contains(string(spec.Settings), "exa-test-key") {
		t.Error("the web key is in the rendered settings")
	}
	// A key that cannot be read is no key.
	webErr = errors.New("cipher: message authentication failed")
	got, spec = render()
	if w := got["web"].(map[string]any); w["search_backend"] != "timely" || spec.ToolKeys != nil {
		t.Errorf("unreadable key: web %v, keys %v", w, spec.ToolKeys)
	}
}

// Deleting an account removes its agent home (the worker stopped first);
// what the agent learned goes with the user row.
func TestIntegrationAccountDeletionRemovesTheAgentHomeAndLearning(t *testing.T) {
	db, uid := agentToolsDB(t)
	for _, q := range []string{
		`INSERT INTO agent_learning_settings (user_id, learning) VALUES (?, false)`,
		`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, status) VALUES ('ale_delete', ?, 'w-1', 'skill', 'applied')`,
	} {
		if err := db.Exec(q, uid).Error; err != nil {
			t.Fatal(err)
		}
	}
	sup := agenthost.New(agenthost.Config{Root: filepath.Join(t.TempDir(), "agent"), Logf: t.Logf})
	t.Cleanup(func() { _ = sup.Shutdown(context.Background()) })
	home := sup.Layout().Home(uid)
	other := sup.Layout().Home("usr_someone_else")
	for _, dir := range []string{filepath.Join(home, "memories"), filepath.Join(other, "memories")} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "USER.md"), []byte("entry"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if err := db.Exec(`DELETE FROM users WHERE id = ?`, uid).Error; err != nil {
		t.Fatal(err)
	}
	afterAgentAccountDelete(sup)(uid)

	if _, err := os.Stat(home); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the agent home is still there: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("another account's home went too: %v", err)
	}
	if entries, _ := os.ReadDir(sup.Layout().Trash()); len(entries) != 0 {
		t.Errorf("left in .trash: %d", len(entries))
	}
	for _, table := range []string{"agent_learning_settings", "agent_learning_events"} {
		var n int64
		if err := db.Table(table).Where("user_id = ?", uid).Count(&n).Error; err != nil || n != 0 {
			t.Errorf("%s: %d rows left (%v)", table, n, err)
		}
	}
	// No worker starts for a deleted account.
	if _, err := sup.Ensure(context.Background(), uid); !errors.Is(err, agenthost.ErrAccountRemoved) {
		t.Errorf("Ensure after deletion: %v", err)
	}
}

// The no-persist switch and the clarify timeout are test switches: read
// only with DB_SCHEMA set, so a shipped API never turns Sensitive chats onto
// the agent engine (Q-4.2) or shortens a question card's wait.
func TestPhase4TestSwitchesNeedASchema(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(name string) string { return values[name] }
	}
	for name, values := range map[string]map[string]string{
		"neither":     {},
		"flag only":   {"TIMELY_AGENT_SENSITIVE_NO_PERSIST": "1", "TIMELY_AGENT_CLARIFY_TIMEOUT_S": "5"},
		"schema only": {"DB_SCHEMA": "wt_phase4"},
		"bad values":  {"DB_SCHEMA": "wt_phase4", "TIMELY_AGENT_SENSITIVE_NO_PERSIST": "maybe", "TIMELY_AGENT_CLARIFY_TIMEOUT_S": "0"},
		"too long":    {"DB_SCHEMA": "wt_phase4", "TIMELY_AGENT_CLARIFY_TIMEOUT_S": "86401"},
	} {
		if sensitiveNoPersist(env(values)) {
			t.Errorf("%s: Sensitive chats would run on the agent engine", name)
		}
		if d := clarifyTimeout(env(values)); d != 0 {
			t.Errorf("%s: clarify timeout %s, want the default", name, d)
		}
	}
	on := env(map[string]string{"DB_SCHEMA": "wt_phase4", "TIMELY_AGENT_SENSITIVE_NO_PERSIST": "true", "TIMELY_AGENT_CLARIFY_TIMEOUT_S": "5"})
	if !sensitiveNoPersist(on) || clarifyTimeout(on) != 5*time.Second {
		t.Fatalf("with a schema: no-persist %v, timeout %s", sensitiveNoPersist(on), clarifyTimeout(on))
	}
}

// The engine's Model asks the provider service for the run's kind: a
// Sensitive run needs the gateway even for an API-key provider, so without
// one it is refused with the gateway's reason (phase 4 decision 11).
func TestAgentRunModelPassesSensitive(t *testing.T) {
	model := agentRunModel(provider.New(nil, nil, nil))
	_, err := model(context.Background(), "user-a", "openrouter", "m", chat.RunModelOptions{Sensitive: true})
	if !errors.Is(err, provider.ErrAgentEngineUnsupported) || !strings.Contains(err.Error(), "Sensitive") {
		t.Fatalf("Sensitive run without the gateway: %v", err)
	}
	_, err = model(context.Background(), "user-a", provider.ClaudeCLI, "sonnet", chat.RunModelOptions{})
	if !errors.Is(err, provider.ErrAgentEngineUnsupported) || strings.Contains(err.Error(), "Sensitive") {
		t.Fatalf("Claude Code without the gateway: %v", err)
	}
}
