package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"

	"timely-api/internal/features/chat"
)

// ollamaContext is the context window asked of Ollama. Its OpenAI-compatible
// endpoint cannot set one, and the default (4k on small GPUs) would silently
// cut Timely's system prompt, so Ollama is driven through native /api/chat.
func ollamaContext() int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("OLLAMA_NUM_CTX"))); err == nil && n >= 2048 {
		return n
	}
	return 32768
}

// Ollama talks to Ollama's native /api/chat, locally or on Ollama Cloud.
type Ollama struct {
	Spec   *apiProvider
	Base   string
	Key    string
	Model  string
	Client *http.Client
}

func (p *Ollama) CanSearch() bool { return false }

func (p *Ollama) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	if search {
		return chat.WireMessage{}, fmt.Errorf("Web search is not available with %s. Turn web search off for this chat, or choose OpenRouter, Anthropic API, Claude Code or Codex in Settings → Agent", p.Spec.Label)
	}
	return chat.RetryTransient(ctx, func() (chat.WireMessage, error) { return p.completeOnce(ctx, messages, tools) })
}

type ollamaToolCall struct {
	ID       string `json:"id,omitempty"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

func (p *Ollama) completeOnce(ctx context.Context, messages []chat.WireMessage, tools []any) (chat.WireMessage, error) {
	var empty chat.WireMessage
	names := map[string]string{} // tool call id → name, for tool results
	wire := make([]any, 0, len(messages))
	for _, m := range messages {
		out := map[string]any{"role": m.Role, "content": m.Content}
		for _, url := range m.ImageURLs {
			if _, data, ok := splitDataURL(url); ok {
				images, _ := out["images"].([]string)
				out["images"] = append(images, data)
			}
		}
		if len(m.ToolCalls) > 0 {
			calls := make([]ollamaToolCall, 0, len(m.ToolCalls))
			for _, tc := range m.ToolCalls {
				names[tc.ID] = tc.Function.Name
				var call ollamaToolCall
				call.ID, call.Function.Name = tc.ID, tc.Function.Name
				call.Function.Arguments = json.RawMessage(tc.Function.Arguments)
				if !json.Valid(call.Function.Arguments) {
					call.Function.Arguments = json.RawMessage("{}")
				}
				calls = append(calls, call)
			}
			out["tool_calls"] = calls
		}
		if m.Role == "tool" {
			out["tool_name"] = names[m.ToolCallID]
			out["tool_call_id"] = m.ToolCallID
		}
		wire = append(wire, out)
	}
	body := map[string]any{"model": p.Model, "messages": wire, "stream": false,
		"options": map[string]any{"num_ctx": ollamaContext(), "num_predict": 8192, "temperature": 0.2}}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(p.Base, "api/chat"), bytes.NewReader(raw))
	if err != nil {
		return empty, err
	}
	p.Spec.authorize(req, p.Key)
	req.Header.Set("Content-Type", "application/json")
	res, err := p.Client.Do(req)
	if err != nil {
		return empty, fmt.Errorf("Could not reach %s at %s: %w", p.Spec.Label, p.Base, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return empty, statusError(p.Spec.Label, res)
	}
	var data struct {
		Message struct {
			Content   string           `json:"content"`
			ToolCalls []ollamaToolCall `json:"tool_calls"`
		} `json:"message"`
		DoneReason string `json:"done_reason"`
		Error      string `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&data); err != nil {
		return empty, fmt.Errorf("%s answer could not be read: %w", p.Spec.Label, err)
	}
	if data.Error != "" {
		return empty, fmt.Errorf("%s: %s", p.Spec.Label, clip(data.Error))
	}
	if data.DoneReason == "length" {
		return empty, fmt.Errorf("The proposal was too large; try a smaller request")
	}
	out := chat.WireMessage{Role: "assistant", Content: data.Message.Content}
	for i, call := range data.Message.ToolCalls {
		var tc chat.ToolCall
		tc.ID, tc.Type = call.ID, "function"
		if tc.ID == "" {
			tc.ID = fmt.Sprintf("call_%d", i+1)
		}
		tc.Function.Name = call.Function.Name
		tc.Function.Arguments = "{}"
		if args := bytes.TrimSpace(call.Function.Arguments); len(args) > 0 && string(args) != "null" {
			var asString string
			if json.Unmarshal(args, &asString) == nil {
				tc.Function.Arguments = asString
			} else {
				tc.Function.Arguments = string(args)
			}
		}
		out.ToolCalls = append(out.ToolCalls, tc)
	}
	return out, nil
}

// ollamaModels lists installed (or cloud) models via /api/tags and keeps
// those whose /api/show capabilities include tools; vision is read from the
// same capabilities.
func ollamaModels(ctx context.Context, client *http.Client, spec *apiProvider, base, key string) ([]ModelOption, error) {
	get := func(method, path string, body any, out any) error {
		var reader io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		}
		req, err := http.NewRequestWithContext(ctx, method, joinURL(base, path), reader)
		if err != nil {
			return err
		}
		spec.authorize(req, key)
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("Could not reach %s at %s: %w", spec.Label, base, err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return statusError(spec.Label, res)
		}
		return json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(out)
	}
	var tags struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := get(http.MethodGet, "api/tags", nil, &tags); err != nil {
		return nil, err
	}
	if len(tags.Models) > 80 {
		tags.Models = tags.Models[:80]
	}
	out := make([]ModelOption, len(tags.Models))
	keep := make([]bool, len(tags.Models))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, m := range tags.Models {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var show struct {
				Capabilities []string `json:"capabilities"`
			}
			out[i] = ModelOption{ID: name, Name: name}
			if err := get(http.MethodPost, "api/show", map[string]string{"model": name}, &show); err != nil || len(show.Capabilities) == 0 {
				keep[i] = true // unknown: let the test call decide
				return
			}
			keep[i] = contains(show.Capabilities, "tools")
			out[i].Vision = contains(show.Capabilities, "vision")
			if !keep[i] {
				out[i].Note = "no tool calling"
			}
		}(i, m.Name)
	}
	wg.Wait()
	list := []ModelOption{}
	for i := range out {
		if keep[i] {
			list = append(list, out[i])
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return list, nil
}
