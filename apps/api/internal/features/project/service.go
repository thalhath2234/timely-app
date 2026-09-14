package project

import (
	"errors"
	"strings"
	"timely-api/internal/features/embed"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
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
	Create(userID string, project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error)
	GetAllProjectByUser(userID string) ([]models.Project, error)
	GetProjectById(userID, projectId string) (*models.Project, error)
	Update(userID string, projectID string, update ProjectUpdate) (*models.Project, error)
	Delete(userID, projectID string) error
	Duplicate(userID, projectID string) (*models.Project, error)
	SetTaskCopier(tasks TaskCopier)
	CreateStage(userID, projectID, name string, color string) (*models.Stage, error)
	UpdateStage(userID, projectID, stageID string, name, color *string) (*models.Stage, error)
	DeleteStage(userID, projectID, stageID string) error
	ReorderStages(userID, projectID string, ids []string) ([]models.Stage, error)
	ListActivity(userID, projectID string) ([]ProjectActivityEntry, error)
}

type workspaceOwner interface {
	GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error)
}

type TaskCopier interface {
	CopyProjectTasks(userID, fromProjectID, toProjectID string, stageMap map[string]string) error
}

type projectService struct {
	repo       ProjectRepository
	workspaces workspaceOwner
	indexer    embed.Indexer
	tasks      TaskCopier
}

func NewProjectService(repo ProjectRepository, workspaces workspaceOwner, indexer embed.Indexer) ProjectService {
	return &projectService{repo: repo, workspaces: workspaces, indexer: indexer}
}

func (s *projectService) SetTaskCopier(tasks TaskCopier) {
	s.tasks = tasks
}

func (s *projectService) Create(userID string, project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error) {
	if project.Title == "" {
		return nil, errors.New("project title cannot be empty")
	}
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if project.WorkspaceID == nil || *project.WorkspaceID == "" {
		return nil, errors.New("workspaceId is required")
	}
	if _, err := s.workspaces.GetWorkspaceById(userID, *project.WorkspaceID); err != nil {
		return nil, gorm.ErrRecordNotFound
	}
	if err := normalizeProjectPriority(project.PriorityLevel); err != nil {
		return nil, err
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

func (s *projectService) Duplicate(userID, projectID string) (*models.Project, error) {
	src, err := s.repo.GetProjectByIdForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	clone := &models.Project{
		Title:           "Copy of " + src.Title,
		Description:     src.Description,
		DescriptionRich: src.DescriptionRich,
		StatusID:        src.StatusID,
		Deadline:        src.Deadline,
		StartDate:       src.StartDate,
		PriorityLevel:   src.PriorityLevel,
		Color:           src.Color,
		DoesHaveStages:  src.DoesHaveStages,
		WorkspaceID:     src.WorkspaceID,
	}
	created, err := s.Create(userID, clone, nil)
	if err != nil {
		return nil, err
	}
	stageMap := map[string]string{}
	for _, stage := range src.Stages {
		if stage == nil {
			continue
		}
		copied, err := s.CreateStage(userID, created.ID, stage.Name, stage.Color)
		if err != nil {
			return nil, err
		}
		stageMap[stage.ID] = copied.ID
	}
	if s.tasks != nil {
		if err := s.tasks.CopyProjectTasks(userID, src.ID, created.ID, stageMap); err != nil {
			return nil, err
		}
	}
	return s.GetProjectById(userID, created.ID)
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

func (s *projectService) GetProjectById(userID, projectId string) (*models.Project, error) {
	if userID == "" || projectId == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return s.repo.GetProjectByIdForUser(userID, projectId)
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
	if update.PriorityLevel != nil && *update.PriorityLevel != "" {
		if err := normalizeProjectPriority(update.PriorityLevel); err != nil {
			return nil, err
		}
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

func (s *projectService) CreateStage(userID, projectID, name string, color string) (*models.Stage, error) {
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
	resolved := utils.NormalizeHexColor(color, utils.ColorForIndex(order))
	stage := &models.Stage{
		ID:        utils.NewStageID(),
		Name:      name,
		Order:     order,
		Color:     resolved,
		ProjectID: &projectID,
	}
	created, err := s.repo.CreateStage(stage)
	if err != nil {
		return nil, err
	}
	_, _ = s.repo.UpdateProject(userID, projectID, map[string]any{"does_have_stages": true})
	return created, nil
}

func (s *projectService) UpdateStage(userID, projectID, stageID string, name, color *string) (*models.Stage, error) {
	if _, err := s.repo.GetProjectByIdForUser(userID, projectID); err != nil {
		return nil, err
	}
	stage, err := s.repo.GetStageById(projectID, stageID)
	if err != nil {
		return nil, err
	}
	if name == nil && color == nil {
		return nil, errors.New("no stage fields to update")
	}
	if name != nil {
		next := strings.TrimSpace(*name)
		if next == "" {
			return nil, errors.New("stage name cannot be empty")
		}
		stage.Name = next
	}
	if color != nil {
		stage.Color = utils.NormalizeHexColor(*color, stage.Color)
	}
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

// ListActivity is the project's change feed: every recorded task activity for
// tasks in the project, newest first, plus a synthetic "created" entry so the
// feed always has a start. Project-level field edits are not yet journaled.
func (s *projectService) ListActivity(userID, projectID string) ([]ProjectActivityEntry, error) {
	project, err := s.repo.GetProjectByIdForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	entries, err := s.repo.ListTaskActivity(userID, projectID, 200)
	if err != nil {
		return nil, err
	}
	entries = append(entries, ProjectActivityEntry{
		ID:        "project-created:" + project.ID,
		TaskID:    "",
		TaskName:  project.Title,
		Action:    "project_created",
		Message:   "created this project",
		CreatedAt: project.CreatedAt,
	})
	return entries, nil
}

func (s *projectService) ReorderStages(userID, projectID string, ids []string) ([]models.Stage, error) {
	if _, err := s.repo.GetProjectByIdForUser(userID, projectID); err != nil {
		return nil, err
	}
	if err := s.repo.ReorderStages(projectID, ids); err != nil {
		return nil, err
	}
	project, err := s.repo.GetProjectByIdForUser(userID, projectID)
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

func normalizeProjectPriority(value *string) error {
	if value == nil || *value == "" {
		return nil
	}
	normalized := models.NormalizePriority(*value)
	if !models.ValidatePriority(normalized) || normalized == "" {
		return errors.New("invalid priority")
	}
	*value = normalized
	return nil
}
