package services

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/repositories"

	"github.com/google/uuid"
)

type WorkspaceService interface {
	Create(workspace *models.Workspace) (*models.Workspace, error)
	GetAllWorkspaceByUser(userID uuid.UUID) ([]models.Workspace, error)
	GetWorkspaceById(userID uuid.UUID, workspaceID uuid.UUID) (*models.Workspace, error)
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

	err := s.repo.CreateWorkspace(workspace)
	if err != nil {
		return nil, err
	}

	return workspace, nil
}

func (s *workspaceService) GetAllWorkspaceByUser(userID uuid.UUID) ([]models.Workspace, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	workspaces, err := s.repo.GetAllWorkspaceByUser(userID)
	if err != nil {
		return nil, err
	}

	return workspaces, nil
}

func (s *workspaceService) GetWorkspaceById(userID uuid.UUID, workspaceID uuid.UUID) (*models.Workspace, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	workspace, err := s.repo.GetWorkspaceById(userID, workspaceID)
	if err != nil {
		return nil, err
	}

	return workspace, nil
}
