package chat

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
)

// Go's verdict for a gate.ask from an agent Bot's tick (plan 5.5b "Bots" and
// 7.5, Q-B2). Nobody can approve during a tick: a call that needs approval is
// answered "approve" and the caller parks its card in Needs you (written on
// the Bot thread) while the tick goes on. The pure rules are agent.BotGate;
// this reads the call's arguments and builds the card.

// BotRunCtx is what a bot decision reads about the run.
type BotRunCtx struct {
	BotID string
	// Permission is the Bot's stored mode (supervised, auto, full).
	Permission string
	// BrowserSites are the sites the person granted the signed-in browser.
	BrowserSites []string
	// Egress is the Bot's own list of hosts outbound tools may reach.
	Egress []string
	// ReadHosts are the hosts of the Bot's Reads.
	ReadHosts []string
	// SearchHosts are the hosts this tick's web_search returned; they count
	// as bot hosts only while the tick is not Tainted.
	SearchHosts []string
	// Tainted is set once the tick has read outside content.
	Tainted bool
	// FullAccessOK is set when the Bot's Full Access has its step-up record;
	// without it Full acts as Auto.
	FullAccessOK bool
	// MCP is the Bot's setting per MCP server (use, ask or off: McpMode in
	// the Bot's tools). A server it does not list is off.
	MCP map[string]string
}

// hostBrowserBusy is the block message when a chat holds the browser: the
// Check records "browser busy" (the lease, browser_lease.go).
const hostBrowserBusy = "browser busy"

// browserClass reports whether a bot tool uses the browser.
func browserClass(tool string) bool {
	switch agent.ClassifyBotTool(tool) {
	case agent.BotToolBrowserRead, agent.BotToolBrowserAct:
		return true
	}
	return false
}

// botActKeys are arguments a browser read never takes: a value in one says
// the model meant to type, click, run a script or submit. bot_browser_read
// ignores them, but the call is parked as the action it asked for.
var botActKeys = []string{"click", "type", "fill", "keys", "press", "submit", "script", "code", "selector", "input", "form", "text_input", "value"}

// botActs reports whether a browser call's arguments ask to act.
func botActs(args map[string]any) bool {
	for _, k := range botActKeys {
		switch v := args[k].(type) {
		case nil:
		case string:
			if strings.TrimSpace(v) != "" {
				return true
			}
		case bool:
			if v {
				return true
			}
		case []any:
			if len(v) > 0 {
				return true
			}
		case map[string]any:
			if len(v) > 0 {
				return true
			}
		default:
			return true
		}
	}
	return false
}

// botURLs is every address a call's arguments name.
func botURLs(tool string, args map[string]any) []string {
	var out []string
	add := func(s string) {
		if s = strings.TrimSpace(dropNUL(s)); s != "" {
			out = append(out, s)
		}
	}
	for _, k := range []string{"url", "href", "link"} {
		if s, ok := args[k].(string); ok {
			add(s)
		}
	}
	for _, k := range []string{"urls", "links"} {
		switch v := args[k].(type) {
		case []any:
			for _, e := range v {
				if s, ok := e.(string); ok {
					add(s)
				}
			}
		case []string:
			for _, s := range v {
				add(s)
			}
		case string:
			add(v)
		}
	}
	if params, ok := args["params"].(map[string]any); ok {
		if s, ok := params["url"].(string); ok {
			add(s)
		}
	}
	if tool == "browser_exec" {
		if s, ok := args["code"].(string); ok {
			add(navigationTarget(s))
		}
	}
	return out
}

// botHostDecision is the verdict for one tool call of a bot run. A call it
// allows may still be refused for the browser by gateBotBrowser (a chat holds
// it); a call it answers "approve" carries the card to park.
func botHostDecision(b BotRunCtx, tool string, args map[string]any) hostDecision {
	if args == nil {
		args = map[string]any{}
	}
	class := agent.ClassifyBotTool(tool)
	// The hardline floor holds in every mode: a terminal or code call is a
	// never tool for a bot, but a line the floor reads says so by name.
	if class == agent.BotToolNever {
		action, _, _ := hostCall(tool, args, "", "", "")
		if why, hard := agent.HardlineHost(action, agent.HostScope{}); hard {
			msg := "Timely never runs this, in any mode: it " + why + "."
			return hostDecision{verdict: agent.BotBlock, message: msg, reason: msg, action: action}
		}
	}
	urls := botURLs(tool, args)
	in := agent.BotGateIn{
		Tool:    tool,
		URLs:    urls,
		Acts:    class == agent.BotToolBrowserRead && botActs(args),
		Mode:    agent.BotMode(b.Permission, b.FullAccessOK),
		Tainted: b.Tainted,
		Hosts:   agent.BotHosts{Read: b.ReadHosts, Browser: b.BrowserSites, Egress: b.Egress, Search: b.SearchHosts},
	}
	out := agent.BotGate(in)
	d := hostDecision{verdict: out.Verdict, message: out.Message, reason: out.Reason}
	if len(urls) > 0 {
		d.action = agent.HostAction{Kind: agent.HostFetch, URL: urls[0]}
	}
	switch out.Verdict {
	case agent.BotAllow:
		d.by = "auto"
		if out.Lifted {
			d.by = "full"
		}
	case agent.BotApprove:
		d.card = botCard(tool, args, urls)
		d.card.Reason = out.Reason
	}
	return d
}

