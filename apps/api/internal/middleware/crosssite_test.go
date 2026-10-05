package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestCrossSiteGuard(t *testing.T) {
	guard := CrossSiteGuard([]string{"http://localhost:4001"})
	ok := func(c *echo.Context) error { return c.NoContent(http.StatusNoContent) }
	cases := []struct {
		name, method, site, origin, auth string
		want                             int
	}{
		{"same-origin post", http.MethodPost, "same-origin", "", "", http.StatusNoContent},
		{"no fetch metadata", http.MethodPost, "", "", "", http.StatusNoContent},
		{"cross-site get", http.MethodGet, "cross-site", "https://evil.example", "", http.StatusNoContent},
		{"cross-site post", http.MethodPost, "cross-site", "https://evil.example", "", http.StatusForbidden},
		{"cross-site post from allowed origin", http.MethodPost, "cross-site", "http://localhost:4001", "", http.StatusNoContent},
		{"cross-site post with bearer", http.MethodPost, "cross-site", "https://evil.example", "Bearer x", http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(tc.method, "/logout", nil)
			if tc.site != "" {
				req.Header.Set("Sec-Fetch-Site", tc.site)
			}
			if tc.origin != "" {
				req.Header.Set(echo.HeaderOrigin, tc.origin)
			}
			if tc.auth != "" {
				req.Header.Set("Authorization", tc.auth)
			}
			rec := httptest.NewRecorder()
			err := guard(ok)(e.NewContext(req, rec))
			code := rec.Code
			if he, isHTTP := err.(*echo.HTTPError); isHTTP {
				code = he.Code
			}
			if code != tc.want {
				t.Fatalf("status = %d, want %d", code, tc.want)
			}
		})
	}
}
