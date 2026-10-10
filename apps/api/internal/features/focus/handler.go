package focus

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

// Service serves habits and goals over REST.
type Service struct {
	store  *Store
	decide Decider
}

// New builds the service; d may be nil (goal progress is then unavailable).
func New(db *gorm.DB, d Decider) *Service {
	return &Service{store: NewStore(db), decide: d}
}

func (s *Service) Store() *Store { return s.store }

func (s *Service) Routes(g *echo.Group) {
	g.GET("/habits", s.listHabits)
	g.POST("/habits", s.addHabit)
	g.PUT("/habits/order", s.orderHabits)
	g.PATCH("/habits/:id", s.renameHabit)
	g.DELETE("/habits/:id", s.deleteHabit)
	g.POST("/habits/:id/check", s.checkHabit)

	g.GET("/goals", s.listGoals)
	g.POST("/goals", s.addGoal)
	g.GET("/goals/progress", s.progress)
	g.PUT("/goals/order", s.orderGoals)
	g.PATCH("/goals/:id", s.renameGoal)
	g.DELETE("/goals/:id", s.deleteGoal)
}

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

// httpError maps store errors to responses the client shows as is.
func httpError(err error, what string) error {
	var input *InputError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &input):
		return echo.NewHTTPError(http.StatusBadRequest, input.Message)
	case errors.Is(err, ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, what+" not found")
	}
	return err
}

// today is the client's date from ?today=YYYY-MM-DD, or the account's own
// date when it is left out.
func (s *Service) today(c *echo.Context) (time.Time, error) {
	raw := strings.TrimSpace(c.QueryParam("today"))
	if raw == "" {
		raw = s.store.Today(c.Request().Context(), user(c), c.QueryParam("timezone"))
	}
	d, err := ParseDay(raw)
	if err != nil {
		return d, httpError(err, "")
	}
	return d, nil
}

func (s *Service) listHabits(c *echo.Context) error {
	today, err := s.today(c)
	if err != nil {
		return err
	}
	habits, err := s.store.Habits(c.Request().Context(), user(c), today)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"habits": habits, "today": today.Format(dayLayout)})
}

type nameIn struct {
	Name  string `json:"name"`
	Title string `json:"title"`
}

func (in nameIn) text() string {
	if in.Name != "" {
		return in.Name
	}
	return in.Title
}

func (s *Service) addHabit(c *echo.Context) error {
	var in nameIn
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	h, err := s.store.AddHabit(c.Request().Context(), user(c), in.text())
	if err != nil {
		return httpError(err, "Habit")
	}
	return c.JSON(http.StatusCreated, h)
}

func (s *Service) renameHabit(c *echo.Context) error {
	var in nameIn
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	h, err := s.store.RenameHabit(c.Request().Context(), user(c), c.Param("id"), in.text())
	if err != nil {
		return httpError(err, "Habit")
	}
	return c.JSON(http.StatusOK, h)
}

func (s *Service) deleteHabit(c *echo.Context) error {
	if err := s.store.DeleteHabit(c.Request().Context(), user(c), c.Param("id")); err != nil {
		return httpError(err, "Habit")
	}
	return c.NoContent(http.StatusNoContent)
}

type orderIn struct {
	IDs []string `json:"ids"`
}

func (s *Service) orderHabits(c *echo.Context) error {
	var in orderIn
	if err := c.Bind(&in); err != nil || len(in.IDs) > MaxHabits {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	if err := s.store.ReorderHabits(c.Request().Context(), user(c), in.IDs); err != nil {
		return httpError(err, "Habit")
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Service) checkHabit(c *echo.Context) error {
	var in struct {
		Day  string `json:"day"`
		Done *bool  `json:"done"`
	}
	if err := c.Bind(&in); err != nil || in.Done == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	if err := s.store.CheckHabit(c.Request().Context(), user(c), c.Param("id"), in.Day, *in.Done); err != nil {
		return httpError(err, "Habit")
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Service) listGoals(c *echo.Context) error {
	goals, err := s.store.Goals(c.Request().Context(), user(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"goals": goals})
}

func (s *Service) addGoal(c *echo.Context) error {
	var in nameIn
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	g, err := s.store.AddGoal(c.Request().Context(), user(c), in.text())
	if err != nil {
		return httpError(err, "Goal")
	}
	return c.JSON(http.StatusCreated, g)
}

func (s *Service) renameGoal(c *echo.Context) error {
	var in nameIn
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	g, err := s.store.RenameGoal(c.Request().Context(), user(c), c.Param("id"), in.text())
	if err != nil {
		return httpError(err, "Goal")
	}
	return c.JSON(http.StatusOK, g)
}

func (s *Service) deleteGoal(c *echo.Context) error {
	if err := s.store.DeleteGoal(c.Request().Context(), user(c), c.Param("id")); err != nil {
		return httpError(err, "Goal")
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Service) orderGoals(c *echo.Context) error {
	var in orderIn
	if err := c.Bind(&in); err != nil || len(in.IDs) > MaxGoals {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}
	if err := s.store.ReorderGoals(c.Request().Context(), user(c), in.IDs); err != nil {
		return httpError(err, "Goal")
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Service) progress(c *echo.Context) error {
	out, err := s.store.Progress(c.Request().Context(), s.decide, user(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, out)
}
