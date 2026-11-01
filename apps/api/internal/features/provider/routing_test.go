package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
)

func TestListedModelMatchesDatedNames(t *testing.T) {
	list := []ModelOption{{ID: "claude-haiku-4-5"}, {ID: "claude-haiku-5-5-20261001"}, {ID: "claude-opus-5-5"}}
	for _, tc := range []struct{ id, want string }{
		{"claude-opus-5-5", "claude-opus-5-5"},
		{"claude-haiku-5-5", "claude-haiku-5-5-20261001"},
		// A family default takes the family's newest listed model.
		{"claude-haiku-*", "claude-haiku-5-5-20261001"},
		// A shorter id is a different model, not a dated name for it.
		{"claude-haiku", ""},
		{"claude-opus-5", ""},
		{"claude-sonnet-5-5", ""},
		{"", ""},
	} {
		if got, _ := listedModel(list, tc.id); got != tc.want {
			t.Errorf("listedModel(%q) = %q, want %q", tc.id, got, tc.want)
		}
	}
	for _, tc := range []struct {
		list     []string
		id, want string
	}{
		// A saved dated id finds the plain alias in a list that names it that way.
		{[]string{"claude-haiku-5-5"}, "claude-haiku-5-5-20261001", "claude-haiku-5-5"},
		{[]string{"claude-haiku-5-20260301", "claude-haiku-5-5"}, "claude-haiku-5", "claude-haiku-5-20260301"},
		{[]string{"gpt-5.4-mini-2026-03-01"}, "gpt-5.4-mini", "gpt-5.4-mini-2026-03-01"},
		{[]string{"mistral-medium-latest"}, "mistral-medium", "mistral-medium-latest"},
		// A bigger sibling is never taken for a saved or preferred model.
		{[]string{"gpt-5.4", "gpt-5-mini"}, "gpt-5.4-mini", ""},
		{[]string{"claude-opus-5-5"}, "claude-opus-5", ""},
	} {
		options := []ModelOption{}
		for _, id := range tc.list {
			options = append(options, ModelOption{ID: id})
		}
		if got, _ := listedModel(options, tc.id); got != tc.want {
			t.Errorf("listedModel(%v, %q) = %q, want %q", tc.list, tc.id, got, tc.want)
		}
	}
}

func TestPickModelPrefersHaikuAndKeepsTheSavedModel(t *testing.T) {
	anthropic := apiProviderByID("anthropic")
	list := []ModelOption{{ID: "claude-fable-5-1"}, {ID: "claude-haiku-5-5"}, {ID: "claude-opus-5-5"}, {ID: "claude-sonnet-5-5"}}
	if got := pickModel(anthropic, "", list); got != "claude-haiku-5-5" {
		t.Errorf("a new Anthropic key must start on Haiku, got %q", got)
	}
	if got := pickModel(anthropic, "claude-sonnet-5-5", list); got != "claude-sonnet-5-5" {
		t.Errorf("a listed saved model is kept, got %q", got)
	}
	// Replacing the key when the list names the saved model with a date keeps it.
	dated := []ModelOption{{ID: "claude-haiku-5-5-20261001"}, {ID: "claude-opus-5-5"}}
	if got := pickModel(anthropic, "claude-haiku-5-5", dated); got != "claude-haiku-5-5-20261001" {
		t.Errorf("re-key must not swap Haiku for Opus, got %q", got)
	}
	// A saved model gone from the list falls back to Haiku, never Opus.
	if got := pickModel(anthropic, "claude-retired-1", dated); got != "claude-haiku-5-5-20261001" {
		t.Errorf("fallback must be Haiku, got %q", got)
	}
	// Another Haiku when the preferred one is not listed.
	if got := pickModel(anthropic, "", []ModelOption{{ID: "claude-haiku-4-5"}, {ID: "claude-opus-5-5"}}); got != "claude-haiku-4-5" {
		t.Errorf("any listed Haiku before other models, got %q", got)
	}
	// With no Haiku at all, Sonnet rather than the first (most capable) model.
	if got := pickModel(anthropic, "", []ModelOption{{ID: "claude-fable-5-1"}, {ID: "claude-opus-5-5"}, {ID: "claude-sonnet-5-5"}}); got != "claude-sonnet-5-5" {
		t.Errorf("no Haiku listed: got %q", got)
	}
	if got := pickModel(anthropic, "claude-haiku-5-5", nil); got != "claude-haiku-5-5" {
		t.Errorf("an empty list keeps the saved model, got %q", got)
	}
	if got := pickModel(anthropic, "", nil); got != "claude-haiku-5-5" {
		t.Errorf("an empty list starts on Haiku, got %q", got)
	}
	// Other providers keep their small default over a bigger sibling.
	if got := pickModel(apiProviderByID("openai"), "", []ModelOption{{ID: "gpt-5.4"}, {ID: "gpt-5-mini"}}); got != "gpt-5-mini" {
		t.Errorf("OpenAI default: got %q", got)
	}
	if defaultClaudeModel != "haiku" {
		t.Errorf("Claude Code must default to Haiku, got %q", defaultClaudeModel)
	}
}

func TestCheckOpenRouterKeySpendsNoTokens(t *testing.T) {
	var method, path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		switch r.Header.Get("Authorization") {
		case "Bearer sk-or-good":
			_, _ = w.Write([]byte(`{"data":{"label":"sk-or-…","usage":0,"limit_remaining":null}}`))
		case "Bearer sk-or-capped":
			_, _ = w.Write([]byte(`{"data":{"label":"sk-or-…","usage":5,"limit":5,"limit_remaining":0}}`))
		case "Bearer sk-or-busy":
			w.WriteHeader(503)
		default:
			w.WriteHeader(401)
		}
	}))
	defer server.Close()
	s := &Service{models: newCatalogue(), openRouterKeyURL: server.URL + "/api/v1/key"}
	if err := s.checkOpenRouterKey(context.Background(), "sk-or-good"); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet || path != "/api/v1/key" {
		t.Fatalf("the check must be a GET of the key endpoint, got %s %s", method, path)
	}
	if err := s.checkOpenRouterKey(context.Background(), "sk-or-bad"); err == nil || !strings.Contains(err.Error(), "rejected") {
		t.Fatalf("bad key: %v", err)
	}
	if err := s.checkOpenRouterKey(context.Background(), "sk-or-busy"); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("outage: %v", err)
	}
	if err := s.checkOpenRouterKey(context.Background(), "sk-or-capped"); err == nil || !strings.Contains(err.Error(), "credit limit") {
		t.Fatalf("a key with its limit spent must be refused: %v", err)
	}
}

func TestDescribeCompleterUsesTheRunsModel(t *testing.T) {
	// Inside an Agent chat run the run's own client describes the block; the
	// account's provider settings are not read (db is nil here).
	run := &fakeCompleter{reply: "OK"}
	s := &Service{}
	completer, provider, err := s.describeCompleter(chat.WithCompleter(context.Background(), run), "user-a", "doc")
	if err != nil || completer != chat.Completer(run) || provider != "" {
		t.Fatalf("got %T %q %v", completer, provider, err)
	}
}
