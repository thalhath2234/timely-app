package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"

	"timely-api/internal/features/agent"
)

// Go's verdict for a host tool call (work packages decisions 5, 6 and 8):
// the worker's timely_gate asks for every terminal, file, code, browser and
// MCP call (gate.ask), and Go answers allow, approve (a host card) or block
// from the account, the chat, its permission mode, the critical list
// (agent.CriticalHost) and the chat's grants. The card text comes from the
// call's real arguments.

// hostTools are the tools the worker asks Go about as host calls
// (policy.HOST_TOOLS, PROTOCOL.md 12.3).
var hostTools = map[string]bool{
	"terminal": true, "process": true, "process_manage": true, "read_file": true, "search_files": true,
	"write_file": true, "patch": true, "execute_code": true, "browser_exec": true, "browser_cdp": true,
	"browser_dialog": true, "vision_analyze": true,
}

// hostToolsets are the toolsets a host-allowed chat run gets (decision 9).
var hostToolsets = []string{"terminal", "file", "code_execution", "browser-use", "browser-cdp"}

// Block messages for host calls (the model reads them).
const (
	hostNotAllowed  = "This account can't use this computer. Turn it on in the desktop app, Settings → Server."
	hostBotBlocked  = "Bots can't use this computer"
	hostAnswerOnly  = "This turn only answers from your bots, so it can't use this computer or MCP servers"
	hostSensitive   = "Sensitive chats can't use this computer or MCP servers"
	hostMCPOff      = "You turned %s off in Settings → Agent → MCP servers"
	hostUnknownTool = "That isn't available in Timely yet"
)

// MCPAnnotations are an MCP tool's declared hints, as gate.ask carries them.
type MCPAnnotations struct {
	ReadOnly    *bool `json:"readOnlyHint,omitempty"`
	Destructive *bool `json:"destructiveHint,omitempty"`
	Idempotent  *bool `json:"idempotentHint,omitempty"`
	OpenWorld   *bool `json:"openWorldHint,omitempty"`
}

// MCPRules are the account's external MCP servers as the gate needs them
// (agentmcp.Service, through an adapter in cmd). Nil: every MCP tool is
// Ask me first, no server is offered to a run, and a command server is
// never approved.
type MCPRules interface {
	// Mode is use, ask or off.
	Mode(ctx context.Context, uid, server string) string
	// Classify says what a server's tool does, as a host action.
	Classify(ctx context.Context, uid, server, tool string, ann MCPAnnotations) agent.HostAction
	// ApproveStdio records the person's OK of a command server on its host
	// card (hash: the entry the card showed).
	ApproveStdio(ctx context.Context, uid, name, hash string) error
	// RefuseStdio records that the card for a command server (hash) was
	// denied, stopped or expired: the server then reads "not added".
	RefuseStdio(ctx context.Context, uid, name, hash string) error
	// Servers are the account's servers and their modes.
	Servers(ctx context.Context, uid string) map[string]string
}

// MCP server modes.
const (
	mcpUse = "use"
	mcpAsk = "ask"
	mcpOff = "off"
)

// gateAsk is a gate.ask (PROTOCOL.md 5 and 12.3).
type gateAsk struct {
	Tool       string          `json:"tool"`
	ToolCallID string          `json:"tool_call_id"`
	Args       json.RawMessage `json:"args"`
	ArgsHash   string          `json:"args_hash"`
	Toolset    string          `json:"toolset"`
	Inner      bool            `json:"inner"`
	RunKind    string          `json:"run_kind"`
	// Cwd is the folder the terminal and file tools resolve relative paths
	// from when the call names none (Hermes' recorded session folder), as the
	// worker reports it.
	Cwd string `json:"cwd"`
	MCP *struct {
		Server      string         `json:"server"`
		Tool        string         `json:"tool"`
		Annotations MCPAnnotations `json:"annotations"`
	} `json:"mcp"`
	Tainted []TaintSource `json:"tainted_sources"`
}

// mcpServer is the MCP server a call belongs to ("" for none).
func (a gateAsk) mcpServer() string {
	if a.MCP != nil && a.MCP.Server != "" {
		return a.MCP.Server
	}
	if s, ok := strings.CutPrefix(a.Toolset, "mcp-"); ok {
		return s
	}
	return ""
}

