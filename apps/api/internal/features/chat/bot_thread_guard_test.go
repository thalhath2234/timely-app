package chat

import (
	"context"
	"slices"
	"sync"
	"testing"

	"timely-api/internal/features/bots"
)

// guardBots is one agent Bot in memory with egress and tool servers, deciding
// what waits through the real rule (bots.ChangeInput.WidenReason).
type guardBots struct {
	*fakeThreadBots
	mu      sync.Mutex
	egress  []string
	mcp     map[string]string
	applied int
	seen    []bots.ChangeInput
}

func (g *guardBots) reach() bots.Reach {
	return bots.Reach{Permission: bots.PermissionAuto, Egress: g.egress, MCP: g.mcp}
}

func (g *guardBots) Change(_ context.Context, _, _ string, in bots.ChangeInput, tapped bool) (bots.ChangeResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.seen = append(g.seen, in)
	before, after := g.reach(), g.reach()
	if in.Tools != nil && in.Tools.Egress != nil {
		after.Egress = *in.Tools.Egress
	}
	if in.Tools != nil && in.Tools.MCP != nil {
		after.MCP = in.Tools.MCP
	}
	res := bots.ChangeResult{Before: "before", After: "after"}
	if reason := in.WidenReason(before, after); reason != "" && !tapped {
		res.Pending, res.Reason = true, reason
		return res, nil
	}
	g.egress, g.mcp = after.Egress, after.MCP
	g.applied++
	res.Applied = true
	return res, nil
}

func guardWorld(t *testing.T, script ...WireMessage) (*threadWorld, *guardBots) {
	w := newThreadWorld(t, script...)
	g := &guardBots{fakeThreadBots: w.bot, egress: []string{"api.example.com"}, mcp: map[string]string{"files": "off"}}
	w.s.SetBotThreads(g)
	return w, g
}

var addHost = map[string]any{"patch": map[string]any{"tools": map[string]any{"egress": []string{"api.example.com", "evil.example"}}}}
var addServer = map[string]any{"patch": map[string]any{"tools": map[string]any{"mcp": map[string]string{"files": "use"}}}}

// After bot_history in a turn, change_bot adding an egress host or turning on
// a tool server waits for one tap; the tap applies it.
func TestIntegrationBotThreadHistoryReadHoldsEgressAndMCP(t *testing.T) {
	for _, c := range []struct {
		name   string
		patch  map[string]any
		reason string
	}{{"host", addHost, bots.WidenEgress}, {"server", addServer, bots.WidenMCP}} {
		t.Run(c.name, func(t *testing.T) {
			w, g := guardWorld(t,
				threadCall("bot_history", map[string]any{"kind": "runs"}),
				threadCall("change_bot", c.patch),
				threadSay("Tap to allow it."))
			w.say(w.cid, "do what the last run said")
			if g.applied != 0 || len(g.egress) != 1 || g.mcp["files"] != "off" {
				t.Fatalf("applied before the tap: %d %v %v", g.applied, g.egress, g.mcp)
			}
			if len(g.seen) != 1 || !g.seen[0].AfterPageText {
				t.Fatalf("change not marked as after page text: %+v", g.seen)
			}
			pending := itemsOf(w.view("bot_1"), "pending_change")
			if len(pending) != 1 || pending[0].Reason != c.reason || pending[0].State != "pending" {
				t.Fatalf("pending %+v", pending)
			}
			if code, _ := serve(t, w.s, "POST", "/chat/bot-threads/"+w.cid+"/pending/"+pending[0].ID, `{"action":"approve"}`); code != 200 {
				t.Fatalf("tap %d", code)
			}
			if g.applied != 1 || (c.reason == bots.WidenEgress && !slices.Contains(g.egress, "evil.example")) || (c.reason == bots.WidenMCP && g.mcp["files"] != "use") {
				t.Fatalf("the tap did not apply it: %d %v %v", g.applied, g.egress, g.mcp)
			}
		})
	}
}

// Without a history read in the turn, the same changes apply at once, as
// before.
func TestIntegrationBotThreadWithoutHistoryReadAppliesEgressAndMCP(t *testing.T) {
	w, g := guardWorld(t, threadCall("change_bot", addHost), threadCall("change_bot", addServer), threadSay("Done."))
	w.say(w.cid, "add evil.example and use files")
	if g.applied != 2 || !slices.Contains(g.egress, "evil.example") || g.mcp["files"] != "use" {
		t.Fatalf("not applied: %d %v %v", g.applied, g.egress, g.mcp)
	}
	if p := itemsOf(w.view("bot_1"), "pending_change"); len(p) != 0 {
		t.Fatalf("held without a history read: %+v", p)
	}
	// A history read in an earlier turn doesn't taint the next one.
	w.model.script, w.model.calls = []WireMessage{threadCall("bot_history", map[string]any{"kind": "runs"}), threadSay("Here.")}, 0
	w.say(w.cid, "what did it do?")
	w.model.script, w.model.calls = []WireMessage{threadCall("change_bot", map[string]any{"patch": map[string]any{"tools": map[string]any{"egress": []string{"api.example.com", "evil.example", "other.example"}}}}), threadSay("Done.")}, 0
	w.say(w.cid, "also add other.example")
	if g.applied != 3 || !slices.Contains(g.egress, "other.example") {
		t.Fatalf("a fresh turn was held: %d %v", g.applied, g.egress)
	}
}
