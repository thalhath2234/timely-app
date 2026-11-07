package bots

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
)

// Routes serves Bots on the signed-in group. REST is OriginApp.
func (s *Service) Routes(g *echo.Group) {
	g.GET("/bots", s.list)
	g.POST("/bots", s.create)
	g.GET("/bots/findings", s.findings) // before /bots/:id
	g.GET("/bots/:id", s.get)
	g.PATCH("/bots/:id", s.update)
	g.DELETE("/bots/:id", s.remove)
	g.POST("/bots/:id/pause", s.pause)
	g.POST("/bots/:id/resume", s.resume)
	g.POST("/bots/:id/snooze", s.snooze)
	g.POST("/bots/:id/run", s.run)
}

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

// httpError maps store errors to responses the client shows as is.
func httpError(err error) error {
	var input *InputError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &input):
		return echo.NewHTTPError(http.StatusBadRequest, input.Message)
	case errors.Is(err, ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "Bot not found")
	case errors.Is(err, ErrPaused):
		return echo.NewHTTPError(http.StatusConflict, ErrPaused.Error())
	}
	return err
}

func badRequest() error { return echo.NewHTTPError(http.StatusBadRequest, "Invalid request") }

func (s *Service) list(c *echo.Context) error {
	views, err := s.List(c.Request().Context(), user(c))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"bots": views})
}

func (s *Service) create(c *echo.Context) error {
	var in Input
	if err := json.NewDecoder(c.Request().Body).Decode(&in); err != nil {
		return badRequest()
	}
	v, err := s.Create(c.Request().Context(), user(c), in, OriginApp)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusCreated, v)
}

func (s *Service) get(c *echo.Context) error {
	d, err := s.Get(c.Request().Context(), user(c), c.Param("id"))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, d)
}

func (s *Service) update(c *echo.Context) error {
	var p Patch
	if err := json.NewDecoder(c.Request().Body).Decode(&p); err != nil {
		return badRequest()
	}
	v, err := s.Update(c.Request().Context(), user(c), c.Param("id"), p, OriginApp)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, v)
}

func (s *Service) remove(c *echo.Context) error {
	if err := s.Delete(c.Request().Context(), user(c), c.Param("id")); err != nil {
		return httpError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Service) pause(c *echo.Context) error {
	v, err := s.Pause(c.Request().Context(), user(c), c.Param("id"), PausePerson)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, v)
}

func (s *Service) resume(c *echo.Context) error {
	v, err := s.Resume(c.Request().Context(), user(c), c.Param("id"), OriginApp)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, v)
}

// run serves Run now: 202 with when the check runs, or 409 while paused.
func (s *Service) run(c *echo.Context) error {
	res, err := s.RunNow(c.Request().Context(), user(c), c.Param("id"), OriginApp)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusAccepted, res)
}

// snooze takes {"for":"day"|"week"}, {"until": RFC 3339} or {"until": null}.
func (s *Service) snooze(c *echo.Context) error {
	var in map[string]json.RawMessage
	if err := json.NewDecoder(c.Request().Body).Decode(&in); err != nil {
		return badRequest()
	}
	until, err := snoozeUntil(in, s.now())
	if err != nil {
		return httpError(err)
	}
	v, err := s.Snooze(c.Request().Context(), user(c), c.Param("id"), until)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, v)
}

func snoozeUntil(in map[string]json.RawMessage, now time.Time) (*time.Time, error) {
	if raw, ok := in["for"]; ok {
		var span string
		_ = json.Unmarshal(raw, &span)
		var t time.Time
		switch span {
		case "day":
			t = now.Add(24 * time.Hour)
		case "week":
			t = now.Add(7 * 24 * time.Hour)
		default:
			return nil, invalid(`Snooze for "day" or "week", or until a time`)
		}
		return &t, nil
	}
	raw, ok := in["until"]
	if !ok {
		return nil, invalid(`Snooze for "day" or "week", or until a time`)
	}
	if string(raw) == "null" {
		return nil, nil
	}
	var t time.Time
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, invalid("Give the time like 2026-11-07T09:00:00Z")
	}
	return &t, nil
}

// findings serves GET /bots/findings?botId=&since=&limit=.
func (s *Service) findings(c *echo.Context) error {
	q := FindingQuery{BotID: c.QueryParam("botId")}
	if raw := strings.TrimSpace(c.QueryParam("since")); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return httpError(invalid("Give since like 2026-11-07T09:00:00Z"))
		}
		q.Since = t
	}
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return httpError(invalid("Give limit as a number from 1 to %d", findingsMax))
		}
		q.Limit = n
	}
	items, err := s.Findings(c.Request().Context(), user(c), q)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"items": items})
}
