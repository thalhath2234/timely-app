package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"timely-api/internal/features/chat"
)

// Compat talks to an OpenAI-compatible /chat/completions endpoint with an
// account's own key. Each outgoing message is rebuilt from a whitelist so
// fields one provider returns (OpenRouter annotations, DeepSeek reasoning,
// Gemini thought signatures) only go back to the provider that needs them.
type Compat struct {
	Spec   *apiProvider
	Base   string
	Key    string
	Model  string
	Client *http.Client
}

// CanSearch is false: direct providers get no web search plugin, so the
// runner leaves the web_search tool out.
func (p *Compat) CanSearch() bool { return false }

func (p *Compat) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	if search {
		return chat.WireMessage{}, fmt.Errorf("Web search is not available with %s. Turn web search off for this chat, or choose OpenRouter, Anthropic API, Claude Code or Codex in Settings → Agent", p.Spec.Label)
	}
	return chat.RetryTransient(ctx, func() (chat.WireMessage, error) { return p.completeOnce(ctx, messages, tools) })
}

func (p *Compat) completeOnce(ctx context.Context, messages []chat.WireMessage, tools []any) (chat.WireMessage, error) {
	var empty chat.WireMessage
	wire := make([]any, 0, len(messages))
	for _, m := range messages {
		wire = append(wire, p.wireMessage(m))
	}
	body := map[string]any{"model": p.Model, "messages": wire, p.Spec.maxTokensField(): 8192}
	if p.Spec.Temperature != nil {
		body["temperature"] = *p.Spec.Temperature
	}
	for k, v := range p.Spec.ExtraBody {
		body[k] = v
	}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(p.Base, p.Spec.ChatPath), bytes.NewReader(raw))
	if err != nil {
		return empty, err
	}
	p.Spec.authorize(req, p.Key)
	req.Header.Set("Content-Type", "application/json")
	res, err := p.Client.Do(req)
	if err != nil {
		return empty, fmt.Errorf("Could not reach %s: %w", p.Spec.Label, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return empty, statusError(p.Spec.Label, res)
	}
	var data struct {
		Choices []struct {
			Message struct {
				chat.WireMessage
				// Mistral returns content as an array of chunks when reasoning.
				Content json.RawMessage `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Error json.RawMessage `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&data); err != nil {
		return empty, fmt.Errorf("%s answer could not be read: %w", p.Spec.Label, err)
	}
	if len(data.Choices) == 0 {
		if msg := errorText(data.Error); msg != "" {
			return empty, fmt.Errorf("%s: %s", p.Spec.Label, msg)
		}
		return empty, fmt.Errorf("%s did not return an answer", p.Spec.Label)
	}
	choice := data.Choices[0]
	if choice.FinishReason == "length" {
		return empty, fmt.Errorf("The proposal was too large; try a smaller request")
	}
	out := chat.WireMessage{Role: "assistant", Content: contentText(choice.Message.Content), ToolCalls: choice.Message.ToolCalls}
	if p.Spec.EchoReasoning {
		out.ReasoningContent = choice.Message.ReasoningContent
	}
	for i := range out.ToolCalls {
		if out.ToolCalls[i].Type == "" {
			out.ToolCalls[i].Type = "function"
		}
		if strings.TrimSpace(out.ToolCalls[i].Function.Arguments) == "" {
			out.ToolCalls[i].Function.Arguments = "{}"
		}
		if !p.Spec.EchoExtraContent {
			out.ToolCalls[i].ExtraContent = nil
		}
	}
	return out, nil
}

// contentText reads message content that is either a string or an array of
// chunks; only text chunks are kept (thinking chunks are dropped).
func contentText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var chunks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &chunks) != nil {
		return ""
	}
	var b strings.Builder
	for _, c := range chunks {
		if c.Type == "text" {
			b.WriteString(c.Text)
		}
	}
	return b.String()
}

func (p *Compat) wireMessage(m chat.WireMessage) map[string]any {
	out := map[string]any{"role": m.Role}
	switch {
	case len(m.ImageURLs) > 0:
		parts := []any{map[string]any{"type": "text", "text": m.Content}}
		for _, url := range m.ImageURLs {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": url}})
		}
		out["content"] = parts
	case m.Content != "" || len(m.ToolCalls) == 0:
		out["content"] = m.Content
	}
	if len(m.ToolCalls) > 0 {
		calls := make([]any, 0, len(m.ToolCalls))
		for _, tc := range m.ToolCalls {
			call := map[string]any{"id": tc.ID, "type": "function", "function": map[string]any{"name": tc.Function.Name, "arguments": tc.Function.Arguments}}
			if p.Spec.EchoExtraContent && len(tc.ExtraContent) > 0 {
				call["extra_content"] = tc.ExtraContent
			}
			calls = append(calls, call)
		}
		out["tool_calls"] = calls
	}
	if m.ToolCallID != "" {
		out["tool_call_id"] = m.ToolCallID
	}
	if p.Spec.EchoReasoning && m.Role == "assistant" && m.ReasoningContent != "" {
		out["reasoning_content"] = m.ReasoningContent
	}
	return out
}

