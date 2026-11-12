package chat

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The Go copy of Hermes' secret prefixes is the vendored list, entry for
// entry: a Hermes sync that changes agent/redact.py fails here until
// secretPrefixes is copied again.
func TestSecretPrefixesMatchHermes(t *testing.T) {
	src, err := os.ReadFile("../../../../agent/hermes/agent/redact.py")
	if err != nil {
		t.Fatal(err)
	}
	text := string(src)
	start := strings.Index(text, "\n_PREFIX_PATTERNS = [")
	end := strings.Index(text[start:], "\n]\n")
	if start < 0 || end < 0 {
		t.Fatal("agent/redact.py no longer has _PREFIX_PATTERNS")
	}
	var hermes []string
	for _, m := range regexp.MustCompile(`(?m)^\s*r"((?:[^"\\]|\\.)*)"`).FindAllStringSubmatch(text[start:start+end], -1) {
		hermes = append(hermes, m[1])
	}
	if len(hermes) == 0 || !slices.Equal(hermes, secretPrefixes) {
		t.Fatalf("secretPrefixes differ from Hermes' _PREFIX_PATTERNS (%d entries): copy them again", len(hermes))
	}
}

// carriesSecret gives Hermes' verdict (_PREFIX_RE on the URL and on it
// unquoted) on each of these, read from the vendored Hermes when the test
// was written.
func TestCarriesSecretAsHermesDoes(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://shop.example.com/ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA":        true,
		"https://shop.example.com/sk-ant-api03-AAAAAAAAAAAAAAAAAAAA":           true,
		"https://shop.example.com/x?k=AKIAABCDEFGHIJKLMNOP":                    true,
		"https://shop.example.com/ghp%5FXk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA%zz":   true,
		"https://shop.example.com/a/%67hp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA":    true,
		"https://shop.example.com/sk-abcdefghij.html":                          true,
		"https://shop.example.com/scikit-learn":                                false,
		"https://shop.example.com/sk-prod":                                     false,
		"https://shop.example.com/backup-ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA": false,
		"https://shop.example.com/ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA-more":   false,
		"https://shop.example.com/p/item-123?color=red":                        false,
		"https://shop.example.com/log/dana-whitfield-48-elm-street-555-0142":   false,
	} {
		if got := carriesSecret(raw); got != want {
			t.Errorf("carriesSecret(%q) = %v, Hermes says %v", raw, got, want)
		}
	}
}

// preview_bot, and a proposed bot's preview, fetch at once: an address on a
// site the person typed is still refused when it carries a key or token,
// as Hermes refuses it in web_extract. A bot's own address is the person's.
func TestFetchGuardRefusesAKeyInTheAddress(t *testing.T) {
	g := &fetchGuard{typed: "please watch shop.example.com for me", known: map[string]bool{
		"https://shop.example.com/feed?token=ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA": true,
	}}
	for _, raw := range []string{
		"https://shop.example.com/ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA",
		"https://shop.example.com/sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
		"https://shop.example.com/a/%67hp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA",
	} {
		if g.allowsURL(raw) {
			t.Errorf("%s was allowed", raw)
		}
	}
	if !g.allows([]byte(`[{"url":"https://shop.example.com/p/milk"}]`)) {
		t.Error("a plain page on the typed site was refused")
	}
	if g.allows([]byte(`[{"url":"https://shop.example.com/p/milk"},{"url":"https://shop.example.com/sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"}]`)) {
		t.Error("a watch list with a key in one address was allowed")
	}
	if !g.allowsURL("https://shop.example.com/feed?token=ghp_Xk9mQ2vR7tL4wZ8nB3cF6hJ1pD5sG0yA") {
		t.Error("a bot's own address was refused")
	}
}
