package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"

	"gorm.io/gorm"
	"timely-api/internal/jobs"
)

// webKeysDB is integrationDB with agent_web_keys from its real migration.
func webKeysDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := integrationDB(t)
	migration, err := os.ReadFile("../../../migrations/20261111124431_agent_web_keys.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(strings.Split(string(migration), "-- +goose Down")[0]).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

// A web search key is per account: saved sealed with a hint, never sent
// back in any answer, handed to the worker under the backend's Hermes name,
// and a change is announced for the account it belongs to.
func TestIntegrationWebKeysArePerAccountAndNeverShown(t *testing.T) {
	db := webKeysDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("CHAT_LOCAL_CLI", "off")
	s := New(db, nil, jobs.NewQueue(db))
	var changed []string
	s.SetWebKeyChanged(func(uid string) { changed = append(changed, uid) })
	const key = "exa-secret-key-0123456789"
	seen := func(body map[string]any) string {
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), key) || strings.Contains(string(raw), "secret-key") {
			t.Fatalf("an answer carried the key: %s", raw)
		}
		return string(raw)
	}

	code, body := call(t, s, "user-a", http.MethodGet, "/agent/web-keys", nil)
	if code != 200 || body["active"] != nil || body["usesProvider"] != true || body["providerCanSearch"] != false {
		t.Fatalf("no key yet: %d %s", code, seen(body))
	}
	if ids := backendIDs(body); !slices.Equal(ids, []string{"exa:true", "firecrawl:true", "parallel:true"}) {
		t.Fatalf("listed backends %v", ids)
	}
	if code, body := call(t, s, "user-a", http.MethodPut, "/agent/web-keys", map[string]string{"backend": "bing", "key": key}); code != 400 {
		t.Fatalf("an unknown backend: %d %s", code, seen(body))
	}
	if code, body := call(t, s, "user-a", http.MethodPut, "/agent/web-keys", map[string]string{"backend": "exa", "key": "short"}); code != 400 {
		t.Fatalf("a short key: %d %s", code, seen(body))
	}
	code, body = call(t, s, "user-a", http.MethodPut, "/agent/web-keys", map[string]string{"backend": "exa", "key": key})
	active, _ := body["active"].(map[string]any)
	if code != 200 || active["backend"] != "exa" || active["keyHint"] != "…6789" || body["usesProvider"] != false {
		t.Fatalf("saved: %d %s", code, seen(body))
	}
	if !slices.Equal(changed, []string{"user-a"}) {
		t.Fatalf("changed %v", changed)
	}
	var stored WebKey
	if err := db.First(&stored, "user_id = ?", "user-a").Error; err != nil || stored.Key == "" || strings.Contains(stored.Key, key) {
		t.Fatalf("stored key is not sealed: %v", err)
	}

	// Account B sees none of it and its worker gets no key.
	code, body = call(t, s, "user-b", http.MethodGet, "/agent/web-keys", nil)
	if code != 200 || body["active"] != nil || body["usesProvider"] != true {
		t.Fatalf("account B: %d %s", code, seen(body))
	}
	ctx := context.Background()
	if backend, env, err := s.WebToolKeys(ctx, "user-b"); err != nil || backend != TimelyWebBackend || env != nil {
		t.Fatalf("account B tool keys: %s %v %v", backend, env, err)
	}
	if backend, env, err := s.WebToolKeys(ctx, "user-a"); err != nil || backend != "exa" || len(env) != 1 || env["EXA_API_KEY"] != key {
		t.Fatalf("account A tool keys: %s %d %v", backend, len(env), err)
	}
	// B removing its (missing) key changes nothing of A's.
	if code, body := call(t, s, "user-b", http.MethodDelete, "/agent/web-keys", nil); code != 200 || body["active"] != nil {
		t.Fatalf("B delete: %d %s", code, seen(body))
	}
	if len(changed) != 1 {
		t.Fatalf("a delete with nothing to remove announced a change: %v", changed)
	}
	if backend, _, _ := s.WebToolKeys(ctx, "user-a"); backend != "exa" {
		t.Fatal("B's delete removed A's key")
	}

	// The worker's own list decides which backends can be chosen.
	s.SetWebBackends(func(uid string) []string { return []string{"tavily", "firecrawl"} })
	code, body = call(t, s, "user-a", http.MethodGet, "/agent/web-keys", nil)
	if ids := backendIDs(body); code != 200 || !slices.Equal(ids, []string{"exa:false", "firecrawl:true", "parallel:false", "tavily:true"}) {
		t.Fatalf("backends from the worker: %v", ids)
	}
	if code, body := call(t, s, "user-a", http.MethodPut, "/agent/web-keys", map[string]string{"backend": "parallel", "key": key}); code != 409 {
		t.Fatalf("a backend the worker cannot run: %d %s", code, seen(body))
	}
	if code, body := call(t, s, "user-a", http.MethodPut, "/agent/web-keys", map[string]string{"backend": "tavily", "key": key}); code != 200 {
		t.Fatalf("tavily: %d %s", code, seen(body))
	}
	if backend, env, _ := s.WebToolKeys(ctx, "user-a"); backend != "tavily" || env["TAVILY_API_KEY"] != key || len(env) != 1 {
		t.Fatalf("after switching: %s %d", backend, len(env))
	}

	code, body = call(t, s, "user-a", http.MethodDelete, "/agent/web-keys", nil)
	if code != 200 || body["active"] != nil || body["usesProvider"] != true {
		t.Fatalf("delete: %d %s", code, seen(body))
	}
	if !slices.Equal(changed, []string{"user-a", "user-a", "user-a"}) {
		t.Fatalf("changed %v", changed)
	}
	if backend, env, err := s.WebToolKeys(ctx, "user-a"); err != nil || backend != TimelyWebBackend || env != nil {
		t.Fatalf("after delete: %s %v %v", backend, env, err)
	}
}

func backendIDs(body map[string]any) []string {
	list, _ := body["backends"].([]any)
	out := []string{}
	for _, item := range list {
		b, _ := item.(map[string]any)
		available, _ := b["available"].(bool)
		id, _ := b["id"].(string)
		if available {
			out = append(out, id+":true")
		} else {
			out = append(out, id+":false")
		}
	}
	return out
}
