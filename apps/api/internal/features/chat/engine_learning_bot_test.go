package chat

import (
	"context"
	"testing"

	"timely-api/internal/agenthost"
)

// gateAskMsg is a gate.ask as the worker sends it.
func gateAskMsg(tool, call, runKind string, args obj, extra obj) agenthost.Message {
	body := obj{"type": "gate.ask", "tool": tool, "tool_call_id": call, "args": args, "args_hash": "h-" + call, "run_kind": runKind}
	for k, v := range extra {
		body[k] = v
	}
	return agenthost.Message{Type: "gate.ask", ID: "req-" + call, Raw: raw(body)}
}

// gate sends every tool of an agent Bot's tick through the bot gate, web
// tools included, and leaves a chat's web tools to the chat's web toggle.
func TestIntegrationGateRoutesBotWebToolsThroughTheBotGate(t *testing.T) {
	mcp := &fakeMCP{modes: map[string]string{"mail": mcpUse, "notes": mcpUse}}
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.MCP = mcp })
	c := h.chat("hello", "auto", "gate-bot", lines(reply("hi", 0)))
	c = h.wait(c.ID, "idle", statusIs("idle"))
	w, ok := h.e.sup.Worker("user-a")
	if !ok {
		t.Fatal("no worker for the account")
	}
	ctx := context.Background()
	_, tools := h.s.newToolRun(ctx, &c)
	run := func(bot *BotRunCtx) *agentRun {
		return &agentRun{id: "run_gate", uid: "user-a", cid: c.ID, worker: w, ctx: ctx, tools: tools, conv: c, bot: bot}
	}
	bot := &BotRunCtx{BotID: "bot_1", Permission: "auto", ReadHosts: []string{"https://prices.example/item"},
		MCP: map[string]string{"mail": "use"}}
	events := func() []AgentHostEvent { return h.hostEvents(c.ID) }

	// A chat with its web toggle on: web_extract is not a host call at all.
	tools.web.on = true
	h.e.gate(run(nil), gateAskMsg("web_extract", "chat_on", "chat", obj{"url": "https://attacker.example/"}, nil))
	if got := events(); len(got) != 0 {
		t.Fatalf("a chat's web_extract reached the host gate: %v", eventKinds(got))
	}
	if v, _ := gateVerdict(tools, "web_extract"); v != "allow" {
		t.Fatalf("chat web on: %s", v)
	}
	// With the toggle off the chat's own block stands, still without the host gate.
	tools.web.on = false
	h.e.gate(run(nil), gateAskMsg("web_extract", "chat_off", "chat", obj{"url": "https://prices.example/item"}, nil))
	if v, msg := gateVerdict(tools, "web_extract"); v != "block" || msg != webOff {
		t.Fatalf("chat web off: %s %q", v, msg)
	}
	if got := events(); len(got) != 0 {
		t.Fatalf("a chat's web_extract reached the host gate: %v", eventKinds(got))
	}

	// A bot run: the chat's toggle is off and does not matter. A page that is
	// not one of the Bot's hosts is blocked; its own Reads host runs.
	h.e.gate(run(bot), gateAskMsg("web_extract", "bot_off_host", "", obj{"url": "https://attacker.example/?q=secret"}, nil))
	h.e.gate(run(bot), gateAskMsg("web_extract", "bot_read_host", "", obj{"urls": []string{"https://prices.example/item"}}, nil))
	tainted := *bot
	tainted.Tainted = true
	h.e.gate(run(&tainted), gateAskMsg("web_search", "bot_search", "", obj{"query": "x"}, nil))
	h.e.gate(run(bot), gateAskMsg("web_search", "bot_search_clean", "", obj{"query": "x"}, nil))
	byCall := map[string]AgentHostEvent{}
	for _, e := range events() {
		byCall[e.ToolCallID] = e
	}
	for call, kind := range map[string]string{
		"bot_off_host": eventDenied, "bot_read_host": eventAllowed, "bot_search": eventDenied, "bot_search_clean": eventAllowed,
	} {
		if got, ok := byCall[call]; !ok || got.Kind != kind {
			t.Fatalf("%s: event %+v (found %v), want %s; all %v", call, got, ok, kind, eventKinds(events()))
		}
	}
	// The bot's terminal call is still blocked (a never tool).
	h.e.gate(run(bot), gateAskMsg("terminal", "bot_term", "", obj{"command": "ls"}, nil))
	for _, e := range events() {
		if e.ToolCallID == "bot_term" && e.Kind != eventDenied {
			t.Fatalf("a bot's terminal call: %s", e.Kind)
		}
	}

	// MCP tools of a bot: the Bot's setting, read-only and taint.
	mcpAsk := func(call, server, tool string, ro bool) agenthost.Message {
		return gateAskMsg("mcp_"+server+"_"+tool, call, "", obj{}, obj{"toolset": "mcp-" + server,
			"mcp": obj{"server": server, "tool": tool, "annotations": obj{"readOnlyHint": ro}}})
	}
	r := run(bot)
	h.e.gate(r, mcpAsk("mcp_read", "mail", "list_messages", true))
	h.e.gate(r, mcpAsk("mcp_write", "mail", "update_label", false))
	h.e.gate(r, mcpAsk("mcp_off", "notes", "list_notes", true))
	taintedRun := run(&tainted)
	h.e.gate(taintedRun, mcpAsk("mcp_write_tainted", "mail", "update_label", false))
	byCall = map[string]AgentHostEvent{}
	for _, e := range events() {
		byCall[e.ToolCallID] = e
	}
	for call, kind := range map[string]string{"mcp_read": eventAllowed, "mcp_off": eventDenied, "mcp_write_tainted": eventDenied} {
		if got, ok := byCall[call]; !ok || got.Kind != kind {
			t.Fatalf("%s: event %+v (found %v), want %s; all %v", call, got, ok, kind, eventKinds(events()))
		}
	}
	if _, logged := byCall["mcp_write"]; logged {
		t.Fatalf("a parked MCP write logged an event: %+v", byCall["mcp_write"])
	}
	if p, ok := r.cards["mcp_write"]; !ok || p.verdict != "approve" || p.card.Kind != cardMCP || p.card.Server != "mail" {
		t.Fatalf("the MCP write should be a parked card: %+v (found %v)", p, ok)
	}
}
