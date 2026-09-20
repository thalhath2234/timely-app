package task

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
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
	Name            string         `json:"name"`
	Description     string         `json:"description"`
	DescriptionRich models.JSONMap `json:"descriptionRich"`
	Duration        int            `json:"duration"`
	Deadline        *string        `json:"deadline"`
	StartDate       *string        `json:"startDate"`
	ScheduledOn     *string        `json:"scheduledOn"`

	CustomFieldValues []customFieldValueRequest `json:"customFieldValues"`

	ProjectID     *string `json:"projectId"`
	StatusID      *string `json:"statusId"`
	PriorityLevel *string `json:"priorityLevel"`
	WorkspaceID   *string `json:"workspaceId"`
	StageID       *string `json:"stageId"`

	BlockedByID *string `json:"blockedById"`

	Kind string `json:"kind"`

	LabelIDs []models.LabelInput `json:"labelIds"`

	// Recurrence turns the task into a series (e.g. "haircut every 4 weeks").
	Recurrence *models.RecurrenceInput `json:"recurrence"`
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
	req.WorkspaceID = nonemptyID(req.WorkspaceID)
	kind := models.ResolveCreateKind(req.Kind, req.Duration, req.ScheduledOn, req.Recurrence != nil && req.Recurrence.RRule != "")
	if kind == models.KindTask && req.WorkspaceID == nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"workspaceId is required",
		)
	}
	if kind == models.KindReminder {
		req.ProjectID = nil
		req.StatusID = nil
		req.StageID = nil
		if len(req.LabelIDs) == 0 && len(req.CustomFieldValues) == 0 {
			req.WorkspaceID = nil
		}
	}

	customFieldValues := make([]*models.CustomFieldValue, 0, len(req.CustomFieldValues))
	for _, cfv := range req.CustomFieldValues {
		customFieldValues = append(customFieldValues, &models.CustomFieldValue{
			CustomFieldID: cfv.CustomFieldID,
			OptionsValue:  cfv.OptionsValue,
			Type:          cfv.Type,
			StringValue:   cfv.StringValue,
		})
	}

	task := &models.Task{
		Name:            req.Name,
		Description:     req.Description,
		DescriptionRich: req.DescriptionRich,
		Duration:        req.Duration,
		Deadline:        req.Deadline,
		StartDate:       req.StartDate,
		ScheduledOn:     req.ScheduledOn,
		UserID:          &userID,

		ProjectID:     nonemptyID(req.ProjectID),
		StatusID:      nonemptyID(req.StatusID),
		PriorityLevel: req.PriorityLevel,
		WorkspaceID:   req.WorkspaceID,
		StageID:       req.StageID,

		BlockedByID:  req.BlockedByID,
		Kind:         kind,
		LabelIDs:     models.LabelInputs(req.LabelIDs),
	}

	createdTask, err := h.taskService.Create(task, customFieldValues, req.Recurrence)
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"message": "task created successfully", "task": createdTask})
}

func (h *Handler) GetAllTaskByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	tasks, err := h.taskService.List(userID, parseTaskFilter(c))
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, tasks)
}

func (h *Handler) Delete(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if err := h.taskService.Delete(userID, c.Param("id")); err != nil {
		return taskError(err)
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "task deleted"})
}

type bulkUpdateRequest struct {
	IDs    []string          `json:"ids"`
	Update updateTaskRequest `json:"update"`
}

func (h *Handler) BulkUpdate(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}
	var req bulkUpdateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	var raw map[string]json.RawMessage
	_ = json.Unmarshal(body, &raw)
	var updateKeys map[string]json.RawMessage
	if updateRaw, ok := raw["update"]; ok {
		_ = json.Unmarshal(updateRaw, &updateKeys)
	}

	var labelIDs *models.LabelInputs
	if labelRaw, ok := updateKeys["labelIds"]; ok {
		if string(labelRaw) == "null" {
			empty := models.LabelInputs{}
			labelIDs = &empty
		} else {
			parsed := models.LabelInputs{}
			if err := json.Unmarshal(labelRaw, &parsed); err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "invalid labelIds")
			}
			if parsed == nil {
				parsed = models.LabelInputs{}
			}
			labelIDs = &parsed
		}
	}

	update := TaskUpdate{
		Name:            req.Update.Name,
		Description:     req.Update.Description,
		DescriptionRich: req.Update.DescriptionRich,
		Duration:        req.Update.Duration,
		Deadline:        req.Update.Deadline,
		StartDate:       req.Update.StartDate,
		ScheduledOn:     req.Update.ScheduledOn,
		CompletedAt:     req.Update.CompletedAt,
		ProjectID:       req.Update.ProjectID,
		StatusID:        req.Update.StatusID,
		PriorityLevel:   req.Update.PriorityLevel,
		StageID:         req.Update.StageID,
		BlockedByID:     req.Update.BlockedByID,
		Kind:            req.Update.Kind,
		LabelIDs:        labelIDs,
	}
	if _, ok := updateKeys["recurrence"]; ok {
		update.RecurrenceSet = true
		update.Recurrence = req.Update.Recurrence
	}
	tasks, err := h.taskService.BulkUpdate(userID, req.IDs, update)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"tasks": tasks})
}

