package notify

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"timely-api/internal/jobs"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct {
	service *Service
	queue   *jobs.Queue
}

func NewHandler(service *Service, queue *jobs.Queue) *Handler {
	return &Handler{service: service, queue: queue}
}

func userID(c *echo.Context) (string, error) {
	id, ok := c.Get("userID").(string)
	if !ok || id == "" {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	return id, nil
}

func notifyError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}

func (h *Handler) List(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	unread := c.QueryParam("unread") == "true"
	rows, err := h.service.List(uid, unread, limit)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"items": rows})
}

func (h *Handler) UnreadCount(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	n, err := h.service.UnreadCount(uid)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"count": n})
}

func (h *Handler) MarkRead(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	row, err := h.service.MarkRead(uid, c.Param("id"))
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, row)
}

func (h *Handler) MarkAllRead(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	if err := h.service.MarkAllRead(uid); err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ClearAll(c *echo.Context) error {
	if err := requireJSONIfCookie(c); err != nil {
		return err
	}
	uid, err := userID(c)
	if err != nil {
		return err
	}
	if err := h.service.ClearAll(uid); err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"ok": true})
}

func requireJSONIfCookie(c *echo.Context) error {
	header := c.Request().Header.Get("Authorization")
	if len(header) >= 8 && header[:7] == "Bearer " {
		return nil
	}
	ct := strings.ToLower(c.Request().Header.Get(echo.HeaderContentType))
	if strings.HasPrefix(ct, "application/json") {
		return nil
	}
	return echo.NewHTTPError(http.StatusForbidden, "JSON content type required")
}

func (h *Handler) Snooze(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req SnoozeInput
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	row, err := h.service.Snooze(uid, c.Param("id"), req)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, row)
}

func (h *Handler) Reschedule(c *echo.Context) error {
	return h.Snooze(c)
}

func (h *Handler) PrioritizeOverdue(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	plan, err := h.service.PrioritizeOverdue(uid, c.Param("id"))
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, plan)
}

func (h *Handler) GetSettings(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	settings, err := h.service.GetSettings(uid)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (h *Handler) UpdateSettings(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var settings models.NotificationSettings
	if err := c.Bind(&settings); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	updated, err := h.service.UpdateSettings(uid, settings)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, updated)
}

type deviceRequest struct {
	Token    string `json:"token"`
	Platform string `json:"platform"`
}

func (h *Handler) RegisterDevice(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req deviceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	device, err := h.service.RegisterDevice(uid, req.Token, req.Platform)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, device)
}

func (h *Handler) UnregisterDevice(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req deviceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	if err := h.service.UnregisterDevice(uid, req.Token); err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ListJobs(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	rows, err := h.queue.List(uid, c.QueryParam("status"), limit)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"items": rows})
}

func (h *Handler) JobHealth(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	health, err := h.queue.Health(uid)
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, health)
}

func (h *Handler) RetryJob(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	job, err := h.queue.Retry(uid, c.Param("id"))
	if err != nil {
		return notifyError(err)
	}
	return c.JSON(http.StatusOK, job)
}
