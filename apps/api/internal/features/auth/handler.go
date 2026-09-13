package auth

import (
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct {
	authService AuthService
	userRepo    UserRepository
}

func NewHandler(authService AuthService, userRepo UserRepository) *Handler {
	return &Handler{
		authService: authService,
		userRepo:    userRepo,
	}
}

type authRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type updateProfileRequest struct {
	Name            string `json:"name"`
	Email           string `json:"email"`
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type userProfileResponse struct {
	ID                    string `json:"id"`
	Email                 string `json:"email"`
	Name                  string `json:"name"`
	IsOnBoardingCompleted bool   `json:"is_on_boarding_completed"`
}

type authSessionResponse struct {
	Message      string              `json:"message,omitempty"`
	Token        string              `json:"token"`
	RefreshToken string              `json:"refreshToken"`
	ExpiresIn    int                 `json:"expiresIn"`
	User         userProfileResponse `json:"user"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func (h *Handler) profileFor(userID, email, name string) userProfileResponse {
	_, onboardingDone, err := h.authService.GetProfile(userID)
	if err != nil {
		onboardingDone = false
	}
	return userProfileResponse{
		ID:                    userID,
		Email:                 email,
		Name:                  name,
		IsOnBoardingCompleted: onboardingDone,
	}
}

func (h *Handler) Register(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	user, tokens, err := h.authService.Register(req.Name, req.Email, req.Password, deviceLabel(c))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	h.setAuthCookies(c, tokens)

	return c.JSON(http.StatusCreated, sessionResponse("", tokens, h.profileFor(user.ID, user.Email, user.Name)))
}

func (h *Handler) Login(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	user, tokens, err := h.authService.Login(req.Email, req.Password, deviceLabel(c))
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, err.Error())
	}

	h.setAuthCookies(c, tokens)

	return c.JSON(http.StatusOK, sessionResponse("logged in", tokens, h.profileFor(user.ID, user.Email, user.Name)))
}

func (h *Handler) Refresh(c *echo.Context) error {
	var req refreshRequest
	_ = c.Bind(&req)
	token := req.RefreshToken
	if token == "" {
		if cookie, err := c.Cookie("refresh"); err == nil {
			token = cookie.Value
		}
	}

	user, tokens, err := h.authService.Refresh(token, deviceLabel(c))
	if err != nil {
		clearAuthCookies(c)
		return echo.NewHTTPError(http.StatusUnauthorized, err.Error())
	}

	h.setAuthCookies(c, tokens)
	return c.JSON(http.StatusOK, sessionResponse("refreshed", tokens, h.profileFor(user.ID, user.Email, user.Name)))
}

func (h *Handler) Logout(c *echo.Context) error {
	if sid := sessionIDFromRequest(c); sid != "" {
		_ = h.authService.LogoutSession(sid)
	}
	if cookie, err := c.Cookie("refresh"); err == nil && cookie.Value != "" {
		_ = h.authService.LogoutRefresh(cookie.Value)
	}

	clearAuthCookies(c)

	return c.JSON(http.StatusOK, map[string]string{
		"message": "logged out",
	})
}

func (h *Handler) Me(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	user, onboardingDone, err := h.authService.GetProfile(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "User not found")
	}

	return c.JSON(http.StatusOK, userProfileResponse{
		ID:                    user.ID,
		Email:                 user.Email,
		Name:                  user.Name,
		IsOnBoardingCompleted: onboardingDone,
	})
}

func (h *Handler) UpdateMe(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	var req updateProfileRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	user, token, err := h.authService.UpdateProfile(
		userID,
		req.Name,
		req.Email,
		req.CurrentPassword,
		req.NewPassword,
		sessionIDFromContext(c),
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if token != "" {
		SetAccessCookie(c, token, accessTTL())
	}

	_, onboardingDone, _ := h.authService.GetProfile(user.ID)

	return c.JSON(http.StatusOK, userProfileResponse{
		ID:                    user.ID,
		Email:                 user.Email,
		Name:                  user.Name,
		IsOnBoardingCompleted: onboardingDone,
	})
}

func (h *Handler) ListSessions(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}
	sessions, err := h.authService.ListSessions(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	current := ""
	if sid, ok := c.Get("sessionID").(string); ok {
		current = sid
	}
	type sessionView struct {
		ID          string  `json:"id"`
		DeviceLabel string  `json:"deviceLabel"`
		CreatedAt   string  `json:"createdAt"`
		LastUsedAt  string  `json:"lastUsedAt"`
		ExpiresAt   string  `json:"expiresAt"`
		RevokedAt   *string `json:"revokedAt,omitempty"`
		Current     bool    `json:"current"`
	}
	out := make([]sessionView, 0, len(sessions))
	for _, session := range sessions {
		out = append(out, sessionView{
			ID:          session.ID,
			DeviceLabel: session.DeviceLabel,
			CreatedAt:   session.CreatedAt,
			LastUsedAt:  session.LastUsedAt,
			ExpiresAt:   session.ExpiresAt,
			RevokedAt:   session.RevokedAt,
			Current:     session.ID == current,
		})
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) RevokeSession(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}
	if err := h.authService.RevokeSession(userID, c.Param("id")); err != nil {
		if err == gorm.ErrRecordNotFound {
			return echo.NewHTTPError(http.StatusNotFound, "session not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "session revoked"})
}

func (h *Handler) RevokeOtherSessions(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}
	current := sessionIDFromContext(c)
	n, err := h.authService.RevokeOtherSessions(userID, current)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return echo.NewHTTPError(http.StatusNotFound, "session not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]int64{"revoked": n})
}

func (h *Handler) setAuthCookies(c *echo.Context, tokens *SessionTokens) {
	if tokens == nil {
		return
	}
	SetAccessCookie(c, tokens.AccessToken, accessTTL())
	SetRefreshCookie(c, tokens.RefreshToken, refreshTTL())
}

func SetAccessCookie(c *echo.Context, token string, ttl time.Duration) {
	cookie := new(http.Cookie)
	cookie.Name = "session"
	cookie.Value = token
	cookie.HttpOnly = true
	cookie.Path = "/"
	cookie.Expires = time.Now().Add(ttl)
	cookie.MaxAge = int(ttl.Seconds())
	applySessionCookieFlags(cookie, c)
	c.SetCookie(cookie)
}

func SetRefreshCookie(c *echo.Context, token string, ttl time.Duration) {
	cookie := new(http.Cookie)
	cookie.Name = "refresh"
	cookie.Value = token
	cookie.HttpOnly = true
	cookie.Path = "/"
	cookie.Expires = time.Now().Add(ttl)
	cookie.MaxAge = int(ttl.Seconds())
	applySessionCookieFlags(cookie, c)
	c.SetCookie(cookie)
}

func clearAuthCookies(c *echo.Context) {
	for _, name := range []string{"session", "refresh"} {
		cookie := new(http.Cookie)
		cookie.Name = name
		cookie.Value = ""
		cookie.Path = "/"
		cookie.HttpOnly = true
		cookie.Expires = time.Unix(0, 0)
		cookie.MaxAge = -1
		applySessionCookieFlags(cookie, c)
		c.SetCookie(cookie)
	}
}

func applySessionCookieFlags(cookie *http.Cookie, c *echo.Context) {
	origin := c.Request().Header.Get("Origin")
	https := strings.HasPrefix(origin, "https://") ||
		c.Request().TLS != nil ||
		c.Request().Header.Get("X-Forwarded-Proto") == "https"
	if https {
		cookie.Secure = true
		cookie.SameSite = http.SameSiteNoneMode
		return
	}
	cookie.Secure = false
	cookie.SameSite = http.SameSiteLaxMode
}

func sessionResponse(message string, tokens *SessionTokens, user userProfileResponse) authSessionResponse {
	resp := authSessionResponse{Message: message, User: user}
	if tokens != nil {
		resp.Token = tokens.AccessToken
		resp.RefreshToken = tokens.RefreshToken
		resp.ExpiresIn = tokens.ExpiresIn
	}
	return resp
}

func deviceLabel(c *echo.Context) string {
	ua := strings.TrimSpace(c.Request().Header.Get("User-Agent"))
	if ua == "" {
		return "unknown device"
	}
	return ua
}

func sessionIDFromContext(c *echo.Context) string {
	if sid, ok := c.Get("sessionID").(string); ok {
		return sid
	}
	return ""
}

func sessionIDFromRequest(c *echo.Context) string {
	if sid, ok := c.Get("sessionID").(string); ok && sid != "" {
		return sid
	}
	tokenString := bearerTokenFromHeader(c)
	if tokenString == "" {
		if cookie, err := c.Cookie("session"); err == nil {
			tokenString = cookie.Value
		}
	}
	if tokenString == "" {
		return ""
	}
	claims, err := ParseAccessToken(tokenString)
	if err != nil {
		return claims.SessionID
	}
	return claims.SessionID
}

func bearerTokenFromHeader(c *echo.Context) string {
	header := c.Request().Header.Get("Authorization")
	if len(header) < 8 || header[:7] != "Bearer " {
		return ""
	}
	return header[7:]
}
