package agent

import (
	"fmt"
	"net"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
)

// Permission modes and the critical list (plan 5.5b). Go is the source of
// truth for both: the chat decides from them whether a proposal is held for
// Approve or applied at once with Undo, and in phase 5 the worker's gate asks
// Go the same question for host tools. Hermes' own pattern detector is only a
// second opinion inside the worker.

// Mode is how much the agent may do without asking.
type Mode string

const (
	// Supervised asks before every change.
	Supervised Mode = "supervised"
	// Auto asks only before the critical list.
	Auto Mode = "auto"
	// Full asks before nothing a mode can lift. For Timely data in phase 2
	// it behaves like Auto: critical changes are still held.
	Full Mode = "full"
)

// ParseMode accepts the stored and wire names of the three modes.
func ParseMode(s string) (Mode, error) {
	switch m := Mode(strings.ToLower(strings.TrimSpace(s))); m {
	case Supervised, Auto, Full:
		return m, nil
	}
	return "", fmt.Errorf("unknown permission mode %q: use supervised, auto or full", s)
}

// Stricter reports whether m asks before more than other. A switch to a
// stricter mode applies from the next tool call; a switch to a looser one
// never approves cards already waiting.
func (m Mode) Stricter(other Mode) bool {
	return m.rank() < other.rank()
}

func (m Mode) rank() int {
	switch m {
	case Supervised:
		return 0
	case Auto:
		return 1
	case Full:
		return 2
	}
	return -1
}

// HoldsTimelyChange reports whether a proposal to change Timely data waits
// for Approve in this mode, given whether any of its steps is critical.
// Supervised holds every proposal; Auto and Full hold critical ones (phase 2:
// Full Access lifts nothing more for Timely data until the phase 5 step-up).
// An unknown mode holds everything.
func (m Mode) HoldsTimelyChange(critical bool) bool {
	switch m {
	case Auto, Full:
		return critical
	}
	return true
}

// The six items of the critical list, in the order Settings shows them.
const (
	CriticalDeleting   = 1 // Deleting or overwriting
	CriticalSendingOut = 2 // Sending the person's data out
	CriticalPaying     = 3 // Buying, paying or signing in
	CriticalInstalling = 4 // Installing software
	CriticalSettings   = 5 // Changing settings or permissions
	CriticalTainted    = 6 // Changes after reading outside content (a page, a file, command output)
)

// bulkItems is the most items one change may touch before it counts as a
// bulk change (critical item 1).
const bulkItems = 10

// Action is one change to Timely data: a Write tool step of a proposal.
type Action struct {
	Tool string
	Args map[string]any
	// Items is how many existing objects the step changes, when the caller
	// knows more than the arguments say. Critical also counts the
	// arguments' own lists (ids, rows, cells) and takes the larger.
	Items int
	// Tainted is set when the conversation has read outside pages
	// (tainted_sources is not empty): then every change is critical.
	Tainted bool
}

// Critical reports whether an action is on the critical list: its item
// number (the first that applies), and a short reason for the card.
func Critical(a Action) (item int, reason string, ok bool) {
	risk, known := writeRisks[a.Tool]
	if !known {
		// A tool without a classification is never applied unasked.
		return CriticalDeleting, "is not a known change", true
	}
	if risk.item != 0 {
		return risk.item, risk.reason, true
	}
	if risk.when != nil {
		if item, reason := risk.when(a.Args); item != 0 {
			return item, reason, true
		}
	}
	if !risk.creates {
		n := a.Items
		if risk.count != nil {
			n = max(n, risk.count(a.Args))
		}
		if n > bulkItems {
			return CriticalDeleting, fmt.Sprintf("changes %d items at once", n), true
		}
	}
	if a.Tainted {
		return CriticalTainted, "comes after reading outside pages", true
	}
	return 0, "", false
}

// CriticalPlan is Critical over a whole proposal. Besides each step's own
// item, a plan whose steps together change more than ten existing objects
// is a bulk change; steps that only add new objects do not count.
func CriticalPlan(actions []Action) (item int, reason string, ok bool) {
	changed := 0
	for _, a := range actions {
		if item, reason, ok := Critical(a); ok {
			return item, reason, true
		}
		risk := writeRisks[a.Tool]
		if risk.creates {
			continue
		}
		n := max(a.Items, 1)
		if risk.count != nil {
			n = max(n, risk.count(a.Args))
		}
		changed += n
	}
	if changed > bulkItems {
		return CriticalDeleting, fmt.Sprintf("changes %d items at once", changed), true
	}
	return 0, "", false
}

// writeRisk is one Write tool's place on the critical list.
type writeRisk struct {
	// creates marks tools that only add new objects, so they never count
	// toward a bulk change.
	creates bool
	// item and reason, when set, make every call critical.
	item   int
	reason string
	// when decides from the arguments (0 = not critical).
	when func(args map[string]any) (int, string)
	// count is how many existing objects a call changes.
	count func(args map[string]any) int
}

func adds() writeRisk                     { return writeRisk{creates: true} }
func edits() writeRisk                    { return writeRisk{} }
func always(item int, r string) writeRisk { return writeRisk{item: item, reason: r} }
func deletes(r string) writeRisk          { return always(CriticalDeleting, r) }
func editsWhen(fn func(map[string]any) (int, string)) writeRisk {
	return writeRisk{when: fn}
}

// overwritesWhen is critical item 1 when any of the keys is set.
func overwritesWhen(reason string, keys ...string) func(map[string]any) (int, string) {
	has := hasAny(keys...)
	return func(args map[string]any) (int, string) {
		if has(args) {
			return CriticalDeleting, reason
		}
		return 0, ""
	}
}

// countList counts the entries of a list (or object) argument.
func countList(key string) func(map[string]any) int {
	return func(args map[string]any) int {
		switch v := args[key].(type) {
		case []any:
			return len(v)
		case map[string]any:
			return len(v)
		}
		return 0
	}
}

