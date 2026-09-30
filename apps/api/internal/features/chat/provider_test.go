package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOpenRouterSearchIsOptIn(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer test-key" {
				t.Error("missing server credential")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if reasoning, ok := body["reasoning"].(map[string]any); !ok || reasoning["effort"] != "low" {
				t.Error("expected low reasoning for interactive tool use")
			}
			_, searched := body["plugins"]
			if searched != enabled {
				t.Errorf("search=%v want %v", searched, enabled)
			}
			if body["model"] != "z-ai/glm-5.3-flash" {
				t.Error("wrong model")
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"Ready"},"finish_reason":"stop"}]}`))
		}))
		p := OpenRouter{Key: "test-key", Model: "z-ai/glm-5.3-flash", URL: server.URL, Client: server.Client()}
		got, err := p.Complete(context.Background(), []WireMessage{{Role: "user", Content: "Hello"}}, nil, enabled)
		server.Close()
		if err != nil || got.Content != "Ready" {
			t.Fatalf("%v %v", got, err)
		}
	}
}

func TestOpenRouterRecoversFromBodyTimeout(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if attempts.Add(1) == 1 {
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"Expense template ready for review"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()
	client := server.Client()
	client.Timeout = 40 * time.Millisecond
	p := OpenRouter{Key: "test", Model: "test", URL: server.URL, Client: client}
	got, err := p.Complete(context.Background(), []WireMessage{{Role: "user", Content: "Create a monthly expense sheet template"}}, nil, false)
	if err != nil || got.Content != "Expense template ready for review" {
		t.Fatalf("body timeout should recover before failing chat: %v", err)
	}
	if attempts.Load() != 2 {
		t.Fatalf("attempts=%d", attempts.Load())
	}
}

func TestOpenRouterTimeoutIsBoundedAndCancellationDoesNotRetry(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		var attempts atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			attempts.Add(1)
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		}))
		client := server.Client()
		client.Timeout = 30 * time.Millisecond
		p := OpenRouter{Key: "test", Model: "test", URL: server.URL, Client: client}
		ctx := context.Background()
		if canceled {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, 10*time.Millisecond)
			defer cancel()
		}
		_, err := p.Complete(ctx, nil, nil, false)
		server.Close()
		if err == nil {
			t.Fatal("expected timeout")
		}
		if canceled {
			if attempts.Load() > 1 || !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("cancellation retried: %v", err)
			}
		} else if attempts.Load() != 2 || strings.Contains(err.Error(), "Client.Timeout") {
			t.Fatalf("unbounded retry or raw transport error: %v", err)
		}
	}
}

func TestOpenRouterImagesUsePrivateMultimodalRouting(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		provider, ok := body["provider"].(map[string]any)
		if !ok || provider["zdr"] != true {
			t.Error("image request allowed retention")
		}
		if _, ok := body["plugins"]; ok {
			t.Error("private images sent to search")
		}
		messages := body["messages"].([]any)
		parts := messages[0].(map[string]any)["content"].([]any)
		if len(parts) != 2 || parts[1].(map[string]any)["type"] != "image_url" {
			t.Error("image not included")
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"receipt"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()
	p := OpenRouter{Key: "test", Model: "test", URL: server.URL, Client: server.Client()}
	msg := WireMessage{Role: "user", Content: "Read", ImageURLs: []string{"data:image/jpeg;base64,dGVzdA=="}, Sensitive: true}
	saved, _ := json.Marshal(msg)
	if strings.Contains(string(saved), "base64") {
		t.Fatal("image bytes persisted in conversation transcript")
	}
	if _, err := p.Complete(context.Background(), []WireMessage{msg}, nil, false); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Complete(context.Background(), []WireMessage{msg}, nil, true); err == nil {
		t.Fatal("private search accepted")
	}
}
