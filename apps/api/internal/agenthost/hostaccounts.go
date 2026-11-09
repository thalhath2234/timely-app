package agenthost

import (
	"log"
	"strings"
)

// HostAccountsEnv names the server fallback for the host-allowed account
// (plan 11.2 and 12): comma-separated account ids. Settings -> Server (the
// instance_settings store, phase 5) replaces it.
const HostAccountsEnv = "TIMELY_AGENT_HOST_ACCOUNTS"

// HostAccounts reads TIMELY_AGENT_HOST_ACCOUNTS once and returns whether an
// account is host-allowed. An approved command runs as the host OS user and
// can read every other account's data, so at most one account is honoured on
// the local terminal backend (plan 12): the first id listed. Any other id is
// ignored, with a log line. Nobody is host-allowed when the variable is unset.
//
// In phase 2 a host-allowed account only loses the "stay within Timely;
// decline code and unrelated requests" instruction line (Q-2.1); host tools
// arrive in phase 5.
func HostAccounts(getenv func(string) string) func(uid string) bool {
	return hostAccounts(getenv, log.Printf)
}

func hostAccounts(getenv func(string) string, logf func(string, ...any)) func(uid string) bool {
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
	if len(ids) == 0 {
		return func(string) bool { return false }
	}
	allowed := ids[0]
	if len(ids) > 1 {
		logf("%s names %d accounts; only the first (%s) is host-allowed. Ignored: %s. "+
			"An approved command could read another account's data, so the local backend allows one account.",
			HostAccountsEnv, len(ids), allowed, strings.Join(ids[1:], ", "))
	}
	return func(uid string) bool { return uid != "" && uid == allowed }
}
