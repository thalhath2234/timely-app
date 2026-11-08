package notify

import (
	"os"
	"regexp"
	"testing"
)

// TestContractHiddenPushWords checks that the words the clients show for a
// push with "Hide alert text in push" on (HIDDEN_PUSH_TITLE and
// HIDDEN_PUSH_BODY in the shared contract) are the ones the API sends.
func TestContractHiddenPushWords(t *testing.T) {
	src, err := os.ReadFile("../../../../../packages/contract/src/notifications.ts")
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	word := func(name string) string {
		t.Helper()
		m := regexp.MustCompile(`export const ` + name + ` = "([^"]*)";`).FindSubmatch(src)
		if m == nil {
			t.Fatalf("%s not found in notifications.ts", name)
		}
		return string(m[1])
	}
	for _, c := range []struct{ name, got, want string }{
		{"HIDDEN_PUSH_TITLE", word("HIDDEN_PUSH_TITLE"), HiddenPushTitle},
		{"HIDDEN_PUSH_BODY", word("HIDDEN_PUSH_BODY"), HiddenPushBody},
	} {
		if c.got != c.want {
			t.Errorf("%s in notifications.ts is %q, API has %q", c.name, c.got, c.want)
		}
	}
}
