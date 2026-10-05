package middleware

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"
)

// CrossSiteGuard rejects state-changing requests that a browser made from
// another site, unless their Origin is one the API trusts for CORS. Session
// cookies may be SameSite=None, so without this a page elsewhere could make a
// signed-in browser POST to the API (log out, mark read, start a backup).
// Bearer-token clients (the phone, MCP) are not browsers and pass through.
func CrossSiteGuard(allowedOrigins []string) echo.MiddlewareFunc {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = true
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			req := c.Request()
			switch req.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				return next(c)
			}
			if bearerToken(c) != "" {
				return next(c)
			}
			if strings.EqualFold(req.Header.Get("Sec-Fetch-Site"), "cross-site") && !allowed[req.Header.Get(echo.HeaderOrigin)] {
				return echo.NewHTTPError(http.StatusForbidden, "Cross-site request blocked")
			}
			return next(c)
		}
	}
}
