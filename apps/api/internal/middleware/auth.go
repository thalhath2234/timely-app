package middleware

import (
	"net/http"
	"os"
	"timely-api/internal/features/auth"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v5"
)

type SessionGuard interface {
	SessionIsActive(sessionID string) bool
}

func JWTMiddleware(guard SessionGuard) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			tokenString := bearerToken(c)
			if tokenString == "" {
				cookie, err := c.Cookie("session")
				if err != nil || cookie.Value == "" {
					return echo.NewHTTPError(http.StatusUnauthorized, "Missing session")
				}
				tokenString = cookie.Value
			}

			claims := &auth.JWTClaims{}
			token, err := jwt.ParseWithClaims(
				tokenString,
				claims,
				func(token *jwt.Token) (interface{}, error) {
					return []byte(os.Getenv("JWT_SECRET")), nil
				},
			)

			if err != nil || !token.Valid {
				return echo.NewHTTPError(http.StatusUnauthorized, "Invalid or expired token")
			}

			if guard != nil && !guard.SessionIsActive(claims.SessionID) {
				return echo.NewHTTPError(http.StatusUnauthorized, "Invalid or expired token")
			}

			c.Set("userID", claims.UserID)
			c.Set("email", claims.Email)
			c.Set("sessionID", claims.SessionID)
			c.Set("IsOnBoardingCompleted", claims.IsOnBoardingCompleted)

			return next(c)
		}
	}
}

func bearerToken(c *echo.Context) string {
	header := c.Request().Header.Get("Authorization")
	if len(header) < 8 || header[:7] != "Bearer " {
		return ""
	}
	return header[7:]
}
