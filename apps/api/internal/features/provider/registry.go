package provider

import (
	"context"
	"net/http"
	"strings"
)

// apiProvider describes one direct API provider. Every provider except
// Anthropic speaks the OpenAI chat-completions protocol, so a provider is a
// row here plus the knobs where it differs; adding one needs no UI change.
type apiProvider struct {
	ID             string
	Label          string
	Description    string
	KeyURL         string
	KeyPlaceholder string
	Anthropic      bool       // Anthropic itself: SDK model list, effort, web search
	Endpoints      []endpoint // the first is the default
	CustomURL      bool       // the person may type their own base URL (self-hosted)
	KeyOptional    bool
	ChatPath       string
	ModelsPath     string
	AuthHeader     string // empty: Authorization: Bearer <key>
	MaxTokensField string // empty: max_tokens
	Temperature    *float64
	ExtraBody      map[string]any
	// EchoReasoning sends reasoning_content back on assistant turns, which
	// thinking modes require inside a tool loop. EchoExtraContent does the
	// same for tool-call extra_content (Gemini thought signatures).
	EchoReasoning    bool
	EchoExtraContent bool
	// PublicList marks providers whose model list answers without a key, so
	// saving a key also runs one test call to check it.
	PublicList bool
	// Defaults are preferred chat models, first listed one wins.
	Defaults   []string
	Skip       func(id string) bool // drop non-chat models from the list
	Vision     func(id string) bool // image input when the list does not say
	ListModels func(ctx context.Context, client *http.Client, spec *apiProvider, base, key string) ([]ModelOption, error)
	// Route names the protocol a model is served on: routeChat (the default),
	// routeResponses, routeMessages or routeOllama. An empty route hides the
	// model (a protocol Timely does not speak).
	Route func(model string) string
}

const (
	routeChat      = "chat"
	routeResponses = "responses"
	routeMessages  = "messages"
	routeOllama    = "ollama"
)

func (p *apiProvider) route(model string) string {
	if p.Route == nil {
		return routeChat
	}
	return p.Route(model)
}

func always(route string) func(string) string { return func(string) string { return route } }

// staticModels serves a fixed list for providers without a model endpoint.
func staticModels(list ...ModelOption) func(context.Context, *http.Client, *apiProvider, string, string) ([]ModelOption, error) {
	return func(context.Context, *http.Client, *apiProvider, string, string) ([]ModelOption, error) {
		return append([]ModelOption{}, list...), nil
	}
}

// openCodeRoute maps OpenCode model ids to the protocol each is served on
// (opencode.ai/docs/zen and /docs/go). Gemini (native Google API) and Jev
// (/systemone) are hidden. Zen and Go differ for MiniMax and Qwen 3.8 Max.
func openCodeRoute(messages ...string) func(string) string {
	return func(id string) string {
		switch {
		case hasPrefix(id, "gpt-", "grok-", "muse-"):
			return routeResponses
		case hasPrefix(id, "claude-") || hasPrefix(id, messages...):
			return routeMessages
		case hasPrefix(id, "gemini-", "jev-"):
			return ""
		}
		return routeChat
	}
}

func hasPrefix(id string, prefixes ...string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(id, p) {
			return true
		}
	}
	return false
}

// openCodeVision marks OpenCode models known to take images.
func openCodeVision(id string) bool {
	return hasPrefix(id, "claude-", "gpt-5", "gpt-6", "gemini-", "kimi-k3", "kimi-k2.5", "kimi-k2.6", "glm-5.3-flash", "qwen3.") || hasAny(id, "vision", "omni")
}

type endpoint struct {
	ID, Label, BaseURL string
}

func (p *apiProvider) maxTokensField() string {
	if p.MaxTokensField != "" {
		return p.MaxTokensField
	}
	return "max_tokens"
}

func (p *apiProvider) authorize(req *http.Request, key string) {
	if key == "" {
		return
	}
	if p.AuthHeader != "" {
		req.Header.Set(p.AuthHeader, key)
		return
	}
	req.Header.Set("Authorization", "Bearer "+key)
}

