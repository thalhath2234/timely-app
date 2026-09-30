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
}
type Completer interface {
	Complete(context.Context, []WireMessage, []any, bool) (WireMessage, error)
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
	return &OpenRouter{Key: os.Getenv("OPENROUTER_API_KEY"), Model: model, URL: "https://openrouter.ai/api/v1/chat/completions", Client: &http.Client{Timeout: 4 * time.Minute}}
}

// Only model inference is retried here; no domain tool executes until a complete
// response has been accepted. A failed attempt cannot replay an app mutation.
func (p *OpenRouter) Complete(ctx context.Context, messages []WireMessage, tools []any, search bool) (WireMessage, error) {
	var result WireMessage
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		result, err = p.completeOnce(ctx, messages, tools, search)
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
		return empty, fmt.Errorf("Chat needs OPENROUTER_API_KEY configured on the API server")
	}
	sensitive := false
	wire := make([]any, 0, len(messages))
	for _, m := range messages {
		sensitive = sensitive || m.Sensitive || len(m.ImageURLs) > 0
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
