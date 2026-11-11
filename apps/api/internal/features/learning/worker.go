package learning

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/labstack/echo/v5"

	"timely-api/internal/agenthost"
)

// result is a worker's learning.result.
type result struct {
	OK      bool            `json:"ok"`
	Data    json.RawMessage `json:"data"`
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Error   string          `json:"error"`
}

// askWorker sends one learning.* or settings.update request and returns the
// result's data, or an *echo.HTTPError saying what went wrong in words the
// apps can show.
func askWorker(ctx context.Context, w requester, typ string, fields any) (json.RawMessage, error) {
	m, err := w.Request(ctx, typ, fields)
	if err != nil {
		return nil, replyError(err)
	}
	if m.Type != agenthost.TypeLearningResult {
		return nil, echo.NewHTTPError(http.StatusBadGateway, "The agent answered "+cut(m.Type, 40)+" instead of a result.")
	}
	var res result
	if err := m.Decode(&res); err != nil {
		return nil, echo.NewHTTPError(http.StatusBadGateway, "The agent's answer could not be read.")
	}
	if !res.OK {
		msg := firstNonEmpty(res.Message, res.Error, dataMessage(res.Data), "The agent could not do that.")
		code := http.StatusUnprocessableEntity
		if res.Code == "not_found" {
			code = http.StatusNotFound
		}
		return nil, echo.NewHTTPError(code, cut(msg, 500))
	}
	if len(res.Data) == 0 {
		return json.RawMessage("null"), nil
	}
	return res.Data, nil
}

// replyError turns a failed request into an HTTP error.
func replyError(err error) error {
	var re *agenthost.ReplyError
	switch {
	case errors.As(err, &re):
		msg := cut(firstNonEmpty(re.Message, "The agent could not do that."), 500)
		switch re.Code {
		case "not_found", "unknown_skill", "unknown_entry", "unknown_pending":
			return echo.NewHTTPError(http.StatusNotFound, msg)
		case "bad_message", "invalid", "bad_request":
			return echo.NewHTTPError(http.StatusBadRequest, msg)
		case "unsupported", "unknown_type":
			return echo.NewHTTPError(http.StatusNotImplemented, "This needs a newer agent runtime: "+msg)
		case "conflict", "locked", "busy":
			return echo.NewHTTPError(http.StatusConflict, msg)
		case "internal":
			slog.Warn("learning: the agent failed a request", "error", re.Message)
			return echo.NewHTTPError(http.StatusBadGateway, "Something went wrong in Timely's assistant. Try again.")
		}
		return echo.NewHTTPError(http.StatusBadGateway, msg)
	case errors.Is(err, context.DeadlineExceeded):
		return echo.NewHTTPError(http.StatusGatewayTimeout, "The agent did not answer in time. Try again.")
	case errors.Is(err, context.Canceled):
		return echo.NewHTTPError(http.StatusServiceUnavailable, "The request was cancelled.")
	}
	return echo.NewHTTPError(http.StatusServiceUnavailable, "The agent stopped before it answered. Try again.")
}

func dataMessage(data json.RawMessage) string {
	var body struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	_ = json.Unmarshal(data, &body)
	return firstNonEmpty(body.Message, body.Error)
}

func firstNonEmpty(list ...string) string {
	for _, s := range list {
		if s = strings.TrimSpace(s); s != "" {
			return s
		}
	}
	return ""
}

// unavailable is 503 with the reason the account's worker cannot serve.
func unavailable(reason string) error {
	return echo.NewHTTPError(http.StatusServiceUnavailable, reason)
}

// worker returns the account's ready worker, starting it when needed, or an
// HTTP error: 503 with the reason when this API cannot run the agent.
func (s *Service) worker(ctx context.Context, uid string) (*agenthost.Worker, error) {
	if s.workers == nil {
		return nil, unavailable("The new engine is not set up on this server.")
	}
	if a, ok := s.workers.(interface{ Available() error }); ok {
		if err := a.Available(); err != nil {
			return nil, unavailable(err.Error())
		}
	}
	w, err := s.workers.Ensure(ctx, uid)
	switch {
	case err == nil:
		return w, nil
	case errors.Is(err, context.DeadlineExceeded):
		return nil, echo.NewHTTPError(http.StatusGatewayTimeout, "The agent took too long to start. Try again.")
	case errors.Is(err, agenthost.ErrSuspended):
		return nil, unavailable("Timely is restoring this account's agent. Try again in a moment.")
	}
	return nil, unavailable("The agent could not start: " + cut(err.Error(), 500))
}

// ask runs one request on the signed-in account's own worker, started on
// demand, within the request timeout.
func (s *Service) ask(c *echo.Context, typ string, fields any) (json.RawMessage, error) {
	uid := user(c)
	if uid == "" {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "Sign in first")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), s.timeout)
	defer cancel()
	w, err := s.worker(ctx, uid)
	if err != nil {
		return nil, err
	}
	release := w.Hold()
	defer release()
	return askWorker(ctx, w, typ, fields)
}

// skillName is a skill's folder name (no paths).
var skillName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

func validName(name string) bool {
	return skillName.MatchString(name) && !strings.Contains(name, "..")
}
