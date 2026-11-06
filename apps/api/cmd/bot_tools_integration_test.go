package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
	"timely-api/internal/features/bots"
	"timely-api/internal/jobs"
	"timely-api/internal/models"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type bearer struct{ next http.RoundTripper }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer test")
	return b.next.RoundTrip(r)
}

// The six bot tools over real MCP: a Bot made here starts paused, Run now
// refuses it, an outside edit pauses an active Bot again, and nothing is
// fetched or queued along the way.
func TestIntegrationBotTools(t *testing.T) {
	db, uid := agentToolsDB(t)
	svc := bots.New(db, jobs.NewQueue(db))
	verify := func(context.Context, string, *http.Request) (*mcpauth.TokenInfo, error) {
		return &mcpauth.TokenInfo{UserID: uid}, nil
	}
	srv := httptest.NewServer(agent.Handler(agent.New(agent.Deps{Bots: svc}), verify))
	defer srv.Close()
	ctx := context.Background()
	transport := &mcp.StreamableClientTransport{Endpoint: srv.URL, HTTPClient: &http.Client{Transport: bearer{http.DefaultTransport}}}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, transport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	call := func(name string, args map[string]any) (string, map[string]any, bool) {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		text := ""
		for _, c := range res.Content {
			if tc, ok := c.(*mcp.TextContent); ok {
				text += tc.Text
			}
		}
		raw, _ := json.Marshal(res.StructuredContent)
		var data map[string]any
		_ = json.Unmarshal(raw, &data)
		return text, data, res.IsError
	}
	must := func(name string, args map[string]any) (string, map[string]any) {
		t.Helper()
		text, data, isErr := call(name, args)
		if isErr {
			t.Fatalf("%s: %s", name, text)
		}
		return text, data
	}

	watch := map[string]any{"kind": "price", "source": "coinbase", "symbol": "btc", "rules": []any{map[string]any{"kind": "below", "threshold": 25000}}}
	text, made := must("create_bot", map[string]any{"name": "BTC dip", "watches": []any{watch}})
	id, _ := made["id"].(string)
	if !strings.HasPrefix(id, "bot_") || made["status"] != "paused" || made["pauseReason"] != "mcp" || made["origin"] != "mcp" || made["nextCheckAt"] != nil {
		t.Fatalf("made over MCP: %v", made)
	}
	if text != "Created BTC dip. It starts paused; the person turns it on in Timely." {
		t.Errorf("create text %q", text)
	}
	if text, _, isErr := call("create_bot", map[string]any{"name": "Loud", "urgent": true, "watches": []any{watch}}); !isErr || !strings.Contains(text, "urgent") {
		t.Errorf("urgent over MCP: %q", text)
	}

	if text, _, isErr := call("run_bot_now", map[string]any{"bot": "btc DIP"}); !isErr || text != bots.ErrPaused.Error() {
		t.Errorf("run a paused bot: %q", text)
	}
	if text, _, isErr := call("pause_bot", map[string]any{"bot": "Nope"}); !isErr || !strings.Contains(text, "list_bots") {
		t.Errorf("unknown bot: %q", text)
	}

	// The person turns it on in Timely; Run now then queues one check.
	if _, err := svc.Resume(ctx, uid, id, bots.OriginApp); err != nil {
		t.Fatal(err)
	}
	text, run := must("run_bot_now", map[string]any{"bot": id})
	if !strings.HasPrefix(run["jobId"].(string), "job_") || text != run["line"] {
		t.Fatalf("run now: %q %v", text, run)
	}

	// A name change leaves it on; a watch change pauses it.
	text, v := must("update_bot", map[string]any{"bot": id, "name": "BTC under 25k"})
	if v["status"] != "active" || text != "Updated BTC under 25k." {
		t.Fatalf("rename: %q %v", text, v)
	}
	wid := v["watches"].([]any)[0].(map[string]any)["id"]
	edited := map[string]any{"id": wid, "kind": "price", "source": "coinbase", "symbol": "BTC", "rules": []any{map[string]any{"kind": "below", "threshold": 24000}}}
	text, v = must("update_bot", map[string]any{"bot": "BTC under 25k", "watches": []any{edited}})
	if v["status"] != "paused" || v["pauseReason"] != "mcp" || !strings.Contains(text, "paused it") {
		t.Fatalf("watch edit: %q %v", text, v)
	}
	if text, _, isErr := call("update_bot", map[string]any{"bot": id, "phone": false}); !isErr || !strings.Contains(text, "phone") {
		t.Errorf("phone over MCP: %q", text)
	}

	_, v = must("pause_bot", map[string]any{"bot": id})
	if v["status"] != "paused" {
		t.Fatalf("pause: %v", v)
	}
	_, listed := must("list_bots", nil)
	if all := listed["bots"].([]any); len(all) != 1 || all[0].(map[string]any)["watches"].([]any)[0].(map[string]any)["summary"] == nil {
		t.Fatalf("list: %v", listed)
	}
	if _, found := must("list_bot_findings", map[string]any{"bot": id, "since": "2026-01-01T00:00:00Z", "limit": 10}); len(found["items"].([]any)) != 0 {
		t.Fatalf("findings: %v", found)
	}
	if text, _, isErr := call("list_bot_findings", map[string]any{"since": "yesterday"}); !isErr || !strings.Contains(text, "since") {
		t.Errorf("bad since: %q", text)
	}

	var checks int64
	if err := db.Model(&bots.Check{}).Where("user_id = ?", uid).Count(&checks).Error; err != nil || checks != 0 {
		t.Fatalf("checks %d, %v: MCP tools never read a page", checks, err)
	}
	var queued int64
	db.Model(&models.Job{}).Where("user_id = ? AND kind = ?", uid, models.JobBotCheck).Count(&queued)
	if queued != 1 {
		t.Fatalf("%d bot_check jobs, want the one Run now queued", queued)
	}
}
