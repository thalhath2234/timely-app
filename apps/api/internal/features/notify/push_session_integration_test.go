package notify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/auth"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

// liveSession signs the account in: a user_sessions row that expires at
// expires, as auth writes it (RFC3339 text).
func liveSession(t *testing.T, db *gorm.DB, userID, id string, expires time.Time) string {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	row := &models.UserSession{ID: id, UserID: userID, RefreshTokenHash: "hash_" + id, CreatedAt: now, LastUsedAt: now, ExpiresAt: expires.UTC().Format(time.RFC3339)}
	if err := db.Create(row).Error; err != nil {
		t.Fatal(err)
	}
	return id
}

// testSession is a sign-in of the test account that lasts the whole test.
func testSession(t *testing.T, db *gorm.DB, id string) string {
	t.Helper()
	return liveSession(t, db, zoneTestUser, id, time.Now().Add(24*time.Hour))
}

// pushedTo sends one reminder and returns the tokens Expo was asked to
// reach.
func pushedTo(t *testing.T, svc *Service, db *gorm.DB, fake *fakeExpo, id string) map[string]bool {
	t.Helper()
	fake.mu.Lock()
	fake.calls = nil
	fake.mu.Unlock()
	if err := svc.sendPush(context.Background(), reminderRow(t, db, id), models.NotificationSettings{}); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, call := range fake.sends() {
		for _, m := range call.messages {
			got[m.To] = true
		}
	}
	return got
}

func sessionAuth(db *gorm.DB) auth.AuthService {
	return auth.NewAuthService(auth.NewUserRepository(db), nil, auth.NewSessionRepository(db))
}

// A phone's token is registered under the sign-in that sent it. Revoking
// that session from the Sessions list removes the device; it gets nothing
// after.
func TestIntegrationPushDeviceRevokedSession(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	a := testSession(t, db, "ses_push_a")
	b := testSession(t, db, "ses_push_b")
	devA, err := svc.RegisterDevice(zoneTestUser, a, pushToken(1), "android")
	if err != nil || devA.SessionID == nil || *devA.SessionID != a {
		t.Fatalf("register under A = %+v (%v)", devA, err)
	}
	if _, err := svc.RegisterDevice(zoneTestUser, b, pushToken(2), "android"); err != nil {
		t.Fatal(err)
	}
	if got := pushedTo(t, svc, db, fake, "ntf_sess_before"); !got[pushToken(1)] || !got[pushToken(2)] {
		t.Fatalf("before the revoke, pushed to %v", got)
	}

	if err := sessionAuth(db).RevokeSession(zoneTestUser, a); err != nil {
		t.Fatal(err)
	}
	if deviceExists(t, db, devA.ID) {
		t.Fatal("revoking the session kept its device")
	}
	if got := pushedTo(t, svc, db, fake, "ntf_sess_after"); got[pushToken(1)] || !got[pushToken(2)] {
		t.Fatalf("after the revoke, pushed to %v", got)
	}
}

// "Sign out others" keeps only the current sign-in's phone.
func TestIntegrationPushDeviceRevokeOthers(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	ids := map[string]string{}
	for i, s := range []string{"ses_push_a", "ses_push_b", "ses_push_c"} {
		testSession(t, db, s)
		dev, err := svc.RegisterDevice(zoneTestUser, s, pushToken(i), "android")
		if err != nil {
			t.Fatal(err)
		}
		ids[s] = dev.ID
	}
	if n, err := sessionAuth(db).RevokeOtherSessions(zoneTestUser, "ses_push_b"); err != nil || n != 2 {
		t.Fatalf("revoke others = %d (%v)", n, err)
	}
	var left []models.PushDevice
	if err := db.Find(&left).Error; err != nil {
		t.Fatal(err)
	}
	if len(left) != 1 || left[0].ID != ids["ses_push_b"] {
		t.Fatalf("devices left = %+v", left)
	}
	if got := pushedTo(t, svc, db, fake, "ntf_sess_others"); len(got) != 1 || !got[pushToken(1)] {
		t.Fatalf("pushed to %v", got)
	}
}

