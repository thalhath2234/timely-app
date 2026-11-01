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
	"sync"
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
// without them, and those blocks are left out of the later turns of the run
// (one Anthropic value serves a whole run), so each turn makes one call.
type Anthropic struct {
	Key    string
	Model  string
	Base   string // overridable for tests
	Effort bool   // the model accepts output_config.effort
	Search bool   // server-side web search is available (Anthropic itself)
	Cache  bool   // prompt caching: messages marked Cache become breakpoints (Anthropic itself)
	Label  string // provider name in errors; "Anthropic" when empty
	Client *http.Client

	mu       sync.Mutex
	rejected map[string]bool // thinking blocks the API refused, by their JSON
}

// maxRetryWait is the longest a retry waits when the API asks to be called
// back later (a 429 or 529's retry-after). The SDK would sleep as long as the
// hint says (15 minutes left a chat "thinking" until the run timed out); a
// longer retry-after fails at once, saying the provider is rate limiting or
// busy, so a person never waits minutes for an error.
const maxRetryWait = 10 * time.Second

// maxContinues bounds how often a turn the API paused (pause_turn: its own
// web search loop ran long) is sent back to be finished.
const maxContinues = 3

func (p *Anthropic) CanSearch() bool { return p.Search }

func (p *Anthropic) label() string {
	if p.Label != "" {
		return p.Label
	}
	return "Anthropic"
}

type oneShotKey struct{}

// oneShot marks a call a person waits on in a panel: Help me write, view
// queries, checklist names and card descriptions. Its retry sits out a
// shorter wait than other calls' (boundedRetry).
func oneShot(ctx context.Context) context.Context {
	return context.WithValue(ctx, oneShotKey{}, true)
}

// oneShotMaxWait is the longest retry-after a one-shot call sits out: the
// person gets the busy message now, not after 30 s and a second request.
const oneShotMaxWait = 5 * time.Second

// boundedRetry stops the SDK's automatic retry when the answer asks to wait
// longer than the call allows: oneShotMaxWait for a one-shot call,
// maxRetryWait for the rest.
func boundedRetry(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
	res, err := next(req)
	if err != nil || res == nil || res.StatusCode < 400 {
		return res, err
	}
	limit := maxRetryWait
	if req.Context().Value(oneShotKey{}) != nil {
		limit = oneShotMaxWait
	}
	if wait, ok := retryAfter(res.Header); ok && wait > limit {
		res.Header.Set("x-should-retry", "false")
	}
	return res, err
}

