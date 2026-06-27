package project

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

type ProjectService interface {
	Create(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error)
	GetAllProjectByUser(userID string) ([]models.Project, error)
	GetProjectById(projectId string) (*models.Project, error)
}

type projectService struct {
	repo ProjectRepository
}

func NewProjectService(repo ProjectRepository) ProjectService {
	return &projectService{repo: repo}
}

func (s *projectService) Create(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error) {
	if project.Title == "" {
		return nil, errors.New("project title cannot be empty")
	}

	for _, cfv := range customFieldValues {
		cfv.ID = utils.NewCustomFieldValueID()
	}

	project.ID = utils.NewProjectID()

	project, err := s.repo.CreateProject(project, customFieldValues)
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

func (s *projectService) GetProjectById(projectId string) (*models.Project, error) {

	project, err := s.repo.GetProjectById(projectId)
	if err != nil {
		return nil, err
	}

	return project, nil
}