// hostState is what a host decision reads: the account, the chat as it is
// stored now (a stricter mode applies from the next call) and the run.
type hostState struct {
	hostAllowed bool
	workingDir  string
	// mode is the effective mode: Full Access without a step-up record is
	// Auto (decision 7).
	mode    agent.Mode
	grants  HostGrants
	tainted bool
	hosts   []string
	// home is the OS user's home (what ~, $HOME and a bare cd mean).
	home string
	// taintedLocal is set when the chat is tainted and every source of it is
	// local file or command output (never a page, a browser or an MCP
	// result). Unset is the safe reading.
	taintedLocal bool
	answerOnly   bool
	sensitive    bool
	noPersist    bool
	mcp          MCPRules
	uid          string
}

// hostDecision is Go's answer to one host call.
type hostDecision struct {
	verdict string // allow, approve or block
	message string // a block's message
	reason  string // why it was allowed (mode, grant) or carded
	card    HostCard
	grant   *HostGrant // what Allow for this chat would add
	action  agent.HostAction
	// by is who stands behind an allow: "auto" (the mode alone), "full"
	// (Full Access) or "grant" (the person's Allow for this chat). The worker
	// answers Hermes' own second prompt only for a call a person or Full
	// Access stands behind.
	by string
}

// decideHost is decision 5 for one call. ok is false for a tool that is
// neither a host tool nor an MCP tool.
func decideHost(ctx context.Context, ask gateAsk, st hostState) (hostDecision, bool) {
	server := ask.mcpServer()
	isMCP := server != ""
	if !isMCP && !hostTools[ask.Tool] {
		return hostDecision{}, false
	}
	block := func(msg string) (hostDecision, bool) {
		return hostDecision{verdict: "block", message: msg, reason: msg}, true
	}
	switch {
	case ask.RunKind == "bot":
		return block(hostBotBlocked)
	case st.answerOnly:
		return block(hostAnswerOnly)
	case st.sensitive || st.noPersist:
		return block(hostSensitive)
	case !isMCP && !st.hostAllowed:
		return block(hostNotAllowed)
	}
	args := map[string]any{}
	_ = json.Unmarshal(ask.Args, &args)
	var d hostDecision
	forced := "" // a reason the call always asks in Auto, off the critical list
	if isMCP {
		mode := mcpAsk
		if st.mcp != nil {
			mode = st.mcp.Mode(ctx, st.uid, server)
		}
		tool := ask.Tool
		if ask.MCP != nil && ask.MCP.Tool != "" {
			tool = ask.MCP.Tool
		}
		d.card = HostCard{Kind: cardMCP, Title: "Use " + server + "?", Server: server, Command: clip(tool+" "+compactArgs(ask.Args), 4000)}
		switch mode {
		case mcpOff:
			return block(fmt.Sprintf(hostMCPOff, server))
		case mcpUse:
			var ann MCPAnnotations
			if ask.MCP != nil {
				ann = ask.MCP.Annotations
			}
			if st.mcp != nil {
				d.action = st.mcp.Classify(ctx, st.uid, server, tool, ann)
			} else {
				d.action = agent.HostAction{Kind: agent.HostSend}
			}
			d.grant = newGrant("mcp", "mcp:"+server+"/"+tool, "Use "+tool+" on "+server)
		default: // ask, and anything unknown
			d.verdict, d.reason = "approve", "You set "+server+" to Ask me first"
			d.card.Reason = d.reason
			return d, true
		}
	} else {
		d.action, d.card, d.grant = hostCall(ask.Tool, args, st.workingDir, ask.Cwd, st.home)
		d.card.SessionCwd = clip(dropNUL(strings.TrimSpace(ask.Cwd)), 1000)
		// The hardline floor holds in every mode, Full Access included: Hermes'
		// own floor misses a program written with its path or behind a wrapper.
		if why, hard := agent.HardlineHost(d.action, agent.HostScope{Workspace: st.workingDir, Home: st.home}); hard {
			return block("Timely never runs this, in any mode: it " + why + ".")
		}
		switch ask.Tool {
		case "execute_code":
			forced = "runs code on this computer"
		case "browser_exec", "browser_cdp", "browser_dialog":
			// A script on the signed-in real profile can submit, send or
			// sign in, and no literal check can tell (decision 6).
			forced = "uses your signed-in browser"
		}
	}
	scope := agent.HostScope{Workspace: st.workingDir, Hosts: st.hosts, Home: st.home}
	item, why, critical := agent.CriticalHost(d.action, scope)
	// Item 6 (a call after outside content) is checked last, so a real
	// critical item shows as itself. A grant covers item 6 only when the
	// chat's taint is all local file and command output: the granted command's own
	// output taints the chat (the worker marks terminal and file results), and
	// without this a terminal grant could never fire a second time (Q-5.1).
	// Pages, a browser or an MCP result keep every call a card.
	taintHold := false
	if !critical && st.tainted {
		scope.Tainted = true
		if i, w, c := agent.CriticalHost(d.action, scope); c {
			item, why, critical, taintHold = i, w, true, true
		}
	}
	if strings.HasPrefix(ask.Tool, "browser_") && paymentLike(d.card.URL+" "+d.card.Command) {
		item, why, critical = agent.CriticalPaying, "uses your signed-in browser on a payment or sign-in page", true
	}
	// A grant never covers a critical-list item, whatever the mode: deleting,
	// sending out, paying, installing, settings, and a call that comes after
	// outside content (item 6) all stay card-only (decision 8). Keeping the
	// rule the same in Supervised and Auto is what makes Supervised never
	// looser than Auto for the same call and grants (review of the exit check).
	// Auto asks for every browser call and all code (forced), and Full Access
	// still asks for the signed-in browser: a grant never covers those there.
	browser := strings.HasPrefix(ask.Tool, "browser_")
	askedForced := forced != "" && (st.mode == agent.Auto || (st.mode == agent.Full && browser))
	grantable := d.grant != nil && (!critical || (taintHold && st.taintedLocal)) && !askedForced
	if askedForced && !critical {
		// Off the critical list: the reason says why it asks, and the card
		// names no list item (the browser asks even in Full Access).
		critical, why, item = true, forced, 0
	}
	switch st.mode {
	case agent.Full:
		if critical && browser {
			// Plan 14: no network-level private-address control stands behind
			// the signed-in browser yet, so Full Access does not lift its card.
			d.verdict, d.reason = "approve", why
		} else {
			d.verdict, d.reason, d.by = "allow", "Full Access", "full"
		}
	case agent.Auto:
		if critical {
			d.verdict, d.reason = "approve", why
		} else {
			d.verdict, d.reason, d.by = "allow", "Auto", "auto"
		}
	default:
		d.verdict, d.reason = "approve", "Supervised asks before every action"
		if critical {
			d.reason = why
		}
	}
	if d.verdict == "approve" && grantable {
		if g := st.grants.match(d.grant.Match); g != nil {
			d.verdict, d.reason, d.by = "allow", "Allowed for this chat: "+g.Label, "grant"
		}
	}
	d.card.Reason = d.reason
	if critical && d.verdict == "approve" {
		d.card.CriticalItem = item
	}
	d.card.Grantable = d.verdict == "approve" && grantable
	if !d.card.Grantable {
		d.grant = nil
	}
	return d, true
}

