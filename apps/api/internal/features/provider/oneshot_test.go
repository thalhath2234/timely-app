package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
)

// W14: a one-shot call that is told to wait 30 s before retrying fails at
// once with the provider's busy message; a short wait is still retried, and
// chat runs keep the SDK's usual retry.
func TestOneShotDoesNotSitOutALongRetryAfter(t *testing.T) {
	var calls atomic.Int32
	wait := "30"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("content-type", "application/json")
		w.Header().Set("retry-after", wait)
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}`))
	}))
	defer srv.Close()
	p := &Anthropic{Key: "k", Model: "claude-haiku-5-5", Base: srv.URL}
	msgs := []chat.WireMessage{{Role: "user", Content: "hi"}}

	start := time.Now()
	_, err := p.Complete(oneShot(context.Background()), msgs, nil, false)
	if err == nil || !strings.Contains(err.Error(), "rate limiting this key (HTTP 429)") {
		t.Fatalf("err = %v", err)
	}
	if calls.Load() != 1 || time.Since(start) > 5*time.Second {
		t.Fatalf("%d calls in %s: a one-shot call must not wait 30 s and retry", calls.Load(), time.Since(start))
	}

	calls.Store(0)
	wait = "0.01"
	if _, err := p.Complete(oneShot(context.Background()), msgs, nil, false); err == nil || calls.Load() != 2 {
		t.Fatalf("a short wait is still retried once: %d calls, %v", calls.Load(), err)
	}
}

func TestRetryAfter(t *testing.T) {
	h := http.Header{}
	h.Set("retry-after-ms", "1500")
	if d, ok := retryAfter(h); !ok || d != 1500*time.Millisecond {
		t.Errorf("ms: %v %v", d, ok)
	}
	h = http.Header{}
	h.Set("retry-after", "30")
	if d, ok := retryAfter(h); !ok || d != 30*time.Second {
		t.Errorf("seconds: %v %v", d, ok)
	}
	if _, ok := retryAfter(http.Header{}); ok {
		t.Error("no header")
	}
}

// GW27: an account gets at most oneShotPerUser one-shot AI requests at once;
// others keep theirs, and a finished one frees its place.
func TestOneShotLimit(t *testing.T) {
	s := &Service{}
	release := make(chan struct{})
	started := make(chan struct{}, oneShotPerUser)
	handler := s.oneShotLimit(func(c *echo.Context) error {
		started <- struct{}{}
		<-release
		return c.NoContent(200)
	})
	e := echo.New()
	call := func(userID string) int {
		rec := httptest.NewRecorder()
		c := e.NewContext(httptest.NewRequest("POST", "/agent/write", nil), rec)
		c.Set("userID", userID)
		if err := handler(c); err != nil {
			if he, ok := err.(*echo.HTTPError); ok {
				return he.Code
			}
			return 500
		}
		return rec.Code
	}
	done := make(chan int, oneShotPerUser)
	for range oneShotPerUser {
		go func() { done <- call("u1") }()
	}
	for range oneShotPerUser {
		<-started
	}
	if code := call("u1"); code != 429 {
		t.Fatalf("one more request for u1: %d, want 429", code)
	}
	go func() { done <- call("u2") }()
	<-started // u2 is not held up by u1
	close(release)
	for range oneShotPerUser + 1 {
		if code := <-done; code != 200 {
			t.Errorf("code %d", code)
		}
	}
	if s.busy.n["u1"] != 0 || len(s.busy.n) != 0 {
		t.Errorf("places not given back: %v", s.busy.n)
	}
}
