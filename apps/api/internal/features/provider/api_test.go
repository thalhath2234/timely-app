package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
)

// transcript has every field any provider ever returns, so a test can check
// that each provider receives only its own.
func transcript() []chat.WireMessage {
	call := chat.ToolCall{ID: "call_1", Type: "function", ExtraContent: json.RawMessage(`{"google":{"thought_signature":"sig"}}`)}
	call.Function.Name = "list_tasks"
	call.Function.Arguments = `{"limit":5}`
	return []chat.WireMessage{
		{Role: "system", Content: "Be brief."},
		{Role: "user", Content: "What is due?", ImageURLs: []string{"data:image/jpeg;base64,QUJD"}},
		{Role: "assistant", ToolCalls: []chat.ToolCall{call}, ReasoningContent: "thinking", Annotations: []json.RawMessage{json.RawMessage(`{"x":1}`)}, ReasoningDetails: []json.RawMessage{json.RawMessage(`{"y":1}`)}},
		{Role: "tool", ToolCallID: "call_1", Content: `{"tasks":[]}`},
	}
}

func fakeCompat(t *testing.T, reply string, inspect func(map[string]any, *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		inspect(body, r)
		_, _ = w.Write([]byte(reply))
	}))
}

func TestCompatSendsOnlyEachProvidersOwnFields(t *testing.T) {
	for _, tc := range []struct {
		id                     string
		reasoning, extra       bool
		tokensField            string
		temperature            bool
		imagePart, keyedHeader bool
	}{
		{id: "xai", tokensField: "max_completion_tokens"},
		{id: "kimi", reasoning: true, tokensField: "max_tokens"},
		{id: "deepseek", reasoning: true, tokensField: "max_tokens", temperature: true},
		{id: "gemini", extra: true, tokensField: "max_tokens"},
		{id: "mistral", tokensField: "max_tokens", temperature: true},
	} {
		spec := apiProviderByID(tc.id)
		server := fakeCompat(t, `{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`, func(body map[string]any, r *http.Request) {
			if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer key-123456" {
				t.Errorf("%s: %s %q", tc.id, r.URL.Path, r.Header.Get("Authorization"))
			}
			if _, ok := body[tc.tokensField]; !ok {
				t.Errorf("%s: missing %s in %v", tc.id, tc.tokensField, body)
			}
			if _, ok := body["temperature"]; ok != tc.temperature {
				t.Errorf("%s: temperature sent=%v", tc.id, ok)
			}
			for _, field := range []string{"reasoning", "provider", "plugins"} {
				if _, ok := body[field]; ok {
					t.Errorf("%s: OpenRouter-only field %q sent", tc.id, field)
				}
			}
			messages := body["messages"].([]any)
			user := messages[1].(map[string]any)
			if parts, ok := user["content"].([]any); !ok || len(parts) != 2 {
				t.Errorf("%s: image must travel as a content part: %v", tc.id, user)
			}
			assistant := messages[2].(map[string]any)
			for _, field := range []string{"annotations", "reasoning_details"} {
				if _, ok := assistant[field]; ok {
					t.Errorf("%s: %s leaked", tc.id, field)
				}
			}
			if _, ok := assistant["reasoning_content"]; ok != tc.reasoning {
				t.Errorf("%s: reasoning_content sent=%v", tc.id, ok)
			}
			if _, ok := assistant["content"]; ok {
				t.Errorf("%s: empty assistant content must be omitted beside tool calls", tc.id)
			}
			callJSON := assistant["tool_calls"].([]any)[0].(map[string]any)
			if _, ok := callJSON["extra_content"]; ok != tc.extra {
				t.Errorf("%s: extra_content sent=%v", tc.id, ok)
			}
			if messages[3].(map[string]any)["tool_call_id"] != "call_1" {
				t.Errorf("%s: tool result lost its id", tc.id)
			}
		})
		p := &Compat{Spec: spec, Base: server.URL, Key: "key-123456", Model: "m", Client: server.Client()}
		got, err := p.Complete(context.Background(), transcript(), []any{map[string]any{"type": "function", "function": map[string]any{"name": "list_tasks"}}}, false)
		server.Close()
		if err != nil || got.Content != "OK" {
			t.Fatalf("%s: %v %v", tc.id, got, err)
		}
	}
}

