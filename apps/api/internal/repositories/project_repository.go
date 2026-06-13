package repositories

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type ProjectRepository interface {
	CreateProject(project *models.Project) error
	GetAllProjectByUser(user_id string) ([]models.Project, error)
	GetProjectById(userID string, projectId string) (*models.Project, error)
	GetStageById(projectID string, stageID string) (*models.Stage, error)
}

type projectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) ProjectRepository {
	return &projectRepository{db: db}
}

func (r *projectRepository) CreateProject(project *models.Project) error {

	return r.db.Create(project).Error
}

func (r *projectRepository) GetAllProjectByUser(userID string) ([]models.Project, error) {
	var projects []models.Project

	err := r.db.
		Where("user_id = ?", userID).
		Preload("Stages").
		Preload("Tasks").
		Preload("Workspace").
		Find(&projects).Error

	if err != nil {
		return nil, err
	}

	return projects, nil
}

func (r *projectRepository) GetProjectById(userID string, projectId string) (*models.Project, error) {
	var project models.Project

	err := r.db.
		Where("user_id = ?", userID).
		Where("id = ?", projectId).
		Preload("Stages").
		Preload("Stages.Tasks").
		Preload("Tasks", "stage_id IS NULL").
		Preload("Workspace").
		First(&project).Error
	if err != nil {
		return nil, err
	}

	return &project, nil
}

func (r *projectRepository) GetStageById(projectID string, stageID string) (*models.Stage, error) {
	var stage models.Stage

	err := r.db.
		Where("project_id = ?", projectID).
		Where("id = ?", stageID).
		First(&stage).Error
	if err != nil {
		return nil, err
	}
	return &stage, nil
}
