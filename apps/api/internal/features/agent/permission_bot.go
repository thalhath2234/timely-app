package agent

import (
	"net/url"
	"strings"
)

// Bot gate policy (plan 5.5b "Bots", 7.5, Q-B2): what a gate.ask from an
// agent Bot's tick gets. Nobody can approve during a tick, so the answer is
// allow, approve (the caller parks a card in Needs you and the tick goes on)
// or block, from the Bot's permission mode, its granted sites, its egress and
// whether the tick has read outside content. The pure rules live here; the
// chat package reads the call's arguments and builds the card.

// Bot gate verdicts, the strings gate.verdict carries.
const (
	BotAllow   = "allow"
	BotApprove = "approve"
	BotBlock   = "block"
)

// BotToolClass says which rule a tool falls under in a bot run.
type BotToolClass int

const (
	// BotToolUnknown is a tool Go has no bot rule for: blocked.
	BotToolUnknown BotToolClass = iota
	// BotToolOwn is a tool that touches nothing outside the Bot: its notes,
	// its report, skills and memory (writes are staged elsewhere).
	BotToolOwn
	// BotToolWebSearch is web_search.
	BotToolWebSearch
	// BotToolWebExtract is web_extract.
	BotToolWebExtract
	// BotToolBrowserRead is bot_browser_read: open a URL on a granted site
	// and return its text, on the real signed-in profile.
	BotToolBrowserRead
	// BotToolBrowserAct is every other browser tool (browser_exec,
	// browser_cdp, browser_dialog, typing, clicking, submitting): a script or
	// an action on the signed-in browser, always parked.
	BotToolBrowserAct
	// BotToolNever is a tool no bot run gets, in any mode.
	BotToolNever
)

// botNever are the tools a bot run never gets (plan 7.5): terminal, file and
// code tools, the browser vault, past-chat search, and the tools that make
// a bot recurse, ask a question nobody can answer or message out.
var botNever = map[string]string{
	"terminal":       "Bots can't run commands",
	"process":        "Bots can't run commands",
	"process_manage": "Bots can't run commands",
	"execute_code":   "Bots can't run code",
	"read_file":      "Bots can't use files on this computer",
	"search_files":   "Bots can't use files on this computer",
	"write_file":     "Bots can't use files on this computer",
	"patch":          "Bots can't use files on this computer",
	"vision_analyze": "Bots can't use files on this computer",
	"session_search": "Bots can't search past chats",
	"browser_vault":  "Bots can't open the browser vault",
	"cronjob_manage": "Bots can't schedule anything: Timely runs them on their own schedule",
	"cronjob":        "Bots can't schedule anything: Timely runs them on their own schedule",
	"create_bot":     "Bots can't make other bots",
	"clarify":        "Nobody can answer a question during a bot run: say what is missing in the report",
	"delegate_task":  "Bots can't hand work to other agents",
	"send_message":   "Bots can't message out: they tell you through alerts",
}

// botOwn are the tools that stay inside the Bot (plan 7.5: timely_bot, skills,
// memory) and the Timely read tools a bot may call (the Bot's notes, findings
// and history, docs, sheets, tasks and calendar reads). Allowed in every mode.
// A Timely write is not here: it is unknown, blocked, and a bot proposes it
// through bot_report instead (Q-B5).
var botOwn = map[string]bool{
	"bot_note_get": true, "bot_note_set": true, "bot_note_delete": true, "bot_report": true,
	"skill_view": true, "skills_list": true, "memory": true, "skill_manage": true,

	"get_context": true, "search": true, "semantic_search": true,
	"list_bots": true, "get_bot": true, "list_bot_findings": true,
	"list_docs": true, "get_doc": true, "list_sheets": true, "get_sheet": true,
	"list_tasks": true, "get_task": true, "list_inbox": true, "get_today": true, "get_agenda": true,
	"list_projects": true, "get_project": true, "list_workspaces": true, "get_workspace": true,
	"list_events": true, "get_event": true, "get_calendar": true,
}

// BotBlockUnknown is the block message for a tool with no bot rule.
const BotBlockUnknown = "That isn't available to bots in Timely yet"

