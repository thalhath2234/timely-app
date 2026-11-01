package utils

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A provider error clipped at byte 300 used to end on the first byte of "é",
// which Postgres refuses to store.
func TestClipUTF8KeepsWholeCharacters(t *testing.T) {
	text := strings.Repeat("x", 299) + "étail"
	got := ClipUTF8(text, 300)
	if !utf8.ValidString(got) {
		t.Fatalf("clipped text is not valid UTF-8: %q", got[290:])
	}
	if got != strings.Repeat("x", 299)+"…" {
		t.Fatalf("got %q", got[290:])
	}
	if ClipUTF8("short", 300) != "short" {
		t.Fatal("short text changed")
	}
	if ClipUTF8(text, 0) != text {
		t.Fatal("n <= 0 should leave the text alone")
	}
}

func TestStorableTextDropsWhatPostgresRejects(t *testing.T) {
	broken := "bad \xc3 byte, nul \x00 here, " + strings.Repeat("é", 400)
	got := StorableText(broken, 300)
	if !utf8.ValidString(got) {
		t.Fatal("result is not valid UTF-8")
	}
	if strings.ContainsRune(got, 0) {
		t.Fatal("result still holds a NUL")
	}
	if len(got) > 300+len("…") {
		t.Fatalf("result is %d bytes", len(got))
	}
	if !strings.HasPrefix(got, "bad  byte, nul  here, é") {
		t.Fatalf("got %q", got[:40])
	}
}

// GB31: a provider's 401 quoted the refused key, and the failed jobs list
// showed it.
func TestRedactSecretsHidesKeys(t *testing.T) {
	for in, want := range map[string]string{
		"Bad key sk-or-standin-livegbe-0001 <img src=x>":      "Bad key sk-… <img src=x>",
		"invalid x-api-key sk-ant-api03-AbC_dEf-123456789":    "invalid x-api-key sk-…",
		"Authorization: Bearer abcDEF123456.xyz== rejected":   "Authorization: Bearer … rejected",
		"openrouter embed: HTTP 503 Service Unavailable":      "openrouter embed: HTTP 503 Service Unavailable",
		"task-list and desk-chair are words, not keys; sk-ab": "task-list and desk-chair are words, not keys; sk-ab",
	} {
		if got := RedactSecrets(in); got != want {
			t.Errorf("RedactSecrets(%q) = %q, want %q", in, got, want)
		}
	}
}
