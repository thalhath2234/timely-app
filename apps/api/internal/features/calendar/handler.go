package calendar

import (
	"errors"
	"net/http"
	"time"
	"timely-api/internal/features/event"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"

	"github.com/labstack/echo/v5"
)

const maxRangeDays = 400

type Response struct {
	From  time.Time `json:"from"`
	To    time.Time `json:"to"`
	Items []Item    `json:"items"`
}

type Service interface {
	Range(userID string, from, to time.Time) (*Response, error)
	Today(userID, date, timezone string) (*TodayResponse, error)
}

type HoursLookup func(userID string) (models.WorkingHours, error)

type service struct {
	tasks  task.TaskRepository
	events event.EventRepository
	hours  HoursLookup
}

func NewService(tasks task.TaskRepository, events event.EventRepository, hours HoursLookup) Service {
	return &service{tasks: tasks, events: events, hours: hours}
}

func (s *service) workingHours(userID string) models.WorkingHours {
	if s.hours == nil {
		return models.DefaultWorkingHours("UTC")
	}
	hours, err := s.hours(userID)
	if err != nil || hours.IsEmpty() {
		return models.DefaultWorkingHours("UTC")
	}
	return hours
}

func (s *service) Range(userID string, from, to time.Time) (*Response, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if !to.After(from) {
		return nil, errors.New("`to` must be after `from`")
	}
	if to.Sub(from) > maxRangeDays*24*time.Hour {
		return nil, errors.New("range too large")
	}

	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}
	events, err := s.events.ListInRange(userID, from, to)
	if err != nil {
		return nil, err
	}
	hours := s.workingHours(userID)
	items, err := Collect(tasks, events, from, to, hours)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []Item{}
	}
	return &Response{From: from, To: to, Items: items}, nil
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

// Range serves GET /calendar?from=&to= (RFC 3339). Without parameters it
// returns the current week starting today.
func (h *Handler) Range(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	now := time.Now().UTC()
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 7)

	if raw := c.QueryParam("from"); raw != "" {
		parsed, err := recurrence.ParseTime(raw)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid from")
		}
		from = parsed
		to = from.AddDate(0, 0, 7)
	}
	if raw := c.QueryParam("to"); raw != "" {
		parsed, err := recurrence.ParseTime(raw)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid to")
		}
		to = parsed
	}

	response, err := h.service.Range(userID, from, to)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, response)
}
