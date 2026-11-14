package agentmcp

import (
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"
)

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

func signedIn(c *echo.Context) (string, error) {
	uid := user(c)
	if uid == "" {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "Sign in first")
	}
	return uid, nil
}

// Routes registers the signed-in routes (phase 5 contract 3). Every route is
// the signed-in account's own; another account's server answers 404.
func (s *Service) Routes(g *echo.Group) {
	g.GET("/agent/mcp/catalog", s.getCatalog)
	g.GET("/agent/mcp/servers", s.getServers)
	g.POST("/agent/mcp/servers", s.postServer)
	g.PUT("/agent/mcp/servers/:name", s.putServer)
	g.DELETE("/agent/mcp/servers/:name", s.deleteServer)
	g.POST("/agent/mcp/servers/:name/ask-again", s.postAskAgain)
	g.GET("/agent/mcp/servers/:name/tools", s.getTools)
	g.POST("/agent/mcp/servers/:name/sign-in", s.postSignIn)
}

// PublicRoutes registers the OAuth callback. It is public (the browser comes
// back from the server's sign-in page) and checked by its one-use state.
func (s *Service) PublicRoutes(e *echo.Echo) {
	e.GET(callbackPath, s.callback)
}

// fail maps a service error to the HTTP answer.
func fail(err error) error {
	var probe *ProbeError
	switch {
	case errors.Is(err, ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "Not found")
	case errors.Is(err, ErrConflict):
		return echo.NewHTTPError(http.StatusConflict, strings.TrimPrefix(err.Error(), ErrConflict.Error()+": "))
	case errors.Is(err, ErrForbidden):
		return echo.NewHTTPError(http.StatusForbidden, strings.TrimPrefix(err.Error(), ErrForbidden.Error()+": "))
	case errors.Is(err, ErrInvalid):
		return echo.NewHTTPError(http.StatusBadRequest, Message(err))
	case errors.Is(err, ErrUnavailable):
		return echo.NewHTTPError(http.StatusServiceUnavailable, "The assistant isn't running on this server")
	case errors.As(err, &probe):
		return echo.NewHTTPError(http.StatusBadGateway, probe.Message)
	}
	return err
}

func (s *Service) getCatalog(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	rows, err := s.Catalog(c.Request().Context(), uid)
	if err != nil {
		return fail(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"servers": rows})
}

func (s *Service) getServers(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	ctx := c.Request().Context()
	list, err := s.List(ctx, uid)
	if err != nil {
		return fail(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"servers": list, "canAddCommand": s.o.HostAllowed(ctx, uid)})
}

func (s *Service) postServer(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	var in AddInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid server")
	}
	v, pending, err := s.Add(c.Request().Context(), uid, in)
	if err != nil {
		return fail(err)
	}
	if pending {
		return c.JSON(http.StatusAccepted, map[string]any{"server": v, "message": "Waiting for your OK on the host card"})
	}
	return c.JSON(http.StatusCreated, map[string]any{"server": v})
}

func (s *Service) putServer(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	var in UpdateInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid server")
	}
	v, pending, err := s.Update(c.Request().Context(), uid, c.Param("name"), in)
	if err != nil {
		return fail(err)
	}
	if pending {
		return c.JSON(http.StatusAccepted, map[string]any{"server": v, "message": "Waiting for your OK on the host card"})
	}
	return c.JSON(http.StatusOK, map[string]any{"server": v})
}

func (s *Service) postAskAgain(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	v, err := s.AskAgain(c.Request().Context(), uid, c.Param("name"))
	if err != nil {
		return fail(err)
	}
	return c.JSON(http.StatusAccepted, map[string]any{"server": v, "message": "Waiting for your OK on the host card"})
}

func (s *Service) deleteServer(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	if err := s.Remove(c.Request().Context(), uid, c.Param("name")); err != nil {
		return fail(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Service) getTools(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	tools, err := s.Tools(c.Request().Context(), uid, c.Param("name"))
	if err != nil {
		var probe *ProbeError
		if errors.As(err, &probe) {
			return c.JSON(http.StatusOK, map[string]any{"tools": []ToolInfo{}, "error": probe.Message, "needsSignIn": probe.NeedsSignIn})
		}
		return fail(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"tools": tools})
}

func (s *Service) postSignIn(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	var in struct {
		// RedirectBase is Timely's origin as the person's browser reaches the API
		// (the web app: its own origin plus /api-proxy; the phone: the API address).
		RedirectBase string `json:"redirectBase"`
	}
	_ = c.Bind(&in)
	base := in.RedirectBase
	if base == "" {
		base = requestOrigin(c)
	}
	u, err := s.SignIn(c.Request().Context(), uid, c.Param("name"), base)
	if err != nil {
		return fail(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"authorizeUrl": u})
}

// requestOrigin is the origin this request reached the API at.
func requestOrigin(c *echo.Context) string {
	r := c.Request()
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

const callbackPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1f;--mut:#5f6068}@media(prefers-color-scheme:dark){:root{--bg:#141418;--fg:#ececf0;--mut:#a1a2ab}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:28rem;padding:2rem 1rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:var(--mut)}</style></head><body><main><h1>%s</h1><p>%s</p></main></body></html>`

// callback is GET /agent/mcp/oauth/callback?state=&code= (or &error=).
func (s *Service) callback(c *echo.Context) error {
	q := c.Request().URL.Query()
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("Referrer-Policy", "no-referrer")
	name, err := s.Callback(c.Request().Context(), q.Get("state"), q.Get("code"), q.Get("error"))
	if err != nil {
		status := http.StatusBadRequest
		if !errors.Is(err, ErrSignIn) && !errors.Is(err, ErrInvalid) {
			status = http.StatusBadGateway
		}
		msg := err.Error()
		if errors.Is(err, ErrInvalid) {
			msg = Message(err)
		}
		return c.HTML(status, page("Sign-in didn't finish", "Sign-in didn't finish", msg))
	}
	return c.HTML(http.StatusOK, page("Signed in", "Signed in", "You can close this window. "+name+" is ready in Timely."))
}

func page(title, h1, body string) string {
	e := html.EscapeString
	return fmt.Sprintf(callbackPage, e(title), e(h1), e(body))
}
