package task

import (
	"net/http"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
)

type Handler struct {
	taskService TaskService
}

func NewHandler(taskService TaskService) *Handler {
	return &Handler{
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

	LabelIDs []models.LabelInput `json:"labelIds"`
}

func (h *Handler) Create(c *echo.Context) error {
	userID := c.Get("userID").(string)

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
		UserID:      &userID,

		ProjectID:     req.ProjectID,
		StatusID:      req.StatusID,
		PriorityLevel: req.PriorityLevel,
		WorkspaceID:   req.WorkspaceID,
		ScheduleID:    req.ScheduleID,
		StageID:       req.StageID,

		BlockedByID: req.BlockedByID,
		LabelIDs:    models.LabelInputs(req.LabelIDs),
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

func (h *Handler) GetAllTaskByUser(c *echo.Context) error {
	tasks, err := h.taskService.GetAllTaskByUser(c.Get("userID").(string))
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, tasks)
}

func (h *Handler) GetTaskById(c *echo.Context) error {

	taskId := c.Param("id")
	if taskId == "" {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid task id",
		)
	}

	task, err := h.taskService.GetTaskById(taskId)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, task)
}
