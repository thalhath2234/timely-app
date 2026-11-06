package provider

import (
	"context"
	"encoding/json"
	"errors"
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
// every call off. The switch turns on only with a key Jev can use.
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
	// Without a key the switch can go off but not on: suggestions run on Jev.
	if code, body := call(t, s, "user-b", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": false}); code != 200 || body["enabled"] != false {
		t.Fatalf("switch off without a key: %d %v", code, body)
	}
	if code, _ := call(t, s, "user-b", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": true}); code != 409 {
		t.Fatalf("switch on without a key: %d", code)
	}
	if _, body := call(t, s, "user-b", http.MethodGet, "/agent/decisions", nil); body["enabled"] != false {
		t.Fatalf("a refused switch must not be saved: %v", body)
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
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": true}); code != 200 || body["available"] != true {
		t.Fatalf("switch on with a key: %d %v", code, body)
	}

	// A refused saved key is skipped until replaced.
	s.MarkTypeSafeRejected("user-a", "ts-goodkey-123")
	if _, body := call(t, s, "user-a", http.MethodGet, "/agent/decisions", nil); body["available"] != false || body["typesafe"].(map[string]any)["rejected"] != true {
		t.Fatalf("rejected key view: %v", body)
	}
	if code, _ := call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": true}); code != 409 {
		t.Fatalf("a refused key cannot switch it on: %d", code)
	}
	if code, body := call(t, s, "user-a", http.MethodDelete, "/agent/decisions/key", nil); code != 200 || body["typesafe"].(map[string]any)["keySet"] != false {
		t.Fatalf("remove key: %d %v", code, body)
	}

	// The deep-work time is saved and checked; goals are no longer part of
	// these settings (they live on Today) and are neither returned nor saved.
	code, body = call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]any{"goals": []string{"Launch the shop"}, "deepWorkTime": "morning"})
	if _, hasGoals := body["goals"]; code != 200 || hasGoals || body["deepWorkTime"] != "morning" || body["enabled"] != true {
		t.Fatalf("prefs: %d %v", code, body)
	}
	for _, bad := range []map[string]any{
		{"goals": []string{"Get fit"}},
		{"deepWorkTime": "night"},
		{},
	} {
		if code, _ := call(t, s, "user-a", http.MethodPatch, "/agent/decisions", bad); code != 400 {
			t.Fatalf("%v: %d", bad, code)
		}
	}
	if _, body := call(t, s, "user-b", http.MethodGet, "/agent/decisions", nil); body["deepWorkTime"] != "" {
		t.Fatalf("another account's prefs: %v", body)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

// TestIntegrationTypeSafeRefusalFollowsTheKey: a refusal is about the key a
// call used, so a late 401 for a replaced key leaves the new one alone;
// Settings → Test asks TypeSafe again about a refused key and clears the
// flag when it is taken; a key that cannot be decrypted says so.
func TestIntegrationTypeSafeRefusalFollowsTheKey(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("CHAT_LOCAL_CLI", "off")

	jev := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth := r.Header.Get("Authorization"); auth != "Bearer ts-newkey-456" && auth != "Bearer ts-oldkey-123" {
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
	typesafe := func() map[string]any {
		_, body := call(t, s, "user-a", http.MethodGet, "/agent/decisions", nil)
		return body["typesafe"].(map[string]any)
	}

	for _, key := range []string{"ts-oldkey-123", "ts-newkey-456"} {
		if code, _ := call(t, s, "user-a", http.MethodPost, "/agent/decisions/key", map[string]string{"key": key}); code != 200 {
			t.Fatalf("save %s: %d", key, code)
		}
	}
	// A call made with the old key comes back refused after the new key
	// was saved.
	s.MarkTypeSafeRejected("user-a", "ts-oldkey-123")
	if ts := typesafe(); ts["rejected"] != false {
		t.Fatalf("a late refusal of the old key flagged the new one: %v", ts)
	}
	s.MarkTypeSafeRejected("user-a", "ts-newkey-456")
	if ts := typesafe(); ts["rejected"] != true {
		t.Fatalf("a refusal of the saved key must flag it: %v", ts)
	}
	if keys, _ := s.DecisionKeys(context.Background(), "user-a"); keys.Usable() || !keys.TypeSafeRefused {
		t.Fatalf("a refused key is skipped and named: %+v", keys)
	}

	// Test asks TypeSafe again; it takes the key now, so the flag goes.
	code, body := call(t, s, "user-a", http.MethodPost, "/agent/decisions/test", nil)
	if code != 200 || body["ok"] != true || body["provider"] != decide.ProviderTypeSafe {
		t.Fatalf("test of a refused key: %d %v", code, body)
	}
	if ts := typesafe(); ts["rejected"] != false {
		t.Fatalf("a key TypeSafe took again stays flagged: %v", ts)
	}

	// A key that can no longer be decrypted is named, not called missing.
	if err := db.Model(&APIKey{}).Where("user_id = ? AND provider = ?", "user-a", TypeSafe).Update("api_key", "bm90LWEtc2VhbGVkLWtleQ==").Error; err != nil {
		t.Fatal(err)
	}
	if ts := typesafe(); ts["unreadable"] != true || ts["keySet"] != true || ts["rejected"] != false {
		t.Fatalf("unreadable key view: %v", ts)
	}
	if keys, _ := s.DecisionKeys(context.Background(), "user-a"); keys.Usable() || !keys.TypeSafeUnreadable {
		t.Fatalf("an unreadable key is skipped and named: %+v", keys)
	}
	if _, err := d.Ask(context.Background(), "user-a", decide.Request{Feature: "test", State: "Buy milk",
		Questions: map[string]decide.Question{"ok": decide.YesNo("Is it a test?", "yes", "no")}}); !errors.Is(err, decide.ErrKeyUnreadable) {
		t.Fatalf("ask with an unreadable key: %v", err)
	}
	code, body = call(t, s, "user-a", http.MethodPost, "/agent/decisions/test", nil)
	if code != 200 || body["ok"] != false || body["error"] != "Timely can't read your saved TypeSafe key. Enter it again, or add an OpenRouter key." {
		t.Fatalf("test of an unreadable key: %d %v", code, body)
	}
	if code, body := call(t, s, "user-a", http.MethodPatch, "/agent/decisions", map[string]bool{"enabled": true}); code != 409 || !strings.Contains(mustJSON(body), "can't read your saved TypeSafe key. Enter it again, or add an OpenRouter key, to turn on smart suggestions") {
		t.Fatalf("switch on with an unreadable key: %d %v", code, body)
	}
}
