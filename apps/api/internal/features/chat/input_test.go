package chat

import (
	"strings"
	"testing"
)

// The composer limit is 16,000 characters in every client, so the API must
// count characters too: Japanese text takes three bytes per character.
func TestMessageLimitCountsCharactersNotBytes(t *testing.T) {
	japanese := strings.Repeat("予定", 3000) // 6,000 characters, 18,000 bytes
	if err := validateInput(sendInput{Content: japanese}); err != nil {
		t.Fatalf("6,000 Japanese characters rejected: %v", err)
	}
	if err := validateInput(sendInput{Content: strings.Repeat("予", 16000)}); err != nil {
		t.Fatalf("16,000 characters rejected: %v", err)
	}
	if err := validateInput(sendInput{Content: strings.Repeat("a", 16001)}); err == nil {
		t.Fatal("16,001 characters accepted")
	}
}
