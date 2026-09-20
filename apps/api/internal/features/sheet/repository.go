package sheet

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type SheetRepository interface {
	CreateSheet(sheet *models.Sheet) (*models.Sheet, error)
	GetAllSheetsByUser(userID string) ([]models.Sheet, error)
	ListSheets(userID string, filter SheetFilter) ([]models.Sheet, error)
	GetSheetByID(userID string, sheetID string) (*models.Sheet, error)
	UpdateSheet(userID string, sheetID string, updates map[string]any) (*models.Sheet, error)
	DeleteSheet(userID string, sheetID string) error
	WorkspaceBelongsToUser(userID string, workspaceID string) (bool, error)
	DefaultWorkspaceID(userID string) (string, error)

	CreateTemplate(template *models.SheetTemplate) (*models.SheetTemplate, error)
	ListTemplates(userID string) ([]models.SheetTemplate, error)
	GetTemplateByID(userID, templateID string) (*models.SheetTemplate, error)
	UpdateTemplate(userID, templateID string, updates map[string]any) (*models.SheetTemplate, error)
	DeleteTemplate(userID, templateID string) error
	CountTemplates(userID string) (int64, error)
}

type sheetRepository struct {
	db *gorm.DB
}

func NewSheetRepository(db *gorm.DB) SheetRepository {
	return &sheetRepository{db: db}
}

func (r *sheetRepository) CreateSheet(sheet *models.Sheet) (*models.Sheet, error) {
	if err := r.db.Create(sheet).Error; err != nil {
		return nil, err
	}

	return r.GetSheetByID(sheet.UserID, sheet.ID)
}

func (r *sheetRepository) GetAllSheetsByUser(userID string) ([]models.Sheet, error) {
	var sheets []models.Sheet

	err := r.db.
		Where("user_id = ?", userID).
		Order("updated_at DESC").
		Find(&sheets).Error
	if err != nil {
		return nil, err
	}

	return sheets, nil
}

func (r *sheetRepository) ListSheets(userID string, filter SheetFilter) ([]models.Sheet, error) {
	query := r.db.Where("user_id = ?", userID)
	if filter.WorkspaceID != "" {
		query = query.Where("workspace_id = ?", filter.WorkspaceID)
	}
	if filter.ProjectID != "" {
		query = query.Where("project_id = ?", filter.ProjectID)
	}
	if filter.Archived != nil {
		if *filter.Archived {
			query = query.Where("archived_at IS NOT NULL")
		} else {
			query = query.Where("archived_at IS NULL")
		}
	}
	if filter.Favorite != nil {
		query = query.Where("is_favorite = ?", *filter.Favorite)
	}
	if filter.Text != "" {
		like := "%" + filter.Text + "%"
		query = query.Where("title ILIKE ?", like)
	}
	var sheets []models.Sheet
	err := query.Order("updated_at DESC").Find(&sheets).Error
	if err != nil {
		return nil, err
	}
	if sheets == nil {
		sheets = []models.Sheet{}
	}
	return sheets, nil
}

func (r *sheetRepository) GetSheetByID(userID string, sheetID string) (*models.Sheet, error) {
	var sheet models.Sheet

	err := r.db.
		Where("id = ?", sheetID).
		Where("user_id = ?", userID).
		First(&sheet).Error
	if err != nil {
		return nil, err
	}

	return &sheet, nil
}

func (r *sheetRepository) UpdateSheet(userID string, sheetID string, updates map[string]any) (*models.Sheet, error) {
	sheet, err := r.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}

	jsonCols := takeJSONB(updates, "columns", "rows", "merges", "tabs")

	if len(updates) > 0 {
		if err := r.db.Model(sheet).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	if err := models.WriteJSONB(r.db, "sheets", jsonCols, "id = ? AND user_id = ?", sheetID, userID); err != nil {
		return nil, err
	}

	return r.GetSheetByID(userID, sheetID)
}

func takeJSONB(updates map[string]any, columns ...string) map[string]any {
	out := map[string]any{}
	for _, column := range columns {
		if value, ok := updates[column]; ok {
			delete(updates, column)
			out[column] = value
		}
	}
	return out
}

func (r *sheetRepository) DeleteSheet(userID string, sheetID string) error {
	return r.db.
		Where("id = ?", sheetID).
		Where("user_id = ?", userID).
		Delete(&models.Sheet{}).Error
}

func (r *sheetRepository) WorkspaceBelongsToUser(userID string, workspaceID string) (bool, error) {
	var count int64

	err := r.db.
		Model(&models.Workspace{}).
		Where("id = ?", workspaceID).
		Where("user_id = ?", userID).
		Count(&count).Error
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func (r *sheetRepository) DefaultWorkspaceID(userID string) (string, error) {
	var workspace models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Order("created_at ASC").
		First(&workspace).Error
	if err != nil {
		return "", err
	}

	return workspace.ID, nil
}

func (r *sheetRepository) CreateTemplate(template *models.SheetTemplate) (*models.SheetTemplate, error) {
	if err := r.db.Create(template).Error; err != nil {
		return nil, err
	}
	return r.GetTemplateByID(template.UserID, template.ID)
}

func (r *sheetRepository) ListTemplates(userID string) ([]models.SheetTemplate, error) {
	var templates []models.SheetTemplate
	err := r.db.
		Where("user_id = ?", userID).
		Order("updated_at DESC").
		Find(&templates).Error
	if err != nil {
		return nil, err
	}
	if templates == nil {
		templates = []models.SheetTemplate{}
	}
	return templates, nil
}

func (r *sheetRepository) GetTemplateByID(userID, templateID string) (*models.SheetTemplate, error) {
	var template models.SheetTemplate
	err := r.db.
		Where("id = ?", templateID).
		Where("user_id = ?", userID).
		First(&template).Error
	if err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *sheetRepository) UpdateTemplate(userID, templateID string, updates map[string]any) (*models.SheetTemplate, error) {
	template, err := r.GetTemplateByID(userID, templateID)
	if err != nil {
		return nil, err
	}
	if len(updates) > 0 {
		if err := r.db.Model(template).Updates(updates).Error; err != nil {
			return nil, err
		}
	}
	return r.GetTemplateByID(userID, templateID)
}

func (r *sheetRepository) DeleteTemplate(userID, templateID string) error {
	return r.db.
		Where("id = ?", templateID).
		Where("user_id = ?", userID).
		Delete(&models.SheetTemplate{}).Error
}

func (r *sheetRepository) CountTemplates(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&models.SheetTemplate{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}