func TestCompatKeepsReasoningAndSignaturesForTheNextTurn(t *testing.T) {
	reply := `{"choices":[{"message":{"role":"assistant","content":"","reasoning_content":"plan","tool_calls":[{"id":"c1","type":"function","function":{"name":"list_tasks","arguments":""},"extra_content":{"google":{"thought_signature":"abc"}}}]},"finish_reason":"tool_calls"}]}`
	for _, id := range []string{"deepseek", "gemini", "xai"} {
		server := fakeCompat(t, reply, func(map[string]any, *http.Request) {})
		p := &Compat{Spec: apiProviderByID(id), Base: server.URL, Key: "k", Model: "m", Client: server.Client()}
		got, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
		server.Close()
		if err != nil || len(got.ToolCalls) != 1 {
			t.Fatalf("%s: %v %v", id, got, err)
		}
		if got.ToolCalls[0].Function.Arguments != "{}" {
			t.Errorf("%s: empty arguments must become {}", id)
		}
		if (got.ReasoningContent == "plan") != (id == "deepseek") {
			t.Errorf("%s: reasoning kept=%q", id, got.ReasoningContent)
		}
		if (len(got.ToolCalls[0].ExtraContent) > 0) != (id == "gemini") {
			t.Errorf("%s: signature kept=%s", id, got.ToolCalls[0].ExtraContent)
		}
	}
}

func TestCompatQuotesTheProvidersError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`[{"error":{"code":400,"message":"Model gemini-9 is not found","status":"INVALID_ARGUMENT"}}]`))
	}))
	defer server.Close()
	p := &Compat{Spec: apiProviderByID("gemini"), Base: server.URL, Key: "k", Model: "gemini-9", Client: server.Client()}
	_, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "Google Gemini returned HTTP 400: Model gemini-9 is not found") {
		t.Fatalf("%v", err)
	}
}

func TestCompatHasNoWebSearch(t *testing.T) {
	p := &Compat{Spec: apiProviderByID("deepseek")}
	if p.CanSearch() {
		t.Fatal("direct providers must not offer web search")
	}
	if _, err := p.Complete(context.Background(), nil, nil, true); err == nil || !strings.Contains(err.Error(), "Web search is not available with DeepSeek") {
		t.Fatalf("%v", err)
	}
}

