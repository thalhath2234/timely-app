package provider

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
)

// noNetwork fails every request: these tests never reach a provider.
type noNetwork struct{ t *testing.T }

func (n noNetwork) RoundTrip(r *http.Request) (*http.Response, error) {
	n.t.Errorf("a test tried to reach %s", r.URL.Host)
	return nil, errors.New("no network in tests")
}

// agentTestService is a Service without a database: keys are sealed with a
// stand-in secret, and the model catalogue cannot reach the network.
func agentTestService(t *testing.T) *Service {
	t.Helper()
	s := &Service{
		models:        newCatalogue(),
		key:           sha256.Sum256([]byte("timely-agent-provider:stand-in-secret")),
		openRouterURL: "https://openrouter.ai/api/v1/chat/completions",
	}
	s.models.client = &http.Client{Transport: noNetwork{t}}
	return s
}

func sealed(t *testing.T, s *Service, key string) string {
	t.Helper()
	if key == "" {
		return ""
	}
	out, err := s.encrypt(key)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAgentModelCoversEveryAPIKeyProvider(t *testing.T) {
	s := agentTestService(t)
	for _, spec := range apiProviders {
		t.Run(spec.ID, func(t *testing.T) {
			model := "stand-in-model"
			if len(spec.Defaults) > 0 && !strings.HasSuffix(spec.Defaults[0], "*") {
				model = spec.Defaults[0]
			}
			if spec.Anthropic {
				s.models.effort[model] = true
			}
			key := "sk-stand-in-" + spec.ID
			got, err := s.apiAgentModel(spec, APIKey{Provider: spec.ID, Key: sealed(t, s, key), Model: model}, "")
			if err != nil {
				t.Fatalf("AgentModel: %v", err)
			}
			if got.Model != model || got.APIKey != key || got.BaseURL == "" || got.Provider == "" {
				t.Errorf("model = %+v", got)
			}
			if want := modeForRoute[spec.route(model)]; got.APIMode != want {
				t.Errorf("api_mode %q, want %q", got.APIMode, want)
			}
			if strings.Contains(got.String(), key) || strings.Contains(fmt.Sprintf("%v %#v", got, got), key) {
				t.Errorf("String shows the key: %s", got)
			}
		})
	}
}

func TestAgentModelMapsRoutesToHermesModes(t *testing.T) {
	s := agentTestService(t)
	s.models.effort["claude-haiku-5-5"] = true
	s.models.effort["claude-old-3"] = false
	type want struct{ provider, base, mode string }
	cases := []struct {
		spec, base, model string
		want              want
		reasoning         string
	}{
		{"anthropic", "", "claude-haiku-5-5", want{"anthropic", "https://api.anthropic.com", apiModeMessages}, `{"effort":"low","enabled":true}`},
		{"anthropic", "", "claude-old-3", want{"anthropic", "https://api.anthropic.com", apiModeMessages}, `{"enabled":false}`},
		{"openai", "", "gpt-5-mini", want{"openai-api", "https://api.openai.com/v1", apiModeResponses}, ``},
		{"gemini", "", "gemini-3-flash", want{"gemini", "https://generativelanguage.googleapis.com/v1beta/openai", apiModeChat}, ``},
		{"deepseek", "", "deepseek-v4-flash", want{"deepseek", "https://api.deepseek.com", apiModeChat}, `{"enabled":false}`},
		{"xai", "", "grok-4.7", want{"xai", "https://api.x.ai/v1", apiModeChat}, ``},
		{"mistral", "", "mistral-medium-latest", want{"custom", "https://api.mistral.ai/v1", apiModeChat}, ``},
		{"zai", "https://open.bigmodel.cn/api/paas/v4", "glm-5.3", want{"zai", "https://open.bigmodel.cn/api/paas/v4", apiModeChat}, ``},
		{"kimi", "", "kimi-k3", want{"kimi-coding", "https://api.moonshot.ai/v1", apiModeChat}, ``},
		{"kimi", "https://api.moonshot.cn/v1", "kimi-k3", want{"kimi-coding-cn", "https://api.moonshot.cn/v1", apiModeChat}, ``},
		{"nvidia", "", "qwen/qwen3.8-max", want{"nvidia", "https://integrate.api.nvidia.com/v1", apiModeChat}, ``},
		{"opencode-zen", "", "gpt-5", want{"opencode-zen", "https://opencode.ai/zen/v1", apiModeResponses}, ``},
		{"opencode-zen", "", "claude-sonnet-5", want{"opencode-zen", "https://opencode.ai/zen", apiModeMessages}, ``},
		{"opencode-zen", "", "glm-5.3", want{"opencode-zen", "https://opencode.ai/zen/v1", apiModeChat}, ``},
		{"opencode-go", "", "minimax-m3", want{"opencode-go", "https://opencode.ai/zen/go", apiModeMessages}, ``},
		{"ollama", "", "llama4", want{"custom", "http://localhost:11434/v1", apiModeChat}, ``},
		{"ollama", "https://ollama.com", "gpt-oss:120b", want{"ollama-cloud", "https://ollama.com/v1", apiModeChat}, ``},
	}
	for _, tc := range cases {
		t.Run(tc.spec+" "+tc.model, func(t *testing.T) {
			spec := apiProviderByID(tc.spec)
			got, err := s.apiAgentModel(spec, APIKey{Provider: tc.spec, Key: sealed(t, s, "sk-stand-in"), BaseURL: tc.base}, tc.model)
			if err != nil {
				t.Fatal(err)
			}
			if got.Provider != tc.want.provider || got.BaseURL != tc.want.base || got.APIMode != tc.want.mode || got.Model != tc.model {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
			reasoning := ""
			if got.Reasoning != nil {
				raw, _ := json.Marshal(got.Reasoning)
				reasoning = string(raw)
			}
			if reasoning != tc.reasoning {
				t.Errorf("reasoning %s, want %s", reasoning, tc.reasoning)
			}
		})
	}
}

func TestAgentModelRefusesWhatClassicRefuses(t *testing.T) {
	s := agentTestService(t)
	zen := apiProviderByID("opencode-zen")
	if _, err := s.apiAgentModel(zen, APIKey{Key: sealed(t, s, "sk-x")}, "gemini-3-pro"); err == nil || !strings.Contains(err.Error(), "protocol Timely does not support") {
		t.Errorf("hidden route: %v", err)
	}
	if _, err := s.apiAgentModel(apiProviderByID("openai"), APIKey{}, "gpt-5"); err == nil || !strings.Contains(err.Error(), "Add an OpenAI API key") {
		t.Errorf("no key: %v", err)
	}
	if _, err := s.apiAgentModel(apiProviderByID("openai"), APIKey{Key: sealed(t, s, "sk-x")}, ""); err == nil || !strings.Contains(err.Error(), "Choose a OpenAI API model") {
		t.Errorf("no model: %v", err)
	}
	if _, err := s.apiAgentModel(apiProviderByID("openai"), APIKey{Key: "not-sealed-by-this-server"}, "gpt-5"); err == nil {
		t.Error("an unreadable key passed")
	}

	// Ollama without a key gets Hermes' placeholder, never an empty key.
	got, err := s.apiAgentModel(apiProviderByID("ollama"), APIKey{Model: "llama4"}, "")
	if err != nil || got.APIKey != keylessPlaceholder {
		t.Errorf("keyless Ollama = %+v, %v", got, err)
	}
	// A typed Ollama address stays classic while sign-ups are open: the
	// worker has no public-address guard.
	typed := APIKey{Model: "llama4", BaseURL: "http://192.168.1.20:11434"}
	if _, err := s.apiAgentModel(apiProviderByID("ollama"), typed, ""); !errors.Is(err, ErrAgentEngineUnsupported) || !strings.Contains(err.Error(), "Ollama address") {
		t.Errorf("typed Ollama on an open server: %v", err)
	}
	s.privateOllama = true
	if got, err := s.apiAgentModel(apiProviderByID("ollama"), typed, ""); err != nil || got.BaseURL != "http://192.168.1.20:11434/v1" {
		t.Errorf("typed Ollama on a closed server = %+v, %v", got, err)
	}
}

func TestAgentModelOpenRouterDirect(t *testing.T) {
	s := agentTestService(t)
	s.envChat = "z-ai/glm-5.3-flash"
	row := Settings{UserID: "u", OpenRouterKey: sealed(t, s, "sk-or-stand-in"), OpenRouterChatModel: "moonshotai/kimi-k3"}
	got, err := s.openRouterAgentModel(row, "")
	if err != nil {
		t.Fatal(err)
	}
	want := AgentModel{Provider: "openrouter", Model: "moonshotai/kimi-k3", BaseURL: "https://openrouter.ai/api/v1",
		APIKey: "sk-or-stand-in", APIMode: apiModeChat}
	if got.Provider != want.Provider || got.Model != want.Model || got.BaseURL != want.BaseURL || got.APIKey != want.APIKey || got.APIMode != want.APIMode ||
		got.Reasoning["effort"] != "low" {
		t.Errorf("got %+v", got)
	}
	if got, _ := s.openRouterAgentModel(row, "openai/gpt-6-luna"); got.Model != "openai/gpt-6-luna" {
		t.Errorf("the run's model was not kept: %+v", got)
	}
	if _, err := s.openRouterAgentModel(Settings{UserID: "u"}, "x"); err == nil || !strings.Contains(err.Error(), "OpenRouter API key") {
		t.Errorf("no key: %v", err)
	}
	raw, _ := json.Marshal(got)
	for _, field := range []string{`"provider"`, `"model"`, `"base_url"`, `"api_key"`, `"api_mode"`, `"reasoning"`} {
		if !strings.Contains(string(raw), field) {
			t.Errorf("run.start model JSON %s lacks %s", raw, field)
		}
	}
}

func TestAgentModelLeavesCLIProvidersOnClassic(t *testing.T) {
	s := agentTestService(t) // no database: these answers come before any read
	for _, p := range []string{ClaudeCLI, CodexCLI} {
		_, err := s.AgentModel(context.Background(), "u", p, "")
		if !errors.Is(err, ErrAgentEngineUnsupported) || err.Error() != "The model gateway is not running, so Claude Code and Codex use the classic engine" {
			t.Errorf("%s: %v", p, err)
		}
	}
	if _, err := s.AgentModel(context.Background(), "u", "", "m"); err == nil || errors.Is(err, ErrAgentEngineUnsupported) {
		t.Errorf("no provider: %v", err)
	}
	if _, err := s.AgentModel(context.Background(), "u", "made-up", "m"); err == nil || !strings.Contains(err.Error(), "Unknown AI provider") {
		t.Errorf("unknown provider: %v", err)
	}
}

// TestAgentModelNamesMatchTheVendoredHermes checks every api_mode and provider
// id Timely sends against the vendored Hermes source, so a sync that renames
// one fails here.
func TestAgentModelNamesMatchTheVendoredHermes(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "agent", "hermes")
	runtime, err := os.ReadFile(filepath.Join(root, "hermes_cli", "runtime_provider.py"))
	if err != nil {
		t.Skipf("vendored Hermes not found: %v", err)
	}
	auth, err := os.ReadFile(filepath.Join(root, "hermes_cli", "auth.py"))
	if err != nil {
		t.Fatal(err)
	}
	modesLine := regexp.MustCompile(`(?m)^_VALID_API_MODES = \{([^}]*)\}`).FindSubmatch(runtime)
	if modesLine == nil {
		t.Fatal("_VALID_API_MODES not found in runtime_provider.py")
	}
	for _, mode := range modeForRoute {
		if !strings.Contains(string(modesLine[1]), `"`+mode+`"`) {
			t.Errorf("api_mode %q is not in Hermes' _VALID_API_MODES (%s)", mode, modesLine[1])
		}
	}
	ids := map[string]bool{"openrouter": true, "custom": true}
	for _, m := range regexp.MustCompile(`(?m)^\s+\("([a-z0-9-]+)", "`).FindAllSubmatch(auth, -1) {
		ids[string(m[1])] = true
	}
	if !strings.Contains(string(auth), `"ollama": "custom"`) {
		t.Error(`Hermes no longer maps "ollama" to "custom"`)
	}
	for _, spec := range apiProviders {
		var bases []string
		for _, e := range spec.Endpoints {
			bases = append(bases, e.BaseURL)
		}
		for _, base := range bases {
			if id := hermesProvider(spec.ID, base); !ids[id] {
				t.Errorf("%s at %s maps to Hermes provider %q, which Hermes does not register", spec.ID, base, id)
			}
		}
	}
}

// TestIntegrationAgentModel reads stored stand-in keys from PostgreSQL
// (make test-chat-integration): the account's own rows, decrypted, and never
// another account's.
func TestIntegrationAgentModel(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	s.models.client = &http.Client{Transport: noNetwork{t}}
	ctx := context.Background()
	if err := s.saveAPIRow(&APIKey{UserID: "user-a", Provider: "openai", Key: sealed(t, s, "sk-openai-stand-in"), KeyHint: "…t-in", Model: "gpt-5-mini"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.update("user-a", func(row *Settings) error {
		row.OpenRouterKey = sealed(t, s, "sk-or-stand-in")
		row.OpenRouterChatModel = "moonshotai/kimi-k3"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	got, err := s.AgentModel(ctx, "user-a", "openai", "")
	if err != nil || got.APIKey != "sk-openai-stand-in" || got.Model != "gpt-5-mini" || got.APIMode != apiModeResponses || got.Provider != "openai-api" {
		t.Fatalf("openai = %v, %v", got, err)
	}
	got, err = s.AgentModel(ctx, "user-a", OpenRouter, "")
	if err != nil || got.APIKey != "sk-or-stand-in" || got.Model != "moonshotai/kimi-k3" || got.BaseURL != "https://openrouter.ai/api/v1" {
		t.Fatalf("openrouter = %v, %v", got, err)
	}
	if _, err := s.AgentModel(ctx, "user-b", "openai", ""); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("another account's key was used: %v", err)
	}
	if _, err := s.AgentModel(ctx, "user-b", OpenRouter, "x"); err == nil || !strings.Contains(err.Error(), "OpenRouter API key") {
		t.Fatalf("another account's OpenRouter key was used: %v", err)
	}
	if _, err := s.AgentModel(ctx, "user-a", "anthropic", ""); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("no fallback to another provider: %v", err)
	}
}

// Q-4.1: every provider id Timely can put in run.start is an API-key row of
// Hermes' registry, "openrouter" or "custom"; none is an OAuth provider, so
// Hermes never signs in for the person. The walk covers every registry entry
// at every listed endpoint and every route, OpenRouter, both CLIs and a
// Sensitive run on each.
func TestAgentModelSendsNoOAuthProvider(t *testing.T) {
	s := agentTestService(t)
	s.privateOllama = true
	oauth := map[string]bool{"nous": true, "openai-codex": true, "xai-oauth": true, "qwen-oauth": true, "minimax-oauth": true,
		"copilot": true, "copilot-acp": true, "google-gemini-cli": true}
	if auth, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "agent", "hermes", "hermes_cli", "auth.py")); err == nil {
		// Every OAuth row in the vendored Hermes, so a sync that adds one is
		// checked too.
		for _, m := range regexp.MustCompile(`ProviderConfig\(\s*"([a-z0-9-]+)",\s*"[^"]*",\s*"(oauth[a-z_]*|external_process)"`).FindAllSubmatch(auth, -1) {
			oauth[string(m[1])] = true
		}
	}
	for id := range agentProviderIDs {
		if oauth[id] {
			t.Errorf("the allowlist holds the OAuth provider %q", id)
		}
	}
	seen := map[string]bool{}
	check := func(where string, m AgentModel) {
		t.Helper()
		seen[m.Provider] = true
		if !agentProviderIDs[m.Provider] || oauth[m.Provider] {
			t.Errorf("%s sends Hermes provider %q", where, m.Provider)
		}
	}
	for _, spec := range apiProviders {
		bases := []string{""}
		for _, e := range spec.Endpoints {
			bases = append(bases, e.BaseURL)
		}
		models := []string{"stand-in-model", "gpt-5", "claude-sonnet-5", "glm-5.3", "minimax-m3"}
		for _, model := range models {
			s.models.effort[model] = false // Anthropic's effort probe stays off the network
		}
		for _, base := range bases {
			if id := hermesProvider(spec.ID, base); !agentProviderIDs[id] {
				t.Errorf("hermesProvider(%s, %q) = %q, not allowlisted", spec.ID, base, id)
			}
			for _, model := range models {
				m, err := s.apiAgentModel(spec, APIKey{Provider: spec.ID, Key: sealed(t, s, "sk-stand-in"), BaseURL: base}, model)
				if err != nil {
					continue // a route Timely does not run (checked elsewhere)
				}
				check(spec.ID+" "+base+" "+model, m)
			}
		}
	}
	m, err := s.openRouterAgentModel(Settings{UserID: "u", OpenRouterKey: sealed(t, s, "sk-or-stand-in")}, "x/y")
	if err != nil {
		t.Fatal(err)
	}
	check("openrouter", m)

	fake := &gatewayFake{reply: chat.WireMessage{Role: "assistant", Content: "Hi."}}
	g, err := newGateway(func(context.Context, string, string, string) (chat.Completer, error) { return fake, nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close(context.Background()) })
	s.gateway = g
	for _, p := range []string{ClaudeCLI, CodexCLI, OpenRouter} {
		for _, sensitive := range []bool{false, true} {
			if p == OpenRouter && !sensitive {
				continue // direct: covered above, and it needs the database
			}
			m, err := s.AgentModelFor(context.Background(), "u", p, "m", AgentRunOptions{Sensitive: sensitive})
			if err != nil {
				t.Fatalf("%s sensitive=%v: %v", p, sensitive, err)
			}
			check(p, m)
		}
	}
	for _, want := range []string{"custom", "openrouter", "anthropic", "openai-api", "kimi-coding", "ollama-cloud"} {
		if !seen[want] {
			t.Errorf("the walk never produced %q; is it still reachable?", want)
		}
	}
}

// Q-4.1: a Claude Code sign-in token (sk-ant-oat...) is not an Anthropic API
// key. Saving one is refused before anything is stored or sent, and a run
// with one already stored never reaches the worker.
func TestAnthropicSignInTokenIsRefused(t *testing.T) {
	const token = "sk-ant-oat01-stand-in-token-value"
	s := agentTestService(t)
	s.models.effort["claude-sonnet-5"] = true
	if _, err := s.apiAgentModel(apiProviderByID("anthropic"), APIKey{Key: sealed(t, s, token), Model: "claude-sonnet-5"}, ""); !errors.Is(err, errSignInToken) {
		t.Errorf("AgentModel with a stored sign-in token: %v", err)
	}
	if _, err := s.apiAgentModel(apiProviderByID("anthropic"), APIKey{Key: sealed(t, s, "sk-ant-api03-stand-in"), Model: "claude-sonnet-5"}, ""); err != nil {
		t.Errorf("a real API key was refused: %v", err)
	}

	e := echo.New()
	s.Routes(e.Group("")) // no database: the token is refused before any read
	for _, key := range []string{token, "  " + token + "\n"} {
		body, _ := json.Marshal(map[string]string{"key": key})
		req := httptest.NewRequest(http.MethodPost, "/agent/providers/anthropic/key", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Claude Code sign-in token, not an API key") {
			t.Errorf("saving %q: %d %s", key, rec.Code, rec.Body.String())
		}
	}
}

// TestIntegrationAgentModelForSensitive reads stored stand-in keys
// (make test-chat-integration): a Sensitive run on an API-key provider or
// OpenRouter gets the gateway with the account's model, an ordinary run the
// provider direct, and a stored Claude Code sign-in token is refused either
// way (Q-4.1).
func TestIntegrationAgentModelForSensitive(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	s.models.client = &http.Client{Transport: noNetwork{t}}
	s.models.effort["claude-sonnet-5"] = true
	ctx := context.Background()
	for _, row := range []APIKey{
		{UserID: "user-a", Provider: "deepseek", Key: sealed(t, s, "sk-deepseek-stand-in"), KeyHint: "…t-in", Model: "deepseek-v4-flash"},
		{UserID: "user-a", Provider: "anthropic", Key: sealed(t, s, "sk-ant-oat01-stand-in-token"), KeyHint: "…oken", Model: "claude-sonnet-5"},
	} {
		if err := s.saveAPIRow(&row); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.update("user-a", func(row *Settings) error {
		row.OpenRouterKey = sealed(t, s, "sk-or-stand-in")
		row.OpenRouterChatModel = "moonshotai/kimi-k3"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	g, err := s.StartAgentGateway()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close(context.Background()) })

	direct, err := s.AgentModel(ctx, "user-a", "deepseek", "")
	if err != nil || direct.Provider != "deepseek" || direct.APIKey != "sk-deepseek-stand-in" {
		t.Fatalf("ordinary deepseek = %v, %v", direct, err)
	}
	for p, model := range map[string]string{"deepseek": "deepseek-v4-flash", OpenRouter: "moonshotai/kimi-k3"} {
		m, err := s.AgentModelFor(ctx, "user-a", p, "", AgentRunOptions{Sensitive: true})
		if err != nil {
			t.Fatalf("Sensitive %s: %v", p, err)
		}
		if m.Provider != "custom" || m.BaseURL != g.BaseURL() || m.Model != model || !strings.HasPrefix(m.APIKey, "tgw-") || m.Reasoning != nil {
			t.Fatalf("Sensitive %s did not get the gateway: %v", p, m)
		}
		who, ok := g.grants[m.APIKey]
		if !ok || !who.sensitive || who.provider != p || who.uid != "user-a" {
			t.Fatalf("Sensitive %s grant %+v", p, who)
		}
	}
	if _, err := s.AgentModelFor(ctx, "user-b", "deepseek", "", AgentRunOptions{Sensitive: true}); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("another account's key served a Sensitive run: %v", err)
	}
	for _, sensitive := range []bool{false, true} {
		if _, err := s.AgentModelFor(ctx, "user-a", "anthropic", "", AgentRunOptions{Sensitive: sensitive}); !errors.Is(err, errSignInToken) {
			t.Errorf("stored sign-in token, sensitive=%v: %v", sensitive, err)
		}
	}
}
