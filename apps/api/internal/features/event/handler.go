package event

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct {
	service EventService
}

func NewHandler(service EventService) *Handler {
	return &Handler{service: service}
}

type createEventRequest struct {
	Title       string                  `json:"title"`
	Description string                  `json:"description"`
	Start       string                  `json:"start"`
	End         string                  `json:"end"`
	AllDay      bool                    `json:"allDay"`
	Color       *string                 `json:"color"`
	WorkspaceID *string                 `json:"workspaceId"`
	ProjectID   *string                 `json:"projectId"`
	TaskID      *string                 `json:"taskId"`
	Recurrence  *models.RecurrenceInput `json:"recurrence"`
}

type updateEventRequest struct {
	Title       *string                 `json:"title"`
	Description *string                 `json:"description"`
	Start       *string                 `json:"start"`
	End         *string                 `json:"end"`
	AllDay      *bool                   `json:"allDay"`
	Color       *string                 `json:"color"`
	WorkspaceID *string                 `json:"workspaceId"`
	ProjectID   *string                 `json:"projectId"`
	TaskID      *string                 `json:"taskId"`
	Recurrence  *models.RecurrenceInput `json:"recurrence"`
}

type occurrenceRequest struct {
	OriginalStart string  `json:"originalStart"`
	Action        string  `json:"action"`
	NewStart      *string `json:"newStart"`
	NewEnd        *string `json:"newEnd"`
}

type splitRequest struct {
	FromStart  string                 `json:"fromStart"`
	Recurrence models.RecurrenceInput `json:"recurrence"`
	Title      *string                `json:"title"`
	Start      *string                `json:"start"`
	End        *string                `json:"end"`
}

func userID(c *echo.Context) (string, error) {
	id, ok := c.Get("userID").(string)
	if !ok || id == "" {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	return id, nil
}

func (h *Handler) Create(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}

	var req createEventRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	start, err := recurrence.ParseTime(req.Start)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid start")
	}
	end, err := recurrence.ParseTime(req.End)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid end")
	}

	event := &models.Event{
		Title:       req.Title,
		Description: req.Description,
		StartAt:     start,
		EndAt:       end,
		AllDay:      req.AllDay,
		Color:       req.Color,
		WorkspaceID: req.WorkspaceID,
		ProjectID:   req.ProjectID,
		TaskID:      req.TaskID,
	}

	created, err := h.service.Create(uid, event, req.Recurrence)
	if err != nil {
		return eventError(err)
	}
	return c.JSON(http.StatusCreated, map[string]any{"message": "event created successfully", "event": created})
}

func (h *Handler) List(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	events, err := h.service.ListByUser(uid)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, events)
}

func (h *Handler) GetByID(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	event, err := h.service.GetByID(uid, c.Param("id"))
	if err != nil {
		return eventError(err)
	}
	return c.JSON(http.StatusOK, event)
}

func (h *Handler) Update(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	var req updateEventRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	var rawKeys map[string]json.RawMessage
	_ = json.Unmarshal(body, &rawKeys)
	_, recurrenceSet := rawKeys["recurrence"]

	event, err := h.service.Update(uid, c.Param("id"), EventUpdate{
		Title:         req.Title,
		Description:   req.Description,
		Start:         req.Start,
		End:           req.End,
		AllDay:        req.AllDay,
		Color:         req.Color,
		WorkspaceID:   req.WorkspaceID,
		ProjectID:     req.ProjectID,
		TaskID:        req.TaskID,
		RecurrenceSet: recurrenceSet,
		Recurrence:    req.Recurrence,
	})
	if err != nil {
		return eventError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"message": "event updated successfully", "event": event})
}

func (h *Handler) Delete(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	if err := h.service.Delete(uid, c.Param("id")); err != nil {
		return eventError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"message": "event deleted successfully"})
}

func (h *Handler) EditOccurrence(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req occurrenceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	event, err := h.service.EditOccurrence(uid, c.Param("id"), OccurrenceAction{
		OriginalStart: req.OriginalStart,
		Action:        req.Action,
		NewStart:      req.NewStart,
		NewEnd:        req.NewEnd,
	})
	if err != nil {
		return eventError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"message": "occurrence updated", "event": event})
}

func (h *Handler) Split(c *echo.Context) error {
	uid, err := userID(c)
	if err != nil {
		return err
	}
	var req splitRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	event, err := h.service.Split(uid, c.Param("id"), SplitInput{
		FromStart:  req.FromStart,
		Recurrence: req.Recurrence,
		Title:      req.Title,
		Start:      req.Start,
		End:        req.End,
	})
	if err != nil {
		return eventError(err)
	}
	return c.JSON(http.StatusCreated, map[string]any{"message": "series split", "event": event})
}

func eventError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "event not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}
