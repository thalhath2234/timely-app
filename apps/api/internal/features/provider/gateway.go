package provider

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"timely-api/internal/features/chat"
)

// Gateway is the loopback model endpoint for agent-engine runs whose
// provider is a host CLI, Claude Code or Codex (plan 5.7), and for every
// Sensitive run whatever its provider (phase 4 decision 11). Hermes speaks
// OpenAI chat completions to it, and it answers through the same Completer
// the classic engine uses, so the person's own CLI login does the work and a
// Sensitive run gets classic's Sensitive handling (zero data retention on
// OpenRouter, no web search).
//
// It runs on its own http.Server bound to 127.0.0.1 on a port the OS picks,
// apart from the main router, which listens on every API_BIND address
// (Tailscale included). A caller needs the secret AgentModelFor hands the
// worker in run.start, which names one account, provider, model and whether
// the run is Sensitive.
type Gateway struct {
	ln   net.Listener
	srv  *http.Server
	base string
	// completer builds the account's Completer (Service.Completer).
	completer func(ctx context.Context, uid, provider, model string) (chat.Completer, error)

	mu     sync.Mutex
	grants map[string]gatewayGrant // secret -> who it serves
	issued map[gatewayGrant]string // who -> secret, so a worker's cached agent keeps one key
}

// gatewayGrant is who a secret serves. A Sensitive and an ordinary run on the
// same model get different secrets, so the gateway knows which it answers.
type gatewayGrant struct {
	uid, provider, model string
	sensitive            bool
}

// gatewayContextLength is the window /v1/models reports, so Hermes sizes
// its context compression for the CLI's models.
const gatewayContextLength = 200000

// gatewayBodyLimit bounds one request: Hermes' prompt and tool schemas are
// tens of KB, a long session a few MB.
const gatewayBodyLimit = 32 << 20

// StartAgentGateway starts the loopback gateway; AgentModelFor then serves
// Claude Code and Codex chats, and Sensitive runs, on the agent engine.
func (s *Service) StartAgentGateway() (*Gateway, error) {
	g, err := newGateway(s.Completer)
	if err != nil {
		return nil, err
	}
	s.gateway = g
	return g, nil
}

// newGateway starts a gateway answering with completer. wrap, for tests,
// wraps its handler (to watch the requests a real worker sends).
func newGateway(completer func(ctx context.Context, uid, provider, model string) (chat.Completer, error), wrap ...func(http.Handler) http.Handler) (*Gateway, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("agent model gateway: %w", err)
	}
	g := &Gateway{ln: ln, base: "http://" + ln.Addr().String() + "/v1", completer: completer,
		grants: map[string]gatewayGrant{}, issued: map[gatewayGrant]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", g.completions)
	mux.HandleFunc("GET /v1/models", g.models)
	var handler http.Handler = mux
	for _, w := range wrap {
		handler = w(handler)
	}
	g.srv = &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = g.srv.Serve(ln) }()
	return g, nil
}

// Close stops the gateway.
func (g *Gateway) Close(ctx context.Context) error { return g.srv.Shutdown(ctx) }

// BaseURL is the OpenAI base the worker calls ("http://127.0.0.1:<port>/v1").
func (g *Gateway) BaseURL() string { return g.base }

// grant is the secret for one account, provider, model and Sensitive flag,
// made once per process.
func (g *Gateway) grant(uid, provider, model string, sensitive bool) string {
	who := gatewayGrant{uid, provider, model, sensitive}
	g.mu.Lock()
	defer g.mu.Unlock()
	if secret, ok := g.issued[who]; ok {
		return secret
	}
	var b [32]byte
	_, _ = rand.Read(b[:])
	secret := "tgw-" + hex.EncodeToString(b[:])
	g.grants[secret] = who
	g.issued[who] = secret
	return secret
}

func (g *Gateway) caller(r *http.Request) (gatewayGrant, bool) {
	secret, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return gatewayGrant{}, false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	who, ok := g.grants[strings.TrimSpace(secret)]
	return who, ok
}

func gatewayError(w http.ResponseWriter, status int, kind, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": msg, "type": kind}})
}

func (g *Gateway) models(w http.ResponseWriter, r *http.Request) {
	who, ok := g.caller(r)
	if !ok {
		gatewayError(w, http.StatusUnauthorized, "invalid_api_key", "Unknown key")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []any{
		map[string]any{"id": who.model, "object": "model", "owned_by": who.provider, "context_length": gatewayContextLength},
	}})
}

// gatewayMessage is one OpenAI chat message as Hermes sends it.
type gatewayMessage struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCalls  []chat.ToolCall `json:"tool_calls"`
	ToolCallID string          `json:"tool_call_id"`
}

