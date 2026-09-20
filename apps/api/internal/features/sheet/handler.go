package sheet

import (
	"errors"
	"net/http"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct {
	sheetService SheetService
}

func NewHandler(sheetService SheetService) *Handler {
	return &Handler{sheetService: sheetService}
}

type createSheetRequest struct {
	Title       string              `json:"title"`
	Icon        *string             `json:"icon"`
	Columns     models.SheetColumns `json:"columns"`
	Rows        models.SheetRows    `json:"rows"`
	Merges      models.SheetMerges  `json:"merges"`
	Tabs        models.SheetTabs    `json:"tabs"`
	WorkspaceID string              `json:"workspaceId"`
	ProjectID   *string             `json:"projectId"`
}

type updateSheetRequest struct {
	Title      *string              `json:"title"`
	Icon       *string              `json:"icon"`
	Columns    *models.SheetColumns `json:"columns"`
	Rows       *models.SheetRows    `json:"rows"`
	Merges     *models.SheetMerges  `json:"merges"`
	Tabs       *models.SheetTabs    `json:"tabs"`
	ProjectID  *string              `json:"projectId"`
	IsFavorite *bool                `json:"isFavorite"`
	Archived   *bool                `json:"archived"`
}

func (h *Handler) Create(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req createSheetRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	createdSheet, err := h.sheetService.Create(&models.Sheet{
		Title:       req.Title,
		Icon:        req.Icon,
		Columns:     req.Columns,
		Rows:        req.Rows,
		Merges:      req.Merges,
		Tabs:        req.Tabs,
		WorkspaceID: req.WorkspaceID,
		ProjectID:   req.ProjectID,
		UserID:      userID,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"message": "sheet created successfully",
		"sheet":   createdSheet,
	})
}

func (h *Handler) GetAllSheetsByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	sheets, err := h.sheetService.List(userID, SheetFilter{
		WorkspaceID: c.QueryParam("workspaceId"),
		ProjectID:   c.QueryParam("projectId"),
		Text:        c.QueryParam("q"),
		Archived:    parseBoolQuery(c.QueryParam("archived")),
		Favorite:    parseBoolQuery(c.QueryParam("favorite")),
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, sheets)
}

func (h *Handler) GetSheetById(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	foundSheet, err := h.sheetService.GetByID(userID, c.Param("id"))
	if err != nil {
		return sheetError(err)
	}

	return c.JSON(http.StatusOK, foundSheet)
}

func (h *Handler) Duplicate(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	duplicated, err := h.sheetService.Duplicate(userID, c.Param("id"))
	if err != nil {
		return sheetError(err)
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"message": "sheet duplicated",
		"sheet":   duplicated,
	})
}

func (h *Handler) Update(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req updateSheetRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	updatedSheet, err := h.sheetService.Update(userID, c.Param("id"), SheetUpdate{
		Title:      req.Title,
		Icon:       req.Icon,
		Columns:    req.Columns,
		Rows:       req.Rows,
		Merges:     req.Merges,
		Tabs:       req.Tabs,
		ProjectID:  req.ProjectID,
		IsFavorite: req.IsFavorite,
		Archived:   req.Archived,
	})
	if err != nil {
		return sheetError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message": "sheet updated successfully",
		"sheet":   updatedSheet,
	})
}

func (h *Handler) Delete(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	if err := h.sheetService.Delete(userID, c.Param("id")); err != nil {
		return sheetError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message": "sheet deleted successfully",
	})
}

func sheetError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "sheet not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}

func parseBoolQuery(raw string) *bool {
	switch raw {
	case "true", "1":
		v := true
		return &v
	case "false", "0":
		v := false
		return &v
	default:
		return nil
	}
}
