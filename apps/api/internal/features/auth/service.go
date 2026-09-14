package auth

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	defaultAccessMinutes = 30
	defaultRefreshDays   = 30
	minPasswordLength    = 8
)

type SessionTokens struct {
	AccessToken  string
	RefreshToken string
	SessionID    string
	ExpiresIn    int
}

type AuthService interface {
	Register(name, email, password, deviceLabel string) (*models.User, *SessionTokens, error)
	Login(email, password, deviceLabel string) (*models.User, *SessionTokens, error)
	IssueSession(user *models.User, deviceLabel string) (*SessionTokens, error)
	Refresh(refreshToken, deviceLabel string) (*models.User, *SessionTokens, error)
	LogoutSession(sessionID string) error
	LogoutRefresh(refreshToken string) error
	ListSessions(userID string) ([]models.UserSession, error)
	RevokeSession(userID, sessionID string) error
	RevokeOtherSessions(userID, currentSessionID string) (int64, error)
	SessionIsActive(sessionID string) bool
	ReissueAccess(userID, sessionID string) (string, error)
	IssueToken(user *models.User) (string, error)
	GetProfile(userID string) (*models.User, bool, error)
	UpdateProfile(userID string, name, email, currentPassword, newPassword, sessionID string) (*models.User, string, error)
}

type JWTClaims struct {
	UserID                string `json:"user_id"`
	Email                 string `json:"email"`
	SessionID             string `json:"sid,omitempty"`
	IsOnBoardingCompleted bool   `json:"is_on_boarding_completed"`
	jwt.RegisteredClaims
}

type configLookup interface {
	GetConfig(userID string) (*models.Config, error)
}

type authService struct {
	repo      UserRepository
	sessions  SessionRepository
	workspace configLookup
}

func NewAuthService(
	repo UserRepository,
	workspaceRepo configLookup,
	sessions SessionRepository,
) AuthService {
	return &authService{
		repo:      repo,
		sessions:  sessions,
		workspace: workspaceRepo,
	}
}

func (s *authService) Register(name, email, password, deviceLabel string) (*models.User, *SessionTokens, error) {
	email = NormalizeEmail(email)
	name = trimName(name)
	if !ValidateEmail(email) {
		return nil, nil, errors.New("invalid email")
	}
	if len(password) < minPasswordLength {
		return nil, nil, errors.New("password must be at least 8 characters")
	}

	existingUser, _ := s.repo.GetUserByEmail(email)
	if existingUser != nil {
		return nil, nil, errors.New("user with this email already exists")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, nil, err
	}

	user := &models.User{
		ID:       utils.NewUserID(),
		Email:    email,
		Name:     name,
		Password: string(hashedPassword),
	}

	if err := s.repo.CreateUser(user); err != nil {
		return nil, nil, err
	}

	tokens, err := s.IssueSession(user, deviceLabel)
	if err != nil {
		return nil, nil, err
	}
	return user, tokens, nil
}

func (s *authService) Login(email, password, deviceLabel string) (*models.User, *SessionTokens, error) {
	email = NormalizeEmail(email)
	if email == "" || password == "" {
		return nil, nil, errors.New("email and password cannot be empty")
	}

	user, err := s.repo.GetUserByEmail(email)
	if err != nil {
		return nil, nil, errors.New("invalid email or password")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, nil, errors.New("invalid email or password")
	}

	tokens, err := s.IssueSession(user, deviceLabel)
	if err != nil {
		return nil, nil, err
	}
	return user, tokens, nil
}

func (s *authService) IssueToken(user *models.User) (string, error) {
	return s.issueAccessToken(user, "")
}

func (s *authService) IssueSession(user *models.User, deviceLabel string) (*SessionTokens, error) {
	refresh, err := newRefreshToken()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	session := &models.UserSession{
		ID:               utils.NewSessionID(),
		UserID:           user.ID,
		RefreshTokenHash: hashRefreshToken(refresh),
		DeviceLabel:      trimDeviceLabel(deviceLabel),
		CreatedAt:        now.Format(time.RFC3339),
		LastUsedAt:       now.Format(time.RFC3339),
		ExpiresAt:        now.Add(refreshTTL()).Format(time.RFC3339),
	}
	if err := s.sessions.Create(session); err != nil {
		return nil, err
	}
	access, err := s.issueAccessToken(user, session.ID)
	if err != nil {
		return nil, err
	}
	return &SessionTokens{
		AccessToken:  access,
		RefreshToken: refresh,
		SessionID:    session.ID,
		ExpiresIn:    int(accessTTL().Seconds()),
	}, nil
}

func (s *authService) Refresh(refreshToken, deviceLabel string) (*models.User, *SessionTokens, error) {
	if refreshToken == "" {
		return nil, nil, errors.New("missing refresh token")
	}
	session, err := s.sessions.GetByRefreshHash(hashRefreshToken(refreshToken))
	if err != nil {
		return nil, nil, errors.New("invalid session")
	}
	if !sessionStillValid(session, time.Now().UTC()) {
		return nil, nil, errors.New("invalid session")
	}
	user, err := s.repo.GetUserByID(session.UserID)
	if err != nil {
		return nil, nil, errors.New("invalid session")
	}
	next, err := newRefreshToken()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now().UTC()
	session.RefreshTokenHash = hashRefreshToken(next)
	session.LastUsedAt = now.Format(time.RFC3339)
	session.ExpiresAt = now.Add(refreshTTL()).Format(time.RFC3339)
	if deviceLabel != "" {
		session.DeviceLabel = trimDeviceLabel(deviceLabel)
	}
	if err := s.sessions.Update(session); err != nil {
		return nil, nil, err
	}
	access, err := s.issueAccessToken(user, session.ID)
	if err != nil {
		return nil, nil, err
	}
	return user, &SessionTokens{
		AccessToken:  access,
		RefreshToken: next,
		SessionID:    session.ID,
		ExpiresIn:    int(accessTTL().Seconds()),
	}, nil
}

