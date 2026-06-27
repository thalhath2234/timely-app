package auth

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v5"
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
	Email    string `json:"email"`
	Password string `json:"password"`
}

type userProfileResponse struct {
	ID                    string `json:"id"`
	Email                 string `json:"email"`
	IsOnBoardingCompleted bool   `json:"is_on_boarding_completed"`
}

func (h *Handler) Register(c *echo.Context) error {
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

func (h *Handler) Login(c *echo.Context) error {
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

func (h *Handler) Logout(c *echo.Context) error {
	cookie := new(http.Cookie)

	cookie.Name = "session"
	cookie.Value = ""
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.Expires = time.Unix(0, 0)
	cookie.MaxAge = -1
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Secure = os.Getenv("ENV") == "production"

	c.SetCookie(cookie)

	return c.JSON(http.StatusOK, map[string]string{
		"message": "logged out",
	})
}

func (h *Handler) Me(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	email, ok := c.Get("email").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	IsOnBoardingCompleted, ok := c.Get("IsOnBoardingCompleted").(bool)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}

	res := userProfileResponse{
		ID:                    userID,
		Email:                 email,
		IsOnBoardingCompleted: IsOnBoardingCompleted,
	}
	log.Printf("User ID: %s, Email: %s", userID, email)
	return c.JSON(http.StatusOK, res)
}
