package calendar

import (
	"errors"
	"net/http"
	"time"
	"timely-api/internal/features/task"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
)

type TodayResponse struct {
	Date           string        `json:"date"`
	Timezone       string        `json:"timezone"`
	Focusing       *models.Task  `json:"focusing"`
	PausedFocus    *models.Task  `json:"pausedFocus"`
	TodayFocus     []models.Task `json:"todayFocus"`
	Items          []Item        `json:"items"`
	Overdue        []models.Task `json:"overdue"`
	Unscheduled    []models.Task `json:"unscheduled"`
	InboxCount     int           `json:"inboxCount"`
	CompletedToday []models.Task `json:"completedToday"`
	Unfinished     []models.Task `json:"unfinished"`
	TomorrowFocus  []models.Task `json:"tomorrowFocus"`
}

func (s *service) Today(userID, date, timezone string) (*TodayResponse, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	loc := time.Local
	if timezone != "" {
		loaded, err := time.LoadLocation(timezone)
		if err != nil {
			return nil, errors.New("invalid timezone")
		}
		loc = loaded
	}
	now := time.Now().In(loc)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if date != "" {
		parsed, err := time.ParseInLocation("2006-01-02", date, loc)
		if err != nil {
			return nil, errors.New("date must be YYYY-MM-DD")
		}
		day = parsed
	}
	from := day
	to := day.AddDate(0, 0, 1)
	dayStamp := day.Format("2006-01-02")
	tomorrowStamp := day.AddDate(0, 0, 1).Format("2006-01-02")

	rangeRes, err := s.Range(userID, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}

	out := &TodayResponse{
		Date:           dayStamp,
		Timezone:       models.ClientZoneName(loc),
		TodayFocus:     []models.Task{},
		Items:          rangeRes.Items,
		Overdue:        []models.Task{},
		Unscheduled:    []models.Task{},
		CompletedToday: []models.Task{},
		Unfinished:     []models.Task{},
		TomorrowFocus:  []models.Task{},
	}
	if out.Items == nil {
		out.Items = []Item{}
	}

	workDay, err := s.workDay(userID, timezone)
	if err != nil {
		return nil, err
	}
	scheduledIDs := map[string]bool{}
	for _, item := range rangeRes.Items {
		if item.TaskID != "" && !item.Reminder {
			scheduledIDs[item.TaskID] = true
		}
	}

	for i := range tasks {
		t := tasks[i]
		if t.IsInbox() {
			out.InboxCount++
		}
		if t.IsFocusing() {
			copy := t
			out.Focusing = &copy
		}
		if t.FocusPausedAt != nil && !t.IsCompleted() && (out.PausedFocus == nil || *t.FocusPausedAt > *out.PausedFocus.FocusPausedAt) {
			copy := t
			out.PausedFocus = &copy
		}
		focusDay := models.NormalizeDate(deref(t.TodayFocusOn))
		if focusDay == dayStamp {
			out.TodayFocus = append(out.TodayFocus, t)
		}
		if focusDay == tomorrowStamp {
			out.TomorrowFocus = append(out.TomorrowFocus, t)
		}
		if t.IsCompleted() && completedOnDay(t, dayStamp, loc) {
			out.CompletedToday = append(out.CompletedToday, t)
			continue
		}
		if t.IsCompleted() || t.IsInbox() || t.IsReminder() {
			continue
		}
		if task.IsOverdue(t, workDay) {
			out.Overdue = append(out.Overdue, t)
		}
		if task.IsUnscheduled(t, workDay) {
			out.Unscheduled = append(out.Unscheduled, t)
		}
		if scheduledIDs[t.ID] {
			out.Unfinished = append(out.Unfinished, t)
		}
	}
	return out, nil
}

func completedOnDay(t models.Task, day string, loc *time.Location) bool {
	if t.CompletedAt == nil || *t.CompletedAt == "" {
		return false
	}
	parsed, err := time.Parse(time.RFC3339, *t.CompletedAt)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339Nano, *t.CompletedAt)
		if err != nil {
			return len(*t.CompletedAt) >= 10 && (*t.CompletedAt)[:10] == day
		}
	}
	return parsed.In(loc).Format("2006-01-02") == day
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func (h *Handler) Today(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	response, err := h.service.Today(userID, c.QueryParam("date"), c.QueryParam("timezone"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, response)
}
