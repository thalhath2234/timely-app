package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	Cache  bool   // prompt caching: messages marked Cache become breakpoints (Anthropic itself)
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

// maxRetryWait is the longest a retry waits on a 429 or 529's retry-after.
// The SDK would sleep as long as the hint says (15 minutes left a chat
// "thinking" until the run timed out); past this the error comes back at
// once, saying the provider is rate limiting or busy.
const maxRetryWait = 30 * time.Second

// boundedRetry stops the SDK's retry when the response asks to wait longer
// than maxRetryWait.
func boundedRetry(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
	res, err := next(req)
	if err == nil && res != nil && retryWait(res.Header) > maxRetryWait {
		res.Header.Set("x-should-retry", "false")
	}
	return res, err
}

// retryWait reads a response's retry-after-ms or retry-after header (seconds
// or an HTTP date), 0 when it has none.
func retryWait(h http.Header) time.Duration {
	if ms, err := strconv.ParseFloat(h.Get("Retry-After-Ms"), 64); err == nil {
		return time.Duration(ms * float64(time.Millisecond))
	}
	value := h.Get("Retry-After")
	if seconds, err := strconv.ParseFloat(value, 64); err == nil {
		return time.Duration(seconds * float64(time.Second))
	}
	if at, err := http.ParseTime(value); err == nil {
		return time.Until(at)
	}
	return 0
}

func (p *Anthropic) client() anthropic.Client {
	opts := []option.RequestOption{option.WithAPIKey(p.Key), option.WithMaxRetries(1), option.WithRequestTimeout(4 * time.Minute), option.WithMiddleware(boundedRetry)}
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
	params.System, params.Messages = anthropicMessages(messages, replayThinking, p.Cache)
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
	out := chat.WireMessage{Role: "assistant"}
	var text strings.Builder
	seen := map[string]bool{}
	for pauses := 0; ; pauses++ {
		res, err := client.Messages.New(ctx, params)
		if err != nil {
			return empty, err
		}
		if err := stopError(res); err != nil {
			return empty, err
		}
		collect(res, &out, &text, seen)
		if res.StopReason != anthropic.StopReasonPauseTurn {
			break
		}
		// A long server-side search pauses the turn: send it back as it is
		// and the model carries on from there.
		if pauses == maxPauses {
			return empty, stopped(unfinished)
		}
		params.Messages = append(params.Messages, res.ToParam())
	}
	out.Content = text.String()
	return out, nil
}

// maxPauses is how many times one answer may continue after pause_turn.
const maxPauses = 2

// stopError is the error for an answer that stopped before it was whole.
// pause_turn is not one: completeOnce continues it.
func stopError(res *anthropic.Message) error {
	switch res.StopReason {
	case "", anthropic.StopReasonEndTurn, anthropic.StopReasonToolUse, anthropic.StopReasonStopSequence, anthropic.StopReasonPauseTurn:
		return nil
	case anthropic.StopReasonMaxTokens:
		for _, block := range res.Content {
			if block.Type == "tool_use" {
				return stopped("The proposal was too large; try a smaller request")
			}
		}
		return stopped("The answer got too long and was cut off. Try asking for less at a time")
	case anthropic.StopReasonRefusal:
		return stopped("The model declined this request")
	case anthropic.StopReasonModelContextWindowExceeded:
		return stopped("This chat is too long for the AI to read. Start a new chat to continue")
	}
	return stopped(unfinished)
}

const unfinished = "The AI stopped before finishing its answer. Try again"

// stopped is why an answer that did arrive cannot be used. It is shown as
// it is: the provider was reached.
type stopped string

func (s stopped) Error() string { return string(s) }

// collect adds a response's blocks to out: text to text, citations as
// annotations (each URL once), thinking blocks and tool calls.
func collect(res *anthropic.Message, out *chat.WireMessage, text *strings.Builder, seen map[string]bool) {
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
}

// maxCacheBreakpoints is the most cache_control markers one request may carry.
const maxCacheBreakpoints = 4

