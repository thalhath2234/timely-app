package project

import (
	"errors"
	"strings"
	"timely-api/internal/features/embed"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

const (
	maxTitleLength       = 200
	maxDescriptionLength = 100000
)

// ProjectUpdate carries only the fields a client is allowed to change. Nil
// means "leave untouched", so autosave can send partial payloads. For the
// nullable columns an empty string clears the value.
type ProjectUpdate struct {
	Title           *string
	Description     *string
	DescriptionRich *models.JSONMap
	StatusID        *string
	Deadline        *string
	StartDate       *string
	CompletedAt     *string
	PriorityLevel   *string
	Color           *string
	DoesHaveStages  *bool
}

type ProjectService interface {
	Create(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error)
	GetAllProjectByUser(userID string) ([]models.Project, error)
	GetProjectById(projectId string) (*models.Project, error)
	Update(userID string, projectID string, update ProjectUpdate) (*models.Project, error)
	Delete(userID, projectID string) error
	CreateStage(userID, projectID, name string) (*models.Stage, error)
	UpdateStage(userID, projectID, stageID, name string) (*models.Stage, error)
	DeleteStage(userID, projectID, stageID string) error
	ReorderStages(userID, projectID string, ids []string) ([]models.Stage, error)
}

type projectService struct {
	repo    ProjectRepository
	indexer embed.Indexer
}

func NewProjectService(repo ProjectRepository, indexer embed.Indexer) ProjectService {
	return &projectService{repo: repo, indexer: indexer}
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
	s.indexProject(project)
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

func (s *projectService) Update(userID string, projectID string, update ProjectUpdate) (*models.Project, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if projectID == "" {
		return nil, errors.New("invalid project id")
	}

	updates := map[string]any{}

	if update.Title != nil {
		title := strings.TrimSpace(*update.Title)
		if title == "" {
			return nil, errors.New("project title cannot be empty")
		}
		if len(title) > maxTitleLength {
			title = title[:maxTitleLength]
		}
		updates["title"] = title
	}
	if update.Description != nil {
		text := *update.Description
		if len(text) > maxDescriptionLength {
			text = text[:maxDescriptionLength]
		}
		updates["description"] = text
	}
	if update.DescriptionRich != nil {
		rich := models.NormalizeDocumentContent(*update.DescriptionRich)
		if update.Description != nil && strings.TrimSpace(*update.Description) != "" && models.IsDocumentContentEmpty(rich) {
			rich = models.DocumentFromPlainText(*update.Description)
		}
		updates["description_rich"] = rich
	}
	if update.DoesHaveStages != nil {
		updates["does_have_stages"] = *update.DoesHaveStages
	}

	nullableColumns := map[string]*string{
		"status_id":      update.StatusID,
		"deadline":       update.Deadline,
		"start_date":     update.StartDate,
		"completed_at":   update.CompletedAt,
		"priority_level": update.PriorityLevel,
		"color":          update.Color,
	}
	for column, value := range nullableColumns {
		if value == nil {
			continue
		}
		if *value == "" {
			updates[column] = nil
		} else {
			updates[column] = *value
		}
	}

	if len(updates) > 0 {
		updates["updated_at"] = utils.GetCurrentTime()
	}

	project, err := s.repo.UpdateProject(userID, projectID, updates)
	if err != nil {
		return nil, err
	}
	s.indexProject(project)
	return project, nil
}

func (s *projectService) Delete(userID, projectID string) error {
	if userID == "" || projectID == "" {
		return errors.New("invalid request")
	}
	if err := s.repo.DeleteProject(userID, projectID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.Delete(userID, embed.KindProject, projectID)
	}
	return nil
}

func (s *projectService) CreateStage(userID, projectID, name string) (*models.Stage, error) {
	if _, err := s.repo.GetProjectByIdForUser(userID, projectID); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("stage name cannot be empty")
	}
	order, err := s.repo.NextStageOrder(projectID)
	if err != nil {
		return nil, err
	}
	stage := &models.Stage{
		ID:        utils.NewStageID(),
		Name:      name,
		Order:     order,
		ProjectID: &projectID,
	}
	created, err := s.repo.CreateStage(stage)
	if err != nil {
		return nil, err
	}
	_, _ = s.repo.UpdateProject(userID, projectID, map[string]any{"does_have_stages": true})
	return created, nil
}

func (s *projectService) UpdateStage(userID, projectID, stageID, name string) (*models.Stage, error) {
	if _, err := s.repo.GetProjectByIdForUser(userID, projectID); err != nil {
		return nil, err
	}
	stage, err := s.repo.GetStageById(projectID, stageID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("stage name cannot be empty")
	}
	stage.Name = name
	stage.UpdatedAt = utils.GetCurrentTime()
	return s.repo.UpdateStage(stage)
}

func (s *projectService) DeleteStage(userID, projectID, stageID string) error {
	if _, err := s.repo.GetProjectByIdForUser(userID, projectID); err != nil {
		return err
	}
	if _, err := s.repo.GetStageById(projectID, stageID); err != nil {
		return err
	}
	return s.repo.DeleteStage(projectID, stageID)
}

func (s *projectService) ReorderStages(userID, projectID string, ids []string) ([]models.Stage, error) {
	if _, err := s.repo.GetProjectByIdForUser(userID, projectID); err != nil {
		return nil, err
	}
	if err := s.repo.ReorderStages(projectID, ids); err != nil {
		return nil, err
	}
	project, err := s.repo.GetProjectById(projectID)
	if err != nil {
		return nil, err
	}
	stages := make([]models.Stage, 0, len(project.Stages))
	for _, stage := range project.Stages {
		if stage != nil {
			stages = append(stages, *stage)
		}
	}
	return stages, nil
}

func (s *projectService) indexProject(project *models.Project) {
	if s.indexer != nil {
		s.indexer.IndexProject(project)
	}
}
