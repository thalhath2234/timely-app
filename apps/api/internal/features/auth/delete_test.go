package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
)

func deleteMe(t *testing.T, h *Handler, userID, password string) (int, string) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/me", strings.NewReader(`{"password":"`+password+`"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("userID", userID)
	err := h.DeleteMe(c)
	if err == nil {
		return rec.Code, rec.Body.String()
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("delete returned %T: %v", err, err)
	}
	return httpErr.Code, httpErr.Message
}

func TestDeleteMeNeedsThePassword(t *testing.T) {
	h := newRegisterFixture(t, false)
	if code, _ := postRegister(t, h, "first@example.com"); code != http.StatusCreated {
		t.Fatalf("register status = %d", code)
	}
	user, err := h.userRepo.GetUserByEmail("first@example.com")
	if err != nil {
		t.Fatal(err)
	}
	for _, password := range []string{"", "wrong-password"} {
		if code, _ := deleteMe(t, h, user.ID, password); code != http.StatusForbidden {
			t.Fatalf("password %q: status = %d, want 403", password, code)
		}
	}
	if _, err := h.userRepo.GetUserByID(user.ID); err != nil {
		t.Fatal("a wrong password must keep the account")
	}
}

func TestDeleteMeReopensFirstRunSignUp(t *testing.T) {
	h := newRegisterFixture(t, false)
	if code, _ := postRegister(t, h, "first@example.com"); code != http.StatusCreated {
		t.Fatalf("register status = %d", code)
	}
	user, err := h.userRepo.GetUserByEmail("first@example.com")
	if err != nil {
		t.Fatal(err)
	}
	var cleaned string
	h.SetAfterDelete(func(userID string) { cleaned = userID })

	code, body := deleteMe(t, h, user.ID, "password123")
	if code != http.StatusOK {
		t.Fatalf("delete status = %d %s", code, body)
	}
	if !strings.Contains(body, `"registrationOpen":true`) || !strings.Contains(body, `"lastAccount":true`) {
		t.Fatalf("body = %s, want registrationOpen and lastAccount true", body)
	}
	if cleaned != user.ID {
		t.Fatalf("after-delete hook ran for %q", cleaned)
	}
	if _, err := h.userRepo.GetUserByID(user.ID); err == nil {
		t.Fatal("account still exists")
	}
	if code, _ := postRegister(t, h, "fresh@example.com"); code != http.StatusCreated {
		t.Fatalf("sign-up after delete: status = %d", code)
	}
	if code, _ := deleteMe(t, h, user.ID, "password123"); code != http.StatusNotFound {
		t.Fatalf("second delete: status = %d, want 404", code)
	}
}