func TestCompatModelListsFilterAndNormalise(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"message":"Incorrect API key provided"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"object":"list","data":[
			{"id":"models/gemini-2.5-flash","display_name":"Gemini 2.5 Flash"},
			{"id":"models/text-embedding-004"},
			{"id":"mistral-small","name":"Mistral Small","capabilities":{"function_calling":true,"vision":true}},
			{"id":"mistral-embed-2","capabilities":{"function_calling":false}},
			{"id":"kimi-k2","supports_image_in":false}
		]}`))
	}))
	defer server.Close()
	spec := &apiProvider{ID: "t", Label: "Test", ModelsPath: "models", Skip: nonChat}
	if _, err := fetchCompatModels(context.Background(), server.Client(), spec, server.URL, "bad"); err == nil || !strings.Contains(err.Error(), "Incorrect API key provided") {
		t.Fatalf("a bad key must fail with the provider's message: %v", err)
	}
	list, err := fetchCompatModels(context.Background(), server.Client(), spec, server.URL, "good")
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, m := range list {
		ids = append(ids, m.ID)
		if m.ID == "mistral-small" && !m.Vision {
			t.Error("vision capability ignored")
		}
	}
	if strings.Join(ids, ",") != "gemini-2.5-flash,mistral-small,kimi-k2" {
		t.Fatalf("got %v", ids)
	}
}

func TestAnthropicMapsTheTranscriptToMessages(t *testing.T) {
	var seen map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/messages" || r.Header.Get("X-Api-Key") != "sk-ant-test" || r.Header.Get("Anthropic-Version") == "" {
			t.Errorf("%s key=%q version=%q", r.URL.Path, r.Header.Get("X-Api-Key"), r.Header.Get("Anthropic-Version"))
		}
		_ = json.NewDecoder(r.Body).Decode(&seen)
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","stop_reason":"tool_use","content":[
			{"type":"thinking","thinking":"","signature":"sig"},
			{"type":"text","text":"Checking.","citations":[{"type":"web_search_result_location","url":"https://example.com","title":"Ex","cited_text":"x","encrypted_index":"e"}]},
			{"type":"tool_use","id":"toolu_2","name":"list_tasks","input":{"limit":3}}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()
	tools := []any{map[string]any{"type": "function", "function": map[string]any{"name": "list_tasks", "description": "List tasks", "parameters": map[string]any{"type": "object", "properties": map[string]any{"limit": map[string]any{"type": "integer"}}, "required": []any{"limit"}, "additionalProperties": false}}}}
	p := &Anthropic{Key: "sk-ant-test", Model: "claude-opus-5-5", Base: server.URL, Effort: true, Search: true, Client: server.Client()}
	got, err := p.Complete(context.Background(), transcript(), tools, true)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "Checking." || len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Arguments != `{"limit":3}` || got.ToolCalls[0].ID != "toolu_2" {
		t.Fatalf("%+v", got)
	}
	if len(got.Annotations) != 1 || !strings.Contains(string(got.Annotations[0]), "https://example.com") {
		t.Fatalf("citations must become sources: %s", got.Annotations)
	}

	if system := seen["system"].([]any); len(system) != 1 || system[0].(map[string]any)["text"] != "Be brief." {
		t.Fatalf("system: %v", seen["system"])
	}
	if seen["output_config"].(map[string]any)["effort"] != "low" {
		t.Fatalf("effort: %v", seen["output_config"])
	}
	messages := seen["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("want user, assistant, user turns: %v", messages)
	}
	user := messages[0].(map[string]any)["content"].([]any)
	if user[0].(map[string]any)["type"] != "image" || user[0].(map[string]any)["source"].(map[string]any)["media_type"] != "image/jpeg" {
		t.Fatalf("image block: %v", user)
	}
	assistant := messages[1].(map[string]any)["content"].([]any)
	if len(assistant) != 1 || assistant[0].(map[string]any)["type"] != "tool_use" || assistant[0].(map[string]any)["input"].(map[string]any)["limit"] != float64(5) {
		t.Fatalf("tool_use block: %v", assistant)
	}
	result := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
	if result["type"] != "tool_result" || result["tool_use_id"] != "call_1" {
		t.Fatalf("tool_result block: %v", result)
	}
	toolsSent := seen["tools"].([]any)
	if len(toolsSent) != 2 {
		t.Fatalf("want the function and web search: %v", toolsSent)
	}
	schema := toolsSent[0].(map[string]any)["input_schema"].(map[string]any)
	if schema["type"] != "object" || schema["additionalProperties"] != false || schema["required"].([]any)[0] != "limit" {
		t.Fatalf("schema: %v", schema)
	}
	if !strings.HasPrefix(toolsSent[1].(map[string]any)["type"].(string), "web_search") {
		t.Fatalf("search tool: %v", toolsSent[1])
	}
}

func TestAnthropicQuotesErrorsAndListsModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Api-Key") != "good" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5","created_at":"2026-09-01T00:00:00Z","capabilities":{"image_input":{"supported":true},"effort":{"supported":true,"low":{"supported":true}}}},
			{"type":"model","id":"claude-haiku-4-5","display_name":"Claude Haiku 4.5","created_at":"2025-10-01T00:00:00Z","capabilities":{"image_input":{"supported":true},"effort":{"supported":false,"low":{"supported":false}}}}],"has_more":false,"first_id":"a","last_id":"b"}`))
	}))
	defer server.Close()
	_, err := (&Anthropic{Key: "bad", Model: "x", Base: server.URL, Client: server.Client()}).Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "invalid x-api-key") {
		t.Fatalf("%v", err)
	}
	list, effort, err := anthropicModels(context.Background(), &Anthropic{Key: "good", Base: server.URL, Client: server.Client()})
	if err != nil || len(list) != 2 || !list[1].Vision || !effort["claude-opus-5-5"] || effort["claude-haiku-4-5"] {
		t.Fatalf("%v %v %v", list, effort, err)
	}
}