// wire turns an OpenAI message into the Completer's: content as text (a
// list of parts joined, images kept as data URLs), "developer" as system.
func (m gatewayMessage) wire() chat.WireMessage {
	out := chat.WireMessage{Role: m.Role, ToolCalls: m.ToolCalls, ToolCallID: m.ToolCallID}
	if out.Role == "developer" {
		out.Role = "system"
	}
	var text string
	if json.Unmarshal(m.Content, &text) == nil {
		out.Content = text
		return out
	}
	var parts []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if json.Unmarshal(m.Content, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			switch p.Type {
			case "text", "input_text":
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.WriteString(p.Text)
			case "image_url":
				if strings.HasPrefix(p.ImageURL.URL, "data:") {
					out.ImageURLs = append(out.ImageURLs, p.ImageURL.URL)
				}
			}
		}
		out.Content = b.String()
	}
	return out
}

func (g *Gateway) completions(w http.ResponseWriter, r *http.Request) {
	who, ok := g.caller(r)
	if !ok {
		gatewayError(w, http.StatusUnauthorized, "invalid_api_key", "Unknown key")
		return
	}
	var in struct {
		Model    string            `json:"model"`
		Messages []gatewayMessage  `json:"messages"`
		Tools    []json.RawMessage `json:"tools"`
		Stream   bool              `json:"stream"`
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, gatewayBodyLimit+1))
	if err != nil || len(body) > gatewayBodyLimit || json.Unmarshal(body, &in) != nil || len(in.Messages) == 0 {
		gatewayError(w, http.StatusBadRequest, "invalid_request_error", "Unreadable chat completions request")
		return
	}
	if in.Model != "" && in.Model != who.model {
		gatewayError(w, http.StatusBadRequest, "invalid_request_error", fmt.Sprintf("This key serves %s, not %s", who.model, in.Model))
		return
	}
	messages := make([]chat.WireMessage, len(in.Messages))
	for i, m := range in.Messages {
		messages[i] = m.wire()
		// A Sensitive grant marks every message, as classic marks a
		// Sensitive chat's: OpenRouter then asks for zero data retention.
		messages[i].Sensitive = who.sensitive
	}
	tools := make([]any, 0, len(in.Tools))
	for _, t := range in.Tools {
		var tool any
		if json.Unmarshal(t, &tool) == nil {
			tools = append(tools, tool)
		}
	}
	completer, err := g.completer(r.Context(), who.uid, who.provider, who.model)
	if err != nil {
		gatewayError(w, http.StatusBadRequest, "provider_unavailable", err.Error())
		return
	}
	// No web search through the gateway: Hermes has its own web tools, and a
	// Sensitive run must never search.
	reply, err := completer.Complete(r.Context(), messages, tools, false)
	if err != nil {
		if errors.Is(r.Context().Err(), context.Canceled) {
			return // Hermes hung up (Stop)
		}
		gatewayError(w, http.StatusBadGateway, "provider_error", err.Error())
		return
	}
	calls := make([]map[string]any, len(reply.ToolCalls))
	for i, call := range reply.ToolCalls {
		id := call.ID
		if id == "" {
			id = fmt.Sprintf("call_%d_%d", time.Now().UnixNano(), i)
		}
		args := call.Function.Arguments
		if strings.TrimSpace(args) == "" {
			args = "{}"
		}
		calls[i] = map[string]any{"id": id, "type": "function", "function": map[string]any{"name": call.Function.Name, "arguments": args}}
	}
	finish := "stop"
	if len(calls) > 0 {
		finish = "tool_calls"
	}
	id := fmt.Sprintf("chatcmpl-%d", time.Now().UnixNano())
	created := time.Now().Unix()
	usage := map[string]int{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
	if !in.Stream {
		message := map[string]any{"role": "assistant", "content": reply.Content}
		if len(calls) > 0 {
			message["tool_calls"] = calls
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "object": "chat.completion", "created": created, "model": who.model,
			"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": usage})
		return
	}
	// The CLI answers in one piece, so the stream is that answer in one
	// content chunk, then the tool calls, then the finish.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	chunk := func(delta map[string]any, finish any, extra map[string]any) {
		event := map[string]any{"id": id, "object": "chat.completion.chunk", "created": created, "model": who.model,
			"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}}
		for k, v := range extra {
			event[k] = v
		}
		b, _ := json.Marshal(event)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
	}
	chunk(map[string]any{"role": "assistant", "content": reply.Content}, nil, nil)
	for i, call := range calls {
		call["index"] = i
		chunk(map[string]any{"tool_calls": []any{call}}, nil, nil)
	}
	chunk(map[string]any{}, finish, map[string]any{"usage": usage})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