func parseTaskFilter(c *echo.Context) TaskFilter {
	query := c.QueryParams()
	return TaskFilter{
		WorkspaceIDs:  query["workspaceId"],
		ProjectIDs:    query["projectId"],
		StatusIDs:     query["statusId"],
		LabelIDs:      query["labelId"],
		Priority:      c.QueryParam("priority"),
		StageID:       c.QueryParam("stageId"),
		Completed:     parseBoolQuery(c.QueryParam("completed")),
		Overdue:       parseBoolQuery(c.QueryParam("overdue")),
		DueBefore:     c.QueryParam("dueBefore"),
		DueAfter:      c.QueryParam("dueAfter"),
		Scheduled:     parseBoolQuery(c.QueryParam("scheduled")),
		HasRecurrence: parseBoolQuery(c.QueryParam("recurring")),
		Reminders:       parseBoolQuery(c.QueryParam("reminders")),
		Kind:            c.QueryParam("kind"),
		Inbox:           parseBoolQuery(c.QueryParam("inbox")),
		Text:            c.QueryParam("q"),
		Sort:          c.QueryParam("sort"),
		Limit:         parseIntQuery(c.QueryParam("limit")),
		Offset:        parseIntQuery(c.QueryParam("offset")),
	}
}

func nonemptyID(id *string) *string {
	if id == nil || strings.TrimSpace(*id) == "" {
		return nil
	}
	return id
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

func parseIntQuery(raw string) int {
	n, _ := strconv.Atoi(raw)
	return n
}

func (h *Handler) GetTaskById(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	taskId := c.Param("id")
	if taskId == "" {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid task id",
		)
	}

	task, err := h.taskService.GetForUser(userID, taskId)
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusOK, task)
}

type updateTaskRequest struct {
	Name              *string                   `json:"name"`
	Description       *string                   `json:"description"`
	DescriptionRich   *models.JSONMap           `json:"descriptionRich"`
	Duration          *int                      `json:"duration"`
	Deadline          *string                   `json:"deadline"`
	StartDate         *string                   `json:"startDate"`
	ScheduledOn       *string                   `json:"scheduledOn"`
	CompletedAt       *string                   `json:"completedAt"`
	WorkspaceID       *string                   `json:"workspaceId"`
	ProjectID         *string                   `json:"projectId"`
	StatusID          *string                   `json:"statusId"`
	PriorityLevel     *string                   `json:"priorityLevel"`
	StageID           *string                   `json:"stageId"`
	BlockedByID       *string                   `json:"blockedById"`
	Kind              *string                   `json:"kind"`
	TodayFocusOn      *string                   `json:"todayFocusOn"`
	MinChunkMinutes       *int                      `json:"minChunkMinutes"`
	PreferredChunkMinutes *int                      `json:"preferredChunkMinutes"`
	Contiguous            *bool                     `json:"contiguous"`
	EarliestStartAt       *string                   `json:"earliestStartAt"`
	PreferredWindows      *models.PreferredWindows  `json:"preferredWindows"`
	ScheduleLocked        *bool                     `json:"scheduleLocked"`
	LabelIDs          *models.LabelInputs       `json:"labelIds"`
	CustomFieldValues []customFieldValueRequest `json:"customFieldValues"`
	Recurrence        *models.RecurrenceInput   `json:"recurrence"`
}

