package provider

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"timely-api/internal/jobs"
)

// A settings change that is still being checked when another tab or device
// disconnects its provider must not bring the removed key back, must not
// leave the default on a provider that is gone, and must not put an old key
// back over a new one.
func TestIntegrationDisconnectDuringACheckStaysDisconnected(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("CHAT_LOCAL_CLI", "off")

	// The fake Anthropic holds a test call (or, when holdList is set, a model
	// list) until the test lets it go, which is the window another tab acts in.
	entered := make(chan struct{}, 8)
	release := make(chan struct{}, 8)
	var holdList atomic.Bool
	hold := func(r *http.Request) {
		entered <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}
	anthropicAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if key := r.Header.Get("X-Api-Key"); key != "sk-ant-api03-goodkey" && key != "sk-ant-api03-otherkey" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/messages") {
			hold(r)
			_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"m","stop_reason":"end_turn","content":[{"type":"text","text":"OK"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
			return
		}
		if holdList.Load() {
			hold(r)
		}
		_, _ = w.Write([]byte(`{"data":[{"type":"model","id":"claude-haiku-5-5","display_name":"Claude Haiku 5.5","created_at":"2026-09-01T00:00:00Z"},{"type":"model","id":"claude-sonnet-5-5","display_name":"Claude Sonnet 5.5","created_at":"2026-09-01T00:00:00Z"}],"has_more":false}`))
	}))
	defer anthropicAPI.Close()

	s := New(db, nil, jobs.NewQueue(db))
	s.anthropicURL = anthropicAPI.URL

	type answer struct {
		code int
		body map[string]any
	}
	// during sends a request, waits until it reaches the provider, runs the
	// other tab's action, then lets the provider answer.
	during := func(method, path string, in any, other func()) answer {
		done := make(chan answer, 1)
		go func() {
			code, body := call(t, s, "user-a", method, path, in)
			done <- answer{code, body}
		}()
		<-entered
		other()
		release <- struct{}{}
		return <-done
	}
	disconnect := func() {
		if code, body := call(t, s, "user-a", http.MethodDelete, "/agent/providers/anthropic/key", nil); code != 200 {
			t.Errorf("disconnect: %d %v", code, body)
		}
	}
	saveKey := func(key string) {
		t.Helper()
		if code, body := call(t, s, "user-a", http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": key}); code != 200 {
			t.Fatalf("save key: %d %v", code, body)
		}
	}
	stored := func() (APIKey, bool) {
		var rows []APIKey
		if err := db.Where("user_id = ? AND provider = ?", "user-a", "anthropic").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		if len(rows) == 0 {
			return APIKey{}, false
		}
		return rows[0], true
	}
	assertGone := func(step string) {
		t.Helper()
		if row, ok := stored(); ok {
			t.Fatalf("%s: the removed key came back: %+v", step, row)
		}
		_, body := call(t, s, "user-a", http.MethodGet, "/agent/providers", nil)
		if body["defaultProvider"] != "" || body["defaultChosen"] != false {
			t.Fatalf("%s: the default must stay reset, got %v (chosen %v)", step, body["defaultProvider"], body["defaultChosen"])
		}
	}

	// 1. A model change plus "Use as default" (the finding's own steps).
	saveKey("sk-ant-api03-goodkey")
	got := during(http.MethodPatch, "/agent/providers", map[string]any{"models": map[string]string{"anthropic": "claude-sonnet-5-5"}, "defaultProvider": "anthropic"}, disconnect)
	if got.code != 409 || !strings.Contains(got.body["message"].(string), "changed in another tab or device") {
		t.Fatalf("model change: %d %v", got.code, got.body)
	}
	assertGone("model change")

	// 2. "Use as default" alone.
	saveKey("sk-ant-api03-goodkey")
	got = during(http.MethodPatch, "/agent/providers", map[string]any{"defaultProvider": "anthropic"}, disconnect)
	if got.code != 409 {
		t.Fatalf("use as default: %d %v", got.code, got.body)
	}
	assertGone("use as default")

	// 3. Changing the endpoint with the saved key (an empty key field).
	saveKey("sk-ant-api03-goodkey")
	holdList.Store(true)
	got = during(http.MethodPost, "/agent/providers/anthropic/key", map[string]string{"key": ""}, disconnect)
	holdList.Store(false)
	if got.code != 409 {
		t.Fatalf("saved-key resave: %d %v", got.code, got.body)
	}
	assertGone("saved-key resave")

	// 4. A new key saved while a model change is checked keeps the new key.
	saveKey("sk-ant-api03-goodkey")
	got = during(http.MethodPatch, "/agent/providers", map[string]any{"models": map[string]string{"anthropic": "claude-sonnet-5-5"}}, func() { saveKey("sk-ant-api03-otherkey") })
	if got.code != 409 {
		t.Fatalf("model change over a new key: %d %v", got.code, got.body)
	}
	if row, ok := stored(); !ok || row.KeyHint != "…rkey" || row.Model != "claude-haiku-5-5" {
		t.Fatalf("the new key must stay with its own model: %+v %v", row, ok)
	}

	// Without a race the same change still saves.
	got = during(http.MethodPatch, "/agent/providers", map[string]any{"models": map[string]string{"anthropic": "claude-sonnet-5-5"}, "defaultProvider": "anthropic"}, func() {})
	if got.code != 200 || got.body["defaultProvider"] != "anthropic" || got.body["defaultChosen"] != true {
		t.Fatalf("plain change: %d %v", got.code, got.body)
	}
	if row, _ := stored(); row.Model != "claude-sonnet-5-5" || row.KeyHint != "…rkey" {
		t.Fatalf("plain change must save the model on the same key: %+v", row)
	}
}
