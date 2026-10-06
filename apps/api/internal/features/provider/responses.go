package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"timely-api/internal/features/chat"
)

// Responses talks to an OpenAI Responses API endpoint (/responses). OpenAI's
// current models call tools only through it, and OpenCode serves its GPT,
// Grok and Muse models there. Nothing is stored server side (store: false)
// and reasoning items are not replayed; each call resends the transcript.
type Responses struct {
	Spec   *apiProvider
	Base   string
	Key    string
	Model  string
	Client *http.Client
}

func (p *Responses) CanSearch() bool { return false }

func (p *Responses) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	if search {
		return chat.WireMessage{}, fmt.Errorf("Web search is not available with %s. Turn web search off for this chat, or choose OpenRouter, Anthropic API, Claude Code or Codex in Settings → Agent", p.Spec.Label)
	}
	return chat.RetryTransient(ctx, func() (chat.WireMessage, error) { return p.completeOnce(ctx, messages, tools) })
}

func (p *Responses) completeOnce(ctx context.Context, messages []chat.WireMessage, tools []any) (chat.WireMessage, error) {
	var empty chat.WireMessage
	instructions, input := responsesInput(messages)
	// Reasoning tokens count toward max_output_tokens.
	body := map[string]any{"model": p.Model, "input": input, "store": false, "max_output_tokens": 16384}
	if instructions != "" {
		body["instructions"] = instructions
	}
	if specs := responsesTools(tools); len(specs) > 0 {
		body["tools"] = specs
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(p.Base, "responses"), bytes.NewReader(raw))
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
		Status            string `json:"status"`
		IncompleteDetails *struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
		Output []struct {
			Type      string `json:"type"`
			CallID    string `json:"call_id"`
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
			Content   []struct {
				Type    string `json:"type"`
				Text    string `json:"text"`
				Refusal string `json:"refusal"`
			} `json:"content"`
		} `json:"output"`
		Error json.RawMessage `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&data); err != nil {
		return empty, fmt.Errorf("%s answer could not be read: %w", p.Spec.Label, err)
	}
	if msg := errorText(data.Error); msg != "" {
		return empty, fmt.Errorf("%s: %s", p.Spec.Label, msg)
	}
	if data.Status == "incomplete" && data.IncompleteDetails != nil && data.IncompleteDetails.Reason == "max_output_tokens" {
		return empty, fmt.Errorf("The proposal was too large; try a smaller request")
	}
	out := chat.WireMessage{Role: "assistant"}
	var text strings.Builder
	for _, item := range data.Output {
		switch item.Type {
		case "message":
			for _, c := range item.Content {
				if c.Type == "output_text" {
					text.WriteString(c.Text)
				} else if c.Type == "refusal" && c.Refusal != "" {
					text.WriteString(c.Refusal)
				}
			}
		case "function_call":
			var tc chat.ToolCall
			tc.ID, tc.Type = item.CallID, "function"
			tc.Function.Name, tc.Function.Arguments = item.Name, item.Arguments
			if strings.TrimSpace(tc.Function.Arguments) == "" {
				tc.Function.Arguments = "{}"
			}
			out.ToolCalls = append(out.ToolCalls, tc)
		}
	}
	out.Content = text.String()
	if out.Content == "" && len(out.ToolCalls) == 0 && data.Status != "" && data.Status != "completed" {
		return empty, fmt.Errorf("%s stopped with status %q", p.Spec.Label, data.Status)
	}
	return out, nil
}

// responsesInput turns the transcript into Responses input items. System
// text that opens the transcript becomes the instructions.
func responsesInput(messages []chat.WireMessage) (string, []any) {
	var instructions []string
	input := []any{}
	for _, m := range messages {
		switch m.Role {
		case "system":
			if len(input) == 0 {
				instructions = append(instructions, m.Content)
				continue
			}
			input = append(input, map[string]any{"role": "developer", "content": m.Content})
		case "assistant":
			if strings.TrimSpace(m.Content) != "" {
				input = append(input, map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": m.Content}}})
			}
			for _, tc := range m.ToolCalls {
				input = append(input, map[string]any{"type": "function_call", "call_id": tc.ID, "name": tc.Function.Name, "arguments": tc.Function.Arguments})
			}
		case "tool":
			input = append(input, map[string]any{"type": "function_call_output", "call_id": m.ToolCallID, "output": m.Content})
		default:
			parts := []any{map[string]any{"type": "input_text", "text": m.Content}}
			for _, url := range m.ImageURLs {
				parts = append(parts, map[string]any{"type": "input_image", "image_url": url})
			}
			input = append(input, map[string]any{"role": "user", "content": parts})
		}
	}
	return strings.Join(instructions, "\n\n"), input
}

// responsesTools flattens chat-completions function specs into the Responses
// shape ({type, name, description, parameters}).
func responsesTools(tools []any) []any {
	out := []any{}
	for _, t := range tools {
		raw, err := json.Marshal(t)
		if err != nil {
			continue
		}
		var spec struct {
			Function struct {
				Name        string         `json:"name"`
				Description string         `json:"description"`
				Parameters  map[string]any `json:"parameters"`
			} `json:"function"`
		}
		if json.Unmarshal(raw, &spec) != nil || spec.Function.Name == "" {
			continue
		}
		// strict is on by default in the Responses API and would reject
		// Timely's schemas (optional properties, open objects).
		tool := map[string]any{"type": "function", "name": spec.Function.Name, "description": spec.Function.Description, "strict": false}
		if spec.Function.Parameters != nil {
			tool["parameters"] = spec.Function.Parameters
		} else {
			tool["parameters"] = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out = append(out, tool)
	}
	return out
}