// writeRisks classifies every Write tool. TestEveryWriteToolIsClassified
// fails when a Write tool is missing, so no change can reach Auto without a
// decision; a missing name is treated as critical meanwhile.
var writeRisks = map[string]writeRisk{
	// Tasks.
	"create_task":           adds(),
	"capture_inbox_item":    adds(),
	"clarify_inbox_item":    edits(),
	"update_task":           edits(),
	"bulk_update_tasks":     {count: countList("ids")},
	"complete_task":         edits(),
	"reopen_task":           edits(),
	"move_task_to_status":   edits(),
	"move_task_to_stage":    edits(),
	"set_task_labels":       edits(),
	"set_task_custom_field": edits(),
	"set_task_dependency":   edits(),
	"add_task_comment":      adds(),
	"set_task_recurrence":   edits(),
	"clear_task_recurrence": deletes("turns a repeating series into one task"),
	"edit_task_occurrence":  edits(),
	"split_task_series":     edits(),
	"add_checklist_item":    adds(),
	"update_checklist_item": edits(),
	"toggle_checklist_item": edits(),
	"delete_checklist_item": deletes("deletes a checklist item"),
	"set_today_focus":       edits(),
	"start_focus":           edits(),
	"pause_focus":           edits(),
	"stop_focus":            edits(),

	// Calendar and scheduling.
	"create_event":          adds(),
	"update_event":          edits(),
	"edit_event_occurrence": edits(),
	"split_event_series":    edits(),
	"schedule_task":         editsWhen(overwritesWhen("replaces the task's calendar blocks", "replace")),
	"move_block":            edits(),
	"pin_block":             edits(),
	"pin_task":              edits(),
	"delete_block":          deletes("deletes a calendar block"),
	"clear_task_blocks":     deletes("deletes a task's calendar blocks"),
	"auto_schedule_apply":   deletes("moves the calendar's planned blocks at once"),
	"undo_schedule":         deletes("puts back an earlier plan over the current blocks"),

	// Workspaces and projects.
	"create_workspace":    adds(),
	"rename_workspace":    edits(),
	"create_status":       adds(),
	"update_status":       edits(),
	"create_label":        adds(),
	"update_label":        edits(),
	"create_custom_field": adds(),
	"update_custom_field": edits(),
	"create_project":      adds(),
	"update_project":      edits(),
	"complete_project":    edits(),
	"reopen_project":      edits(),
	"create_stage":        adds(),
	"update_stage":        edits(),
	"reorder_stages":      edits(),

	// Docs.
	"create_doc":          adds(),
	"open_daily_note":     adds(),
	"append_to_doc":       adds(),
	"update_doc":          editsWhen(overwritesWhen("replaces a document's whole text", "markdown")),
	"restore_doc_version": deletes("replaces a document with an earlier version"),
	"add_3d_model":        writeRisk{creates: true, when: overwritesWhen("replaces a 3D model in a document", "replace")},
	"add_live_block":      writeRisk{creates: true, when: liveBlockReplace},

	// Sheets.
	"create_sheet":          adds(),
	"update_sheet":          editsWhen(overwritesWhen("replaces a sheet's rows, columns or tabs", "rows", "columns", "tabs", "merges")),
	"add_sheet_column":      adds(),
	"update_sheet_column":   edits(),
	"delete_sheet_column":   deletes("deletes a sheet column"),
	"add_sheet_rows":        adds(),
	"add_sheet_row":         adds(),
	"add_sheet_entries":     adds(),
	"update_sheet_cells":    {count: countList("cells")},
	"delete_sheet_rows":     deletes("deletes sheet rows"),
	"add_sheet_tab":         adds(),
	"rename_sheet_tab":      edits(),
	"update_sheet_tab":      editsWhen(overwritesWhen("replaces a tab's colour rules", "conditionalFormats")),
	"delete_sheet_tab":      deletes("deletes a sheet tab"),
	"create_sheet_template": adds(),
	"update_sheet_template": edits(),

	// Views.
	"create_task_view":     adds(),
	"update_task_view":     edits(),
	"set_active_task_view": edits(),

	// Notifications.
	"mark_notification_read": editsWhen(func(args map[string]any) (int, string) {
		if allNotifications(args) {
			return CriticalDeleting, "marks every notification read"
		}
		return 0, ""
	}),
	"triage_notification": edits(),
	"snooze_reminder":     edits(),

	// Focus: habits and goals.
	"add_habit":    adds(),
	"check_habit":  edits(),
	"update_habit": editsWhen(removeAction("deletes a habit and its history")),
	"set_goal":     editsWhen(removeAction("deletes a goal")),

	// Bots read pages on a schedule and alert the person: a setting.
	"create_bot": always(CriticalSettings, "creates a bot"),
	"update_bot": always(CriticalSettings, "changes a bot"),
}

// removeAction is critical item 1 for action=remove.
func removeAction(reason string) func(map[string]any) (int, string) {
	return func(args map[string]any) (int, string) {
		action, _ := args["action"].(string)
		if strings.EqualFold(strings.TrimSpace(action), "remove") {
			return CriticalDeleting, reason
		}
		return 0, ""
	}
}

// liveBlockReplace is critical when add_live_block rewrites an existing
// block (block = its number) rather than adding one.
func liveBlockReplace(args map[string]any) (int, string) {
	if n, _ := args["block"].(float64); n > 0 {
		return CriticalDeleting, "replaces a live block in a document"
	}
	return 0, ""
}

// Host actions (phase 5). The worker's gate will ask Go about terminal,
// file, web and browser calls; the classification is here now so that items
// 2 to 5 have tests before any host tool exists.

// Host action kinds.
const (
	HostTerminal   = "terminal"    // Command
	HostFileRead   = "file_read"   // Path
	HostFileWrite  = "file_write"  // Path: write or patch
	HostFileDelete = "file_delete" // Path
	HostDelete     = "delete"      // a connected service's tool that deletes, removes or destroys something (MCP)
	HostFetch      = "fetch"       // URL: web fetch or browser navigation
	HostInput      = "input"       // URL: typing into a page
	HostSubmit     = "submit"      // URL: a form submit or a submitting click
	HostUpload     = "upload"      // URL and Path
	HostSend       = "send"        // email, post or message; URL when known
	HostPay        = "pay"         // a tool that spends money
	HostSignIn     = "sign_in"     // a tool that signs in somewhere
	HostInstall    = "install"     // a skill's dependency install; Command when known
	HostConfig     = "config"      // Timely settings, agent config, MCP servers, the mode; Path when a file
)

// HostAction is one host tool call as the gate sees it.
type HostAction struct {
	Kind    string
	Command string
	Path    string
	URL     string
	// Cwd is the folder the call runs in (the terminal's workdir, else the
	// session's recorded folder): relative paths and a command's relative
	// operands are judged from there, not from the agent's folder.
	Cwd string
	// Also are further actions of the same call (a V4A patch names several
	// files): the call is as critical as its worst one.
	Also []HostAction
	// Code is set when Command is a program (execute_code), not a command
	// line.
	Code bool
}

// HostScope is what the person has already let in.
type HostScope struct {
	// Workspace is the agent's own folder; deleting or overwriting inside
	// it is not critical.
	Workspace string
	// Hosts were seen in the person's messages, search results or a bot's
	// own watches. A request elsewhere could carry their data out.
	Hosts []string
	// Tainted is set when the conversation has read outside pages.
	Tainted bool
	// Cwd is the folder a relative path is taken from (the call's own
	// folder); empty means Workspace. CwdUnknown is set after a command line
	// moved somewhere it cannot follow (cd $X, popd, cd -): a relative path
	// then is never inside the agent's folder.
	Cwd        string
	CwdUnknown bool
	// Home is the OS user's home, which `cd`, `~` and $HOME mean.
	Home string
	// vars are the variables a command line set earlier on the same line
	// (H=~; rm -rf $H), for the hardline floor.
	vars map[string]string
}

