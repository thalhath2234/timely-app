package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"timely-api/internal/features/chat"
)

// Anthropic calls the Messages API with the account's own key; OpenCode serves
// its Claude and Qwen models through the same protocol. Thinking blocks are
// replayed unchanged on the turn that produced them, as tool use requires. A
// resumed run rebuilds the system prompt, which invalidates earlier blocks,
// so a request the API rejects for its thinking blocks is retried once
// without them.
type Anthropic struct {
	Key    string
	Model  string
	Base   string // overridable for tests
	Effort bool   // the model accepts output_config.effort
	Search bool   // server-side web search is available (Anthropic itself)
	Label  string // provider name in errors; "Anthropic" when empty
	Client *http.Client
}

func (p *Anthropic) CanSearch() bool { return p.Search }

func (p *Anthropic) label() string {
	if p.Label != "" {
		return p.Label
	}
	return "Anthropic"
}

type oneShotKey struct{}

// oneShot marks a call a person waits on in a panel: Help me write, view
// queries, checklist names and card descriptions. A provider that asks for a
// long wait before the retry fails such a call at once instead (noLongWait).
func oneShot(ctx context.Context) context.Context {
	return context.WithValue(ctx, oneShotKey{}, true)
}

// oneShotMaxWait is the longest retry-after a one-shot call sits out.
const oneShotMaxWait = 5 * time.Second

// noLongWait stops the SDK's automatic retry of a one-shot call when the
// answer asks to wait longer than oneShotMaxWait ("retry-after: 30"): the
// person gets the busy message now, not after 30 s and a second request.
func noLongWait(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
	res, err := next(req)
	if err != nil || res == nil || req.Context().Value(oneShotKey{}) == nil {
		return res, err
	}
	if wait, ok := retryAfter(res.Header); ok && wait > oneShotMaxWait {
		res.Header.Set("x-should-retry", "false")
	}
	return res, err
}

// retryAfter reads retry-after-ms, or retry-after in seconds or as a date.
func retryAfter(h http.Header) (time.Duration, bool) {
	if ms, err := strconv.ParseFloat(h.Get("retry-after-ms"), 64); err == nil {
		return time.Duration(ms * float64(time.Millisecond)), true
	}
	value := h.Get("retry-after")
	if secs, err := strconv.ParseFloat(value, 64); err == nil {
		return time.Duration(secs * float64(time.Second)), true
	}
	if at, err := time.Parse(time.RFC1123, value); err == nil {
		return time.Until(at), true
	}
	return 0, false
}

func (p *Anthropic) client() anthropic.Client {
	opts := []option.RequestOption{option.WithAPIKey(p.Key), option.WithMaxRetries(1), option.WithRequestTimeout(4 * time.Minute), option.WithMiddleware(noLongWait)}
	if p.Client != nil {
		opts = append(opts, option.WithHTTPClient(p.Client))
	}
	if p.Base != "" {
		opts = append(opts, option.WithBaseURL(p.Base))
	}
	return anthropic.NewClient(opts...)
}

func (p *Anthropic) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	if search && !p.Search {
		return chat.WireMessage{}, fmt.Errorf("Web search is not available with %s. Turn web search off for this chat, or choose OpenRouter, Anthropic API, Claude Code or Codex in Settings → Agent", p.label())
	}
	reply, err := p.completeOnce(ctx, messages, tools, search, true)
	var apiErr *anthropic.Error
	if err != nil && errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusBadRequest && hasThinking(messages) {
		if msg := strings.ToLower(apiErr.RawJSON()); strings.Contains(msg, "thinking") || strings.Contains(msg, "signature") {
			reply, err = p.completeOnce(ctx, messages, tools, search, false)
		}
	}
	if err != nil {
		if ctx.Err() != nil {
			return chat.WireMessage{}, ctx.Err()
		}
		return chat.WireMessage{}, anthropicError(p.label(), err)
	}
	return reply, nil
}

func hasThinking(messages []chat.WireMessage) bool {
	for _, m := range messages {
		if len(m.ThinkingBlocks) > 0 {
			return true
		}
	}
	return false
}

