package services

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/repositories"
	"timely-api/internal/utils"
)

type ProjectService interface {
	Create(project *models.Project) (*models.Project, error)
	GetAllProjectByUser(userID string) ([]models.Project, error)
	GetProjectById(userID string, projectId string) (*models.Project, error)
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

	// Generate prefixed ID
	project.ID = utils.NewProjectID()

	project.CreatedAt = utils.GetCurrentTime()
	project.UpdatedAt = utils.GetCurrentTime()

	err := s.repo.CreateProject(project)
	if err != nil {
		return nil, err
	}

	return project, nil
}

func (s *projectService) GetAllProjectByUser(userID string) ([]models.Project, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	projects, err := s.repo.GetAllProjectByUser(userID)
	if err != nil {
		return nil, err
	}

	return projects, nil
}

func (s *projectService) GetProjectById(userID string, projectId string) (*models.Project, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	project, err := s.repo.GetProjectById(userID, projectId)
	if err != nil {
		return nil, err
	}

	return project, nil
}
