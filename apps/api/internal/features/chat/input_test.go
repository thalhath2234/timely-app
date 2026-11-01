package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
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

type knownIDs map[string]bool

func (knownIDs) Resolve(context.Context, string) (string, string, error) { return "", "", nil }
func (knownIDs) Completer(context.Context, string, string, string) (Completer, error) {
	return nil, nil
}
func (k knownIDs) KnownProvider(id string) bool { return k[id] }

// A provider id the server has no provider for is refused when it is
// picked, not when the run fails later; the id's case doesn't matter.
func TestUnknownProviderIsRefusedWhenPicked(t *testing.T) {
	s := &Service{completers: knownIDs{"anthropic": true, "openrouter": true}}
	if got, err := s.pickProvider("Anthropic"); err != nil || got != "anthropic" {
		t.Fatalf("a known id in another case must be accepted as its own id: %q %v", got, err)
	}
	if got, err := s.pickProvider(""); err != nil || got != "" {
		t.Fatalf("empty is the default: %q %v", got, err)
	}
	_, err := s.pickProvider("foo")
	var he *echo.HTTPError
	if !errors.As(err, &he) || he.Code != 400 || !strings.Contains(fmt.Sprint(he.Message), `"foo"`) {
		t.Fatalf("unknown provider must be a 400 naming it: %v", err)
	}
}

// Postgres can't store NUL, so a message or a reply with one used to fail
// with HTTP 500, or with a raw database error after a paid answer.
func TestNULIsDroppedFromMessagesAndReplies(t *testing.T) {
	in := sendInput{Content: "a\u0000b", Context: []ContextChip{{Kind: "object", Label: "T\u0000ask", Value: "tasks/\u0000a"}}}
	cleanInput(&in)
	if in.Content != "ab" || in.Context[0].Label != "Task" || in.Context[0].Value != "tasks/a" {
		t.Fatalf("NUL kept: %+v", in)
	}
	withCall := call("propose_changes", map[string]any{"summary": "Add \u0000milk", "steps": []any{map[string]any{"arguments": map[string]any{"name": "Milk\u0000"}}}})
	withCall.Content = "Hello\u0000world"
	s := New(nil, nil, &scripted{responses: []WireMessage{withCall}})
	reply, err := s.complete(context.Background(), nil, nil, false)
	if err != nil || reply.Content != "Helloworld" {
		t.Fatalf("NUL kept in the reply: %q %v", reply.Content, err)
	}
	if args := reply.ToolCalls[0].Function.Arguments; strings.Contains(args, `\u0000`) || !strings.Contains(args, `"Add milk"`) || !strings.Contains(args, `"Milk"`) {
		t.Fatalf("NUL kept in the arguments: %s", args)
	}
}
