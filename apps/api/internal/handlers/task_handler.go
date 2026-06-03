package handlers

import (
	"net/http"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/services"

	"github.com/google/uuid"
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

type createTaskRequest struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Duration    int        `json:"duration"`
	Deadline    *time.Time `json:"deadline"`
	StartDate   *time.Time `json:"start_date"`
	TimeChunks  int        `json:"time_chunks"`

	ProjectID   *uuid.UUID `json:"project_id"`
	StatusID    *uuid.UUID `json:"status_id"`
	PriorityID  *uuid.UUID `json:"priority_id"`
	WorkspaceID *uuid.UUID `json:"workspace_id"`
	ScheduleID  *uuid.UUID `json:"schedule_id"`
	StageID     *uuid.UUID `json:"stage_id"`

	BlockedByID *uuid.UUID `json:"blocked_by_id"`
	BlockingID  *uuid.UUID `json:"blocking_id"`

	LabelIDs []uuid.UUID `json:"label_ids"`
}

func (h *TaskHandler) Create(c *echo.Context) error {
	var req createTaskRequest

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

	task := &models.Task{
		Name:        req.Name,
		Description: req.Description,
		Duration:    req.Duration,
		TimeChunks:  req.TimeChunks,

		UserId: &userID,

		ProjectID:   req.ProjectID,
		StatusID:    req.StatusID,
		PriorityID:  req.PriorityID,
		WorkspaceID: req.WorkspaceID,
		ScheduleID:  req.ScheduleID,
		StageID:     req.StageID,

		BlockedByID: req.BlockedByID,
		BlockingID:  req.BlockingID,
	}

	createdTask, err := h.taskService.Create(task)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"message": "task created successfully", "task": createdTask})
}

func (h *TaskHandler) GetAllTaskByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(uuid.UUID)
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
	userID, ok := c.Get("userID").(uuid.UUID)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	taskId, err := uuid.Parse(c.Param("id"))
	if err != nil {
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
