package main

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/learning"
	"timely-api/internal/features/provider"
)

// The host card timers: ten minutes live and the account's own timeout,
// shortened only on a test API (DB_SCHEMA), within 1 to 3,600 seconds.
func TestHostTimersAreTestOnly(t *testing.T) {
	env := func(kv map[string]string) func(string) string { return func(k string) string { return kv[k] } }
	live, park := hostTimers(env(map[string]string{"TIMELY_AGENT_HOST_LIVE_WAIT_S": "5", "TIMELY_AGENT_HOST_PARK_S": "7"}))
	if live != 10*time.Minute || park != nil {
		t.Fatalf("without DB_SCHEMA: %s %v", live, park != nil)
	}
	live, park = hostTimers(env(map[string]string{"DB_SCHEMA": "p5", "TIMELY_AGENT_HOST_LIVE_WAIT_S": "5", "TIMELY_AGENT_HOST_PARK_S": "7"}))
	if live != 5*time.Second || park == nil || park(context.Background(), "u") != 7*time.Second {
		t.Fatalf("on a test API: %s", live)
	}
	live, park = hostTimers(env(map[string]string{"DB_SCHEMA": "p5", "TIMELY_AGENT_HOST_LIVE_WAIT_S": "0", "TIMELY_AGENT_HOST_PARK_S": "9999"}))
	if live != 10*time.Minute || park != nil {
		t.Fatal("out of range values are ignored")
	}
}

// mcp.tokens goes to SaveTokens for the worker's account; other messages
// pass on.
func TestMCPTokensReachTheStore(t *testing.T) {
	var got map[string]json.RawMessage
	var who string
	handle := mcpTokens(func(_ context.Context, uid string, tokens map[string]json.RawMessage) error {
		who, got = uid, tokens
		return nil
	})
	if handle(nil, agenthost.Message{Type: "event"}) {
		t.Fatal("an event was taken")
	}
	m := agenthost.Message{Type: "mcp.tokens", Account: "user-a", Raw: json.RawMessage(`{"type":"mcp.tokens","account":"user-a","tokens":{"notes":{"tokens":{"access_token":"x"}},"old":{}}}`)}
	if !handle(nil, m) || who != "user-a" || len(got) != 2 || string(got["old"]) != "{}" {
		t.Fatalf("saved %s %v", who, got)
	}
}

// A host-allowed account's settings carry PROTOCOL.md 12.1's host keys and
// the host toolsets; another account gets none of them; both get their MCP
// servers; what was rendered is recorded for the engine.
func TestIntegrationAccountSettingsRenderHostAndMCP(t *testing.T) {
	db, uid := agentToolsDB(t)
	host := &accountHost{
		allowed:    func(_ context.Context, id string) bool { return id == uid },
		workingDir: func(context.Context, string) string { return "/sandbox/work" },
		liveWait:   10 * time.Minute,
		mcp: func(context.Context, string) (map[string]json.RawMessage, map[string]string, []string, map[string]json.RawMessage, []string, error) {
			return map[string]json.RawMessage{"notes": json.RawMessage(`{"url":"https://mcp.example.org/mcp"}`)},
				map[string]string{"notes": "ask", "old": "off"}, nil,
				map[string]json.RawMessage{"notes": json.RawMessage(`{"tokens":{}}`)}, nil, nil
		},
	}
	settings := accountSettingsWith(db,
		func(context.Context, string) (learning.Prefs, error) { return learning.Prefs{}, nil },
		func(context.Context, string) (string, map[string]string, error) {
			return provider.TimelyWebBackend, nil, nil
		}, host)
	render := func(id string) map[string]any {
		t.Helper()
		spec, err := settings(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal(spec.Settings, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	got := render(uid)
	var toolsets []string
	for _, x := range got["toolsets"].([]any) {
		toolsets = append(toolsets, x.(string))
	}
	if got["host_allowed"] != true || got["working_dir"] != "/sandbox/work" || got["terminal_home_mode"] != "real" || got["checkpoints"] != true ||
		got["browser"].(map[string]any)["use_real_profile"] != true || got["approval_timeout_s"] != float64(600) ||
		!slices.Contains(toolsets, "terminal") || !slices.Contains(toolsets, "browser-use") {
		t.Fatalf("host-allowed settings %v", got)
	}
	if got["mcp_modes"].(map[string]any)["old"] != "off" || got["mcp_servers"].(map[string]any)["notes"] == nil || len(got["approved_mcp_hashes"].([]any)) != 0 {
		t.Fatalf("mcp settings %v", got)
	}
	if allowed, known := host.renderedHost(uid); !allowed || !known || !host.renderedMCP(uid, "notes") || host.renderedMCP(uid, "old") {
		t.Fatal("what was rendered is not recorded")
	}
	other := render("someone-else")
	for _, key := range []string{"working_dir", "terminal_home_mode", "checkpoints", "browser"} {
		if _, ok := other[key]; ok {
			t.Fatalf("an account that is not host-allowed got %s: %v", key, other)
		}
	}
	if other["host_allowed"] != false || slices.Contains(other["toolsets"].([]any), any("terminal")) || other["mcp_servers"] == nil {
		t.Fatalf("other settings %v", other)
	}
	if allowed, known := host.renderedHost("someone-else"); allowed || !known {
		t.Fatal("rendered host flag of the other account")
	}
}