// paymentLike is agent.paymentURL's rule for text that may hold a URL.
var paymentLikeWords = regexp.MustCompile(`(?i)(checkout|payment|/pay\b|paypal|stripe|billing|/cart\b|purchase|subscribe|donate|log-?in|sign-?in|signon|/sso\b|oauth|/auth\b|password)`)

func paymentLike(s string) bool { return paymentLikeWords.MatchString(s) }

// match finds a grant with this kind key.
func (g HostGrants) match(key string) *HostGrant {
	for i := range g {
		if g[i].Match == key {
			return &g[i]
		}
	}
	return nil
}

// newGrant is an "Allow for this chat" grant; Key is a short digest of
// Match, safe in a URL.
func newGrant(kind, match, label string) *HostGrant {
	sum := sha256.Sum256([]byte(match))
	return &HostGrant{Kind: kind, Key: hex.EncodeToString(sum[:8]), Match: match, Label: clip(label, 200)}
}

// grantSubcommand are the programs whose grant also names the first
// subcommand ("git status", not every git).
var grantSubcommand = map[string]bool{"git": true, "gh": true, "npm": true, "pnpm": true, "yarn": true, "npx": true, "uv": true,
	"pip": true, "pip3": true, "cargo": true, "go": true, "make": true, "docker": true, "kubectl": true,
	// Tools whose one program deletes as easily as it lists (review round 3):
	// a grant from `terraform plan` must not cover `terraform destroy`.
	"terraform": true, "tofu": true, "pulumi": true, "helm": true, "podman": true, "oc": true, "bun": true, "rclone": true, "gsutil": true,
	"heroku": true, "fly": true, "flyctl": true, "vercel": true, "netlify": true, "wrangler": true, "firebase": true, "systemctl": true, "brew": true, "apt": true,
	"aws": true, "gcloud": true, "az": true, "doctl": true}

