package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
	"timely-api/internal/jobs"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func integrationDB(t *testing.T) *gorm.DB {
	t.Helper()
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
	schema := "provider_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); db.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.AutoMigrate(&models.User{}, &chat.Conversation{}, &models.Job{}); err != nil {
		t.Fatal(err)
	}
	// The settings table comes from the real migration so column names are
	// checked against the GORM model; the conversation columns already exist.
	migration, err := os.ReadFile("../../../migrations/20261001120000_agent_providers.sql")
	if err != nil {
		t.Fatal(err)
	}
	up := strings.Split(string(migration), "-- +goose Down")[0]
	if err = db.Exec(strings.Split(up, "ALTER TABLE")[0]).Error; err != nil {
		t.Fatal(err)
	}
	keys, err := os.ReadFile("../../../migrations/20261006120000_agent_api_keys.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(strings.Split(string(keys), "-- +goose Down")[0]).Error; err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{"user-a", "user-b"} {
		if err = db.Exec("INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)", uid, uid, uid+"@example.com", "x").Error; err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func call(t *testing.T, s *Service, userID, method, path string, body any) (int, map[string]any) {
	t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", userID)
			return next(c)
		}
	})
	s.Routes(e.Group(""))
	var reader *strings.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = strings.NewReader(string(raw))
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestIntegrationProviderSettingsFlow(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	// A server-wide key is ignored: only keys an account saves are used.
	t.Setenv("OPENROUTER_API_KEY", "sk-or-v1-goodkey")
	t.Setenv("CHAT_LOCAL_CLI", "")

	// A fake OpenRouter accepts only one key so the stored secret is exercised end to end.
	var seenModel string
	openrouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-or-v1-goodkey" {
			w.WriteHeader(401)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		seenModel, _ = body["model"].(string)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`))
	}))
	defer openrouter.Close()
	claudeBin, _ := fakeCLI(t, "claude", `case "$1" in
--version) echo "2.1.0 (Claude Code)";;
auth) echo '{"loggedIn":true,"email":"me@example.com","subscriptionType":"max"}';;
*) echo '{"type":"result","subtype":"success","is_error":false,"result":"OK","structured_output":{"content":"OK","toolCalls":[]}}';;
esac`)
	t.Setenv("CLAUDE_BIN", claudeBin)
	t.Setenv("CODEX_BIN", "/nonexistent/codex")

	s := New(db, nil, jobs.NewQueue(db))
	s.openRouterURL = openrouter.URL

	// No key anywhere: runs must fail loudly, never fall back.
	if _, err := s.Completer(context.Background(), "user-a", "", ""); err == nil || !strings.Contains(err.Error(), "OpenRouter API key") {
		t.Fatalf("missing key must be explained: %v", err)
	}
	if _, body := call(t, s, "user-a", http.MethodGet, "/agent/providers", nil); body["openrouter"].(map[string]any)["ready"] != false {
		t.Fatal("a server env key must not make OpenRouter ready")
	}
	if key, _ := s.embedCredentials("user-a"); key != "" {
		t.Fatal("embeddings must not use a server env key")
	}
	if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/openrouter/key", map[string]string{"key": "sk-or-v1-badkey"}); code != 409 {
		t.Fatalf("bad key accepted: %d %v", code, body)
	}
	code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/openrouter/key", map[string]string{"key": "sk-or-v1-goodkey"})
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	or := body["openrouter"].(map[string]any)
	if or["keySet"] != true || or["keyHint"] != "…dkey" || or["ready"] != true {
		t.Fatalf("key view wrong: %v", or)
	}
	if raw, _ := json.Marshal(body); strings.Contains(string(raw), "goodkey") {
		t.Fatal("the key must never be returned")
	}
	var stored Settings
	if err := db.First(&stored, "user_id = ?", "user-a").Error; err != nil || stored.OpenRouterKey == "" || strings.Contains(stored.OpenRouterKey, "goodkey") {
		t.Fatalf("key must be stored encrypted: %+v %v", stored, err)
	}
	var jobs []models.Job
	db.Where("user_id = ? AND kind = ?", "user-a", models.JobReindexUser).Find(&jobs)
	if len(jobs) != 1 {
		t.Fatalf("a key change must queue one re-index, got %d", len(jobs))
	}

	// Another account sees nothing of user-a's key.
	if _, body := call(t, s, "user-b", http.MethodGet, "/agent/providers", nil); body["openrouter"].(map[string]any)["keySet"] != false {
		t.Fatal("keys must be account-scoped")
	}

	// Model choice is verified by a test call.
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"openrouterChatModel": "bad model"}); code != 400 {
		t.Fatalf("%d %v", code, body)
	}
	if code, _ := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"openrouterChatModel": "openai/gpt-5.5"}); code != 200 || seenModel != "openai/gpt-5.5" {
		t.Fatalf("model must be test-called: %d %q", code, seenModel)
	}
	provider, model, err := s.Resolve(context.Background(), "user-a")
	if err != nil || provider != OpenRouter || model != "openai/gpt-5.5" {
		t.Fatalf("%s %s %v", provider, model, err)
	}

	// Claude: default cannot switch before Connect; Connect runs a test call.
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"defaultProvider": ClaudeCLI}); code != 409 {
		t.Fatalf("unconnected provider became default: %d %v", code, body)
	}
	if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/codex/connect", nil); code != 409 || !strings.Contains(body["message"].(string), "Not found") {
		t.Fatalf("missing codex must be reported: %d %v", code, body)
	}
	code, body = call(t, s, "user-a", http.MethodPost, "/agent/providers/claude/connect", nil)
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	claude := body["claude"].(map[string]any)
	if claude["connected"] != true || claude["ready"] != true || claude["model"] != defaultClaudeModel {
		t.Fatalf("claude view wrong: %v", claude)
	}
	if code, _ := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"defaultProvider": ClaudeCLI, "claudeModel": "opus"}); code != 200 {
		t.Fatal(code)
	}
	provider, model, err = s.Resolve(context.Background(), "user-a")
	if err != nil || provider != ClaudeCLI || model != "opus" {
		t.Fatalf("%s %s %v", provider, model, err)
	}
	completer, err := s.Completer(context.Background(), "user-a", provider, model)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := completer.(*Claude); !ok {
		t.Fatalf("expected Claude completer, got %T", completer)
	}
	// A run that started on OpenRouter keeps it even though the default is now Claude.
	completer, err = s.Completer(context.Background(), "user-a", OpenRouter, "openai/gpt-5.5")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := completer.(*chat.OpenRouter); !ok {
		t.Fatalf("expected OpenRouter completer, got %T", completer)
	}
	// Removing the key leaves no fallback for OpenRouter.
	if code, _ := call(t, s, "user-a", http.MethodDelete, "/agent/providers/openrouter/key", nil); code != 200 {
		t.Fatal(code)
	}
	if _, err := s.Completer(context.Background(), "user-a", OpenRouter, ""); err == nil {
		t.Fatal("removed key must not keep working")
	}
	// Disconnecting the default provider falls back to OpenRouter as the default choice.
	if _, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/claude/disconnect", nil); body["defaultProvider"] != OpenRouter {
		t.Fatalf("%v", body)
	}
	if _, err := s.Completer(context.Background(), "user-a", ClaudeCLI, "opus"); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("disconnected CLI must refuse: %v", err)
	}

	// Local CLIs can be switched off for shared instances.
	t.Setenv("CHAT_LOCAL_CLI", "off")
	shared := New(db, nil, nil)
	if code, _ := call(t, shared, "user-a", http.MethodPost, "/agent/providers/claude/connect", nil); code != 409 {
		t.Fatal(code)
	}
	if _, body := call(t, shared, "user-a", http.MethodGet, "/agent/providers", nil); body["localCli"] != false {
		t.Fatal("localCli must be reported off")
	}
}

func TestIntegrationDirectAPIProviders(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("OLLAMA_BASE_URL", "")

	// A fake Ollama: lists two tool-calling models without a key and answers chat calls.
	var seenModel string
	ollama := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"qwen3:8b"},{"name":"llama3.2:3b"}]}`))
		case "/api/show":
			_, _ = w.Write([]byte(`{"capabilities":["completion","tools"]}`))
		case "/api/chat":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			seenModel, _ = body["model"].(string)
			_, _ = w.Write([]byte(`{"message":{"role":"assistant","content":"OK"},"done":true}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer ollama.Close()
	// A fake Anthropic that accepts one key.
	anthropicAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Api-Key") != "sk-ant-goodkey" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"type":"model","id":"claude-haiku-4-5","display_name":"Claude Haiku 4.5","created_at":"2025-10-01T00:00:00Z"},{"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5","created_at":"2026-09-01T00:00:00Z"}],"has_more":false}`))
	}))
	defer anthropicAPI.Close()

	s := New(db, nil, jobs.NewQueue(db))
	s.anthropicURL = anthropicAPI.URL
	apiView := func(body map[string]any, id string) map[string]any {
		for _, item := range body["apiProviders"].([]any) {
			if view := item.(map[string]any); view["id"] == id {
				return view
			}
		}
		t.Fatalf("%s missing from %v", id, body["apiProviders"])
		return nil
	}

	// Ollama needs no key; a typed address is allowed and checked by listing models.
	code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/ollama/key", map[string]string{"baseUrl": ollama.URL})
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	view := apiView(body, "ollama")
	if view["connected"] != true || view["ready"] != true || view["model"] != "llama3.2:3b" || view["keySet"] != false {
		t.Fatalf("ollama view wrong: %v", view)
	}
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]any{"defaultProvider": "ollama"}); code != 200 || seenModel != "llama3.2:3b" {
		t.Fatalf("making it default must run a test call: %d %v %q", code, body, seenModel)
	}
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]any{"models": map[string]string{"ollama": "qwen3:8b"}}); code != 200 || seenModel != "qwen3:8b" {
		t.Fatalf("model change must run a test call: %d %v %q", code, body, seenModel)
	}
	provider, model, err := s.Resolve(context.Background(), "user-a")
	if err != nil || provider != "ollama" || model != "qwen3:8b" {
		t.Fatalf("%s %s %v", provider, model, err)
	}
	completer, err := s.Completer(context.Background(), "user-a", provider, model)
	if err != nil {
		t.Fatal(err)
	}
	if c, ok := completer.(*Ollama); !ok || c.Base != ollama.URL {
		t.Fatalf("expected Ollama on the typed address, got %#v", completer)
	}
	if code, body := call(t, s, "user-a", http.MethodGet, "/agent/providers/ollama/models", nil); code != 200 {
		t.Fatalf("%d %v", code, body)
	}

	// Hosted providers refuse typed addresses and malformed keys.
	if code, _ := call(t, s, "user-a", http.MethodPost, "/agent/providers/deepseek/key", map[string]string{"key": "sk-123456789", "baseUrl": "http://169.254.169.254/latest"}); code != 400 {
		t.Fatalf("hosted provider took a typed address: %d", code)
	}
	if code, _ := call(t, s, "user-a", http.MethodPost, "/agent/providers/deepseek/key", map[string]string{"key": "short"}); code != 400 {
		t.Fatalf("short key accepted: %d", code)
	}
	if code, _ := call(t, s, "user-a", http.MethodPost, "/agent/providers/nope/key", map[string]string{"key": "sk-123456789"}); code != 404 {
		t.Fatalf("unknown provider: %d", code)
	}
	if code, _ := call(t, s, "user-a", http.MethodGet, "/agent/providers/deepseek/models", nil); code != 409 {
		t.Fatalf("models without a key: %d", code)
	}

	// Anthropic: a bad key is rejected with Anthropic's own message; a good one is stored encrypted.
	if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": "sk-ant-badkey"}); code != 409 || !strings.Contains(body["message"].(string), "invalid x-api-key") {
		t.Fatalf("bad key: %d %v", code, body)
	}
	code, body = call(t, s, "user-a", http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": "sk-ant-goodkey"})
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	if view := apiView(body, "anthropic"); view["keyHint"] != "…dkey" || view["model"] != "claude-opus-5-5" || view["search"] != true {
		t.Fatalf("anthropic view wrong: %v", view)
	}
	if raw, _ := json.Marshal(body); strings.Contains(string(raw), "goodkey") {
		t.Fatal("the key must never be returned")
	}
	var stored APIKey
	if err := db.First(&stored, "user_id = ? AND provider = ?", "user-a", "anthropic").Error; err != nil || stored.Key == "" || strings.Contains(stored.Key, "goodkey") {
		t.Fatalf("key must be stored encrypted: %+v %v", stored, err)
	}
	// An empty key keeps the saved one.
	if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": ""}); code != 200 || apiView(body, "anthropic")["keyHint"] != "…dkey" {
		t.Fatalf("empty key must keep the saved one: %d %v", code, body)
	}

	// Keys are account-scoped.
	if _, body := call(t, s, "user-b", http.MethodGet, "/agent/providers", nil); apiView(body, "anthropic")["connected"] != false || apiView(body, "ollama")["connected"] != false {
		t.Fatal("api keys must be account-scoped")
	}

	// Disconnecting the default resets it to OpenRouter and the provider stops working.
	if _, body := call(t, s, "user-a", http.MethodDelete, "/agent/providers/ollama/key", nil); body["defaultProvider"] != OpenRouter {
		t.Fatalf("%v", body)
	}
	if _, err := s.Completer(context.Background(), "user-a", "ollama", "qwen3:8b"); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("disconnected provider must refuse: %v", err)
	}
}
