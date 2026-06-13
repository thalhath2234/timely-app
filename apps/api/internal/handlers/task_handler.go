package handlers

import (
	"net/http"
	"timely-api/internal/models"
	"timely-api/internal/services"

	"github.com/labstack/echo/v5"
)

type TaskHandler struct {
	taskService services.TaskService
}

func NewTaskHandler(taskService services.TaskService) *TaskHandler {
	return &TaskHandler{
		taskService: taskService,
	}
}

type customFieldValueRequest struct {
	CustomFieldID string                         `json:"id"`
	OptionsValue  []models.CustomFieldValueInput `json:"optionsValue"`
	Type          string                         `json:"type"`
	StringValue   *string                        `json:"stringValue,omitempty"`
}

type createTaskRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Duration    int     `json:"duration"`
	Deadline    *string `json:"deadline"`
	StartDate   *string `json:"startDate"`
	TimeChunks  int     `json:"timeChunks"`

	CustomFieldValues []customFieldValueRequest `json:"customFieldValues"`

	ProjectID     *string `json:"projectId"`
	StatusID      *string `json:"statusId"`
	PriorityLevel *string `json:"priorityLevel"`
	WorkspaceID   *string `json:"workspaceId"`
	ScheduleID    *string `json:"scheduleId"`
	StageID       *string `json:"stageId"`

	BlockedByID *string `json:"blockedById"`
	BlockingID  *string `json:"blockingId"`

	LabelIDs []string `json:"labelIds"`
}

func (h *TaskHandler) Create(c *echo.Context) error {
	var req createTaskRequest

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

	customFieldValues := make([]*models.CustomFieldValue, len(req.CustomFieldValues))
	for i, cfv := range req.CustomFieldValues {
		customFieldValues[i] = &models.CustomFieldValue{
			CustomFieldID: cfv.CustomFieldID,
			OptionsValue:  cfv.OptionsValue,
			Type:          cfv.Type,
			StringValue:   cfv.StringValue,
		}
	}

	task := &models.Task{
		Name:        req.Name,
		Description: req.Description,
		Duration:    req.Duration,
		TimeChunks:  req.TimeChunks,
		Deadline:    req.Deadline,
		StartDate:   req.StartDate,

		ProjectID:     req.ProjectID,
		StatusID:      req.StatusID,
		PriorityLevel: req.PriorityLevel,
		WorkspaceID:   req.WorkspaceID,
		ScheduleID:    req.ScheduleID,
		StageID:       req.StageID,

		BlockedByID: req.BlockedByID,
	}

	createdTask, err := h.taskService.Create(task, customFieldValues)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"message": "task created successfully", "task": createdTask})
}

func (h *TaskHandler) GetAllTaskByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	tasks, err := h.taskService.GetAllTaskByUser(userID)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, tasks)
}

func (h *TaskHandler) GetTaskById(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	taskId := c.Param("id")
	if taskId == "" {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid task id",
		)
	}

	task, err := h.taskService.GetTaskById(userID, taskId)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, task)
}