// CriticalHost is Critical for a host action.
func CriticalHost(h HostAction, scope HostScope) (item int, reason string, ok bool) {
	if h.Cwd != "" {
		scope.Cwd = h.Cwd
	}
	item, reason = hostItem(h, scope)
	for _, more := range h.Also {
		if i, r := hostItem(more, scope); i != 0 && (item == 0 || i < item) {
			item, reason = i, r
		}
	}
	if item != 0 {
		return item, reason, true
	}
	if scope.Tainted && h.Kind != HostFileRead && h.Kind != HostFetch {
		return CriticalTainted, "comes after reading outside content (pages, files or command output)", true
	}
	return 0, "", false
}

func hostItem(h HostAction, scope HostScope) (int, string) {
	switch h.Kind {
	case HostTerminal:
		return commandItem(h.Command, scope)
	case HostFileRead:
		if secretFiles.MatchString(strings.TrimSpace(h.Path)) {
			return CriticalSettings, "reads a file that holds passwords or sign-ins"
		}
		return 0, ""
	case HostFileWrite:
		if scope.config(h.Path) || scope.repoSettings(h.Path) {
			return CriticalSettings, "changes a settings file"
		}
		if !scope.inside(h.Path) {
			return CriticalDeleting, "overwrites a file outside the agent's folder"
		}
		return 0, ""
	case HostFileDelete:
		if !scope.insideLink(h.Path) {
			return CriticalDeleting, "deletes a file outside the agent's folder"
		}
		return 0, ""
	case HostDelete:
		return CriticalDeleting, "deletes something on a connected service"
	case HostFetch:
		if !scope.known(h.URL) {
			return CriticalSendingOut, "opens a site the person has not mentioned"
		}
		return 0, ""
	case HostInput:
		if paymentURL(h.URL) {
			return CriticalPaying, "types into a payment or sign-in page"
		}
		return 0, ""
	case HostSubmit:
		if paymentURL(h.URL) {
			return CriticalPaying, "submits a payment or sign-in form"
		}
		return CriticalSendingOut, "submits a form"
	case HostUpload:
		return CriticalSendingOut, "uploads a file"
	case HostSend:
		return CriticalSendingOut, "sends a message or post"
	case HostPay:
		return CriticalPaying, "spends money"
	case HostSignIn:
		return CriticalPaying, "signs in"
	case HostInstall:
		return CriticalInstalling, "installs software"
	case HostConfig:
		return CriticalSettings, "changes settings"
	}
	// An unknown kind is never run unasked.
	return CriticalDeleting, "is not a known action"
}

// base is the folder a relative path is taken from, false when it is not
// known.
func (s HostScope) base() (string, bool) {
	if s.CwdUnknown || s.Workspace == "" {
		return "", false
	}
	ws := path.Clean(s.Workspace)
	if s.Cwd == "" {
		return ws, true
	}
	if path.IsAbs(s.Cwd) {
		return path.Clean(s.Cwd), true
	}
	return path.Join(ws, s.Cwd), true
}

// inside reports whether p is within the agent's own folder. A relative path
// is taken from the folder the call runs in (Cwd, else the agent's folder,
// where the terminal starts), and from nowhere after a cd it cannot follow.
// A working folder that is the disk's root, the home or a folder above the
// home is no safe folder at all.
func (s HostScope) inside(p string) bool { return s.insideAt(p, true) }

// insideLink is inside for a link itself: deleting or moving a symlink takes
// the link, not its target, so only the folder it sits in is followed.
func (s HostScope) insideLink(p string) bool { return s.insideAt(p, false) }

func (s HostScope) insideAt(p string, follow bool) bool {
	p = strings.TrimSpace(p)
	if s.Workspace == "" || p == "" {
		return false
	}
	ws := path.Clean(s.Workspace)
	if ws == "/" || (s.Home != "" && (ws == path.Clean(s.Home) || strings.HasPrefix(path.Clean(s.Home)+"/", ws+"/"))) {
		return false
	}
	if strings.HasPrefix(p, "~") || strings.HasPrefix(p, "$") {
		return false
	}
	if !path.IsAbs(p) {
		base, ok := s.base()
		if !ok {
			return false
		}
		p = joinRaw(base, p)
	}
	// A .. after a link is taken from the link's target, as the kernel does.
	p = kernelPath(p)
	if !(p == ws || strings.HasPrefix(p, strings.TrimSuffix(ws, "/")+"/")) {
		return false
	}
	// A link in the folder that leads out of it is not inside: a write to it
	// lands on its target.
	if follow {
		return s.realInside(resolveLinks(p))
	}
	return s.realInside(path.Join(resolveLinks(path.Dir(p)), path.Base(p)))
}

// cdScope is the scope after a cd, pushd, popd or chdir part of a command
// line; ok is false for any other part.
func cdScope(part string, scope HostScope) (HostScope, bool) {
	words := fields(strings.TrimLeft(strings.TrimSpace(part), "({ "))
	if len(words) == 0 {
		return scope, false
	}
	switch words[0] {
	case "cd", "pushd", "popd", "chdir":
	default:
		return scope, false
	}
	unknown := func() (HostScope, bool) {
		scope.Cwd, scope.CwdUnknown = "", true
		return scope, true
	}
	if words[0] == "popd" {
		return unknown()
	}
	target := "~"
	if ops := operands(words[1:]); len(ops) > 0 {
		target = ops[0]
	}
	switch {
	case target == "-" || strings.ContainsAny(target, "`*?[") || strings.Contains(target, "$("):
		return unknown()
	case target == "~" || strings.HasPrefix(target, "~/"):
		if scope.Home == "" {
			return unknown()
		}
		target = path.Join(scope.Home, target[1:])
	case strings.HasPrefix(target, "$HOME") || strings.HasPrefix(target, "${HOME}"):
		if scope.Home == "" {
			return unknown()
		}
		target = path.Join(scope.Home, strings.TrimPrefix(strings.TrimPrefix(target, "${HOME}"), "$HOME"))
	case strings.HasPrefix(target, "$") || strings.HasPrefix(target, "~"):
		return unknown()
	}
	if !path.IsAbs(target) {
		base, ok := scope.base()
		if !ok {
			return unknown()
		}
		target = path.Join(base, target)
	}
	scope.Cwd, scope.CwdUnknown = path.Clean(target), false
	return scope, true
}

// known reports whether a URL's host was seen before, or is this machine.
func (s HostScope) known(raw string) bool {
	host := hostOf(raw)
	if host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	for _, seen := range s.Hosts {
		if h := hostOf(seen); h != "" && h == host {
			return true
		}
	}
	return false
}

