package task

import (
	"net/http"
	"strings"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
)

func (h *Handler) Duplicate(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	task, err := h.taskService.Duplicate(userID, c.Param("id"))
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusCreated, map[string]any{"message": "task duplicated", "task": task})
}

type checklistItemRequest struct {
	Title     string `json:"title"`
	Completed *bool  `json:"completed"`
}

type checklistReplaceRequest struct {
	Items models.Checklist `json:"items"`
}

func (h *Handler) AddChecklistItem(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req checklistItemRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	task, err := h.taskService.AddChecklistItem(userID, c.Param("id"), req.Title)
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) UpdateChecklistItem(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req checklistItemRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	var title *string
	if strings.TrimSpace(req.Title) != "" {
		trimmed := strings.TrimSpace(req.Title)
		title = &trimmed
	}
	task, err := h.taskService.UpdateChecklistItem(userID, c.Param("id"), c.Param("itemId"), title, req.Completed)
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) DeleteChecklistItem(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	task, err := h.taskService.DeleteChecklistItem(userID, c.Param("id"), c.Param("itemId"))
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) ReplaceChecklist(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req checklistReplaceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	task, err := h.taskService.ReplaceChecklist(userID, c.Param("id"), req.Items)
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) StartFocus(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	task, err := h.taskService.StartFocus(userID, c.Param("id"))
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) StopFocus(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	task, err := h.taskService.StopFocus(userID, c.Param("id"))
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}

type todayFocusRequest struct {
	Date *string `json:"date"`
}

func (h *Handler) SetTodayFocus(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req todayFocusRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	task, err := h.taskService.SetTodayFocus(userID, c.Param("id"), req.Date)
	if err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"task": task})
}