func TestResolveBaseOnlyAllowsTypedURLsForSelfHosted(t *testing.T) {
	s := &Service{}
	zai, ollama := apiProviderByID("zai"), apiProviderByID("ollama")
	if got, err := s.resolveBase(zai, "https://open.bigmodel.cn/api/paas/v4/", ""); err != nil || got != "https://open.bigmodel.cn/api/paas/v4" {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := s.resolveBase(zai, "https://evil.example/v1", ""); err == nil {
		t.Fatal("hosted providers must not take a typed URL")
	}
	if got, _ := s.resolveBase(zai, "", "https://open.bigmodel.cn/api/paas/v4"); got != "https://open.bigmodel.cn/api/paas/v4" {
		t.Fatalf("an empty choice keeps the saved endpoint: %q", got)
	}
	if got, err := s.resolveBase(ollama, "http://10.0.0.5:11434", ""); err != nil || got != "http://10.0.0.5:11434" {
		t.Fatalf("%q %v", got, err)
	}
	for _, bad := range []string{"file:///etc/passwd", "http://user:pw@host/v1", "http://host/v1?x=1", "localhost:11434"} {
		if _, err := s.resolveBase(ollama, bad, ""); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestPickModelPrefersSavedThenDefaults(t *testing.T) {
	spec := &apiProvider{Defaults: []string{"b", "c"}}
	list := []ModelOption{{ID: "a"}, {ID: "c"}}
	if got := pickModel(spec, "a", list); got != "a" {
		t.Fatal(got)
	}
	if got := pickModel(spec, "gone", list); got != "c" {
		t.Fatal(got)
	}
	if got := pickModel(&apiProvider{}, "", list); got != "a" {
		t.Fatal(got)
	}
}

func TestRegistryIsComplete(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range apiProviders {
		if seen[p.ID] || p.ID == OpenRouter || p.ID == ClaudeCLI || p.ID == CodexCLI {
			t.Errorf("duplicate or reserved id %q", p.ID)
		}
		seen[p.ID] = true
		if p.Label == "" || p.KeyURL == "" || len(p.Endpoints) == 0 {
			t.Errorf("%s is missing a label, key URL or endpoint", p.ID)
		}
		if !p.Anthropic && p.ModelsPath == "" && p.ListModels == nil {
			t.Errorf("%s has no model list", p.ID)
		}
		if p.Route == nil && p.ChatPath == "" {
			t.Errorf("%s has no chat path", p.ID)
		}
	}
	for _, id := range []string{"anthropic", "deepseek", "openai", "zai", "kimi", "ollama", "mistral", "gemini", "xai", "opencode-zen", "opencode-go", "nvidia"} {
		if !seen[id] {
			t.Errorf("%s missing", id)
		}
	}
}

func TestCompatReadsChunkedContent(t *testing.T) {
	server := fakeCompat(t, `{"choices":[{"message":{"role":"assistant","content":[{"type":"thinking","thinking":[{"type":"text","text":"hmm"}]},{"type":"text","text":"Two tasks"},{"type":"text","text":" are due."}]},"finish_reason":"stop"}]}`, func(map[string]any, *http.Request) {})
	defer server.Close()
	p := &Compat{Spec: apiProviderByID("mistral"), Base: server.URL, Key: "k", Model: "m", Client: server.Client()}
	got, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err != nil || got.Content != "Two tasks are due." {
		t.Fatalf("%q %v", got.Content, err)
	}
}

func TestResponsesMapsTheTranscript(t *testing.T) {
	var seen map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" || r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("%s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&seen)
		_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"reasoning","summary":[]},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Looking."}]},{"type":"function_call","call_id":"fc_9","name":"list_tasks","arguments":"{\"limit\":2}"}]}`))
	}))
	defer server.Close()
	p := &Responses{Spec: apiProviderByID("openai"), Base: server.URL, Key: "sk-test", Model: "gpt-6-luna", Client: server.Client()}
	tools := []any{map[string]any{"type": "function", "function": map[string]any{"name": "list_tasks", "description": "List", "parameters": map[string]any{"type": "object"}}}}
	got, err := p.Complete(context.Background(), transcript(), tools, false)
	if err != nil || got.Content != "Looking." || len(got.ToolCalls) != 1 || got.ToolCalls[0].ID != "fc_9" || got.ToolCalls[0].Function.Arguments != `{"limit":2}` {
		t.Fatalf("%+v %v", got, err)
	}
	if seen["instructions"] != "Be brief." || seen["store"] != false || seen["max_output_tokens"] == nil {
		t.Fatalf("body: %v", seen)
	}
	for _, field := range []string{"messages", "max_tokens", "temperature", "reasoning"} {
		if _, ok := seen[field]; ok {
			t.Errorf("%s must not be sent", field)
		}
	}
	input := seen["input"].([]any)
	if len(input) != 3 {
		t.Fatalf("want user, function_call, function_call_output: %v", input)
	}
	user := input[0].(map[string]any)["content"].([]any)
	if user[0].(map[string]any)["type"] != "input_text" || user[1].(map[string]any)["type"] != "input_image" || user[1].(map[string]any)["image_url"] != "data:image/jpeg;base64,QUJD" {
		t.Fatalf("user: %v", user)
	}
	if call := input[1].(map[string]any); call["type"] != "function_call" || call["call_id"] != "call_1" || call["arguments"] != `{"limit":5}` {
		t.Fatalf("call: %v", call)
	}
	if result := input[2].(map[string]any); result["type"] != "function_call_output" || result["call_id"] != "call_1" {
		t.Fatalf("result: %v", result)
	}
	tool := seen["tools"].([]any)[0].(map[string]any)
	if tool["name"] != "list_tasks" || tool["strict"] != false || tool["parameters"] == nil {
		t.Fatalf("tool: %v", tool)
	}
	if p.CanSearch() {
		t.Fatal("no search")
	}
}

func TestResponsesReportsTruncation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}`))
	}))
	defer server.Close()
	p := &Responses{Spec: apiProviderByID("openai"), Base: server.URL, Key: "k", Model: "m", Client: server.Client()}
	if _, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("%v", err)
	}
}