// retryAfter reads retry-after-ms, or retry-after in seconds or as an HTTP
// date.
func retryAfter(h http.Header) (time.Duration, bool) {
	if ms, err := strconv.ParseFloat(h.Get("retry-after-ms"), 64); err == nil {
		return time.Duration(ms * float64(time.Millisecond)), true
	}
	value := h.Get("retry-after")
	if secs, err := strconv.ParseFloat(value, 64); err == nil {
		return time.Duration(secs * float64(time.Second)), true
	}
	if at, err := http.ParseTime(value); err == nil {
		return time.Until(at), true
	}
	return 0, false
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
	if err != nil && errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusBadRequest && p.replays(messages) {
		if msg := strings.ToLower(apiErr.RawJSON()); strings.Contains(msg, "thinking") || strings.Contains(msg, "signature") {
			reply, err = p.completeOnce(ctx, messages, tools, search, false)
			if err == nil {
				p.reject(messages)
			}
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

// replays reports whether a request would carry any thinking block.
func (p *Anthropic) replays(messages []chat.WireMessage) bool {
	for _, m := range messages {
		for _, raw := range m.ThinkingBlocks {
			if !p.isRejected(raw) {
				return true
			}
		}
	}
	return false
}

// reject remembers the thinking blocks of a request the API refused for
// them, so the later turns of this run leave them out instead of failing
// first. Blocks from replies after this one are still replayed.
func (p *Anthropic) reject(messages []chat.WireMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.rejected == nil {
		p.rejected = map[string]bool{}
	}
	for _, m := range messages {
		for _, raw := range m.ThinkingBlocks {
			p.rejected[string(raw)] = true
		}
	}
}

func (p *Anthropic) isRejected(raw json.RawMessage) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.rejected[string(raw)]
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
	params.System, params.Messages = anthropicMessages(messages, replayThinking, p.Cache, p.isRejected)
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
	out := chat.WireMessage{Role: "assistant"}
	var text strings.Builder
	seen := map[string]bool{}
	for pauses := 0; ; pauses++ {
		res, err := client.Messages.New(ctx, params, once...)
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
		if pauses == maxContinues {
			return empty, stopped("The web search took too many steps to finish. Try again, or ask a narrower question")
		}
		params.Messages = append(params.Messages, res.ToParam())
	}
	out.Content = text.String()
	return out, nil
}

// stopError is the error for an answer that stopped before it was whole.
// pause_turn is not one: completeOnce continues it.
func stopError(res *anthropic.Message) error {
	switch res.StopReason {
	case "", anthropic.StopReasonEndTurn, anthropic.StopReasonToolUse, anthropic.StopReasonStopSequence, anthropic.StopReasonPauseTurn:
		return nil
	case anthropic.StopReasonMaxTokens:
		// Both are chat.ErrOutputTooLong, which each feature words for itself;
		// a cut-off text answer says so in the chat.
		for _, block := range res.Content {
			if block.Type == "tool_use" {
				return chat.ErrOutputTooLong
			}
		}
		return chat.ErrAnswerTooLong
	case anthropic.StopReasonRefusal:
		return chat.Final("The model declined this request")
	case anthropic.StopReasonModelContextWindowExceeded:
		return chat.ErrInputTooLong
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
// prompt caches the tools too). rejected, when set, names thinking blocks to
// leave out.
func anthropicMessages(messages []chat.WireMessage, replayThinking, cache bool, rejected func(json.RawMessage) bool) ([]anthropic.TextBlockParam, []anthropic.MessageParam) {
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
				if !replayThinking || (rejected != nil && rejected(raw)) || json.Unmarshal(raw, &tb) != nil {
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
		if apiErr.StatusCode == http.StatusTooManyRequests {
			if hint := waitHint(apiErr.Response); hint != "" {
				return fmt.Errorf("%s is rate limiting this key (HTTP 429)%s", label, hint)
			}
		}
		if apiErr.StatusCode == 529 {
			return fmt.Errorf("%s is overloaded right now (HTTP 529). Try again in a minute", label)
		}
		return httpFailure(label, apiErr.StatusCode, []byte(apiErr.RawJSON()))
	}
	var answer stopped
	if errors.As(err, &answer) || strings.HasPrefix(err.Error(), "The ") || strings.HasPrefix(err.Error(), "This ") {
		return err // already a Timely message
	}
	var netErr net.Error
	var syntax *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	if !errors.As(err, &netErr) && (errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &syntax)) {
		// The host answered, but the answer was cut off or garbled.
		return fmt.Errorf("%s's answer was cut off. Try again", label)
	}
	if errors.As(err, &typeErr) || strings.Contains(err.Error(), "error parsing response json") {
		return fmt.Errorf("%s sent an answer Timely could not read. Try again", label)
	}
	return fmt.Errorf("Could not reach %s: %w", label, err)
}

// waitHint says how long a rate-limited key should wait, from a retry-after
// over maxRetryWait (shorter waits are retried, so they never show).
func waitHint(res *http.Response) string {
	if res == nil {
		return ""
	}
	wait, ok := retryAfter(res.Header)
	if !ok || wait <= maxRetryWait {
		return ""
	}
	return ". Try again in " + waitText(wait)
}

// waitText says a retry-after wait in words.
func waitText(wait time.Duration) string {
	if wait < 2*time.Minute {
		return fmt.Sprintf("about %d seconds", int(wait.Round(time.Second)/time.Second))
	}
	return fmt.Sprintf("about %d minutes", int(wait.Round(time.Minute)/time.Minute))
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