// ---- model lists ----

type compatModel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	DisplayName  string `json:"display_name"`
	Capabilities *struct {
		FunctionCalling *bool `json:"function_calling"`
		CompletionChat  *bool `json:"completion_chat"`
		Vision          *bool `json:"vision"`
	} `json:"capabilities"`
	InputModalities []string `json:"input_modalities"`
	SupportsImageIn *bool    `json:"supports_image_in"`
}

// fetchCompatModels reads an OpenAI-style {"data": [...]} model list. A bad
// key fails here, so saving a key checks it without spending tokens.
func fetchCompatModels(ctx context.Context, client *http.Client, spec *apiProvider, base, key string) ([]ModelOption, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, joinURL(base, spec.ModelsPath), nil)
	if err != nil {
		return nil, err
	}
	spec.authorize(req, key)
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Could not reach %s: %w", spec.Label, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, statusError(spec.Label, res)
	}
	var body struct {
		Data   []compatModel `json:"data"`
		Models []compatModel `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(&body); err != nil {
		return nil, fmt.Errorf("%s model list could not be read: %w", spec.Label, err)
	}
	list := append(body.Data, body.Models...)
	out := []ModelOption{}
	seen := map[string]bool{}
	for _, m := range list {
		m.ID = strings.TrimPrefix(m.ID, "models/")
		if m.ID == "" || seen[m.ID] {
			continue
		}
		if c := m.Capabilities; c != nil && (c.FunctionCalling != nil && !*c.FunctionCalling || c.CompletionChat != nil && !*c.CompletionChat) {
			continue
		}
		if spec.Route != nil && spec.Route(m.ID) == "" {
			continue
		}
		if spec.Skip != nil && spec.Skip(m.ID) {
			continue
		}
		seen[m.ID] = true
		name := m.DisplayName
		if name == "" {
			name = m.Name
		}
		if name == "" {
			name = m.ID
		}
		vision := contains(m.InputModalities, "image") || contains(m.InputModalities, "images")
		if m.Capabilities != nil && m.Capabilities.Vision != nil {
			vision = *m.Capabilities.Vision
		}
		if m.SupportsImageIn != nil {
			vision = *m.SupportsImageIn
		}
		if !vision && spec.Vision != nil {
			vision = spec.Vision(m.ID)
		}
		out = append(out, ModelOption{ID: m.ID, Name: name, Vision: vision})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// ---- errors ----

// statusError turns a non-200 answer into a message that names the provider
// and quotes its own explanation, so a bad key or model is fixable from the UI.
func statusError(label string, res *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	msg := errorText(raw)
	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		if msg == "" {
			msg = "check the API key"
		}
		return fmt.Errorf("%s rejected the request (HTTP %d): %s", label, res.StatusCode, msg)
	case res.StatusCode == http.StatusTooManyRequests:
		if msg == "" {
			msg = "rate limit or quota reached"
		}
		return fmt.Errorf("%s is rate limiting this key (HTTP 429): %s", label, msg)
	case msg != "":
		return fmt.Errorf("%s returned HTTP %d: %s", label, res.StatusCode, msg)
	}
	return fmt.Errorf("%s returned HTTP %d; check the model, key and credit, or retry", label, res.StatusCode)
}

// errorText pulls the human message out of the error shapes providers use:
// {"error":{"message"}}, {"error":"..."}, {"message"}, {"detail"} and arrays
// of those. Anything else is shown trimmed.
func errorText(raw []byte) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil && len(list) > 0 {
		return errorText(list[0])
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return clip(text)
	}
	var obj struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
		Detail  json.RawMessage `json:"detail"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		if msg := errorText(obj.Error); msg != "" {
			return msg
		}
		if obj.Message != "" {
			return clip(obj.Message)
		}
		if msg := errorText(obj.Detail); msg != "" {
			return msg
		}
		if bytes.HasPrefix(raw, []byte("{")) {
			return ""
		}
	}
	return clip(string(raw))
}

func clip(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

func joinURL(base, path string) string {
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(path, "/")
}
