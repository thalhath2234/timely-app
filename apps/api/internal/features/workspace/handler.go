package workspace

import (
	"net/http"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/labstack/echo/v5"
)

type Handler struct {
	workspaceService WorkspaceService
}

func NewHandler(workspaceService WorkspaceService) *Handler {
	return &Handler{
		workspaceService: workspaceService,
	}
}

type createWorkspaceRequest struct {
	Name string `json:"name"`
}

type createStatusRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type createLableRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type createOptionRequest struct {
	Value string `json:"value"`
	Color string `json:"color"`
}

type createCustomFieldRequest struct {
	Name    string                 `json:"name"`
	Type    models.CustomFieldType `json:"type"`
	Options []createOptionRequest  `json:"options,omitempty"`
}

func (h *Handler) Create(c *echo.Context) error {
	var req createWorkspaceRequest

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	userID, ok := c.Get("userID").(string)
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

func (h *Handler) GetAllWorkspaceByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
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

func (h *Handler) GetWorkspaceById(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	workspaceID := c.Param("id")

	if workspaceID == "" {
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

func (h *Handler) Update(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	workspaceID := c.Param("id")
	if workspaceID == "" {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid workspace id",
		)
	}

	var req createWorkspaceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	workspace, err := h.workspaceService.UpdateWorkspace(userID, workspaceID, req.Name)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, workspace)
}

func (h *Handler) Delete(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if err := h.workspaceService.Delete(userID, c.Param("id")); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "workspace deleted"})
}

func (h *Handler) CreateLable(c *echo.Context) error {
	workspaceID := c.Param("id")

	var req createLableRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	lable := &models.Lable{
		Name:        req.Name,
		Color:       req.Color,
		WorkspaceID: workspaceID,
	}

	createdLable, err := h.workspaceService.CreateLables(lable)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusCreated, createdLable)
}

func (h *Handler) CreateStatus(c *echo.Context) error {
	workspaceID := c.Param("id")

	var req createStatusRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	status := &models.Status{
		Name:        req.Name,
		Color:       req.Color,
		WorkspaceID: workspaceID,
	}

	createdStatus, err := h.workspaceService.CreateStatuses(status)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusCreated, createdStatus)
}

func (h *Handler) CreateCustomField(c *echo.Context) error {
	workspaceID := c.Param("id")

	options := models.Options{
		Options: []models.Option{},
	}

	var req createCustomFieldRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	for _, option := range req.Options {
		options.Options = append(
			options.Options,
			models.Option{
				ID:    utils.NewOptionID(),
				Value: option.Value,
				Color: option.Color,
			},
		)
	}

	customField := &models.CustomField{
		Name:        req.Name,
		Type:        req.Type,
		WorkspaceID: workspaceID,
		Options:     options,
	}

	createdCustomField, err := h.workspaceService.CreateCustomFields(customField)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusCreated, createdCustomField)
}

func (h *Handler) UpdateLable(c *echo.Context) error {
	workspaceID := c.Param("workspaceId")
	lableID := c.Param("lableId")

	var req createLableRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	lable := &models.Lable{
		ID:          lableID,
		Name:        req.Name,
		Color:       req.Color,
		WorkspaceID: workspaceID,
	}

	updatedLable, err := h.workspaceService.UpdateLables(lable)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, updatedLable)
}

func (h *Handler) DeleteLable(c *echo.Context) error {
	workspaceID := c.Param("workspaceId")
	lableID := c.Param("lableId")

	if err := h.workspaceService.DeleteLables(lableID, workspaceID); err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) UpdateStatus(c *echo.Context) error {
	workspaceID := c.Param("workspaceId")
	statusID := c.Param("statusId")

	var req createStatusRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	status := &models.Status{
		ID:          statusID,
		Name:        req.Name,
		Color:       req.Color,
		WorkspaceID: workspaceID,
	}

	updatedStatus, err := h.workspaceService.UpdateStatuses(status)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, updatedStatus)
}

func (h *Handler) DeleteStatus(c *echo.Context) error {
	workspaceID := c.Param("workspaceId")
	statusID := c.Param("statusId")

	if err := h.workspaceService.DeleteStatuses(statusID, workspaceID); err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) UpdateCustomField(c *echo.Context) error {
	workspaceID := c.Param("workspaceId")
	customFieldID := c.Param("customFieldId")

	var req createCustomFieldRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	options := models.Options{Options: []models.Option{}}
	for _, option := range req.Options {
		options.Options = append(options.Options, models.Option{
			ID:    utils.NewOptionID(),
			Value: option.Value,
			Color: option.Color,
		})
	}

	customField := &models.CustomField{
		ID:          customFieldID,
		Name:        req.Name,
		Type:        req.Type,
		WorkspaceID: workspaceID,
		Options:     options,
	}

	updatedCustomField, err := h.workspaceService.UpdateCustomFields(customField)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, updatedCustomField)
}

func (h *Handler) DeleteCustomField(c *echo.Context) error {
	workspaceID := c.Param("workspaceId")
	customFieldID := c.Param("customFieldId")

	if err := h.workspaceService.DeleteCustomFields(customFieldID, workspaceID); err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) GetConfig(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	config, err := h.workspaceService.GetConfig(userID)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusInternalServerError,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, config)
}

func (h *Handler) UpdateConfig(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	var req struct {
		IsOnBoardingCompleted bool             `json:"isOnboardingCompleted"`
		TaskViews             models.TaskViews `json:"taskViews"`
		ActiveTaskViewId      string           `json:"activeTaskViewId"`
	}

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			"invalid request payload",
		)
	}

	config := &models.Config{
		UserID:                userID,
		IsOnBoardingCompleted: req.IsOnBoardingCompleted,
		TaskViews:             req.TaskViews,
		ActiveTaskViewId:      req.ActiveTaskViewId,
	}

	updatedConfig, err := h.workspaceService.UpdateConfig(config)
	if err != nil {
		return echo.NewHTTPError(
			http.StatusBadRequest,
			err.Error(),
		)
	}

	return c.JSON(http.StatusOK, updatedConfig)
}
