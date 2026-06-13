package handlers

import (
	"net/http"
	"timely-api/internal/models"
	"timely-api/internal/services"
	"timely-api/internal/utils"

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

func (h *WorkspaceHandler) Create(c *echo.Context) error {
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

func (h *WorkspaceHandler) GetAllWorkspaceByUser(c *echo.Context) error {
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

func (h *WorkspaceHandler) GetWorkspaceById(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(
			http.StatusUnauthorized,
			"user not authenticated",
		)
	}

	workspaceID := c.Param("id")

	//check whether workspaceID is empty or not, if empty return bad request error

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

func (h *WorkspaceHandler) CreateLable(c *echo.Context) error {

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

func (h *WorkspaceHandler) CreateStatus(c *echo.Context) error {

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

func (h *WorkspaceHandler) CreateCustomField(c *echo.Context) error {

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

func (h *WorkspaceHandler) UpdateLable(c *echo.Context) error {
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

func (h *WorkspaceHandler) DeleteLable(c *echo.Context) error {
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

func (h *WorkspaceHandler) UpdateStatus(c *echo.Context) error {
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

func (h *WorkspaceHandler) DeleteStatus(c *echo.Context) error {
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

func (h *WorkspaceHandler) UpdateCustomField(c *echo.Context) error {
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

func (h *WorkspaceHandler) DeleteCustomField(c *echo.Context) error {
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
