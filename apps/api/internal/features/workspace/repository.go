package workspace

import (
	"log"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type WorkspaceRepository interface {
	CreateWorkspace(workspace *models.Workspace, defaultStatuses []models.Status) error
	GetAllWorkspaceByUser(userID string) ([]models.Workspace, error)
	GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error)
	UpdateWorkspace(userID string, workspace *models.Workspace) error
	EnsureWorkspaceOwned(userID string, workspaceID string) error
	GetAllCustomFields(userID string) ([]models.CustomField, error)
	CreateLabels(lable *models.Lable) (*models.Lable, error)
	CreateStatuses(status *models.Status) (*models.Status, error)
	CreateCustomFields(customField *models.CustomField) (*models.CustomField, error)
	UpdateLabels(lable *models.Lable) (*models.Lable, error)
	DeleteLabels(lableID string, workspaceID string) error
	UpdateStatuses(status *models.Status) (*models.Status, error)
	DeleteStatuses(statusID string, workspaceID string) error
	UpdateCustomFields(customField *models.CustomField) (*models.CustomField, error)
	DeleteCustomFields(customFieldID string, workspaceID string) error
	GetConfig(userID string) (*models.Config, error)
	UpdateConfig(config *models.Config) (*models.Config, error)
	CountByUser(userID string) (int64, error)
	DeleteWorkspace(userID, workspaceID string) error
}

type workspaceRepository struct {
	db *gorm.DB
}

func NewWorkspaceRepository(db *gorm.DB) WorkspaceRepository {
	return &workspaceRepository{db: db}
}

func (r *workspaceRepository) CreateWorkspace(workspace *models.Workspace, defaultStatuses []models.Status) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(workspace).Error; err != nil {
			return err
		}
		for i := range defaultStatuses {
			defaultStatuses[i].WorkspaceID = workspace.ID
		}
		return tx.Create(&defaultStatuses).Error
	})
}

func (r *workspaceRepository) GetAllWorkspaceByUser(userID string) ([]models.Workspace, error) {
	var workspaces []models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Preload("Projects").
		Preload("Status").
		Preload("CustomFields").
		Preload("Lables").
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

func (r *workspaceRepository) UpdateWorkspace(userID string, workspace *models.Workspace) error {
	result := r.db.Model(&models.Workspace{}).
		Where("id = ? AND user_id = ?", workspace.ID, userID).
		Updates(map[string]any{
			"name":       workspace.Name,
			"color":      workspace.Color,
			"updated_at": workspace.UpdatedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// EnsureWorkspaceOwned returns gorm.ErrRecordNotFound unless the workspace
// belongs to the user.
func (r *workspaceRepository) EnsureWorkspaceOwned(userID string, workspaceID string) error {
	var count int64
	if err := r.db.Model(&models.Workspace{}).
		Where("id = ? AND user_id = ?", workspaceID, userID).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *workspaceRepository) CreateLabels(lable *models.Lable) (*models.Lable, error) {
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

func (r *workspaceRepository) UpdateLabels(lable *models.Lable) (*models.Lable, error) {
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

func (r *workspaceRepository) DeleteLabels(lableID string, workspaceID string) error {
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
	// Pass the populated struct as Model so BeforeUpdate sees Type/Options.
	// Model(&CustomField{}) would leave Type empty and fail validation.
	if err := r.db.Model(customField).
		Where("id = ? AND workspace_id = ?", customField.ID, customField.WorkspaceID).
		Select("Name", "Type", "Options", "UpdatedAt").
		Updates(customField).Error; err != nil {
		return nil, err
	}

	return customField, nil
}

func (r *workspaceRepository) DeleteCustomFields(customFieldID string, workspaceID string) error {
	return r.db.Where("id = ? AND workspace_id = ?", customFieldID, workspaceID).Delete(&models.CustomField{}).Error
}

func (r *workspaceRepository) GetConfig(userID string) (*models.Config, error) {
	var config models.Config

	err := r.db.
		Where("user_id = ?", userID).
		First(&config).Error
	if err != nil {
		return nil, err
	}

	return &config, nil
}

// UpdateConfig persists config changes by user id.
func (r *workspaceRepository) UpdateConfig(config *models.Config) (*models.Config, error) {
	updates := map[string]any{
		"is_on_boarding_completed": config.IsOnBoardingCompleted,
		"active_task_view_id":      config.ActiveTaskViewId,
	}

	result := r.db.Model(&models.Config{}).
		Where("user_id = ?", config.UserID).
		Updates(updates)
	if result.Error == nil {
		jsonCols := map[string]any{
			"task_views": config.TaskViews,
			"appearance": config.Appearance,
		}
		if config.ProjectTaskViews != nil {
			jsonCols["project_task_views"] = config.ProjectTaskViews
		}
		if err := models.WriteJSONB(r.db, "configs", jsonCols, "user_id = ?", config.UserID); err != nil {
			result.Error = err
		}
	}
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	var updated models.Config
	if err := r.db.Where("user_id = ?", config.UserID).First(&updated).Error; err != nil {
		return nil, err
	}

	log.Printf("Config updated for user %s", config.UserID)

	return &updated, nil
}

func (r *workspaceRepository) GetAllCustomFields(userID string) ([]models.CustomField, error) {
	var customFields []models.CustomField

	var workspaces []models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Find(&workspaces).Error

	if err != nil {
		return nil, err
	}

	if len(workspaces) == 0 {
		return customFields, nil
	}

	ids := make([]string, 0, len(workspaces))
	for _, w := range workspaces {
		ids = append(ids, w.ID)
	}

	err = r.db.
		Where("workspace_id IN ?", ids).
		Find(&customFields).Error
	if err != nil {
		return nil, err
	}

	return customFields, nil
}

func (r *workspaceRepository) CountByUser(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&models.Workspace{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *workspaceRepository) DeleteWorkspace(userID, workspaceID string) error {
	result := r.db.Where("id = ? AND user_id = ?", workspaceID, userID).Delete(&models.Workspace{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
