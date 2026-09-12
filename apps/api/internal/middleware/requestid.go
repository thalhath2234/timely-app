package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
)

func RequestID() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			id := c.Request().Header.Get("X-Request-ID")
			if id == "" {
				id = uuid.NewString()
			}
			c.Set("requestID", id)
			c.Response().Header().Set("X-Request-ID", id)
			return next(c)
		}
	}
}

func StructuredLogger() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			start := time.Now()
			err := next(c)
			status := http.StatusOK
			if err != nil {
				if he, ok := err.(*echo.HTTPError); ok {
					status = he.Code
				} else {
					status = http.StatusInternalServerError
				}
			}
			slog.Info("request",
				"id", c.Get("requestID"),
				"method", c.Request().Method,
				"path", c.Request().URL.Path,
				"status", status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
			return err
		}
	}
}