// Logging out removes the phone's device too.
func TestIntegrationPushDeviceLogout(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	a := testSession(t, db, "ses_push_logout")
	dev, err := svc.RegisterDevice(zoneTestUser, a, pushToken(1), "android")
	if err != nil {
		t.Fatal(err)
	}
	if err := sessionAuth(db).LogoutSession(a); err != nil {
		t.Fatal(err)
	}
	if deviceExists(t, db, dev.ID) {
		t.Fatal("logout kept the device")
	}
}

// A device whose session expired, or that has no session (registered before
// devices belonged to a sign-in), gets no push; registering the same token
// again moves it to the new sign-in, which does.
func TestIntegrationPushDeviceNeedsValidSession(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	expired := liveSession(t, db, zoneTestUser, "ses_push_expired", time.Now().Add(-time.Minute))
	if _, err := svc.RegisterDevice(zoneTestUser, expired, pushToken(1), "android"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&models.PushDevice{ID: "dev_no_session", UserID: zoneTestUser, Token: pushToken(2), Platform: "android", CreatedAt: now, UpdatedAt: now, LastSeenAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	// A session row with an unreadable expiry counts as expired, as in auth.
	if err := db.Create(&models.UserSession{ID: "ses_push_bad", UserID: zoneTestUser, RefreshTokenHash: "hash_bad", CreatedAt: "x", LastUsedAt: "x", ExpiresAt: "someday"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RegisterDevice(zoneTestUser, "ses_push_bad", pushToken(3), "android"); err != nil {
		t.Fatal(err)
	}
	if got := pushedTo(t, svc, db, fake, "ntf_sess_none"); len(got) != 0 {
		t.Fatalf("pushed to %v with no valid session", got)
	}

	fresh := testSession(t, db, "ses_push_fresh")
	moved, err := svc.RegisterDevice(zoneTestUser, fresh, pushToken(2), "android")
	if err != nil || moved.ID != "dev_no_session" || moved.SessionID == nil || *moved.SessionID != fresh {
		t.Fatalf("re-register = %+v (%v)", moved, err)
	}
	var stored models.PushDevice
	if err := db.First(&stored, "id = ?", "dev_no_session").Error; err != nil || stored.SessionID == nil || *stored.SessionID != fresh {
		t.Fatalf("stored = %+v (%v)", stored, err)
	}
	if got := pushedTo(t, svc, db, fake, "ntf_sess_moved"); len(got) != 1 || !got[pushToken(2)] {
		t.Fatalf("after re-registering, pushed to %v", got)
	}

	// Moving it again, to another sign-in, leaves the old one's sign-out
	// harmless to it.
	other := testSession(t, db, "ses_push_other")
	if _, err := svc.RegisterDevice(zoneTestUser, other, pushToken(2), "android"); err != nil {
		t.Fatal(err)
	}
	if err := sessionAuth(db).LogoutSession(fresh); err != nil {
		t.Fatal(err)
	}
	if !deviceExists(t, db, "dev_no_session") {
		t.Fatal("signing out the old session removed a token that moved on")
	}
}

// The handler takes the session from the request's sign-in.
func TestIntegrationRegisterDeviceHandlerSession(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	a := testSession(t, db, "ses_push_handler")
	h := NewHandler(svc, svc.queue)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/devices/push", strings.NewReader(`{"token":"`+pushToken(9)+`","platform":"android"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("userID", zoneTestUser)
	c.Set("sessionID", a)
	if err := h.RegisterDevice(c); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("register = %d (%v)", rec.Code, err)
	}
	if strings.Contains(rec.Body.String(), a) {
		t.Fatalf("the reply names the session: %s", rec.Body.String())
	}
	var stored models.PushDevice
	if err := db.First(&stored, "token = ?", pushToken(9)).Error; err != nil || stored.SessionID == nil || *stored.SessionID != a {
		t.Fatalf("stored = %+v (%v)", stored, err)
	}
}
