package provider

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A provider message longer than 300 bytes used to be cut at byte 300, which
// can split a character; the run that saved it then failed to save at all.
func TestErrorTextClipsOnACharacterBoundary(t *testing.T) {
	raw := []byte(`{"error":{"type":"invalid_request_error","message":"` + strings.Repeat("x", 299) + `étail"}}`)
	got := errorText(raw)
	if !utf8.ValidString(got) {
		t.Fatalf("clipped message is not valid UTF-8: %q", got[290:])
	}
	if got != strings.Repeat("x", 299)+"…" {
		t.Fatalf("got %q", got[290:])
	}
}