// grantDepth is how many words after the program a grant names, for the tools
// with a service and an operation (aws s3 ls, gcloud compute instances list).
var grantDepth = map[string]int{"aws": 2, "gcloud": 3, "az": 3, "doctl": 2}

// shellOperators make a command line ungrantable: "ls" must not carry "; rm".
var shellOperators = []string{"|", ";", "&", ">", "<", "$(", "`", "\n", "\r"}

// commandGrant is the grant for a terminal command, or nil: a command with a
// shell operator, an environment assignment or sudo is never grantable.
func commandGrant(command string) *HostGrant {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil
	}
	for _, op := range shellOperators {
		if strings.Contains(command, op) {
			return nil
		}
	}
	words := strings.Fields(command)
	prog := strings.TrimLeft(strings.Trim(words[0], `"'`), `\`)
	if prog == "" || strings.Contains(prog, "=") || ungrantable(path.Base(prog)) {
		return nil
	}
	// Any option that hands the program code to run (-c, -e, --eval) or a
	// command to run (find -exec, git -c alias.x=!cmd) makes the line a
	// different command each time: "same kind of command" can't hold.
	for _, w := range words[1:] {
		w = strings.Trim(w, `"'`)
		if codeOption(w) {
			return nil
		}
	}
	key := prog
	if grantSubcommand[prog] {
		rest := words[1:]
		if prog == "git" {
			// git's global options come before the subcommand and -C takes a
			// folder: `git -C /repo status` is "git status"; -c runs code.
			var code bool
			if rest, code = gitGlobalsSkipped(rest); code {
				return nil
			}
		}
		depth := max(grantDepth[prog], 1)
		for _, w := range rest {
			w = strings.Trim(w, `"'`)
			if w != "" && !strings.HasPrefix(w, "-") {
				key += " " + w
				if depth--; depth == 0 {
					break
				}
			}
		}
	}
	return newGrant("terminal", "terminal:"+key, "Commands that start with "+key)
}

// gitGlobalsSkipped drops git's global options (-C <dir>, --git-dir <dir>,
// flags) from a command's words; code is true for -c, which hands git a
// setting that can run a program.
func gitGlobalsSkipped(words []string) (rest []string, code bool) {
	i := 0
	for i < len(words) {
		w := strings.Trim(words[i], `"'`)
		switch {
		case w == "-C" || w == "--git-dir" || w == "--work-tree" || w == "--namespace" || w == "--super-prefix":
			i += 2
		case w == "-c" || strings.HasPrefix(w, "--config-env") || (strings.HasPrefix(w, "-c") && strings.Contains(w, "=")):
			return nil, true
		case strings.HasPrefix(w, "-"):
			i++
		default:
			return words[i:], false
		}
	}
	return nil, false
}

