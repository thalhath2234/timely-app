package auth

import (
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
	Message string              `json:"message,omitempty"`
	Token   string              `json:"token"`
	User    userProfileResponse `json:"user"`
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

	user, err := h.authService.Register(req.Email, req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	token, err := h.authService.IssueToken(user)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to issue session")
	}

	h.setSessionCookie(c, token)

	return c.JSON(http.StatusCreated, authSessionResponse{
		Token: token,
		User:  h.profileFor(user.ID, user.Email, user.Name),
	})
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

	h.setSessionCookie(c, token)

	user, err := h.userRepo.GetUserByEmail(req.Email)
	if err != nil {
		return c.JSON(http.StatusOK, authSessionResponse{
			Message: "logged in",
			Token:   token,
			User:    userProfileResponse{Email: req.Email},
		})
	}

	return c.JSON(http.StatusOK, authSessionResponse{
		Message: "logged in",
		Token:   token,
		User:    h.profileFor(user.ID, user.Email, user.Name),
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
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if token != "" {
		h.setSessionCookie(c, token)
	}

	_, onboardingDone, _ := h.authService.GetProfile(user.ID)

	return c.JSON(http.StatusOK, userProfileResponse{
		ID:                    user.ID,
		Email:                 user.Email,
		Name:                  user.Name,
		IsOnBoardingCompleted: onboardingDone,
	})
}

func (h *Handler) setSessionCookie(c *echo.Context, token string) {
	cookie := new(http.Cookie)
	cookie.Name = "session"
	cookie.Value = token
	cookie.HttpOnly = true
	cookie.Secure = os.Getenv("ENV") == "production"
	cookie.Path = "/"
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Expires = time.Now().Add(24 * time.Hour)
	c.SetCookie(cookie)
}
