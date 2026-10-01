package auth

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v5"
)

const handlerTestSecret = "handler-test-secret-handler-test-secret"

func newLogoutFixture(t *testing.T) (*Handler, AuthService, *SessionTokens) {
	t.Helper()
	t.Setenv("JWT_SECRET", handlerTestSecret)
	svc := NewAuthService(&fakeUserRepo{}, fakeWorkspaceRepo{}, &fakeSessions{})
	_, tokens, err := svc.Register("Ada", "ada@example.com", "password123", "phone")
	if err != nil {
		t.Fatal(err)
	}
	return NewHandler(svc, &fakeUserRepo{}), svc, tokens
}

func postLogout(t *testing.T, h *Handler, bearer string) int {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.Logout(c); err != nil {
		t.Fatalf("logout returned error: %v", err)
	}
	return rec.Code
}

func forgedTokenForSession(sessionID string) string {
	segment := func(v string) string { return base64.RawURLEncoding.EncodeToString([]byte(v)) }
	return strings.Join([]string{
		segment(`{"alg":"HS256","typ":"JWT"}`),
		segment(`{"sid":"` + sessionID + `"}`),
		"invalid-signature",
	}, ".")
}

// QA-01: a JWT with an invalid signature must not be able to name the session
// that logout revokes.
func TestLogoutIgnoresForgedToken(t *testing.T) {
	h, svc, tokens := newLogoutFixture(t)
	forged := forgedTokenForSession(tokens.SessionID)
	if got := sessionIDFromRequestForBearer(forged); got != "" {
		t.Fatalf("forged token resolved session %q", got)
	}
	if code := postLogout(t, h, forged); code != http.StatusOK {
		t.Fatalf("logout status = %d", code)
	}
	if !svc.SessionIsActive(tokens.SessionID) {
		t.Fatal("forged token revoked the targeted session")
	}
}

func TestLogoutIgnoresTokenSignedWithAnotherSecret(t *testing.T) {
	h, svc, tokens := newLogoutFixture(t)
	other := jwt.NewWithClaims(jwt.SigningMethodHS256, &JWTClaims{SessionID: tokens.SessionID})
	signed, err := other.SignedString([]byte("some-other-secret-some-other-secret"))
	if err != nil {
		t.Fatal(err)
	}
	postLogout(t, h, signed)
	if !svc.SessionIsActive(tokens.SessionID) {
		t.Fatal("token signed with a different secret revoked the session")
	}
}

func TestLogoutRevokesWithValidToken(t *testing.T) {
	h, svc, tokens := newLogoutFixture(t)
	postLogout(t, h, tokens.AccessToken)
	if svc.SessionIsActive(tokens.SessionID) {
		t.Fatal("valid access token should revoke its own session")
	}
}

func TestLogoutRevokesWithExpiredSignedToken(t *testing.T) {
	h, svc, tokens := newLogoutFixture(t)
	expired := jwt.NewWithClaims(jwt.SigningMethodHS256, &JWTClaims{
		SessionID: tokens.SessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	})
	signed, err := expired.SignedString([]byte(handlerTestSecret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseAccessToken(signed); err == nil {
		t.Fatal("fixture token should be rejected as expired by the normal parser")
	}
	postLogout(t, h, signed)
	if svc.SessionIsActive(tokens.SessionID) {
		t.Fatal("an expired token this server signed should still log out its session")
	}
}

func sessionIDFromRequestForBearer(bearer string) string {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	return sessionIDFromRequest(e.NewContext(req, httptest.NewRecorder()))
}