// ungrantableProgs run other code or other programs, so a grant keyed on
// the program name would cover anything: privilege wrappers, shells,
// interpreters and programs that run a command they are given.
var ungrantableProgs = programSet("sudo", "doas", "su", "env", "exec", "eval", "nohup", "time", "command", "builtin", "xargs",
	"sh", "bash", "zsh", "dash", "ksh", "fish", "ash", "csh", "tcsh", "mksh", "cmd", "cmd.exe",
	"python", "python2", "python3", "pypy", "pypy3", "node", "nodejs", "bun", "deno", "perl", "ruby", "php", "lua", "osascript",
	"rscript", "julia", "pwsh", "powershell", "awk", "gawk", "mawk", "sed",
	"timeout", "nice", "ionice", "stdbuf", "setsid", "watch", "flock", "taskset", "busybox", "unbuffer", "chronic",
	"find", "parallel", "script", "expect", "ssh", "screen", "tmux")

func programSet(items ...string) map[string]bool {
	out := map[string]bool{}
	for _, i := range items {
		out[i] = true
	}
	return out
}

var pythonLike = regexp.MustCompile(`^(python|pypy)[0-9.]+$`)

func ungrantable(prog string) bool { return ungrantableProgs[prog] || pythonLike.MatchString(prog) }

// codeOption reports whether a word is an option that carries code or a
// command to run.
func codeOption(w string) bool {
	switch w {
	case "--eval", "--print", "--command", "-exec", "-execdir", "-ok", "-okdir", "-command", "-encodedcommand":
		return true
	}
	return false
}

// folderGrant is the grant for a file tool in the folder of p.
func folderGrant(tool, verb, p, workingDir string) *HostGrant {
	p = strings.TrimSpace(p)
	if p == "" || strings.HasPrefix(p, "~") || strings.HasPrefix(p, "$") {
		return nil
	}
	if !path.IsAbs(p) {
		if workingDir == "" {
			return nil
		}
		p = path.Join(workingDir, p)
	}
	dir := path.Dir(path.Clean(p))
	return newGrant("file", tool+":"+dir, verb+" files in "+dir)
}

