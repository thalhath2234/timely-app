package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
	// ExtraContent carries provider state that must be echoed back with the
	// call, such as Gemini's thought signature.
	ExtraContent json.RawMessage `json:"extra_content,omitempty"`
}
type WireMessage struct {
	ImageURLs        []string          `json:"-"`
	Sensitive        bool              `json:"-"`
	Role             string            `json:"role"`
	Content          string            `json:"content"`
	ToolCalls        []ToolCall        `json:"tool_calls,omitempty"`
	ToolCallID       string            `json:"tool_call_id,omitempty"`
	Annotations      []json.RawMessage `json:"annotations,omitempty"`
	ReasoningDetails []json.RawMessage `json:"reasoning_details,omitempty"`
	// ReasoningContent is the thinking text DeepSeek and Kimi return; their
	// thinking modes need it echoed back within a tool loop.
	ReasoningContent string `json:"reasoning_content,omitempty"`
	// ThinkingBlocks are Anthropic thinking blocks, replayed unchanged on the
	// assistant turn that produced them.
	ThinkingBlocks []json.RawMessage `json:"thinking_blocks,omitempty"`
}
type Completer interface {
	Complete(context.Context, []WireMessage, []any, bool) (WireMessage, error)
}

// Completers picks the model client for each account. Resolve runs once when a
// queued run is claimed; Completer rebuilds the client for that recorded choice
// so resumed runs keep their provider.
type Completers interface {
	Resolve(ctx context.Context, userID string) (provider, model string, err error)
	Completer(ctx context.Context, userID, provider, model string) (Completer, error)
}

// Searcher is implemented by completers that may lack web search. The runner
// offers the web_search tool only when CanSearch reports true.
type Searcher interface {
	CanSearch() bool
}

type completerKey struct{}

// WithCompleter attaches the run's client to the context so every model call in
// the run (planning, receipts, vision, search) uses the same provider.
func WithCompleter(ctx context.Context, c Completer) context.Context {
	return context.WithValue(ctx, completerKey{}, c)
}

// canSearch reports whether the run's provider can answer web searches.
func canSearch(ctx context.Context) bool {
	if c, ok := ctx.Value(completerKey{}).(Searcher); ok && c != nil {
		return c.CanSearch()
	}
	return true
}

func (s *Service) complete(ctx context.Context, messages []WireMessage, tools []any, search bool) (WireMessage, error) {
	if c, ok := ctx.Value(completerKey{}).(Completer); ok && c != nil {
		return c.Complete(ctx, messages, tools, search)
	}
	if s.provider == nil {
		return WireMessage{}, fmt.Errorf("No AI provider is set up. Open Settings → Agent to connect one")
	}
	return s.provider.Complete(ctx, messages, tools, search)
}

type OpenRouter struct {
	Key, Model, URL string
	Client          *http.Client
}

func NewOpenRouter() *OpenRouter {
	model := os.Getenv("OPENROUTER_CHAT_MODEL")
	if model == "" {
		model = "z-ai/glm-5.3-flash"
	}
	// No key: only keys an account saves in Settings → Agent are used.
	return &OpenRouter{Model: model, URL: "https://openrouter.ai/api/v1/chat/completions", Client: &http.Client{Timeout: 4 * time.Minute}}
}

// Only model inference is retried here; no domain tool executes until a complete
// response has been accepted. A failed attempt cannot replay an app mutation.
func (p *OpenRouter) Complete(ctx context.Context, messages []WireMessage, tools []any, search bool) (WireMessage, error) {
	return RetryTransient(ctx, func() (WireMessage, error) { return p.completeOnce(ctx, messages, tools, search) })
}

// RetryTransient runs one model call and retries it once after a network
// timeout or a cut-off body. Other errors and cancellation return at once.
func RetryTransient(ctx context.Context, call func() (WireMessage, error)) (WireMessage, error) {
	var result WireMessage
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		result, err = call()
		if err == nil {
			return result, nil
		}
		if ctx.Err() != nil {
			return WireMessage{}, ctx.Err()
		}
		var networkError net.Error
		transient := errors.As(err, &networkError) && networkError.Timeout() || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF)
		if !transient {
			return WireMessage{}, err
		}
		if attempt == 0 {
			timer := time.NewTimer(300 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return WireMessage{}, ctx.Err()
			case <-timer.C:
			}
		}
	}
	return WireMessage{}, fmt.Errorf("The AI provider took too long to respond. Please try again; completed changes are saved")
}
func (p *OpenRouter) completeOnce(ctx context.Context, messages []WireMessage, tools []any, search bool) (WireMessage, error) {
	var empty WireMessage
	if p.Key == "" {
		return empty, fmt.Errorf("Add an OpenRouter API key in Settings → Agent")
	}
	sensitive := false
	wire := make([]any, 0, len(messages))
	for _, m := range messages {
		sensitive = sensitive || m.Sensitive || len(m.ImageURLs) > 0
		// Fields other providers return are not OpenRouter's to read.
		m.ReasoningContent, m.ThinkingBlocks = "", nil
		if len(m.ToolCalls) > 0 {
			m.ToolCalls = append([]ToolCall(nil), m.ToolCalls...)
			for i := range m.ToolCalls {
				m.ToolCalls[i].ExtraContent = nil
			}
		}
		if len(m.ImageURLs) == 0 {
			wire = append(wire, m)
			continue
		}
		parts := []any{map[string]any{"type": "text", "text": m.Content}}
		for _, url := range m.ImageURLs {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": url}})
		}
		wire = append(wire, map[string]any{"role": m.Role, "content": parts})
	}
	if sensitive && search {
		return empty, fmt.Errorf("Web search cannot receive private image content")
	}
	body := map[string]any{"model": p.Model, "messages": wire, "max_tokens": 8192, "temperature": 0.2, "reasoning": map[string]any{"effort": "low"}}
	if sensitive {
		body["provider"] = map[string]any{"zdr": true}
	}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	if search {
		body["plugins"] = []any{map[string]any{"id": "web", "max_results": 5}}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", p.URL, bytes.NewReader(raw))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Authorization", "Bearer "+p.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Title", "Timely")
	res, err := p.Client.Do(req)
	if err != nil {
		return empty, fmt.Errorf("AI connection failed: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		if sensitive {
			return empty, fmt.Errorf("The zero-retention AI route is unavailable (HTTP %d). Try again; no fallback provider was used", res.StatusCode)
		}
		return empty, fmt.Errorf("OpenRouter returned HTTP %d; check model access, credit, or retry", res.StatusCode)
	}
	var data struct {
		Choices []struct {
			Message      WireMessage `json:"message"`
			FinishReason string      `json:"finish_reason"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&data); err != nil {
		return empty, fmt.Errorf("AI response could not be read: %w", err)
	}
	if data.Error != nil || len(data.Choices) == 0 {
		return empty, fmt.Errorf("AI provider did not return a response")
	}
	if data.Choices[0].FinishReason == "length" {
		return empty, fmt.Errorf("The proposal was too large; try a smaller request")
	}
	return data.Choices[0].Message, nil
}
