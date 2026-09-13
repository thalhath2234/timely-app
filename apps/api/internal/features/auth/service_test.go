package auth

import (
	"errors"
	"testing"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type fakeUserRepo struct {
	byEmail map[string]*models.User
	byID    map[string]*models.User
}

func (f *fakeUserRepo) CreateUser(user *models.User) error {
	if f.byEmail == nil {
		f.byEmail = map[string]*models.User{}
		f.byID = map[string]*models.User{}
	}
	if _, ok := f.byEmail[NormalizeEmail(user.Email)]; ok {
		return errors.New("duplicate")
	}
	copied := *user
	f.byEmail[NormalizeEmail(user.Email)] = &copied
	f.byID[user.ID] = &copied
	return nil
}

func (f *fakeUserRepo) GetUserByEmail(email string) (*models.User, error) {
	user, ok := f.byEmail[NormalizeEmail(email)]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copied := *user
	return &copied, nil
}

func (f *fakeUserRepo) GetUserByID(userID string) (*models.User, error) {
	user, ok := f.byID[userID]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copied := *user
	return &copied, nil
}

func (f *fakeUserRepo) UpdateUser(user *models.User) error {
	copied := *user
	f.byID[user.ID] = &copied
	f.byEmail[NormalizeEmail(user.Email)] = &copied
	return nil
}

type fakeSessions struct {
	byID      map[string]*models.UserSession
	byRefresh map[string]*models.UserSession
}

func (f *fakeSessions) Create(session *models.UserSession) error {
	if f.byID == nil {
		f.byID = map[string]*models.UserSession{}
		f.byRefresh = map[string]*models.UserSession{}
	}
	copied := *session
	f.byID[session.ID] = &copied
	f.byRefresh[session.RefreshTokenHash] = &copied
	return nil
}

func (f *fakeSessions) GetByID(id string) (*models.UserSession, error) {
	session, ok := f.byID[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copied := *session
	return &copied, nil
}

func (f *fakeSessions) GetByRefreshHash(hash string) (*models.UserSession, error) {
	session, ok := f.byRefresh[hash]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copied := *session
	return &copied, nil
}

func (f *fakeSessions) ListByUser(userID string) ([]models.UserSession, error) {
	var out []models.UserSession
	for _, session := range f.byID {
		if session.UserID == userID {
			out = append(out, *session)
		}
	}
	return out, nil
}

func (f *fakeSessions) Touch(id string, lastUsedAt string) error { return nil }

func (f *fakeSessions) Update(session *models.UserSession) error {
	return f.Create(session)
}

func (f *fakeSessions) Revoke(id string, revokedAt string) error {
	session, ok := f.byID[id]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	session.RevokedAt = &revokedAt
	return nil
}

func (f *fakeSessions) RevokeOthers(userID, keepID, revokedAt string) (int64, error) {
	var n int64
	for _, session := range f.byID {
		if session.UserID == userID && session.ID != keepID && session.RevokedAt == nil {
			session.RevokedAt = &revokedAt
			n++
		}
	}
	return n, nil
}

type fakeWorkspaceRepo struct{}

func (fakeWorkspaceRepo) GetConfig(userID string) (*models.Config, error) {
	return &models.Config{UserID: userID, IsOnBoardingCompleted: false}, nil
}

func TestRegisterPersistsNameAndNormalizesEmail(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-test-secret-test-secret")
	users := &fakeUserRepo{}
	svc := NewAuthService(users, fakeWorkspaceRepo{}, &fakeSessions{})

	user, tokens, err := svc.Register("  Ada Lovelace  ", "  Ada@Example.COM ", "password123", "test")
	if err != nil {
		t.Fatal(err)
	}
	if user.Name != "Ada Lovelace" {
		t.Fatalf("name=%q", user.Name)
	}
	if user.Email != "ada@example.com" {
		t.Fatalf("email=%q", user.Email)
	}
	if tokens == nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Fatal("expected session tokens")
	}

	_, _, err = svc.Register("Other", "ada@example.com", "password123", "test")
	if err == nil {
		t.Fatal("expected duplicate email to fail")
	}
}

func TestLoginRejectsUnknownUser(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-test-secret-test-secret")
	svc := NewAuthService(&fakeUserRepo{}, fakeWorkspaceRepo{}, &fakeSessions{})
	if _, _, err := svc.Login("nobody@example.com", "password123", "test"); err == nil {
		t.Fatal("expected login failure")
	}
}

func TestSessionRevocation(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-test-secret-test-secret")
	svc := NewAuthService(&fakeUserRepo{}, fakeWorkspaceRepo{}, &fakeSessions{})
	_, tokens, err := svc.Register("Ada", "ada@example.com", "password123", "phone")
	if err != nil {
		t.Fatal(err)
	}
	if !svc.SessionIsActive(tokens.SessionID) {
		t.Fatal("new session should be active")
	}
	if err := svc.LogoutSession(tokens.SessionID); err != nil {
		t.Fatal(err)
	}
	if svc.SessionIsActive(tokens.SessionID) {
		t.Fatal("revoked session should be inactive")
	}
}

func TestRevokeOtherSessionsKeepsCurrent(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-test-secret-test-secret")
	svc := NewAuthService(&fakeUserRepo{}, fakeWorkspaceRepo{}, &fakeSessions{})
	user, phone, err := svc.Register("Ada", "ada@example.com", "password123", "phone")
	if err != nil {
		t.Fatal(err)
	}
	_, laptop, err := svc.Login("ada@example.com", "password123", "laptop")
	if err != nil {
		t.Fatal(err)
	}
	n, err := svc.RevokeOtherSessions(user.ID, laptop.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("revoked=%d", n)
	}
	if svc.SessionIsActive(phone.SessionID) {
		t.Fatal("other session should be revoked")
	}
	if !svc.SessionIsActive(laptop.SessionID) {
		t.Fatal("current session should stay active")
	}
}