func (h *Handler) Update(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	taskID := c.Param("id")
	if taskID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid task id")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	var req updateTaskRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	// Detect whether labelIds was present (including [] / null).
	var rawKeys map[string]json.RawMessage
	_ = json.Unmarshal(body, &rawKeys)

	var labelIDs *models.LabelInputs
	if labelRaw, ok := rawKeys["labelIds"]; ok {
		if string(labelRaw) == "null" {
			empty := models.LabelInputs{}
			labelIDs = &empty
		} else {
			parsed := models.LabelInputs{}
			if err := json.Unmarshal(labelRaw, &parsed); err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "invalid labelIds")
			}
			if parsed == nil {
				parsed = models.LabelInputs{}
			}
			labelIDs = &parsed
		}
	}

	// Absent means "leave untouched"; present replaces the listed fields.
	var customFieldValues *[]*models.CustomFieldValue
	if _, ok := rawKeys["customFieldValues"]; ok {
		values := make([]*models.CustomFieldValue, 0, len(req.CustomFieldValues))
		for _, cfv := range req.CustomFieldValues {
			values = append(values, &models.CustomFieldValue{
				CustomFieldID: cfv.CustomFieldID,
				OptionsValue:  cfv.OptionsValue,
				Type:          cfv.Type,
				StringValue:   cfv.StringValue,
			})
		}
		customFieldValues = &values
	}

	_, recurrenceSet := rawKeys["recurrence"]

	task, err := h.taskService.Update(userID, taskID, TaskUpdate{
		Name:              req.Name,
		Description:       req.Description,
		DescriptionRich:   req.DescriptionRich,
		Duration:          req.Duration,
		Deadline:          req.Deadline,
		StartDate:         req.StartDate,
		ScheduledOn:       req.ScheduledOn,
		CompletedAt:       req.CompletedAt,
		WorkspaceID:       req.WorkspaceID,
		ProjectID:         req.ProjectID,
		StatusID:          req.StatusID,
		PriorityLevel:     req.PriorityLevel,
		StageID:           req.StageID,
		BlockedByID:       req.BlockedByID,
		Kind:              req.Kind,
		TodayFocusOn:      req.TodayFocusOn,
		MinChunkMinutes:       req.MinChunkMinutes,
		PreferredChunkMinutes: req.PreferredChunkMinutes,
		Contiguous:            req.Contiguous,
		EarliestStartAt:       req.EarliestStartAt,
		PreferredWindows:      req.PreferredWindows,
		ScheduleLocked:        req.ScheduleLocked,
		LabelIDs:          labelIDs,
		CustomFieldValues: customFieldValues,
		RecurrenceSet:     recurrenceSet,
		Recurrence:        req.Recurrence,
	})
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message": "task updated successfully",
		"task":    task,
	})
}

type occurrenceRequest struct {
	OriginalStart string  `json:"originalStart"`
	Action        string  `json:"action"`
	NewStart      *string `json:"newStart"`
	NewEnd        *string `json:"newEnd"`
}

// EditOccurrence completes, skips, restores or moves one instance of a
// recurring task. The series itself is untouched.
func (h *Handler) EditOccurrence(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req occurrenceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	task, err := h.taskService.EditOccurrence(userID, c.Param("id"), OccurrenceAction{
		OriginalStart: req.OriginalStart,
		Action:        req.Action,
		NewStart:      req.NewStart,
		NewEnd:        req.NewEnd,
	})
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message": "occurrence updated",
		"task":    task,
	})
}

type splitRequest struct {
	FromStart  string                 `json:"fromStart"`
	Recurrence models.RecurrenceInput `json:"recurrence"`
	Name       *string                `json:"name"`
	Duration   *int                   `json:"duration"`
}

// Split applies a "this and future" edit: the series ends before fromStart and
// a new task continues from there with the given recurrence.
func (h *Handler) Split(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req splitRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	task, err := h.taskService.Split(userID, c.Param("id"), SplitInput{
		FromStart:  req.FromStart,
		Recurrence: req.Recurrence,
		Name:       req.Name,
		Duration:   req.Duration,
	})
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"message": "series split",
		"task":    task,
	})
}

func taskError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}

func (h *Handler) ListActivity(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	entries, err := h.taskService.ListActivity(userID, c.Param("id"))
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusOK, entries)
}

type commentRequest struct {
	Comment string `json:"comment"`
}

func (h *Handler) AddComment(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req commentRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	entry, err := h.taskService.AddComment(userID, c.Param("id"), req.Comment)
	if err != nil {
		return taskError(err)
	}

	return c.JSON(http.StatusCreated, entry)
}
