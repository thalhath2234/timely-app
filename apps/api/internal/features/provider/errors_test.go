package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"timely-api/internal/features/chat"
)

// A failed provider call is worded for the person: no HTML page, no echoed
// key, a settings action where Try again cannot help, and no "could not
// reach" for a host that answered.
func TestProviderErrorsAreWordedForThePerson(t *testing.T) {
	cases := []struct {
		name, status, body string
		code               int
		want, action       string
		hidden             []string
	}{
		{name: "html 502", code: 502, body: "<html><body>502 Bad Gateway</body></html>", want: "Anthropic is unavailable right now (HTTP 502)", action: chat.ActionRetry, hidden: []string{"<html", "Bad Gateway"}},
		{name: "overloaded", code: 529, body: `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, want: "Anthropic is unavailable right now (HTTP 529)", action: chat.ActionRetry},
		{name: "key echoed", code: 401, body: `{"type":"error","error":{"type":"authentication_error","message":"bad key sk-ant-standin-livegc-0001"}}`, want: "Anthropic didn't accept the API key (HTTP 401). Check the key in Settings → Agent", action: chat.ActionSettings, hidden: []string{"sk-ant", "bad key"}},
		{name: "no credit", code: 402, body: `{"error":{"message":"Insufficient credits"}}`, want: "out of credit (HTTP 402)", action: chat.ActionSettings},
		{name: "rate limit", code: 429, body: `{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`, want: "rate limiting this key (HTTP 429)", action: chat.ActionRetry},
		{name: "bad request quotes json only", code: 400, body: `{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long; key sk-ant-abcdef123456 was used"}}`, want: "Anthropic refused the request (HTTP 400): prompt is too long", action: chat.ActionRetry, hidden: []string{"sk-ant-abcdef"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			// Retries off keeps the 5xx cases to one request each.
			ctx := chat.WithoutRetries(context.Background())
			_, err := (&Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}).Complete(ctx, []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
			for _, h := range tc.hidden {
				if strings.Contains(err.Error(), h) {
					t.Fatalf("error %q shows %q", err, h)
				}
			}
			var failure *chat.Failure
			action := chat.ActionRetry
			if errors.As(err, &failure) {
				action = failure.Action
			}
			if action != tc.action {
				t.Fatalf("action = %q, want %q", action, tc.action)
			}
		})
	}
}

func TestCutOffAnswerIsNotCalledUnreachable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Hel`))
	}))
	defer server.Close()
	_, err := (&Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}).Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err == nil || strings.Contains(err.Error(), "Could not reach") || !strings.Contains(err.Error(), "answer was cut off") {
		t.Fatalf("%v", err)
	}
}

// The receipt recheck is sent once: a failed optional call is not retried
// with the photos again.
func TestCallsWithoutRetriesAreSentOnce(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(529)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`))
	}))
	defer server.Close()
	p := &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
	if _, err := p.Complete(chat.WithoutRetries(context.Background()), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false); err == nil {
		t.Fatal("529 accepted")
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("%d requests without retries, want 1", n)
	}
}
