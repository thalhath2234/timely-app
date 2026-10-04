package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
)

func postRegister(t *testing.T, h *Handler, email string) (int, string) {
	t.Helper()
	e := echo.New()
	body := `{"name":"Ada","email":"` + email + `","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	err := h.Register(c)
	if err == nil {
		return rec.Code, rec.Body.String()
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("register returned %T: %v", err, err)
	}
	return httpErr.Code, httpErr.Message
}

func newRegisterFixture(t *testing.T, allow bool) *Handler {
	t.Helper()
	t.Setenv("JWT_SECRET", handlerTestSecret)
	users := &fakeUserRepo{}
	svc := NewAuthService(users, fakeWorkspaceRepo{}, &fakeSessions{})
	h := NewHandler(svc, users)
	h.SetAllowRegistration(allow)
	return h
}

func TestRegisterClosedAfterFirstAccount(t *testing.T) {
	h := newRegisterFixture(t, false)
	if !h.RegistrationOpen() {
		t.Fatal("registration must stay open while no account exists")
	}
	if code, _ := postRegister(t, h, "first@example.com"); code != http.StatusCreated {
		t.Fatalf("first account status = %d", code)
	}
	if h.RegistrationOpen() {
		t.Fatal("registration must close once an account exists")
	}
	code, msg := postRegister(t, h, "second@example.com")
	if code != http.StatusForbidden || msg != RegistrationClosedMessage {
		t.Fatalf("second account: %d %q", code, msg)
	}
}

func TestRegisterOpenByDefault(t *testing.T) {
	h := newRegisterFixture(t, true)
	for _, email := range []string{"a@example.com", "b@example.com"} {
		if code, msg := postRegister(t, h, email); code != http.StatusCreated {
			t.Fatalf("%s: %d %q", email, code, msg)
		}
	}
}

func TestAllowRegistrationFromEnv(t *testing.T) {
	for value, want := range map[string]bool{"": true, "true": true, "false": false, "0": false, "FALSE": false, "yes": true} {
		t.Setenv("ALLOW_REGISTRATION", value)
		if got := AllowRegistrationFromEnv(); got != want {
			t.Fatalf("ALLOW_REGISTRATION=%q: got %v", value, got)
		}
	}
}
