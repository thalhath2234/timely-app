package repositories

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type WorkspaceRepository interface {
	CreateWorkspace(workspace *models.Workspace, defaultStatuses []models.Status) error
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

type workspaceRepository struct {
	db *gorm.DB
}

func NewWorkspaceRepository(db *gorm.DB) WorkspaceRepository {
	return &workspaceRepository{db: db}
}

func (r *workspaceRepository) CreateWorkspace(workspace *models.Workspace, defaultStatuses []models.Status) error {
	tx := r.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Create(workspace).Error; err != nil {
		tx.Rollback()
		return err
	}

	for i := range defaultStatuses {
		defaultStatuses[i].WorkspaceID = workspace.ID
	}

	if err := tx.Create(&defaultStatuses).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

func (r *workspaceRepository) GetAllWorkspaceByUser(userID string) ([]models.Workspace, error) {
	var workspaces []models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Find(&workspaces).Error

	if err != nil {
		return nil, err
	}

	return workspaces, nil
}

func (r *workspaceRepository) GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error) {
	var workspace models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Where("id = ?", workspaceID).
		Preload("Projects").
		Preload("Status").
		Preload("CustomFields").
		Preload("Lables").
		First(&workspace).Error
	if err != nil {
		return nil, err
	}

	return &workspace, nil
}

func (r *workspaceRepository) CreateLables(lable *models.Lable) (*models.Lable, error) {
	if err := r.db.Create(lable).Error; err != nil {
		return nil, err
	}

	return lable, nil
}

func (r *workspaceRepository) CreateStatuses(status *models.Status) (*models.Status, error) {
	if err := r.db.Create(status).Error; err != nil {
		return nil, err
	}

	return status, nil
}

func (r *workspaceRepository) CreateCustomFields(customField *models.CustomField) (*models.CustomField, error) {
	if err := r.db.Create(customField).Error; err != nil {
		return nil, err
	}

	return customField, nil
}

func (r *workspaceRepository) UpdateLables(lable *models.Lable) (*models.Lable, error) {
	if err := r.db.Model(&models.Lable{}).
		Where("id = ? AND workspace_id = ?", lable.ID, lable.WorkspaceID).
		Updates(map[string]any{
			"name":       lable.Name,
			"color":      lable.Color,
			"updated_at": lable.UpdatedAt,
		}).Error; err != nil {
		return nil, err
	}

	return lable, nil
}

func (r *workspaceRepository) DeleteLables(lableID string, workspaceID string) error {
	return r.db.Where("id = ? AND workspace_id = ?", lableID, workspaceID).Delete(&models.Lable{}).Error
}

func (r *workspaceRepository) UpdateStatuses(status *models.Status) (*models.Status, error) {
	if err := r.db.Model(&models.Status{}).
		Where("id = ? AND workspace_id = ?", status.ID, status.WorkspaceID).
		Updates(map[string]any{
			"name":       status.Name,
			"color":      status.Color,
			"updated_at": status.UpdatedAt,
		}).Error; err != nil {
		return nil, err
	}

	return status, nil
}

func (r *workspaceRepository) DeleteStatuses(statusID string, workspaceID string) error {
	return r.db.Where("id = ? AND workspace_id = ?", statusID, workspaceID).Delete(&models.Status{}).Error
}

func (r *workspaceRepository) UpdateCustomFields(customField *models.CustomField) (*models.CustomField, error) {
	if err := r.db.Model(&models.CustomField{}).
		Where("id = ? AND workspace_id = ?", customField.ID, customField.WorkspaceID).
		Updates(map[string]any{
			"name":       customField.Name,
			"type":       customField.Type,
			"options":    customField.Options,
			"updated_at": customField.UpdatedAt,
		}).Error; err != nil {
		return nil, err
	}

	return customField, nil
}

func (r *workspaceRepository) DeleteCustomFields(customFieldID string, workspaceID string) error {
	return r.db.Where("id = ? AND workspace_id = ?", customFieldID, workspaceID).Delete(&models.CustomField{}).Error
}
