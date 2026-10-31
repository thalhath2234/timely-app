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
		{"claude-haiku", "claude-haiku-5-5-20261001"},
		{"claude-sonnet-5-5", ""},
		{"", ""},
	} {
		if got, _ := listedModel(list, tc.id); got != tc.want {
			t.Errorf("listedModel(%q) = %q, want %q", tc.id, got, tc.want)
		}
	}
	// A saved dated id finds the plain alias in a list that names it that way.
	if got, _ := listedModel([]ModelOption{{ID: "claude-haiku-5-5"}}, "claude-haiku-5-5-20261001"); got != "claude-haiku-5-5" {
		t.Errorf("dated saved id: got %q", got)
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
	if got := pickModel(anthropic, "claude-haiku-5-5", nil); got != "claude-haiku-5-5" {
		t.Errorf("an empty list keeps the saved model, got %q", got)
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
			_, _ = w.Write([]byte(`{"data":{"label":"sk-or-…","usage":0}}`))
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
