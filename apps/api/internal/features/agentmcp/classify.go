package agentmcp

import (
	"strings"
	"unicode"

	"timely-api/internal/features/agent"
)

// Annotations are the hints a server declares for a tool (MCP ToolAnnotations).
// nil means the server said nothing. A hint never lowers what the name says:
// a server is outside content, so "readOnlyHint: true" never makes a tool whose
// name sends, spends, changes settings or deletes read as a read, and
// "destructiveHint: true" raises a tool to a delete whatever its name.
type Annotations struct {
	ReadOnly    *bool `json:"readOnlyHint,omitempty"`
	Destructive *bool `json:"destructiveHint,omitempty"`
	Idempotent  *bool `json:"idempotentHint,omitempty"`
	OpenWorld   *bool `json:"openWorldHint,omitempty"`
}

// Classes of an MCP tool (plan decision 6). They map onto the host actions
// the permission modes already judge.
const (
	ClassSend   = "send"   // sends, posts or shares something other people see: critical in Auto
	ClassPay    = "pay"    // spends or moves money: critical in Auto
	ClassConfig = "config" // changes the server's settings, keys or permissions: critical in Auto
	ClassDelete = "delete" // deletes, removes or destroys something (name, or destructiveHint): critical in Auto, item 1
	ClassWrite  = "write"  // changes something on the server, nothing leaves the account: critical only after outside content
	ClassRead   = "read"   // reads
)

var (
	// Strong words decide a class wherever they stand in the name: "get_and_send" sends.
	sendVerbs = words("send", "reply", "forward", "post", "publish", "share", "invite", "upload", "broadcast", "notify", "announce", "tweet")
	payVerbs  = words("pay", "payment", "payments", "charge", "refund", "purchase", "buy", "checkout", "transfer", "withdraw", "deposit", "payout", "sell")
	// Weak words are also nouns ("list_comments", "get_order"): they count only when the name
	// does not open with a read verb.
	sendNouns = words("email", "mail", "message", "dm", "sms", "text", "comment", "call")
	payNouns  = words("order", "invoice", "trade", "subscribe")
	// Delete words, like send verbs, decide wherever they stand; the weak ones are also nouns
	// ("clear_cache" is fine to read about in "get_clear_rate") and count only off a read verb.
	deleteVerbs = words("delete", "remove", "destroy", "drop", "purge", "erase", "wipe", "revoke", "cancel", "archive", "trash", "truncate", "terminate", "unsubscribe")
	deleteWeak  = words("close", "clear", "reset", "kill", "unlink", "disable", "deactivate")
	configWords = words("config", "configure", "setting", "settings", "preference", "preferences", "permission", "permissions", "credential", "credentials", "token", "tokens", "secret", "secrets", "webhook", "webhooks", "integration", "integrations")
	readWords   = words("get", "list", "search", "read", "fetch", "find", "query", "describe", "view", "show", "lookup", "look", "count", "check", "browse", "inspect", "summarize", "retrieve", "export", "download", "explain", "analyze", "compare", "resolve", "ping", "docs", "whoami")
)

func words(list ...string) map[string]bool { return setOf(list...) }

// toolWords splits a tool name into lower-case words: snake_case, kebab-case,
// dotted and camelCase.
func toolWords(name string) []string {
	var out []string
	var cur []rune
	flush := func() {
		if len(cur) > 0 {
			out = append(out, strings.ToLower(string(cur)))
			cur = cur[:0]
		}
	}
	runes := []rune(name)
	for i, r := range runes {
		switch {
		case !unicode.IsLetter(r) && !unicode.IsDigit(r):
			flush()
		case unicode.IsUpper(r) && i > 0 && (unicode.IsLower(runes[i-1]) || (i+1 < len(runes) && unicode.IsLower(runes[i+1]) && unicode.IsUpper(runes[i-1]))):
			flush()
			cur = append(cur, r)
		default:
			cur = append(cur, r)
		}
	}
	flush()
	return out
}

// Class says what a tool does, from its name and the hints its server gave.
// Order matters: money, then sending, then settings, because a "send_payment"
// spends money and a "post_webhook_config" changes settings.
func Class(tool string, ann Annotations) string {
	ws := toolWords(tool)
	has := func(set map[string]bool) bool {
		for _, w := range ws {
			if set[w] {
				return true
			}
		}
		return false
	}
	readFirst := len(ws) > 0 && readWords[ws[0]]
	switch {
	case has(payVerbs) || (!readFirst && has(payNouns)):
		return ClassPay
	case has(sendVerbs) || (!readFirst && has(sendNouns)):
		return ClassSend
	case has(configWords) && !readFirst:
		return ClassConfig
	}
	readOnly := ann.ReadOnly != nil && *ann.ReadOnly
	destructive := ann.Destructive != nil && *ann.Destructive
	if destructive || has(deleteVerbs) || (!readFirst && has(deleteWeak)) {
		return ClassDelete
	}
	openWorld := ann.OpenWorld != nil && *ann.OpenWorld
	switch {
	case readOnly:
		return ClassRead
	case readFirst:
		return ClassRead // "search_web" reaches the open web but sends nothing out
	case openWorld:
		return ClassSend // a write that reaches outside the server's own data
	}
	return ClassWrite
}

// action is the host action a class stands for. Reads and writes carry a
// localhost-style address: a server the person connected is a place they
// named, so reading from it is not "a site the person has not mentioned".
// Writes use the input kind, which is critical only after the chat has read
// outside content (permission.go CriticalHost).
func action(class, server string) agent.HostAction {
	here := "http://localhost/mcp/" + server
	switch class {
	case ClassSend:
		return agent.HostAction{Kind: agent.HostSend, URL: here}
	case ClassPay:
		return agent.HostAction{Kind: agent.HostPay, URL: here}
	case ClassConfig:
		return agent.HostAction{Kind: agent.HostConfig}
	case ClassDelete:
		return agent.HostAction{Kind: agent.HostDelete}
	case ClassRead:
		return agent.HostAction{Kind: agent.HostFetch, URL: here}
	}
	return agent.HostAction{Kind: agent.HostInput, URL: here}
}