// ClassifyBotTool is the rule a bot run's tool falls under. Never beats every
// other class, so a messaging or file tool can't slip through a prefix.
func ClassifyBotTool(tool string) BotToolClass {
	tool = strings.ToLower(strings.TrimSpace(tool))
	if _, never := botNever[tool]; never || strings.HasPrefix(tool, "messaging") || strings.HasPrefix(tool, "send_message") {
		return BotToolNever
	}
	switch {
	case botOwn[tool]:
		return BotToolOwn
	case tool == "web_search":
		return BotToolWebSearch
	case tool == "web_extract":
		return BotToolWebExtract
	case tool == "bot_browser_read":
		return BotToolBrowserRead
	case strings.HasPrefix(tool, "browser_"):
		return BotToolBrowserAct
	}
	return BotToolUnknown
}

// BotNeverMessage is why a never tool is blocked.
func BotNeverMessage(tool string) string {
	if m, ok := botNever[strings.ToLower(strings.TrimSpace(tool))]; ok {
		return m
	}
	return "Bots can't use this tool"
}

// BotHosts are the sites a Bot may reach: the hosts of its Reads, the sites
// the person granted its signed-in browser, its egress list and, until the
// tick is tainted, the hosts a web search of this tick returned.
type BotHosts struct {
	Read, Browser, Egress, Search []string
}

// BotHost is the lower-case host of an http(s) address or bare host name,
// without a leading "www.", and "" for anything else (another scheme, no
// host, an address that does not parse).
func BotHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if i := strings.Index(raw, "://"); i >= 0 {
		if s := strings.ToLower(raw[:i]); s != "http" && s != "https" {
			return ""
		}
	} else {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := strings.TrimPrefix(strings.TrimSuffix(strings.ToLower(u.Hostname()), "."), "www.")
	if strings.ContainsAny(host, " \t\r\n\\") {
		return ""
	}
	return host
}

// botHostIn reports whether raw's host is exactly one of the listed hosts
// (a list entry may be a URL or a bare host; a subdomain is not its parent).
func botHostIn(raw string, list []string) bool {
	host := BotHost(raw)
	if host == "" {
		return false
	}
	for _, entry := range list {
		if BotHost(entry) == host {
			return true
		}
	}
	return false
}

// Fetch reports whether web_extract may fetch raw: a bot host, or a host this
// tick's own web search returned before the tick was tainted.
func (h BotHosts) Fetch(raw string, tainted bool) bool {
	if botHostIn(raw, h.Read) || botHostIn(raw, h.Browser) || botHostIn(raw, h.Egress) {
		return true
	}
	return !tainted && botHostIn(raw, h.Search)
}

// Granted reports whether raw is on a site the person granted the Bot's
// signed-in browser.
func (h BotHosts) Granted(raw string) bool { return botHostIn(raw, h.Browser) }

// BotGateIn is one bot gate.ask, reduced to what the rules need.
type BotGateIn struct {
	Tool string
	// URLs are every address the call names.
	URLs []string
	// Acts is set when a browser call types, clicks, submits or carries a
	// script, whatever its tool.
	Acts bool
	// Mode is the Bot's permission mode (Full already reduced to Auto by the
	// caller when there is no step-up record: see BotMode).
	Mode    Mode
	Tainted bool
	Hosts   BotHosts
	// MCP is set for a tool of an MCP server; Tool then names that tool.
	// MCPServer is the server, MCPMode the Bot's setting for it (BotMCPUse,
	// BotMCPAsk or BotMCPOff) and MCPReadOnly whether chat's classifier reads
	// the tool as a read (annotations and name).
	MCP         bool
	MCPServer   string
	MCPMode     string
	MCPReadOnly bool
}

// The Bot's setting per MCP server (AgentTools.MCP).
const (
	BotMCPUse = "use"
	BotMCPAsk = "ask"
	BotMCPOff = "off"
)

// BotGateOut is Go's answer.
type BotGateOut struct {
	Verdict string
	// Message is a block's text, the model reads it.
	Message string
	// Reason is why the call was allowed or parked.
	Reason string
	// Lifted is set when Full Access (after the step-up) stands behind an
	// allow that the other modes would have parked or blocked.
	Lifted bool
}

// BotMode is the mode a bot's host calls follow: an unknown mode is
// Supervised, and Full Access without a step-up record acts as Auto
// (plan 5.5b decision 7).
func BotMode(permission string, fullAccessOK bool) Mode {
	mode, err := ParseMode(permission)
	switch {
	case err != nil:
		return Supervised
	case mode == Full && !fullAccessOK:
		return Auto
	}
	return mode
}

