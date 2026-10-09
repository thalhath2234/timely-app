package search

import (
	"errors"
	"net/http"
	"strings"
	"timely-api/internal/features/embed"

	"github.com/labstack/echo/v5"
)

type Handler struct {
	service Service
	smart   *Smart
}

// SetSmart turns on GET /search/smart and /search/related.
func (h *Handler) SetSmart(smart *Smart) { h.smart = smart }

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Search(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	query := c.QueryParam("q")
	// mode=semantic (or hybrid) fuses keyword and vector hits and never 503s:
	// without an embedding provider it returns keyword-only results.
	mode := c.QueryParam("mode")
	if strings.EqualFold(mode, "semantic") || strings.EqualFold(mode, "hybrid") {
		kinds := splitKinds(c.QueryParam("kinds"))
		hits, err := h.service.SemanticSearch(c.Request().Context(), userID, query, 20, kinds)
		if err != nil {
			return searchError(err)
		}
		return c.JSON(http.StatusOK, hits)
	}

	hits, err := h.service.Search(userID, query, 20)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, hits)
}

// Smart answers what Jev makes of a search: a new order, clear misses, the
// likely kind and a create command. Clients show plain results first and
// apply this when it arrives; an empty answer changes nothing.
func (h *Handler) Smart(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if h.smart == nil {
		return c.JSON(http.StatusOK, SmartResult{})
	}
	out, err := h.smart.Search(c.Request().Context(), userID, c.QueryParam("q"), splitKinds(c.QueryParam("kinds")))
	if err != nil {
		return searchError(err)
	}
	return c.JSON(http.StatusOK, out)
}

// Related lists items closely related to one task, project, doc or sheet.
func (h *Handler) Related(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if h.smart == nil {
		return c.JSON(http.StatusOK, []RelatedItem{})
	}
	items, err := h.smart.Related(c.Request().Context(), userID, c.QueryParam("kind"), c.QueryParam("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, items)
}

func (h *Handler) Reindex(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	n, err := h.service.Reindex(c.Request().Context(), userID)
	if err != nil {
		return searchError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"indexed": n})
}

func splitKinds(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func searchError(err error) error {
	if errors.Is(err, embed.ErrDisabled) {
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	}
	if errors.Is(err, embed.ErrEmptyQuery) {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}
