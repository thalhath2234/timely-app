package repositories

import (
	"timely-api/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WorkspaceRepository interface {
	CreateWorkspace(workspace *models.Workspace) error
	GetAllWorkspaceByUser(userID uuid.UUID) ([]models.Workspace, error)
	GetWorkspaceById(userID uuid.UUID, workspaceID uuid.UUID) (*models.Workspace, error)
}

type workspaceRepository struct {
	db *gorm.DB
}

func NewWorkspaceRepository(db *gorm.DB) WorkspaceRepository {
	return &workspaceRepository{db: db}
}

func (r *workspaceRepository) CreateWorkspace(workspace *models.Workspace) error {
	return r.db.Create(workspace).Error
}

func (r *workspaceRepository) GetAllWorkspaceByUser(userID uuid.UUID) ([]models.Workspace, error) {
	var workspaces []models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Preload("Projects").
		Preload("Tasks").
		Preload("User").
		Find(&workspaces).Error

	if err != nil {
		return nil, err
	}

	return workspaces, nil
}

func (r *workspaceRepository) GetWorkspaceById(userID uuid.UUID, workspaceID uuid.UUID) (*models.Workspace, error) {
	var workspace models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Where("id = ?", workspaceID).
		Preload("Projects").
		Preload("Tasks").
		Preload("User").
		First(&workspace).Error
	if err != nil {
		return nil, err
	}

	return &workspace, nil
}