// BotGate decides one tool call of a bot run.
func BotGate(in BotGateIn) BotGateOut {
	block := func(msg string) BotGateOut { return BotGateOut{Verdict: BotBlock, Message: msg, Reason: msg} }
	allow := func(why string) BotGateOut { return BotGateOut{Verdict: BotAllow, Reason: why} }
	// Full Access, once stepped up, runs what the other modes park and lifts
	// the egress policy; the never tools and the hardline floor stay.
	lifted := func(why string) BotGateOut {
		return BotGateOut{Verdict: BotAllow, Reason: "Full Access: " + why, Lifted: true}
	}
	full := in.Mode == Full
	park := func(why string) BotGateOut {
		if full {
			return lifted(why)
		}
		prefix := "Auto parks this for you"
		if in.Mode != Auto {
			prefix = "Supervised parks this for you"
		}
		return BotGateOut{Verdict: BotApprove, Reason: prefix + ": " + why}
	}
	if in.MCP {
		if ClassifyBotTool(in.Tool) == BotToolNever {
			return block(BotNeverMessage(in.Tool))
		}
		return botMCPGate(in, block, park)
	}
	switch ClassifyBotTool(in.Tool) {
	case BotToolNever:
		return block(BotNeverMessage(in.Tool))
	case BotToolOwn:
		return allow("A tool inside this bot")
	case BotToolWebSearch:
		switch {
		case !in.Tainted:
			return allow("A search before any outside page was read")
		case full:
			return lifted("search after outside pages")
		}
		return block("After reading outside pages a bot can't search the web: a search could carry what it read out. Say what is missing in the report")
	case BotToolWebExtract:
		if len(in.URLs) == 0 {
			return block("That call names no web address")
		}
		for _, u := range in.URLs {
			if in.Hosts.Fetch(u, in.Tainted) {
				continue
			}
			if full {
				return lifted("fetch any site")
			}
			return block("This bot may only fetch the sites it watches, the sites you granted its browser and its egress list. Add the site to the bot's egress list to allow it")
		}
		return allow("A site this bot reads")
	case BotToolBrowserRead:
		if in.Acts {
			return park("typing or a submit in your signed-in browser")
		}
		if len(in.URLs) == 0 {
			return park("no site named")
		}
		for _, u := range in.URLs {
			if !in.Hosts.Granted(u) {
				return park("a site you have not granted this bot's browser")
			}
		}
		return allow("Reading a granted site")
	case BotToolBrowserAct:
		return park("a script or action in your signed-in browser")
	}
	return block(BotBlockUnknown)
}

// botMCPGate is the rule for a tool of an MCP server in a bot run: the Bot's
// setting for the server (off blocks), a URL only to a bot host, a read-only
// tool runs, and a tool that may change something is blocked once the tick has
// read outside content, and before that waits in Needs you (Supervised and
// Auto) or runs under Full Access once stepped up. "Ask me first" parks every
// call, Full Access included, as it does in chat.
func botMCPGate(in BotGateIn, block, park func(string) BotGateOut) BotGateOut {
	server := in.MCPServer
	if server == "" {
		server = "this app"
	}
	full := in.Mode == Full
	switch in.MCPMode {
	case BotMCPUse, BotMCPAsk:
	default:
		return block("You turned " + server + " off for this bot")
	}
	offHost := false
	for _, u := range in.URLs {
		if in.Hosts.Fetch(u, in.Tainted) {
			continue
		}
		if !full {
			return block("This bot may only send " + server + " addresses on the sites it watches, the sites you granted its browser and its egress list")
		}
		offHost = true
	}
	ask := in.MCPMode == BotMCPAsk
	askFirst := BotGateOut{Verdict: BotApprove, Reason: "You set " + server + " to Ask me first"}
	switch {
	case in.MCPReadOnly && ask:
		return askFirst
	case in.MCPReadOnly && offHost:
		return BotGateOut{Verdict: BotAllow, Reason: "Full Access: " + server + " given any address", Lifted: true}
	case in.MCPReadOnly:
		return BotGateOut{Verdict: BotAllow, Reason: "A read-only tool of " + server}
	case in.Tainted && !full:
		return block("After reading outside pages a bot can only use read-only tools of " + server + ": a change could carry what it read out. Say what is needed in the report")
	case ask:
		return askFirst
	}
	return park("a tool of " + server + " that may change something")
}