// botMCPDecision is the verdict for a tool of an MCP server in a bot run: the
// Bot's own setting for the server and the account's (an account-wide Off
// stops the bot too), read-only tools allowed, and writes blocked after taint
// or parked before it (agent.BotGate). Whether a tool is read-only is chat's
// own classifier (MCPRules.Classify, which reads the call's annotations); with
// no rules only a readOnlyHint counts.
func botMCPDecision(ctx context.Context, b BotRunCtx, rules MCPRules, uid string, ask gateAsk) hostDecision {
	server := ask.mcpServer()
	tool := ask.Tool
	var ann MCPAnnotations
	if ask.MCP != nil {
		if ask.MCP.Tool != "" {
			tool = ask.MCP.Tool
		}
		ann = ask.MCP.Annotations
	}
	args := map[string]any{}
	_ = json.Unmarshal(ask.Args, &args)
	urls := botURLs(ask.Tool, args)
	mode := b.MCP[server]
	if rules != nil && rules.Mode(ctx, uid, server) == mcpOff {
		mode = agent.BotMCPOff
	}
	action := agent.HostAction{Kind: agent.HostInput}
	readOnly := ann.ReadOnly != nil && *ann.ReadOnly
	if rules != nil {
		action = rules.Classify(ctx, uid, server, tool, ann)
		readOnly = action.Kind == agent.HostFetch
	}
	out := agent.BotGate(agent.BotGateIn{
		Tool:        ask.Tool,
		URLs:        urls,
		Mode:        agent.BotMode(b.Permission, b.FullAccessOK),
		Tainted:     b.Tainted,
		Hosts:       agent.BotHosts{Read: b.ReadHosts, Browser: b.BrowserSites, Egress: b.Egress, Search: b.SearchHosts},
		MCP:         true,
		MCPServer:   server,
		MCPMode:     mode,
		MCPReadOnly: readOnly,
	})
	d := hostDecision{verdict: out.Verdict, message: out.Message, reason: out.Reason, action: action}
	switch out.Verdict {
	case agent.BotAllow:
		d.by = "auto"
		if out.Lifted {
			d.by = "full"
		}
	case agent.BotApprove:
		d.card = HostCard{Kind: cardMCP, Title: "Use " + server + "?", Server: server, Command: clip(tool+" "+compactArgs(ask.Args), 4000), Reason: out.Reason}
	}
	return d
}

// gateBotMCP answers a gate.ask for an MCP tool of a bot run (r.bot set). The
// shared host path (decideHost) still blocks every bot MCP call, so this runs
// first: the same reply, bookkeeping and events as gateHost, with
// botMCPDecision's verdict.
func (e *WorkerEngine) gateBotMCP(r *agentRun, m agenthost.Message, ask gateAsk) {
	ctx, cancel := context.WithTimeout(r.ctx, 15*time.Second)
	defer cancel()
	st := e.hostState(ctx, r, ask)
	d := botMCPDecision(ctx, *st.bot, e.opts.MCP, r.uid, ask)
	reply := map[string]any{"verdict": d.verdict, "message": d.message}
	if d.verdict == agent.BotApprove {
		reply["card"] = d.card.wire()
	}
	if d.verdict == agent.BotAllow && d.by != "" {
		reply["by"] = d.by
	}
	if r.cards == nil {
		r.cards = map[string]hostPending{}
	}
	if d.verdict != agent.BotBlock {
		r.cards[ask.ToolCallID] = hostPending{card: d.card, grant: d.grant, tool: ask.Tool, argsHash: ask.ArgsHash, verdict: d.verdict}
		r.noteNetwork(ask.ToolCallID, ask.Tool, d.action)
	}
	_ = r.worker.Reply(m, agenthost.TypeGateVerdict, reply)
	detail := map[string]any{"toolset": ask.Toolset, "mode": string(st.bot.Permission)}
	switch d.verdict {
	case agent.BotAllow:
		e.s.logHostEvent(nil, hostEvent(r.uid, r.cid, r.id, ask.ToolCallID, "", ask.Tool, ask.ArgsHash, eventAllowed, "", d.reason, nil, detail), e.opts.Logf)
	case agent.BotBlock:
		e.s.logHostEvent(nil, hostEvent(r.uid, r.cid, r.id, ask.ToolCallID, "", ask.Tool, ask.ArgsHash, eventDenied, "", "blocked: "+d.message, nil, detail), e.opts.Logf)
	}
}

// botCard is the card parked in Needs you for a call a bot's mode holds. It
// shows the call's real arguments, as a chat card does.
func botCard(tool string, args map[string]any, urls []string) HostCard {
	if tool != "bot_browser_read" {
		_, card, _ := hostCall(tool, args, "", "", "")
		return card
	}
	target := ""
	if len(urls) > 0 {
		target = urls[0]
	}
	return HostCard{Kind: cardBrowser, Title: "Read this page in your browser?", URL: clip(target, 2000)}
}

// gateBotBrowser applies the per-account browser lease to a bot decision: an
// allowed browser call takes the lease for the Check, and when a chat holds it
// (or took it during the tick) the call is blocked as "browser busy", which
// the Check records. A nil lease, a parked or blocked call, and every
// non-browser tool pass through unchanged.
func gateBotBrowser(l *BrowserLease, uid, checkID, tool string, d hostDecision) hostDecision {
	if l == nil || d.verdict != agent.BotAllow || !browserClass(tool) {
		return d
	}
	if !l.TryAcquireBot(uid, checkID) {
		return hostDecision{verdict: agent.BotBlock, message: hostBrowserBusy, reason: hostBrowserBusy, action: d.action, browserBusy: true}
	}
	return d
}
