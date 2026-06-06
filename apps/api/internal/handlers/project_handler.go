package handlers

import (
	"log"
	"net/http"
	"timely-api/internal/models"
	"timely-api/internal/services"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
)

type ProjectHandler struct {
	projectService services.ProjectService
}

func NewProjectHandler(projectService services.ProjectService) *ProjectHandler {
	return &ProjectHandler{
		projectService: projectService,
	}
}

type createProjectRequest struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	WorkspaceID *uuid.UUID `json:"workspace_id"`
}

func (h *ProjectHandler) Create(c *echo.Context) error {
	var req createProjectRequest

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

	project := &models.Project{
		Name:        req.Name,
		Description: req.Description,

		UserID:      &userID,
		WorkspaceID: req.WorkspaceID,
	}

	createdProject, err := h.projectService.Create(project)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	log.Println("createdProject", createdProject)

	return c.JSON(http.StatusCreated, map[string]interface{}{"message": "project created successfully", "project": createdProject})
}

func (h *ProjectHandler) GetAllProjectByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(uuid.UUID)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	projects, err := h.projectService.GetAllProjectByUser(userID)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, projects)
}

func (h *ProjectHandler) GetProjectById(c *echo.Context) error {
	userID, ok := c.Get("userID").(uuid.UUID)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	projectId, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid project id",
		)
	}

	project, err := h.projectService.GetProjectById(userID, projectId)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, project)
}