// hostOf is the lower-case host of a URL or a bare host name, without a
// leading "www.".
func hostOf(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

var paymentWords = regexp.MustCompile(`(?i)(checkout|payment|/pay\b|paypal|stripe|billing|/cart\b|purchase|subscribe|donate|log-?in|sign-?in|signon|/sso\b|oauth|/auth\b|/session|password)`)

// paymentURL reports whether a page is for paying or signing in.
func paymentURL(raw string) bool {
	return raw != "" && paymentWords.MatchString(raw)
}

var configPaths = regexp.MustCompile(`(?i)(^|/)(\.bashrc|\.zshrc|\.profile|\.bash_profile|\.zprofile|\.config/fish|\.ssh/|\.gnupg/|\.hermes/|\.gitconfig|\.npmrc|\.pypirc|crontab)|^/etc/|(^|/)(config\.ya?ml|mcp\.json|\.env)$`)

// configPath reports whether a file holds settings or credentials.
func configPath(p string) bool {
	return configPaths.MatchString(strings.TrimSpace(p))
}

// Terminal commands. A command line is split into simple commands at
// ; && || | and new lines, and each is judged on its program and arguments,
// after sudo, env assignments and wrappers like nohup.

var (
	commandSplit = regexp.MustCompile(`\|\||&&|[;\n|&]`)
	pipeToShell  = regexp.MustCompile(`(?i)\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(ba|z)?sh\s+-c\s+["']?\$\((curl|wget)\b`)
	// sqlDestroy reads SQL that deletes data or structure: DROP of anything
	// that holds data or rules, TRUNCATE of a named table (a bare name must
	// end the statement or its quote, so prose such as "truncate long
	// titles" is not one), DELETE FROM, ALTER TABLE ... DROP, and the
	// stores' wipe commands.
	sqlDestroy = regexp.MustCompile(`(?i)\b(drop\s+(table|database|schema|index|view|function|procedure|owned|role|user|group|collection|materialized|sequence|type|extension|trigger|domain|tablespace|policy|publication|subscription)|alter\s+table\b[^;]*?\bdrop|delete\s+from)\b|\btruncate\s+table\s+["\w]|\btruncate\s+(?:only\s+)?["\w.]+\s*(?:[;"')]|$|cascade\b|restart\b|continue\b)|\b(flushall|flushdb)\b|\.drop(?:Database)?\(|\bdeleteMany\(`)
	urlPattern = regexp.MustCompile(`(?i)\bhttps?://[^\s'"<>|;)]+`)
	redirectTo = regexp.MustCompile(`(?:^|[^>&0-9])>\|?\s*([^\s>&|;]+)`)
	appendTo   = regexp.MustCompile(`>>\s*([^\s>&|;]+)`)
	// substitution matches the innermost $( ), <( ), >( ) and backtick groups.
	substitution = regexp.MustCompile("[$<>]\\(([^()]*)\\)|`([^`]*)`")
	// pipeToInterpreter is a shell or interpreter reading its program from a pipe.
	pipeToInterpreter = regexp.MustCompile(`\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\S*/)?(?:a|ba|z|da|k|c|tc|mk)?sh(?:\s+-[A-Za-z]+)*\s*(?:$|[;&|)\n])|\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\S*/)?(?:python[0-9.]*|node|nodejs|perl|ruby|php|lua|pwsh|powershell)(?:\s+-[A-Za-z]*)?\s*(?:$|[;&|)\n])`)
)

func commandItem(line string, scope HostScope) (int, string) {
	line = strings.TrimSpace(line)
	if line == "" {
		return 0, ""
	}
	// Whole-line patterns first: they span a pipe.
	if pipeToShell.MatchString(line) {
		return CriticalInstalling, "runs a script downloaded from the internet"
	}
	best, why := 0, ""
	consider := func(item int, reason string) {
		if item != 0 && (best == 0 || item < best) {
			best, why = item, reason
		}
	}
	if sqlDestroy.MatchString(line) {
		consider(CriticalDeleting, "deletes database data")
	}
	// Each simple command is judged from the folder it runs in: a cd, pushd or
	// popd earlier on the line moves it (and one it cannot follow makes every
	// relative path count as outside the agent's folder).
	for _, part := range commandSplit.Split(line, -1) {
		if next, ok := cdScope(part, scope); ok {
			scope = next
			continue
		}
		for _, m := range redirectTo.FindAllStringSubmatch(part, -1) {
			target := strings.Trim(m[1], `"'`)
			if target == "/dev/null" || target == "/dev/stdout" || target == "/dev/stderr" {
				continue
			}
			if scope.config(target) || scope.repoSettings(target) {
				consider(CriticalSettings, "changes a settings file")
			} else if !scope.inside(target) {
				consider(CriticalDeleting, "overwrites a file outside the agent's folder")
			}
		}
		for _, m := range appendTo.FindAllStringSubmatch(part, -1) {
			if t := strings.Trim(m[1], `"'`); scope.config(t) || scope.repoSettings(t) {
				consider(CriticalSettings, "changes a settings file")
			}
		}
		consider(simpleCommandItem(part, scope))
	}
	// A command run inside $( ), backticks or <( ) is judged on its own, and
	// a shell or interpreter at the end of a pipe runs whatever it is fed.
	for _, m := range substitution.FindAllStringSubmatch(line, -1) {
		consider(commandItem(m[1]+m[2], scope))
	}
	if pipeToInterpreter.MatchString(line) {
		consider(CriticalDeleting, "runs commands it was handed")
	}
	// Any request to a host the person has not mentioned could carry data
	// out in its address, whichever program makes it.
	if best == 0 || best > CriticalSendingOut {
		for _, u := range urlPattern.FindAllString(line, -1) {
			if !scope.known(u) {
				consider(CriticalSendingOut, "contacts a site the person has not mentioned")
				break
			}
		}
	}
	return best, why
}

// fields splits a simple command into words, dropping quotes.
func fields(part string) []string {
	words := strings.Fields(part)
	for i, w := range words {
		words[i] = strings.Trim(w, `"'`)
	}
	return words
}

// wrapper programs run the command that follows their own options. valued
// are the options that take the next word as their value; operands are the
// plain words that come before the command (a duration, a lock file).
type wrapper struct {
	valued   []string
	operands int
}

var wrappers = map[string]wrapper{
	"env":      {valued: []string{"-u", "-C", "-S", "--unset", "--chdir"}},
	"nohup":    {},
	"time":     {valued: []string{"-f", "-o"}},
	"command":  {},
	"builtin":  {},
	"exec":     {valued: []string{"-a"}},
	"nice":     {valued: []string{"-n", "--adjustment"}},
	"ionice":   {valued: []string{"-c", "-n", "-p", "--class", "--classdata"}},
	"stdbuf":   {},
	"setsid":   {},
	"timeout":  {valued: []string{"-s", "-k", "--signal", "--kill-after"}, operands: 1},
	"watch":    {valued: []string{"-n", "-d", "--interval"}},
	"flock":    {valued: []string{"-w", "-E", "--timeout"}, operands: 1},
	"taskset":  {operands: 1},
	"xargs":    {valued: []string{"-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a", "-J"}},
	"busybox":  {},
	"unbuffer": {},
	"chronic":  {},
}

// unwrap drops a wrapper's own options and operands, leaving the command it runs.
func unwrap(w wrapper, args []string) []string {
	for len(args) > 0 && strings.HasPrefix(args[0], "-") && args[0] != "--" {
		valued := slices.Contains(w.valued, args[0])
		args = args[1:]
		if valued && len(args) > 0 {
			args = args[1:]
		}
	}
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	for i := 0; i < w.operands && len(args) > 0; i++ {
		args = args[1:]
	}
	return args
}

// shellPrograms run a command line they are given with -c.
var shellPrograms = set("sh", "bash", "zsh", "dash", "ksh", "fish", "ash", "csh", "tcsh", "mksh", "cmd", "cmd.exe")

// interpreters run code given inline (-c, -e, a heredoc, stdin). inline
// lists the options that carry it; cluster is the letter that may sit in a
// cluster of short options (python -Sc, perl -ne).
var interpreters = map[string]struct {
	inline  []string
	cluster string
}{
	"python": {[]string{"-c"}, "c"}, "python2": {[]string{"-c"}, "c"}, "python3": {[]string{"-c"}, "c"},
	"pypy": {[]string{"-c"}, "c"}, "pypy3": {[]string{"-c"}, "c"},
	"node": {[]string{"-e", "--eval", "-p", "--print"}, ""}, "nodejs": {[]string{"-e", "--eval", "-p", "--print"}, ""},
	"bun": {[]string{"-e", "--eval", "-p", "--print"}, ""}, "deno": {[]string{"eval"}, ""},
	"perl": {[]string{"-e", "-E"}, "eE"}, "ruby": {[]string{"-e"}, "e"}, "php": {[]string{"-r"}, ""},
	"lua": {[]string{"-e"}, ""}, "osascript": {[]string{"-e"}, ""}, "rscript": {[]string{"-e"}, ""},
	"julia":      {[]string{"-e", "-E", "--eval"}, ""},
	"pwsh":       {[]string{"-c", "-command", "-encodedcommand", "-e", "-ec"}, ""},
	"powershell": {[]string{"-c", "-command", "-encodedcommand", "-e", "-ec"}, ""},
}

// stdinFrom is a redirect that feeds a program from a file (python < x.py).
var stdinFrom = regexp.MustCompile(`(?:^|\s)\d?<\s*[^\s<(]`)

// pythonVersion matches python3.12 and friends.
var pythonVersion = regexp.MustCompile(`^(python|pypy)[0-9.]+$`)

// shellPayload is the command line a shell is given with -c (or cmd's /c),
// "" when it has none.
func shellPayload(args []string) (string, bool) {
	for i, a := range args {
		if a == "--" {
			return "", false
		}
		lower := strings.ToLower(a)
		isFlag := (strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") && len(a) > 1 && strings.Contains(a, "c") && strings.Trim(a[1:], "abcdefghijklmnopqrstuvwxyz") == "") || lower == "/c" || lower == "/k"
		if isFlag {
			return strings.Join(args[i+1:], " "), true
		}
		if !strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "/") {
			return "", false // a script file: its code is not on the line
		}
	}
	return "", false
}

// inlineCode reports whether an interpreter is handed its program on the
// command line, a heredoc or stdin: code nobody can read on a card.
func inlineCode(prog string, args []string, part string) bool {
	info, ok := interpreters[prog]
	if !ok && pythonVersion.MatchString(prog) {
		info, ok = interpreters["python"], true
	}
	if !ok {
		return false
	}
	if strings.Contains(part, "<<") || stdinFrom.MatchString(part) {
		return true
	}
	for _, a := range args {
		if a == "--" {
			return false
		}
		if a == "-" {
			return true
		}
		if prog == "deno" {
			return a == "eval"
		}
		if !strings.HasPrefix(a, "-") {
			return false // the script it runs
		}
		if slices.Contains(info.inline, strings.ToLower(a)) || slices.Contains(info.inline, a) {
			return true
		}
		if strings.HasPrefix(a, "--") {
			continue
		}
		if info.cluster != "" && strings.ContainsAny(a[1:], info.cluster) && strings.Trim(a[1:], "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") == "" {
			return true
		}
		for _, f := range info.inline { // -cprint(1): the code attached to the option
			if len(f) == 2 && strings.HasPrefix(a, f) && len(a) > 2 {
				return true
			}
		}
	}
	return false
}

// unwrapCommand drops what comes before the program of a simple command:
// sudo, doas and su, FOO=bar assignments and wrapper programs (nohup,
// timeout, xargs, ...). elevated says a privilege wrapper was there.
func unwrapCommand(words []string) (rest []string, elevated bool) {
	for len(words) > 0 {
		w := strings.TrimLeft(words[0], `\`)
		switch {
		case w == "sudo" || w == "doas" || w == "su":
			elevated = true
			words = words[1:]
			for len(words) > 0 && strings.HasPrefix(words[0], "-") {
				words = words[1:]
			}
			continue
		case strings.Contains(w, "=") && !strings.HasPrefix(w, "-") && !strings.HasPrefix(w, "="):
			words = words[1:] // FOO=bar before the program
			continue
		}
		if path.Base(w) == "env" {
			if split, ok := envSplit(words[1:]); ok {
				words = split // env -S 'bash tidy.sh': the string is the command
				continue
			}
		}
		if wr, ok := wrappers[path.Base(w)]; ok {
			words = unwrap(wr, words[1:])
			continue
		}
		break
	}
	return words, elevated
}

// envSplit is the command env -S / --split-string runs: its string, split into
// words, then whatever words follow it.
func envSplit(args []string) ([]string, bool) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-S" || a == "--split-string":
			if i+1 < len(args) {
				return append(fields(args[i+1]), args[i+2:]...), true
			}
			return nil, false
		case strings.HasPrefix(a, "--split-string="):
			return append(fields(strings.TrimPrefix(a, "--split-string=")), args[i+1:]...), true
		case strings.HasPrefix(a, "-S") && len(a) > 2:
			return append(fields(a[2:]), args[i+1:]...), true
		case !strings.HasPrefix(a, "-") && !strings.Contains(a, "="):
			return nil, false // the command: no -S before it
		case oneOf(a, "-u", "-C", "--unset", "--chdir") || oneOf(a, "-a"):
			i++
		}
	}
	return nil, false
}

func simpleCommandItem(part string, scope HostScope) (int, string) {
	words, elevated := unwrapCommand(fields(part))
	if len(words) == 0 {
		if elevated {
			return CriticalSettings, "runs as administrator"
		}
		return 0, ""
	}
	prog := strings.ToLower(path.Base(strings.TrimLeft(words[0], `\`)))
	args := words[1:]
	var item int
	var reason string
	switch {
	case prog == "eval":
		item, reason = commandItem(strings.Join(args, " "), scope)
	case shellPrograms[prog]:
		if payload, ok := shellPayload(args); ok {
			item, reason = commandItem(payload, scope)
		} else if scriptOperand(args) {
			item, reason = CriticalDeleting, scriptReason
		} else if !hasFlag(args, "", "--version", "--help") {
			// A shell with no program on the line reads its commands from
			// stdin (a pipe, a file, xargs -a): code nobody can read here.
			item, reason = CriticalDeleting, "runs commands it was handed"
		}
	case inlineCode(prog, args, part):
		item, reason = CriticalDeleting, "runs code written on the spot"
	case scriptRun(prog, words[0], args):
		item, reason = CriticalDeleting, scriptReason
	default:
		item, reason = programItem(prog, args, scope)
	}
	if item == 0 && elevated {
		return CriticalSettings, "runs as administrator"
	}
	return item, reason
}

// scriptReason is why running a script file asks in Auto: the agent may have
// written it a moment ago (write_file, a redirect, a patch), and nothing on a
// card shows what it does.
const scriptReason = "runs a script file whose code is not on the card"

// scriptOperand reports whether a shell or interpreter is given a script file
// to run (its first plain operand), not a flag-only call.
func scriptOperand(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			return i+1 < len(args)
		}
		if a == "-m" {
			// A module runs code from the folder (python -m tidy); only a few
			// standard ones do not.
			return i+1 < len(args) && !benignModules[strings.ToLower(args[i+1])]
		}
		if a == "-W" || a == "-X" || a == "-O" || a == "--rcfile" || a == "--init-file" || a == "-o" {
			i++ // -W ignore: the next word is the flag's value
			continue
		}
		if strings.HasPrefix(a, "-") {
			continue
		}
		return true
	}
	return false
}

var scriptExt = regexp.MustCompile(`(?i)\.(sh|bash|zsh|ksh|py|rb|pl|js|mjs|cjs|ps1|bat|cmd|command|lua|php)$`)

// scriptRun reports whether a simple command runs a script file: an
// interpreter given one, source or ".", a program path that is a script
// (./tidy.sh, ../x, /home/me/work/tidy.py).
func scriptRun(prog, word string, args []string) bool {
	if _, ok := interpreters[prog]; ok || pythonVersion.MatchString(prog) {
		return scriptOperand(args)
	}
	if prog == "source" || prog == "." {
		return len(operands(args)) > 0
	}
	word = strings.TrimLeft(word, `\`)
	return strings.HasPrefix(word, "./") || strings.HasPrefix(word, "../") || (strings.Contains(word, "/") && scriptExt.MatchString(word))
}

// hasFlag reports whether args hold a short flag letter (as in -rf) or one
// of the long names.
func hasFlag(args []string, letters string, long ...string) bool {
	for _, a := range args {
		if a == "--" {
			return false
		}
		if strings.HasPrefix(a, "--") {
			name := strings.SplitN(a, "=", 2)[0]
			for _, l := range long {
				if name == l {
					return true
				}
			}
			continue
		}
		if strings.HasPrefix(a, "-") && len(a) > 1 && strings.ContainsAny(a[1:], letters) {
			return true
		}
	}
	return false
}

// operands are the non-flag arguments.
func operands(args []string) []string {
	out := []string{}
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			out = append(out, a)
		}
	}
	return out
}

func sub(args []string, n int) string {
	ops := operands(args)
	if n < len(ops) {
		return strings.ToLower(ops[n])
	}
	return ""
}

func oneOf(s string, options ...string) bool {
	for _, o := range options {
		if s == o {
			return true
		}
	}
	return false
}

// programItem is the worse of the two readings of a program (the second is in
// permission_more.go).
func programItem(prog string, args []string, scope HostScope) (int, string) {
	item, why := programItem0(prog, args, scope)
	if i2, w2 := timelyDataItem(prog, args); i2 != 0 && (item == 0 || i2 < item) {
		item, why = i2, w2
	}
	if i2, w2 := moreProgramItem(prog, args, scope); i2 != 0 && (item == 0 || i2 < item) {
		return i2, w2
	}
	return item, why
}

func programItem0(prog string, args []string, scope HostScope) (int, string) {
	switch prog {
	// 1. Deleting or overwriting.
	case "rm", "unlink":
		if prog == "rm" && hasFlag(args, "rR", "--recursive") {
			return CriticalDeleting, "deletes folders"
		}
		for _, p := range operands(args) {
			if !scope.insideLink(p) {
				return CriticalDeleting, "deletes a file outside the agent's folder"
			}
		}
	case "sed", "gsed":
		// sed -i rewrites its files in place: judged like a redirect.
		if hasFlag(args, "i", "--in-place") || inPlaceSuffix(args) {
			files := operands(args)
			if !hasFlag(args, "ef", "--expression", "--file") && len(files) > 0 {
				files = files[1:] // the first plain word is the script
			}
			for _, f := range files {
				if scope.config(f) || scope.repoSettings(f) {
					return CriticalSettings, "changes a settings file"
				}
				if !scope.inside(f) {
					return CriticalDeleting, "overwrites a file outside the agent's folder"
				}
			}
		}
	case "rmdir", "shred", "wipefs", "dd", "truncate", "srm":
		return CriticalDeleting, "deletes or overwrites data"
	case "find":
		for i, a := range args {
			if a == "-delete" || (oneOf(a, "-exec", "-execdir", "-ok", "-okdir") && i+1 < len(args) && path.Base(args[i+1]) == "rm") {
				return CriticalDeleting, "deletes the files it finds"
			}
			// -exec, -execdir, -ok and -okdir run a command on each file.
			if oneOf(a, "-exec", "-execdir", "-ok", "-okdir") && i+1 < len(args) {
				if item, reason := simpleCommandItem(strings.Join(args[i+1:], " "), scope); item != 0 {
					return item, reason
				}
			}
		}
	case "mv", "cp", "rsync", "install", "ln", "tee":
		ops := operands(args)
		if prog == "rsync" {
			for _, op := range ops {
				if remoteSpec(op) {
					return CriticalSendingOut, "copies files to another machine"
				}
			}
			if hasFlag(args, "", "--delete", "--delete-after", "--delete-before", "--remove-source-files") {
				return CriticalDeleting, "deletes files while copying"
			}
		}
		if prog == "tee" {
			for _, op := range ops {
				if scope.config(op) || scope.repoSettings(op) {
					return CriticalSettings, "changes a settings file"
				}
				if !scope.inside(op) {
					return CriticalDeleting, "overwrites a file outside the agent's folder"
				}
			}
			return 0, ""
		}
		if prog == "ln" && len(ops) > 0 {
			// A link inside the folder that points outside it lets a later
			// write through the folder reach the target.
			targets := ops
			if len(ops) >= 2 {
				targets = ops[:len(ops)-1]
			}
			for _, op := range targets {
				if scope.config(op) {
					return CriticalSettings, "links to a settings file"
				}
				if !scope.inside(op) {
					return CriticalDeleting, "links to a file outside the agent's folder"
				}
			}
		}
		if len(ops) >= 2 {
			dest := ops[len(ops)-1]
			if scope.config(dest) || scope.repoSettings(dest) {
				return CriticalSettings, "changes a settings file"
			}
			if !scope.inside(dest) {
				return CriticalDeleting, "overwrites files outside the agent's folder"
			}
		}
		if prog == "mv" {
			for _, op := range ops {
				if !scope.insideLink(op) {
					return CriticalDeleting, "moves files outside the agent's folder"
				}
			}
		}
	case "git":
		// Global options come before the subcommand: -C <dir> and -c k=v take a
		// value (`git -C . push --force` is a force-push, `git -c
		// alias.x=!cmd x` runs cmd).
		args, gitCode := gitSubcommandArgs(args)
		if gitCode {
			return CriticalSettings, "changes git settings for one command"
		}
		switch sub(args, 0) {
		case "push":
			if hasFlag(args, "f", "--force", "--force-with-lease", "--mirror", "--delete") {
				return CriticalDeleting, "force-pushes over published history"
			}
			return CriticalSendingOut, "publishes code"
		case "reset":
			if hasFlag(args, "", "--hard") {
				return CriticalDeleting, "discards uncommitted work"
			}
		case "clean":
			if hasFlag(args, "f", "--force") {
				return CriticalDeleting, "deletes untracked files"
			}
		case "branch":
			if hasFlag(args, "D", "--delete") {
				return CriticalDeleting, "deletes a branch"
			}
		case "checkout", "restore":
			for _, a := range operands(args) {
				if a == "." {
					return CriticalDeleting, "discards uncommitted work"
				}
			}
		case "config":
			if hasFlag(args, "", "--global", "--system") {
				return CriticalSettings, "changes git settings"
			}
		case "remote":
			return CriticalSettings, "changes where code is published"
		}
	case "mkfs", "fdisk", "parted", "format":
		return CriticalDeleting, "erases a disk"

	// 2. Sending data out.
	case "curl", "wget", "http", "https", "xh", "httpie":
		if hasFlag(args, "dFT", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--form", "--upload-file", "--json", "--post-data", "--post-file", "--body-data", "--body-file") {
			return CriticalSendingOut, "sends data to a website"
		}
		for i, a := range args {
			if (a == "-X" || a == "--request" || a == "--method") && i+1 < len(args) && !oneOf(strings.ToUpper(args[i+1]), "GET", "HEAD", "OPTIONS") {
				return CriticalSendingOut, "sends data to a website"
			}
			if strings.HasPrefix(a, "-X") && len(a) > 2 && !oneOf(strings.ToUpper(a[2:]), "GET", "HEAD", "OPTIONS") {
				return CriticalSendingOut, "sends data to a website"
			}
		}
		if prog == "http" || prog == "https" || prog == "xh" || prog == "httpie" {
			if m := strings.ToUpper(sub(args, 0)); oneOf(m, "POST", "PUT", "PATCH", "DELETE") {
				return CriticalSendingOut, "sends data to a website"
			}
		}
		for _, op := range requestTargets(prog, args) {
			if looksLikeHost(op) && !scope.known(op) {
				return CriticalSendingOut, "contacts a site the person has not mentioned"
			}
		}
	case "scp", "sftp", "ftp", "lftp", "nc", "ncat", "netcat", "socat", "telnet", "ssh", "mosh":
		return CriticalSendingOut, "connects to another machine"
	case "sendmail", "mail", "mailx", "mutt", "msmtp", "swaks":
		return CriticalSendingOut, "sends email"
	case "gh", "glab":
		if oneOf(sub(args, 0), "auth") {
			return CriticalPaying, "signs in"
		}
		// gh api turns into a POST with any -f/-F/--field/--input and obeys
		// -X/--method.
		if sub(args, 0) == "api" && (hasFlag(args, "fF", "--field", "--raw-field", "--input") || hasFlag(args, "X", "--method")) {
			return CriticalSendingOut, "posts to a code host"
		}
		if oneOf(sub(args, 1), "create", "comment", "edit", "merge", "close", "delete", "upload", "review") || hasFlag(args, "", "--method") {
			return CriticalSendingOut, "posts to a code host"
		}

	// 3. Signing in.
	case "docker", "podman", "npm", "pnpm", "yarn", "heroku", "vercel", "netlify", "firebase", "az", "gcloud", "aws", "doctl", "flyctl", "fly", "wrangler", "huggingface-cli", "op", "bw":
		if oneOf(sub(args, 0), "login", "signin", "adduser") || (sub(args, 0) == "auth" && oneOf(sub(args, 1), "login", "")) || (prog == "aws" && sub(args, 0) == "configure") || (prog == "aws" && sub(args, 1) == "login") {
			return CriticalPaying, "signs in"
		}
		if oneOf(prog, "npm", "pnpm", "yarn") && oneOf(sub(args, 0), "install", "i", "add", "ci", "update", "upgrade", "dlx", "exec", "x") {
			return CriticalInstalling, "installs packages"
		}
		if oneOf(prog, "npm", "pnpm", "yarn") && sub(args, 0) == "publish" {
			return CriticalSendingOut, "publishes a package"
		}
		if oneOf(prog, "docker", "podman") && oneOf(sub(args, 0), "pull", "run", "build") {
			return CriticalInstalling, "downloads and runs software"
		}
		if oneOf(prog, "docker", "podman") && sub(args, 0) == "push" {
			return CriticalSendingOut, "publishes an image"
		}

	// 4. Installing software.
	case "pip", "pip3", "pipx", "conda", "mamba", "micromamba", "gem", "apt", "apt-get", "dnf", "yum", "zypper", "brew", "snap", "flatpak", "choco", "winget", "scoop", "port", "nix-env", "cargo", "go", "bun", "poetry", "pdm", "rye", "composer", "cpan", "cpanm", "luarocks", "opam", "stack", "cabal", "dotnet", "nuget", "hermes":
		if installSubcommand(prog, args) {
			return CriticalInstalling, "installs software"
		}
	case "python", "python3":
		if len(args) >= 3 && args[0] == "-m" && oneOf(args[1], "pip", "ensurepip") && oneOf(args[2], "install", "download") {
			return CriticalInstalling, "installs software"
		}
	case "uv":
		if oneOf(sub(args, 0), "add", "sync") || (oneOf(sub(args, 0), "pip", "tool") && oneOf(sub(args, 1), "install", "sync", "run")) {
			return CriticalInstalling, "installs software"
		}
	case "npx", "bunx", "uvx", "pnpx":
		return CriticalInstalling, "downloads and runs a package"
	case "pacman", "yay", "paru", "makepkg":
		if prog == "makepkg" || hasFlag(args, "SU", "--sync", "--upgrade") {
			return CriticalInstalling, "installs software"
		}
		if hasFlag(args, "R", "--remove") {
			return CriticalDeleting, "removes software"
		}
	case "make":
		if oneOf(sub(args, 0), "install") {
			return CriticalInstalling, "installs software"
		}

	// 5. Changing settings or permissions.
	case "chmod", "chown", "chgrp", "setfacl", "chattr", "umask":
		return CriticalSettings, "changes file permissions"
	case "crontab", "systemctl", "launchctl", "service", "update-rc.d", "visudo", "usermod", "useradd", "userdel", "groupadd", "passwd", "chsh", "sysctl", "iptables", "nft", "ufw", "defaults", "reg", "setx", "gsettings", "dconf":
		return CriticalSettings, "changes system settings"
	}
	return 0, ""
}

// gitSubcommandArgs drops git's global options (-C <dir>, -c <k=v>,
// --git-dir, --work-tree, --namespace, --exec-path, flags) so the first
// operand is the subcommand; code is true when -c or an alias was used.
func gitSubcommandArgs(args []string) (rest []string, code bool) {
	i := 0
	for i < len(args) {
		a := args[i]
		switch {
		case a == "-C" || a == "--git-dir" || a == "--work-tree" || a == "--namespace" || a == "--super-prefix" || a == "--config-env":
			i += 2
		case a == "-c":
			code = true
			i += 2
		case strings.HasPrefix(a, "-c") && len(a) > 2 && strings.Contains(a, "="):
			code = true
			i++
		case strings.HasPrefix(a, "--config-env"):
			code = true
			i++
		case strings.HasPrefix(a, "-"):
			i++
		default:
			return args[i:], code
		}
	}
	return nil, code
}

// inPlaceSuffix reports a sed -i.bak style flag.
func inPlaceSuffix(args []string) bool {
	for _, a := range args {
		if a == "--" {
			return false
		}
		if strings.HasPrefix(a, "-i") || strings.HasPrefix(a, "--in-place=") {
			return true
		}
	}
	return false
}

// installSubcommand reports whether a package manager call installs or
// upgrades something.
func installSubcommand(prog string, args []string) bool {
	first := sub(args, 0)
	switch prog {
	case "go":
		return oneOf(first, "install", "get")
	case "cargo":
		return oneOf(first, "install", "add", "binstall")
	case "bun", "poetry", "pdm", "rye", "composer":
		return oneOf(first, "install", "i", "add", "require", "update", "upgrade", "sync", "x")
	case "brew", "snap", "flatpak", "choco", "winget", "scoop", "port", "gem", "conda", "mamba", "micromamba", "pip", "pip3", "pipx", "cpanm", "luarocks", "opam", "stack", "cabal", "nuget":
		return oneOf(first, "install", "reinstall", "upgrade", "update", "add", "inject", "download", "tap") || prog == "cpanm"
	case "apt", "apt-get", "dnf", "yum", "zypper":
		return oneOf(first, "install", "reinstall", "upgrade", "dist-upgrade", "full-upgrade", "in", "localinstall")
	case "nix-env":
		return hasFlag(args, "i", "--install")
	case "cpan":
		return true
	case "dotnet":
		return (first == "tool" && sub(args, 1) == "install") || (first == "add" && sub(args, 2) == "package")
	case "hermes":
		// A skill's dependencies or a plugin.
		return oneOf(first, "install") || (oneOf(first, "skills", "plugins", "plugin", "skill") && oneOf(sub(args, 1), "install", "add"))
	}
	return false
}

// remoteSpec reports whether an rsync or scp operand names another machine
// (host:path or user@host:path, not a Windows drive letter).
func remoteSpec(op string) bool {
	i := strings.Index(op, ":")
	return i > 1 && !strings.HasPrefix(op, "/") && !strings.Contains(op[:i], "/")
}

// valueFlags are the curl and wget options that take the next word as their
// value, so that word is not mistaken for an address.
var valueFlags = map[string]map[string]bool{
	"curl": set("-o", "--output", "-H", "--header", "-A", "--user-agent", "-e", "--referer", "-u", "--user", "-b", "--cookie", "-c", "--cookie-jar", "-w", "--write-out", "-K", "--config", "-x", "--proxy", "-m", "--max-time", "--connect-timeout", "-r", "--range", "-E", "--cert", "--key", "--cacert", "--resolve"),
	"wget": set("-O", "--output-document", "-o", "--output-file", "-P", "--directory-prefix", "-U", "--user-agent", "--header", "-e", "--execute", "-a", "--append-output"),
}

func set(items ...string) map[string]bool {
	out := map[string]bool{}
	for _, i := range items {
		out[i] = true
	}
	return out
}

// requestTargets are the operands of a request program that name what it
// fetches.
func requestTargets(prog string, args []string) []string {
	takes := valueFlags[prog]
	out := []string{}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") {
			if takes[a] {
				i++
			}
			continue
		}
		out = append(out, a)
	}
	return out
}