func apiProviderByID(id string) *apiProvider {
	for _, p := range apiProviders {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func temperature(v float64) *float64 { return &v }

// hasAny reports whether id contains any of the parts (case-insensitive).
func hasAny(id string, parts ...string) bool {
	id = strings.ToLower(id)
	for _, part := range parts {
		if strings.Contains(id, part) {
			return true
		}
	}
	return false
}

// nonChat drops embedding, speech, image and moderation models that list
// endpoints mix in with chat models.
func nonChat(id string) bool {
	return hasAny(id, "embed", "rerank", "tts", "whisper", "transcribe", "audio", "speech", "dall-e", "image", "imagen", "veo", "moderation", "realtime", "guard", "safety", "reward", "ocr", "retriever", "parse")
}

var apiProviders = []*apiProvider{
	{
		ID: "anthropic", Label: "Anthropic API", Anthropic: true, Route: always(routeMessages),
		Description: "Claude models billed to your Anthropic Console key. Separate from the Claude Code subscription.",
		KeyURL:      "https://platform.claude.com/settings/keys", KeyPlaceholder: "sk-ant-…",
		Endpoints: []endpoint{{ID: "default", Label: "api.anthropic.com", BaseURL: "https://api.anthropic.com/v1"}},
		Defaults:  []string{"claude-opus-5-5"},
	},
	{
		// Every OpenAI model goes through the Responses API: the newest models
		// call tools only there.
		ID: "openai", Label: "OpenAI API", Route: always(routeResponses),
		Description: "GPT models billed to your OpenAI platform key. Separate from the Codex / ChatGPT subscription.",
		KeyURL:      "https://platform.openai.com/api-keys", KeyPlaceholder: "sk-…",
		Endpoints:  []endpoint{{ID: "default", Label: "api.openai.com", BaseURL: "https://api.openai.com/v1"}},
		ModelsPath: "models",
		Defaults:   []string{"gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini", "gpt-5-mini", "gpt-5"},
		Skip: func(id string) bool {
			return nonChat(id) || !hasPrefix(id, "gpt-", "o3", "o4", "chatgpt-") || hasAny(id, "instruct", "search", "computer-use", "deep-research", "-pro", "codex")
		},
		Vision: func(id string) bool { return hasAny(id, "gpt-4o", "gpt-4.1", "gpt-5", "gpt-6", "o3", "o4") },
	},
	{
		// Gemini 3 signs tool calls; the signature in extra_content must come
		// back on the next turn or the call is rejected.
		ID: "gemini", Label: "Google Gemini",
		Description: "Gemini models with a Google AI Studio key.",
		KeyURL:      "https://aistudio.google.com/apikey", KeyPlaceholder: "AIza…",
		Endpoints: []endpoint{{ID: "default", Label: "generativelanguage.googleapis.com", BaseURL: "https://generativelanguage.googleapis.com/v1beta/openai"}},
		ChatPath:  "chat/completions", ModelsPath: "models",
		EchoExtraContent: true,
		Defaults:         []string{"gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash"},
		Skip: func(id string) bool {
			return nonChat(id) || !strings.HasPrefix(id, "gemini") || hasAny(id, "aqa", "live", "native-audio", "thinking-exp")
		},
		Vision: func(id string) bool { return strings.HasPrefix(id, "gemini") },
	},
	{
		// Thinking is turned off: with tools on, DeepSeek rejects a request
		// unless every earlier assistant turn carries its reasoning, and replies
		// from earlier runs are stored without it.
		ID: "deepseek", Label: "DeepSeek",
		Description: "DeepSeek V4 models with a DeepSeek platform key.",
		KeyURL:      "https://platform.deepseek.com/api_keys", KeyPlaceholder: "sk-…",
		Endpoints: []endpoint{{ID: "default", Label: "api.deepseek.com", BaseURL: "https://api.deepseek.com"}},
		ChatPath:  "chat/completions", ModelsPath: "models",
		Temperature:   temperature(0.2),
		ExtraBody:     map[string]any{"thinking": map[string]any{"type": "disabled"}},
		EchoReasoning: true,
		Defaults:      []string{"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat"},
	},
	{
		ID: "xai", Label: "xAI Grok",
		Description: "Grok models with an xAI API key.",
		KeyURL:      "https://console.x.ai", KeyPlaceholder: "xai-…",
		Endpoints: []endpoint{{ID: "default", Label: "api.x.ai", BaseURL: "https://api.x.ai/v1"}},
		ChatPath:  "chat/completions", ModelsPath: "language-models",
		MaxTokensField: "max_completion_tokens",
		Defaults:       []string{"grok-4.7", "grok-4.6", "grok-4.5"},
		Skip:           func(id string) bool { return nonChat(id) || !hasAny(id, "grok") },
	},
	{
		// Mistral's request schema is closed: only standard fields are sent.
		ID: "mistral", Label: "Mistral",
		Description: "Mistral models with a Mistral AI Studio key.",
		KeyURL:      "https://console.mistral.ai/api-keys",
		Endpoints:   []endpoint{{ID: "default", Label: "api.mistral.ai", BaseURL: "https://api.mistral.ai/v1"}},
		ChatPath:    "chat/completions", ModelsPath: "models",
		Temperature: temperature(0.2),
		Defaults:    []string{"mistral-medium-latest", "mistral-medium-3-5", "mistral-large-latest", "mistral-small-latest"},
		Skip:        nonChat,
	},
	{
		// Z.ai publishes no model list, so the list is fixed and saving a key
		// runs a test call. The GLM Coding Plan endpoint is left out: its terms
		// allow it only inside Z.ai's supported coding tools.
		ID: "zai", Label: "Z.ai (GLM)",
		Description: "GLM models with a Z.ai pay-as-you-go key.",
		KeyURL:      "https://z.ai/manage-apikey/apikey-list",
		Endpoints: []endpoint{
			{ID: "default", Label: "International (api.z.ai)", BaseURL: "https://api.z.ai/api/paas/v4"},
			{ID: "china", Label: "Mainland China (open.bigmodel.cn)", BaseURL: "https://open.bigmodel.cn/api/paas/v4"},
		},
		ChatPath: "chat/completions", PublicList: true,
		Temperature: temperature(0.2), EchoReasoning: true,
		Defaults: []string{"glm-5.3-flash"},
		ListModels: staticModels(
			ModelOption{ID: "glm-5.3-flash", Name: "GLM-5.3 Flash", Vision: true},
			ModelOption{ID: "glm-5.3", Name: "GLM-5.3"},
			ModelOption{ID: "glm-5.2", Name: "GLM-5.2"},
			ModelOption{ID: "glm-5.1", Name: "GLM-5.1"},
			ModelOption{ID: "glm-5", Name: "GLM-5"},
			ModelOption{ID: "glm-4.7", Name: "GLM-4.7"},
			ModelOption{ID: "glm-4.6v", Name: "GLM-4.6V", Vision: true},
			ModelOption{ID: "glm-4.6", Name: "GLM-4.6"},
			ModelOption{ID: "glm-4.5-air", Name: "GLM-4.5 Air"},
		),
	},
	{
		// Kimi rejects non-default sampling values, so no temperature is sent.
		// Kimi For Coding is left out: its terms limit it to coding tools.
		ID: "kimi", Label: "Kimi (Moonshot)",
		Description: "Kimi models with a Moonshot / Kimi platform key.",
		KeyURL:      "https://platform.kimi.ai/console/api-keys", KeyPlaceholder: "sk-…",
		Endpoints: []endpoint{
			{ID: "default", Label: "International (api.moonshot.ai)", BaseURL: "https://api.moonshot.ai/v1"},
			{ID: "china", Label: "Mainland China (api.moonshot.cn)", BaseURL: "https://api.moonshot.cn/v1"},
		},
		ChatPath: "chat/completions", ModelsPath: "models",
		EchoReasoning: true,
		Defaults:      []string{"kimi-k3", "kimi-k2.6", "kimi-k2.7-code"},
	},
	{
		// Native /api/chat (see ollama.go) so the context window can be set.
		ID: "ollama", Label: "Ollama", Route: always(routeOllama),
		Description: "Local models served by Ollama, or Ollama Cloud with a key.",
		KeyURL:      "https://ollama.com/settings/keys", KeyOptional: true, CustomURL: true, PublicList: true,
		Endpoints: []endpoint{
			{ID: "default", Label: "This server (localhost:11434)", BaseURL: "http://localhost:11434"},
			{ID: "cloud", Label: "Ollama Cloud (ollama.com)", BaseURL: "https://ollama.com"},
		},
		ListModels: ollamaModels,
	},
	{
		ID: "nvidia", Label: "NVIDIA NIM",
		Description: "Models hosted on build.nvidia.com with an NVIDIA API key.",
		KeyURL:      "https://build.nvidia.com/settings/api-keys", KeyPlaceholder: "nvapi-…",
		Endpoints: []endpoint{{ID: "default", Label: "integrate.api.nvidia.com", BaseURL: "https://integrate.api.nvidia.com/v1"}},
		ChatPath:  "chat/completions", ModelsPath: "models", PublicList: true,
		Temperature: temperature(0.2),
		Defaults:    []string{"moonshotai/kimi-k3", "deepseek-ai/deepseek-v4-pro", "qwen/qwen3.8-max"},
		Skip: func(id string) bool {
			return nonChat(id) || hasAny(id, "nv-embed", "nvclip", "deplot", "kosmos", "fuyu", "paligemma", "llama2")
		},
		Vision: func(id string) bool { return hasAny(id, "vision", "-vl", "vlm", "llama-4", "kimi-k3") },
	},
	{
		ID: "opencode-zen", Label: "OpenCode Zen",
		Description: "OpenCode's pay-as-you-go gateway (Claude, GPT, Grok, GLM, Kimi, DeepSeek, Qwen…).",
		KeyURL:      "https://opencode.ai/auth", KeyPlaceholder: "sk-…",
		Endpoints: []endpoint{{ID: "default", Label: "opencode.ai/zen", BaseURL: "https://opencode.ai/zen/v1"}},
		ChatPath:  "chat/completions", ModelsPath: "models", PublicList: true,
		Route:    openCodeRoute("qwen3.8-flash", "qwen3.7-", "qwen3.6-", "qwen3.5-"),
		Defaults: []string{"glm-5.3", "kimi-k3", "deepseek-v4.1-flash"},
		Vision:   openCodeVision,
	},
	{
		ID: "opencode-go", Label: "OpenCode Go",
		Description: "Models included with the OpenCode Go subscription.",
		KeyURL:      "https://opencode.ai/auth", KeyPlaceholder: "sk-…",
		Endpoints: []endpoint{{ID: "default", Label: "opencode.ai/zen/go", BaseURL: "https://opencode.ai/zen/go/v1"}},
		ChatPath:  "chat/completions", ModelsPath: "models", PublicList: true,
		Route:    openCodeRoute("minimax-", "qwen3."),
		Defaults: []string{"glm-5.3", "kimi-k3", "deepseek-v4.1-flash"},
		Vision:   openCodeVision,
	},
}
