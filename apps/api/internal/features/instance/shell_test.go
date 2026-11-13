package instance

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/labstack/echo/v5"
)

const testToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func reqFrom(remote, token string, headers map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodPut, "/instance/host-accounts", nil)
	r.RemoteAddr = remote
	if token != "" {
		r.Header.Set(ShellTokenHeader, token)
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

func TestShellRequestNeedsTheTokenAndALoopbackPeer(t *testing.T) {
	SetShellToken(testToken)
	t.Cleanup(func() { SetShellToken("") })
	digest := shellDigest.Load()
	cases := []struct {
		name  string
		req   *http.Request
		valid bool
	}{
		{"token from 127.0.0.1", reqFrom("127.0.0.1:5555", testToken, nil), true},
		{"token from ::1", reqFrom("[::1]:5555", testToken, nil), true},
		{"token from the IPv4-mapped loopback", reqFrom("[::ffff:127.0.0.1]:5555", testToken, nil), true},
		{"no token", reqFrom("127.0.0.1:5555", "", nil), false},
		{"wrong token", reqFrom("127.0.0.1:5555", testToken+"x", nil), false},
		{"a prefix of the token", reqFrom("127.0.0.1:5555", testToken[:20], nil), false},
		{"right token from a LAN address", reqFrom("192.168.0.14:5555", testToken, nil), false},
		{"right token from a tailnet address", reqFrom("100.76.98.105:5555", testToken, nil), false},
		{"right token with X-Forwarded-For", reqFrom("127.0.0.1:5555", testToken, map[string]string{"X-Forwarded-For": "127.0.0.1"}), false},
		{"right token with Forwarded", reqFrom("127.0.0.1:5555", testToken, map[string]string{"Forwarded": "for=127.0.0.1"}), false},
		{"a forged loopback X-Forwarded-For cannot lift a LAN peer", reqFrom("192.168.0.14:5555", testToken, map[string]string{"X-Forwarded-For": "127.0.0.1"}), false},
		{"unparseable peer", reqFrom("not-an-address", testToken, nil), false},
	}
	for _, tc := range cases {
		if got := shellRequest(tc.req, digest); got != tc.valid {
			t.Errorf("%s: shellRequest = %v, want %v", tc.name, got, tc.valid)
		}
	}
}

func TestShellRequestIsNeverTrueWithoutAConfiguredToken(t *testing.T) {
	SetShellToken("")
	for _, token := range []string{"", "anything", testToken} {
		if shellRequest(reqFrom("127.0.0.1:5555", token, nil), shellDigest.Load()) {
			t.Errorf("token %q accepted with none configured", token)
		}
	}
	// A short token is a mistake, not a secret: it is never configured.
	SetShellToken("short")
	if shellDigest.Load() != nil {
		t.Error("a 5-character token was accepted as configuration")
	}
	if shellRequest(reqFrom("127.0.0.1:5555", "short", nil), shellDigest.Load()) {
		t.Error("a 5-character token matched")
	}
	t.Cleanup(func() { SetShellToken("") })
}

func TestShellTokenFromEnvRemovesItFromTheEnvironment(t *testing.T) {
	t.Setenv(ShellTokenEnv, testToken)
	ShellTokenFromEnv()
	t.Cleanup(func() { SetShellToken("") })
	if got := lookup(ShellTokenEnv); got != "" {
		t.Errorf("%s is still in the environment (child processes would inherit it)", ShellTokenEnv)
	}
	if !shellRequest(reqFrom("127.0.0.1:1", testToken, nil), shellDigest.Load()) {
		t.Error("the token read from the environment was not configured")
	}
}

func TestShellOnlyAnswers404NotUnauthorized(t *testing.T) {
	SetShellToken(testToken)
	t.Cleanup(func() { SetShellToken("") })
	e := echo.New()
	e.PUT("/x", func(c *echo.Context) error { return c.NoContent(http.StatusNoContent) }, ShellOnly)
	for name, token := range map[string]string{"none": "", "wrong": "nope-nope-nope-nope-nope"} {
		rec := httptest.NewRecorder()
		r := reqFrom("127.0.0.1:1", token, nil)
		r.URL.Path = "/x"
		e.ServeHTTP(rec, r)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s token: status %d, want 404", name, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	r := reqFrom("127.0.0.1:1", testToken, nil)
	r.URL.Path = "/x"
	e.ServeHTTP(rec, r)
	if rec.Code != http.StatusNoContent {
		t.Errorf("right token: status %d", rec.Code)
	}
}

func lookup(name string) string { v, _ := os.LookupEnv(name); return v }