var (
	hostShape = regexp.MustCompile(`^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(:\d+)?$`)
	fileShape = regexp.MustCompile(`(?i)\.(json|txt|csv|html?|xml|tar|gz|tgz|zip|sh|py|js|ts|md|log|ya?ml|toml|png|jpe?g|pdf)$`)
)

// looksLikeHost reports whether an operand is a URL or a host name rather
// than a file.
func looksLikeHost(op string) bool {
	if strings.Contains(op, "://") {
		return true
	}
	host := strings.SplitN(op, "/", 2)[0]
	return hostShape.MatchString(host) && !fileShape.MatchString(host)
}

// Timely's own data. The agent runs as the same OS user as the API, and
// Timely keeps its settings, permissions and every chat's mode in Postgres:
// one UPDATE from a database client would turn Full Access on for the chat
// with no card, and the database password sits in the repo's .env and the
// desktop's config.json. So a database client is never run unasked (item 5,
// never grantable, as every item up to 5 is), and neither is a read of a
// file that holds those secrets.

// databaseClients are programs that talk to a database. Their grants would
// be keyed on the program name, so one harmless SELECT could cover an UPDATE:
// each call asks.
var databaseClients = set("psql", "pgcli", "pg_dump", "pg_dumpall", "pg_restore", "createdb", "dropdb", "createuser", "dropuser",
	"createlang", "droplang", "reindexdb", "vacuumdb", "clusterdb", "pg_ctl", "pg_basebackup", "sqlite3", "litecli", "mysql", "mycli",
	"mysqldump", "mysqladmin", "mysqlsh", "mariadb", "mongo", "mongosh", "mongodump", "mongorestore", "usql", "cockroach", "duckdb")