// hostCall maps a host tool call onto the host action the critical list
// judges (decision 6), the card it shows and the grant it may take.
func hostCall(tool string, args map[string]any, workingDir, sessionCwd, home string) (agent.HostAction, HostCard, *HostGrant) {
	str := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := args[k].(string); ok && strings.TrimSpace(v) != "" {
				return dropNUL(v)
			}
		}
		return ""
	}
	// The folder the call runs in, read the way Hermes reads it: only the
	// terminal takes a `workdir` (`~` and `~/x` expand to the home, a
	// relative one starts in the folder the terminal session is in now);
	// every other tool runs in the session's folder, else the working
	// folder. No other key (`cwd`, `workdir` on a file tool) moves a call,
	// so none may move the folder judged here.
	cwd := strings.TrimSpace(dropNUL(sessionCwd))
	if cwd == "" {
		cwd = workingDir
	}
	if tool == "terminal" {
		if w := strings.TrimSpace(str("workdir")); w != "" {
			switch {
			case w == "~" && home != "":
				cwd = home
			case strings.HasPrefix(w, "~/") && home != "":
				cwd = path.Join(home, w[2:])
			case path.IsAbs(w) || cwd == "":
				cwd = w
			default:
				cwd = path.Join(cwd, w)
			}
		}
	}
	where := cwd
	if where != "" && !path.IsAbs(where) && workingDir != "" {
		where = path.Join(workingDir, where)
	}
	switch tool {
	case "terminal":
		command := str("command", "cmd")
		return agent.HostAction{Kind: agent.HostTerminal, Command: command, Cwd: where},
			HostCard{Kind: cardTerminal, Title: "Run this command?", Command: clip(command, 4000), Cwd: clip(cwd, 1000)}, commandGrant(command)
	case "process", "process_manage":
		action := str("action")
		session := str("session_id", "pid", "process_id")
		data := str("data", "input")
		command := strings.TrimSpace("process " + action + " " + session)
		card := HostCard{Kind: cardTerminal, Title: "Manage a running command?", Cwd: clip(cwd, 1000)}
		if action == "write" || action == "submit" {
			// What is typed into a running command is a command: the
			// critical list judges it, and no grant covers it, because the
			// next input can be anything (Hermes runs no guard on stdin).
			card.Title, card.Command = "Type into a running command?", clip(data, 4000)
			return agent.HostAction{Kind: agent.HostTerminal, Command: data, Cwd: where}, card, nil
		}
		card.Command = clip(command, 4000)
		return agent.HostAction{Kind: agent.HostTerminal, Command: command, Cwd: where}, card,
			newGrant("terminal", "process:"+action, "Manage running commands ("+action+")")
	case "read_file":
		p := str("path", "file_path")
		return agent.HostAction{Kind: agent.HostFileRead, Path: p, Cwd: where},
			HostCard{Kind: cardFile, Title: "Read this file?", Path: clip(p, 1000), Cwd: clip(cwd, 1000)}, folderGrant(tool, "Read", p, where)
	case "search_files":
		p := str("path", "directory")
		if p == "" {
			p = workingDir
		}
		return agent.HostAction{Kind: agent.HostFileRead, Path: p, Cwd: where},
			HostCard{Kind: cardFile, Title: "Search these files?", Path: clip(p, 1000), Command: clip(str("pattern", "query", "regex"), 1000), Cwd: clip(cwd, 1000)},
			folderGrant(tool, "Search", path.Join(p, "x"), where)
	case "write_file", "patch":
		// Hermes applies every file a V4A patch names, whatever `path` says:
		// judge and show them all, and take the worst.
		files := []patchOp{}
		if p := str("path", "file_path"); p != "" {
			files = append(files, patchOp{path: p})
		}
		if tool == "patch" {
			for _, op := range patchOps(str("patch")) {
				// `path` and a header often name the same file: show it once
				// (a delete of it is still its own entry).
				if len(files) == 1 && files[0].path == op.path && !op.delete {
					continue
				}
				files = append(files, op)
			}
		}
		action := agent.HostAction{Kind: agent.HostFileWrite, Cwd: where} // no file named: critical, nobody can read it
		for i, f := range files {
			kind := agent.HostFileWrite
			if f.delete {
				kind = agent.HostFileDelete
			}
			one := agent.HostAction{Kind: kind, Path: f.path, Cwd: where}
			if i == 0 {
				action = one
			} else {
				action.Also = append(action.Also, one)
			}
		}
		card := HostCard{Kind: cardFile, Title: "Change this file?", Cwd: clip(cwd, 1000)}
		grantable := len(files) > 0
		lines := make([]string, len(files))
		for i, f := range files {
			verb := "Change "
			if f.delete {
				verb, grantable = "Delete ", false
			}
			if path.Dir(path.Clean(f.path)) != path.Dir(path.Clean(files[0].path)) {
				grantable = false // one grant is one folder
			}
			lines[i] = verb + f.path
		}
		switch {
		case len(files) == 1 && !files[0].delete:
			card.Path = clip(files[0].path, 1000)
		case len(files) == 1:
			card.Title, card.Path = "Delete this file?", clip(files[0].path, 1000)
		case len(files) > 1:
			card.Title, card.Path = "Change these files?", clip(strings.Join(lines, "\n"), 1000)
			if slices.ContainsFunc(files, func(f patchOp) bool { return f.delete }) {
				card.Title = "Change and delete these files?"
			}
		}
		if !grantable {
			return action, card, nil
		}
		return action, card, folderGrant(tool, "Change", files[0].path, where)
	case "vision_analyze":
		p := str("image_url", "path", "image_path")
		return agent.HostAction{Kind: agent.HostFileRead, Path: p, Cwd: where},
			HostCard{Kind: cardFile, Title: "Read this image?", Path: clip(p, 1000)}, folderGrant(tool, "Read images", p, where)
	case "execute_code":
		code := str("code", "script")
		return agent.HostAction{Kind: agent.HostTerminal, Command: code, Cwd: where, Code: true},
			HostCard{Kind: cardCode, Title: "Run this code?", Command: clip(code, 4000), Cwd: clip(cwd, 1000)}, nil
	}
	// browser_exec, browser_cdp, browser_dialog. The card shows what the call
	// does as plain text: the script itself for browser_exec (it has no url
	// argument: the address is only what the script names), the method and
	// parameters for browser_cdp, the action for browser_dialog.
	script := ""
	switch tool {
	case "browser_exec":
		script = str("code")
	case "browser_cdp":
		script = strings.TrimSpace(str("method") + " " + compactValue(args["params"]))
	case "browser_dialog":
		script = strings.TrimSpace(str("action") + " " + str("prompt_text"))
	}
	target := str("url")
	if target == "" {
		if params, ok := args["params"].(map[string]any); ok {
			if u, ok := params["url"].(string); ok {
				target = strings.TrimSpace(u)
			}
		}
	}
	if target == "" {
		target = navigationTarget(script)
	}
	card := HostCard{Kind: cardBrowser, Title: "Use your browser?", URL: clip(target, 2000), Command: clip(script, 4000)}
	// No grant: a script on the signed-in profile can do anything on the
	// site it names, and Auto asks for every browser call, so a grant in
	// Supervised would be looser than Auto for the same call.
	if target == "" {
		// Nothing is opened: it acts on the page that is open now. Not a
		// request to a site the person never named, but still the signed-in
		// browser (the forced reason says so).
		return agent.HostAction{Kind: agent.HostInput, Command: script}, card, nil
	}
	return agent.HostAction{Kind: agent.HostFetch, URL: target, Command: script}, card, nil
}

