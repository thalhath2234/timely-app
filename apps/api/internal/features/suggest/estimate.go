package suggest

import (
	"context"
	"strings"

	"github.com/labstack/echo/v5"
)

// EstimateSuggestion is the work length the New Work form offers for a title.
type EstimateSuggestion struct {
	Available bool `json:"available"`
	Minutes   int  `json:"minutes,omitempty"`
}

type estimateBody struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// estimateForm answers POST /suggestions/estimate: the length smart
// suggestions would give new Work with this title, offered (never set) in the
// create forms. Nothing is returned while suggestions are off or unsure.
func (s *Service) estimateForm(c *echo.Context) error {
	var body estimateBody
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(400, "invalid body")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), estimateBudget)
	defer cancel()
	userID := user(c)
	on, _ := s.decide.Status(ctx, userID)
	out := EstimateSuggestion{Available: on}
	if !on || len([]rune(strings.TrimSpace(body.Name))) < 3 {
		return c.JSON(200, out)
	}
	if minutes, ok := s.estimate(ctx, userID, body.Name, body.Description); ok {
		out.Minutes = minutes
	}
	return c.JSON(200, out)
}
