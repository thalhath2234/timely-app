package services

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/repositories"

	"github.com/google/uuid"
)

type ProjectService interface {
	Create(project *models.Project) (*models.Project, error)
	GetAllProjectByUser(userID uuid.UUID) ([]models.Project, error)
	GetProjectById(userID uuid.UUID, projectId uuid.UUID) (*models.Project, error)
}

type projectService struct {
	repo repositories.ProjectRepository
}

func NewProjectService(repo repositories.ProjectRepository) ProjectService {
	return &projectService{repo: repo}
}

func (s *projectService) Create(project *models.Project) (*models.Project, error) {
	if project.Name == "" {
		return nil, errors.New("project name cannot be empty")
	}

	if project.UserID == nil {
		return nil, errors.New("user id is required")
	}

	err := s.repo.CreateProject(project)
	if err != nil {
		return nil, err
	}

	return project, nil
}

func (s *projectService) GetAllProjectByUser(userID uuid.UUID) ([]models.Project, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	projects, err := s.repo.GetAllProjectByUser(userID)
	if err != nil {
		return nil, err
	}

	return projects, nil
}

func (s *projectService) GetProjectById(userID uuid.UUID, projectId uuid.UUID) (*models.Project, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	project, err := s.repo.GetProjectById(userID, projectId)
	if err != nil {
		return nil, err
	}

	return project, nil
}