// anthropicMessages maps the OpenAI-style transcript onto Messages API turns:
// system text moves to the system field, tool results become tool_result
// blocks in a user turn, and adjacent same-role turns are merged. With cache
// on, the last block of each message marked Cache gets cache_control, so the
// prompt up to it is cached (tools render first, so a mark on the system
// prompt caches the tools too).
func anthropicMessages(messages []chat.WireMessage, replayThinking, cache bool) ([]anthropic.TextBlockParam, []anthropic.MessageParam) {
	var system []anthropic.TextBlockParam
	var out []anthropic.MessageParam
	// marks are the blocks that end a cached prefix: msg -1 is a system block.
	type mark struct{ msg, block int }
	var marks []mark
	add := func(role anthropic.MessageParamRole, blocks ...anthropic.ContentBlockParamUnion) bool {
		if len(blocks) == 0 {
			return false
		}
		if n := len(out); n > 0 && out[n-1].Role == role {
			out[n-1].Content = append(out[n-1].Content, blocks...)
			return true
		}
		out = append(out, anthropic.MessageParam{Role: role, Content: blocks})
		return true
	}
	// added notes a mark on the block just added for a message marked Cache.
	added := func(m chat.WireMessage, ok bool) {
		if ok && m.Cache && cache {
			n := len(out) - 1
			marks = append(marks, mark{msg: n, block: len(out[n].Content) - 1})
		}
	}
	for _, m := range messages {
		switch m.Role {
		case "system":
			if len(out) == 0 {
				if strings.TrimSpace(m.Content) != "" {
					system = append(system, anthropic.TextBlockParam{Text: m.Content})
					if m.Cache && cache {
						marks = append(marks, mark{msg: -1, block: len(system) - 1})
					}
				}
				continue
			}
			added(m, add(anthropic.MessageParamRoleUser, anthropic.NewTextBlock("System notice (not written by the user): "+m.Content)))
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
			added(m, add(anthropic.MessageParamRoleAssistant, blocks...))
		case "tool":
			added(m, add(anthropic.MessageParamRoleUser, anthropic.NewToolResultBlock(m.ToolCallID, m.Content, false)))
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
			added(m, add(anthropic.MessageParamRoleUser, blocks...))
		}
	}
	// Past the limit, keep the first mark (the system prompt, reused across
	// conversations) and the latest ones (the conversation so far).
	if len(marks) > maxCacheBreakpoints {
		marks = append(marks[:1], marks[len(marks)-maxCacheBreakpoints+1:]...)
	}
	for _, at := range marks {
		if at.msg < 0 {
			system[at.block].CacheControl = anthropic.NewCacheControlEphemeralParam()
		} else if cc := out[at.msg].Content[at.block].GetCacheControl(); cc != nil {
			// Thinking blocks take no cache_control; such a mark is dropped.
			*cc = anthropic.NewCacheControlEphemeralParam()
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
		msg := errorText([]byte(apiErr.RawJSON()))
		if msg == "" {
			msg = http.StatusText(apiErr.StatusCode)
		}
		switch apiErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return fmt.Errorf("%s rejected the request (HTTP %d): %s", label, apiErr.StatusCode, msg)
		case http.StatusTooManyRequests:
			return fmt.Errorf("%s is rate limiting this key (HTTP 429): %s%s", label, msg, waitHint(apiErr.Response))
		}
		return fmt.Errorf("%s returned HTTP %d: %s", label, apiErr.StatusCode, msg)
	}
	var answer stopped
	if errors.As(err, &answer) || strings.HasPrefix(err.Error(), "The ") {
		return err // already a Timely message
	}
	return fmt.Errorf("Could not reach %s: %w", label, err)
}

// waitHint says how long a rate-limited key should wait, from a retry-after
// over maxRetryWait (shorter waits are retried, so they never show).
func waitHint(res *http.Response) string {
	if res == nil {
		return ""
	}
	wait := retryWait(res.Header)
	if wait <= maxRetryWait {
		return ""
	}
	if minutes := int((wait + time.Minute - 1) / time.Minute); minutes > 1 {
		return fmt.Sprintf(". Try again in about %d minutes", minutes)
	}
	return ". Try again in a minute"
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
