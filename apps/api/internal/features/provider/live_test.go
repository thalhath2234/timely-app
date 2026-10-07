package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/chat"
)

// TestLiveProviders calls real provider APIs. It runs only through
// `make test-providers-live` and only for providers whose key is set:
// TIMELY_LIVE_KEY_<ID> (ID upper-cased, "-" as "_", e.g.
// TIMELY_LIVE_KEY_OPENCODE_ZEN), TIMELY_LIVE_BASE_<ID> to pick another listed
// endpoint, and TIMELY_LIVE_MODEL_<ID> to pin a model. TIMELY_LIVE_OLLAMA=1
// checks a key-less local Ollama. TIMELY_LIVE_KEY_OPENROUTER runs OpenRouter
// through the generic OpenAI-compatible client.
func TestLiveProviders(t *testing.T) {
	if os.Getenv("TIMELY_LIVE_PROVIDERS") == "" {
		t.Skip("set TIMELY_LIVE_PROVIDERS=1 (make test-providers-live) to call real provider APIs")
	}
	specs := append([]*apiProvider{}, apiProviders...)
	specs = append(specs, &apiProvider{ID: "openrouter", Label: "OpenRouter (compat client)", Endpoints: []endpoint{{ID: "default", BaseURL: "https://openrouter.ai/api/v1"}},
		ChatPath: "chat/completions", ModelsPath: "models", Defaults: []string{envOr("OPENROUTER_CHAT_MODEL", defaultChatModel)}})
	ran := 0
	for _, spec := range specs {
		env := strings.ToUpper(strings.ReplaceAll(spec.ID, "-", "_"))
		key := os.Getenv("TIMELY_LIVE_KEY_" + env)
		if key == "" && !(spec.KeyOptional && os.Getenv("TIMELY_LIVE_"+env) != "") {
			continue
		}
		ran++
		t.Run(spec.ID, func(t *testing.T) {
			s := &Service{models: newCatalogue()}
			base, err := s.resolveBase(spec, os.Getenv("TIMELY_LIVE_BASE_"+env), "")
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
			defer cancel()
			list, err := s.apiModelList(ctx, spec, base, key, 0)
			if err != nil {
				t.Fatalf("model list: %v", err)
			}
			if len(list) == 0 {
				t.Fatal("model list is empty")
			}
			model := os.Getenv("TIMELY_LIVE_MODEL_" + env)
			if model == "" {
				model = pickModel(spec, "", list)
			}
			t.Logf("%s: %d models, testing %s at %s", spec.Label, len(list), model, base)
			sealed, _ := s.encrypt(key)
			completer, err := s.buildAPI(spec, APIKey{Key: sealed, BaseURL: base}, model)
			if err != nil {
				t.Fatal(err)
			}
			liveToolRoundTrip(ctx, t, completer)
			for _, m := range list {
				if m.ID == model && m.Vision {
					liveImage(ctx, t, completer)
				}
			}
		})
	}
	if ran == 0 {
		t.Skip("no TIMELY_LIVE_KEY_* set")
	}
}

func envOr(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

// liveToolRoundTrip asks for a tool call, answers it and expects a final
// reply, which is what one Agent run turn does.
func liveToolRoundTrip(ctx context.Context, t *testing.T, completer chat.Completer) {
	t.Helper()
	tools := []any{map[string]any{"type": "function", "function": map[string]any{
		"name": "get_due_tasks", "description": "List the person's tasks due on a date.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{"date": map[string]any{"type": "string", "description": "YYYY-MM-DD"}}, "required": []string{"date"}},
	}}}
	messages := []chat.WireMessage{
		{Role: "system", Content: "You are a task assistant. Always call get_due_tasks before answering questions about tasks."},
		{Role: "user", Content: "Which of my tasks are due on 2026-10-07?"},
	}
	first, err := completer.Complete(ctx, messages, tools, false)
	if err != nil {
		t.Fatalf("tool turn: %v", err)
	}
	if len(first.ToolCalls) == 0 || first.ToolCalls[0].Function.Name != "get_due_tasks" {
		t.Fatalf("expected a get_due_tasks call, got %+v", first)
	}
	messages = append(messages, first)
	for _, call := range first.ToolCalls {
		messages = append(messages, chat.WireMessage{Role: "tool", ToolCallID: call.ID, Content: `{"tasks":[{"title":"Pay rent","due":"2026-10-07"}]}`})
	}
	second, err := completer.Complete(ctx, messages, tools, false)
	if err != nil {
		t.Fatalf("answer turn after the tool result: %v", err)
	}
	if !strings.Contains(strings.ToLower(second.Content), "rent") {
		t.Fatalf("answer should mention the task: %+v", second)
	}
}

func liveImage(ctx context.Context, t *testing.T, completer chat.Completer) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for x := 0; x < 64; x++ {
		for y := 0; y < 64; y++ {
			img.Set(x, y, color.RGBA{R: 220, A: 255})
		}
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	url := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	reply, err := completer.Complete(ctx, []chat.WireMessage{{Role: "user", Content: "What colour fills this image? One word.", ImageURLs: []string{url}}}, nil, false)
	if err != nil {
		t.Fatalf("image turn: %v", err)
	}
	if !strings.Contains(strings.ToLower(reply.Content), "red") {
		t.Fatalf("expected red, got %q", reply.Content)
	}
}
