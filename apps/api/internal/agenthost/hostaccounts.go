package agenthost

import (
	"context"
	"strings"
)

// HostAccountsEnv names the server fallback for host-allowed accounts (plan
// 11.2 and 12; owner answer Q-5.2): comma-separated account ids. Every id
// listed is honoured, each one separately, and the ids are united with the
// accounts turned on in the desktop window (instance_settings, Settings ->
// Server). An approved command runs as the host OS user and can read every
// account's data, so the list is a decision about this computer, not about
// the chat features: web, skills, memory, clarify and remote MCP stay open to
// every account.
const HostAccountsEnv = "TIMELY_AGENT_HOST_ACCOUNTS"

// HostAccountIDs parses TIMELY_AGENT_HOST_ACCOUNTS: trimmed, de-duplicated
// account ids in the order listed; blank entries are dropped.
func HostAccountIDs(getenv func(string) string) []string {
	var ids []string
	seen := map[string]bool{}
	for _, part := range strings.Split(getenv(HostAccountsEnv), ",") {
		id := strings.TrimSpace(part)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

// HostAccounts reads TIMELY_AGENT_HOST_ACCOUNTS once and returns whether an
// account is host-allowed: every listed id is, nobody is when it is unset or
// the id is empty.
func HostAccounts(getenv func(string) string) func(uid string) bool {
	allowed := map[string]bool{}
	for _, id := range HostAccountIDs(getenv) {
		allowed[id] = true
	}
	return func(uid string) bool { return uid != "" && allowed[uid] }
}

// HostStore is the stored side of the host-allowed list: instance.Store
// reads instance_settings, which the desktop window writes. It already
// unites the stored ids with the environment's, and fails closed on a
// database error.
type HostStore interface {
	IsHostAllowed(ctx context.Context, uid string) bool
	WorkingDir(ctx context.Context, uid string) string
}

// HostAllowed answers "may this account use this computer" from the store
// (when given one) united with TIMELY_AGENT_HOST_ACCOUNTS. A nil store reads
// only the environment. An empty uid is never allowed.
func HostAllowed(getenv func(string) string, store HostStore) func(ctx context.Context, uid string) bool {
	env := HostAccounts(getenv)
	return func(ctx context.Context, uid string) bool {
		if uid == "" {
			return false
		}
		if env(uid) {
			return true
		}
		return store != nil && store.IsHostAllowed(ctx, uid)
	}
}

// HostWorkingDir is the working folder the account chose in the desktop
// window, or "" (the account's own workspace folder). A nil store, or an
// account that is not host-allowed, has none.
func HostWorkingDir(allowed func(ctx context.Context, uid string) bool, store HostStore) func(ctx context.Context, uid string) string {
	return func(ctx context.Context, uid string) string {
		if store == nil || uid == "" || (allowed != nil && !allowed(ctx, uid)) {
			return ""
		}
		return store.WorkingDir(ctx, uid)
	}
}
