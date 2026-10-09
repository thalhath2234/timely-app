package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/jobs"
)

// TestIntegrationDecisionSettings covers the smart-suggestion (Jev) card: the
// TypeSafe key is checked before it is saved, stored encrypted, never shown in
// the chat provider list, comes first over OpenRouter, and the switch turns
// every call off.
func TestIntegrationDecisionSettings(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("CHAT_LOCAL_CLI", "off")

	jev := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ts-goodkey-123" {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{"model":"jev-1.13.0","answers":{"ok":{"type":"noul","noul":0.97}},"usage":{"input_tokens":12,"output_tokens":0}}`))
	}))
	defer jev.Close()
	client := decide.NewClient(nil)
	client.TypeSafeURL = jev.URL
	client.OpenRouterURL = jev.URL + "/openrouter"

	s := New(db, nil, jobs.NewQueue(db))
	d := decide.New(db, s.DecisionKeys, client)
	client.Rejected = s.MarkTypeSafeRejected
	s.SetDecisions(d, client)

	// No keys: suggestions are unavailable and nothing is called.
	code, body := call(t, s, "user-a", http.MethodGet, "/agent/decisions", nil)
	if code != 200 || body["available"] != false || body["enabled"] != true {
		t.Fatalf("fresh account: %d %v", code, body)
	}
	if keys, _ := s.DecisionKeys(context.Background(), "user-a"); keys.Usable() {
		t.Fatalf("no key must mean no calls: %+v", keys)
	}

	if code, _ := call(t, s, "user-a", http.MethodPost, "/agent/decisions/key", map[string]string{"key": "ts-badkey-123"}); code != 409 {
		t.Fatalf("a refused key must not be saved, got %d", code)
	}
	code, body = call(t, s, "user-a", http.MethodPost, "/agent/decisions/key", map[string]string{"key": "ts-goodkey-123"})
	if code != 200 || body["available"] != true || body["provider"] != decide.ProviderTypeSafe {
		t.Fatalf("save key: %d %v", code, body)
	}
	if ts := body["typesafe"].(map[string]any); ts["keySet"] != true || ts["keyHint"] != "…-123" {
		t.Fatalf("key view: %v", ts)
	}
	if raw, _ := json.Marshal(body); strings.Contains(string(raw), "goodkey") {
		t.Fatal("the key must never be returned")
	}
	var row APIKey
	if err := db.First(&row, "user_id = ? AND provider = ?", "user-a", TypeSafe).Error; err != nil || strings.Contains(row.Key, "goodkey") {
		t.Fatalf("key must be stored encrypted: %v", err)
	}
	// The TypeSafe row is not a chat provider.
	if _, body := call(t, s, "user-a", http.MethodGet, "/agent/providers", nil); strings.Contains(mustJSON(body["apiProviders"]), TypeSafe) {
		t.Fatal("TypeSafe must not appear among chat providers")
	}
	if _, body := call(t, s, "user-b", http.MethodGet, "/agent/decisions", nil); body["available"] != false {
		t.Fatal("keys must be account-scoped")
	}

	// A real call goes to TypeSafe and is logged without content.
	a, err := d.Ask(context.Background(), "user-a", decide.Request{Feature: "test", State: "Buy milk",
		Questions: map[string]decide.Question{"ok": decide.YesNo("Is it a test?", "yes", "no")}})
	if err != nil || a.Provider != decide.ProviderTypeSafe || a.LogID == "" {
		t.Fatalf("ask: %+v %v", a, err)
	}
	if code, _ := call(t, s, "user-a", http.MethodPost, "/agent/decisions/feedback", map[string]any{"logId": a.LogID, "accepted": true}); code != 204 {
		t.Fatalf("feedback: %d", code)
	}
	var logged decide.DecisionLog
	if err := db.First(&logged, "id = ?", a.LogID).Error; err != nil || !logged.OK || logged.Accepted == nil || !*logged.Accepted {
		t.Fatalf("log row: %+v %v", logged, err)
	}
	// Another account cannot mark it.
	if code, _ := call(t, s, "user-b", http.MethodPost, "/agent/decisions/feedback", map[string]any{"logId": a.LogID, "accepted": false}); code != 204 {
		t.Fatal("feedback endpoint failed")
	}
	db.First(&logged, "id = ?", a.LogID)
	if !*logged.Accepted {
		t.Fatal("another account changed this account's feedback")
	}

	// The switch turns everything off, and back on.
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": false}); code != 200 || body["available"] != false || body["enabled"] != false {
		t.Fatalf("switch off: %d %v", code, body)
	}
	if _, err := d.Ask(context.Background(), "user-a", decide.Request{Feature: "test", State: "Buy bread",
		Questions: map[string]decide.Question{"ok": decide.YesNo("Is it a test?", "yes", "no")}}); err == nil {
		t.Fatal("switched off must answer ErrOff")
	}
	call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": true})

	// A refused saved key is skipped until replaced.
	s.MarkTypeSafeRejected("user-a")
	if _, body := call(t, s, "user-a", http.MethodGet, "/agent/decisions", nil); body["available"] != false || body["typesafe"].(map[string]any)["rejected"] != true {
		t.Fatalf("rejected key view: %v", body)
	}
	if code, body := call(t, s, "user-a", http.MethodDelete, "/agent/decisions/key", nil); code != 200 || body["typesafe"].(map[string]any)["keySet"] != false {
		t.Fatalf("remove key: %d %v", code, body)
	}

	// Goals and the deep-work time are saved trimmed, and checked.
	code, body = call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]any{"goals": []string{"  Launch  the shop ", "", "Get fit"}, "deepWorkTime": "morning"})
	if code != 200 || mustJSON(body["goals"]) != `["Launch the shop","Get fit"]` || body["deepWorkTime"] != "morning" || body["enabled"] != true {
		t.Fatalf("prefs: %d %v", code, body)
	}
	for _, bad := range []map[string]any{
		{"goals": []string{"a", "b", "c", "d", "e", "f"}},
		{"goals": []string{strings.Repeat("x", 121)}},
		{"deepWorkTime": "night"},
		{},
	} {
		if code, _ := call(t, s, "user-a", http.MethodPatch, "/agent/decisions", bad); code != 400 {
			t.Fatalf("%v: %d", bad, code)
		}
	}
	if _, body := call(t, s, "user-b", http.MethodGet, "/agent/decisions", nil); mustJSON(body["goals"]) != `[]` || body["deepWorkTime"] != "" {
		t.Fatalf("another account's prefs: %v", body)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
