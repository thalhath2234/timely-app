package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Credentials for runs on the agent engine (plan 5.7, phase 2): the Hermes
// worker gets the run's model in run.start {provider, model, base_url,
// api_key, api_mode, reasoning}, the same arguments Hermes' own cron passes.
// Selection stays in Go (ADR 0019, ADR 0020): the chat fixes provider and
// model at claim and this only turns that pair into Hermes' terms, with the
// account's own decrypted key. There is no fallback to another provider.

// ErrAgentEngineUnsupported means the run's provider cannot drive the agent
// engine yet, so the chat stays on the classic engine. The host CLIs need the
// loopback model gateway (gateway.go) to be running.
var ErrAgentEngineUnsupported = errors.New("Claude Code and Codex use the classic engine until a later update")

// unsupportedError is ErrAgentEngineUnsupported with a reason of its own.
type unsupportedError struct{ reason string }

func (e unsupportedError) Error() string        { return e.reason }
func (e unsupportedError) Is(target error) bool { return target == ErrAgentEngineUnsupported }

// AgentModel is run.start's model object. APIKey is the account's own key in
// clear: it goes on the worker's stdin and nowhere else (String hides it).
type AgentModel struct {
	Provider string `json:"provider"` // Hermes' provider id (hermesProvider)
	Model    string `json:"model"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
	APIMode  string `json:"api_mode"` // chat_completions, codex_responses or anthropic_messages
	// Reasoning is Hermes' reasoning_config ({"enabled": false} or
	// {"enabled": true, "effort": "low"}, hermes:hermes_constants.py:1076-1100),
	// set where the classic engine sets one; nil leaves the provider's default.
	Reasoning map[string]any `json:"reasoning,omitempty"`
}

// String describes the model without its key, so a logged AgentModel never
// carries it.
func (m AgentModel) String() string {
	key := "none"
	if m.APIKey != "" {
		key = "set"
	}
	return fmt.Sprintf("{provider:%s model:%s base_url:%s api_mode:%s key:%s}", m.Provider, m.Model, m.BaseURL, m.APIMode, key)
}

// GoString is String, for %#v.
func (m AgentModel) GoString() string { return m.String() }

// Hermes api_mode names: hermes:hermes_cli/runtime_provider.py:135
// (_VALID_API_MODES). An explicit one is taken as given
// (hermes:agent/agent_init.py:288-304, _resolve_api_mode), ahead of every
// provider or host rule, so Timely's route decides the wire protocol.
// codex_responses is Hermes' OpenAI Responses transport for any provider, not
// only Codex (hermes:hermes_cli/runtime_provider.py:138-166, official OpenAI
// hosts need it for tool calls).
const (
	apiModeChat      = "chat_completions"
	apiModeResponses = "codex_responses"
	apiModeMessages  = "anthropic_messages"
)

// modeForRoute maps Timely's route (registry.go) to Hermes' api_mode. Ollama
// is served through its OpenAI-compatible /v1 endpoint (agentBase), so it
// speaks chat_completions.
var modeForRoute = map[string]string{
	routeChat:      apiModeChat,
	routeResponses: apiModeResponses,
	routeMessages:  apiModeMessages,
	routeOllama:    apiModeChat,
}

// keylessPlaceholder is the key Hermes itself sends to local servers that
// need none: the OpenAI SDK refuses an empty key
// (hermes:agent/auxiliary_client.py:2796-2799,
// hermes:hermes_cli/runtime_provider.py:1094).
const keylessPlaceholder = "no-key-required"

// hermesProvider names Timely's provider the way Hermes does, so Hermes
// applies its own per-provider handling (Gemini's thinking config on the
// /openai path, Kimi and DeepSeek reasoning replay, OpenRouter headers). Ids
// are the rows of hermes:hermes_cli/auth.py:172-240 (_REGISTRY_ROWS) plus
// "openrouter" and "custom" (hermes:hermes_cli/auth.py:925); Hermes maps
// "ollama" to "custom" itself (hermes:hermes_cli/auth.py:1450). A provider
// Hermes has no row for (Mistral) is a custom OpenAI-compatible endpoint.
func hermesProvider(id, base string) string {
	switch id {
	case "openai":
		return "openai-api"
	case "kimi":
		if strings.Contains(base, "moonshot.cn") {
			return "kimi-coding-cn"
		}
		return "kimi-coding"
	case "ollama":
		if strings.TrimRight(base, "/") == "https://ollama.com" {
			return "ollama-cloud"
		}
		return "custom"
	case "mistral":
		return "custom"
	}
	return id // anthropic, gemini, deepseek, xai, zai, nvidia, opencode-zen, opencode-go
}

// AgentModel returns the credentials a run on the agent engine uses for the
// provider and model the chat fixed at claim: every API-key provider in the
// registry and OpenRouter, with the account's decrypted key. An empty model
// takes the account's chosen model for that provider, as Completer does, so
// both engines run the same model. Claude Code and Codex return
// ErrAgentEngineUnsupported.
func (s *Service) AgentModel(ctx context.Context, userID, provider, model string) (AgentModel, error) {
	switch {
	case provider == ClaudeCLI || provider == CodexCLI:
		return s.cliAgentModel(ctx, userID, provider, model)
	case provider == "":
		return AgentModel{}, errors.New("This run has no AI provider. Try again")
	case provider != OpenRouter && apiProviderByID(provider) == nil:
		return AgentModel{}, fmt.Errorf("Unknown AI provider %q. Pick one in Settings → Agent", provider)
	}
	db := s.db.WithContext(ctx)
	if provider == OpenRouter {
		row, err := s.load(db, userID)
		if err != nil {
			return AgentModel{}, err
		}
		return s.openRouterAgentModel(row, model)
	}
	spec := apiProviderByID(provider)
	row, found, err := s.apiRow(db, userID, provider)
	if err != nil {
		return AgentModel{}, err
	}
	if !found {
		return AgentModel{}, fmt.Errorf("%s is not connected. Add its key in Settings → Agent", spec.Label)
	}
	return s.apiAgentModel(spec, row, model)
}

// cliAgentModel sends a Claude Code or Codex run through the loopback
// gateway: Hermes calls it as a custom OpenAI-compatible endpoint with a
// secret for this account, provider and model, and the gateway answers
// with the CLI's Completer. Without a gateway the chat stays classic.
func (s *Service) cliAgentModel(ctx context.Context, userID, provider, model string) (AgentModel, error) {
	if s.gateway == nil {
		return AgentModel{}, ErrAgentEngineUnsupported
	}
	if model == "" {
		row, err := s.load(s.db.WithContext(ctx), userID)
		if err != nil {
			return AgentModel{}, err
		}
		model = s.chatModel(row, provider)
	}
	// The same checks the classic engine makes: CLI on, found, connected.
	if _, err := s.Completer(ctx, userID, provider, model); err != nil {
		return AgentModel{}, err
	}
	return AgentModel{Provider: "custom", Model: model, BaseURL: s.gateway.BaseURL(),
		APIKey: s.gateway.grant(userID, provider, model), APIMode: apiModeChat}, nil
}

// openRouterAgentModel is OpenRouter direct: the account's key, the chat
// completions endpoint's base, and the low reasoning effort the classic
// engine asks for (chat.OpenRouter).
func (s *Service) openRouterAgentModel(row Settings, model string) (AgentModel, error) {
	key, err := s.openRouterKey(row)
	if err != nil {
		return AgentModel{}, err
	}
	if key == "" {
		return AgentModel{}, errors.New("Add an OpenRouter API key in Settings → Agent")
	}
	if model == "" {
		model = s.chatModel(row, OpenRouter)
	}
	return AgentModel{
		Provider:  OpenRouter,
		Model:     model,
		BaseURL:   strings.TrimSuffix(strings.TrimRight(s.openRouterURL, "/"), "/chat/completions"),
		APIKey:    key,
		APIMode:   apiModeChat,
		Reasoning: map[string]any{"enabled": true, "effort": "low"},
	}, nil
}

// apiAgentModel is one direct API provider (registry.go), checked the way
// buildAPI checks it for the classic engine.
func (s *Service) apiAgentModel(spec *apiProvider, row APIKey, model string) (AgentModel, error) {
	key, err := s.apiKey(row)
	if err != nil {
		return AgentModel{}, err
	}
	if key == "" && !spec.KeyOptional {
		return AgentModel{}, fmt.Errorf("Add %s in Settings → Agent", apiKeyName(spec))
	}
	if model == "" {
		model = row.Model
	}
	if model == "" {
		return AgentModel{}, fmt.Errorf("Choose a %s model in Settings → Agent", spec.Label)
	}
	base := row.BaseURL
	if base == "" {
		base = s.defaultBase(spec)
	}
	route := spec.route(model)
	mode, ok := modeForRoute[route]
	if !ok {
		return AgentModel{}, fmt.Errorf("%s serves %s through a protocol Timely does not support. Choose another model", spec.Label, model)
	}
	if route == routeOllama && s.typedBase(spec, base) && !s.privateOllama {
		// The classic engine reaches a typed address only through
		// publicTransport while sign-ups are open; the worker's HTTP client has
		// no such guard, so such a chat stays classic.
		return AgentModel{}, unsupportedError{"An Ollama address you typed uses the classic engine on a server open to sign-ups"}
	}
	agentBase := strings.TrimRight(base, "/")
	switch route {
	case routeMessages:
		// The SDK base has no /v1 (Hermes strips it too,
		// hermes:agent/anthropic_adapter.py:385-392).
		agentBase = strings.TrimSuffix(agentBase, "/v1")
		if spec.Anthropic && s.anthropicURL != "" {
			agentBase = s.anthropicURL
		}
	case routeOllama:
		// Ollama's OpenAI-compatible endpoint, as Hermes' own Ollama Cloud row
		// (hermes:hermes_cli/auth_constants.py:85). Timely's classic Ollama
		// client uses the native /api/chat instead.
		agentBase += "/v1"
	}
	if key == "" {
		key = keylessPlaceholder
	}
	m := AgentModel{Provider: hermesProvider(spec.ID, base), Model: model, BaseURL: agentBase, APIKey: key, APIMode: mode}
	switch {
	case spec.Anthropic:
		// The classic engine asks Anthropic models that accept it for low
		// effort and leaves thinking off otherwise.
		if s.effortFor(spec, base, key, model) {
			m.Reasoning = map[string]any{"enabled": true, "effort": "low"}
		} else {
			m.Reasoning = map[string]any{"enabled": false}
		}
	case spec.ID == "deepseek":
		// The classic engine turns DeepSeek's thinking off (registry.go).
		m.Reasoning = map[string]any{"enabled": false}
	}
	return m, nil
}