func TestOllamaUsesNativeChatWithAContextWindow(t *testing.T) {
	var seen map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Errorf("path %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&seen)
		_, _ = w.Write([]byte(`{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"list_tasks","arguments":{"limit":4}}}]},"done":true,"done_reason":"stop"}`))
	}))
	defer server.Close()
	p := &Ollama{Spec: apiProviderByID("ollama"), Base: server.URL, Model: "qwen3:8b", Client: server.Client()}
	got, err := p.Complete(context.Background(), transcript(), []any{map[string]any{"type": "function", "function": map[string]any{"name": "list_tasks"}}}, false)
	if err != nil || len(got.ToolCalls) != 1 || got.ToolCalls[0].ID != "call_1" || got.ToolCalls[0].Function.Arguments != `{"limit":4}` {
		t.Fatalf("%+v %v", got, err)
	}
	if seen["stream"] != false || seen["options"].(map[string]any)["num_ctx"] != float64(32768) {
		t.Fatalf("body: %v", seen)
	}
	messages := seen["messages"].([]any)
	if images := messages[1].(map[string]any)["images"].([]any); images[0] != "QUJD" {
		t.Fatalf("images must be raw base64: %v", images)
	}
	args := messages[2].(map[string]any)["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)["arguments"]
	if args.(map[string]any)["limit"] != float64(5) {
		t.Fatalf("arguments must be an object: %v", args)
	}
	if result := messages[3].(map[string]any); result["tool_name"] != "list_tasks" {
		t.Fatalf("tool result needs the tool name: %v", result)
	}
}

func TestOllamaModelsKeepToolCallers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"llava:7b"},{"name":"qwen3:8b"},{"name":"gemma3:4b"}]}`))
		case "/api/show":
			var in struct{ Model string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			caps := map[string]string{"llava:7b": `["completion","vision"]`, "qwen3:8b": `["completion","tools","thinking"]`, "gemma3:4b": `["completion","tools","vision"]`}[in.Model]
			_, _ = w.Write([]byte(`{"capabilities":` + caps + `}`))
		}
	}))
	defer server.Close()
	list, err := ollamaModels(context.Background(), server.Client(), apiProviderByID("ollama"), server.URL, "")
	if err != nil || len(list) != 2 || list[0].ID != "gemma3:4b" || !list[0].Vision || list[1].ID != "qwen3:8b" || list[1].Vision {
		t.Fatalf("%+v %v", list, err)
	}
}

func TestAnthropicReplaysThinkingAndRetriesWithoutIt(t *testing.T) {
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		if len(bodies) == 1 {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"messages.1.content.0: Invalid ` + "`signature`" + ` in ` + "`thinking`" + ` block. The block is bound to a different conversation."}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"m","type":"message","role":"assistant","model":"x","stop_reason":"end_turn","content":[{"type":"thinking","thinking":"","signature":"new-sig"},{"type":"text","text":"Done."}]}`))
	}))
	defer server.Close()
	history := transcript()
	history[2].ThinkingBlocks = []json.RawMessage{json.RawMessage(`{"type":"thinking","thinking":"","signature":"old-sig"}`), json.RawMessage(`{"type":"redacted_thinking","data":"opaque"}`)}
	p := &Anthropic{Key: "k", Model: "claude-opus-5-5", Base: server.URL, Client: server.Client()}
	got, err := p.Complete(context.Background(), history, nil, false)
	if err != nil || got.Content != "Done." || len(got.ThinkingBlocks) != 1 || !strings.Contains(string(got.ThinkingBlocks[0]), "new-sig") {
		t.Fatalf("%+v %v", got, err)
	}
	if len(bodies) != 2 {
		t.Fatalf("want one retry, got %d calls", len(bodies))
	}
	first := bodies[0]["messages"].([]any)[1].(map[string]any)["content"].([]any)
	if first[0].(map[string]any)["type"] != "thinking" || first[0].(map[string]any)["signature"] != "old-sig" || first[1].(map[string]any)["type"] != "redacted_thinking" {
		t.Fatalf("thinking must be replayed first, unchanged: %v", first)
	}
	retry := bodies[1]["messages"].([]any)[1].(map[string]any)["content"].([]any)
	if len(retry) != 1 || retry[0].(map[string]any)["type"] != "tool_use" {
		t.Fatalf("the retry must drop thinking blocks: %v", retry)
	}
	if p.CanSearch() {
		t.Fatal("search is only for Anthropic itself")
	}
	if _, err := p.Complete(context.Background(), history, nil, true); err == nil || !strings.Contains(err.Error(), "Web search is not available") {
		t.Fatalf("%v", err)
	}
}

