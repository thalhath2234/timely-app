package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
)

func limitedRequest(t *testing.T, mw echo.MiddlewareFunc, ip, body string, bodyOut *string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(http.MethodPost, "/login", reader)
	req.RemoteAddr = ip + ":1234"
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	handler := mw(func(c *echo.Context) error {
		if bodyOut != nil {
			raw, _ := io.ReadAll(c.Request().Body)
			*bodyOut = string(raw)
		}
		return c.NoContent(http.StatusOK)
	})
	if err := handler(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	return rec
}

func TestRateLimitPerIP(t *testing.T) {
	limiter := NewRateLimiter(time.Minute, 3, 0)
	mw := limiter.Middleware(false)
	for i := 0; i < 3; i++ {
		if rec := limitedRequest(t, mw, "10.0.0.1", "", nil); rec.Code != http.StatusOK {
			t.Fatalf("request %d: %d", i, rec.Code)
		}
	}
	rec := limitedRequest(t, mw, "10.0.0.1", "", nil)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("fourth request: %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil || !strings.HasPrefix(payload["message"], "Too many attempts. Try again in ") {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if rec := limitedRequest(t, mw, "10.0.0.2", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("other IP must be independent: %d", rec.Code)
	}
}

func TestRateLimitPerAccountAcrossIPs(t *testing.T) {
	limiter := NewRateLimiter(time.Minute, 100, 2)
	mw := limiter.Middleware(true)
	body := `{"email":"  Ada@Example.com ","password":"x"}`
	if rec := limitedRequest(t, mw, "10.0.0.1", body, nil); rec.Code != http.StatusOK {
		t.Fatalf("first: %d", rec.Code)
	}
	if rec := limitedRequest(t, mw, "10.0.0.2", `{"email":"ada@example.com"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("second: %d", rec.Code)
	}
	if rec := limitedRequest(t, mw, "10.0.0.3", body, nil); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("third (same account, new IP) should be limited: %d", rec.Code)
	}
	if rec := limitedRequest(t, mw, "10.0.0.3", `{"email":"other@example.com"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("different account: %d", rec.Code)
	}
	if rec := limitedRequest(t, mw, "10.0.0.3", `not json`, nil); rec.Code != http.StatusOK {
		t.Fatalf("non-JSON body must only count per IP: %d", rec.Code)
	}
}

func TestRateLimitRestoresBody(t *testing.T) {
	limiter := NewRateLimiter(time.Minute, 10, 10)
	body := `{"email":"ada@example.com","password":"secret"}`
	var seen string
	limitedRequest(t, limiter.Middleware(true), "10.0.0.1", body, &seen)
	if seen != body {
		t.Fatalf("handler saw %q", seen)
	}
}

func TestRateLimitWindowSlidesAndPrunes(t *testing.T) {
	limiter := NewRateLimiter(time.Minute, 1, 1)
	now := time.Now()
	limiter.now = func() time.Time { return now }
	if limiter.take("ip", "ada") != 0 {
		t.Fatal("first take should pass")
	}
	wait := limiter.take("ip", "ada")
	if wait <= 0 || wait > time.Minute {
		t.Fatalf("second take wait = %v", wait)
	}
	now = now.Add(61 * time.Second)
	if limiter.take("ip", "ada") != 0 {
		t.Fatal("take after window should pass")
	}
	now = now.Add(2 * time.Minute)
	limiter.take("other", "")
	limiter.mu.Lock()
	_, ipKept := limiter.ips["ip"]
	_, accountKept := limiter.accounts["ada"]
	limiter.mu.Unlock()
	if ipKept || accountKept {
		t.Fatal("expired keys were not pruned")
	}
}

// A refresh token names the account on /auth/refresh, so the per-account cap
// applies there too (issue #61, Phase 1).
func TestRateLimiterKeysRefreshByToken(t *testing.T) {
	limiter := NewRateLimiter(time.Minute, 100, 2)
	e := echo.New()
	call := func(ip, token string) int {
		req := httptest.NewRequest(http.MethodPost, "/auth/refresh", strings.NewReader(`{"refreshToken":"`+token+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		handler := limiter.Middleware(true)(func(c *echo.Context) error { return c.NoContent(http.StatusOK) })
		if err := handler(c); err != nil {
			t.Fatal(err)
		}
		return rec.Code
	}
	if got := call("10.0.0.1", "ref_a"); got != http.StatusOK {
		t.Fatalf("first call = %d", got)
	}
	if got := call("10.0.0.2", "ref_a"); got != http.StatusOK {
		t.Fatalf("second call from another IP = %d", got)
	}
	if got := call("10.0.0.3", "ref_a"); got != http.StatusTooManyRequests {
		t.Fatalf("third call with the same token = %d, want 429", got)
	}
	if got := call("10.0.0.3", "ref_b"); got != http.StatusOK {
		t.Fatalf("another token is not affected: %d", got)
	}
}
