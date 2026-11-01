package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"timely-api/internal/features/embed"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// fakeAnthropicAPI accepts one key, lists Haiku models and answers every
// Messages call with "OK", after running during (when set).
func fakeAnthropicAPI(t *testing.T, during func()) (*httptest.Server, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var called []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Api-Key") != "sk-ant-goodkey" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/messages") {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			mu.Lock()
			called = append(called, fmt.Sprint(body["model"]))
			mu.Unlock()
			if during != nil {
				during()
			}
			_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"m","stop_reason":"end_turn","content":[{"type":"text","text":"OK"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"type":"model","id":"claude-haiku-5-5","display_name":"Claude Haiku 5.5","created_at":"2026-09-01T00:00:00Z"},{"type":"model","id":"claude-haiku-5-5-20261001","display_name":"Claude Haiku 5.5","created_at":"2026-10-01T00:00:00Z"}],"has_more":false}`))
	}))
	t.Cleanup(server.Close)
	return server, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), called...)
	}
}

// R11, RV-settings-3: a key pasted with spaces is saved; a model that just
// answered a test call is not asked again when it becomes the default; and
// naming the embedding model already in effect probes and rebuilds nothing.
func TestIntegrationSettingsAskTheProviderOnlyWhenSomethingChanged(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("CHAT_LOCAL_CLI", "off")
	anthropicAPI, called := fakeAnthropicAPI(t, nil)
	s := New(db, nil, jobs.NewQueue(db))
	s.anthropicURL = anthropicAPI.URL

	if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": "  sk-ant-goodkey\n"}); code != 200 {
		t.Fatalf("a pasted key with spaces around it: %d %v", code, body)
	}
	var stored APIKey
	if err := db.First(&stored, "user_id = ? AND provider = ?", "user-a", "anthropic").Error; err != nil {
		t.Fatal(err)
	}
	if key, err := s.apiKey(stored); err != nil || key != "sk-ant-goodkey" {
		t.Fatalf("the key must be stored trimmed: %v", err)
	}

	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]any{"models": map[string]string{"anthropic": "claude-haiku-5-5-20261001"}}); code != 200 || len(called()) != 1 {
		t.Fatalf("a new model answers one test call: %d %v %v", code, body["message"], called())
	}
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"defaultProvider": "anthropic"}); code != 200 || body["defaultChosen"] != true {
		t.Fatalf("%d %v", code, body)
	}
	if got := called(); len(got) != 1 {
		t.Fatalf("the model that just answered is not asked again: %v", got)
	}
	for _, m := range called() {
		if !strings.Contains(m, "haiku") {
			t.Fatalf("a test call ran %q", m)
		}
	}

	// No OpenRouter key: before, naming the default embedding model failed
	// with "Add an OpenRouter API key" and would have queued a rebuild.
	code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"openrouterEmbedModel": s.envEmbed})
	if code != 200 {
		t.Fatalf("the embedding model in effect: %d %v", code, body)
	}
	var queued int64
	db.Model(&models.Job{}).Where("user_id = ? AND kind = ?", "user-a", models.JobReindexUser).Count(&queued)
	if queued != 0 || body["reindex"].(map[string]any)["status"] == "queued" {
		t.Fatalf("no rebuild for the model in effect: %d jobs, %v", queued, body["reindex"])
	}
}

// RV-settings-1: a model list that fails says why instead of answering 200
// with no models, and with 409, which the apps do not send again.
func TestIntegrationAFailedModelListSaysWhy(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	ollama := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error":"model runner crashed"}`))
	}))
	defer ollama.Close()
	s := New(db, nil, jobs.NewQueue(db))
	s.ollamaURL = ollama.URL
	code, body := call(t, s, "user-a", http.MethodGet, "/agent/providers/ollama/models", nil)
	if code != 409 || !strings.Contains(fmt.Sprint(body["message"]), "500") {
		t.Fatalf("%d %v", code, body)
	}
}

// R13: Help me write names the model that wrote the draft even when the key
// is removed while the model is answering.
func TestIntegrationHelpMeWriteKeepsTheModelWhenTheKeyGoesMeanwhile(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("CHAT_LOCAL_CLI", "off")
	var removeDuringCall atomic.Bool
	anthropicAPI, _ := fakeAnthropicAPI(t, func() {
		if removeDuringCall.Load() {
			db.Where("user_id = ? AND provider = ?", "user-a", "anthropic").Delete(&APIKey{})
		}
	})
	s := New(db, nil, jobs.NewQueue(db))
	s.anthropicURL = anthropicAPI.URL
	if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": "sk-ant-goodkey"}); code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/providers", map[string]string{"defaultProvider": "anthropic"}); code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	removeDuringCall.Store(true)
	code, body := call(t, s, "user-a", http.MethodPost, "/agent/write", map[string]string{"action": "write", "prompt": "a haiku about rain", "kind": "doc"})
	if code != 200 || body["provider"] != "anthropic" || body["model"] != "claude-haiku-5-5" {
		t.Fatalf("%d %v", code, body)
	}
}

// errIndexer fails every rebuild.
type errIndexer struct{ embed.Indexer }

func (errIndexer) SetCredentials(embed.Credentials) {}
func (errIndexer) Reindex(context.Context, string, func(done, total int)) (int, error) {
	return 0, errors.New("openrouter embed: Insufficient credits")
}

// GP11: while the queue will try a failed rebuild again, Settings reads
// "retrying" (and keeps following it); only the last attempt reads "failed".
func TestIntegrationAFailedRebuildIsRetryingUntilTheLastAttempt(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	s := New(db, errIndexer{}, jobs.NewQueue(db))
	status := func() ReindexState {
		row, err := s.load(db, "user-a")
		if err != nil {
			t.Fatal(err)
		}
		return row.Reindex
	}
	if err := s.handleReindex(context.Background(), &models.Job{UserID: "user-a", Attempts: 1, MaxAttempts: 8}); err == nil {
		t.Fatal("a failed rebuild must fail its job so the queue tries again")
	}
	if st := status(); st.Status != "retrying" || !strings.Contains(st.Error, "Insufficient credits") {
		t.Fatalf("%+v", st)
	}
	_ = s.handleReindex(context.Background(), &models.Job{UserID: "user-a", Attempts: 8, MaxAttempts: 8})
	if st := status(); st.Status != "failed" {
		t.Fatalf("%+v", st)
	}
}