func TestOpenCodeRoutesEachModelToItsProtocol(t *testing.T) {
	zen, gopl := apiProviderByID("opencode-zen"), apiProviderByID("opencode-go")
	for _, tc := range []struct {
		spec        *apiProvider
		model, want string
	}{
		{zen, "gpt-6-sol", routeResponses}, {zen, "grok-4.7", routeResponses}, {zen, "muse-spark-1.3", routeResponses},
		{zen, "claude-sonnet-5-5", routeMessages}, {zen, "qwen3.7-plus", routeMessages}, {zen, "qwen3.8-flash", routeMessages},
		{zen, "qwen3.8-max", routeChat}, {zen, "minimax-m3", routeChat}, {zen, "glm-5.3", routeChat}, {zen, "kimi-k3", routeChat},
		{zen, "gemini-3.5-flash", ""}, {zen, "jev-1.13", ""},
		{gopl, "minimax-m3", routeMessages}, {gopl, "qwen3.8-max", routeMessages}, {gopl, "gpt-6-luna", routeResponses},
		{gopl, "glm-5.3", routeChat}, {gopl, "deepseek-v4-pro", routeChat},
	} {
		if got := tc.spec.route(tc.model); got != tc.want {
			t.Errorf("%s %s: %q want %q", tc.spec.ID, tc.model, got, tc.want)
		}
	}
	s := &Service{models: newCatalogue()}
	sealed, _ := s.encrypt("sk-zen")
	for model, want := range map[string]string{"claude-opus-5-5": "*provider.Anthropic", "gpt-6-sol": "*provider.Responses", "glm-5.3": "*provider.Compat"} {
		c, err := s.buildAPI(zen, APIKey{Key: sealed, BaseURL: "https://opencode.ai/zen/v1"}, model)
		if err != nil || fmt.Sprintf("%T", c) != want {
			t.Errorf("%s: %T %v", model, c, err)
		}
		if a, ok := c.(*Anthropic); ok && (a.Base != "https://opencode.ai/zen" || a.Search || a.Label != "OpenCode Zen") {
			t.Errorf("zen messages client: %+v", a)
		}
	}
	if _, err := s.buildAPI(zen, APIKey{Key: sealed}, "gemini-3.5-flash"); err == nil {
		t.Error("an unsupported protocol must be refused")
	}
}

func TestOpenCodeMessagesKeepThePathPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/zen/go/v1/messages" || r.Header.Get("X-Api-Key") != "sk-go" {
			t.Errorf("path %s key %q", r.URL.Path, r.Header.Get("X-Api-Key"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"m","type":"message","role":"assistant","model":"minimax-m3","stop_reason":"end_turn","content":[{"type":"text","text":"OK"}]}`))
	}))
	defer server.Close()
	s := &Service{models: newCatalogue()}
	sealed, _ := s.encrypt("sk-go")
	c, err := s.buildAPI(apiProviderByID("opencode-go"), APIKey{Key: sealed, BaseURL: server.URL + "/zen/go/v1"}, "minimax-m3")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := c.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false); err != nil || got.Content != "OK" {
		t.Fatalf("%v %v", got, err)
	}
}
