package agenthost

import (
	"context"
	"reflect"
	"testing"
)

func envOf(value string) func(string) string {
	return func(name string) string {
		if name == HostAccountsEnv {
			return value
		}
		return ""
	}
}

// Owner answer Q-5.2: every id listed is host-allowed, not only the first.
func TestHostAccountsHonoursEveryListedID(t *testing.T) {
	none := HostAccounts(envOf(""))
	if none("acct-1") || none("") {
		t.Error("unset variable allowed an account")
	}
	one := HostAccounts(envOf(" acct-1 ,"))
	if !one("acct-1") || one("acct-2") || one("") {
		t.Error("one listed account")
	}
	several := HostAccounts(envOf("acct-1,acct-2, acct-1 ,acct-3"))
	for _, id := range []string{"acct-1", "acct-2", "acct-3"} {
		if !several(id) {
			t.Errorf("%s was not honoured", id)
		}
	}
	if several("acct-4") || several("") || several("acct-") {
		t.Error("an unlisted account was honoured")
	}
	if got := HostAccountIDs(envOf("a, b,,a ,c")); !reflect.DeepEqual(got, []string{"a", "b", "c"}) {
		t.Errorf("ids = %v", got)
	}
	if toolKeyName(HostAccountsEnv) {
		t.Errorf("%s could reach a worker as a tool key", HostAccountsEnv)
	}
}

type fakeHostStore struct {
	allowed map[string]string
	asked   int
}

func (f *fakeHostStore) IsHostAllowed(_ context.Context, uid string) bool {
	f.asked++
	_, ok := f.allowed[uid]
	return ok
}

func (f *fakeHostStore) WorkingDir(_ context.Context, uid string) string { return f.allowed[uid] }

func TestHostAllowedUnitesTheStoreAndTheEnvironment(t *testing.T) {
	ctx := context.Background()
	store := &fakeHostStore{allowed: map[string]string{"desktop-1": "/work/a", "desktop-2": ""}}
	allowed := HostAllowed(envOf("server-1,server-2"), store)
	for _, id := range []string{"desktop-1", "desktop-2", "server-1", "server-2"} {
		if !allowed(ctx, id) {
			t.Errorf("%s should be host-allowed", id)
		}
	}
	for _, id := range []string{"", "other", "desktop-3"} {
		if allowed(ctx, id) {
			t.Errorf("%q should not be host-allowed", id)
		}
	}
	if store.asked == 0 {
		t.Error("the store was never read")
	}
	// Without a store only the environment counts.
	envOnly := HostAllowed(envOf("server-1"), nil)
	if !envOnly(ctx, "server-1") || envOnly(ctx, "desktop-1") {
		t.Error("env-only list")
	}
}

func TestHostWorkingDirIsOnlyForHostAllowedAccounts(t *testing.T) {
	ctx := context.Background()
	store := &fakeHostStore{allowed: map[string]string{"a": "/work/a", "b": ""}}
	allowed := HostAllowed(envOf(""), store)
	dir := HostWorkingDir(allowed, store)
	if got := dir(ctx, "a"); got != "/work/a" {
		t.Errorf("a = %q", got)
	}
	if got := dir(ctx, "b"); got != "" {
		t.Errorf("b = %q", got)
	}
	if got := dir(ctx, "stranger"); got != "" {
		t.Errorf("stranger = %q", got)
	}
	if got := HostWorkingDir(allowed, nil)(ctx, "a"); got != "" {
		t.Errorf("nil store = %q", got)
	}
}