// navigationTarget is the address a browser script opens: its first goto,
// navigate, new_tab or open_url, else the first URL anywhere in it.
func navigationTarget(script string) string {
	if m := navigateCall.FindStringSubmatch(script); m != nil {
		return strings.TrimSpace(m[1])
	}
	return firstURL(script)
}

// compactValue is a JSON value as compact text ("" for nothing or {}).
func compactValue(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil || string(b) == "{}" || string(b) == "null" {
		return ""
	}
	return string(b)
}

var (
	urlInText    = regexp.MustCompile(`(?i)\bhttps?://[^\s'"<>\\)]+`)
	domainInMsg  = regexp.MustCompile(`(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b`)
	navigateCall = regexp.MustCompile(`(?i)\b(?:goto|navigate|new_tab|open_url|open_tab|go_to)\s*\(\s*(?:url\s*=\s*)?["']([^"']+)["']`)
	// The headers Hermes' V4A parser reads (file_tools._V4A_SINGLE_HEADER_RE and
	// _V4A_MOVE_HEADER_RE), read a little more loosely.
	patchHeader = regexp.MustCompile(`(?m)^\s*\*\*\*\s*(Update|Add|Delete)\s+File:\s*(.+?)\s*$`)
	patchMove   = regexp.MustCompile(`(?m)^\s*\*\*\*\s*Move\s+File:\s*(.+?)\s*->\s*(.+?)\s*$`)
)

func firstURL(s string) string { return urlInText.FindString(s) }

// patchOp is one file a V4A patch touches: delete is a Delete File or the
// source of a Move File.
type patchOp struct {
	path   string
	delete bool
}

// patchOps is every file a V4A patch names, in order: Update, Add, Delete and
// both ends of a Move.
func patchOps(patch string) []patchOp {
	var ops []patchOp
	for _, m := range patchHeader.FindAllStringSubmatch(patch, -1) {
		ops = append(ops, patchOp{path: m[2], delete: m[1] == "Delete"})
	}
	for _, m := range patchMove.FindAllStringSubmatch(patch, -1) {
		ops = append(ops, patchOp{path: m[1], delete: true}, patchOp{path: m[2]})
	}
	return ops
}

// compactArgs is a call's arguments as compact JSON for a card.
func compactArgs(args json.RawMessage) string {
	var v any
	if json.Unmarshal(args, &v) != nil {
		return ""
	}
	if m, ok := v.(map[string]any); ok && len(m) == 0 {
		return ""
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// personHosts are the sites the person named in the chat's own messages
// (agent.HostScope.Hosts): a request elsewhere could carry data out.
func personHosts(messages []Message) []string {
	var out []string
	for _, m := range messages {
		if m.Role != "user" {
			continue
		}
		for _, u := range urlInText.FindAllString(m.Content, -1) {
			out = append(out, u)
		}
		for _, d := range domainInMsg.FindAllString(m.Content, -1) {
			out = append(out, d)
		}
	}
	return out
}