func (s *authService) LogoutSession(sessionID string) error {
	if sessionID == "" {
		return nil
	}
	return s.sessions.Revoke(sessionID)
}

func (s *authService) LogoutRefresh(refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	session, err := s.sessions.GetByRefreshHash(hashRefreshToken(refreshToken))
	if err != nil {
		return nil
	}
	return s.LogoutSession(session.ID)
}

func (s *authService) ListSessions(userID string) ([]models.UserSession, error) {
	return s.sessions.ListByUser(userID)
}

func (s *authService) RevokeSession(userID, sessionID string) error {
	session, err := s.sessions.GetByID(sessionID)
	if err != nil {
		return gorm.ErrRecordNotFound
	}
	if session.UserID != userID {
		return gorm.ErrRecordNotFound
	}
	return s.LogoutSession(sessionID)
}

func (s *authService) RevokeOtherSessions(userID, currentSessionID string) (int64, error) {
	if currentSessionID == "" {
		return 0, errors.New("current session required")
	}
	session, err := s.sessions.GetByID(currentSessionID)
	if err != nil || session.UserID != userID {
		return 0, gorm.ErrRecordNotFound
	}
	return s.sessions.RevokeOthers(userID, currentSessionID)
}

func (s *authService) SessionIsActive(sessionID string) bool {
	if sessionID == "" {
		return true
	}
	session, err := s.sessions.GetByID(sessionID)
	if err != nil {
		return false
	}
	return sessionStillValid(session, time.Now().UTC())
}

func (s *authService) ReissueAccess(userID, sessionID string) (string, error) {
	user, err := s.repo.GetUserByID(userID)
	if err != nil {
		return "", err
	}
	if sessionID != "" && !s.SessionIsActive(sessionID) {
		return "", errors.New("invalid session")
	}
	return s.issueAccessToken(user, sessionID)
}

func (s *authService) GetProfile(userID string) (*models.User, bool, error) {
	user, err := s.repo.GetUserByID(userID)
	if err != nil {
		return nil, false, err
	}

	config, err := s.workspace.GetConfig(user.ID)
	if err != nil {
		return user, false, nil
	}

	return user, config.IsOnBoardingCompleted, nil
}

func (s *authService) UpdateProfile(
	userID string,
	name, email, currentPassword, newPassword, sessionID string,
) (*models.User, string, error) {
	user, err := s.repo.GetUserByID(userID)
	if err != nil {
		return nil, "", errors.New("user not found")
	}

	email = NormalizeEmail(email)
	if email != "" && email != user.Email {
		if !ValidateEmail(email) {
			return nil, "", errors.New("invalid email")
		}
		existing, _ := s.repo.GetUserByEmail(email)
		if existing != nil && existing.ID != user.ID {
			return nil, "", errors.New("email is already in use")
		}
		user.Email = email
	}

	user.Name = trimName(name)

	if newPassword != "" {
		if len(newPassword) < minPasswordLength {
			return nil, "", errors.New("password must be at least 8 characters")
		}
		if currentPassword == "" {
			return nil, "", errors.New("current password is required")
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(currentPassword)); err != nil {
			return nil, "", errors.New("current password is incorrect")
		}
		hashed, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
		if err != nil {
			return nil, "", err
		}
		user.Password = string(hashed)
	}

	if err := s.repo.UpdateUser(user); err != nil {
		return nil, "", err
	}

	token, err := s.issueAccessToken(user, sessionID)
	if err != nil {
		return user, "", nil
	}

	return user, token, nil
}

func (s *authService) issueAccessToken(user *models.User, sessionID string) (string, error) {
	config, err := s.workspace.GetConfig(user.ID)
	onboardingDone := false
	if err == nil && config != nil {
		onboardingDone = config.IsOnBoardingCompleted
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return "", errors.New("JWT_SECRET missing")
	}

	now := time.Now()
	claims := &JWTClaims{
		UserID:                user.ID,
		Email:                 user.Email,
		SessionID:             sessionID,
		IsOnBoardingCompleted: onboardingDone,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(accessTTL())),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "timely-api",
			Audience:  []string{"timely-client"},
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(jwtSecret))
}

func accessTTL() time.Duration {
	if minutes, err := strconv.Atoi(os.Getenv("JWT_ACCESS_MINUTES")); err == nil && minutes > 0 {
		return time.Duration(minutes) * time.Minute
	}
	if hours, err := strconv.Atoi(os.Getenv("JWT_EXPIRY_HOURS")); err == nil && hours > 0 {
		return time.Duration(hours) * time.Hour
	}
	return time.Duration(defaultAccessMinutes) * time.Minute
}

func refreshTTL() time.Duration {
	days := defaultRefreshDays
	if parsed, err := strconv.Atoi(os.Getenv("JWT_REFRESH_DAYS")); err == nil && parsed > 0 {
		days = parsed
	}
	return time.Duration(days) * 24 * time.Hour
}

func trimName(name string) string {
	const max = 100
	out := strings.TrimSpace(name)
	runes := []rune(out)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}

func trimDeviceLabel(label string) string {
	const max = 120
	runes := []rune(label)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}
