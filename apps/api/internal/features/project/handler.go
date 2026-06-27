package project

import (
	"log"
	"net/http"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
)

type Handler struct {
	projectService ProjectService
}

func NewHandler(projectService ProjectService) *Handler {
	return &Handler{
		projectService: projectService,
	}
}

type customFieldValueRequest struct {
	CustomFieldID string                         `json:"id"`
	OptionsValue  []models.CustomFieldValueInput `json:"optionsValue"`
	Type          string                         `json:"type"`
	StringValue   *string                        `json:"stringValue,omitempty"`
}

type createProjectRequest struct {
	Title             string                    `json:"title"`
	Description       string                    `json:"description"`
	WorkspaceID       *string                   `json:"workspaceId"`
	StatusID          *string                   `json:"statusId"`
	Deadline          *string                   `json:"deadline"`
	StartDate         *string                   `json:"startDate"`
	PriorityLevel     *string                   `json:"priorityLevel"`
	Color             *string                   `json:"color"`
	DoesHaveStages    bool                      `json:"doesHaveStages"`
	CustomFieldValues []customFieldValueRequest `json:"customFieldValues"`
}

func (h *Handler) Create(c *echo.Context) error {
	var req createProjectRequest

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	if req.WorkspaceID == nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"workspaceId is required",
		)
	}

	project := &models.Project{
		Title:          req.Title,
		Description:    req.Description,
		WorkspaceID:    req.WorkspaceID,
		StatusID:       req.StatusID,
		Deadline:       req.Deadline,
		StartDate:      req.StartDate,
		PriorityLevel:  req.PriorityLevel,
		Color:          req.Color,
		DoesHaveStages: req.DoesHaveStages,
	}

	customFieldValues := make([]*models.CustomFieldValue, len(req.CustomFieldValues))
	for i, cfv := range req.CustomFieldValues {
		customFieldValues[i] = &models.CustomFieldValue{
			CustomFieldID: cfv.CustomFieldID,
			OptionsValue:  cfv.OptionsValue,
			Type:          cfv.Type,
			StringValue:   cfv.StringValue,
		}
	}

	createdProject, err := h.projectService.Create(project, customFieldValues)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	log.Println("createdProject", createdProject)

	return c.JSON(http.StatusCreated, map[string]interface{}{"message": "project created successfully", "project": createdProject})
}

func (h *Handler) GetAllProjectByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
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

func (h *Handler) GetProjectById(c *echo.Context) error {

	projectId := c.Param("id")
	if projectId == "" {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid project id",
		)
	}

	project, err := h.projectService.GetProjectById(projectId)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, project)
}