type thinkingBlock struct {
	Type      string `json:"type"`
	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"signature,omitempty"`
	Data      string `json:"data,omitempty"`
}

func (p *Anthropic) completeOnce(ctx context.Context, messages []chat.WireMessage, tools []any, search, replayThinking bool) (chat.WireMessage, error) {
	var empty chat.WireMessage
	// Thinking counts toward max_tokens, so allow more than the 8192 used
	// for models without it.
	params := anthropic.MessageNewParams{Model: anthropic.Model(p.Model), MaxTokens: 16384}
	params.System, params.Messages = anthropicMessages(messages, replayThinking)
	if len(params.Messages) == 0 {
		return empty, errors.New("Nothing to send to Anthropic")
	}
	for _, t := range tools {
		if tool, ok := anthropicTool(t); ok {
			params.Tools = append(params.Tools, anthropic.ToolUnionParam{OfTool: &tool})
		}
	}
	if search {
		params.Tools = append(params.Tools, anthropic.ToolUnionParam{OfWebSearchTool20250305: &anthropic.WebSearchTool20250305Param{MaxUses: anthropic.Int(5)}})
	}
	if p.Effort {
		// Interactive tool use: keep turns short, as the OpenRouter route does.
		params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortLow}
	}
	client := p.client()
	var once []option.RequestOption
	if chat.RetriesOff(ctx) {
		once = append(once, option.WithMaxRetries(0))
	}
	res, err := client.Messages.New(ctx, params, once...)
	if err != nil {
		return empty, err
	}
	switch res.StopReason {
	case anthropic.StopReasonMaxTokens:
		return empty, chat.ErrOutputTooLong
	case anthropic.StopReasonRefusal:
		return empty, chat.Final("The model declined this request")
	}
	out := chat.WireMessage{Role: "assistant"}
	var text strings.Builder
	seen := map[string]bool{}
	for _, block := range res.Content {
		switch b := block.AsAny().(type) {
		case anthropic.ThinkingBlock:
			raw, _ := json.Marshal(thinkingBlock{Type: "thinking", Thinking: b.Thinking, Signature: b.Signature})
			out.ThinkingBlocks = append(out.ThinkingBlocks, raw)
		case anthropic.RedactedThinkingBlock:
			raw, _ := json.Marshal(thinkingBlock{Type: "redacted_thinking", Data: b.Data})
			out.ThinkingBlocks = append(out.ThinkingBlocks, raw)
		case anthropic.TextBlock:
			text.WriteString(b.Text)
			for _, c := range b.Citations {
				if c.URL == "" || seen[c.URL] {
					continue
				}
				seen[c.URL] = true
				raw, _ := json.Marshal(map[string]any{"type": "url_citation", "url_citation": map[string]string{"url": c.URL, "title": c.Title}})
				out.Annotations = append(out.Annotations, raw)
			}
		case anthropic.ToolUseBlock:
			var tc chat.ToolCall
			tc.ID, tc.Type = b.ID, "function"
			tc.Function.Name = b.Name
			tc.Function.Arguments = b.JSON.Input.Raw()
			if strings.TrimSpace(tc.Function.Arguments) == "" {
				tc.Function.Arguments = "{}"
			}
			out.ToolCalls = append(out.ToolCalls, tc)
		}
	}
	out.Content = text.String()
	return out, nil
}

// anthropicMessages maps the OpenAI-style transcript onto Messages API turns:
// system text moves to the system field, tool results become tool_result
// blocks in a user turn, and adjacent same-role turns are merged.
func anthropicMessages(messages []chat.WireMessage, replayThinking bool) ([]anthropic.TextBlockParam, []anthropic.MessageParam) {
	var system []anthropic.TextBlockParam
	var out []anthropic.MessageParam
	add := func(role anthropic.MessageParamRole, blocks ...anthropic.ContentBlockParamUnion) {
		if len(blocks) == 0 {
			return
		}
		if n := len(out); n > 0 && out[n-1].Role == role {
			out[n-1].Content = append(out[n-1].Content, blocks...)
			return
		}
		out = append(out, anthropic.MessageParam{Role: role, Content: blocks})
	}
	for _, m := range messages {
		switch m.Role {
		case "system":
			if len(out) == 0 {
				if strings.TrimSpace(m.Content) != "" {
					system = append(system, anthropic.TextBlockParam{Text: m.Content})
				}
				continue
			}
			add(anthropic.MessageParamRoleUser, anthropic.NewTextBlock("System notice (not written by the user): "+m.Content))
		case "assistant":
			var blocks []anthropic.ContentBlockParamUnion
			for _, raw := range m.ThinkingBlocks {
				var tb thinkingBlock
				if !replayThinking || json.Unmarshal(raw, &tb) != nil {
					continue
				}
				if tb.Type == "redacted_thinking" {
					blocks = append(blocks, anthropic.NewRedactedThinkingBlock(tb.Data))
				} else if tb.Signature != "" {
					blocks = append(blocks, anthropic.NewThinkingBlock(tb.Signature, tb.Thinking))
				}
			}
			if strings.TrimSpace(m.Content) != "" {
				blocks = append(blocks, anthropic.NewTextBlock(m.Content))
			}
			for _, tc := range m.ToolCalls {
				input := json.RawMessage(tc.Function.Arguments)
				if !json.Valid(input) || !strings.HasPrefix(strings.TrimSpace(tc.Function.Arguments), "{") {
					input = json.RawMessage("{}")
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(tc.ID, input, tc.Function.Name))
			}
			add(anthropic.MessageParamRoleAssistant, blocks...)
		case "tool":
			add(anthropic.MessageParamRoleUser, anthropic.NewToolResultBlock(m.ToolCallID, m.Content, false))
		default:
			var blocks []anthropic.ContentBlockParamUnion
			for _, url := range m.ImageURLs {
				if mediaType, data, ok := splitDataURL(url); ok {
					blocks = append(blocks, anthropic.NewImageBlockBase64(mediaType, data))
				}
			}
			if strings.TrimSpace(m.Content) != "" || len(blocks) == 0 {
				blocks = append(blocks, anthropic.NewTextBlock(m.Content))
			}
			add(anthropic.MessageParamRoleUser, blocks...)
		}
	}
	return system, out
}

// anthropicTool converts an OpenAI-style function spec to a Messages API tool.
func anthropicTool(spec any) (anthropic.ToolParam, bool) {
	raw, err := json.Marshal(spec)
	if err != nil {
		return anthropic.ToolParam{}, false
	}
	var in struct {
		Function struct {
			Name        string         `json:"name"`
			Description string         `json:"description"`
			Parameters  map[string]any `json:"parameters"`
		} `json:"function"`
	}
	if json.Unmarshal(raw, &in) != nil || in.Function.Name == "" {
		return anthropic.ToolParam{}, false
	}
	schema := anthropic.ToolInputSchemaParam{ExtraFields: map[string]any{}}
	for key, value := range in.Function.Parameters {
		switch key {
		case "type":
		case "properties":
			schema.Properties = value
		case "required":
			if list, ok := value.([]any); ok {
				for _, item := range list {
					if name, ok := item.(string); ok {
						schema.Required = append(schema.Required, name)
					}
				}
			}
		default:
			schema.ExtraFields[key] = value
		}
	}
	if schema.Properties == nil {
		schema.Properties = map[string]any{}
	}
	tool := anthropic.ToolParam{Name: in.Function.Name, InputSchema: schema}
	if in.Function.Description != "" {
		tool.Description = anthropic.String(in.Function.Description)
	}
	return tool, true
}

func anthropicError(label string, err error) error {
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		return httpFailure(label, apiErr.StatusCode, []byte(apiErr.RawJSON()))
	}
	if strings.HasPrefix(err.Error(), "The ") {
		return err // already a Timely message
	}
	var netErr net.Error
	var syntax *json.SyntaxError
	if !errors.As(err, &netErr) && (errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &syntax)) {
		// The host answered, but the answer was cut off or garbled.
		return fmt.Errorf("%s's answer was cut off. Try again", label)
	}
	return fmt.Errorf("Could not reach %s: %w", label, err)
}

// anthropicModels lists the account's models with their image and effort
// support. A bad key fails here.
func anthropicModels(ctx context.Context, p *Anthropic) ([]ModelOption, map[string]bool, error) {
	client := p.client()
	pager := client.Models.ListAutoPaging(ctx, anthropic.ModelListParams{Limit: anthropic.Int(100)})
	out := []ModelOption{}
	effort := map[string]bool{}
	for pager.Next() {
		m := pager.Current()
		out = append(out, ModelOption{ID: m.ID, Name: m.DisplayName, Vision: m.Capabilities.ImageInput.Supported})
		effort[m.ID] = m.Capabilities.Effort.Low.Supported
	}
	if err := pager.Err(); err != nil {
		return nil, nil, anthropicError(p.label(), err)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, effort, nil
}
