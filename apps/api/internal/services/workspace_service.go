package services

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/repositories"
	"timely-api/internal/utils"
)

type WorkspaceService interface {
	Create(workspace *models.Workspace) (*models.Workspace, error)
	GetAllWorkspaceByUser(userID string) ([]models.Workspace, error)
	GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error)
	CreateLables(lable *models.Lable) (*models.Lable, error)
	CreateStatuses(status *models.Status) (*models.Status, error)
	CreateCustomFields(customField *models.CustomField) (*models.CustomField, error)
	UpdateLables(lable *models.Lable) (*models.Lable, error)
	DeleteLables(lableID string, workspaceID string) error
	UpdateStatuses(status *models.Status) (*models.Status, error)
	DeleteStatuses(statusID string, workspaceID string) error
	UpdateCustomFields(customField *models.CustomField) (*models.CustomField, error)
	DeleteCustomFields(customFieldID string, workspaceID string) error
}

type workspaceService struct {
	repo repositories.WorkspaceRepository
}

func NewWorkspaceService(repo repositories.WorkspaceRepository) WorkspaceService {
	return &workspaceService{repo: repo}
}

func (s *workspaceService) Create(workspace *models.Workspace) (*models.Workspace, error) {
	if workspace.Name == "" {
		return nil, errors.New("workspace name cannot be empty")
	}

	if workspace.UserID == nil {
		return nil, errors.New("user id is required")
	}

	// Generate prefixed ID
	workspace.ID = utils.NewWorkspaceID()
	// Generate default statuses for the workspace
	defaultStatuses := []models.Status{
		{
			ID:          utils.NewStatusID(),
			Name:        "Backlog",
			Color:       "#889096",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Todo",
			Color:       "#889096",
			WorkspaceID: workspace.ID,
			IsDefault:   true,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "In Progress",
			Color:       "#FFB224",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Blocked",
			Color:       "#E5484D",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Completed",
			Color:       "#30A66D",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Canceled",
			Color:       "#E5484D",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
	}

	workspace.CreatedAt = utils.GetCurrentTime()
	workspace.UpdatedAt = utils.GetCurrentTime()

	err := s.repo.CreateWorkspace(workspace, defaultStatuses)
	if err != nil {
		return nil, err
	}

	return workspace, nil
}

func (s *workspaceService) GetAllWorkspaceByUser(userID string) ([]models.Workspace, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	workspaces, err := s.repo.GetAllWorkspaceByUser(userID)
	if err != nil {
		return nil, err
	}

	return workspaces, nil
}

func (s *workspaceService) GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	workspace, err := s.repo.GetWorkspaceById(userID, workspaceID)
	if err != nil {
		return nil, err
	}

	return workspace, nil
}

func (s *workspaceService) CreateLables(lable *models.Lable) (*models.Lable, error) {
	if lable == nil {
		return nil, errors.New("invalid lable data")
	}

	lable.ID = utils.NewLableID()

	lable.CreatedAt = utils.GetCurrentTime()
	lable.UpdatedAt = utils.GetCurrentTime()

	createdLable, err := s.repo.CreateLables(lable)
	if err != nil {
		return nil, err
	}

	return createdLable, nil
}

func (s *workspaceService) CreateStatuses(status *models.Status) (*models.Status, error) {

	if status == nil {
		return nil, errors.New("invalid status data")
	}

	status.ID = utils.NewStatusID()

	status.CreatedAt = utils.GetCurrentTime()
	status.UpdatedAt = utils.GetCurrentTime()

	createdStatus, err := s.repo.CreateStatuses(status)
	if err != nil {
		return nil, err
	}

	return createdStatus, nil
}

func (s *workspaceService) CreateCustomFields(customField *models.CustomField) (*models.CustomField, error) {
	customField.ID = utils.NewCustomFieldID()
	customField.CreatedAt = utils.GetCurrentTime()
	customField.UpdatedAt = utils.GetCurrentTime()

	createdCustomField, err := s.repo.CreateCustomFields(customField)
	if err != nil {
		return nil, err
	}

	return createdCustomField, nil
}

func (s *workspaceService) UpdateLables(lable *models.Lable) (*models.Lable, error) {
	if lable == nil || lable.ID == "" {
		return nil, errors.New("invalid lable data")
	}

	lable.UpdatedAt = utils.GetCurrentTime()

	updatedLable, err := s.repo.UpdateLables(lable)
	if err != nil {
		return nil, err
	}

	return updatedLable, nil
}

func (s *workspaceService) DeleteLables(lableID string, workspaceID string) error {
	if lableID == "" || workspaceID == "" {
		return errors.New("invalid lable id or workspace id")
	}

	return s.repo.DeleteLables(lableID, workspaceID)
}

func (s *workspaceService) UpdateStatuses(status *models.Status) (*models.Status, error) {
	if status == nil || status.ID == "" {
		return nil, errors.New("invalid status data")
	}

	status.UpdatedAt = utils.GetCurrentTime()

	updatedStatus, err := s.repo.UpdateStatuses(status)
	if err != nil {
		return nil, err
	}

	return updatedStatus, nil
}

func (s *workspaceService) DeleteStatuses(statusID string, workspaceID string) error {
	if statusID == "" || workspaceID == "" {
		return errors.New("invalid status id or workspace id")
	}

	return s.repo.DeleteStatuses(statusID, workspaceID)
}

func (s *workspaceService) UpdateCustomFields(customField *models.CustomField) (*models.CustomField, error) {
	if customField == nil || customField.ID == "" {
		return nil, errors.New("invalid custom field data")
	}

	customField.UpdatedAt = utils.GetCurrentTime()

	updatedCustomField, err := s.repo.UpdateCustomFields(customField)
	if err != nil {
		return nil, err
	}

	return updatedCustomField, nil
}

func (s *workspaceService) DeleteCustomFields(customFieldID string, workspaceID string) error {
	if customFieldID == "" || workspaceID == "" {
		return errors.New("invalid custom field id or workspace id")
	}

	return s.repo.DeleteCustomFields(customFieldID, workspaceID)
}
