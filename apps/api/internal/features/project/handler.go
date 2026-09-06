package project

import (
	"errors"
	"log"
	"net/http"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
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
	DescriptionRich   models.JSONMap            `json:"descriptionRich"`
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
		Title:           req.Title,
		Description:     req.Description,
		DescriptionRich: req.DescriptionRich,
		WorkspaceID:     req.WorkspaceID,
		StatusID:        req.StatusID,
		Deadline:        req.Deadline,
		StartDate:       req.StartDate,
		PriorityLevel:   req.PriorityLevel,
		Color:           req.Color,
		DoesHaveStages:  req.DoesHaveStages,
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

type updateProjectRequest struct {
	Title           *string         `json:"title"`
	Description     *string         `json:"description"`
	DescriptionRich *models.JSONMap `json:"descriptionRich"`
	StatusID        *string         `json:"statusId"`
	Deadline        *string         `json:"deadline"`
	StartDate       *string         `json:"startDate"`
	CompletedAt     *string         `json:"completedAt"`
	PriorityLevel   *string         `json:"priorityLevel"`
	Color           *string         `json:"color"`
	DoesHaveStages  *bool           `json:"doesHaveStages"`
}

func (h *Handler) Update(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	projectID := c.Param("id")
	if projectID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid project id")
	}

	var req updateProjectRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	project, err := h.projectService.Update(userID, projectID, ProjectUpdate{
		Title:           req.Title,
		Description:     req.Description,
		DescriptionRich: req.DescriptionRich,
		StatusID:        req.StatusID,
		Deadline:        req.Deadline,
		StartDate:       req.StartDate,
		CompletedAt:     req.CompletedAt,
		PriorityLevel:   req.PriorityLevel,
		Color:           req.Color,
		DoesHaveStages:  req.DoesHaveStages,
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "project not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message": "project updated successfully",
		"project": project,
	})
}

func (h *Handler) Delete(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if err := h.projectService.Delete(userID, c.Param("id")); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "project not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "project deleted"})
}

type stageRequest struct {
	Name string `json:"name"`
}

func (h *Handler) CreateStage(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req stageRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	stage, err := h.projectService.CreateStage(userID, c.Param("id"), req.Name)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "project not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusCreated, stage)
}

func (h *Handler) UpdateStage(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req stageRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	stage, err := h.projectService.UpdateStage(userID, c.Param("id"), c.Param("stageId"), req.Name)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, stage)
}

func (h *Handler) DeleteStage(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if err := h.projectService.DeleteStage(userID, c.Param("id"), c.Param("stageId")); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "stage deleted"})
}

type reorderStagesRequest struct {
	IDs []string `json:"ids"`
}

func (h *Handler) ReorderStages(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req reorderStagesRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	stages, err := h.projectService.ReorderStages(userID, c.Param("id"), req.IDs)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "project not found")
		}
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, stages)
}
