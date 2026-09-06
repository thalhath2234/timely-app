package schedule

import (
	"errors"
	"net/http"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

type planRequest struct {
	TaskIDs       []string `json:"taskIds"`
	From          *string  `json:"from"`
	To            *string  `json:"to"`
	Timezone      string   `json:"timezone"`
	IncludeManual bool     `json:"includeManual"`
}

type blockRequest struct {
	Start           string  `json:"start"`
	End             *string `json:"end"`
	DurationMinutes *int    `json:"durationMinutes"`
	Replace         bool    `json:"replace"`
}

func userID(c *echo.Context) (string, error) {
	id, ok := c.Get("userID").(string)
	if !ok || id == "" {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	return id, nil
}

func (h *Handler) GetWorkingHours(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	hours, err := h.service.GetWorkingHours(uid, c.QueryParam("tz"))
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, hours)
}

func (h *Handler) UpdateWorkingHours(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var hours models.WorkingHours
	if err := c.Bind(&hours); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	updated, err := h.service.UpdateWorkingHours(uid, hours)
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, updated)
}

func (h *Handler) Preview(c *echo.Context) error {
	uid, req, err := h.readPlan(c)
	if err != nil {
		return err
	}
	plan, err := h.service.Preview(uid, req)
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, plan)
}

// Apply and Reschedule share one implementation: the engine always rebuilds
// its own blocks from scratch for the tasks in scope.
func (h *Handler) Apply(c *echo.Context) error {
	uid, req, err := h.readPlan(c)
	if err != nil {
		return err
	}
	plan, err := h.service.Apply(uid, req)
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, plan)
}

func (h *Handler) readPlan(c *echo.Context) (string, PlanRequest, error) {
	uid, err := userID(c)
	if err != nil {
		return "", PlanRequest{}, err
	}
	var req planRequest
	if c.Request().ContentLength != 0 {
		if err := c.Bind(&req); err != nil {
			return "", PlanRequest{}, echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
		}
	}
	return uid, PlanRequest{
		TaskIDs:       req.TaskIDs,
		From:          req.From,
		To:            req.To,
		Timezone:      req.Timezone,
		IncludeManual: req.IncludeManual,
	}, nil
}

func (h *Handler) AddBlock(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req blockRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	task, err := h.service.AddBlock(uid, c.Param("id"), BlockInput{
		Start:           req.Start,
		End:             req.End,
		DurationMinutes: req.DurationMinutes,
		Replace:         req.Replace,
	})
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusCreated, map[string]any{"message": "block created", "task": task})
}

func (h *Handler) ClearBlocks(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	task, err := h.service.ClearBlocks(uid, c.Param("id"))
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"message": "blocks removed", "task": task})
}

func (h *Handler) MoveBlock(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req blockRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	block, err := h.service.MoveBlock(uid, c.Param("id"), req.Start, req.End)
	if err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"message": "block moved", "block": block})
}

func (h *Handler) DeleteBlock(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	if err := h.service.DeleteBlock(uid, c.Param("id")); err != nil {
		return scheduleError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"message": "block removed"})
}

func scheduleError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}
