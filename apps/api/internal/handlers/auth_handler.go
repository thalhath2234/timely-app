package handlers

import (
	"net/http"
	"os"
	"time"
	"timely-api/internal/repositories"
	"timely-api/internal/services"

	"github.com/labstack/echo/v5"
)

type AuthHandler struct {
	authService services.AuthService
	userRepo    repositories.UserRepository
}

func NewAuthHandler(authService services.AuthService, userRepo repositories.UserRepository) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		userRepo:    userRepo,
	}
}

type authRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string `json:"token"`
}

type userProfileResponse struct {
	ID    uint   `json:"id"`
	Email string `json:"email"`
}

func (h *AuthHandler) Register(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	user, err := h.authService.Register(req.Email, req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	res := userProfileResponse{
		ID:    user.ID,
		Email: user.Email,
	}

	return c.JSON(http.StatusCreated, res)
}

func (h *AuthHandler) Login(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	token, err := h.authService.Login(req.Email, req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, err.Error())
	}

	cookie := new(http.Cookie)
	cookie.Name = "session"
	cookie.Value = token
	cookie.HttpOnly = true
	cookie.Secure = os.Getenv("ENV") == "production"
	cookie.Path = "/"
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Expires = time.Now().Add(24 * time.Hour)

	c.SetCookie(cookie)

	return c.JSON(http.StatusOK, map[string]string{
		"message": "logged in",
	})
}

func (h *AuthHandler) Logout(c *echo.Context) error {
	cookie := new(http.Cookie)

	cookie.Name = "session"
	cookie.Value = ""
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.Expires = time.Unix(0, 0)
	cookie.MaxAge = -1
	cookie.SameSite = http.SameSiteLaxMode

	// Set true in production with HTTPS
	cookie.Secure = os.Getenv("ENV") == "production"

	c.SetCookie(cookie)

	return c.JSON(http.StatusOK, map[string]string{
		"message": "logged out",
	})
}

func (h *AuthHandler) Me(c *echo.Context) error {
	userID, ok := c.Get("userID").(uint)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	email, ok := c.Get("email").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	res := userProfileResponse{
		ID:    userID,
		Email: email,
	}

	return c.JSON(http.StatusOK, res)
}
