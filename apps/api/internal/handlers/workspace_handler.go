package handlers

import (
	"net/http"
	"timely-api/internal/models"
	"timely-api/internal/services"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
)

type WorkspaceHandler struct {
	workspaceService services.WorkspaceService
}

func NewWorkspaceHandler(workspaceService services.WorkspaceService) *WorkspaceHandler {
	return &WorkspaceHandler{
		workspaceService: workspaceService,
	}
}

type createWorkspaceRequest struct {
	Name string `json:"name"`
}

func (h *WorkspaceHandler) Create(c *echo.Context) error {
	var req createWorkspaceRequest

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	userID, ok := c.Get("userID").(uuid.UUID)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	workspace := &models.Workspace{
		Name:   req.Name,
		UserID: &userID,
	}

	createdWorkspace, err := h.workspaceService.Create(workspace)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"message": "workspace created successfully", "workspace": createdWorkspace})
}

func (h *WorkspaceHandler) GetAllWorkspaceByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(uuid.UUID)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	workspaces, err := h.workspaceService.GetAllWorkspaceByUser(userID)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, workspaces)
}

func (h *WorkspaceHandler) GetWorkspaceById(c *echo.Context) error {
	userID, ok := c.Get("userID").(uuid.UUID)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	workspaceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid workspace id",
		)
	}

	workspace, err := h.workspaceService.GetWorkspaceById(userID, workspaceID)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, workspace)
}