// secretFiles are files that hold passwords, keys or sign-ins: the repo's
// .env files (not .env.example), the desktop app's config.json and browser
// profile stores, Postgres' password file and a process's environment.
var secretFiles = regexp.MustCompile(`(?i)(^|[/=])\.env(\.(local|prod\w*|dev\w*|secret\w*))?$|/Timely[^/]*/(config\.json|Cookies|Local State|Login Data|Network/Cookies)$|(^|[/=])\.pgpass$|/proc/(self|\d+|[^/]*)/environ$`)

// timelyDataItem judges a program on what it reaches: Timely's database or a
// secret file, by name and by its operands.
func timelyDataItem(prog string, args []string) (int, string) {
	switch prog {
	case "dropdb", "dropuser":
		return CriticalDeleting, "deletes a database or a database user"
	case "pg_restore":
		if hasFlag(args, "c", "--clean") {
			return CriticalDeleting, "deletes database data"
		}
	case "mysqladmin":
		for _, a := range args {
			if a == "drop" {
				return CriticalDeleting, "deletes database data"
			}
		}
	}
	if databaseClients[prog] {
		return CriticalSettings, "talks to a database directly (Timely keeps its settings and permissions in one)"
	}
	for _, a := range args {
		if secretFiles.MatchString(strings.Trim(a, `"'`)) {
			return CriticalSettings, "reads a file that holds passwords or sign-ins"
		}
	}
	return 0, ""
}
